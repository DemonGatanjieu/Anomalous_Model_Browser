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
from .recipes import MAX_RECIPE_BYTES, _parameter_signature, _parameter_gallery_images, get_recipes_dir, _read_recipe

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
    try:
        recipe_filename = request.query.get("recipe_filename")
        if recipe_filename:
            recipe_filename = require_filename(recipe_filename)
            if not recipe_filename.endswith(".json"):
                raise ValueError("Invalid recipe filename")
    except (AttributeError, ValueError):
        return web.json_response({"status": "error", "message": "Invalid recipe filename"}, status=400)
    parameters_dir = get_parameters_dir()
    notebooks = await asyncio.to_thread(_read_parameter_notebooks, parameters_dir, recipe_filename)
    return web.json_response({"notebooks": notebooks})


_parameter_notebooks_cache = None
_parameter_notebooks_cache_time = 0

def _invalidate_parameter_notebooks_cache():
    global _parameter_notebooks_cache, _parameter_notebooks_cache_time
    _parameter_notebooks_cache = None
    _parameter_notebooks_cache_time = 0

def _prompt_role_for_node(node, params):
    """Return an explicit role, or conservatively recover one from legacy values."""
    if not isinstance(node, dict) or not isinstance(params, dict):
        return None
    allowed_roles = {"positive", "negative", "both", "ignored", "unknown"}
    node_id = node.get("id")
    overrides = params.get("promptRoleOverrides")
    if isinstance(overrides, dict):
        override = overrides.get(str(node_id))
        if override is None:
            override = overrides.get(node_id)
        if isinstance(override, dict) and override.get("role") in allowed_roles:
            expected_type = override.get("nodeType")
            if not expected_type or expected_type == node.get("type"):
                return override["role"]

    summaries = params.get("nodes")
    if isinstance(summaries, list):
        for summary in summaries:
            if not isinstance(summary, dict) or str(summary.get("id")) != str(node_id):
                continue
            if summary.get("role") in allowed_roles:
                return summary["role"]
            break

    values = node.get("widgets_values")
    if not isinstance(values, list) or not values:
        return None
    value = values[0]
    positive_values = params.get("promptPositive", [])
    negative_values = params.get("promptNegative", [])
    positive = set(item for item in positive_values if isinstance(item, str)) if isinstance(positive_values, list) else set()
    negative = set(item for item in negative_values if isinstance(item, str)) if isinstance(negative_values, list) else set()
    if value in negative and value not in positive:
        return "negative"
    if value in positive and value not in negative:
        return "positive"
    return None

def _get_all_notebooks_cached(parameters_dir, force_refresh=False):
    global _parameter_notebooks_cache, _parameter_notebooks_cache_time
    # Cache for 2 seconds to prevent rapid disk I/O on UI interactions
    if not force_refresh and _parameter_notebooks_cache is not None and time.time() - _parameter_notebooks_cache_time < 2.0:
        return _parameter_notebooks_cache
    notebooks = _read_parameter_notebooks(parameters_dir)
    _parameter_notebooks_cache = notebooks
    _parameter_notebooks_cache_time = time.time()
    return notebooks

async def api_get_parameters_by_type(request):
    try:
        node_type = request.query.get("type")
        if not node_type:
            raise ValueError("Missing node type")
    except ValueError:
        return web.json_response({"status": "error", "message": "Missing node type"}, status=400)
    
    parameters_dir = get_parameters_dir()
    force_refresh = request.query.get("refresh") == "1"
    notebooks = await asyncio.to_thread(_get_all_notebooks_cached, parameters_dir, force_refresh)
    
    # Filter and extract node data
    # Structure: [ { "recipe_filename": ..., "notebooks": [ { "name": ..., "nodes": [...] } ] } ]
    
    grouped = {}
    for nb in notebooks:
        workflow = nb.get("data", {}).get("workflow")
        if not isinstance(workflow, dict):
            continue
            
        nodes = workflow.get("nodes", [])
        if not isinstance(nodes, list):
            continue
            
        matched_nodes = []
        for n in nodes:
            if not isinstance(n, dict):
                continue
            if n.get("type") == node_type:
                matched_nodes.append({
                    "id": n.get("id"),
                    "title": n.get("title") or n.get("type"),
                    "type": n.get("type"),
                    "widgets_values": n.get("widgets_values", []),
                    "role": _prompt_role_for_node(n, nb.get("data", {}).get("params")),
                })
        
        if not matched_nodes:
            continue
            
        recipe_fn = nb.get("data", {}).get("recipe_filename") or "unbound"
        if recipe_fn not in grouped:
            grouped[recipe_fn] = []
            
        grouped[recipe_fn].append({
            "filename": nb.get("filename"),
            "name": nb.get("name"),
            "timestamp": nb.get("timestamp"),
            "nodes": matched_nodes
        })
        
    recipes_dir = get_recipes_dir()
    recipe_name_cache = {}
    recipe_role_cache = {}

    result = []
    for r_fn, nbs in grouped.items():
        recipe_roles = {}
        if r_fn == "unbound":
            human_name = "Unbound"
        else:
            if r_fn not in recipe_name_cache:
                try:
                    r_data = _read_recipe(resolve_within(recipes_dir, r_fn))
                    recipe_name_cache[r_fn] = r_data.get("name") if r_data else r_fn
                    recipe_params = r_data.get("params") if isinstance(r_data, dict) else None
                    if r_data and isinstance(recipe_params, dict):
                        role_map = {}
                        workflow = r_data.get("workflow")
                        workflow_nodes = workflow.get("nodes", []) if isinstance(workflow, dict) else []
                        for n in workflow_nodes:
                            if not isinstance(n, dict) or "id" not in n:
                                continue
                            role = _prompt_role_for_node(n, recipe_params)
                            if role is not None:
                                role_map[n["id"]] = role
                        recipe_role_cache[r_fn] = role_map
                except Exception:
                    recipe_name_cache[r_fn] = r_fn
            human_name = recipe_name_cache[r_fn] or r_fn
            recipe_roles = recipe_role_cache.get(r_fn, {})

        for nb in nbs:
            for n in nb["nodes"]:
                node_id = n.get("id")
                role = recipe_roles.get(node_id)
                if role is None:
                    role = recipe_roles.get(str(node_id))
                if role is None:
                    role = n.get("role")
                if role is not None:
                    n["role"] = role

        result.append({
            "recipe_filename": r_fn,
            "recipe_name": human_name,
            "notebooks": nbs
        })
        
    return web.json_response({"groups": result})

def _read_parameter_notebooks(parameters_dir, recipe_filename=None):
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
            if recipe_filename and data.get("recipe_filename") != recipe_filename:
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

    recipe_filename = data.get("recipe_filename")
    if recipe_filename is not None:
        try:
            recipe_filename = require_filename(recipe_filename)
            if not recipe_filename.endswith(".json"):
                raise ValueError("Invalid recipe filename")
        except (AttributeError, ValueError):
            return web.json_response({"status": "error", "message": "Invalid recipe filename"}, status=400)
        data["recipe_filename"] = recipe_filename

    filename_stem = os.path.splitext(recipe_filename)[0] if recipe_filename else "unbound"
    filename_stem = re.sub(r"[^A-Za-z0-9_-]+", "_", filename_stem)[:64]
    filename = f"params_{filename_stem}_{int(time.time())}_{uuid.uuid4().hex[:8]}.json"
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
        _invalidate_parameter_notebooks_cache()
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
        _invalidate_parameter_notebooks_cache()
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
