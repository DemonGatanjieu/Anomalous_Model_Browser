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
import threading
from functools import lru_cache

from aiohttp import web
import folder_paths

from .recipe_constants import MAX_RECIPE_BYTES
from .recipe_images import _embedded_workflow_payload, _output_source_path, _recipe_cover_webp_bytes
from .recipe_schema import _build_model_references, _normalise_source_image
from .recipe_store import _read_recipe, get_recipes_dir
from .workflow_schema import _parameter_signature, _validate_workflow, _volatile_widget_indexes, _workflow_fingerprint
from .parameters import get_parameters_dir
from .notebooks import MAX_NOTEBOOK_BYTES
from .utils import require_filename, resolve_within, atomic_write_json as _atomic_write_json


MATERIAL_SCHEMA_VERSION = 1
MAX_MATERIAL_NAME_LENGTH = 120
MAX_SOURCE_IMAGE_BYTES = 64 * 1024 * 1024
_material_write_lock = threading.RLock()
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


def _read_material(path):
    if os.path.getsize(path) > MAX_RECIPE_BYTES:
        raise ValueError("Material snapshot is too large")
    with open(path, "r", encoding="utf-8") as material_file:
        value = json.load(material_file)
    if not isinstance(value, dict):
        raise ValueError("Invalid material snapshot")
    if value.get("kind") == "prompt_plan":
        _normalise_prompt_plan(value.get("plan"))
    elif value.get("kind") in ("prompt_note_bundle", "prompt_text"):
        _normalise_prompt_note(value.get("note"), value["kind"] == "prompt_text")
    elif not isinstance(value.get("workflow"), dict):
        raise ValueError("Invalid material snapshot")
    return value


def _node_blocks(workflow, include_values=True, selected_ids=None):
    blocks = []
    occurrences = {}
    for node in workflow.get("nodes", []):
        if not isinstance(node, dict):
            continue
        node_type = str(node.get("type") or "").strip()
        if not node_type:
            continue
        occurrences[node_type] = occurrences.get(node_type, 0) + 1
        if selected_ids is not None and str(node.get("id")) not in selected_ids:
            continue
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
    if material.get("kind") in ("prompt_note_bundle", "prompt_text", "prompt_plan"):
        return []
    return _node_blocks(material.get("workflow") or {}, include_values=include_values,
                        selected_ids=_material_node_ids(material))


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


_PROMPT_NODE_TYPES = {"cliptextencode"}
_PROMPT_CONSUMERS = {
    "ksampler": {"positive": "positive", "negative": "negative"},
    "ksampleradvanced": {"positive": "positive", "negative": "negative"},
    "cfgguider": {"positive": "positive", "negative": "negative"},
    "basicguider": {"conditioning": "positive"},
    "dualcfgguider": {"cond1": "positive", "cond2": "positive", "negative": "negative"},
}
_PROMPT_PASSTHROUGH = {
    "conditioningaverage",
    "conditioningcombine",
    "conditioningconcat",
    "conditioningmultiply",
    "conditioningsetarea",
    "conditioningsetareapercentage",
    "conditioningsetareastrength",
    "conditioningsetmask",
    "conditioningsettimesteprange",
    "conditioningzeroout",
}
_PROMPT_ROLES = {"positive", "negative", "both", "ignored", "unknown"}
_MAX_PROMPT_UPSTREAM = 96


def _norm_node_name(value):
    return str(value or "").strip().lower()


def _is_prompt_node_type(node_type):
    name = _norm_node_name(node_type)
    return name in _PROMPT_NODE_TYPES or "cliptextencode" in name


def _first_prompt_text(node):
    for value in node.get("widgets_values") or []:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _title_prompt_role(node):
    title = str(node.get("title") or "").lower()
    if "neg" in title or "负向" in title or "反向" in title:
        return "negative"
    if "pos" in title or "正向" in title:
        return "positive"
    return None


def _workflow_link_origin(workflow, link_id):
    if link_id is None:
        return None
    links = workflow.get("links")
    if isinstance(links, list):
        for link in links:
            if isinstance(link, (list, tuple)) and len(link) > 1 and link[0] == link_id:
                return link[1]
            if isinstance(link, dict) and link.get("id") == link_id:
                return link.get("origin_id")
    elif isinstance(links, dict):
        link = links.get(link_id)
        if link is None:
            link = links.get(str(link_id))
        if isinstance(link, dict):
            return link.get("origin_id")
        if isinstance(link, (list, tuple)) and len(link) > 1:
            return link[1]
    return None


