"""The Material Library's "Recent" shelf (GET /anomalous/recent_generations): the newest
output PNGs that carry a ComfyUI workflow, each with what made it (start of the positive
prompt, model, sampler settings) and the material it already is, if any (its summary). Starring one goes
through /anomalous/save_image_material, which matches images by their SHA256 the same way."""

import asyncio
import hashlib
import json
import os
import threading

from aiohttp import web
import folder_paths

from .gallery_routes import _gallery_listing
from .image_search import read_png_text
from .material_schema import _extract_workflow_params, _prompt_groups_from_roles, _prompt_roles_for_workflow
from .material_store import _list_materials, get_materials_dir

MAX_LIMIT = 60
SCAN_LIMIT = 400  # newest images looked at; older ones are in the gallery
MAX_CACHED = 2000
MODEL_EXTENSIONS = (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf", ".sft")
SHOWN_PARAMS = ("steps", "cfg", "sampler_name", "resolution")
MAIN_LOADER_WORDS = ("checkpoint", "unet", "diffusion")

_cache = {}  # path -> (mtime, size, summary or None)
_cache_lock = threading.Lock()


def _model_name(workflow):
    """The main model: a checkpoint or diffusion-model loader's file, else the first model file."""
    found = []
    for node in workflow.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        main = any(word in str(node.get("type") or "").lower() for word in MAIN_LOADER_WORDS)
        for value in node.get("widgets_values") or []:
            if isinstance(value, str) and value.lower().endswith(MODEL_EXTENSIONS):
                found.append((not main, os.path.basename(value.replace("\\", "/"))))
    return min(found, key=lambda item: item[0])[1] if found else ""


def _file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _read_summary(path):
    """What made the image, or None when it carries no UI workflow."""
    raw = read_png_text(path).get("workflow")
    try:
        workflow = json.loads(raw) if raw else None
    except ValueError:
        return None
    if not isinstance(workflow, dict) or not isinstance(workflow.get("nodes"), list):
        return None
    params, prompts = _extract_workflow_params(workflow)
    positive = _prompt_groups_from_roles(workflow, _prompt_roles_for_workflow(workflow))["positive"]
    prompt = (positive or prompts or [""])[0]
    return {
        "prompt": " ".join(prompt.split())[:200],
        "model": _model_name(workflow),
        "params": {key: params[key] for key in SHOWN_PARAMS if key in params},
        "sha256": _file_sha256(path),
    }


def _summary(path, mtime):
    size = os.path.getsize(path)
    with _cache_lock:
        hit = _cache.get(path)
    if hit and hit[0] == mtime and hit[1] == size:
        return hit[2]
    summary = _read_summary(path)
    with _cache_lock:
        if len(_cache) >= MAX_CACHED:
            _cache.clear()
        _cache[path] = (mtime, size, summary)
    return summary


def _recent(limit, query):
    output_dir = folder_paths.get_output_directory()
    starred = {item["source_sha256"]: item for item in _list_materials(get_materials_dir())
               if item.get("kind") == "image_workflow_snapshot" and item.get("source_sha256")}
    items = []
    for image in _gallery_listing(output_dir, False, query)[:SCAN_LIMIT]:
        if not image["filename"].lower().endswith(".png"):
            continue
        try:
            summary = _summary(os.path.join(output_dir, image["subfolder"], image["filename"]), image["mtime"])
        except OSError:
            continue
        if not summary:
            continue
        items.append({
            "filename": image["filename"], "subfolder": image["subfolder"], "mtime": image["mtime"],
            "prompt": summary["prompt"], "model": summary["model"], "params": summary["params"],
            "material": starred.get(summary["sha256"]),
        })
        if len(items) >= limit:
            break
    return items


async def api_recent_generations(request):
    """GET /anomalous/recent_generations?limit&term=..|q - newest images with a workflow."""
    try:
        limit = min(MAX_LIMIT, max(1, int(request.query.get("limit", 24))))
    except ValueError:
        return web.json_response({"error": "Invalid limit"}, status=400)
    terms = [term for term in request.query.getall("term", []) if term.strip()]
    query = terms or request.query.get("q", "").strip()
    try:
        items = await asyncio.to_thread(_recent, limit, query)
    except OSError:
        return web.json_response({"error": "Could not list recent images"}, status=500)
    return web.json_response({"items": items})
