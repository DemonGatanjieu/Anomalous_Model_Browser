"""Generated-output gallery indexing and mutation routes."""

import asyncio
import os
import threading
import time

from aiohttp import web
import folder_paths

from .image_search import filter_images
from .path_utils import require_filename, resolve_within


GALLERY_SNAPSHOT_SECONDS = 10
MAX_CACHED_GALLERY_IMAGES = 50_000
_gallery_snapshot_lock = threading.Lock()
_gallery_snapshot = {"root": None, "expires": 0, "images": []}


def _collect_gallery_images(output_dir):
    images = []
    for root, _, files in os.walk(output_dir):
        for filename in files:
            if os.path.splitext(filename)[1].lower() not in {'.png', '.jpg', '.jpeg', '.webp', '.gif'}:
                continue
            try:
                mtime = os.path.getmtime(os.path.join(root, filename))
            except OSError:
                continue
            subfolder = os.path.relpath(root, output_dir)
            images.append({
                "filename": filename,
                "subfolder": "" if subfolder == "." else subfolder.replace(os.sep, '/'),
                "type": "output", "mtime": mtime,
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


def _gallery_listing(output_dir, refresh, query):
    images = _gallery_images(output_dir, refresh)
    return filter_images(os.path.realpath(output_dir), images, query) if query else images


async def api_get_gallery_images(request):
    """GET /anomalous/gallery_images?page&limit&refresh&term=..&term=.. (or q) - Output images, optionally searched by embedded generation info."""
    try:
        page = max(1, int(request.query.get('page', 1)))
        limit = min(200, max(1, int(request.query.get('limit', 50))))
        # Repeated `term` params keep phrases whole; `q` is split on whitespace.
        terms = [term for term in request.query.getall('term', []) if term.strip()]
        query = terms or request.query.get('q', '').strip()
        images = await asyncio.to_thread(_gallery_listing, folder_paths.get_output_directory(), request.query.get('refresh') == '1', query)
        total = len(images)
        start = (page - 1) * limit
        return web.json_response({"images": images[start:start + limit], "total": total,
                                  "page": page, "pages": (total + limit - 1) // limit})
    except (TypeError, ValueError):
        return web.json_response({"error": "Invalid pagination"}, status=400)
    except OSError:
        return web.json_response({"error": "Could not list output images"}, status=500)


async def api_delete_gallery_image(request):
    try:
        data = await request.json()
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
            os.remove(file_path)
            _invalidate_gallery_snapshot()
            return web.json_response({"status": "success"})
        else:
            return web.json_response({"status": "error", "message": "File not found"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)
