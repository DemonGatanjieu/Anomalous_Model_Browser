"""Where ComfyUI-Manager's model list says a model file comes from, for Model Check's downloads
(download_sources.find_source). The list (model-list.json, a few hundred common models: base
models, VAEs, text encoders, upscalers, ControlNets… mostly on Hugging Face) is read from the
Manager installed here; without it there is nothing to find. A list entry is only a file of the
same name: download_sources checks it against the workflow's fingerprint, or offers it as such.
"""

import importlib.util
import json
import os

import folder_paths

# The list's model types and save paths -> ComfyUI folder types.
TYPE_FOLDERS = {
    "checkpoint": "checkpoints", "checkpoints": "checkpoints", "lora": "loras", "loras": "loras",
    "vae": "vae", "taesd": "vae_approx", "vae_approx": "vae_approx", "clip": "text_encoders",
    "text_encoders": "text_encoders", "clip_vision": "clip_vision", "unet": "diffusion_models",
    "diffusion_model": "diffusion_models", "diffusion_models": "diffusion_models", "controlnet": "controlnet",
    "upscale": "upscale_models", "upscale_models": "upscale_models", "embeddings": "embeddings",
    "embedding": "embeddings", "gligen": "gligen", "style_models": "style_models",
}
# ComfyUI's older names for the same folders.
SAME_FOLDER = {"unet": "diffusion_models", "clip": "text_encoders"}

_cache = {"path": "", "mtime": 0.0, "index": {}}


def list_path():
    """The Manager's model-list.json on this computer, or ''."""
    roots = []
    try:
        roots = list(folder_paths.get_folder_paths("custom_nodes") or [])
    except Exception:
        pass
    for root in roots:
        try:
            names = sorted(os.listdir(root))
        except OSError:
            continue
        for name in names:
            path = os.path.join(root, name, "model-list.json")
            if "manager" in name.lower() and os.path.isfile(path):
                return path
    try:  # the Manager installed as a Python package
        spec = importlib.util.find_spec("comfyui_manager")
        for location in (spec.submodule_search_locations or []) if spec else []:
            path = os.path.join(location, "model-list.json")
            if os.path.isfile(path):
                return path
    except (ImportError, ValueError):
        pass
    return ""


def _folder(entry):
    path = str(entry.get("save_path") or "").replace("\\", "/").strip("/")
    first = path.split("/")[0].lower() if path and path != "default" else ""
    return TYPE_FOLDERS.get(first) or TYPE_FOLDERS.get(str(entry.get("type") or "").lower(), "")


def _index():
    path = list_path()
    if not path:
        return {}
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return {}
    if path != _cache["path"] or mtime != _cache["mtime"]:
        index = {}
        try:
            with open(path, encoding="utf-8") as source:
                models = json.load(source).get("models") or []
        except (OSError, ValueError, AttributeError):
            models = []
        for entry in models:
            if not isinstance(entry, dict) or not entry.get("filename") or not str(entry.get("url", "")).startswith("https://"):
                continue
            index.setdefault(str(entry["filename"]).lower(), []).append({
                "name": str(entry.get("name") or entry["filename"]), "url": entry["url"],
                "folder": _folder(entry), "base": str(entry.get("base") or ""),
            })
        _cache.update(path=path, mtime=mtime, index=index)
    return _cache["index"]


def candidates(file_name, folder_type=""):
    """The list's entries for a file of this name (any case) that fit `folder_type`, one per URL."""
    wanted = SAME_FOLDER.get(folder_type, folder_type)
    seen, found = set(), []
    for entry in _index().get(os.path.basename(str(file_name)).lower(), []):
        if wanted and entry["folder"] and SAME_FOLDER.get(entry["folder"], entry["folder"]) != wanted:
            continue
        if entry["url"] not in seen:
            seen.add(entry["url"])
            found.append(entry)
    return found
