"""Shows a model file in this computer's file manager: Explorer or Finder with the file
selected, the folder on Linux. The request names the model the way the browser lists it
(type, folder index, subfolder, file name), never a path, and local_guard lets only this
computer ask (it is a POST)."""
import os
import subprocess
import sys

from aiohttp import web

from .utils import require_filename, resolve_folder_subdir, resolve_within


def _reveal(path):
    if sys.platform == "win32":
        subprocess.Popen(f'explorer /select,"{path}"')
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(path)])


async def api_open_model_folder(request):
    try:
        data = await request.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        return web.json_response({"status": "error", "message": "Invalid request body"}, status=400)
    try:
        filename = require_filename(data.get("filename", ""))
        _, folder = resolve_folder_subdir(data.get("type", ""), int(data.get("path_idx", 0)), data.get("subfolder", "/"))
        path = resolve_within(folder, filename)
    except (ValueError, KeyError, TypeError):
        return web.json_response({"status": "error", "message": "Invalid request parameters"}, status=400)
    if not os.path.isfile(path):
        return web.json_response({"status": "error", "message": "Model file not found"}, status=404)
    try:
        _reveal(path)
    except OSError as error:
        return web.json_response({"status": "error", "message": str(error)}, status=500)
    return web.json_response({"status": "success"})