def _collect_prompt_nodes(workflow, nodes_by_id, start_id):
    queue = [start_id]
    visited = set()
    found = []
    while queue and len(visited) < _MAX_PROMPT_UPSTREAM:
        node_id = queue.pop(0)
        if node_id is None or node_id in visited:
            continue
        visited.add(node_id)
        node = nodes_by_id.get(str(node_id))
        if not isinstance(node, dict):
            continue
        if _is_prompt_node_type(node.get("type")):
            if node not in found:
                found.append(node)
            continue
        if _norm_node_name(node.get("type")) not in _PROMPT_PASSTHROUGH:
            continue
        for inbound in node.get("inputs") or []:
            if not isinstance(inbound, dict):
                continue
            input_type = _norm_node_name(inbound.get("type"))
            input_name = _norm_node_name(inbound.get("name"))
            if input_type != "conditioning" and "conditioning" not in input_name:
                continue
            origin_id = _workflow_link_origin(workflow, inbound.get("link"))
            if origin_id is not None and origin_id not in visited:
                queue.append(origin_id)
    return found


def _normalise_prompt_role_overrides(raw):
    if not isinstance(raw, dict):
        return {}
    result = {}
    for key, value in list(raw.items())[:80]:
        if not isinstance(value, dict):
            continue
        role = value.get("role")
        if role not in _PROMPT_ROLES:
            continue
        node_type = value.get("nodeType")
        if node_type is not None and (not isinstance(node_type, str) or len(node_type) > 200):
            continue
        result[str(key)] = {
            "role": role,
            "nodeType": node_type if isinstance(node_type, str) else None,
            "source": "manual",
        }
    return result


def _override_prompt_role(node, overrides):
    if not isinstance(overrides, dict) or not isinstance(node, dict):
        return None
    entry = overrides.get(str(node.get("id")))
    if not isinstance(entry, dict) or entry.get("role") not in _PROMPT_ROLES:
        return None
    expected = entry.get("nodeType")
    if expected and expected != node.get("type"):
        return None
    return entry["role"]


def _prompt_roles_for_workflow(workflow, overrides=None):
    roles = {}
    if not isinstance(workflow, dict):
        return roles
    nodes = [node for node in workflow.get("nodes") or [] if isinstance(node, dict)]
    nodes_by_id = {str(node.get("id")): node for node in nodes if node.get("id") is not None}
    positive_ids = set()
    negative_ids = set()
    for node in nodes:
        mapping = _PROMPT_CONSUMERS.get(_norm_node_name(node.get("type")))
        if not mapping:
            continue
        for input_name, role in mapping.items():
            for inbound in node.get("inputs") or []:
                if not isinstance(inbound, dict) or _norm_node_name(inbound.get("name")) != input_name:
                    continue
                origin_id = _workflow_link_origin(workflow, inbound.get("link"))
                for prompt_node in _collect_prompt_nodes(workflow, nodes_by_id, origin_id):
                    node_id = str(prompt_node.get("id"))
                    if role == "negative":
                        negative_ids.add(node_id)
                    else:
                        positive_ids.add(node_id)
    for node in nodes:
        if not _is_prompt_node_type(node.get("type")):
            continue
        node_id = str(node.get("id"))
        in_positive = node_id in positive_ids
        in_negative = node_id in negative_ids
        if in_positive and in_negative:
            automatic_role, automatic_source = "both", "topology"
        elif in_positive:
            automatic_role, automatic_source = "positive", "topology"
        elif in_negative:
            automatic_role, automatic_source = "negative", "topology"
        else:
            titled = _title_prompt_role(node)
            automatic_role = titled or "unknown"
            automatic_source = "title" if titled else "unresolved"
        override = _override_prompt_role(node, overrides)
        roles[node_id] = {
            "role": override or automatic_role,
            "source": "manual" if override else automatic_source,
            "automatic_role": automatic_role,
        }
    return roles


def _prompt_groups_from_roles(workflow, roles, selected_ids=None):
    positive = []
    negative = []
    if not isinstance(workflow, dict) or not isinstance(roles, dict):
        return {"positive": positive, "negative": negative}
    for node in workflow.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id"))
        if selected_ids is not None and node_id not in selected_ids:
            continue
        info = roles.get(node_id)
        if not isinstance(info, dict):
            continue
        text = _first_prompt_text(node)
        if not text:
            continue
        role = info.get("role")
        if role in ("positive", "both") and text not in positive:
            positive.append(text)
        if role in ("negative", "both") and text not in negative:
            negative.append(text)
    return {"positive": positive, "negative": negative}


def _display_model_name(reference):
    value = str(reference.get("saved_value") or "").replace("\\", "/").split("/")[-1]
    return re.sub(r"\.(?:safetensors|ckpt|pt|bin|sft)$", "", value, flags=re.IGNORECASE)


def _suggested_name(workflow, source_path, references=None):
    stem = os.path.splitext(os.path.basename(source_path))[0] if source_path else ""
    if stem:
        return f"{stem} · 快照"[:MAX_MATERIAL_NAME_LENGTH]
    if references is None:
        references = _build_model_references({"workflow": workflow, "params": {}}, verify_identities=False)
    references.sort(key=lambda item: MODEL_PRIORITY.get(item.get("category"), 99))
    model_name = _display_model_name(references[0]) if references else "工作流快照"
    return f"{model_name} · 快照"[:MAX_MATERIAL_NAME_LENGTH]


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


