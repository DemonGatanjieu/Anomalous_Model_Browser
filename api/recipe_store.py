"""User-owned Workflow Recipe records and bounded history persistence."""

import json
import os
import shutil
import tempfile
import time
import uuid

import folder_paths

from .recipe_constants import MAX_HISTORY_VERSIONS
from .recipe_images import _recipe_assets_dir
from .utils import require_filename, resolve_within

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
                        "workflow_fingerprint": data.get("workflow_fingerprint"),
                        "model_reference_count": len(
                            (data.get("params") or {}).get("model_references", [])
                            if isinstance(data.get("params"), dict)
                            else []
                        ),
                    })
                except (OSError, ValueError, json.JSONDecodeError):
                    continue
    except OSError:
        return []
    versions.sort(key=lambda item: item["timestamp"], reverse=True)
    return versions


def _delete_recipe_with_history(recipes_dir, filename):
    """Delete an explicitly selected recipe and its contained local history."""
    os.remove(resolve_within(recipes_dir, filename))
    history_dir = _history_dir(recipes_dir, filename)
    if os.path.isdir(history_dir):
        shutil.rmtree(history_dir)
    assets_dir = _recipe_assets_dir(recipes_dir, filename)
    if os.path.isdir(assets_dir):
        shutil.rmtree(assets_dir)
