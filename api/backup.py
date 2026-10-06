"""Backups of the user's own data (Settings -> Backup): one .zip to keep anywhere (a cloud
drive, a USB stick), and putting it back on this or another computer.

A backup holds the plugin's stores (Workflow Recipes, combos, materials and saved prompts,
parameter sets), optionally ComfyUI's own saved workflows, the plugin settings without the
Civitai key, what the user set on models: <model>.anomalous.json (name, notes, link) and
the user's cover (any cover that is not a copy of Civitai's <model>.civitai_bak.*), what a
scan found (<model>.info; Civitai's cover only when asked, it can be hundreds of MB), and the
model list (each model's folder, path, size, SHA-256 and link) so the models a new computer
lacks can be downloaded again. Models are found again by SHA-256, else by models folder, path
and size, so they match after a move.

Putting back never erases: a file missing here is added; a file that differs stays unless
"replace" is chosen, and then the one here goes to the Recycle Bin first. A model's user file
is merged field by field (empty fields are filled; "replace" takes the backup's values), and
the backup's cover takes the place of a Civitai cover (whose copy stays as civitai_bak).
"""

import asyncio
import hashlib
import json
import os
import shutil
import tempfile
import time
import uuid
import zipfile

import folder_paths
from aiohttp import web

from .activity_log import add_entry
from .folder_types import config_path
from .material_store import get_materials_dir
from .metadata import USER_FIELDS, clear_metadata_cache, get_metadata
from .model_constants import CIVITAI_BACKUP_SUFFIXES, MEDIA_EXTENSIONS, PREVIEW_SUFFIXES, RESOLVABLE_MODEL_TYPES, is_model_file
from .model_download import settings_path as download_settings_path
from .notebooks import get_notebooks_dir
from .parameters import _invalidate_parameter_notebooks_cache, get_parameters_dir
from .path_utils import atomic_write_json, require_filename, resolve_within
from .recipe_store import get_recipes_dir
from .trash import TrashUnavailable, move_to_trash, trash_failure
from . import version_manager

try:
    from ..model_identity import USER_INFO_SUFFIX, read_json, scan_info_path
except ImportError:
    from model_identity import USER_INFO_SUFFIX, read_json, scan_info_path

FORMAT = 1
APP = "Anomalous Model Browser"
ACTIVE_COVER_SUFFIXES = PREVIEW_SUFFIXES + MEDIA_EXTENSIONS  # as scraper.py: <model>.preview.png or <model>.png
SECRET_KEYS = {"CIVITAI_API_KEY", "DEEPL_API_KEY"}  # never leave this computer
SCAN_INFO_SUFFIXES = (".info", ".civitai.info")
SKIP_FILES = {".legacy_imported.json"}  # this computer's own migration marker
MAX_BACKUP_BYTES = 4 * 1024 ** 3  # unpacked size of a backup that is still read
MAX_MEMBERS = 200_000
KEEP_EXPORTS = 3  # finished exports kept in the temp folder for downloading
CHUNK = 1024 * 1024

PART_ORDER = ("recipes", "combos", "materials", "parameters", "comfy_workflows")


def _comfy_workflows_dir():
    return os.path.join(folder_paths.get_user_directory(), "default", "workflows")


def part_dirs():
    """Each kept store and where it lives on this computer."""
    return {
        "recipes": get_recipes_dir(),
        "combos": get_notebooks_dir(),
        "materials": get_materials_dir(),
        "parameters": get_parameters_dir(),
        "comfy_workflows": _comfy_workflows_dir(),
    }


def work_dir():
    path = os.path.join(folder_paths.get_temp_directory(), "anomalous_backups")
    os.makedirs(path, exist_ok=True)
    return path


def _sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def _same_bytes(a, b):
    try:
        return os.path.getsize(a) == os.path.getsize(b) and _sha256_file(a) == _sha256_file(b)
    except OSError:
        return False


