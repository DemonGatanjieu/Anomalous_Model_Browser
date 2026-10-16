"""The MCP endpoint's (mcp_server.py) reading tools: views of the library (mcp_actions.py acts).

`call_tool` runs any tool of a registry, these and mcp_actions.py's.

Each tool is a plain function over the same stores the browser's pages use (model catalog
and sidecars, output gallery, combos, workflow recipes, saved prompts, generated audio, scan
results, activity log). They never write. Results are small, already-summarised JSON (an AI
reads them), with ids the detail tools take back: model_id "type:path_idx:relative/path" and
image "subfolder/file.png" under ComfyUI's output folder. A tool's mistake (bad id, missing
file) comes back as a tool error the AI can read and correct, never as an exception.
"""

import base64
import datetime
import html
import json
import logging
import os
import re

import folder_paths

from .activity_log import list_entries
from .audio_catalog import _gallery_page as _audio_page
from .gallery_routes import _gallery_listing
from .image_search import read_png_text
from .kept_images import _kept_images
from .material_store import _list_materials, _read_material, get_materials_dir
from .media_routes import _build_card_thumbnail
from .metadata import get_metadata
from .model_catalog import _iter_search_models
from .model_constants import MEDIA_EXTENSIONS, MODEL_EXTENSIONS, PREVIEW_SUFFIXES
from .notebooks import _list_notebooks
from .path_utils import resolve_folder_subdir, resolve_within
from .recipe_store import _list_recipes, get_recipes_dir
from .scan_report import last_scan_path
from .scan_summary import _summarize

MAX_LIMIT = 50
MAX_TEXT = 1500
MAX_IMAGE_BYTES = 1_500_000
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
SOURCES = {"civitai": "civitai", "local": "inferred_from_file", "": "not_scanned"}


class ToolError(Exception):
    """A problem the AI can fix (bad id, nothing there); shown to it as the tool's result."""


# ---------------------------------------------------------------- helpers

def _text(value, limit=MAX_TEXT):
    """Plain text from HTML-ish Civitai descriptions, shortened."""
    value = html.unescape(re.sub(r"<[^>]+>", " ", str(value or "")))
    value = re.sub(r"\s+", " ", value).strip()
    return value if len(value) <= limit else value[:limit] + "…"


def _when(seconds):
    try:
        return datetime.datetime.fromtimestamp(float(seconds)).isoformat(timespec="seconds")
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _limit(value, default=20):
    try:
        return max(1, min(MAX_LIMIT, int(value)))
    except (TypeError, ValueError):
        return default


def _terms(query):
    return [term for term in str(query or "").lower().split() if term]


def _matches(terms, *texts):
    haystack = " ".join(str(text or "") for text in texts).lower()
    return all(term in haystack for term in terms)


def _model_id(folder_type, path_idx, base_dir, file_path):
    return f"{folder_type}:{path_idx}:{os.path.relpath(file_path, base_dir).replace(os.sep, '/')}"


def _resolve_model(model_id):
    """(type, path_idx, base_dir, file_path) for a model_id from search_models."""
    parts = str(model_id or "").split(":", 2)
    if len(parts) != 3:
        raise ToolError("model_id looks like 'loras:0:folder/file.safetensors'; take it from search_models.")
    folder_type, path_idx, rel = parts
    rel = rel.replace("\\", "/").strip("/")
    subfolder, filename = os.path.split(rel)
    try:
        path_idx = int(path_idx)
        base_dir, target_dir = resolve_folder_subdir(folder_type, path_idx, "/" + subfolder)
        file_path = resolve_within(target_dir, filename)
    except (ValueError, KeyError, TypeError):
        raise ToolError(f"No models folder for {model_id}.")
    if not filename.lower().endswith(MODEL_EXTENSIONS) or not os.path.isfile(file_path):
        raise ToolError(f"No model file at {model_id}; it may have been moved or renamed.")
    return folder_type, path_idx, base_dir, file_path


def _resolve_image(image):
    """The output image at `image` ('subfolder/file.png'), checked to stay inside the output folder."""
    rel = str(image or "").replace("\\", "/").strip("/")
    try:
        path = resolve_within(folder_paths.get_output_directory(), rel)
    except ValueError:
        raise ToolError("image is a path under ComfyUI's output folder, as search_images returns it.")
    if os.path.splitext(path)[1].lower() not in IMAGE_TYPES or not os.path.isfile(path):
        raise ToolError(f"No output image at {image}.")
    return rel, path


