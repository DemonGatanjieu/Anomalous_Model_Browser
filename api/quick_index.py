"""Every model file in a few words, for the canvas's quick search (GET /anomalous/quick_index,
web/modules/quick_search_data.js): its folder type, place and file, the name it shows, its
base model, a few trigger words and its cover's URL. Read once when the search bar opens;
the bar keeps it a little while. Files a folder type shares with another (unet and
diffusion_models) are listed once; node packs' own files are not models."""

import asyncio

from aiohttp import web

from .model_catalog import _collect_all_scan_models

MAX_WORDS = 6


def _words(meta):
    words = meta.get("trainedWords") or meta.get("trigger_words") or []
    if isinstance(words, str):
        words = [words]
    return [str(word) for word in words if str(word).strip()][:MAX_WORDS]


def compact_models(models):
    """`models` (the shape GET /anomalous/all_scan_models gives) in a few words each."""
    seen, found = set(), []
    for model in models:
        if model.get("type") == "custom_nodes":
            continue
        key = (model.get("subfolder") or "", model.get("filename"), model.get("size_bytes"))
        if key in seen:
            continue
        seen.add(key)
        meta = model.get("metadata") or {}
        found.append({
            "type": model.get("type"),
            "path_idx": model.get("path_idx", 0),
            "subfolder": model.get("subfolder") or "",
            "filename": model.get("filename"),
            "name": str(meta.get("custom_name") or "").strip(),
            "civitai_name": str(meta.get("name") or "").strip(),
            "base": str(meta.get("baseModel") or "").strip(),
            "words": _words(meta),
            "preview_url": model.get("preview_url") or "",
        })
    return found


async def api_quick_index(request):
    payload = await asyncio.to_thread(_collect_all_scan_models, 1, 0)
    return web.json_response({"models": compact_models(payload.get("models") or [])})
