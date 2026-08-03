"""Bounded import/export for self-contained Workflow Recipe packages."""

import hashlib
import io
import asyncio
import json
import os
import shutil
import stat
import tempfile
import time
import uuid
import zipfile

from aiohttp import web

from . import recipes as recipe_store
from .recipes import get_recipes_dir
from .utils import require_filename, resolve_within


PACKAGE_VERSION = 1
MAX_UPLOAD_BYTES = 32 * 1024 * 1024
MAX_ENTRY_COUNT = 256
MAX_ENTRY_BYTES = 16 * 1024 * 1024
MAX_EXPANDED_BYTES = 64 * 1024 * 1024
MAX_COMPRESSION_RATIO = 100
MAX_HISTORY_ENTRIES = 100
MAX_JSON_DEPTH = 64
MAX_INSPECTIONS = 4
INSPECTION_TTL_SECONDS = 10 * 60
ALLOWED_COMPRESSION = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
_INSPECTIONS = {}


def _json_depth(value, depth=0):
    if depth > MAX_JSON_DEPTH:
        return depth
    if isinstance(value, dict):
        return max((_json_depth(item, depth + 1) for item in value.values()), default=depth)
    if isinstance(value, list):
        return max((_json_depth(item, depth + 1) for item in value), default=depth)
    return depth


def _sha256(data):
    return hashlib.sha256(data).hexdigest()


def _safe_archive_name(name):
    if not isinstance(name, str) or not name or len(name) > 240:
        raise ValueError("Invalid package entry name")
    if chr(92) in name or name.startswith("/") or ":" in name:
        raise ValueError("Invalid package entry name")
    parts = name.split("/")
    if any(not part or part in (".", "..") for part in parts):
        raise ValueError("Invalid package entry name")
    return name


def _entry_is_symlink(info):
    return stat.S_ISLNK((info.external_attr >> 16) & 0xFFFF)


def _read_zip_entry(archive, name, maximum=MAX_ENTRY_BYTES):
    info = archive.getinfo(name)
    if info.file_size > maximum:
        raise ValueError("Package entry is too large")
    data = archive.read(info)
    if len(data) != info.file_size:
        raise ValueError("Package entry size mismatch")
    return data


def _validate_zip(raw):
    if not isinstance(raw, bytes) or len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("Package upload is too large")
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw), "r")
    except (OSError, zipfile.BadZipFile) as error:
        raise ValueError("Invalid recipe package") from error

    infos = archive.infolist()
    if len(infos) > MAX_ENTRY_COUNT:
        raise ValueError("Too many package entries")
    names = []
    expanded = 0
    for info in infos:
        name = _safe_archive_name(info.filename)
        if name in names or info.is_dir() or _entry_is_symlink(info):
            raise ValueError("Invalid or duplicate package entry")
        if info.compress_type not in ALLOWED_COMPRESSION or info.flag_bits & 0x1:
            raise ValueError("Unsupported package compression")
        if info.file_size > MAX_ENTRY_BYTES:
            raise ValueError("Package entry is too large")
        if info.compress_size and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
            raise ValueError("Package compression ratio is unsafe")
        expanded += info.file_size
        if expanded > MAX_EXPANDED_BYTES:
            raise ValueError("Package expands beyond the safety limit")
        names.append(name)

    if "manifest.json" not in names or "recipe.json" not in names:
        raise ValueError("Package is missing manifest or recipe")
    return archive, names


def _parse_json(data, label):
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Invalid {label}") from error
    if _json_depth(value) > MAX_JSON_DEPTH:
        raise ValueError(f"{label} is nested too deeply")
    return value


def _asset_id_from_reference(reference):
    asset_id = reference.get("preview", {}).get("snapshot_asset_id") if isinstance(reference, dict) else None
    if not isinstance(asset_id, str) or not asset_id.endswith(".webp"):
        return None
    return require_filename(asset_id)


def _cover_asset_id(recipe):
    presentation = recipe.get("presentation", {}) if isinstance(recipe, dict) else {}
    asset_id = presentation.get("cover_asset_id") if isinstance(presentation, dict) else None
    if not isinstance(asset_id, str) or not asset_id.startswith("cover-") or not asset_id.endswith(".webp"):
        return None
    return require_filename(asset_id)


def _validate_manifest(manifest, archive, names):
    if not isinstance(manifest, dict) or manifest.get("package_version") != PACKAGE_VERSION:
        raise ValueError("Unsupported recipe package version")
    declared = manifest.get("entries", [])
    if not isinstance(declared, list) or len(declared) > MAX_ENTRY_COUNT:
        raise ValueError("Invalid package manifest")
    declared_map = {}
    for item in declared:
        if not isinstance(item, dict):
            raise ValueError("Invalid package manifest entry")
        name = _safe_archive_name(item.get("name"))
        if name in declared_map or name not in names:
            raise ValueError("Package manifest does not match archive")
        declared_map[name] = item
    for name in names:
        if name == "manifest.json":
            continue
        item = declared_map.get(name)
        if not item:
            raise ValueError("Package contains undeclared data")
        data = _read_zip_entry(archive, name)
        if item.get("sha256") != _sha256(data) or item.get("size") != len(data):
            raise ValueError("Package checksum mismatch")