def _image_content(path):
    """An MCP image item: the 512 px thumbnail the gallery uses, or None when too big or unreadable."""
    try:
        thumb = _build_card_thumbnail(path)
        with open(thumb, "rb") as source:
            data = source.read(MAX_IMAGE_BYTES + 1)
    except OSError:
        return None
    if len(data) > MAX_IMAGE_BYTES:
        return None
    mime = IMAGE_TYPES.get(os.path.splitext(thumb)[1].lower(), "image/webp")
    return {"type": "image", "data": base64.b64encode(data).decode("ascii"), "mimeType": mime}


def _kept_lookup():
    return {(item["subfolder"], item["filename"]): {kind: (value or {}).get("name") for kind, value in item.items()
                                                    if kind in ("recipe", "combo", "prompt") and value}
            for item in _kept_images()}


def _model_brief(folder_type, path_idx, base_dir, file_path, meta):
    rel_dir = os.path.relpath(os.path.dirname(file_path), base_dir).replace(os.sep, "/")
    try:
        size_mb = round(os.path.getsize(file_path) / 1048576, 1)
    except OSError:
        size_mb = None
    return {
        "model_id": _model_id(folder_type, path_idx, base_dir, file_path),
        "name": meta.get("custom_name") or meta.get("name") or os.path.basename(file_path),
        "file": os.path.basename(file_path),
        "type": folder_type,
        "folder": "" if rel_dir == "." else rel_dir,
        "base_model": meta.get("baseModel") or "",
        "source": SOURCES.get(meta.get("info_source", ""), "not_scanned"),
        "trigger_words": list(meta.get("trainedWords") or [])[:8],
        "size_mb": size_mb,
    }


def _each_model():
    """Every model file once (folders registered twice, like unet and diffusion_models, count once).
    ComfyUI also registers custom_nodes, whose node packs carry files of their own: not the library."""
    seen = set()
    for folder_type, path_idx, base_dir, file_path in _iter_search_models():
        if folder_type == "custom_nodes" or not file_path.lower().endswith(MODEL_EXTENSIONS):
            continue
        real = os.path.normcase(os.path.realpath(file_path))
        if real in seen:
            continue
        seen.add(real)
        yield folder_type, path_idx, base_dir, file_path


# ---------------------------------------------------------------- models and scans

def search_models(query="", type="", base_model="", source="", limit=20):
    terms, wanted_base, found = _terms(query), str(base_model or "").lower(), []
    total = 0
    for folder_type, path_idx, base_dir, file_path in _each_model():
        if type and folder_type != type:
            continue
        meta = get_metadata(file_path)
        if wanted_base and wanted_base not in str(meta.get("baseModel") or "").lower():
            continue
        if source and SOURCES.get(meta.get("info_source", ""), "not_scanned") != source:
            continue
        if not _matches(terms, os.path.relpath(file_path, base_dir), meta.get("name"), meta.get("custom_name"),
                        meta.get("baseModel"), " ".join(meta.get("trainedWords") or [])):
            continue
        total += 1
        if len(found) < _limit(limit):
            found.append(_model_brief(folder_type, path_idx, base_dir, file_path, meta))
    return {"total_matches": total, "models": found}


def get_model(model_id, include_cover=False):
    folder_type, path_idx, base_dir, file_path = _resolve_model(model_id)
    meta = get_metadata(file_path)
    detail = _model_brief(folder_type, path_idx, base_dir, file_path, meta)
    detail.update({
        "trigger_words": list(meta.get("trainedWords") or []),
        "civitai_name": meta.get("name") or "",
        "civitai_url": meta.get("civitai_url") or "",
        "download_link": meta.get("source_url") or "",
        "user_notes": meta.get("custom_notes") or "",
        "fields_set_by_user": list(meta.get("user_fields") or []),
        "description": _text(meta.get("description")),
        "sha256": meta.get("hash") or "",
    })
    if meta.get("info_source") == "local":
        detail["why_not_on_civitai"] = meta.get("unmatched_reason") or "unknown"
    extra = []
    if include_cover:
        base = os.path.splitext(file_path)[0]
        cover = next((base + suffix for suffix in PREVIEW_SUFFIXES + MEDIA_EXTENSIONS
                      if os.path.splitext(suffix)[1].lower() in IMAGE_TYPES and os.path.isfile(base + suffix)), None)
        item = _image_content(cover) if cover else None
        detail["cover"] = "attached" if item else "none"
        extra = [item] if item else []
    return detail, extra


