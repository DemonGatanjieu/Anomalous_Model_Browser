"""Putting a model file the user drops on the models page into the right models folder.

A browser gives a dropped file's name, size, time and bytes, never its path. So:
GET  /anomalous/import/folders  -> {types: {type: roots}, settings}: the folders a model can go to
    (model_download.roots_of) and the download settings, whose folder rule ({base}) imports share.
POST /anomalous/import/inspect?name&size&mtime  body: the file's first bytes (its header)
    -> what it is (model_kind.classify), files of the same name already there, and, when this
    computer's Downloads or Desktop holds that very file (same name, size and time; asked only
    by the computer ComfyUI runs on), a `token` for it.
POST /anomalous/import/identify {token} -> its SHA-256, what Civitai knows of it (base model,
    model and version name) and a scanned model with the same SHA-256, if any.
POST /anomalous/import/place {token, type, root, rel, keep} -> moves that file there (a copy
    when `keep`); same drive = a rename, another drive = copy, then the original goes.
PUT  /anomalous/import/upload?type&root&rel&size  body: the whole file -> written there.

A file already at the destination is never replaced: the new one gets " (2)". Each import is
one activity log entry (model_import).
"""

import asyncio
import os
import shutil
import threading
import time
import uuid

from aiohttp import web
import folder_paths

try:
    from ..model_identity import file_sha256
    from ..model_kind import classify, inspect_file, parse_gguf, parse_safetensors
except ImportError:  # loaded outside the package (tests)
    from model_identity import file_sha256
    from model_kind import classify, inspect_file, parse_gguf, parse_safetensors
from .activity_log import add_entry
from .download_sources import SourceUnreachable, civitai_by_hash
from .mcp_server import _is_local
from .model_download import (
    CHUNK, MODEL_EXTENSIONS, SPACE_MARGIN, clean_folder, folder_type_for, forget_file_lists, read_settings, roots_of,
)
from .path_utils import resolve_within

KINDS = ("checkpoints", "loras", "vae", "text_encoders", "diffusion_models", "controlnet", "embeddings",
         "clip_vision", "upscale_models", "ipadapter")
SEARCH_DEPTH = 2
SEARCH_LIMIT = 20000
TIME_SLACK_MS = 2000
KEEP_TOKENS = 200
_FOLDER_IDS = {  # Windows known folders: Downloads, Desktop
    "downloads": "{374DE290-123F-4565-9164-39C4925E467B}",
    "desktop": "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}",
}

_lock = threading.Lock()
_tokens = {}  # token -> {path, name, size}


class Refused(Exception):
    """An import that cannot be done; `code` says why (the page has a sentence for each)."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _error(code, status=400):
    return web.json_response({"error": code}, status=status)


# --- where the dropped file is on this computer --------------------------------------------

def _known_folder(name):
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes
            folder_id = uuid.UUID(_FOLDER_IDS[name]).bytes_le
            path = ctypes.c_wchar_p()
            shell = ctypes.windll.shell32
            shell.SHGetKnownFolderPath.argtypes = [ctypes.c_char_p, wintypes.DWORD, wintypes.HANDLE, ctypes.POINTER(ctypes.c_wchar_p)]
            if shell.SHGetKnownFolderPath(folder_id, 0, None, ctypes.byref(path)) == 0:
                found = path.value
                ctypes.windll.ole32.CoTaskMemFree(path)
                if found and os.path.isdir(found):
                    return found
        except Exception:
            pass
    fallback = os.path.expanduser("~/" + name.capitalize())
    return fallback if os.path.isdir(fallback) else ""


def search_folders():
    """[(label, path)] where dropped files usually come from: Downloads, then Desktop."""
    found = []
    for label in ("downloads", "desktop"):
        path = _known_folder(label)
        if path and all(os.path.realpath(path) != os.path.realpath(other) for _, other in found):
            found.append((label, path))
    return found


def find_original(name, size, mtime_ms, folders=None):
    """(label, path) of the file with this name, size and time in `folders` (and their
    subfolders two deep), else None."""
    wanted = name.lower()
    seen = 0
    for label, base in folders if folders is not None else search_folders():
        for current, dirs, files in os.walk(base):
            depth = 0 if current == base else os.path.relpath(current, base).count(os.sep) + 1
            dirs[:] = sorted(item for item in dirs if not item.startswith(".")) if depth < SEARCH_DEPTH else []
            for file in files:
                seen += 1
                if seen > SEARCH_LIMIT:
                    return None
                if file.lower() != wanted:
                    continue
                path = os.path.join(current, file)
                try:
                    stat = os.stat(path)
                except OSError:
                    continue
                if stat.st_size == size and (not mtime_ms or abs(stat.st_mtime * 1000 - mtime_ms) <= TIME_SLACK_MS):
                    return label, path
    return None


def _remember(path, name, size):
    token = uuid.uuid4().hex
    with _lock:
        _tokens[token] = {"path": path, "name": name, "size": size}
        while len(_tokens) > KEEP_TOKENS:
            _tokens.pop(next(iter(_tokens)))
    return token


def _original(token):
    with _lock:
        item = _tokens.get(str(token or ""))
    if not item or not os.path.isfile(item["path"]) or os.path.getsize(item["path"]) != item["size"]:
        raise Refused("gone")
    return item


# --- what it is ----------------------------------------------------------------------------

def import_types():
    known = getattr(folder_paths, "folder_names_and_paths", {})
    return [kind for kind in KINDS if kind in known]


def classify_head(name, head):
    """classify() from a file's first bytes, by its extension."""
    lower = name.lower()
    if lower.endswith((".safetensors", ".sft")):
        return classify("safetensors", parse_safetensors(head))
    if lower.endswith(".gguf"):
        return classify("gguf", parse_gguf(head))
    return classify(None, None)


