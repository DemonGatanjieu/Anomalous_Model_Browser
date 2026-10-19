"""Generated-output gallery indexing and mutation routes."""

import asyncio
import os
import threading
import time

from aiohttp import web
import folder_paths

from .image_search import filter_images
from .media_routes import (
    CARD_POSTER_VIDEO_EXTENSIONS,
    CARD_THUMBNAIL_STATIC_EXTENSIONS,
    _build_card_thumbnail,
    _build_video_poster,
)
from .path_utils import require_filename, resolve_within
from .trash import move_to_trash, trash_failure


GALLERY_SNAPSHOT_SECONDS = 10
MAX_CACHED_GALLERY_IMAGES = 50_000
GALLERY_IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'}
# Videos a browser plays in the viewer; not .avi (Chrome and Edge cannot).
GALLERY_VIDEO_EXTENSIONS = {'.mp4', '.webm', '.mov', '.mkv'}
GALLERY_MEDIA = ("all", "image", "video")
_gallery_snapshot_lock = threading.Lock()
_gallery_snapshot = {"root": None, "expires": 0, "images": []}


def _collect_gallery_images(output_dir):
    images = []
    for root, _, files in os.walk(output_dir):
        for filename in files:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in GALLERY_IMAGE_EXTENSIONS and ext not in GALLERY_VIDEO_EXTENSIONS:
                continue
            try:
                mtime = os.path.getmtime(os.path.join(root, filename))
            except OSError:
                continue
            subfolder = os.path.relpath(root, output_dir)
            images.append({
                "filename": filename,
                "subfolder": "" if subfolder == "." else subfolder.replace(os.sep, '/'),
                "type": "output",
                "mtime": mtime,
                "media_type": "video" if ext in GALLERY_VIDEO_EXTENSIONS else "image",
            })
    images.sort(key=lambda item: (item['mtime'], item['subfolder'], item['filename']), reverse=True)
    return images


def _gallery_images(output_dir, refresh=False):
    root = os.path.realpath(output_dir)
    with _gallery_snapshot_lock:
        if not refresh and _gallery_snapshot['root'] == root and time.monotonic() < _gallery_snapshot['expires']:
            return _gallery_snapshot['images']
        images = _collect_gallery_images(root)
        _gallery_snapshot.update(root=root, expires=time.monotonic() + GALLERY_SNAPSHOT_SECONDS,
                                 images=images if len(images) <= MAX_CACHED_GALLERY_IMAGES else [])
        if len(images) > MAX_CACHED_GALLERY_IMAGES:
            _gallery_snapshot['expires'] = 0
        return images


def _invalidate_gallery_snapshot():
    with _gallery_snapshot_lock:
        _gallery_snapshot.update(root=None, expires=0, images=[])


def _format(filename):
    """The format name the gallery's settings use: the extension, with .jpeg counted as jpg."""
    ext = os.path.splitext(filename)[1].lower().lstrip('.')
    return 'jpg' if ext == 'jpeg' else ext


def _gallery_listing(output_dir, refresh, query, media="image", hidden=frozenset()):
    """Outputs, newest first. `media`: "image" (the default, for callers that show pictures),
    "video" or "all"; `hidden`: format names left out (see _format)."""
    images = _gallery_images(output_dir, refresh)
    if media != "all" or hidden:
        images = [item for item in images
                  if media in ("all", item["media_type"]) and _format(item["filename"]) not in hidden]
    return filter_images(os.path.realpath(output_dir), images, query) if query else images


def _gallery_page_source(output_dir, refresh, query, media, hidden, kept_only=False):
    """The listing (only the images kept as a recipe, combo or prompt when `kept_only`), and
    whether the output folder has any video (the gallery offers its Pictures / Videos switch
    only then)."""
    images = _gallery_listing(output_dir, refresh, query, media, hidden)
    if kept_only:
        from .kept_images import kept_keys  # here: kept_images reaches back to this module through the stores
        kept = kept_keys()
        images = [item for item in images if (item.get("subfolder") or "", item["filename"]) in kept]
    has_videos = any(item["media_type"] == "video" for item in _gallery_images(output_dir))
    return images, has_videos


