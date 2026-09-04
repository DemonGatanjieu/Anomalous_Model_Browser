"""Curated material snapshots built from generated ComfyUI images.

The first material type intentionally stays small: one output image, its exact
embedded UI workflow, and node-sized parameter blocks derived from that
workflow.  Personal material data lives below ComfyUI's user directory.
"""

import asyncio
import copy
import hashlib
import json
import os
import re
import shutil
import tempfile
import time
import uuid

from aiohttp import web
import folder_paths

from .recipes import (
    MAX_RECIPE_BYTES,
    _build_model_references,
    _embedded_workflow_payload,
    _normalise_source_image,
    _output_source_path,
    _recipe_cover_webp_bytes,
    _validate_workflow,
    _volatile_widget_indexes,
)
from .utils import require_filename, resolve_within


MATERIAL_SCHEMA_VERSION = 1
MAX_MATERIAL_NAME_LENGTH = 120
MAX_SOURCE_IMAGE_BYTES = 64 * 1024 * 1024
MODEL_PRIORITY = {"checkpoint": 0, "unet": 1, "lora": 2}


def get_materials_dir():
    user_dir = (
        folder_paths.get_user_directory()
        if hasattr(folder_paths, "get_user_directory")
        else None
    )
    if not user_dir:
        user_dir = os.path.join(folder_paths.base_path, "user", "default")
    materials_dir = os.path.join(user_dir, "workflows", "anomalous_materials")
    os.makedirs(materials_dir, exist_ok=True)
    return materials_dir


def _material_assets_dir(materials_dir, filename, create=False):
    stem = os.path.splitext(require_filename(filename))[0]
    assets_dir = resolve_within(materials_dir, ".assets", stem)
    if create:
        os.makedirs(assets_dir, exist_ok=True)
    return assets_dir


def _atomic_write_json(path, value):
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_RECIPE_BYTES:
        raise ValueError("Material snapshot is too large")
    target_dir = os.path.dirname(path)
    fd, temp_path = tempfile.mkstemp(prefix=".material-", suffix=".tmp", dir=target_dir)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def _read_material(path):
    if os.path.getsize(path) > MAX_RECIPE_BYTES:
        raise ValueError("Material snapshot is too large")
    with open(path, "r", encoding="utf-8") as material_file:
        value = json.load(material_file)
    if not isinstance(value, dict) or not isinstance(value.get("workflow"), dict):
        raise ValueError("Invalid material snapshot")
    return value


def _node_blocks(workflow, include_values=True):
    blocks = []
    occurrences = {}
    for node in workflow.get("nodes", []):
        if not isinstance(node, dict):
            continue
        node_type = str(node.get("type") or "").strip()
        if not node_type:
            continue
        occurrences[node_type] = occurrences.get(node_type, 0) + 1
        block = {
            "node_id": node.get("id"),
            "type": node_type,
            "title": str(node.get("title") or node_type),
            "occurrence": occurrences[node_type],
            "widget_count": len(node.get("widgets_values") or []),
            "volatile_widget_indexes": list(_volatile_widget_indexes(node)),
        }
        if include_values:
            block["widgets_values"] = copy.deepcopy(node.get("widgets_values") or [])
            block["properties"] = copy.deepcopy(node.get("properties") or {})
            if node.get("mode") is not None:
                block["mode"] = node.get("mode")
        blocks.append(block)
    return blocks


def _normalise_selected_node_ids(workflow, raw_node_ids):
    """Validate an optional node selection while preserving workflow ID types."""
    if raw_node_ids is None:
        return None
    if not isinstance(raw_node_ids, list) or not raw_node_ids:
        raise ValueError("Selected material nodes are required")

    workflow_nodes = [node for node in workflow.get("nodes", []) if isinstance(node, dict)]
    existing = {str(node.get("id")): node.get("id") for node in workflow_nodes if node.get("id") is not None}
    selected = []
    seen = set()
    for raw_node_id in raw_node_ids:
        key = str(raw_node_id)
        if key not in existing:
            raise ValueError("Selected material node does not exist")
        if key in seen:
            continue
        seen.add(key)
        selected.append(existing[key])
    if not selected:
        raise ValueError("Selected material nodes are required")
    return selected


def _material_node_ids(material):
    selection = material.get("selection") if isinstance(material, dict) else None
    if not isinstance(selection, dict) or selection.get("scope") != "nodes":
        return None
    node_ids = selection.get("node_ids")
    if not isinstance(node_ids, list):
        return None
    return {str(node_id) for node_id in node_ids}


