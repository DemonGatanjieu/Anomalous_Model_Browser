"""The MCP tools that act: on the open canvas, through the page (mcp_bridge.py and
web/modules/mcp_bridge.js, which use Anomalous's own canvas code, so every change is one
Ctrl+Z step and lands in the activity log marked as the AI's), and on this ComfyUI server
through its own routes (scans, Anomalous TTS speech), so they behave exactly as from the UI.

Nothing here deletes or renames files. Tools that overwrite something on the canvas say so
(destructiveHint); AI apps ask the user before calling tools that are not read-only.
"""

import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request

from . import ai_gates, mcp_fill, model_advice, run_refusal
from .lora_info import trains_text_encoder
from .mcp_bridge import PageRefused, PageUnavailable, ask_page
from .mcp_tools import MAX_LIMIT, ToolError, _resolve_model, _schema

SPEAK_WAIT_SECONDS = 120
HISTORY_POLL_SECONDS = 1.5


def _page(action, args=None, timeout=30):
    try:
        return ask_page(action, args, timeout)
    except (PageUnavailable, PageRefused) as error:
        raise ToolError(str(error))


def _rel(base_dir, file_path):
    return os.path.relpath(file_path, base_dir).replace(os.sep, "/")


def _local(ctx, method, path, body=None, timeout=20):
    """(status, JSON) of one request to this ComfyUI server's own routes."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(ctx["base_url"] + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
    # Loopback only (mcp_server checked the host); a self-signed certificate is the user's own.
    context = ssl._create_unverified_context() if ctx["base_url"].startswith("https:") else None
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read() or b"null")
        except ValueError:
            return error.code, None
    except (urllib.error.URLError, OSError) as error:
        raise ToolError(f"Could not reach ComfyUI's own server: {error}")


# ---------------------------------------------------------------- canvas (through the page)

def describe_canvas(ctx):
    return _page("describe_canvas")


def set_prompt(ctx, prompt, role="positive", node_id=None, mode="replace"):
    if role not in ("positive", "negative") or mode not in ("replace", "append"):
        raise ToolError("role is positive or negative; mode is replace or append.")
    return _page("set_prompt", {"text": str(prompt), "role": role, "node_id": node_id, "mode": mode})


def _base_note(result, folder_type, file_path):
    """The page's answer without the model line it reports, and base_model_note when a LoRA on that
    line does not suit its main model (model_advice.py)."""
    if not isinstance(result, dict):
        return result
    line = result.pop("line", None) or {}
    if folder_type == "loras":
        note = model_advice.lora_note(file_path, line)
    else:
        notes = (model_advice.lora_note(path, {"model": line.get("model")}) for path in model_advice.lora_paths(line.get("loras")))
        note = next((item for item in notes if item), None)
    if note:
        result["base_model_note"] = note
    return result


def set_model(ctx, node_id, model_id):
    folder_type, _idx, base_dir, file_path = _resolve_model(model_id)
    result = _page("set_model", {"node_id": node_id, "model": {"type": folder_type, "path": _rel(base_dir, file_path)}})
    return _base_note(result, folder_type, file_path)


def add_lora(ctx, model_id, after_node_id=None, strength_model=1.0, strength_clip=1.0):
    folder_type, _idx, base_dir, file_path = _resolve_model(model_id)
    if folder_type != "loras":
        raise ToolError("add_lora takes a model from the loras folder.")
    result = _page("add_lora", {"model": {"type": folder_type, "path": _rel(base_dir, file_path)},
                                "text_encoder": trains_text_encoder(file_path), "after_node_id": after_node_id,
                                "strength_model": float(strength_model), "strength_clip": float(strength_clip)})
    return _base_note(result, folder_type, file_path)


def place_combo(ctx, name):
    return _page("place_combo", {"name": str(name)})


def check_workflow_models(ctx):
    return _page("check_models", timeout=90)


def fix_workflow_models(ctx):
    return _page("fix_models", timeout=90)


def download_missing_models(ctx, names=None):
    return _page("download_missing", {"names": [str(name) for name in names or []]}, timeout=120)


def download_model(ctx, type, url="", hash="", folder=None, name=""):
    if not (url or hash):
        raise ToolError("Give url (a Civitai, Hugging Face or GitHub link to the file or model version) or hash.")
    return _page("download_model", {"url": str(url), "hash": str(hash), "type": str(type),
                                    "folder": None if folder is None else str(folder), "name": str(name or "")}, timeout=90)


def download_status(ctx):
    status, data = _local(ctx, "GET", "/anomalous/download/status")
    if status != 200:
        raise ToolError(f"Download status unavailable ({status}).")
    jobs = []
    for job in (data or {}).get("jobs", []):
        total = job.get("total") or 0
        jobs.append({"file": job.get("rel"), "type": job.get("type"), "state": job.get("state"), "error": job.get("error") or None,
                     "percent": round(job["received"] * 100 / total) if total else None, "size": total or None,
                     "checked": job.get("verified"), "for_model": job.get("value") or None})
    return {"downloads": jobs, "meaning": "state: queued, running, verifying, done (checked: its fingerprint matched), "
                                          "failed (error says why; starting it again continues it), cancelled."}


def run_workflow(ctx, batch=1, wait_seconds=55, workflow=None, **slots):
    from .ai_run_tracking import checked_wait
    checked_wait(wait_seconds)  # Reject a wait that is no number before anything can be submitted.
    batch = max(1, min(8, int(batch)))
    filled = mcp_fill.fill(ctx, workflow, **slots)  # a saved workflow and its blanks first (mcp_fill.py)
    try:
        answer = ask_page("run_workflow", {"batch": batch}, required_capability="prompt_ids")
    except (PageUnavailable, PageRefused) as error:
        raise ToolError(str(error))
    ids = answer.get("prompt_ids") if isinstance(answer, dict) else None
    page = answer if isinstance(answer, dict) else {}
    if (not isinstance(ids, list) or not ids or len(ids) > batch
            or any(not isinstance(pid, str) or not pid or len(pid) > 128 for pid in ids) or len(set(ids)) != len(ids)):
        raise ToolError((run_refusal.say(answer.get("refusal")) or answer.get("submission_error") if isinstance(answer, dict) else None)
                        or "No valid submission receipts. Check ComfyUI's queue before retrying; do not repeat automatically.")
    answer = {"prompt_ids": ids, "queued": len(ids), "requested": batch,
              "note": ("If this answer does not say it is done, the user tells you when it is: say it is running and end "
                       "your turn; run_status then brings its pictures." if ai_gates.run_wait() == "call" else
                       "Follow these runs with run_status (wait_seconds up to 55).")
              + " Do not repeat the batch; accepted prompts are already queued."}
    if filled:
        answer["filled"] = filled
    # Some prompts may have been accepted before validation or a transport failure stopped the batch.
    if len(ids) < batch:
        answer["submission_error"] = f"Only {len(ids)} of {batch} prompts were accepted."
        told = run_refusal.say(page.get("refusal"))
        if told:
            answer["submission_error"] += f" {told}"
    return answer


def open_in_anomalous(ctx, model_id):
    folder_type, path_idx, base_dir, file_path = _resolve_model(model_id)
    return _page("open_model", {"type": folder_type, "path_idx": path_idx, "rel": _rel(base_dir, file_path)})


# ---------------------------------------------------------------- this server

def scan_models(ctx, what="new", model_ids=None):
    body = {"offline_only": False, "skip_rename": False, "virtual_rename": True, "physical_rename": False,
            "force_overwrite": False, "retry_unmatched": what == "retry_unmatched"}
    if what == "models":
        folders = {}
        for model_id in model_ids or []:
            folder_type, path_idx, base_dir, file_path = _resolve_model(model_id)
            subfolder, _, filename = _rel(base_dir, file_path).rpartition("/")
            folders.setdefault((folder_type, path_idx, "/" + subfolder), []).append(filename)
        if not folders:
            raise ToolError("what=models needs model_ids from search_models.")
        body["targets"] = [{"type": t, "path_idx": i, "subfolder": s, "files": files} for (t, i, s), files in folders.items()]
    elif what not in ("new", "retry_unmatched"):
        raise ToolError("what is new, retry_unmatched or models.")
    status, data = _local(ctx, "POST", "/anomalous/scan_all", body)
    if status == 409:
        raise ToolError("A scan is already running; call scan_report later to see it.")
    if status != 200 or (data or {}).get("status") != "ok":
        raise ToolError(f"The scan did not start: {(data or {}).get('message') or status}")
    return {"started": True, "note": "Scans run in the background and only read .safetensors files. "
                                     "Call scan_report in a minute or two for what it found."}


def _tts_characters(ctx):
    status, data = _local(ctx, "GET", "/anomalous_tts/characters")
    if status == 404:
        raise ToolError("Anomalous TTS is not installed, so there are no voices.")
    if status != 200 or not isinstance(data, dict):
        raise ToolError(f"Could not read the voices ({status}).")
    return data.get("characters") or []


def list_voices(ctx):
    return {"voices": [{"character": item.get("name"), "language": item.get("language") or "",
                        "emotions": sorted((item.get("emotions") or {}).keys()),
                        **({"problem": item.get("error") or item.get("settings_error")}
                           if item.get("error") or item.get("settings_error") else {})}
                       for item in _tts_characters(ctx)]}


def _output_prefix(character):
    """Where the audio page saves a character's lines (audio_script.js ttsOutputPrefix)."""
    parts = [re.sub(r'[<>:"\\|?*\x00-\x1f]', "_", part).strip() or "_" for part in str(character).split("/")]
    parts = ["_" if re.fullmatch(r"\.+", part) else part for part in parts]
    return f"audio/{'/'.join(parts)}/{parts[-1]}"