def _store_files(directory):
    """(path, '/'-relative path) of every file kept in a store."""
    if not os.path.isdir(directory):
        return
    for root, dirs, files in os.walk(directory):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__")
        for name in sorted(files):
            if name in SKIP_FILES or name.endswith(".tmp"):
                continue
            path = os.path.join(root, name)
            yield path, os.path.relpath(path, directory).replace(os.sep, "/")


def _model_roots():
    """(models folder type, folder) once per folder: clip and text_encoders often share one."""
    seen = set()
    for folder_type in RESOLVABLE_MODEL_TYPES:
        try:
            roots = folder_paths.get_folder_paths(folder_type) or []
        except Exception:  # noqa: BLE001 - a type this ComfyUI does not know
            continue
        for root in roots:
            key = os.path.normcase(os.path.abspath(root))
            if key in seen or not os.path.isdir(root):
                continue
            seen.add(key)
            yield folder_type, root


def _models():
    """(type, root, path, '/'-relative path) of every model file."""
    for folder_type, root in _model_roots():
        for walk_root, dirs, files in os.walk(root):
            dirs.sort()
            for name in sorted(files):
                if is_model_file(name):
                    path = os.path.join(walk_root, name)
                    yield folder_type, root, path, os.path.relpath(path, root).replace(os.sep, "/")


def cover_owners(base):
    """(Civitai's, the user's) covers of a model: Civitai's are copies of <model>.civitai_bak.*."""
    backups = [base + suffix for suffix in CIVITAI_BACKUP_SUFFIXES if os.path.isfile(base + suffix)]
    covers = [base + suffix for suffix in ACTIVE_COVER_SUFFIXES if os.path.isfile(base + suffix)]
    civitai = [cover for cover in covers if any(_same_bytes(cover, backup) for backup in backups)]
    return civitai, [cover for cover in covers if cover not in civitai]


def _model_facts(path):
    """(SHA-256, download page) from the model's sidecars; nothing is computed."""
    try:
        meta = get_metadata(path) or {}
    except Exception:  # noqa: BLE001 - an unreadable sidecar only means "match by path"
        return "", ""
    return str(meta.get("hash") or "").lower(), str(meta.get("source_url") or meta.get("civitai_url") or "")


def _model_hash(path):
    return _model_facts(path)[0]


def _settings_for_backup():
    data = read_json(config_path()) or {}
    return {key: value for key, value in data.items() if key not in SECRET_KEYS}


def _version():
    try:
        return version_manager.current_state().get("label") or ""
    except Exception:  # noqa: BLE001 - a copy that is no git checkout
        return ""


# ---------- export ----------

