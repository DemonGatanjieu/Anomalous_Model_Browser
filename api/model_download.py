"""Downloading the models the open workflow is missing (Model Check's "Download").

POST /anomalous/download/lookup  {items: [{key, hash, url, value, types}]} -> where each can come
    from (download_sources.find_source) and the model folders of its type: [{index, path, free,
    subfolders}].
POST /anomalous/download/start   {download_url, type, root, rel, sha256, size, ...} -> {id}
GET  /anomalous/download/status  -> {jobs}
POST /anomalous/download/cancel  {id}
GET/POST /anomalous/download/settings -> where downloads go ({place, folder}), kept in
    user/anomalous/download_settings.json.

One download runs at a time, into "<file>.part" next to where the file goes; an interrupted one
continues from there. The finished file is checked against the SHA-256 the workflow or the site
gives, and only then gets its name; a file that is already there is never replaced. The Civitai
key goes only to Civitai (not along a redirect to its file storage).
"""

import asyncio
import hashlib
import json
import os
import shutil
import threading
import time
import urllib.error
import urllib.request
import uuid

from aiohttp import web
import folder_paths

from .activity_log import add_entry, log_path
from .download_sources import (
    SHA256, USER_AGENT, allowed_download_url, find_source, host_of, is_civitai, same_file, _load_api_key,
)
from .path_utils import atomic_write_json, resolve_within

MODEL_EXTENSIONS = (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".sft", ".gguf")
CHUNK = 1024 * 1024
SPACE_MARGIN = 200 * 1024 * 1024
MAX_SUBFOLDERS = 300
KEEP_FINISHED = 50
# hf_mirror None: not chosen yet (the page takes the mirror for a Chinese interface).
DEFAULT_SETTINGS = {"place": "workflow", "folder": "Downloads", "hf_mirror": None}

_lock = threading.Lock()
_jobs = {}  # id -> job dict, in the order started
_queue = []
_worker = None


class DownloadError(Exception):
    def __init__(self, code, message=""):
        super().__init__(message or code)
        self.code = code


async def _body(request):
    """The request's JSON object, or {} when it is not one (each route then refuses it)."""
    try:
        data = await request.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


# --- settings ---------------------------------------------------------------------------

def settings_path():
    return os.path.join(os.path.dirname(log_path()), "download_settings.json")


def read_settings():
    settings = dict(DEFAULT_SETTINGS)
    try:
        with open(settings_path(), encoding="utf-8") as source:
            saved = json.load(source)
        if saved.get("place") in ("workflow", "folder"):
            settings["place"] = saved["place"]
        if isinstance(saved.get("folder"), str):
            settings["folder"] = saved["folder"]
        if isinstance(saved.get("hf_mirror"), bool):
            settings["hf_mirror"] = saved["hf_mirror"]
    except (OSError, ValueError, AttributeError):
        pass
    return settings


def clean_folder(folder):
    """A relative folder ('' = the type's own folder), '/' separated; ValueError if it climbs out."""
    parts = [part.strip() for part in str(folder or "").replace("\\", "/").split("/") if part.strip()]
    for part in parts:
        if part in (".", "..") or ":" in part or any(char in part for char in '<>"|?*'):
            raise ValueError("Invalid folder")
    return "/".join(parts)


async def api_settings(request):
    if request.method == "POST":
        data = await _body(request)
        settings = read_settings()
        if data.get("place") in ("workflow", "folder"):
            settings["place"] = data["place"]
        if isinstance(data.get("hf_mirror"), bool):
            settings["hf_mirror"] = data["hf_mirror"]
        if "folder" in data:
            try:
                # {base} is filled with the model's base model when a download starts.
                settings["folder"] = clean_folder(data.get("folder"))
            except ValueError:
                return web.json_response({"error": "Invalid folder"}, status=400)
        atomic_write_json(settings_path(), settings)
        return web.json_response(settings)
    return web.json_response(read_settings())