async def api_get_gallery_images(request):
    """GET /anomalous/gallery_images?page&limit&refresh&term=..&term=.. (or q)&media=all|image|video&hide=mkv,gif&kept=1
    - Outputs (pictures only unless `media` says otherwise), optionally searched by embedded
    generation info, without the `hide` formats; with `kept=1` only those kept as something."""
    try:
        page = max(1, int(request.query.get('page', 1)))
        limit = min(200, max(1, int(request.query.get('limit', 50))))
        # Repeated `term` params keep phrases whole; `q` is split on whitespace.
        terms = [term for term in request.query.getall('term', []) if term.strip()]
        query = terms or request.query.get('q', '').strip()
        media = request.query.get('media', 'image')
        if media not in GALLERY_MEDIA:
            raise ValueError(media)
        hidden = frozenset(part.strip().lower().lstrip('.') for part in request.query.get('hide', '').split(','))
        images, has_videos = await asyncio.to_thread(
            _gallery_page_source, folder_paths.get_output_directory(), request.query.get('refresh') == '1',
            query, media, hidden - {''}, request.query.get('kept') == '1')
        total = len(images)
        start = (page - 1) * limit
        return web.json_response({"images": images[start:start + limit], "total": total,
                                  "page": page, "pages": (total + limit - 1) // limit,
                                  "has_videos": has_videos})
    except (TypeError, ValueError):
        return web.json_response({"error": "Invalid page or filter"}, status=400)
    except OSError:
        return web.json_response({"error": "Could not list output images"}, status=500)


async def api_output_thumbnail(request):
    """GET /anomalous/output_thumbnail?filename&subfolder - the gallery grid's 512 px WebP of an
    output image/video (cached like model cards); the original stays at ComfyUI's /view."""
    output_dir = folder_paths.get_output_directory()
    try:
        filename = require_filename(request.query.get('filename'))
        file_path = resolve_within(resolve_within(output_dir, request.query.get('subfolder', '')), filename)
    except ValueError:
        return web.json_response({"status": "error", "message": "Invalid parameters"}, status=400)
    if not os.path.isfile(file_path):
        return web.json_response({"status": "error", "message": "File not found"}, status=404)
    served = file_path
    ext = os.path.splitext(file_path)[1].lower()
    if ext in CARD_THUMBNAIL_STATIC_EXTENSIONS:
        served = await asyncio.to_thread(_build_card_thumbnail, file_path)
    elif ext in CARD_POSTER_VIDEO_EXTENSIONS:
        poster = await asyncio.to_thread(_build_video_poster, file_path)
        if poster:
            served = poster
    # Revalidate (cheap 304s): an output file can be replaced under the same name.
    return web.FileResponse(served, headers={'Cache-Control': 'no-cache'})


async def api_delete_gallery_image(request):
    try:
        data = await request.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        return web.json_response({"status": "error", "message": "Invalid request body"}, status=400)
    try:
        filename = data.get("filename")
        subfolder = data.get("subfolder", "")
        
        output_dir = folder_paths.get_output_directory()
        try:
            filename = require_filename(filename)
            target_dir = resolve_within(output_dir, subfolder)
            file_path = resolve_within(target_dir, filename)
        except ValueError:
            return web.json_response({"status": "error", "message": "Invalid parameters"}, status=400)
        
        if os.path.exists(file_path):
            try:
                await asyncio.to_thread(move_to_trash, file_path)
            except OSError as e:
                return web.json_response({"status": "error", "message": trash_failure(e)}, status=409)
            _invalidate_gallery_snapshot()
            return web.json_response({"status": "success"})
        else:
            return web.json_response({"status": "error", "message": "File not found"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)