def _read_parameter_source(recipe_filename, parameter_filename=None):
    recipe_filename = require_filename(recipe_filename)
    if not recipe_filename.endswith(".json") or recipe_filename.startswith("."):
        raise ValueError("Invalid recipe filename")
    recipe_path = resolve_within(get_recipes_dir(), recipe_filename)
    if os.path.getsize(recipe_path) > MAX_RECIPE_BYTES:
        raise ValueError("Recipe source is too large")
    recipe = _read_recipe(recipe_path)
    source = recipe
    if parameter_filename:
        parameter_filename = require_filename(parameter_filename)
        if not parameter_filename.endswith(".json") or parameter_filename.startswith("."):
            raise ValueError("Invalid parameter filename")
        parameter_path = resolve_within(get_parameters_dir(), parameter_filename)
        if os.path.getsize(parameter_path) > MAX_RECIPE_BYTES:
            raise ValueError("Parameter notebook is too large")
        with open(parameter_path, "r", encoding="utf-8") as parameter_file:
            source = json.load(parameter_file)
        if not isinstance(source, dict) or source.get("recipe_filename") != recipe_filename:
            raise ValueError("Parameter notebook does not belong to recipe")
    workflow = source.get("workflow") if isinstance(source, dict) else None
    if not isinstance(workflow, dict):
        raise ValueError("Parameter source has no workflow")
    _validate_workflow(workflow)
    return recipe_filename, parameter_filename, recipe, source, workflow


def _parameter_source_record(recipe_filename, parameter_filename, recipe, source, workflow):
    record = {
        "type": "recipe_parameter_notebook" if parameter_filename else "workflow_recipe",
        **_snapshot_recipe_source(recipe_filename),
        "parameter_signature": (_parameter_signature(workflow) or {}).get("value") or "",
    }
    if parameter_filename:
        record["parameter_filename"] = parameter_filename
        record["parameter_name"] = str(source.get("name") or "").strip()[:200]
    elif isinstance(recipe, dict):
        record["parameter_name"] = str(recipe.get("name") or "").strip()[:200]
    return record


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


