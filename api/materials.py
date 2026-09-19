"""HTTP routes and compatibility facade for curated material modules."""

import asyncio
import hashlib
import json
import os
import time
import uuid

from aiohttp import web
import folder_paths

from . import material_schema as _schema
from . import material_store as _store
from .material_assets import _inspect_source_image, _material_assets_dir, _store_assets
from .material_schema import (
    MAX_MATERIAL_NAME_LENGTH,
    _extract_workflow_params,
    _is_prompt_node_type,
    _material_category,
    _material_node_blocks,
    _material_node_ids,
    _material_summary,
    _node_blocks,
    _normalise_material_tags,
    _normalise_prompt_role_overrides,
    _normalise_selected_node_ids,
    _parameter_signature,
    _prompt_excerpt,
    _prompt_groups_from_roles,
    _prompt_roles_for_workflow,
    _workflow_hashes_for_blocks,
)
from .notebooks import MAX_NOTEBOOK_BYTES
from .parameters import get_parameters_dir
from .recipe_constants import MAX_RECIPE_BYTES
from .recipe_schema import _build_model_references
from .recipe_store import get_recipes_dir
from .utils import atomic_write_json as _atomic_write_json, require_filename, resolve_within


MATERIAL_SCHEMA_VERSION = 1

_store_get_materials_dir = _store.get_materials_dir
_store_read_material = _store._read_material
_store_read_parameter_source = _store._read_parameter_source
_store_parameter_source_record = _store._parameter_source_record
_store_snapshot_recipe_source = _store._snapshot_recipe_source
_store_live_recipe_source = _store._live_recipe_source
_store_with_live_recipe_source = _store._with_live_recipe_source
_store_summary_for_path = _store._summary_for_path
_store_list_materials = _store._list_materials
_store_persist_material = _store._persist_material
_store_persist_parameter_material = _store._persist_parameter_material
_store_query_materials = _store._query_materials
_store_update_material_details = _store._update_material_details
_store_delete_material = _store._delete_material


def get_materials_dir():
    return _store_get_materials_dir()


def _sync_store_compatibility():
    """Keep historical monkeypatch points effective while storage has one owner."""
    _store._atomic_write_json = _atomic_write_json
    _store._read_material = _read_material
    _store._material_summary = _material_summary
    _store._normalise_prompt_note = _normalise_prompt_note
    _store._normalise_prompt_plan = _normalise_prompt_plan
    _store._material_assets_dir = _material_assets_dir
    _store._store_assets = _store_assets
    _store.get_materials_dir = get_materials_dir


def _normalise_prompt_note(data, prompt_only=False):
    _schema.MAX_NOTEBOOK_BYTES = MAX_NOTEBOOK_BYTES
    return _schema._normalise_prompt_note(data, prompt_only)


def _normalise_prompt_plan(plan):
    _schema.MAX_NOTEBOOK_BYTES = MAX_NOTEBOOK_BYTES
    return _schema._normalise_prompt_plan(plan)


def _read_material(path):
    _store._normalise_prompt_note = _normalise_prompt_note
    _store._normalise_prompt_plan = _normalise_prompt_plan
    return _store_read_material(path)


def _read_parameter_source(recipe_filename, parameter_filename=None):
    _store.get_recipes_dir = get_recipes_dir
    _store.get_parameters_dir = get_parameters_dir
    return _store_read_parameter_source(recipe_filename, parameter_filename)


def _parameter_source_record(recipe_filename, parameter_filename, recipe, source, workflow):
    return _store_parameter_source_record(recipe_filename, parameter_filename, recipe, source, workflow)


def _snapshot_recipe_source(filename):
    _store.get_recipes_dir = get_recipes_dir
    return _store_snapshot_recipe_source(filename)


def _live_recipe_source(source):
    _store.get_recipes_dir = get_recipes_dir
    return _store_live_recipe_source(source)


_cached_material_summary = _store._cached_material_summary


def _with_live_recipe_source(summary):
    _store._live_recipe_source = _live_recipe_source
    return _store_with_live_recipe_source(summary)


def _summary_for_path(path, stat=None):
    _sync_store_compatibility()
    _store._with_live_recipe_source = _with_live_recipe_source
    return _store_summary_for_path(path, stat)


def _list_materials(materials_dir):
    _sync_store_compatibility()
    _store._summary_for_path = _summary_for_path
    return _store_list_materials(materials_dir)


def _persist_material(materials_dir, filename, source_path, material, allow_duplicate=False):
    _sync_store_compatibility()
    _store._list_materials = _list_materials
    return _store_persist_material(materials_dir, filename, source_path, material, allow_duplicate)


def _persist_parameter_material(materials_dir, filename, material, allow_duplicate=False):
    _sync_store_compatibility()
    _store._list_materials = _list_materials
    return _store_persist_parameter_material(materials_dir, filename, material, allow_duplicate)


def _query_materials(materials_dir, query):
    _sync_store_compatibility()
    _store._list_materials = _list_materials
    return _store_query_materials(materials_dir, query)


def _update_material_details(materials_dir, filename, name, tags, prompt_role_overrides=None,
                             update_prompt_roles=False):
    _sync_store_compatibility()
    _store._with_live_recipe_source = _with_live_recipe_source
    return _store_update_material_details(
        materials_dir, filename, name, tags, prompt_role_overrides, update_prompt_roles
    )


def _delete_material(materials_dir, filename, path):
    _sync_store_compatibility()
    return _store_delete_material(materials_dir, filename, path)


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


async def api_get_materials(request):
    try:
        payload = await asyncio.to_thread(_query_materials, get_materials_dir(), dict(request.query))
        return web.json_response(payload)
    except (TypeError, ValueError):
        return web.json_response({"status": "error", "message": "Invalid material filter"}, status=400)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not list materials"}, status=500)


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
