"""Single-owner persistence, cache, and locking for curated materials."""

import copy
import json
import os
import shutil
import tempfile
import threading
from functools import lru_cache

import folder_paths

from .material_assets import _material_assets_dir, _store_assets
from .material_schema import (
    _is_prompt_node_type,
    _material_category,
    _material_summary,
    _normalise_prompt_note,
    _normalise_prompt_plan,
    _recipe_link_fingerprint,
)
from .parameters import get_parameters_dir
from .recipe_constants import MAX_RECIPE_BYTES
from .recipe_store import _read_recipe, get_recipes_dir
from .utils import atomic_write_json as _atomic_write_json, require_filename, resolve_within
from .workflow_schema import _parameter_signature, _validate_workflow


_material_write_lock = threading.RLock()


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


def _delete_material(materials_dir, filename, path):
    with _material_write_lock:
        _read_material(path)
        os.remove(path)
        assets_dir = _material_assets_dir(materials_dir, filename)
        if os.path.isdir(assets_dir):
            shutil.rmtree(assets_dir)