def _recipe_link_fingerprint(recipe):
    if not isinstance(recipe, dict):
        return ""
    fingerprint = recipe.get("workflow_fingerprint")
    workflow_hash = fingerprint.get("value") if isinstance(fingerprint, dict) else ""
    if not workflow_hash and isinstance(recipe.get("workflow"), dict):
        workflow_hash = (_workflow_fingerprint(recipe["workflow"]) or {}).get("value") or ""
    params = recipe.get("params") if isinstance(recipe.get("params"), dict) else {}
    overrides = params.get("promptRoleOverrides") if isinstance(params.get("promptRoleOverrides"), dict) else {}
    payload = json.dumps(
        {"workflow": workflow_hash, "promptRoleOverrides": overrides},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _snapshot_recipe_source(recipe_filename):
    if not recipe_filename:
        return {}
    record = {"recipe_filename": recipe_filename}
    try:
        path = resolve_within(get_recipes_dir(), require_filename(recipe_filename))
        recipe = _read_recipe(path)
    except (OSError, ValueError, json.JSONDecodeError, TypeError):
        return record
    if not isinstance(recipe, dict):
        return record
    name = str(recipe.get("name") or "").strip()
    if name:
        record["recipe_name"] = name[:120]
    fingerprint = _recipe_link_fingerprint(recipe)
    if fingerprint:
        record["recipe_fingerprint"] = fingerprint
    return record


def _live_recipe_source(source):
    if not isinstance(source, dict):
        return None
    filename = source.get("recipe_filename")
    if not isinstance(filename, str) or not filename:
        return None
    info = {
        "filename": filename,
        "name": str(source.get("recipe_name") or "").strip(),
        "status": "missing",
    }
    try:
        path = resolve_within(get_recipes_dir(), require_filename(filename))
        if not os.path.isfile(path):
            return info
        recipe = _read_recipe(path)
    except (OSError, ValueError, json.JSONDecodeError, TypeError):
        return info
    if isinstance(recipe, dict):
        live_name = str(recipe.get("name") or "").strip()
        if live_name:
            info["name"] = live_name[:120]
        snapshot = str(source.get("recipe_fingerprint") or "")
        current = _recipe_link_fingerprint(recipe)
        if snapshot and current and snapshot != current:
            info["status"] = "modified"
        else:
            info["status"] = "current"
    return info


def _material_summary(filename, material):
    image = material.get("image") or {}
    source = material.get("source") if isinstance(material.get("source"), dict) else {}
    blocks = _material_node_blocks(material, include_values=False)
    summary = {
        "filename": filename,
        "id": material.get("id"),
        "name": material.get("name") or "未命名素材",
        "kind": material.get("kind"),
        "tags": _normalise_material_tags(material.get("tags") or []),
        "source_sha256": image.get("source_sha256", ""),
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
        "source": {
            "type": source.get("type"),
            "label": str(source.get("parameter_name") or source.get("recipe_name") or source.get("notebook_name") or "").strip(),
        },
        "source_fingerprint": str(source.get("parameter_signature") or image.get("source_sha256") or ""),
    }
    if source.get("recipe_filename"):
        summary["source_recipe"] = {
            "filename": source.get("recipe_filename"),
            "name": str(source.get("recipe_name") or "").strip(),
            "fingerprint": str(source.get("recipe_fingerprint") or ""),
        }
    return summary


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


@lru_cache(maxsize=4096)
def _cached_material_summary(path, signature):
    return _material_summary(os.path.basename(path), _read_material(path))


def _with_live_recipe_source(summary):
    snapshot = summary.get("source_recipe")
    if not isinstance(snapshot, dict) or not snapshot.get("filename"):
        return summary
    summary["source_recipe"] = _live_recipe_source({
        "recipe_filename": snapshot.get("filename"),
        "recipe_name": snapshot.get("name"),
        "recipe_fingerprint": snapshot.get("fingerprint"),
    })
    return summary


def _summary_for_path(path, stat=None):
    stat = stat or os.stat(path)
    signature = (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    return _with_live_recipe_source(copy.deepcopy(_cached_material_summary(path, signature)))


def _list_materials(materials_dir):
    result = []
    try:
        materials_dir = os.path.realpath(materials_dir)
        entries = os.scandir(materials_dir)
    except OSError:
        return result
    with entries:
        for entry in entries:
            if not entry.is_file() or not entry.name.endswith(".json") or entry.name.startswith("."):
                continue
            try:
                path = resolve_within(materials_dir, entry.name) if entry.is_symlink() else entry.path
                result.append(copy.deepcopy(_summary_for_path(path, entry.stat())))
            except (OSError, ValueError):
                continue
    result.sort(key=lambda item: (item.get("timestamp", 0), item["filename"]), reverse=True)
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
    prompt_roles = _prompt_roles_for_workflow(workflow)
    return web.json_response({
        "status": "success",
        "source_image": source,
        "suggested_name": suggested_name,
        "node_count": len(blocks),
        "node_blocks": blocks,
        "workflow": workflow,
        "model_references": references,
        "prompt_excerpt": _prompt_excerpt(workflow),
        "params": sampling_params,
        "prompts": prompts,
        "prompt_roles": prompt_roles,
        "prompt_groups": _prompt_groups_from_roles(workflow, prompt_roles),
    })


def _normalise_material_tags(tags):
    if not isinstance(tags, list) or len(tags) > 20:
        raise ValueError("Invalid material tags")
    result = []
    seen = set()
    for tag in tags:
        if not isinstance(tag, str) or not tag.strip() or len(tag.strip()) > 60:
            raise ValueError("Invalid material tag")
        tag = tag.strip()
        if tag.casefold() not in seen:
            result.append(tag)
            seen.add(tag.casefold())
    return result


def _persist_material(materials_dir, filename, source_path, material, allow_duplicate=False):
    with _material_write_lock:
        return _persist_material_files(materials_dir, filename, source_path, material, allow_duplicate)


def _persist_parameter_material(materials_dir, filename, material, allow_duplicate=False):
    with _material_write_lock:
        target = resolve_within(materials_dir, filename)
        if os.path.exists(target):
            raise ValueError("Material already exists")
        if not allow_duplicate:
            selection = sorted(str(value) for value in (material.get("selection") or {}).get("node_ids", []))
            fingerprint = str((material.get("source") or {}).get("parameter_signature") or "")
            for summary in _list_materials(materials_dir):
                candidate_selection = sorted(str(value) for value in (summary.get("selection") or {}).get("node_ids", []))
                if (summary.get("kind") == material.get("kind")
                        and summary.get("source_fingerprint") == fingerprint
                        and candidate_selection == selection):
                    return summary
        _atomic_write_json(target, material)
        return None


def _persist_material_files(materials_dir, filename, source_path, material, allow_duplicate):
    target = resolve_within(materials_dir, filename)
    assets_target = _material_assets_dir(materials_dir, filename)
    if os.path.exists(target) or os.path.exists(assets_target):
        raise ValueError("Material already exists")
    with tempfile.TemporaryDirectory(prefix=".save-", dir=materials_dir) as staging:
        material["image"] = _store_assets(staging, filename, source_path)
        if not allow_duplicate:
            selection = sorted(str(value) for value in (material.get("selection") or {}).get("node_ids", []))
            for summary in _list_materials(materials_dir):
                candidate_selection = sorted(str(value) for value in (summary.get("selection") or {}).get("node_ids", []))
                if summary.get("source_sha256") == material["image"]["source_sha256"] and summary.get("kind") == material.get("kind") and candidate_selection == selection:
                    return summary
        staged_json = resolve_within(staging, filename)
        _atomic_write_json(staged_json, material)
        os.makedirs(os.path.dirname(assets_target), exist_ok=True)
        os.replace(_material_assets_dir(staging, filename), assets_target)
        try:
            os.replace(staged_json, target)
        except OSError:
            shutil.rmtree(assets_target)
            raise


async def api_save_image_material(request):
    try:
        payload = await request.json()
        source, source_path, workflow, blocks, references, suggested_name = await asyncio.to_thread(
            _inspect_source_image, payload.get("source_image")
        )
        name = payload.get("name") or suggested_name
        if not isinstance(name, str) or not (name := name.strip()) or len(name) > MAX_MATERIAL_NAME_LENGTH:
            raise ValueError("Invalid material name")
        tags = _normalise_material_tags(payload.get("tags", []))
        allow_duplicate = payload.get("allow_duplicate", False)
        if not isinstance(allow_duplicate, bool):
            raise ValueError("Invalid duplicate preference")
        selected_node_ids = _normalise_selected_node_ids(workflow, payload.get("selected_node_ids"))
        selected_id_keys = {str(node_id) for node_id in selected_node_ids or []}
        if selected_node_ids is not None:
            blocks = [block for block in blocks if str(block.get("node_id")) in selected_id_keys]
            references = [
                reference for reference in references
                if str(reference.get("node_id")) in selected_id_keys
            ]
        material_id = uuid.uuid4().hex
        filename = f"material_{int(time.time())}_{material_id}.json"
        materials_dir = get_materials_dir()
        now = int(time.time() * 1000)
        source_record = {"type": "generated_image", "image": source}
        recipe_filename = payload.get("recipe_filename")
        if isinstance(recipe_filename, str) and recipe_filename.strip():
            try:
                recipe_filename = require_filename(recipe_filename.strip())
            except (AttributeError, TypeError, ValueError):
                recipe_filename = ""
            if recipe_filename.endswith(".json"):
                source_record.update(_snapshot_recipe_source(recipe_filename))
        prompt_role_overrides = _normalise_prompt_role_overrides(payload.get("promptRoleOverrides"))
        material = {
            "schema_version": MATERIAL_SCHEMA_VERSION,
            "id": material_id,
            "kind": "image_node_selection" if selected_node_ids is not None else "image_workflow_snapshot",
            "name": name,
            "tags": tags,
            "timestamp": now,
            "source": source_record,
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
        if prompt_role_overrides:
            material["promptRoleOverrides"] = prompt_role_overrides
        duplicate = await asyncio.to_thread(_persist_material, materials_dir, filename, source_path, material, allow_duplicate)
        if duplicate:
            return web.json_response({"status": "duplicate", "filename": duplicate["filename"], "name": duplicate["name"]}, status=409)
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Could not save image material"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Output image not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not save image material"}, status=500)
    return web.json_response({
        "status": "success",
        "filename": filename,
        "material": _with_live_recipe_source(_material_summary(filename, material)),
        "node_blocks": blocks,
    })


async def api_save_parameter_material(request):
    try:
        payload = await request.json()
        recipe_filename, parameter_filename, recipe, source, workflow = await asyncio.to_thread(
            _read_parameter_source,
            payload.get("recipe_filename", ""),
            payload.get("parameter_filename"),
        )
        source_name = str(source.get("name") or recipe.get("name") or "参数素材").strip()
        name = payload.get("name") or source_name
        if not isinstance(name, str) or not (name := name.strip()) or len(name) > MAX_MATERIAL_NAME_LENGTH:
            raise ValueError("Invalid material name")
        tags = _normalise_material_tags(payload.get("tags", recipe.get("tags") or []))
        allow_duplicate = payload.get("allow_duplicate", False)
        if not isinstance(allow_duplicate, bool):
            raise ValueError("Invalid duplicate preference")

        reusable_ids = [
            node.get("id") for node in workflow.get("nodes", [])
            if isinstance(node, dict) and node.get("id") is not None
            and isinstance(node.get("widgets_values"), list) and node.get("widgets_values")
        ]
        raw_selection = payload.get("selected_node_ids")
        selected_node_ids = _normalise_selected_node_ids(
            workflow,
            reusable_ids if raw_selection is None else raw_selection,
        )
        reusable_keys = {str(value) for value in reusable_ids}
        if any(str(value) not in reusable_keys for value in selected_node_ids):
            raise ValueError("Selected node has no reusable parameters")
        selected_keys = {str(value) for value in selected_node_ids}
        blocks = [
            block for block in _node_blocks(workflow, include_values=False)
            if str(block.get("node_id")) in selected_keys
        ]
        references = [
            reference for reference in _build_model_references(source, verify_identities=False)
            if str(reference.get("node_id")) in selected_keys
        ]
        source_record = _parameter_source_record(
            recipe_filename, parameter_filename, recipe, source, workflow
        )
        material_id = uuid.uuid4().hex
        filename = f"material_{int(time.time())}_{material_id}.json"
        material = {
            "schema_version": MATERIAL_SCHEMA_VERSION,
            "id": material_id,
            "kind": "recipe_parameter_selection",
            "name": name,
            "tags": tags,
            "timestamp": int(time.time() * 1000),
            "source": source_record,
            "workflow": workflow,
            "model_references": references,
            "capabilities": ["apply_node_parameters"],
            "selection": {"scope": "nodes", "node_ids": selected_node_ids},
        }
        params = source.get("params") if isinstance(source.get("params"), dict) else {}
        prompt_role_overrides = _normalise_prompt_role_overrides(params.get("promptRoleOverrides"))
        if prompt_role_overrides:
            material["promptRoleOverrides"] = prompt_role_overrides
        materials_dir = get_materials_dir()
        duplicate = await asyncio.to_thread(
            _persist_parameter_material, materials_dir, filename, material, allow_duplicate
        )
        if duplicate:
            return web.json_response({
                "status": "duplicate",
                "filename": duplicate["filename"],
                "name": duplicate["name"],
            }, status=409)
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Could not save parameter material"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Parameter source not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not save parameter material"}, status=500)
    return web.json_response({
        "status": "success",
        "filename": filename,
        "material": _with_live_recipe_source(_material_summary(filename, material)),
        "node_blocks": blocks,
    })