def speak(ctx, character, text, seed=None, language="auto"):
    names = {item.get("name") for item in _tts_characters(ctx)}
    if character not in names:
        raise ToolError(f"No voice called {character!r}; list_voices names them.")
    if not str(text).strip():
        raise ToolError("text is empty.")
    seed = int(seed) if seed is not None else int(time.time() * 1000) % 2**31
    prompt = {"1": {"class_type": "AnomalousTTS_CharacterSpeech",
                    "inputs": {"character": character, "text": str(text), "seed": seed, "language": language}},
              "2": {"class_type": "SaveAudio", "inputs": {"audio": ["1", 0], "filename_prefix": _output_prefix(character)}}}
    status, data = _local(ctx, "POST", "/prompt", {"prompt": prompt, "client_id": "anomalous-mcp"})
    prompt_id = (data or {}).get("prompt_id")
    if status != 200 or not prompt_id:
        errors = (data or {}).get("node_errors") or (data or {}).get("error") or status
        raise ToolError(f"ComfyUI refused the speech job: {json.dumps(errors, ensure_ascii=False)[:500]}")
    deadline = time.monotonic() + SPEAK_WAIT_SECONDS
    while time.monotonic() < deadline:
        time.sleep(HISTORY_POLL_SECONDS)
        _status, history = _local(ctx, "GET", f"/history/{prompt_id}")
        record = (history or {}).get(prompt_id) or {}
        state = record.get("status") or {}
        if state.get("status_str") == "error":
            messages = [m[1].get("exception_message") for m in state.get("messages") or [] if m and m[0] == "execution_error"]
            raise ToolError(f"Speech failed: {messages[0] if messages else 'see the ComfyUI console'}")
        if state.get("completed"):
            files = [f"{item.get('subfolder')}/{item.get('filename')}".replace("\\", "/").strip("/")
                     for output in (record.get("outputs") or {}).values() for item in output.get("audio") or []]
            return {"done": True, "seed": seed, "files": files,
                    "note": "Saved under ComfyUI's output folder; it shows in Anomalous's audio gallery."}
    return {"done": False, "prompt_id": prompt_id, "seed": seed,
            "note": "Still generating (ComfyUI may be busy with other jobs); search_audio will list it when done."}


