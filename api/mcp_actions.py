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


def _model_ref(model_id):
    """{type, path} of a model, as a node's drop-down names it (relative to its folder)."""
    folder_type, _idx, base_dir, file_path = _resolve_model(model_id)
    return {"type": folder_type, "path": _rel(base_dir, file_path)}


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


def set_prompt(ctx, text, role="positive", node_id=None, mode="replace"):
    if role not in ("positive", "negative") or mode not in ("replace", "append"):
        raise ToolError("role is positive or negative; mode is replace or append.")
    return _page("set_prompt", {"text": str(text), "role": role, "node_id": node_id, "mode": mode})


def set_model(ctx, node_id, model_id):
    return _page("set_model", {"node_id": node_id, "model": _model_ref(model_id)})


def add_lora(ctx, model_id, after_node_id=None, strength_model=1.0, strength_clip=1.0):
    ref = _model_ref(model_id)
    if ref["type"] != "loras":
        raise ToolError("add_lora takes a model from the loras folder.")
    return _page("add_lora", {"model": ref, "after_node_id": after_node_id,
                              "strength_model": float(strength_model), "strength_clip": float(strength_clip)})


def place_combo(ctx, name):
    return _page("place_combo", {"name": str(name)})


def check_workflow_models(ctx):
    return _page("check_models", timeout=90)


def fix_workflow_models(ctx):
    return _page("fix_models", timeout=90)


def run_workflow(ctx, batch=1):
    batch = max(1, min(8, int(batch)))
    return _page("run_workflow", {"batch": batch})


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

_NODE = {"type": "integer", "description": "A node id from describe_canvas."}
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
            "positive or negative, and where its inputs come from. Call it before changing the canvas.",
            describe_canvas, read_only=True),
    _action("set_prompt", "Write a prompt",
            "Writes text into the workflow's positive or negative prompt box (or the one on node_id). "
            "mode=append adds to what is there. One Ctrl+Z step.",
            set_prompt, {"text": {"type": "string"}, "role": {"type": "string", "enum": ["positive", "negative"], "default": "positive"},
                         "node_id": _NODE, "mode": {"type": "string", "enum": ["replace", "append"], "default": "replace"}},
            ["text"], destructive=True),
    _action("set_model", "Swap a node's model",
            "Puts a model into a loader node (checkpoint, LoRA, VAE…) on the canvas, replacing the one it had.",
            set_model, {"node_id": _NODE, "model_id": _MODEL}, ["node_id", "model_id"], destructive=True),
    _action("add_lora", "Add a LoRA",
            "Inserts a LoRA loader into the model chain after node after_node_id (default: the workflow's main "
            "model loader), wired in, with the given strengths.",
            add_lora, {"model_id": _MODEL, "after_node_id": _NODE,
                       "strength_model": {"type": "number", "default": 1.0}, "strength_clip": {"type": "number", "default": 1.0}},
            ["model_id"]),
    _action("place_combo", "Place a combo",
            "Adds one of the user's combos (list_combos) to the canvas as a new wired group: model loader, LoRAs, "
            "positive and negative prompt. Nothing already there changes.",
            place_combo, {"name": {"type": "string", "description": "Combo name from list_combos."}}, ["name"]),
    _action("check_workflow_models", "Check missing models",
            "Which models the open workflow needs that this computer does not have under that name, and which "
            "of them Anomalous can put back (same file found by hash, or a likely candidate).",
            check_workflow_models, read_only=True),
    _action("fix_workflow_models", "Fix missing models",
            "Puts back every missing model that Anomalous found with certainty (same file by hash). "
            "Likely candidates are left for the user. One Ctrl+Z step.",
            fix_workflow_models, destructive=True),
    _action("run_workflow", "Run the workflow",
            "Queues the open workflow in ComfyUI, like pressing Run. Uses the GPU; results appear in the output folder.",
            run_workflow, {"batch": {"type": "integer", "minimum": 1, "maximum": 8, "default": 1}}),
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