def _normalise_prompt_note(data, prompt_only=False):
    if not isinstance(data, dict):
        raise ValueError("Invalid prompt note")
    if len(json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")) > MAX_NOTEBOOK_BYTES:
        raise ValueError("Prompt note is too large")
    result = {}
    for key in ("promptEn", "promptZh", "targetLang"):
        value = data.get(key, "")
        if not isinstance(value, str):
            raise ValueError("Invalid prompt text")
        result[key] = value
    translations = data.get("translations", {})
    if not isinstance(translations, dict) or any(not isinstance(value, str) for value in translations.values()):
        raise ValueError("Invalid prompt translations")
    result["translations"] = copy.deepcopy(translations)
    if not prompt_only:
        base = data.get("baseModel", "")
        main = data.get("mainModel")
        loras = data.get("loras", [])
        if not isinstance(base, str) or (main is not None and not isinstance(main, dict)):
            raise ValueError("Invalid prompt models")
        if not isinstance(loras, list) or len(loras) > 100 or any(not isinstance(model, dict) for model in loras):
            raise ValueError("Invalid prompt LoRAs")
        for model in ([main] if main is not None else []) + loras:
            if not isinstance(model.get("filename"), str) or not model["filename"]:
                raise ValueError("Invalid prompt model filename")
        result.update(baseModel=base, mainModel=copy.deepcopy(main), loras=copy.deepcopy(loras))
    return result


async def api_save_prompt_note_material(request):
    try:
        payload = await request.json()
        scope = payload.get("scope", "note")
        if scope not in ("note", "prompt"):
            raise ValueError("Invalid prompt scope")
        source_filename = require_filename(payload.get("notebook_filename", ""))
        if not source_filename.endswith(".json") or source_filename.startswith("."):
            raise ValueError("Invalid notebook filename")
        name = payload.get("name", "")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > MAX_MATERIAL_NAME_LENGTH:
            raise ValueError("Invalid material name")
        note = _normalise_prompt_note(payload.get("note"), scope == "prompt")
        if scope == "prompt" and not note["promptEn"].strip():
            raise ValueError("Prompt is empty")
        tags = _normalise_material_tags(payload.get("tags", []))
        allow_duplicate = payload.get("allow_duplicate", False)
        if not isinstance(allow_duplicate, bool):
            raise ValueError("Invalid duplicate preference")
        signature = hashlib.sha256(json.dumps(note, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")).hexdigest()
        material_id = uuid.uuid4().hex
        filename = f"material_{int(time.time())}_{material_id}.json"
        material = {
            "schema_version": MATERIAL_SCHEMA_VERSION, "id": material_id,
            "kind": "prompt_text" if scope == "prompt" else "prompt_note_bundle",
            "name": name.strip(), "tags": tags, "timestamp": int(time.time() * 1000),
            "source": {"type": "prompt_note", "notebook_filename": source_filename,
                       "notebook_name": name.strip(), "parameter_signature": signature},
            "note": note, "selection": {"scope": scope},
            "capabilities": ["copy_prompt", "restore_prompt_note"],
        }
        duplicate = await asyncio.to_thread(
            _persist_parameter_material, get_materials_dir(), filename, material, allow_duplicate
        )
        if duplicate:
            return web.json_response({"status": "duplicate", "filename": duplicate["filename"],
                                      "name": duplicate["name"]}, status=409)
        return web.json_response({"status": "success", "filename": filename,
                                  "material": _material_summary(filename, material)})
    except (AttributeError, TypeError, ValueError):
        return web.json_response({"status": "error", "message": "Invalid prompt note material"}, status=400)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not save prompt note material"}, status=500)


def _normalise_prompt_plan(plan):
    if not isinstance(plan, dict) or len(json.dumps(plan, ensure_ascii=False, allow_nan=False).encode("utf-8")) > MAX_NOTEBOOK_BYTES:
        raise ValueError("Invalid prompt plan")
    parts = plan.get("parts", [])
    if not isinstance(parts, list) or len(parts) > 100:
        raise ValueError("Invalid prompt parts")
    result = {"parts": []}
    if "version" in plan and isinstance(plan["version"], int):
        result["version"] = plan["version"]
    for key in ("positive", "negative"):
        if not isinstance(plan.get(key, ""), str):
            raise ValueError("Invalid prompt text")
        result[key] = plan.get(key, "")
    for part in parts:
        if not isinstance(part, dict) or part.get("category") not in ("general", "specific", "base", "style", "subject", "trigger") or not isinstance(part.get("enabled", True), bool):
            raise ValueError("Invalid prompt part")
        item = {"category": part["category"], "enabled": part.get("enabled", True)}
        if "role" in part and part["role"] in ("positive", "negative"):
            item["role"] = part["role"]
        if "id" in part and isinstance(part["id"], str) and len(part["id"]) <= 120:
            item["id"] = part["id"]
        for key in ("name", "positive", "negative"):
            if not isinstance(part.get(key, ""), str):
                raise ValueError("Invalid prompt part text")
            item[key] = part.get(key, "")
        if len(item["name"]) > 120:
            raise ValueError("Prompt part name is too long")
        result["parts"].append(item)
    return result


async def api_save_prompt_plan(request):
    try:
        payload = await request.json()
        name = payload.get("name", "")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > MAX_MATERIAL_NAME_LENGTH:
            raise ValueError("Invalid plan name")
        plan = _normalise_prompt_plan(payload.get("plan"))
        tags = _normalise_material_tags(payload.get("tags", []))
        allow_duplicate = payload.get("allow_duplicate", False)
        if not isinstance(allow_duplicate, bool):
            raise ValueError("Invalid duplicate preference")
        signature = hashlib.sha256(json.dumps(plan, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        material_id = uuid.uuid4().hex
        filename = f"material_{int(time.time())}_{material_id}.json"
        material = {"schema_version": MATERIAL_SCHEMA_VERSION, "id": material_id,
                    "kind": "prompt_plan", "name": name.strip(), "tags": tags,
                    "timestamp": int(time.time() * 1000), "plan": plan,
                    "source": {"type": "prompt_plan", "parameter_signature": signature},
                    "capabilities": ["compose_prompt"], "selection": {"scope": "prompt_plan"}}
        duplicate = await asyncio.to_thread(_persist_parameter_material, get_materials_dir(), filename, material, allow_duplicate)
        if duplicate:
            return web.json_response({"status": "duplicate", "filename": duplicate["filename"], "name": duplicate["name"]}, status=409)
        return web.json_response({"status": "success", "filename": filename, "material": _material_summary(filename, material)})
    except (AttributeError, TypeError, ValueError):
        return web.json_response({"status": "error", "message": "Invalid prompt plan"}, status=400)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not save prompt plan"}, status=500)


def _material_category(material):
    if material.get("kind") == "image_workflow_snapshot":
        return "workflow"
    if material.get("kind") in ("prompt_text", "prompt_note_bundle", "prompt_plan"):
        return "prompts"
    types = material.get("node_types", [])
    if types and all(_is_prompt_node_type(value) for value in types):
        return "prompts"
    return "params"


def _query_materials(materials_dir, query):
    materials = _list_materials(materials_dir)
    all_tags = sorted({tag for material in materials for tag in material.get("tags", [])}, key=str.casefold)
    search = query.get("q", "").strip().casefold()
    tag = query.get("tag", "").strip().casefold()
    kind = query.get("kind", "")
    category = query.get("category", "all")
    if category not in ("all", "workflow", "params", "prompts"):
        raise ValueError("Invalid material category")
    node_type = query.get("node_type", "")
    if len(node_type) > 200:
        raise ValueError("Invalid node type")
    if len(search) > 200 or len(tag) > 60 or kind not in (
        "", "image_workflow_snapshot", "image_node_selection", "recipe_parameter_selection", "prompt_note_bundle", "prompt_text", "prompt_plan"
    ):
        raise ValueError("Invalid material filter")
    materials = [material for material in materials
                 if (not search or search in " ".join([material["name"], *material["node_types"], *material.get("tags", [])]).casefold())
                 and (not tag or tag in [value.casefold() for value in material.get("tags", [])])
                 and (not kind or material["kind"] == kind)
                 and (category == "all" or _material_category(material) == category)
                 and (not node_type or node_type in material["node_types"])]
    total = len(materials)
    limit = min(100, max(1, int(query.get("limit", 48))))
    pages = max(1, (total + limit - 1) // limit)
    page = min(pages, max(1, int(query.get("page", 1))))
    # Existing non-paginated callers retain their response; the library requests pages.
    if "page" in query or "limit" in query:
        materials = materials[(page - 1) * limit:page * limit]
    return {"status": "success", "materials": materials, "total": total,
            "page": page, "pages": pages, "tags": all_tags}


async def api_get_materials(request):
    try:
        payload = await asyncio.to_thread(_query_materials, get_materials_dir(), dict(request.query))
        return web.json_response(payload)
    except (TypeError, ValueError):
        return web.json_response({"status": "error", "message": "Invalid material filter"}, status=400)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not list materials"}, status=500)


def _update_material_details(materials_dir, filename, name, tags, prompt_role_overrides=None,
                             update_prompt_roles=False):
    with _material_write_lock:
        path = resolve_within(materials_dir, filename)
        material = _read_material(path)
        material.update(name=name, tags=tags)
        if update_prompt_roles:
            if prompt_role_overrides:
                material["promptRoleOverrides"] = prompt_role_overrides
            else:
                material.pop("promptRoleOverrides", None)
        _atomic_write_json(path, material)
        return _with_live_recipe_source(_material_summary(filename, material))


async def api_update_material(request):
    try:
        payload = await request.json()
        filename = require_filename(payload.get("filename", ""))
        name = payload.get("name", "")
        if not filename.endswith(".json") or filename.startswith(".") or not isinstance(name, str) or not name.strip() or len(name.strip()) > MAX_MATERIAL_NAME_LENGTH:
            raise ValueError("Invalid material details")
        tags = _normalise_material_tags(payload.get("tags", []))
        update_prompt_roles = "promptRoleOverrides" in payload
        prompt_role_overrides = (
            _normalise_prompt_role_overrides(payload.get("promptRoleOverrides"))
            if update_prompt_roles else None
        )
        material = await asyncio.to_thread(
            _update_material_details,
            get_materials_dir(),
            filename,
            name.strip(),
            tags,
            prompt_role_overrides,
            update_prompt_roles,
        )
        return web.json_response({"status": "success", "material": material})
    except (AttributeError, TypeError, ValueError):
        return web.json_response({"status": "error", "message": "Invalid material details"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Material not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not update material"}, status=500)


def _material_detail_response(path, include_workflow):
    material = _read_material(path)
    can_open = (material.get("kind") == "image_workflow_snapshot"
                and (material.get("selection") or {}).get("scope") != "nodes"
                and "open_workflow" in material.get("capabilities", []))
    if include_workflow == "1" and not can_open:
        return web.json_response({"status": "error", "message": "Material cannot open a full workflow"}, status=403)
    workflow = material.get("workflow") or {}
    prompt_roles = _prompt_roles_for_workflow(workflow, material.get("promptRoleOverrides"))
    prompt_groups = _prompt_groups_from_roles(workflow, prompt_roles, _material_node_ids(material))
    blocks = _material_node_blocks(material, include_values=True) if include_workflow != "1" else []
    if include_workflow == "0" or not can_open:
        material.pop("workflow", None)
    return web.json_response({
        "status": "success",
        "data": material,
        "source_recipe": _live_recipe_source(material.get("source") or {}),
        "node_blocks": blocks,
        "workflow_hashes": _workflow_hashes_for_blocks(workflow, blocks),
        "prompt_roles": prompt_roles,
        "prompt_groups": prompt_groups,
    })


async def api_get_material_full(request):
    try:
        filename = require_filename(request.query.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid material filename")
        include_workflow = request.query.get("include_workflow")
        if include_workflow not in (None, "0", "1"):
            raise ValueError("Invalid workflow inclusion flag")
        return await asyncio.to_thread(_material_detail_response,
                                       resolve_within(get_materials_dir(), filename), include_workflow)
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid material"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Material not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read material"}, status=500)


async def api_get_materials_by_node_type(request):
    node_type = request.query.get("type", "")
    if not isinstance(node_type, str) or not node_type.strip() or len(node_type) > 200:
        return web.json_response({"status": "error", "message": "Invalid node type"}, status=400)
    materials_dir = get_materials_dir()

    def collect():
        matches = []
        for summary in _list_materials(materials_dir):
            if node_type not in summary["node_types"]:
                continue
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
        await asyncio.to_thread(_summary_for_path, resolve_within(materials_dir, filename))
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
    with _material_write_lock:
        _read_material(path)
        os.remove(path)
        assets_dir = _material_assets_dir(materials_dir, filename)
        if os.path.isdir(assets_dir):
            shutil.rmtree(assets_dir)