def _material_node_blocks(material, include_values=True):
    blocks = _node_blocks(material.get("workflow") or {}, include_values=include_values)
    selected_ids = _material_node_ids(material)
    if selected_ids is None:
        return blocks
    return [block for block in blocks if str(block.get("node_id")) in selected_ids]


def _prompt_excerpt(workflow):
    for node in workflow.get("nodes", []):
        if not isinstance(node, dict) or "cliptextencode" not in str(node.get("type") or "").lower():
            continue
        for value in node.get("widgets_values") or []:
            if isinstance(value, str) and value.strip():
                compact = re.sub(r"\s+", " ", value).strip()
                return compact[:20]
    return ""


def _extract_workflow_params(workflow):
    params = {}
    prompts = []
    if not isinstance(workflow, dict):
        return params, prompts

    for node in workflow.get("nodes", []):
        if not isinstance(node, dict):
            continue
        ntype = str(node.get("type") or "").strip()
        ntype_lower = ntype.lower()
        widgets = node.get("widgets_values") or []

        if ntype_lower in ("ksampler", "ksampleradvanced") and isinstance(widgets, (list, tuple)):
            is_adv = ntype_lower == "ksampleradvanced"
            offset = 1 if is_adv else 0
            if len(widgets) > offset and widgets[offset] is not None:
                params.setdefault("seed", widgets[offset])
            if len(widgets) > 2 + offset and widgets[2 + offset] is not None:
                params.setdefault("steps", widgets[2 + offset])
            if len(widgets) > 3 + offset and widgets[3 + offset] is not None:
                params.setdefault("cfg", widgets[3 + offset])
            if len(widgets) > 4 + offset and widgets[4 + offset] is not None:
                params.setdefault("sampler_name", widgets[4 + offset])
            if len(widgets) > 5 + offset and widgets[5 + offset] is not None:
                params.setdefault("scheduler", widgets[5 + offset])
            if len(widgets) > 6 + offset and widgets[6 + offset] is not None:
                params.setdefault("denoise", widgets[6 + offset])
        elif ntype_lower == "emptylatentimage" and isinstance(widgets, (list, tuple)):
            if len(widgets) >= 2 and widgets[0] and widgets[1]:
                params.setdefault("resolution", f"{widgets[0]}×{widgets[1]}")

        if "cliptextencode" in ntype_lower and isinstance(widgets, (list, tuple)):
            for val in widgets:
                if isinstance(val, str) and val.strip():
                    cleaned = val.strip()
                    if cleaned not in prompts:
                        prompts.append(cleaned)

    return params, prompts


def _display_model_name(reference):
    value = str(reference.get("saved_value") or "").replace("\\", "/").split("/")[-1]
    return re.sub(r"\.(?:safetensors|ckpt|pt|bin|sft)$", "", value, flags=re.IGNORECASE)


def _suggested_name(workflow, source_path, references=None):
    if references is None:
        references = _build_model_references({"workflow": workflow, "params": {}}, verify_identities=False)
    references.sort(key=lambda item: MODEL_PRIORITY.get(item.get("category"), 99))
    model_name = _display_model_name(references[0]) if references else "工作流快照"
    excerpt = _prompt_excerpt(workflow)
    date = time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(source_path)))
    return " · ".join(part for part in (model_name, excerpt, date) if part)[:MAX_MATERIAL_NAME_LENGTH]


def _inspect_source_image(source_image):
    source = _normalise_source_image(source_image)
    if not source["filename"].lower().endswith(".png"):
        raise ValueError("Only PNG output images can contain reusable workflow metadata")
    source_path = _output_source_path(source)
    payload = _embedded_workflow_payload(source_path)
    workflow = payload.get("workflow") if isinstance(payload, dict) else None
    if not isinstance(workflow, dict):
        raise ValueError("Image has no reusable UI workflow")
    _validate_workflow(workflow)
    blocks = _node_blocks(workflow, include_values=False)
    references = _build_model_references({"workflow": workflow, "params": {}}, verify_identities=False)
    suggested_name = _suggested_name(workflow, source_path, references)
    return source, source_path, workflow, blocks, references, suggested_name