# --- lookup -----------------------------------------------------------------------------

def folder_type_for(types):
    known = getattr(folder_paths, "folder_names_and_paths", {})
    for name in types or []:
        if isinstance(name, str) and name in known:
            return name
    return ""


def _subfolders(root):
    found = []
    for current, dirs, _files in os.walk(root):
        dirs[:] = sorted(name for name in dirs if not name.startswith("."))
        depth = os.path.relpath(current, root).count(os.sep)
        for name in dirs:
            found.append(os.path.relpath(os.path.join(current, name), root).replace(os.sep, "/"))
            if len(found) >= MAX_SUBFOLDERS:
                return found
        if depth >= 1:
            dirs[:] = []
    return found


def roots_of(folder_type):
    """The model folders of a type: [{index, path, exists, free, subfolders}]."""
    roots = []
    for index, path in enumerate(folder_paths.get_folder_paths(folder_type) or []):
        exists = os.path.isdir(path)
        probe = path if exists else os.path.dirname(path)
        try:
            free = shutil.disk_usage(probe).free if os.path.isdir(probe) else 0
        except OSError:
            free = 0
        roots.append({"index": index, "path": path, "exists": exists, "free": free,
                      "subfolders": _subfolders(path) if exists else []})
    return roots


def lookup_item(item, hf_mirror=False, down=None):
    """Where one item can come from; `down` (kept across one lookup) names the sites that
    stopped answering, so the next items skip only those."""
    file_hash = str(item.get("hash") or "").strip()
    name = os.path.basename(str(item.get("value") or "").replace("\\", "/"))
    found = find_source(file_hash, str(item.get("url") or "").strip(), name, hf_mirror,
                        folder_type_for(item.get("types")), down)
    if found.get("found") and file_hash and found.get("sha256") and len(file_hash) >= 10 \
            and all(c in "0123456789abcdefABCDEF" for c in file_hash) and not same_file(file_hash, found["sha256"]):
        # The link names another file than the one the workflow was saved with.
        return {"found": False, "reason": "different_file", "page": found.get("page", "")}
    return found


async def api_lookup(request):
    """Items already looked up (`known`) only get their type and folders. Once a site does not
    answer, the rest do not ask it (offline: no wait per model); the other sites still are."""
    data = await _body(request)
    items, hf_mirror = data.get("items"), data.get("hf_mirror") is True
    if not isinstance(items, list):
        return web.json_response({"error": "items must be a list"}, status=400)
    results, types, down = [], {}, set()
    for item in items[:100]:
        if not isinstance(item, dict):
            continue
        folder_type = folder_type_for(item.get("types"))
        if item.get("known"):
            result = {"found": False, "reason": "known"}
        else:
            result = await asyncio.to_thread(lookup_item, item, hf_mirror, down)
        result.update(key=item.get("key"), type=folder_type)
        if folder_type and folder_type not in types:
            types[folder_type] = await asyncio.to_thread(roots_of, folder_type)
        results.append(result)
    return web.json_response({"results": results, "roots": types, "settings": read_settings()})


# --- downloads --------------------------------------------------------------------------

def _public(job):
    public = {key: job[key] for key in ("id", "key", "state", "error", "received", "total", "rel", "type",
                                        "root", "value", "file", "source", "verified")}
    public["host"] = host_of(job["url"])
    return public


