import os
import json
import time
import uuid
import hashlib
from aiohttp import web
import folder_paths
from .utils import require_filename, resolve_within
from .recipes import _clean_volatile_params, _parameter_signature, _parameter_gallery_images

def get_parameters_dir():
    # Store parameter notebooks in the user directory
    # ComfyUI/user/default/workflows/anomalous_parameters
    user_dir = folder_paths.get_user_directory()
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
    notebooks = []
    try:
        for filename in os.listdir(parameters_dir):
            if filename.endswith(".json"):
                file_path = os.path.join(parameters_dir, filename)
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        notebooks.append({
                            "filename": filename,
                            "name": data.get("name", "Untitled Parameter Notebook"),
                            "data": data,
                            "timestamp": data.get("timestamp", 0)
                        })
                except Exception:
                    continue
    except OSError:
        pass
    
    # Sort newest first
    notebooks.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
    return web.json_response({"notebooks": notebooks})

async def api_save_parameter(request):
    try:
        data = await request.json()
    except (ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid parameter data"}, status=400)
        
    filename = f"params_{int(time.time())}_{uuid.uuid4().hex[:8]}.json"
    
    # Generate parameter signature from workflow
    data["parameter_signature"] = _parameter_signature(data.get("workflow"))
    data["timestamp"] = int(time.time() * 1000)
    
    try:
        parameters_dir = get_parameters_dir()
        file_path = os.path.join(parameters_dir, filename)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
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
            file_path = os.path.join(parameters_dir, filename)
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            fingerprint = data.get("parameter_signature", {}).get("value")
            if not fingerprint:
                fingerprint = _parameter_signature(data.get("workflow"))["value"]
        elif not isinstance(fingerprint, str) or not len(fingerprint) == 64:
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
