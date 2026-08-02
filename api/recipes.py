"""Local, structured Workflow Recipe storage.

Recipes deliberately live under ComfyUI's user directory rather than the
extension repository, so personal prompts and graphs are never Git content.
"""

import asyncio
import json
import os
import shutil
import tempfile
import time
import uuid

from aiohttp import web
import folder_paths

from .utils import require_filename, resolve_within


MAX_NAME_LENGTH = 120
MAX_TAGS = 20
MAX_TAG_LENGTH = 60
MAX_NOTES_LENGTH = 3000
MAX_THUMBNAIL_LENGTH = 1_500_000
MAX_SOURCE_SUBFOLDER_LENGTH = 500
MAX_RECIPE_BYTES = 12 * 1024 * 1024
MAX_HISTORY_VERSIONS = 20
SAFE_THUMBNAIL_PREFIXES = (
    "data:image/jpeg;base64,",
    "data:image/png;base64,",
    "data:image/webp;base64,",
)


def get_recipes_dir():
    """Return the user-owned recipe directory, creating it if needed."""
    user_dir = (
        folder_paths.get_user_directory()
        if hasattr(folder_paths, "get_user_directory")
        else os.path.join(folder_paths.base_path, "user", "default")
    )
    recipes_dir = os.path.join(user_dir, "workflows", "anomalous_recipes")
    os.makedirs(recipes_dir, exist_ok=True)
    return os.path.realpath(recipes_dir)


def _read_recipe(path):
    with open(path, "r", encoding="utf-8") as recipe_file:
        return json.load(recipe_file)


def _list_recipes(recipes_dir):
    recipes = []
    try:
        with os.scandir(recipes_dir) as entries:
            for entry in entries:
                if not entry.is_file() or not entry.name.endswith(".json"):
                    continue
                try:
                    filename = require_filename(entry.name)
                    data = _read_recipe(resolve_within(recipes_dir, filename))
                    if not isinstance(data, dict):
                        continue
                    # The graph can be much larger than all card data combined.
                    summary = {key: value for key, value in data.items() if key != "workflow"}
                    recipes.append({"filename": filename, "data": summary})
                except (OSError, ValueError, json.JSONDecodeError):
                    continue
    except OSError:
        return []
    recipes.sort(key=lambda item: item["data"].get("timestamp", 0), reverse=True)
    return recipes


def _normalise_source_image(value):
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("type") != "output":
        raise ValueError("Invalid source image")
    filename = require_filename(value.get("filename", ""))
    subfolder = value.get("subfolder", "")
    if not isinstance(subfolder, str) or len(subfolder) > MAX_SOURCE_SUBFOLDER_LENGTH:
        raise ValueError("Invalid source image")
    output_dir = folder_paths.get_output_directory()
    resolve_within(output_dir, subfolder)
    return {
        "filename": filename,
        "subfolder": subfolder,
        "type": "output",
    }