def plan_job(data):
    """A queued job from a start request, or ValueError / DownloadError saying why not."""
    url = str(data.get("download_url") or "")
    if not allowed_download_url(url):
        raise DownloadError("bad_source")
    folder_type = folder_type_for([data.get("type")])
    if not folder_type:
        raise DownloadError("bad_type")
    paths = folder_paths.get_folder_paths(folder_type) or []
    root_index = data.get("root", 0)
    if not isinstance(root_index, int) or not 0 <= root_index < len(paths):
        raise DownloadError("bad_root")
    rel = clean_folder(data.get("rel"))
    if not rel.lower().endswith(MODEL_EXTENSIONS):
        raise DownloadError("bad_name")
    root = os.path.realpath(paths[root_index])
    dest = resolve_within(root, *rel.split("/"))
    if os.path.exists(dest):
        raise DownloadError("exists")
    size = int(data.get("size") or 0)
    probe = root
    while probe and not os.path.isdir(probe):
        probe = os.path.dirname(probe)
    if size and probe and shutil.disk_usage(probe).free < size + SPACE_MARGIN:
        raise DownloadError("no_space")
    sha256 = str(data.get("sha256") or "").lower()
    with _lock:
        if any(job["dest"] == dest and job["state"] in ("queued", "running", "verifying") for job in _jobs.values()):
            raise DownloadError("already")
    return {
        "id": uuid.uuid4().hex[:12], "key": str(data.get("key") or ""), "state": "queued", "error": "",
        "received": 0, "total": size, "rel": rel, "type": folder_type, "root": root_index,
        "value": str(data.get("value") or ""), "file": os.path.basename(dest), "dest": dest, "url": url,
        "sha256": sha256 if SHA256.match(sha256) else "", "expected": str(data.get("hash") or "").lower(),
        "source": str(data.get("source") or ""), "page": str(data.get("page") or ""),
        "verified": False, "cancel": False, "finished": 0,
    }


def _open(job, start):
    headers = {"User-Agent": USER_AGENT}
    if start:
        headers["Range"] = f"bytes={start}-"
    request = urllib.request.Request(job["url"], headers=headers)
    key = _load_api_key() if is_civitai(job["url"]) else None
    if key:  # not carried along the redirect to the file storage
        request.add_unredirected_header("Authorization", f"Bearer {key}")
    try:
        return urllib.request.urlopen(request, timeout=60)
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise DownloadError("needs_key" if is_civitai(job["url"]) and not key else "forbidden") from error
        if error.code == 404:
            raise DownloadError("gone") from error
        if error.code == 416 and start:
            raise DownloadError("restart") from error
        raise DownloadError("network", f"HTTP {error.code}") from error
    except (urllib.error.URLError, OSError) as error:
        raise DownloadError("network", str(error)) from error


def _hash_existing(path, digest):
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(CHUNK), b""):
            digest.update(chunk)


def _fetch(job):
    part = job["dest"] + ".part"
    os.makedirs(os.path.dirname(job["dest"]), exist_ok=True)
    digest = hashlib.sha256()
    start = os.path.getsize(part) if os.path.isfile(part) else 0
    try:
        response = _open(job, start)
    except DownloadError as error:
        if error.code != "restart":
            raise
        start, response = 0, _open(job, 0)
    with response:
        if start and response.status != 206:
            start = 0  # the site sends the whole file again
        if "text/html" in str(response.headers.get("Content-Type", "")).lower():
            raise DownloadError("not_a_file")  # a login or error page, not the model
        if start:
            _hash_existing(part, digest)
        length = int(response.headers.get("Content-Length") or 0)
        job["total"] = start + length if length else job["total"]
        job["received"] = start
        with open(part, "ab" if start else "wb") as target:
            while True:
                if job["cancel"]:
                    raise DownloadError("cancelled")
                chunk = response.read(CHUNK)
                if not chunk:
                    break
                target.write(chunk)
                digest.update(chunk)
                job["received"] += len(chunk)
    return part, digest.hexdigest()