def build_backup(include_models=True, include_comfy=True, include_library=True, include_scan=True, include_civitai_covers=False):
    """Writes the backup .zip into the temp folder: (path, manifest)."""
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = os.path.join(work_dir(), f"AMB-backup-{stamp}.zip")
    manifest = {"format": FORMAT, "app": APP, "version": _version(), "created": time.time(), "parts": {}, "settings": False, "models": []}
    parts = [part for part in PART_ORDER if include_comfy or part != "comfy_workflows"]
    dirs = part_dirs()
    temporary = path + ".tmp"
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            for part in parts:
                count = 0
                for file_path, rel in _store_files(dirs[part]):
                    archive.write(file_path, f"stores/{part}/{rel}")
                    count += 1
                manifest["parts"][part] = count
            archive.writestr("settings/config.json", json.dumps(_settings_for_backup(), ensure_ascii=False))
            if os.path.isfile(download_settings_path()):
                archive.write(download_settings_path(), "settings/download_settings.json")
            manifest["settings"] = True
            if include_library:
                manifest["library"] = []
            if include_models or include_library:
                for folder_type, _root, model_path, rel in _models():
                    if include_library:
                        digest, page = _model_facts(model_path)
                        manifest["library"].append({"type": folder_type, "rel": rel, "size": os.path.getsize(model_path),
                                                    "sha256": digest, "url": page})
                    if not include_models:
                        continue
                    base = os.path.splitext(model_path)[0]
                    user_file = base + USER_INFO_SUFFIX
                    user_data = read_json(user_file) if os.path.isfile(user_file) else None
                    civitai, covers = cover_owners(base)
                    scan_info = scan_info_path(base) if include_scan else None
                    backups = [base + suffix for suffix in CIVITAI_BACKUP_SUFFIXES if os.path.isfile(base + suffix)]
                    civitai_cover = civitai[0] if include_civitai_covers and civitai and backups else None
                    if not user_data and not covers and not scan_info and not civitai_cover:
                        continue
                    entry = {"id": len(manifest["models"]), "type": folder_type, "rel": rel,
                             "size": os.path.getsize(model_path), "sha256": _model_hash(model_path), "user": bool(user_data), "cover": ""}
                    folder = f"models/{entry['id']}/"
                    if user_data:
                        archive.writestr(folder + "user.json", json.dumps(user_data, ensure_ascii=False))
                    if covers:
                        entry["cover"] = covers[0][len(base):]
                        archive.write(covers[0], f"{folder}cover{entry['cover']}")
                    if scan_info:
                        entry["info"] = scan_info[len(base):]
                        archive.write(scan_info, f"{folder}scan{entry['info']}")
                    if civitai_cover:
                        # One copy: it is both the cover and Civitai's saved image (<model>.civitai_bak.*).
                        entry["civitai_cover"], entry["civitai_bak"] = civitai_cover[len(base):], backups[0][len(base):]
                        archive.write(backups[0], f"{folder}civitai{entry['civitai_bak']}")
                    manifest["models"].append(entry)
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)
    _prune_exports()
    return path, manifest


def _prune_exports():
    """Keeps the newest finished exports; older ones are this plugin's own temp files."""
    exports = sorted((name for name in os.listdir(work_dir()) if name.startswith("AMB-backup-") and name.endswith(".zip")), reverse=True)
    for name in exports[KEEP_EXPORTS:]:
        try:
            os.remove(os.path.join(work_dir(), name))
        except OSError:
            pass


# ---------- reading a backup ----------

class BackupError(ValueError):
    """A file that is no backup of this plugin, or one that cannot be read safely."""


def _safe_rel(rel):
    parts = rel.split("/")
    if not rel or rel.startswith("/") or "\\" in rel or ":" in rel or any(part in ("", ".", "..") for part in parts):
        raise BackupError(f"unsafe path in the backup: {rel}")
    return parts


def open_backup(path):
    """The zip and its manifest, after checking it is a backup and safe to unpack."""
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as error:
        raise BackupError("not a zip file") from error
    try:
        infos = archive.infolist()
        if len(infos) > MAX_MEMBERS or sum(info.file_size for info in infos) > MAX_BACKUP_BYTES:
            raise BackupError("the backup is too large")
        try:
            manifest = json.loads(archive.read("manifest.json"))
        except (KeyError, ValueError) as error:
            raise BackupError("no manifest: not a backup of this plugin") from error
        if not isinstance(manifest, dict) or manifest.get("app") != APP or manifest.get("format") != FORMAT:
            raise BackupError("not a backup of this plugin, or one from a newer version")
        for info in infos:
            if not info.is_dir():
                _safe_rel(info.filename)
        return archive, manifest
    except Exception:
        archive.close()
        raise


def _store_members(archive):
    """(part, '/'-relative path, ZipInfo) of each kept store file in the backup."""
    for info in archive.infolist():
        name = info.filename
        if info.is_dir() or not name.startswith("stores/"):
            continue
        bits = name.split("/", 2)
        if len(bits) == 3 and bits[1] in PART_ORDER:
            _, part, rel = bits
            _safe_rel(rel)
            yield part, rel, info