def library_overview():
    by_type, by_base = {}, {}
    for folder_type, _idx, _base, file_path in _each_model():
        by_type[folder_type] = by_type.get(folder_type, 0) + 1
        base = get_metadata(file_path).get("baseModel") or "unknown"
        by_base[base] = by_base.get(base, 0) + 1
    summary = _summarize()
    return {
        "models_by_type": dict(sorted(by_type.items(), key=lambda item: -item[1])),
        "models_by_base_model": dict(sorted(by_base.items(), key=lambda item: -item[1])[:20]),
        "scan": {key: summary[key] for key in ("total", "matched", "unmatched", "new", "pending")},
        "combos": len(_list_notebooks()),
        "workflow_recipes": len(_list_recipes(get_recipes_dir())),
        "saved_prompts": sum(1 for item in _list_materials(get_materials_dir()) if item.get("kind") == "prompt_plan"),
    }


def scan_report():
    summary = _summarize()
    try:
        with open(last_scan_path(), encoding="utf-8") as source:
            last = json.load(source)
    except (OSError, ValueError):
        last = None
    report = {
        "counts": {key: summary[key] for key in ("total", "matched", "unmatched", "new", "pending")},
        "meaning": "matched: found on Civitai; unmatched: base model inferred from the file (reason says why); "
                   "new: never scanned; pending: unmatched only because Civitai was not asked (offline or no connection).",
        "unmatched_models": summary["unmatched_models"][:MAX_LIMIT],
        "not_scanned_models": summary["new_models"][:MAX_LIMIT],
    }
    if isinstance(last, dict) and last.get("counts"):
        report["last_scan"] = {"finished": _when(last.get("finished")), "kind": last.get("kind"),
                               "counts": last.get("counts"), "civitai_unreachable": bool(last.get("civitai_down")),
                               "models": (last.get("files") or [])[:30]}
    return report


# ---------------------------------------------------------------- outputs

def search_images(query="", limit=20, page=1):
    images = _gallery_listing(folder_paths.get_output_directory(), False, str(query or "").strip())
    limit = _limit(limit)
    try:
        page = max(1, int(page))
    except (TypeError, ValueError):
        page = 1
    kept = _kept_lookup()
    chosen = images[(page - 1) * limit:page * limit]
    return {
        "total_matches": len(images), "page": page,
        "images": [{"image": "/".join(part for part in (item["subfolder"], item["filename"]) if part),
                    "created": _when(item.get("mtime")),
                    **({"kept_as": kept[(item["subfolder"], item["filename"])]}
                       if (item["subfolder"], item["filename"]) in kept else {})}
                   for item in chosen],
    }


def get_image_info(image, include_image=False):
    rel, path = _resolve_image(image)
    info = {"image": rel, "created": _when(os.path.getmtime(path))}
    chunks = read_png_text(path) if path.lower().endswith(".png") else {}
    try:
        prompt = json.loads(chunks.get("prompt") or "null")
    except ValueError:
        prompt = None
    if isinstance(prompt, dict):
        nodes, models = [], set()
        for node_id, node in list(prompt.items())[:80]:
            if not isinstance(node, dict):
                continue
            inputs = {}
            for key, value in (node.get("inputs") or {}).items():
                if isinstance(value, str):
                    inputs[key] = _text(value, 2000) if len(value) > 2000 else value
                    if value.lower().endswith(MODEL_EXTENSIONS):
                        models.add(value.replace("\\", "/"))
                elif isinstance(value, (int, float, bool)):
                    inputs[key] = value
            nodes.append({"id": node_id, "type": node.get("class_type"), "inputs": inputs})
        info.update(models_used=sorted(models), nodes=nodes)
    elif chunks.get("parameters"):
        info["parameters"] = _text(chunks["parameters"], 4000)
    else:
        info["note"] = "No generation settings are stored in this image."
    kept = _kept_lookup().get(tuple(rel.rsplit("/", 1)) if "/" in rel else ("", rel))
    if kept:
        info["kept_as"] = kept
    extra = []
    if include_image:
        item = _image_content(path)
        info["image_attached"] = bool(item)
        extra = [item] if item else []
    return info, extra


def search_audio(query="", limit=20):
    items, total, _more = _audio_page(folder_paths.get_output_directory(), 1, _limit(limit), str(query or "").lower().strip())
    return {"total_matches": total, "audio": [{
        "file": "/".join(part for part in (item["subfolder"], item["filename"]) if part),
        "created": _when(item.get("mtime")),
        "speech": (item.get("generation") or {}).get("speech") or "",
        "voice_sample": (item.get("generation") or {}).get("sample") or "",
        "seed": (item.get("generation") or {}).get("seed"),
    } for item in items]}