# ---------------------------------------------------------------- registry

_NODE = {"type": "integer", "description": "A node id."}
_MODEL = {"type": "string", "description": "model_id from search_models."}


def _action(name, title, description, run, properties=None, required=(), destructive=False, open_world=False,
            read_only=False):
    return name, {"run": run, "context": True, "spec": {
        "name": name, "title": title, "description": description,
        "inputSchema": _schema(properties, required),
        "annotations": {"title": title, "readOnlyHint": read_only, "destructiveHint": destructive,
                        "idempotentHint": read_only, "openWorldHint": open_world},
    }}


ACTIONS = dict([
    _action("describe_canvas", "Read the canvas",
            "The workflow open in ComfyUI now: each node's id, type, title, settings, which prompt box is "
            "positive or negative, and where its inputs come from. Call it before changing settings; "
            "get_situation gives the canvas in brief (a line a node, what is still unwired and what fits it).",
            describe_canvas, read_only=True),
    _action("set_prompt", "Write a prompt",
            "Writes text into the workflow's positive or negative prompt box (or the one on node_id). "
            "mode=append adds to what is there. One Ctrl+Z step.",
            set_prompt, {"prompt": {"type": "string"}, "role": {"type": "string", "enum": ["positive", "negative"], "default": "positive"},
                         "node_id": _NODE, "mode": {"type": "string", "enum": ["replace", "append"], "default": "replace"}},
            ["prompt"], destructive=True),
    _action("set_model", "Swap a node's model",
            "Puts a model into a loader node (checkpoint, LoRA, VAE…) on the canvas, replacing the one it had. "
            "base_model_note in the answer: a LoRA and the main model are for different base models.",
            set_model, {"node_id": _NODE, "model_id": _MODEL}, ["node_id", "model_id"], destructive=True),
    _action("add_lora", "Add a LoRA",
            "Inserts a LoRA loader after after_node_id (default: the main model loader, past its LoRAs) and moves "
            "what that node fed behind it; the CLIP line too when the LoRA trains the text encoder. base_model_note in "
            "the answer: the LoRA is for another base model than the main model.",
            add_lora, {"model_id": _MODEL, "after_node_id": _NODE,
                       "strength_model": {"type": "number", "default": 1.0}, "strength_clip": {"type": "number", "default": 1.0}},
            ["model_id"]),
    _action("place_combo", "Place a combo",
            "Adds one of the user's combos (list_combos) to the canvas as a new wired group: model loader, LoRAs, "
            "positive and negative prompt, or a node-structure combo's own nodes and links. Nothing already there "
            "changes; ports to nodes outside the combo (sampler…) stay open.",
            place_combo, {"name": {"type": "string", "description": "Combo name from list_combos."}}, ["name"]),
    _action("check_workflow_models", "Check missing models",
            "Models the open workflow names that this computer lacks, and which Anomalous can put back (the same "
            "file by hash, or a likely one).",
            check_workflow_models, read_only=True),
    _action("fix_workflow_models", "Fix missing models",
            "Puts back every missing model found by hash; likely ones are left to the user. One Ctrl+Z step.",
            fix_workflow_models, destructive=True),
    _action("download_missing_models", "Download missing models",
            "Downloads the models the open workflow is missing whose source is certain: Civitai found by the "
            "workflow's fingerprint, or a file link the workflow carries. A file name alone is never used. Files go "
            "where the user's download settings say and are checked against the fingerprint before use; finished "
            "ones are put into their nodes. names limits it to those files. Large files take a while.",
            download_missing_models, {"names": {"type": "array", "items": {"type": "string"}, "maxItems": MAX_LIMIT,
                                                "description": "Only these model file names (default: all missing)."}},
            open_world=True),
    _action("download_model", "Download a model",
            "Downloads one model into this computer's models folder of `type` (loras, checkpoints, vae, "
            "diffusion_models, text_encoders, upscale_models…): from url (a Civitai model-version link, or a Hugging "
            "Face / GitHub link to the file) or by its Civitai hash. folder is a subfolder inside that type's folder "
            "(default: the user's download settings); name the file name (default: the site's). Never replaces a file.",
            download_model, {"type": {"type": "string"}, "url": {"type": "string"}, "hash": {"type": "string"},
                             "folder": {"type": "string"}, "name": {"type": "string"}}, ["type"], open_world=True),
    _action("download_status", "Downloads", "How the downloads of this ComfyUI run are going.", download_status,
            read_only=True),
    _action("run_workflow", "Run the workflow",
            "Queues the workflow (uses the GPU). In the same call: workflow (a saved one) opens in the task's tab "
            "once and is reused; prompt, negative, seed (every sampler), width/height (the start latent), image "
            "(its LoadImage) and values (any setting by name: {\"steps\": 30}, or {\"12\": {\"denoise\": 0.5}} when "
            "several nodes have it) fill it in; the rest stays. Without workflow they fill the open canvas. Then "
            "run_status, never the output folder.",
            run_workflow, {"batch": {"type": "integer", "minimum": 1, "maximum": 8, "default": 1},
                           "wait_seconds": {"type": "number", "minimum": 0, "maximum": 55, "default": 55,
                                            "description": "Seconds to wait for it to end."},
                           "workflow": {"type": "string", "description": "A name from list_workflows."},
                           "prompt": {"type": "string"}, "negative": {"type": "string"},
                           "seed": {"type": "integer", "minimum": 0},
                           "width": {"type": "integer", "minimum": 16, "maximum": 16384},
                           "height": {"type": "integer", "minimum": 16, "maximum": 16384},
                           "image": {"type": "string", "description": "subfolder/name.png, output or input folder."},
                           "image_node": {"type": "integer", "description": "Which LoadImage, when there are several."},
                           "values": {"type": "object", "description": "Other settings by name, any node's."}}),
    _action("open_in_anomalous", "Show a model",
            "Opens Anomalous Model Browser on this model's page, so the user sees its cover and details.",
            open_in_anomalous, {"model_id": _MODEL}, ["model_id"]),
    _action("scan_models", "Scan models",
            "Starts a scan that fetches covers, trigger words and base models from Civitai (by file hash) for "
            "models not scanned yet (new), looks unmatched ones up again (retry_unmatched), or scans model_ids.",
            scan_models, {"what": {"type": "string", "enum": ["new", "retry_unmatched", "models"], "default": "new"},
                          "model_ids": {"type": "array", "items": {"type": "string"}, "maxItems": MAX_LIMIT}},
            open_world=True),
    _action("list_voices", "Voices",
            "The Anomalous TTS characters (GPT-SoVITS voices) with their language and emotions.", list_voices,
            read_only=True),
    _action("speak", "Speak a line",
            "Has an Anomalous TTS character read text and saves the audio. Emotion tags like {happy} switch "
            "emotion mid-text; waits up to two minutes.",
            speak, {"character": {"type": "string", "description": "From list_voices."}, "text": {"type": "string"},
                    "seed": {"type": "integer"}, "language": {"type": "string", "default": "auto"}},
            ["character", "text"]),
])