def _store_assets(materials_dir, filename, source_path):
    source_size = os.path.getsize(source_path)
    if source_size > MAX_SOURCE_IMAGE_BYTES:
        raise ValueError("Source image is too large")
    digest = hashlib.sha256()
    with open(source_path, "rb") as source_file:
        for block in iter(lambda: source_file.read(1024 * 1024), b""):
            digest.update(block)
    assets_dir = _material_assets_dir(materials_dir, filename, create=True)
    source_asset = f"source-{digest.hexdigest()}.png"
    source_target = resolve_within(assets_dir, source_asset)
    if not os.path.exists(source_target):
        fd, temp_path = tempfile.mkstemp(prefix=".source-", suffix=".tmp", dir=assets_dir)
        os.close(fd)
        try:
            shutil.copyfile(source_path, temp_path)
            os.replace(temp_path, source_target)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    preview = _recipe_cover_webp_bytes(source_path)
    preview_asset = None
    if preview:
        data, width, height = preview
        preview_asset = f"preview-{hashlib.sha256(data).hexdigest()}.webp"
        preview_target = resolve_within(assets_dir, preview_asset)
        if not os.path.exists(preview_target):
            with open(preview_target, "wb") as preview_file:
                preview_file.write(data)
    else:
        width = height = None
    return {
        "source_asset_id": source_asset,
        "preview_asset_id": preview_asset,
        "preview_width": width,
        "preview_height": height,
        "source_sha256": digest.hexdigest(),
        "source_size": source_size,
    }


def _material_summary(filename, material):
    image = material.get("image") or {}
    blocks = _material_node_blocks(material, include_values=False)
    return {
        "filename": filename,
        "id": material.get("id"),
        "name": material.get("name") or "未命名素材",
        "kind": material.get("kind"),
        "timestamp": material.get("timestamp", 0),
        "node_count": len(blocks),
        "node_types": sorted({block["type"] for block in blocks}),
        "selection": copy.deepcopy(material.get("selection")),
        "image": {
            "preview_asset_id": image.get("preview_asset_id"),
            "source_asset_id": image.get("source_asset_id"),
            "width": image.get("preview_width"),
            "height": image.get("preview_height"),
        },
        "capabilities": list(material.get("capabilities") or []),
    }


def _workflow_hashes_for_blocks(workflow, blocks):
    hashes = (workflow.get("extra") or {}).get("anomalous_hashes") if isinstance(workflow, dict) else None
    if not isinstance(hashes, dict):
        return {}
    prefixes = tuple(f"{block.get('node_id')}_" for block in blocks)
    return {
        key: copy.deepcopy(value)
        for key, value in hashes.items()
        if isinstance(key, str) and key.startswith(prefixes)
    }


def _list_materials(materials_dir):
    result = []
    try:
        entries = os.scandir(materials_dir)
    except OSError:
        return result
    with entries:
        for entry in entries:
            if not entry.is_file() or not entry.name.endswith(".json"):
                continue
            try:
                result.append(_material_summary(entry.name, _read_material(entry.path)))
            except (OSError, ValueError, json.JSONDecodeError):
                continue
    result.sort(key=lambda item: item.get("timestamp", 0), reverse=True)
    return result


async def api_inspect_image_material(request):
    try:
        payload = await request.json()
        source, source_path, workflow, blocks, references, suggested_name = await asyncio.to_thread(
            _inspect_source_image, payload.get("source_image")
        )
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Image has no reusable UI workflow"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Output image not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not inspect output image"}, status=500)
    sampling_params, prompts = _extract_workflow_params(workflow)
    return web.json_response({
        "status": "success",
        "source_image": source,
        "suggested_name": suggested_name,
        "node_count": len(blocks),
        # The browser already reads the embedded workflow for exact values.
        # Keep the server response summary-only to avoid holding/transferring a
        # second copy of every widget value for each inspected image.
        "node_blocks": blocks,
        "workflow": workflow,
        "model_references": references,
        "prompt_excerpt": _prompt_excerpt(workflow),
        "params": sampling_params,
        "prompts": prompts,
    })