def _normalise_recipe(payload):
    if not isinstance(payload, dict):
        raise ValueError("Invalid recipe")

    name = payload.get("name", "")
    if not isinstance(name, str) or not (name := name.strip()) or len(name) > MAX_NAME_LENGTH:
        raise ValueError("Invalid recipe name")

    raw_tags = payload.get("tags", [])
    if not isinstance(raw_tags, list):
        raise ValueError("Invalid recipe tags")
    tags = []
    for tag in raw_tags:
        if not isinstance(tag, str):
            raise ValueError("Invalid recipe tag")
        tag = tag.strip()
        if not tag or len(tag) > MAX_TAG_LENGTH:
            continue
        if tag not in tags:
            tags.append(tag)
        if len(tags) >= MAX_TAGS:
            break

    notes = payload.get("notes", "")
    if not isinstance(notes, str) or len(notes) > MAX_NOTES_LENGTH:
        raise ValueError("Invalid recipe notes")

    params = payload.get("params", {})
    workflow = payload.get("workflow")
    if not isinstance(params, dict) or not isinstance(workflow, dict):
        raise ValueError("Invalid recipe workflow")

    thumbnail = payload.get("thumbnail")
    if thumbnail is not None:
        if (
            not isinstance(thumbnail, str)
            or len(thumbnail) > MAX_THUMBNAIL_LENGTH
            or not thumbnail.lower().startswith(SAFE_THUMBNAIL_PREFIXES)
        ):
            thumbnail = None

    recipe = {
        "schema_version": 1,
        "name": name,
        "tags": tags,
        "notes": notes.strip(),
        "params": params,
        "workflow": workflow,
        "thumbnail": thumbnail,
        "source_image": _normalise_source_image(payload.get("source_image")),
        "timestamp": int(time.time() * 1000),
    }
    encoded = json.dumps(recipe, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_RECIPE_BYTES:
        raise ValueError("Recipe is too large")
    return recipe


def _write_recipe(recipes_dir, filename, recipe):
    path = resolve_within(recipes_dir, filename)
    fd, temp_path = tempfile.mkstemp(prefix=".recipe-", suffix=".tmp", dir=recipes_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as recipe_file:
            json.dump(recipe, recipe_file, ensure_ascii=False, separators=(",", ":"))
            recipe_file.flush()
            os.fsync(recipe_file.fileno())
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def _history_dir(recipes_dir, filename, create=False):
    """Return the contained, user-data-only history directory for one recipe."""
    stem = os.path.splitext(require_filename(filename))[0]
    history_dir = resolve_within(recipes_dir, ".history", stem)
    if create:
        os.makedirs(history_dir, exist_ok=True)
    return history_dir


def _archive_recipe(recipes_dir, filename, recipe):
    """Atomically retain a bounded pre-update snapshot before replacing a recipe."""
    history_dir = _history_dir(recipes_dir, filename, create=True)
    version_name = f"version_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}.json"
    _write_recipe(history_dir, version_name, recipe)

    entries = []
    with os.scandir(history_dir) as scan:
        for entry in scan:
            if entry.is_file() and entry.name.endswith(".json"):
                entries.append(entry)
    entries.sort(key=lambda entry: entry.stat().st_mtime_ns, reverse=True)
    for entry in entries[MAX_HISTORY_VERSIONS:]:
        try:
            os.remove(resolve_within(history_dir, entry.name))
        except OSError:
            pass


def _list_recipe_history(recipes_dir, filename):
    history_dir = _history_dir(recipes_dir, filename)
    versions = []
    try:
        with os.scandir(history_dir) as entries:
            for entry in entries:
                if not entry.is_file() or not entry.name.endswith(".json"):
                    continue
                try:
                    version = require_filename(entry.name)
                    data = _read_recipe(resolve_within(history_dir, version))
                    if not isinstance(data, dict):
                        continue
                    versions.append({
                        "version": version,
                        "timestamp": data.get("timestamp", 0),
                        "name": data.get("name", ""),
                    })
                except (OSError, ValueError, json.JSONDecodeError):
                    continue
    except OSError:
        return []
    versions.sort(key=lambda item: item["timestamp"], reverse=True)
    return versions


def _updated_recipe(payload, existing):
    recipe = _normalise_recipe(payload)
    created_timestamp = existing.get("created_timestamp", existing.get("timestamp"))
    if isinstance(created_timestamp, int):
        recipe["created_timestamp"] = created_timestamp
    recipe["updated_timestamp"] = recipe["timestamp"]
    recipe["schema_version"] = 2
    return recipe


def _delete_recipe_with_history(recipes_dir, filename):
    """Delete an explicitly selected recipe and its contained local history."""
    os.remove(resolve_within(recipes_dir, filename))
    history_dir = _history_dir(recipes_dir, filename)
    if os.path.isdir(history_dir):
        shutil.rmtree(history_dir)


async def api_get_recipes(request):
    recipes_dir = get_recipes_dir()
    recipes = await asyncio.to_thread(_list_recipes, recipes_dir)
    return web.json_response({"recipes": recipes})


async def api_save_recipe(request):
    try:
        recipe = _normalise_recipe(await request.json())
    except (ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe"}, status=400)
    except Exception:
        return web.json_response({"status": "error", "message": "Invalid request"}, status=400)

    recipe["created_timestamp"] = recipe["timestamp"]
    recipe["updated_timestamp"] = recipe["timestamp"]
    recipe["schema_version"] = 2
    filename = f"recipe_{int(time.time())}_{uuid.uuid4().hex[:8]}.json"
    try:
        recipes_dir = get_recipes_dir()
        await asyncio.to_thread(_write_recipe, recipes_dir, filename, recipe)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not save recipe"}, status=500)
    return web.json_response({"status": "success", "filename": filename})


async def api_delete_recipe(request):
    try:
        payload = await request.json()
        filename = require_filename(payload.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid filename")
        recipes_dir = get_recipes_dir()
        path = resolve_within(recipes_dir, filename)
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid filename"}, status=400)
    except Exception:
        return web.json_response({"status": "error", "message": "Invalid request"}, status=400)

    try:
        await asyncio.to_thread(_delete_recipe_with_history, recipes_dir, filename)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not delete recipe"}, status=500)
    return web.json_response({"status": "success"})


async def api_get_recipe_full(request):
    try:
        filename = require_filename(request.query.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid filename")
        recipes_dir = get_recipes_dir()
        path = resolve_within(recipes_dir, filename)
        data = await asyncio.to_thread(_read_recipe, path)
        if not isinstance(data, dict) or not isinstance(data.get("workflow"), dict):
            raise ValueError("Invalid recipe")
    except (ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read recipe"}, status=500)
    return web.json_response({"status": "success", "data": data})


async def api_update_recipe(request):
    """Replace one recipe while preserving its prior state in local history."""
    try:
        payload = await request.json()
        filename = require_filename(payload.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid filename")
        recipes_dir = get_recipes_dir()
        path = resolve_within(recipes_dir, filename)
        existing = await asyncio.to_thread(_read_recipe, path)
        if not isinstance(existing, dict) or not isinstance(existing.get("workflow"), dict):
            raise ValueError("Invalid recipe")
        recipe = _updated_recipe(payload, existing)
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read recipe"}, status=500)
    except Exception:
        return web.json_response({"status": "error", "message": "Invalid request"}, status=400)

    try:
        await asyncio.to_thread(_archive_recipe, recipes_dir, filename, existing)
        await asyncio.to_thread(_write_recipe, recipes_dir, filename, recipe)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not update recipe"}, status=500)
    return web.json_response({"status": "success", "filename": filename})


async def api_get_recipe_history(request):
    try:
        filename = require_filename(request.query.get("filename", ""))
        if not filename.endswith(".json"):
            raise ValueError("Invalid filename")
        recipes_dir = get_recipes_dir()
        # Verify the root recipe exists before exposing its history directory.
        await asyncio.to_thread(_read_recipe, resolve_within(recipes_dir, filename))
        versions = await asyncio.to_thread(_list_recipe_history, recipes_dir, filename)
    except (ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not read recipe history"}, status=500)
    return web.json_response({"status": "success", "versions": versions})


async def api_restore_recipe_version(request):
    try:
        payload = await request.json()
        filename = require_filename(payload.get("filename", ""))
        version = require_filename(payload.get("version", ""))
        if not filename.endswith(".json") or not version.endswith(".json"):
            raise ValueError("Invalid filename")
        recipes_dir = get_recipes_dir()
        existing = await asyncio.to_thread(_read_recipe, resolve_within(recipes_dir, filename))
        historical = await asyncio.to_thread(
            _read_recipe,
            resolve_within(_history_dir(recipes_dir, filename), version),
        )
        if not isinstance(existing, dict) or not isinstance(historical, dict):
            raise ValueError("Invalid recipe")
        recipe = _updated_recipe(historical, existing)
    except (AttributeError, ValueError, json.JSONDecodeError):
        return web.json_response({"status": "error", "message": "Invalid recipe"}, status=400)
    except FileNotFoundError:
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not restore recipe history"}, status=500)
    except Exception:
        return web.json_response({"status": "error", "message": "Invalid request"}, status=400)

    try:
        await asyncio.to_thread(_archive_recipe, recipes_dir, filename, existing)
        await asyncio.to_thread(_write_recipe, recipes_dir, filename, recipe)
    except OSError:
        return web.json_response({"status": "error", "message": "Could not restore recipe history"}, status=500)
    return web.json_response({"status": "success", "filename": filename})
