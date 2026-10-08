"""Models in the wrong models folder, and identical copies (the models page's Tidy view,
ui_model_tidy.js).

GET  /anomalous/placement/check[?deep=1] -> {misplaced, duplicates, unchecked}
    misplaced: models whose header (model_kind.py, only when sure) names another type than
    the folder they are in, with where they belong (the same subfolder in a folder of that
    type, on the same drive when there is one) and whether they still load where they are.
    duplicates: files with the same SHA-256 — known from scans, or (deep) read now for files
    of the same size. unchecked: the same-size files a deep check would still read.
POST /anomalous/placement/move {type, root, rel, to_type, to_root, to_rel} -> moves a model
    and its sidecars (covers, info, the user's notes); never over a file (" (2)").

Removing a copy goes through /anomalous/delete_model (Recycle Bin). Headers and computed
SHA-256s are kept in memory per file (path, size, time).
"""

import asyncio
import os
import threading

from aiohttp import web
import folder_paths

try:
    from ..model_identity import file_sha256
    from ..model_kind import inspect_file
except ImportError:  # loaded outside the package (tests)
    from model_identity import file_sha256
    from model_kind import inspect_file
from .activity_log import add_entry
from .metadata import get_metadata
from .model_constants import SIDECAR_SUFFIXES
from .model_download import MODEL_EXTENSIONS, clean_folder, forget_file_lists
from .model_import import Refused, destination, import_types, move_into
from .path_utils import resolve_within

# (folder type, what the file is): it loads there all the same.
WORKS_ANYWAY = {("diffusion_models", "checkpoints")}
CACHE_LIMIT = 5000

_lock = threading.Lock()
_heads = {}   # path -> (size, mtime_ns, inspect_file result)
_hashes = {}  # path -> (size, mtime_ns, sha256)


def _cached(store, path, stat, compute):
    key = (stat.st_size, stat.st_mtime_ns)
    with _lock:
        hit = store.get(path)
    if hit and hit[:2] == key:
        return hit[2]
    value = compute(path)
    with _lock:
        if len(store) >= CACHE_LIMIT:
            store.clear()
        store[path] = (*key, value)
    return value


def library():
    """Every model file once: [{type, root, rel, path, size, dev}] (a folder listed under two
    types counts for the first)."""
    seen, files = set(), []
    for folder_type in import_types():
        for index, base in enumerate(folder_paths.get_folder_paths(folder_type) or []):
            if not os.path.isdir(base):
                continue
            for current, dirs, names in os.walk(base):
                dirs[:] = sorted(name for name in dirs if not name.startswith("."))
                for name in sorted(names):
                    if not name.lower().endswith(MODEL_EXTENSIONS):
                        continue
                    path = os.path.join(current, name)
                    real = os.path.realpath(path)
                    if real in seen:
                        continue
                    seen.add(real)
                    try:
                        stat = os.stat(path)
                    except OSError:
                        continue
                    files.append({"type": folder_type, "root": index, "rel": os.path.relpath(path, base).replace(os.sep, "/"),
                                  "path": path, "size": stat.st_size, "dev": stat.st_dev, "stat": stat})
    return files


def _home_for(item, kind):
    """Where a file of `kind` goes: its own subfolder and name, in a folder of that type,
    preferably on its drive (a move is then a rename)."""
    roots = []
    for index, base in enumerate(folder_paths.get_folder_paths(kind) or []):
        if os.path.isdir(base):
            roots.append((index, os.stat(base).st_dev))
    if not roots:
        return None
    index = next((index for index, dev in roots if dev == item["dev"]), roots[0][0])
    return {"type": kind, "root": index, "rel": item["rel"]}


def misplaced(files):
    found = []
    for item in files:
        result = _cached(_heads, item["path"], item["stat"], inspect_file)
        kind = result.get("kind")
        if not kind or not result.get("sure") or kind == item["type"] or kind not in import_types():
            continue
        home = _home_for(item, kind)
        if home:
            found.append({"type": item["type"], "root": item["root"], "rel": item["rel"], "size": item["size"],
                          "kind": kind, "base": result.get("base", ""), "works": (item["type"], kind) in WORKS_ANYWAY,
                          "to": home})
    return found


def _known_hash(item):
    try:
        value = str(get_metadata(item["path"]).get("hash") or "").lower()
    except Exception:
        value = ""
    if len(value) == 64:
        return value
    with _lock:
        hit = _hashes.get(item["path"])
    return hit[2] if hit and hit[:2] == (item["stat"].st_size, item["stat"].st_mtime_ns) else ""