def same_name(kind, name):
    """Files of this name already in the type's folders: [{root, rel, size}]."""
    if not kind:
        return []
    wanted, found = name.lower(), []
    for index, base in enumerate(folder_paths.get_folder_paths(kind) or []):
        if not os.path.isdir(base):
            continue
        for current, _dirs, files in os.walk(base):
            for file in files:
                if file.lower() == wanted:
                    path = os.path.join(current, file)
                    found.append({"root": index, "rel": os.path.relpath(path, base).replace(os.sep, "/"),
                                  "size": os.path.getsize(path)})
    return found[:10]


def inspect(name, size, mtime_ms, head, local):
    found = find_original(name, size, mtime_ms) if local else None
    if found:
        result = inspect_file(found[1])
        result.pop("format", None)
        result.update(token=_remember(found[1], name, size), where=found[0])
    else:
        result = classify_head(name, head)
    if result["kind"] not in import_types():
        result.update(kind="", sure=False)
    result["same_name"] = same_name(result["kind"], name)
    return result


def _same_hash(sha256):
    """Where a scanned model with this SHA-256 is ("sub/name.safetensors"), else None."""
    from .model_resolution import collect_model_hash_index
    names = [key for key, value in collect_model_hash_index().items() if str(value.get("hash") or "").lower() == sha256]
    return next((key for key in names if "/" in key), names[0] if names else None)


def identify(token):
    """SHA-256, Civitai's record, and an already scanned copy, of a found file."""
    item = _original(token)
    sha256 = file_sha256(item["path"])
    result = {"sha256": sha256, "civitai": None, "reason": "", "duplicate": _same_hash(sha256)}
    try:
        found = civitai_by_hash(sha256)
        if found:
            result["civitai"] = {key: found.get(key, "") for key in ("base_model", "model_name", "version_name", "page")}
        else:
            result["reason"] = "not_found"
    except SourceUnreachable:
        result["reason"] = "network"
    return result


# --- putting it there ----------------------------------------------------------------------

def free_path(path):
    """`path`, or "name (2).ext", "name (3).ext"… when it is taken."""
    if not os.path.exists(path) and not os.path.exists(path + ".part"):
        return path
    stem, ext = os.path.splitext(path)
    number = 2
    while os.path.exists(f"{stem} ({number}){ext}") or os.path.exists(f"{stem} ({number}){ext}.part"):
        number += 1
    return f"{stem} ({number}){ext}"


def destination(data, size=0):
    """(type, root index, root path, dest) for a place/upload request; Refused if refused."""
    folder_type = folder_type_for([data.get("type")])
    if folder_type not in import_types():
        raise Refused("bad_type")
    paths = folder_paths.get_folder_paths(folder_type) or []
    try:
        root_index = int(data.get("root", 0))
    except (TypeError, ValueError):
        raise Refused("bad_root")
    if not 0 <= root_index < len(paths):
        raise Refused("bad_root")
    try:
        rel = clean_folder(data.get("rel"))
        root = os.path.realpath(paths[root_index])
        dest = resolve_within(root, *rel.split("/"))
    except ValueError:
        raise Refused("bad_path")
    if not rel.lower().endswith(MODEL_EXTENSIONS):
        raise Refused("bad_name")
    probe = root
    while probe and not os.path.isdir(probe):
        probe = os.path.dirname(probe)
    if size and probe and shutil.disk_usage(probe).free < size + SPACE_MARGIN:
        raise Refused("no_space")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    return folder_type, root_index, root, free_path(dest)