def _sanitize_recipe_for_export(recipe, include_snapshots=True, include_identity=True):
    value = json.loads(json.dumps(recipe, ensure_ascii=False))
    # A source_image points into the exporting machine's output directory and
    # is not portable package data. The bounded thumbnail remains the cover.
    value["source_image"] = None
    for reference in value.get("params", {}).get("model_references", []):
        if not include_snapshots:
            reference.pop("preview", None)
        if not include_identity:
            identity = reference.get("identity")
            if isinstance(identity, dict):
                for key in ("sha256", "size", "provenance"):
                    identity.pop(key, None)
                identity["status"] = "unverified"
    return value


def _referenced_asset_ids(recipe, include_model_previews=True):
    result = set()
    cover_asset = _cover_asset_id(recipe)
    if cover_asset:
        result.add(cover_asset)
    if include_model_previews:
        references = recipe.get("params", {}).get("model_references", [])
        for reference in references if isinstance(references, list) else []:
            asset_id = _asset_id_from_reference(reference)
            if asset_id:
                result.add(asset_id)
    return result


def _add_zip_entry(archive, entries, name, data, media_type):
    name = _safe_archive_name(name)
    archive.writestr(name, data)
    entries.append({"name": name, "size": len(data), "sha256": _sha256(data), "media_type": media_type})


def _recipe_history_files(recipes_dir, filename):
    history_dir = recipe_store._history_dir(recipes_dir, filename)
    files = []
    if not os.path.isdir(history_dir):
        return files
    with os.scandir(history_dir) as entries:
        for entry in entries:
            if entry.is_file() and entry.name.endswith(".json"):
                files.append(require_filename(entry.name))
    files.sort()
    return files[:MAX_HISTORY_ENTRIES]


