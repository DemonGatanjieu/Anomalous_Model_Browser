import asyncio
import hashlib
import json
import logging
import os
import threading

from aiohttp import web
import folder_paths
from .utils import atomic_write_json, require_filename, resolve_within


MAX_NOTEBOOK_BYTES = 2 * 1024 * 1024
LEGACY_NOTEBOOKS_DIR = os.path.join(os.path.dirname(__file__), "notebooks")
_notebooks_lock = threading.RLock()


def _read_notebook(path):
    if os.path.getsize(path) > MAX_NOTEBOOK_BYTES:
        raise ValueError("Notebook is too large")
    with open(path, encoding="utf-8") as source:
        data = json.load(source)
    if not isinstance(data, dict):
        raise ValueError("Invalid notebook")
    return data


def _migrate_notebooks(directory):
    marker = resolve_within(directory, ".legacy_imported.json")
    if os.path.exists(marker):
        return
    skipped = []
    if os.path.isdir(LEGACY_NOTEBOOKS_DIR):
        for filename in sorted(os.listdir(LEGACY_NOTEBOOKS_DIR)):
            if not filename.endswith(".json") or filename.startswith("."):
                continue
            try:
                source = resolve_within(LEGACY_NOTEBOOKS_DIR, require_filename(filename))
                data = _read_notebook(source)
            except (OSError, ValueError):
                skipped.append(filename)
                logging.warning("Anomalous: could not migrate notebook %s; original preserved", filename)
                continue
            target = resolve_within(directory, filename)
            if os.path.exists(target):
                try:
                    if _read_notebook(target) == data:
                        continue
                except (OSError, ValueError):
                    pass
                digest = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:12]
                recovered = f"{os.path.splitext(filename)[0][:100]}_legacy_{digest}.json"
                target = resolve_within(directory, recovered)
                if os.path.exists(target):
                    if _read_notebook(target) != data:
                        raise ValueError("Conflicting migrated notebook")
                    continue
            atomic_write_json(target, data, MAX_NOTEBOOK_BYTES)
    atomic_write_json(marker, {"version": 1, "skipped": skipped})


def get_notebooks_dir():
    user_dir = folder_paths.get_user_directory()
    directory = os.path.join(user_dir, "workflows", "anomalous_notebooks")
    os.makedirs(directory, exist_ok=True)
    with _notebooks_lock:
        _migrate_notebooks(directory)
    return directory


def _list_notebooks():
    with _notebooks_lock:
        directory = get_notebooks_dir()
        notebooks = []
        for filename in sorted(os.listdir(directory)):
            if not filename.endswith(".json") or filename.startswith("."):
                continue
            try:
                data = _read_notebook(resolve_within(directory, filename))
                notebooks.append({"filename": filename, "name": data.get("name", filename[:-5]), "data": data})
            except (OSError, ValueError):
                continue
        return notebooks


async def api_get_notebooks(request):
    try:
        notebooks = await asyncio.to_thread(_list_notebooks)
        return web.json_response({"notebooks": notebooks})
    except (OSError, ValueError):
        return web.json_response({"status": "error", "message": "Could not load notebooks"}, status=500)


def _save_notebook(filename, data):
    with _notebooks_lock:
        atomic_write_json(resolve_within(get_notebooks_dir(), filename), data, MAX_NOTEBOOK_BYTES)


async def api_save_notebook(request):
    try:
        payload = await request.json()
        filename = require_filename(payload.get("filename", ""))
        if filename.startswith("."):
            raise ValueError("Invalid notebook filename")
        if not filename.endswith(".json"):
            filename += ".json"
        data = payload.get("data")
        if not isinstance(data, dict):
            raise ValueError("Invalid notebook")
        await asyncio.to_thread(_save_notebook, filename, data)
        return web.json_response({"status": "success"})
    except (AttributeError, TypeError, ValueError):
        return web.json_response({"status": "error", "message": "Invalid notebook"}, status=400)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not save notebook"}, status=500)


def _delete_notebook(filename):
    with _notebooks_lock:
        os.remove(resolve_within(get_notebooks_dir(), filename))


async def api_delete_notebook(request):
    try:
        payload = await request.json()
        filename = require_filename(payload.get("filename", ""))
        if not filename.endswith(".json") or filename.startswith("."):
            raise ValueError("Invalid notebook filename")
        await asyncio.to_thread(_delete_notebook, filename)
        return web.json_response({"status": "success"})
    except (AttributeError, TypeError, ValueError):
        return web.json_response({"status": "error", "message": "Invalid notebook"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Notebook not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not delete notebook"}, status=500)