def _member_sha256(archive, info):
    digest = hashlib.sha256()
    with archive.open(info) as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def _file_state(archive, info, target):
    if not os.path.isfile(target):
        return "new"
    if os.path.getsize(target) == info.file_size and _sha256_file(target) == _member_sha256(archive, info):
        return "same"
    return "differs"


def _local_models():
    """This computer's models: by SHA-256 and by (type, path) -> (path, size)."""
    by_hash, by_rel = {}, {}
    for folder_type, _root, path, rel in _models():
        size = os.path.getsize(path)
        digest = _model_hash(path)
        if digest:
            by_hash.setdefault(digest, path)
        by_rel[(folder_type, rel.lower())] = (path, size)
    return by_hash, by_rel


def _match(entry, by_hash, by_rel):
    digest = str(entry.get("sha256") or "").lower()
    if digest and digest in by_hash:
        return by_hash[digest]
    found = by_rel.get((entry.get("type"), str(entry.get("rel") or "").lower()))
    return found[0] if found and found[1] == entry.get("size") else None


def inspect_backup(path):
    """What putting the backup back would do, before anything is written."""
    archive, manifest = open_backup(path)
    with archive:
        dirs = part_dirs()
        parts = {}
        for part, rel, info in _store_members(archive):
            counts = parts.setdefault(part, {"new": 0, "same": 0, "differs": 0})
            counts[_file_state(archive, info, resolve_within(dirs[part], *rel.split("/")))] += 1
        models = {"total": len(manifest.get("models") or []), "matched": 0, "missing": []}
        library = manifest.get("library") if isinstance(manifest.get("library"), list) else None
        summary = {"created": manifest.get("created"), "version": manifest.get("version") or "",
                   "parts": {part: parts[part] for part in PART_ORDER if part in parts},
                   "settings": bool(manifest.get("settings")), "models": models}
        if models["total"] or library:
            by_hash, by_rel = _local_models()
            for entry in manifest.get("models") or []:
                if _match(entry, by_hash, by_rel):
                    models["matched"] += 1
                else:
                    models["missing"].append(entry.get("rel") or "")
            if library is not None:
                # The models the old computer had and this one lacks: what can be downloaded again
                # (two copies of one file there are one download here).
                missing, seen = [], set()
                for entry in library:
                    if not isinstance(entry, dict) or _match(entry, by_hash, by_rel):
                        continue
                    digest = str(entry.get("sha256") or "").lower()
                    if digest and digest in seen:
                        continue
                    seen.add(digest)
                    missing.append({key: entry.get(key) for key in ("type", "rel", "size", "sha256", "url")})
                summary["library"] = {"total": len(library), "missing": missing}
        return summary


# ---------- putting back ----------

def _write_member(archive, info, target):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".restore-", suffix=".tmp", dir=os.path.dirname(target))
    try:
        with os.fdopen(fd, "wb") as output, archive.open(info) as source:
            shutil.copyfileobj(source, output, CHUNK)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)


def _restore_stores(archive, wanted, replace, result):
    dirs = part_dirs()
    for part, rel, info in _store_members(archive):
        if part not in wanted:
            continue
        target = resolve_within(dirs[part], *rel.split("/"))
        state = _file_state(archive, info, target)
        if state == "same" or (state == "differs" and not replace):
            result["skipped"] += 1
            continue
        if state == "differs":
            try:
                move_to_trash(target)
            except (TrashUnavailable, OSError) as error:
                result["failed"].append(f"{part}/{rel}: {trash_failure(error)}")
                continue
            result["replaced"] += 1
        else:
            result["added"] += 1
        _write_member(archive, info, target)