# ---------------------------------------------------------------- what the user kept

def _model_name(model):
    if isinstance(model, dict):
        return model.get("filename") or model.get("name") or ""
    return str(model or "")


def list_combos(query="", limit=20):
    terms, found = _terms(query), []
    for note in _list_notebooks():
        data = note.get("data") or {}
        if data.get("kind") == "nodes":  # its own node structure: model and text slots by their names
            structure = data.get("structure") or {}
            values = data.get("values") or {}
            slots = structure.get("slots") or []
            models = [{"slot": s.get("label") or s.get("widget"), "folder": s.get("folder") or "",
                       "file": os.path.basename(str(values.get(s["id"]) or "").replace("\\", "/"))}
                      for s in slots if s.get("kind") == "model"]
            texts = [{"slot": s.get("label") or s.get("widget"), "text": _text(values.get(s["id"]), 400)}
                     for s in slots if s.get("kind") == "text"]
            combo = {"name": note.get("name"), "kind": "node structure", "models": models, "texts": texts,
                     "nodes": [n.get("name") or n.get("type") for n in structure.get("nodes") or []],
                     "main_model": models[0]["file"] if models else "", "prompt": texts[0]["text"] if texts else ""}
            loras = [model["file"] for model in models[1:]] + [text["text"] for text in texts[1:]]
        else:
            loras = [_model_name(lora) for lora in data.get("loras") or []]
            combo = {"name": note.get("name"), "base_model": data.get("baseModel") or "",
                     "main_model": _model_name(data.get("mainModel")), "loras": loras,
                     "prompt": _text(data.get("promptEn"), 800)}
        if not _matches(terms, combo["name"], combo["main_model"], combo["prompt"], " ".join(loras)):
            continue
        found.append(combo)
    return {"total_matches": len(found), "combos": found[:_limit(limit)]}


def list_workflows(query="", limit=20):
    terms, found = _terms(query), []
    for recipe in _list_recipes(get_recipes_dir()):
        data = recipe.get("data") or {}
        params = json.dumps(data.get("params") or {}, ensure_ascii=False)
        if not _matches(terms, data.get("name"), " ".join(data.get("tags") or []), data.get("notes"), params):
            continue
        found.append({"name": data.get("name") or recipe["filename"], "tags": data.get("tags") or [],
                      "notes": _text(data.get("notes"), 500), "saved": _when((data.get("timestamp") or 0) / 1000),
                      "settings": params if len(params) <= MAX_TEXT else params[:MAX_TEXT] + "…"})
    return {"total_matches": len(found), "workflows": found[:_limit(limit)]}


def list_saved_prompts(query="", limit=20):
    terms, found = _terms(query), []
    directory = get_materials_dir()
    for summary in _list_materials(directory):
        if summary.get("kind") != "prompt_plan" or summary.get("moved_to_recipe"):
            continue
        try:
            plan = _read_material(os.path.join(directory, summary["filename"])).get("plan") or {}
        except (OSError, ValueError, KeyError):
            continue
        prompt = {"name": summary.get("name"), "tags": summary.get("tags") or [],
                  "positive": _text(plan.get("positive"), 1200), "negative": _text(plan.get("negative"), 600)}
        if _matches(terms, prompt["name"], " ".join(prompt["tags"]), prompt["positive"], prompt["negative"]):
            found.append(prompt)
    return {"total_matches": len(found), "prompts": found[:_limit(limit)]}


def recent_activity(limit=20, source=""):
    entries = list_entries(_limit(limit), source if source in ("canvas", "file") else None)
    return {"entries": [{"time": _when(entry.get("time")), "source": entry.get("source"), "action": entry.get("action"),
                         "target": entry.get("target") or "", "detail": entry.get("detail") or {}} for entry in entries]}


# ---------------------------------------------------------------- registry

def _schema(properties=None, required=()):
    schema = {"type": "object", "properties": properties or {}, "additionalProperties": False}
    if required:
        schema["required"] = list(required)
    return schema


_QUERY = {"type": "string", "description": "Words that must all appear (case-insensitive); empty lists everything."}
_LIMIT = {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "default": 20}


def _tool(name, title, description, run, properties=None, required=()):
    return name, {"run": run, "spec": {
        "name": name, "title": title, "description": description,
        "inputSchema": _schema(properties, required),
        "annotations": {"title": title, "readOnlyHint": True, "destructiveHint": False,
                        "idempotentHint": True, "openWorldHint": False},
    }}


