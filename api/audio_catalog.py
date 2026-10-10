"""Generated audio: the audio gallery, Preview Audio results, and streaming them."""

import asyncio
import os
import shutil
import time
from urllib.parse import quote

import folder_paths
from aiohttp import web

from .audio_metadata import generation_info
from .path_utils import resolve_within
from .trash import move_to_trash, trash_failure

AUDIO_EXTENSIONS = {'.wav', '.mp3', '.flac', '.ogg', '.opus', '.m4a'}
AUDIO_CONTENT_TYPES = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.m4a': 'audio/mp4',
}
AUDIO_ROOTS = {
    "output": lambda: folder_paths.get_output_directory(),
    "temp": lambda: folder_paths.get_temp_directory(),
}
PREVIEW_LIMIT = 30
SAVED_PREVIEW_SUBFOLDER = "audio"
# Revalidate instead of forbidding caches: overwritten files get a new ?v=mtime URL.
AUDIO_CACHE_HEADERS = {"Cache-Control": "no-cache"}


def _audio_url(rel_path, dir_type, version):
    return f"/anomalous/audio_stream?path={quote(rel_path, safe='/')}&type={dir_type}&v={int(version)}"


async def api_serve_audio(request):
    """GET /anomalous/audio_stream?path=...&type=output|temp - Stream an audio file."""
    rel_path = request.query.get("path", "").strip("/\\")
    dir_type = request.query.get("type", "output")
    if not rel_path:
        return web.Response(status=400, text="Missing audio path")
    if dir_type not in AUDIO_ROOTS:
        return web.Response(status=400, text="Unknown audio folder")

    base_dir = AUDIO_ROOTS[dir_type]()
    try:
        resolved_path = resolve_within(base_dir, rel_path)
    except ValueError:
        return web.Response(status=403, text="Forbidden path")

    ext = os.path.splitext(resolved_path)[1].lower()
    if ext not in AUDIO_EXTENSIONS:
        return web.Response(status=415, text="Not an audio file")
    if not os.path.isfile(resolved_path):
        return web.Response(status=404, text="Audio file not found")

    return web.FileResponse(resolved_path, headers={"Content-Type": AUDIO_CONTENT_TYPES[ext], **AUDIO_CACHE_HEADERS})


def _collect_audio_files(root_dir, dir_type):
    """Scan a folder tree for audio files, newest first."""
    audios = []
    if not os.path.isdir(root_dir):
        return audios

    for root, _, files in os.walk(root_dir):
        for name in files:
            if os.path.splitext(name)[1].lower() not in AUDIO_EXTENSIONS:
                continue
            try:
                stat = os.stat(os.path.join(root, name))
            except OSError:
                continue
            subfolder = os.path.relpath(root, root_dir)
            clean_sub = "" if subfolder == "." else subfolder.replace(os.sep, '/')
            rel_path = "/".join(part for part in (clean_sub, name) if part)
            audios.append({
                "filename": name,
                "subfolder": clean_sub,
                "size_bytes": stat.st_size,
                "mtime": stat.st_mtime,
                "audio_url": _audio_url(rel_path, dir_type, stat.st_mtime),
            })
    audios.sort(key=lambda a: a["mtime"], reverse=True)
    return audios


_info_cache = {}


def _cached_generation_info(path, mtime, size):
    """Generation info keyed by (mtime, size) so unchanged files are parsed once."""
    cached = _info_cache.get(path)
    if cached and cached[0] == (mtime, size):
        return cached[1]
    info = generation_info(path)
    if len(_info_cache) > 5000:
        _info_cache.clear()
    _info_cache[path] = ((mtime, size), info)
    return info


def _attach_generation_info(root_dir, items):
    for item in items:
        path = os.path.join(root_dir, item["subfolder"], item["filename"])
        item["generation"] = _cached_generation_info(path, item["mtime"], item["size_bytes"])
    return items


def _search_text(item):
    speech = (item.get("generation") or {}).get("speech") or ""
    return f"{item['subfolder']}/{item['filename']}\n{speech}".lower()


def _gallery_page(output_dir, page, limit, query):
    all_audios = _collect_audio_files(output_dir, "output")
    if query:
        # Searching reads every file's comments once; the cache keeps later searches cheap.
        _attach_generation_info(output_dir, all_audios)
        all_audios = [item for item in all_audios if query in _search_text(item)]
    total = len(all_audios)
    start = (page - 1) * limit
    items = all_audios[start:start + limit]
    if not query:
        _attach_generation_info(output_dir, items)
    return items, total, start + limit < total