def _build_export(raw_recipe, recipes_dir, filename, options):
    include_snapshots = options.get("include_snapshots") is True
    include_history = options.get("include_history") is True
    include_identity = options.get("include_identity", True) is True
    recipe = _sanitize_recipe_for_export(raw_recipe, include_snapshots, include_identity)
    history_recipes = []
    if include_history:
        for history_name in _recipe_history_files(recipes_dir, filename):
            history_path = resolve_within(recipe_store._history_dir(recipes_dir, filename), history_name)
            with open(history_path, "rb") as history_file:
                data = history_file.read(MAX_ENTRY_BYTES + 1)
            if len(data) > MAX_ENTRY_BYTES:
                raise ValueError("Historical recipe is too large")
            history_recipe = _parse_json(data, "historical recipe")
            history_recipes.append((history_name, _sanitize_recipe_for_export(history_recipe, include_snapshots, include_identity)))
    asset_ids = _referenced_asset_ids(recipe, include_snapshots)
    for _, history_recipe in history_recipes:
        asset_ids.update(_referenced_asset_ids(history_recipe, include_snapshots))
    entries = []
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        recipe_bytes = json.dumps(recipe, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        _add_zip_entry(archive, entries, "recipe.json", recipe_bytes, "application/json")

        if asset_ids:
            assets_dir = recipe_store._recipe_assets_dir(recipes_dir, filename)
            for asset_id in sorted(asset_ids):
                asset_path = resolve_within(assets_dir, asset_id)
                if not os.path.isfile(asset_path):
                    continue
                with open(asset_path, "rb") as asset_file:
                    data = asset_file.read(MAX_ENTRY_BYTES + 1)
                if len(data) > MAX_ENTRY_BYTES or not data.startswith(b"RIFF") or data[8:12] != b"WEBP":
                    continue
                _add_zip_entry(archive, entries, f"assets/{asset_id}", data, "image/webp")

        if include_history:
            for history_name, history_recipe in history_recipes:
                data = json.dumps(history_recipe, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                _add_zip_entry(archive, entries, f"history/{history_name}", data, "application/json")

        manifest = {
            "package_version": PACKAGE_VERSION,
            "recipe_schema_version": recipe.get("schema_version", 1),
            "exported_at": int(time.time() * 1000),
            "options": {
                "include_snapshots": include_snapshots,
                "include_history": include_history,
                "include_identity": include_identity,
            },
            "entries": entries,
        }
        manifest_bytes = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        archive.writestr("manifest.json", manifest_bytes)
    return output.getvalue()


def _validate_recipe_assets(archive, recipes, names):
    referenced = set()
    for recipe in recipes:
        referenced.update(_referenced_asset_ids(recipe))
    for asset_id in referenced:
        name = f"assets/{asset_id}"
        if name not in names:
            raise ValueError("Recipe references a missing snapshot asset")
        data = _read_zip_entry(archive, name)
        if not data.startswith(b"RIFF") or data[8:12] != b"WEBP":
            raise ValueError("Snapshot asset is not a WebP image")
    for name in names:
        if name.startswith("assets/") and (name[7:] not in referenced or not name.endswith(".webp")):
            raise ValueError("Package contains an unreferenced asset")


def _inspect_package(raw):
    archive, names = _validate_zip(raw)
    with archive:
        manifest = _parse_json(_read_zip_entry(archive, "manifest.json"), "manifest")
        _validate_manifest(manifest, archive, names)
        recipe = _parse_json(_read_zip_entry(archive, "recipe.json"), "recipe")
        recipe_store._normalise_recipe(recipe)
        history_names = [name for name in names if name.startswith("history/")]
        if len(history_names) > MAX_HISTORY_ENTRIES:
            raise ValueError("Too many history entries")
        history_recipes = []
        for name in history_names:
            history = _parse_json(_read_zip_entry(archive, name), "historical recipe")
            recipe_store._normalise_recipe(history)
            history_recipes.append(history)
        _validate_recipe_assets(archive, [recipe, *history_recipes], names)
        return {
            "manifest": manifest,
            "recipe": recipe,
            "history_names": history_names,
            "asset_names": [name for name in names if name.startswith("assets/")],
        }


def _prune_inspections():
    now = time.time()
    for token, record in list(_INSPECTIONS.items()):
        if now - record["created"] > INSPECTION_TTL_SECONDS:
            _INSPECTIONS.pop(token, None)
    while len(_INSPECTIONS) >= MAX_INSPECTIONS:
        oldest = min(_INSPECTIONS, key=lambda token: _INSPECTIONS[token]["created"])
        _INSPECTIONS.pop(oldest, None)


def _existing_recipe_names(recipes_dir):
    return [item["data"].get("name", "") for item in recipe_store._list_recipes(recipes_dir)]


def _unique_name(name, existing):
    base = name.strip() or "Imported Workflow Recipe"
    if base not in existing:
        return base
    for index in range(2, 1000):
        candidate = f"{base} ({index})"
        if candidate not in existing:
            return candidate
    raise ValueError("Could not create a unique recipe name")


def _copy_imported_assets(archive, inspection, staging, source_recipe, target_recipe):
    asset_dir = os.path.join(staging, "assets")
    os.makedirs(asset_dir, exist_ok=True)
    for name in inspection["asset_names"]:
        asset_id = require_filename(name.split("/", 1)[1])
        data = _read_zip_entry(archive, name)
        with open(resolve_within(asset_dir, asset_id), "wb") as asset_file:
            asset_file.write(data)

    source_refs = {
        (
            item.get("node_id"),
            item.get("widget_index"),
            item.get("category"),
            item.get("saved_value"),
        ): item
        for item in source_recipe.get("params", {}).get("model_references", [])
        if isinstance(item, dict)
    }
    for target in target_recipe.get("params", {}).get("model_references", []):
        source = source_refs.get((target.get("node_id"), target.get("widget_index"), target.get("category"), target.get("saved_value")))
        asset_id = _asset_id_from_reference(source or {})
        if asset_id and os.path.isfile(resolve_within(asset_dir, asset_id)):
            target["preview"] = source["preview"]


def _write_staged_json(path, value):
    with open(path, "w", encoding="utf-8", newline="\n") as output:
        json.dump(value, output, ensure_ascii=False, separators=(",", ":"))


def _commit_import(record, payload):
    recipes_dir = get_recipes_dir()
    package_recipe = json.loads(json.dumps(record["recipe"], ensure_ascii=False))
    collision = payload.get("collision", "rename")
    name_override = payload.get("name")
    if name_override is not None:
        if not isinstance(name_override, str) or not name_override.strip():
            raise ValueError("Invalid imported recipe name")
        package_recipe["name"] = name_override.strip()

    existing_names = _existing_recipe_names(recipes_dir)
    target_filename = None
    if collision == "replace":
        target_filename = require_filename(payload.get("target_filename", ""))
        if not target_filename.endswith(".json"):
            raise ValueError("Invalid replacement target")
        if not os.path.isfile(resolve_within(recipes_dir, target_filename)):
            raise FileNotFoundError
    elif collision != "rename":
        raise ValueError("Unsupported collision choice")
    else:
        package_recipe["name"] = _unique_name(package_recipe.get("name", ""), existing_names)

    normalized = recipe_store._normalise_recipe(package_recipe)
    normalized["presentation"]["imported"] = True
    filename = target_filename or f"recipe_{int(time.time())}_{uuid.uuid4().hex[:8]}.json"
    normalized = recipe_store._enrich_recipe(normalized)

    staging = tempfile.mkdtemp(prefix=".recipe-import-", dir=recipes_dir)
    final_path = resolve_within(recipes_dir, filename)
    final_assets = recipe_store._recipe_assets_dir(recipes_dir, filename)
    final_history = recipe_store._history_dir(recipes_dir, filename)
    backup_recipe = None
    backup_assets = None
    backup_history = None
    installed_assets = False
    installed_history = False
    try:
        archive, _ = _validate_zip(record["raw"])
        with archive:
            _copy_imported_assets(archive, record, staging, record["recipe"], normalized)
            _write_staged_json(os.path.join(staging, "recipe.json"), normalized)
            if record["history_names"]:
                history_stage = os.path.join(staging, "history")
                os.makedirs(history_stage, exist_ok=True)
                for name in record["history_names"]:
                    history = _parse_json(_read_zip_entry(archive, name), "historical recipe")
                    _write_staged_json(os.path.join(history_stage, require_filename(name.split("/", 1)[1])), history)

        if collision == "replace":
            backup_recipe = os.path.join(staging, "old-recipe.json")
            os.replace(final_path, backup_recipe)
            if os.path.isdir(final_assets):
                backup_assets = os.path.join(staging, "old-assets")
                shutil.move(final_assets, backup_assets)
            if record["history_names"] and os.path.isdir(final_history):
                backup_history = os.path.join(staging, "old-history")
                shutil.move(final_history, backup_history)

        os.replace(os.path.join(staging, "recipe.json"), final_path)
        staged_assets = os.path.join(staging, "assets")
        if os.path.isdir(staged_assets):
            os.replace(staged_assets, final_assets)
            installed_assets = True
        if record["history_names"]:
            history_stage = os.path.join(staging, "history")
            if os.path.isdir(final_history):
                shutil.rmtree(final_history)
            os.replace(history_stage, final_history)
            installed_history = True
    except Exception:
        if collision == "replace" and backup_recipe and os.path.isfile(backup_recipe):
            if installed_assets and os.path.isdir(final_assets):
                shutil.rmtree(final_assets, ignore_errors=True)
            if installed_history and os.path.isdir(final_history):
                shutil.rmtree(final_history, ignore_errors=True)
            if os.path.isfile(final_path):
                os.remove(final_path)
            os.replace(backup_recipe, final_path)
            if backup_assets and os.path.isdir(backup_assets):
                shutil.move(backup_assets, final_assets)
            if backup_history and os.path.isdir(backup_history):
                shutil.move(backup_history, final_history)
        raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return filename, normalized.get("name", "")


async def api_export_recipe_package(request):
    try:
        payload = await request.json()
        filename = require_filename(payload.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid recipe filename")
        recipes_dir = get_recipes_dir()
        recipe = await asyncio.to_thread(recipe_store._read_recipe, resolve_within(recipes_dir, filename))
        package = await asyncio.to_thread(_build_export, recipe, recipes_dir, filename, payload)
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid export request"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Recipe not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not export recipe"}, status=500)
    return web.Response(
        body=package,
        content_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{os.path.splitext(filename)[0]}.anomalous-recipe.zip"'},
    )


async def api_import_recipe_package_inspect(request):
    try:
        raw = await request.content.read(MAX_UPLOAD_BYTES + 1)
        report = await asyncio.to_thread(_inspect_package, raw)
    except (ValueError, OSError, zipfile.BadZipFile):
        return web.json_response({"status": "error", "message": "Invalid recipe package"}, status=400)
    _prune_inspections()
    token = uuid.uuid4().hex
    _INSPECTIONS[token] = {"created": time.time(), "raw": raw, **report}
    return web.json_response({
        "status": "success",
        "token": token,
        "recipe": {"name": report["recipe"].get("name", ""), "tags": report["recipe"].get("tags", [])},
        "asset_count": len(report["asset_names"]),
        "history_count": len(report["history_names"]),
        "existing_names": _existing_recipe_names(get_recipes_dir()),
    })


async def api_import_recipe_package_commit(request):
    try:
        payload = await request.json()
        token = payload.get("token")
        if not isinstance(token, str) or token not in _INSPECTIONS:
            raise ValueError("Invalid inspection token")
        record = _INSPECTIONS.pop(token)
        if time.time() - record["created"] > INSPECTION_TTL_SECONDS:
            raise ValueError("Inspection token expired")
        filename, name = await asyncio.to_thread(_commit_import, record, payload)
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Could not commit recipe package"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "Replacement recipe not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not commit recipe package"}, status=500)
    return web.json_response({"status": "success", "filename": filename, "name": name})