def _restore_scan(archive, entry, base, folder, replace, result):
    """What a scan found: the scan file where there is none (or replaced on request), and
    Civitai's cover where the model has no cover at all."""
    suffix = str(entry.get("info") or "")
    if suffix:
        if suffix not in SCAN_INFO_SUFFIXES:
            raise BackupError(f"unknown scan file name: {suffix}")
        info = archive.getinfo(folder + "scan" + suffix)
        local = scan_info_path(base)
        if not local or (replace and _sha256_file(local) != _member_sha256(archive, info)):
            if local:
                move_to_trash(local)
            _write_member(archive, info, base + suffix)
            result["model_infos"] += 1
    cover, saved = str(entry.get("civitai_cover") or ""), str(entry.get("civitai_bak") or "")
    if cover and saved:
        if cover not in ACTIVE_COVER_SUFFIXES or saved not in CIVITAI_BACKUP_SUFFIXES:
            raise BackupError(f"unknown cover name: {cover}")
        info = archive.getinfo(folder + "civitai" + saved)
        civitai, mine = cover_owners(base)
        has_saved = any(os.path.isfile(base + suffix) for suffix in CIVITAI_BACKUP_SUFFIXES)
        if not has_saved:
            _write_member(archive, info, base + saved)
        if not civitai and not mine and not entry.get("cover"):
            _write_member(archive, info, base + cover)
            result["model_civitai_covers"] += 1


def _restore_model(archive, entry, model_path, replace, result):
    base = os.path.splitext(model_path)[0]
    folder = f"models/{int(entry['id'])}/"
    _restore_scan(archive, entry, base, folder, replace, result)
    if entry.get("user"):
        backup = json.loads(archive.read(folder + "user.json"))
        user_file = base + USER_INFO_SUFFIX
        local = read_json(user_file) if os.path.isfile(user_file) else None
        merged = dict(local or {"format": 1})
        for key in USER_FIELDS:
            value = str(backup.get(key) or "").strip()
            if value and (replace or not str(merged.get(key) or "").strip()):
                merged[key] = backup[key]
        if merged != (local or {"format": 1}):
            if local and replace:
                move_to_trash(user_file)  # the old values stay recoverable
            atomic_write_json(user_file, merged)
            result["model_notes"] += 1
    suffix = str(entry.get("cover") or "")
    if suffix:
        if suffix not in ACTIVE_COVER_SUFFIXES:
            raise BackupError(f"unknown cover name: {suffix}")
        info = archive.getinfo(folder + "cover" + suffix)
        civitai, mine = cover_owners(base)
        member_hash = _member_sha256(archive, info)
        if any(_sha256_file(cover) == member_hash for cover in mine):
            return
        if mine and not replace:
            result["covers_kept"] += 1
            return
        for cover in mine + civitai:  # Civitai's own copy stays as <model>.civitai_bak.*
            move_to_trash(cover)
        _write_member(archive, info, base + suffix)
        result["model_covers"] += 1


def _restore_settings(archive, result):
    names = set(archive.namelist())
    if "settings/config.json" in names:
        backup = json.loads(archive.read("settings/config.json"))
        local = read_json(config_path()) or {}
        merged = {**{key: value for key, value in backup.items() if key not in SECRET_KEYS},
                  **{key: local[key] for key in SECRET_KEYS if key in local}}
        atomic_write_json(config_path(), merged)
        result["settings"] = True
    if "settings/download_settings.json" in names:
        os.makedirs(os.path.dirname(download_settings_path()), exist_ok=True)
        atomic_write_json(download_settings_path(), json.loads(archive.read("settings/download_settings.json")))


