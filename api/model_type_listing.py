"""One model type as a single list: a models folder and all its subfolders (the models page's type chips).

Listing a type also queues its covers' card images for the background (media_routes).
"""

import asyncio
import os
import urllib.parse

from aiohttp import web
import folder_paths

from .model_catalog import _collect_folder_models
from .media_routes import queue_card_images


def _collect_type_models(folder_type, path_idx):
    """Every model under one registered models folder, folder by folder in name order."""
    try:
        base_dir = folder_paths.get_folder_paths(folder_type)[path_idx]
    except Exception:
        return []
    if not os.path.isdir(base_dir):
        return []
    models = []
    for root, dirs, _files in os.walk(base_dir):
        dirs.sort(key=str.lower)
        rel = os.path.relpath(root, base_dir).replace('\\', '/')
        models += _collect_folder_models(root, folder_type, path_idx, '' if rel == '.' else rel, 1, 0)["models"]
    return models


async def api_get_type_models(request):
    """GET /anomalous/type_models?type&path_idx - {models, total}; each model names its own subfolder."""
    try:
        path_idx = int(request.query.get('path_idx', 0))
    except ValueError:
        path_idx = -1
    if path_idx < 0:
        return web.json_response({"status": "error", "message": "Invalid path_idx"}, status=400)
    models = await asyncio.to_thread(_collect_type_models, request.query.get('type', ''), path_idx)
    queue_card_images(_cover_paths(models))
    return web.json_response({"models": models, "total": len(models)})


def _cover_paths(models):
    """The cover file of each listed model: it sits beside the model, named in its preview URL."""
    paths = []
    for model in models:
        query = urllib.parse.urlparse(model.get("preview_url") or "").query
        name = urllib.parse.parse_qs(query).get("filename", [""])[0]
        if name and model.get("file_path"):
            paths.append(os.path.join(os.path.dirname(model["file_path"]), name))
    return paths
