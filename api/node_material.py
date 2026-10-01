"""Saving one canvas node's current values as a parameter material (the current-node panel's "save")."""

import asyncio
import hashlib
import json
import time
import uuid

from aiohttp import web

from . import materials
from .material_schema import MAX_MATERIAL_NAME_LENGTH, _material_summary, _normalise_material_tags
from .notebooks import MAX_NOTEBOOK_BYTES


def _node_material(payload):
    node = payload.get("node")
    if not isinstance(node, dict):
        raise ValueError("Invalid node")
    node_type = node.get("type")
    if not isinstance(node_type, str) or not node_type.strip() or len(node_type) > 200:
        raise ValueError("Invalid node type")
    values = node.get("widgets_values")
    if not isinstance(values, list) or not values:
        raise ValueError("Invalid node values")
    encoded = json.dumps([node_type, values], ensure_ascii=False, allow_nan=False, sort_keys=True)
    if len(encoded.encode("utf-8")) > MAX_NOTEBOOK_BYTES:
        raise ValueError("Node values are too large")
    title = node.get("title") if isinstance(node.get("title"), str) else ""
    title = title.strip()[:200] or node_type
    name = payload.get("name") or title
    if not isinstance(name, str) or not (name := name.strip()) or len(name) > MAX_MATERIAL_NAME_LENGTH:
        raise ValueError("Invalid material name")
    return {
        "schema_version": materials.MATERIAL_SCHEMA_VERSION,
        "id": uuid.uuid4().hex,
        "kind": "node_parameter_selection",
        "name": name,
        "tags": _normalise_material_tags(payload.get("tags", [])),
        "timestamp": int(time.time() * 1000),
        "source": {
            "type": "canvas_node",
            "parameter_name": title,
            "parameter_signature": hashlib.sha256(encoded.encode("utf-8")).hexdigest(),
        },
        "workflow": {"nodes": [{"id": 1, "type": node_type, "title": title, "widgets_values": values}]},
        "selection": {"scope": "nodes", "node_ids": [1]},
        "capabilities": ["apply_node_parameters"],
    }


async def api_save_node_material(request):
    try:
        material = _node_material(await request.json())
    except (AttributeError, TypeError, ValueError):
        return web.json_response({"status": "error", "message": "Invalid node material"}, status=400)
    filename = f"material_{int(time.time())}_{material['id']}.json"
    try:
        duplicate = await asyncio.to_thread(
            materials._persist_parameter_material, materials.get_materials_dir(), filename, material, False)
    except (OSError, ValueError):
        return web.json_response({"status": "error", "message": "Could not save node material"}, status=500)
    if duplicate:
        return web.json_response({"status": "duplicate", "filename": duplicate["filename"], "name": duplicate["name"]}, status=409)
    return web.json_response({"status": "success", "filename": filename, "material": _material_summary(filename, material)})