def _same_drive(first, second):
    try:
        return os.stat(first).st_dev == os.stat(os.path.dirname(second)).st_dev
    except OSError:
        return False


def move_into(source, dest, keep):
    """Moves (or with `keep` copies) `source` to `dest`; a copy goes through "<dest>.part"."""
    if not keep and _same_drive(source, dest):
        os.replace(source, dest)
        return
    part = dest + ".part"
    try:
        shutil.copyfile(source, part)
        if os.path.getsize(part) != os.path.getsize(source):
            raise Refused("incomplete")
        os.replace(part, dest)
    except BaseException:
        if os.path.exists(part):
            os.remove(part)  # our own unfinished copy
        raise
    if not keep:
        os.remove(source)  # moved: the whole file is at dest now


def _finish(folder_type, root_index, root, dest, how, size):
    forget_file_lists()
    rel = os.path.relpath(dest, root).replace(os.sep, "/")
    add_entry("file", "model_import", rel, {"import": {
        "type": folder_type, "path_idx": root_index, "rel": rel, "file": os.path.basename(dest), "size": size, "how": how,
    }})
    return {"type": folder_type, "root": root_index, "rel": rel, "file": os.path.basename(dest)}


def place(data):
    item = _original(data.get("token"))
    keep = data.get("keep") is True
    folder_type, root_index, root, dest = destination(data, item["size"] if keep else 0)
    move_into(item["path"], dest, keep)
    if not keep:
        with _lock:
            _tokens.pop(str(data.get("token")), None)
    return _finish(folder_type, root_index, root, dest, "copy" if keep else "move", item["size"])


# --- routes --------------------------------------------------------------------------------

async def api_folders(request):
    types = {}
    for kind in import_types():
        types[kind] = await asyncio.to_thread(roots_of, kind)
    return web.json_response({"types": types, "settings": read_settings()})


async def api_inspect(request):
    name = os.path.basename(str(request.query.get("name") or "").replace("\\", "/"))
    if not name.lower().endswith(MODEL_EXTENSIONS):
        return _error("not_model")
    try:
        size = int(request.query.get("size") or 0)
        mtime_ms = float(request.query.get("mtime") or 0)
    except ValueError:
        return _error("bad_request")
    head = await request.read()
    result = await asyncio.to_thread(inspect, name, size, mtime_ms, head, _is_local(request))
    return web.json_response(result)


async def api_identify(request):
    if not _is_local(request):
        return _error("not_local", 403)
    try:
        data = await request.json()
        return web.json_response(await asyncio.to_thread(identify, data.get("token")))
    except Refused as error:
        return _error(error.code, 404)
    except (ValueError, AttributeError):
        return _error("bad_request")


async def api_place(request):
    if not _is_local(request):
        return _error("not_local", 403)
    try:
        data = await request.json()
        return web.json_response(await asyncio.to_thread(place, data))
    except Refused as error:
        return _error(error.code, 404 if error.code == "gone" else 400)
    except (ValueError, AttributeError):
        return _error("bad_request")
    except OSError as error:
        print(f"[Anomalous Browser] Import: could not put the file in place: {error}")
        return _error("io", 500)


async def api_upload(request):
    try:
        size = int(request.query.get("size") or 0)
        folder_type, root_index, root, dest = await asyncio.to_thread(destination, dict(request.query), size)
    except Refused as error:
        return _error(error.code)
    except ValueError:
        return _error("bad_request")
    part = dest + ".part"
    received = 0
    try:
        target = await asyncio.to_thread(open, part, "wb")
        try:
            async for chunk in request.content.iter_chunked(CHUNK):
                await asyncio.to_thread(target.write, chunk)
                received += len(chunk)
        finally:
            await asyncio.to_thread(target.close)
        if size and received != size:
            raise Refused("incomplete")
        dest = free_path(dest) if os.path.exists(dest) else dest
        await asyncio.to_thread(os.replace, part, dest)
    except BaseException as error:
        if os.path.exists(part):
            os.remove(part)  # our own unfinished upload
        if isinstance(error, Refused):
            return _error(error.code)
        if isinstance(error, OSError):
            print(f"[Anomalous Browser] Import: upload failed: {error}")
            return _error("io", 500)
        raise
    return web.json_response(await asyncio.to_thread(_finish, folder_type, root_index, root, dest, "upload", received))


def register_routes(app):
    app.router.add_get("/anomalous/import/folders", api_folders)
    app.router.add_post("/anomalous/import/inspect", api_inspect)
    app.router.add_post("/anomalous/import/identify", api_identify)
    app.router.add_post("/anomalous/import/place", api_place)
    app.router.add_put("/anomalous/import/upload", api_upload)
