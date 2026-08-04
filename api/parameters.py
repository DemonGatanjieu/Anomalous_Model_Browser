import asyncio
import os
import json
import tempfile
import time
import uuid
import re
from aiohttp import web
import folder_paths
from .utils import require_filename, resolve_within
from .recipes import MAX_RECIPE_BYTES, _parameter_signature, _parameter_gallery_images

def get_parameters_dir():
    # Store parameter notebooks in the user directory
    # ComfyUI/user/default/workflows/anomalous_parameters
    user_dir = (
        folder_paths.get_user_directory()
        if hasattr(folder_paths, "get_user_directory")
        else None
    )
    if not user_dir:
        # Fallback if user_dir is not supported in this ComfyUI version
        base_dir = folder_paths.base_path
        user_dir = os.path.join(base_dir, "user", "default")
    
    workflows_dir = os.path.join(user_dir, "workflows")
    parameters_dir = os.path.join(workflows_dir, "anomalous_parameters")
    
    if not os.path.exists(parameters_dir):
        os.makedirs(parameters_dir, exist_ok=True)
    return parameters_dir



async def api_get_parameters(request):
    parameters_dir = get_parameters_dir()
    notebooks = await asyncio.to_thread(_read_parameter_notebooks, parameters_dir)
    return web.json_response({"notebooks": notebooks})


def _read_parameter_notebooks(parameters_dir):
    notebooks = []
    try:
        filenames = os.listdir(parameters_dir)
    except OSError:
        return notebooks
    for filename in filenames:
        if not filename.endswith(".json"):
            continue
        file_path = resolve_within(parameters_dir, filename)
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                continue
            notebooks.append({
                "filename": filename,
                "name": data.get("name", "Untitled Parameter Notebook"),
                "data": data,
                "timestamp": data.get("timestamp", 0),
            })
        except (OSError, ValueError, json.JSONDecodeError):
            continue
    notebooks.sort(key=lambda item: item.get("timestamp", 0), reverse=True)
    return notebooks

async def api_save_parameter(request):
    try:
        data = await request.json()
    except (ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid parameter data"}, status=400)
        
    if not isinstance(data, dict) or not isinstance(data.get("workflow"), dict):
        return web.json_response({"status": "error", "message": "Invalid parameter workflow"}, status=400)

    filename = f"params_{int(time.time())}_{uuid.uuid4().hex[:8]}.json"
    data["parameter_signature"] = _parameter_signature(data["workflow"])
    data["timestamp"] = int(time.time() * 1000)
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_RECIPE_BYTES:
        return web.json_response({"status": "error", "message": "Parameter notebook is too large"}, status=413)
    
    try:
        parameters_dir = get_parameters_dir()
        file_path = resolve_within(parameters_dir, filename)
        fd, temp_path = tempfile.mkstemp(prefix=".parameter-", suffix=".tmp", dir=parameters_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
                f.flush()
                os.fsync(f.fileno())
            os.replace(temp_path, file_path)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not save parameter notebook"}, status=500)
        
    return web.json_response({"status": "success", "filename": filename})

async def api_delete_parameter(request):
    try:
        data = await request.json()
        filename = require_filename(data.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid filename")
    except (ValueError, AttributeError):
        return web.json_response({"status": "error", "message": "Invalid filename"}, status=400)
        
    try:
        parameters_dir = get_parameters_dir()
        file_path = resolve_within(parameters_dir, filename)
        if os.path.exists(file_path):
            os.remove(file_path)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not delete parameter notebook"}, status=500)
        
    return web.json_response({"status": "success"})

async def api_get_parameter_gallery(request):
    """Find recent output PNGs whose embedded parameters match one parameter notebook."""
    try:
        filename = request.query.get("filename")
        fingerprint = request.query.get("fingerprint")
        if filename:
            filename = require_filename(filename)
            if not filename.endswith(".json"):
                raise ValueError("Invalid parameter notebook")
            parameters_dir = get_parameters_dir()
            file_path = resolve_within(parameters_dir, filename)
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            fingerprint = data.get("parameter_signature", {}).get("value")
            if not fingerprint:
                fingerprint = _parameter_signature(data.get("workflow"))["value"]
        elif not isinstance(fingerprint, str) or not re.fullmatch(r"[0-9a-f]{64}", fingerprint, re.IGNORECASE):
            raise ValueError("Invalid fingerprint")
            
        images, scanned = await asyncio.to_thread(_parameter_gallery_images, fingerprint.lower())
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid parameter gallery request"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read parameter gallery"}, status=500)
        
    return web.json_response({
        "status": "success",
        "fingerprint": fingerprint.lower(),
        "match_mode": "params",
        "images": images,
        "scanned": scanned,
    })