def _finish(job, part, sha256):
    job["state"] = "verifying"
    if job["total"] and job["received"] != job["total"]:
        raise DownloadError("network", "incomplete")
    expected = job["sha256"] or (job["expected"] if len(job["expected"]) >= 10 else "")
    if expected and not same_file(expected, sha256):
        os.remove(part)  # our own unfinished download, not a file of the user's
        raise DownloadError("hash_mismatch")
    job["verified"] = bool(expected)
    if os.path.exists(job["dest"]):
        raise DownloadError("exists")
    os.replace(part, job["dest"])
    # ComfyUI's file lists and the browser's model metadata see the new file.
    for cache in (getattr(folder_paths, "filename_list_cache", None), getattr(folder_paths, "cache_helper", None)):
        try:
            cache.clear()
        except Exception:
            pass
    try:
        from .metadata import clear_metadata_cache
        clear_metadata_cache()
    except Exception as error:
        print(f"[Anomalous Browser] Download: could not clear the model cache: {error}")


def _record(job, sha256):
    add_entry("file", "model_download", job["rel"], {"download": {
        "type": job["type"], "path_idx": job["root"], "rel": job["rel"], "file": job["file"],
        "size": job["received"], "sha256": sha256, "verified": job["verified"],
        "source": job["source"], "page": job["page"], "value": job["value"],
    }})


def run_job(job):
    job["state"] = "running"
    try:
        part, sha256 = _fetch(job)
        _finish(job, part, sha256)
        job["state"] = "done"
        try:
            _record(job, sha256)
        except Exception as error:
            print(f"[Anomalous Browser] Download: could not record it in the activity log: {error}")
    except DownloadError as error:
        job["state"] = "cancelled" if error.code == "cancelled" else "failed"
        job["error"] = error.code
        if error.code == "cancelled" and os.path.isfile(job["dest"] + ".part"):
            os.remove(job["dest"] + ".part")  # our own unfinished download
        if error.code not in ("cancelled",):
            print(f"[Anomalous Browser] Download of {job['rel']} failed: {error}")
    except Exception as error:
        job["state"], job["error"] = "failed", "unknown"
        print(f"[Anomalous Browser] Download of {job['rel']} failed: {error}")
    job["finished"] = time.time()


def _work():
    global _worker
    while True:
        with _lock:
            job = next((item for item in _queue if item["state"] == "queued"), None)
            if job is None:
                _queue.clear()
                _worker = None
                return
            _queue.remove(job)
        run_job(job)


def enqueue(job):
    global _worker
    with _lock:
        _jobs[job["id"]] = job
        _queue.append(job)
        finished = [item for item in _jobs.values() if item["finished"]]
        for old in finished[:-KEEP_FINISHED]:
            _jobs.pop(old["id"], None)
        if _worker is None:
            _worker = threading.Thread(target=_work, daemon=True, name="anomalous-download")
            _worker.start()


async def api_start(request):
    data = await _body(request)
    if not data:
        return web.json_response({"error": "bad_request"}, status=400)
    try:
        job = await asyncio.to_thread(plan_job, data)
    except DownloadError as error:
        return web.json_response({"error": error.code}, status=409 if error.code in ("exists", "already") else 400)
    except (ValueError, TypeError) as error:
        return web.json_response({"error": "bad_path", "message": str(error)}, status=400)
    enqueue(job)
    return web.json_response(_public(job))


async def api_status(request):
    with _lock:
        jobs = [_public(job) for job in _jobs.values()]
    return web.json_response({"jobs": jobs})


async def api_cancel(request):
    data = await _body(request)
    with _lock:
        job = _jobs.get(str(data.get("id") or ""))
        if not job:
            return web.json_response({"error": "unknown"}, status=404)
        if job["state"] == "queued":
            job["state"], job["error"], job["finished"] = "cancelled", "cancelled", time.time()
            if job in _queue:
                _queue.remove(job)
        else:
            job["cancel"] = True
    return web.json_response(_public(job))


def register_routes(app):
    app.router.add_post("/anomalous/download/lookup", api_lookup)
    app.router.add_post("/anomalous/download/start", api_start)
    app.router.add_get("/anomalous/download/status", api_status)
    app.router.add_post("/anomalous/download/cancel", api_cancel)
    app.router.add_get("/anomalous/download/settings", api_settings)
    app.router.add_post("/anomalous/download/settings", api_settings)