def _positive_int(value, default, maximum=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    number = max(1, number)
    return min(maximum, number) if maximum else number


async def api_get_audio_gallery(request):
    """GET /anomalous/audio_gallery?page=1&limit=50&q=text - Generated audio in output, with the speech that produced it."""
    page = _positive_int(request.query.get("page"), 1)
    limit = _positive_int(request.query.get("limit"), 40, 100)
    query = request.query.get("q", "").strip().lower()

    items, total, has_more = await asyncio.to_thread(_gallery_page, folder_paths.get_output_directory(), page, limit, query)
    return web.json_response({
        "success": True,
        "audios": items,
        "total": total,
        "page": page,
        "has_more": has_more,
    })


def _list_previews(temp_dir):
    items = _collect_audio_files(temp_dir, "temp")[:PREVIEW_LIMIT]
    return _attach_generation_info(temp_dir, items)


async def api_get_audio_previews(request):
    """GET /anomalous/audio_previews - Unsaved preview audio in ComfyUI's temp folder (cleared on restart)."""
    items = await asyncio.to_thread(_list_previews, folder_paths.get_temp_directory())
    return web.json_response({"success": True, "audios": items})


def _save_preview(temp_dir, output_dir, subfolder, filename):
    source = resolve_within(temp_dir, subfolder, filename)
    ext = os.path.splitext(filename)[1].lower()
    if ext not in AUDIO_EXTENSIONS:
        raise ValueError("Only audio files can be saved")
    if not os.path.isfile(source):
        raise FileNotFoundError(filename)

    dest_dir = resolve_within(output_dir, SAVED_PREVIEW_SUBFOLDER)
    os.makedirs(dest_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(os.path.getmtime(source)))
    for counter in range(1, 1000):
        name = f"Preview_{stamp}_{counter:02}{ext}"
        target = os.path.join(dest_dir, name)
        try:
            # O_EXCL: never overwrite an existing file in the library.
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0))
        except FileExistsError:
            continue
        try:
            with os.fdopen(fd, "wb") as out, open(source, "rb") as src:
                shutil.copyfileobj(src, out)
        except Exception:
            try:
                os.remove(target)
            except OSError:
                pass
            raise
        stat = os.stat(target)
        rel_path = f"{SAVED_PREVIEW_SUBFOLDER}/{name}"
        item = {
            "filename": name,
            "subfolder": SAVED_PREVIEW_SUBFOLDER,
            "size_bytes": stat.st_size,
            "mtime": stat.st_mtime,
            "audio_url": _audio_url(rel_path, "output", stat.st_mtime),
        }
        return _attach_generation_info(output_dir, [item])[0]
    raise FileExistsError("No free file name")


async def api_save_audio_preview(request):
    """POST /anomalous/save_audio_preview {filename, subfolder} - Copy a temp preview into output/audio."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "Invalid JSON payload"}, status=400)
    filename = str(data.get("filename", "")).strip()
    subfolder = str(data.get("subfolder", "")).strip().strip("/\\")
    if not filename or os.path.basename(filename) != filename:
        return web.json_response({"success": False, "error": "Invalid filename"}, status=400)
    try:
        item = await asyncio.to_thread(
            _save_preview, folder_paths.get_temp_directory(), folder_paths.get_output_directory(), subfolder, filename)
    except ValueError as e:
        return web.json_response({"success": False, "error": str(e)}, status=403)
    except FileNotFoundError:
        return web.json_response({"success": False, "code": "missing", "error": "Preview no longer exists"}, status=404)
    except OSError as e:
        return web.json_response({"success": False, "error": f"Failed to save: {e}"}, status=500)
    return web.json_response({"success": True, "audio": item})


async def api_delete_audio_gallery(request):
    """POST /anomalous/delete_audio_gallery - Delete one generated audio file."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "Invalid JSON payload"}, status=400)

    filename = str(data.get("filename", "")).strip()
    subfolder = str(data.get("subfolder", "")).strip().strip("/\\")
    if not filename or os.path.basename(filename) != filename:
        return web.json_response({"success": False, "error": "Invalid filename"}, status=400)
    if os.path.splitext(filename)[1].lower() not in AUDIO_EXTENSIONS:
        return web.json_response({"success": False, "error": "Only audio files can be deleted here"}, status=415)

    try:
        target = resolve_within(folder_paths.get_output_directory(), subfolder, filename)
    except ValueError:
        return web.json_response({"success": False, "error": "Forbidden path"}, status=403)

    if not os.path.isfile(target):
        return web.json_response({"success": False, "error": "File not found"}, status=404)
    try:
        await asyncio.to_thread(move_to_trash, target)
    except OSError as e:
        return web.json_response({"success": False, "error": trash_failure(e)}, status=409)
    return web.json_response({"success": True})