def apply_backup(path, parts=PART_ORDER, models=True, settings=False, replace=False):
    """Puts the backup back as chosen; returns the counts for the user and the activity log."""
    archive, manifest = open_backup(path)
    result = {"added": 0, "replaced": 0, "skipped": 0, "model_notes": 0, "model_covers": 0, "model_infos": 0,
              "model_civitai_covers": 0, "covers_kept": 0, "models_missing": 0, "settings": False, "failed": []}
    with archive:
        _restore_stores(archive, set(parts) & set(PART_ORDER), replace, result)
        if models and manifest.get("models"):
            by_hash, by_rel = _local_models()
            for entry in manifest["models"]:
                model_path = _match(entry, by_hash, by_rel)
                if not model_path:
                    result["models_missing"] += 1
                    continue
                try:
                    _restore_model(archive, entry, model_path, replace, result)
                except (TrashUnavailable, OSError, KeyError, ValueError) as error:
                    result["failed"].append(f"{entry.get('rel')}: {trash_failure(error) if isinstance(error, (TrashUnavailable, OSError)) else error}")
            clear_metadata_cache()
        if settings and manifest.get("settings"):
            _restore_settings(archive, result)
    _invalidate_parameter_notebooks_cache()
    return result


# ---------- routes ----------

def _error(message, status=400):
    return web.json_response({"status": "error", "error": str(message)}, status=status)


async def api_export(request):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - no body: the defaults
        body = {}
    path, manifest = await asyncio.to_thread(build_backup, body.get("models", True) is not False,
                                             body.get("comfy_workflows", True) is not False, body.get("library", True) is not False,
                                             body.get("scan", True) is not False, body.get("civitai_covers") is True)
    counts = {**manifest["parts"], "models": len(manifest["models"]), "library": len(manifest.get("library") or [])}
    await asyncio.to_thread(add_entry, "file", "backup_export", os.path.basename(path), {"backup": counts})
    return web.json_response({"status": "success", "name": os.path.basename(path), "size": os.path.getsize(path), "counts": counts})


async def api_file(request):
    try:
        name = require_filename(request.query.get("name", ""))
        if not name.startswith("AMB-backup-") or not name.endswith(".zip"):
            raise ValueError("not a backup")
        path = resolve_within(work_dir(), name)
    except ValueError as error:
        return _error(error)
    if not os.path.isfile(path):
        return _error("This backup is gone; export it again.", 404)
    return web.FileResponse(path, headers={"Content-Disposition": f'attachment; filename="{name}"'})


async def api_inspect(request):
    """Receives the chosen .zip, keeps it in the temp folder and says what putting it back would do."""
    reader = await request.multipart()
    field = await reader.next()
    if field is None or field.name != "file":
        return _error("no file")
    token = uuid.uuid4().hex
    path = os.path.join(work_dir(), f"incoming-{token}.zip")
    size = 0
    with open(path, "wb") as output:
        while chunk := await field.read_chunk(CHUNK):
            size += len(chunk)
            if size > MAX_BACKUP_BYTES:
                output.close()
                os.remove(path)
                return _error("the backup is too large")
            output.write(chunk)
    try:
        summary = await asyncio.to_thread(inspect_backup, path)
    except BackupError as error:
        os.remove(path)
        return _error(error)
    return web.json_response({"status": "success", "token": token, **summary})


async def api_apply(request):
    try:
        body = await request.json()
        token = str(body.get("token") or "")
        if not token.isalnum():
            raise ValueError("bad token")
        path = resolve_within(work_dir(), f"incoming-{token}.zip")
    except Exception as error:  # noqa: BLE001
        return _error(error)
    if not os.path.isfile(path):
        return _error("This backup is gone; choose the file again.", 404)
    parts = [part for part in body.get("parts") or [] if part in PART_ORDER]
    try:
        result = await asyncio.to_thread(apply_backup, path, parts, body.get("models") is not False,
                                         body.get("settings") is True, body.get("replace") is True)
    except BackupError as error:
        return _error(error)
    os.remove(path)
    await asyncio.to_thread(add_entry, "file", "backup_import", str(body.get("name") or ""), {"backup": {**result, "failed": result["failed"][:20]}})
    return web.json_response({"status": "success", **result})


def register_routes(app):
    app.router.add_post("/anomalous/backup/export", api_export)
    app.router.add_get("/anomalous/backup/file", api_file)
    app.router.add_post("/anomalous/backup/inspect", api_inspect)
    app.router.add_post("/anomalous/backup/apply", api_apply)