def duplicates(files, deep=False):
    """(groups of identical files, {groups, bytes} still to read for a deep check)."""
    by_size = {}
    for item in files:
        if item["size"]:
            by_size.setdefault(item["size"], []).append(item)
    groups, unchecked = {}, {"groups": 0, "bytes": 0}
    for size, items in by_size.items():
        if len(items) < 2:
            continue
        unknown = [item for item in items if not _known_hash(item)]
        if unknown and not deep:
            unchecked["groups"] += 1
            unchecked["bytes"] += size * len(unknown)
        for item in items:
            sha = _known_hash(item)
            if not sha and deep:
                sha = _cached(_hashes, item["path"], item["stat"], file_sha256)
            if sha:
                groups.setdefault(sha, []).append(item)
    found = [{"sha256": sha, "size": items[0]["size"],
              "files": [{"type": item["type"], "root": item["root"], "rel": item["rel"]} for item in items]}
             for sha, items in groups.items() if len(items) > 1]
    return found, unchecked


def check(deep=False):
    files = library()
    found, unchecked = duplicates(files, deep)
    return {"misplaced": misplaced(files), "duplicates": found, "unchecked": unchecked}


def _sidecars(path):
    """The model's covers, info and notes: files named by its stem, unless another model in
    its folder has that stem too (then they are shared, and stay)."""
    folder, name = os.path.split(path)
    stem = os.path.splitext(name)[0]
    if any(os.path.isfile(os.path.join(folder, stem + ext)) for ext in MODEL_EXTENSIONS if stem + ext != name):
        return []
    return [(os.path.join(folder, stem + suffix), suffix) for suffix in SIDECAR_SUFFIXES
            if os.path.isfile(os.path.join(folder, stem + suffix))]


def move(data):
    folder_type = data.get("type")
    if folder_type not in import_types():
        raise Refused("bad_type")
    paths = folder_paths.get_folder_paths(folder_type) or []
    try:
        index = int(data.get("root", 0))
        base = os.path.realpath(paths[index])
        rel = clean_folder(data.get("rel"))
        source = resolve_within(base, *rel.split("/"))
    except (ValueError, TypeError, IndexError):
        raise Refused("bad_path")
    if not os.path.isfile(source) or not rel.lower().endswith(MODEL_EXTENSIONS):
        raise Refused("gone")
    to_type, to_root, root_path, dest = destination(
        {"type": data.get("to_type"), "root": data.get("to_root", 0), "rel": data.get("to_rel")}, os.path.getsize(source))
    sidecars = _sidecars(source)
    move_into(source, dest, keep=False)
    moved, left = [os.path.basename(dest)], []
    dest_stem = os.path.splitext(dest)[0]
    for path, suffix in sidecars:
        target = dest_stem + suffix
        try:
            if os.path.exists(target):
                raise FileExistsError(target)
            move_into(path, target, keep=False)
            moved.append(os.path.basename(target))
        except OSError as error:
            left.append(os.path.basename(path))
            print(f"[Anomalous Browser] Tidy: {os.path.basename(path)} stayed where it was: {error}")
    forget_file_lists()
    to_rel = os.path.relpath(dest, root_path).replace(os.sep, "/")
    add_entry("file", "model_move", to_rel, {"move": {
        "from": {"type": folder_type, "path_idx": index, "rel": rel},
        "to": {"type": to_type, "path_idx": to_root, "rel": to_rel}, "files": moved, "left": left,
    }})
    return {"type": to_type, "root": to_root, "rel": to_rel, "left": left}


async def api_check(request):
    deep = request.query.get("deep") == "1"
    return web.json_response(await asyncio.to_thread(check, deep))


async def api_move(request):
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError
        return web.json_response(await asyncio.to_thread(move, data))
    except Refused as error:
        return web.json_response({"error": error.code}, status=404 if error.code == "gone" else 400)
    except ValueError:
        return web.json_response({"error": "bad_request"}, status=400)
    except OSError as error:
        print(f"[Anomalous Browser] Tidy: could not move the model: {error}")
        return web.json_response({"error": "io"}, status=500)


def register_routes(app):
    app.router.add_get("/anomalous/placement/check", api_check)
    app.router.add_post("/anomalous/placement/move", api_move)