TOOLS = dict([
    _tool("library_overview", "Library overview",
          "How many models of each type and base model the user has, how many are scanned, and how many "
          "combos, workflow recipes and saved prompts they kept. A good first call.", library_overview),
    _tool("search_models", "Search models",
          "Find model files (checkpoints, LoRAs, VAEs…) by name, trigger word or base model. Returns model_id for get_model.",
          search_models, {
              "query": _QUERY,
              "type": {"type": "string", "description": "ComfyUI models folder, e.g. checkpoints, loras, vae, diffusion_models."},
              "base_model": {"type": "string", "description": "Part of the base model name, e.g. SDXL, Pony, Flux, SD 1.5."},
              "source": {"type": "string", "enum": ["civitai", "inferred_from_file", "not_scanned"],
                         "description": "Where the model's information came from."},
              "limit": _LIMIT}),
    _tool("get_model", "Model details",
          "Everything known about one model: Civitai name and link, trigger words, base model, description, "
          "the user's own name and notes. include_cover attaches its cover picture.",
          get_model, {"model_id": {"type": "string", "description": "From search_models."},
                      "include_cover": {"type": "boolean", "default": False}}, ["model_id"]),
    _tool("scan_report", "Scan status",
          "Which models are matched on Civitai, which are not and why, which were never scanned, and what the last scan did.",
          scan_report),
    _tool("search_images", "Search output images",
          "Find images ComfyUI generated, newest first, by words in their prompt, model or settings (e.g. a LoRA "
          "name or 'seed:123'). Returns image paths for get_image_info.",
          search_images, {"query": _QUERY, "limit": _LIMIT, "page": {"type": "integer", "minimum": 1, "default": 1}}),
    _tool("get_image_info", "Image generation settings",
          "The nodes and settings that produced an output image (prompts, models, seed, sampler…) and whether the "
          "user kept it as a recipe, combo or prompt. include_image attaches a 512 px copy.",
          get_image_info, {"image": {"type": "string", "description": "From search_images, e.g. 'ComfyUI_00012_.png'."},
                           "include_image": {"type": "boolean", "default": False}}, ["image"]),
    _tool("list_combos", "Combos",
          "The user's combos (搭配): a main model, LoRAs and a prompt kept together, or (kind \"node "
          "structure\") model nodes and text nodes saved from the canvas with their links, listed by slot.", list_combos,
          {"query": _QUERY, "limit": _LIMIT}),
    _tool("list_workflows", "Workflow recipes",
          "The user's saved workflow recipes with tags, notes and their main settings.", list_workflows,
          {"query": _QUERY, "limit": _LIMIT}),
    _tool("list_saved_prompts", "Saved prompts",
          "Prompts the user saved in the Prompt Studio, with positive and negative text.", list_saved_prompts,
          {"query": _QUERY, "limit": _LIMIT}),
    _tool("search_audio", "Generated audio",
          "Speech the user generated (Anomalous TTS), newest first, with its text, voice and seed.", search_audio,
          {"query": _QUERY, "limit": _LIMIT}),
    _tool("recent_activity", "Activity log",
          "What Anomalous changed recently, newest first: canvas edits it made and files it saved, scanned or deleted.",
          recent_activity, {"limit": _LIMIT, "source": {"type": "string", "enum": ["canvas", "file"]}}),
])


def call_tool(tools, name, arguments, ctx=None):
    """An MCP tools/call result for tool `name` of `tools` (run in a worker thread). Tools marked
    `context` get `ctx` ({base_url} of this server) first."""
    tool = tools[name]
    spec = tool["spec"]["inputSchema"]
    unknown = set(arguments) - set(spec["properties"])
    missing = [key for key in spec.get("required", []) if key not in arguments]
    if unknown or missing:
        return _failure(f"Unknown arguments {sorted(unknown)}" if unknown else f"Missing arguments {missing}")
    try:
        value = tool["run"](ctx, **arguments) if tool.get("context") else tool["run"](**arguments)
    except ToolError as error:
        return _failure(str(error))
    except Exception as error:  # noqa: BLE001 - an AI app gets a readable failure, never a dropped request
        logging.getLogger(__name__).warning("Anomalous MCP tool %s failed", name, exc_info=True)
        return _failure(f"{name} failed: {error}")
    data, extra = value if isinstance(value, tuple) else (value, [])
    return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}, *extra],
            "structuredContent": data, "isError": False}


def _failure(message):
    return {"content": [{"type": "text", "text": message}], "isError": True}