async def api_save_image_material(request):
    try:
        payload = await request.json()
        source, source_path, workflow, blocks, references, suggested_name = await asyncio.to_thread(
            _inspect_source_image, payload.get("source_image")
        )
        name = payload.get("name") or suggested_name
        if not isinstance(name, str) or not (name := name.strip()) or len(name) > MAX_MATERIAL_NAME_LENGTH:
            raise ValueError("Invalid material name")
        selected_node_ids = _normalise_selected_node_ids(workflow, payload.get("selected_node_ids"))
        selected_id_keys = {str(node_id) for node_id in selected_node_ids or []}
        if selected_node_ids is not None:
            blocks = [block for block in blocks if str(block.get("node_id")) in selected_id_keys]
            references = [
                reference for reference in references
                if str(reference.get("node_id")) in selected_id_keys
            ]
        material_id = uuid.uuid4().hex
        filename = f"material_{int(time.time())}_{material_id[:8]}.json"
        materials_dir = get_materials_dir()
        image = await asyncio.to_thread(_store_assets, materials_dir, filename, source_path)
        now = int(time.time() * 1000)
        material = {
            "schema_version": MATERIAL_SCHEMA_VERSION,
            "id": material_id,
            "kind": "image_node_selection" if selected_node_ids is not None else "image_workflow_snapshot",
            "name": name,
            "timestamp": now,
            "source": {"type": "generated_image", "image": source},
            "image": image,
            "workflow": workflow,
            "model_references": references,
            "capabilities": (
                ["apply_node_parameters", "reference_image"]
                if selected_node_ids is not None
                else ["open_workflow", "apply_node_parameters", "reference_image"]
            ),
        }
        if selected_node_ids is not None:
            material["selection"] = {"scope": "nodes", "node_ids": selected_node_ids}
        await asyncio.to_thread(_atomic_write_json, resolve_within(materials_dir, filename), material)
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Could not save image material"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Output image not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not save image material"}, status=500)
    return web.json_response({
        "status": "success",
        "filename": filename,
        "material": _material_summary(filename, material),
        "node_blocks": blocks,
    })


async def api_get_materials(request):
    materials = await asyncio.to_thread(_list_materials, get_materials_dir())
    return web.json_response({"status": "success", "materials": materials})


async def api_get_material_full(request):
    try:
        filename = require_filename(request.query.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid material filename")
        material = await asyncio.to_thread(_read_material, resolve_within(get_materials_dir(), filename))
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid material"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Material not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read material"}, status=500)
    return web.json_response({
        "status": "success",
        "data": material,
        "node_blocks": _material_node_blocks(material, include_values=True),
    })


async def api_get_materials_by_node_type(request):
    node_type = request.query.get("type", "")
    if not isinstance(node_type, str) or not node_type.strip() or len(node_type) > 200:
        return web.json_response({"status": "error", "message": "Invalid node type"}, status=400)
    materials_dir = get_materials_dir()

    def collect():
        matches = []
        for summary in _list_materials(materials_dir):
            try:
                material = _read_material(resolve_within(materials_dir, summary["filename"]))
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            blocks = [block for block in _material_node_blocks(material, include_values=True) if block["type"] == node_type]
            if blocks:
                matches.append({
                    "filename": summary["filename"],
                    "name": summary["name"],
                    "kind": summary["kind"],
                    "timestamp": summary["timestamp"],
                    "blocks": blocks,
                    "workflow_hashes": _workflow_hashes_for_blocks(material["workflow"], blocks),
                })
        return matches

    matches = await asyncio.to_thread(collect)
    return web.json_response({"status": "success", "materials": matches})


async def api_get_material_asset(request):
    try:
        filename = require_filename(request.query.get("filename", ""))
        asset_id = require_filename(request.query.get("asset", ""))
        if not filename.endswith(".json") or not asset_id.lower().endswith((".png", ".webp")):
            raise ValueError("Invalid material asset")
        materials_dir = get_materials_dir()
        await asyncio.to_thread(_read_material, resolve_within(materials_dir, filename))
        asset_path = resolve_within(_material_assets_dir(materials_dir, filename), asset_id)
        if not os.path.isfile(asset_path):
            raise FileNotFoundError
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid material asset"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Material asset not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read material asset"}, status=500)
    return web.FileResponse(asset_path)


async def api_delete_material(request):
    try:
        payload = await request.json()
        filename = require_filename(payload.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid material filename")
        materials_dir = get_materials_dir()
        path = resolve_within(materials_dir, filename)
        await asyncio.to_thread(_delete_material, materials_dir, filename, path)
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid material"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Material not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not delete material"}, status=500)
    return web.json_response({"status": "success"})


def _delete_material(materials_dir, filename, path):
    _read_material(path)
    os.remove(path)
    assets_dir = _material_assets_dir(materials_dir, filename)
    if os.path.isdir(assets_dir):
        shutil.rmtree(assets_dir)
