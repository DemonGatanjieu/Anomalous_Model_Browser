"""Model cover, thumbnail-cache, and generated-image lookup routes.

Card images are 512 px WebP copies of the covers (a video cover gets one of its first
frame, the poster), kept in the user folder so they survive ComfyUI restarts (ComfyUI
empties its temp folder on every start). Listing a folder queues the covers not made yet
for one background worker, so scrolling and the next visit find them ready. A picture past
Pillow's pixel limit (a 4x upscale of a big one) is shrunk once in a child process
(huge_picture.py), so ComfyUI's own memory never holds it; a card never falls back to a large
original, it gets a placeholder with the picture's size instead.
"""

import asyncio
import collections
import hashlib
import json
import logging
import os
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

from aiohttp import web
import folder_paths

from .path_utils import require_filename, resolve_folder_subdir, resolve_within


CARD_THUMBNAIL_EDGE = 512
CARD_THUMBNAIL_CACHE_LIMIT = 256 * 1024 * 1024
CARD_THUMBNAIL_STATIC_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.avif'}
CARD_POSTER_VIDEO_EXTENSIONS = {'.mp4', '.webm', '.mov', '.avi', '.mkv'}
CARD_WARM_QUEUE_LIMIT = 512
ORIGINAL_CARD_BYTES = 8 * 1024 * 1024  # an unreadable picture this small is shown as it is
HUGE_PICTURE_PIXELS = 400_000_000  # the most a child process decodes (about 1.2 GB as RGB)
HUGE_DECODE_SECONDS = 180
_HUGE_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'huge_picture.py')
_TOO_LARGE = object()  # _build_card_thumbnail_impl: past Pillow's limit, for the child process
_huge_lock = threading.Lock()  # one child decode at a time
_huge_failed = set()  # cache paths a child could not make: not tried again for that file
log = logging.getLogger(__name__)
_thumbnail_cleanup_lock = threading.Lock()
_thumbnail_generation_slots = threading.BoundedSemaphore(2)
_thumbnail_last_cleanup = 0.0
_thumbnail_created_since_cleanup = 0


def _thumbnail_cache_directory():
    """<user folder>/anomalous/cache/card_thumbnails; the system temp folder if there is none."""
    try:
        user_dir = folder_paths.get_user_directory()
    except Exception:
        user_dir = None
    if isinstance(user_dir, (str, os.PathLike)):
        cache_dir = os.path.join(user_dir, "anomalous", "cache", "card_thumbnails")
    else:
        cache_dir = os.path.join(tempfile.gettempdir(), "anomalous_model_browser", "card_thumbnails")
    os.makedirs(cache_dir, exist_ok=True)
    return cache_dir


def thumbnail_cache_usage():
    """(file count, bytes) of the card image cache, for the settings page."""
    count = size = 0
    try:
        with os.scandir(_thumbnail_cache_directory()) as iterator:
            for entry in iterator:
                if entry.is_file() and entry.name.endswith('.webp'):
                    count += 1
                    try:
                        size += entry.stat().st_size
                    except OSError:
                        pass
    except OSError:
        pass
    return count, size


def clear_thumbnail_cache():
    """Delete the derived card images (never a cover); they are made again when needed."""
    removed = 0
    try:
        with os.scandir(_thumbnail_cache_directory()) as iterator:
            for entry in iterator:
                if entry.is_file() and entry.name.endswith('.webp'):
                    try:
                        os.remove(entry.path)
                        removed += 1
                    except OSError:
                        pass
    except OSError:
        pass
    return removed


def _prune_thumbnail_cache(cache_dir, created=False):
    """Occasionally cap the derived thumbnail cache without touching source covers."""
    global _thumbnail_last_cleanup, _thumbnail_created_since_cleanup
    now = time.monotonic()
    with _thumbnail_cleanup_lock:
        if created:
            _thumbnail_created_since_cleanup += 1
        now = time.monotonic()
        if (
            now - _thumbnail_last_cleanup < 3600
            and _thumbnail_created_since_cleanup < 64
        ):
            return
        _thumbnail_last_cleanup = now
        _thumbnail_created_since_cleanup = 0
        entries = []
        total_size = 0
        try:
            with os.scandir(cache_dir) as iterator:
                for entry in iterator:
                    if not entry.is_file() or not entry.name.endswith('.webp'):
                        continue
                    try:
                        stat = entry.stat()
                    except OSError:
                        continue
                    total_size += stat.st_size
                    entries.append((stat.st_mtime_ns, stat.st_size, entry.path))
        except OSError:
            return
        if total_size <= CARD_THUMBNAIL_CACHE_LIMIT:
            return
        target_size = int(CARD_THUMBNAIL_CACHE_LIMIT * 0.8)
        for _, size, path in sorted(entries):
            try:
                os.remove(path)
                total_size -= size
            except OSError:
                pass
            if total_size <= target_size:
                break


def _cached_card_path(source_path, kind=''):
    """Where the card image of `source_path` is cached: keyed by the file's identity and edge."""
    source_stat = os.stat(source_path)
    cache_key = "\0".join((
        os.path.realpath(source_path),
        str(source_stat.st_size),
        str(source_stat.st_mtime_ns),
        str(getattr(source_stat, 'st_ctime_ns', 0)),
        str(CARD_THUMBNAIL_EDGE),
        *((kind,) if kind else ()),
    ))
    digest = hashlib.sha256(cache_key.encode('utf-8', errors='surrogatepass')).hexdigest()
    cache_dir = _thumbnail_cache_directory()
    return cache_dir, os.path.join(cache_dir, f"{digest}.webp")


def _reuse_cached(cache_dir, cached_path):
    if not os.path.isfile(cached_path):
        return False
    try:
        os.utime(cached_path, None)
    except OSError:
        pass
    _prune_thumbnail_cache(cache_dir)
    return True


def _save_card_image(image, cache_dir, cached_path):
    """Shrink a PIL image to the card edge and store it as WebP (atomically)."""
    from PIL import Image

    resampling = getattr(Image, 'Resampling', Image).LANCZOS
    image.thumbnail((CARD_THUMBNAIL_EDGE, CARD_THUMBNAIL_EDGE), resampling)
    if image.mode not in ('RGB', 'RGBA'):
        image = image.convert('RGBA' if 'transparency' in image.info else 'RGB')
    temp_path = f"{cached_path}.{os.getpid()}.{threading.get_ident()}.tmp"
    try:
        image.save(temp_path, format='WEBP', quality=84, method=4)
        os.replace(temp_path, cached_path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
    _prune_thumbnail_cache(cache_dir, created=True)


def picture_size(path):
    """(width, height) of a picture from its header without decoding it (past Pillow's pixel
    limit too, for PNG); None when unknown."""
    from PIL import Image

    try:
        with open(path, 'rb') as file:
            head = file.read(24)
        if head[:8] == b'\x89PNG\r\n\x1a\n' and head[12:16] == b'IHDR':
            return struct.unpack('>II', head[16:24])
        with Image.open(path) as image:
            return image.size
    except (OSError, ValueError, Image.DecompressionBombError):
        return None


def _build_card_thumbnail_impl(source_path):
    """A cached 512px WebP card image; the original when it is small already (or an animation);
    _TOO_LARGE past Pillow's pixel limit; None when it cannot be read and is not small."""
    try:
        from PIL import Image, ImageOps

        cache_dir, cached_path = _cached_card_path(source_path)
        if _reuse_cached(cache_dir, cached_path):
            return cached_path
        size = picture_size(source_path)
        if size and size[0] * size[1] > Image.MAX_IMAGE_PIXELS:
            return _TOO_LARGE

        with Image.open(source_path) as image:
            if getattr(image, 'is_animated', False):
                return source_path
            image = ImageOps.exif_transpose(image)
            if max(image.size) <= CARD_THUMBNAIL_EDGE:
                return source_path
            _save_card_image(image, cache_dir, cached_path)
        return cached_path
    except Exception:
        try:
            return source_path if os.path.getsize(source_path) <= ORIGINAL_CARD_BYTES else None
        except OSError:
            return None


def _build_card_thumbnail(source_path):
    """The card image of a picture (_build_card_thumbnail_impl), one past Pillow's pixel limit
    made by a child process (shrunk_in_child). None: show picture_placeholder instead."""
    # Bound simultaneous decodes so opening a large folder cannot monopolize CPU/RAM.
    with _thumbnail_generation_slots:
        made = _build_card_thumbnail_impl(source_path)
    # Outside the slots: a huge decode takes long and must not hold the other cards up.
    return shrunk_in_child(source_path, CARD_THUMBNAIL_EDGE) if made is _TOO_LARGE else made


def shrunk_in_child(source_path, edge, kind=''):
    """A cached WebP of a very large picture, at most `edge` px, made once by a child process at
    low priority (its memory goes back when it ends), one at a time. None past
    HUGE_PICTURE_PIXELS, or when it failed for this file before."""
    size = picture_size(source_path)
    if not size or size[0] * size[1] > HUGE_PICTURE_PIXELS:
        return None
    try:
        cache_dir, cached_path = _cached_card_path(source_path, kind)
    except OSError:
        return None
    with _huge_lock:
        if _reuse_cached(cache_dir, cached_path):
            return cached_path
        if cached_path in _huge_failed:
            return None
        temp_path = f"{cached_path}.{os.getpid()}.huge.tmp"
        flags = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0) | getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        try:
            subprocess.run([sys.executable, '-I', _HUGE_SCRIPT, source_path, temp_path, str(edge), str(HUGE_PICTURE_PIXELS)],
                           check=True, capture_output=True, timeout=HUGE_DECODE_SECONDS, creationflags=flags)
            os.replace(temp_path, cached_path)
        except (OSError, subprocess.SubprocessError) as error:
            _huge_failed.add(cached_path)
            log.warning("Anomalous: could not shrink the %dx%d picture %s: %s", size[0], size[1],
                        os.path.basename(source_path), (getattr(error, 'stderr', None) or b'')[-300:] or error)
            return None
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
    _prune_thumbnail_cache(cache_dir, created=True)
    return cached_path


def picture_placeholder(source_path):
    """The card of a picture with no card image (too large, unreadable): its pixel size and file
    size on a plain tile, numbers only (nothing to translate)."""
    size = picture_size(source_path)
    try:
        megabytes = f"{os.path.getsize(source_path) / 1048576:.0f} MB"
    except OSError:
        megabytes = ""
    pixels = f"{size[0]} × {size[1]}" if size else ""
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
           '<rect width="512" height="512" fill="#2b2f36"/>'
           '<g fill="none" stroke="#8b93a1" stroke-width="10" stroke-linejoin="round">'
           '<rect x="176" y="150" width="160" height="130" rx="14"/><path d="m186 262 46-44 34 30 28-22 42 36"/></g>'
           '<circle cx="226" cy="196" r="14" fill="#8b93a1"/>'
           f'<text x="256" y="340" fill="#d5d9e0" font-family="sans-serif" font-size="30" text-anchor="middle">{pixels}</text>'
           f'<text x="256" y="382" fill="#8b93a1" font-family="sans-serif" font-size="26" text-anchor="middle">{megabytes}</text></svg>')
    return web.Response(body=svg.encode('utf-8'), content_type='image/svg+xml', headers={'Cache-Control': 'no-cache'})


def _build_video_poster_impl(source_path):
    """A cached 512 px WebP of a video cover's first frame, or None (no decoder, bad file)."""
    try:
        cache_dir, cached_path = _cached_card_path(source_path, 'poster')
        if _reuse_cached(cache_dir, cached_path):
            return cached_path
        import av  # PyAV ships with ComfyUI for its video nodes

        with av.open(source_path) as container:
            stream = next((s for s in container.streams if s.type == 'video'), None)
            if stream is None:
                return None
            stream.thread_type = 'AUTO'
            frame = next(container.decode(stream), None)
            if frame is None:
                return None
            image = frame.to_image()
        _save_card_image(image, cache_dir, cached_path)
        return cached_path
    except Exception:
        return None


def _build_video_poster(source_path):
    with _thumbnail_generation_slots:
        return _build_video_poster_impl(source_path)


# ---------- background warm-up of card images ----------

_warm_queue = collections.deque()
_warm_pending = set()
_warm_lock = threading.Lock()
_warm_thread = None


def _warm_worker():
    """One thread, one decode at a time, a short rest between: never more than half the slots."""
    global _warm_thread
    while True:
        with _warm_lock:
            if not _warm_queue:
                _warm_thread = None
                return
            path = _warm_queue.popleft()
            _warm_pending.discard(path)
        ext = os.path.splitext(path)[1].lower()
        if ext in CARD_POSTER_VIDEO_EXTENSIONS:
            _build_video_poster(path)
        else:
            _build_card_thumbnail(path)
        time.sleep(0.02)


def queue_card_images(paths):
    """Make the card images of these covers in the background (bounded, deduplicated)."""
    global _warm_thread
    with _warm_lock:
        for path in paths:
            ext = os.path.splitext(path)[1].lower()
            if ext not in CARD_THUMBNAIL_STATIC_EXTENSIONS and ext not in CARD_POSTER_VIDEO_EXTENSIONS:
                continue
            if path in _warm_pending or len(_warm_queue) >= CARD_WARM_QUEUE_LIMIT:
                continue
            _warm_pending.add(path)
            _warm_queue.append(path)
        if _warm_queue and _warm_thread is None:
            _warm_thread = threading.Thread(target=_warm_worker, name="anomalous-card-images", daemon=True)
            _warm_thread.start()


async def api_serve_image(request):
    """Dedicated image serving endpoint for model preview images."""
    folder_type = request.query.get('type', 'checkpoints')
    try:
        path_idx = int(request.query.get('path_idx', 0))
    except:
        path_idx = 0
    subfolder = request.query.get('subfolder', '')
    filename = request.query.get('filename', '')
    
    try:
        filename = require_filename(filename)
        _, target_dir = resolve_folder_subdir(folder_type, path_idx, subfolder)
        file_path = resolve_within(target_dir, filename)
    except (ValueError, KeyError):
        return web.Response(status=400, text='Invalid request')
    
    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        return web.Response(status=404, text='Image not found')
    
    ext = os.path.splitext(filename)[1].lower()
    content_types = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.avif': 'image/avif',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska'
    }
    content_type = content_types.get(ext)
    if content_type is None:
        return web.Response(status=415, text='Unsupported media type')
    
    served_path = file_path
    variant = request.query.get('variant')
    if variant == 'card' and ext in CARD_THUMBNAIL_STATIC_EXTENSIONS:
        served_path = await asyncio.to_thread(_build_card_thumbnail, file_path)
        if served_path is None:
            return picture_placeholder(file_path)
        if served_path != file_path:
            content_type = 'image/webp'
    elif variant == 'poster':
        # The card's still image of a video cover; nothing (404) when it cannot be read.
        poster = await asyncio.to_thread(_build_video_poster, file_path) if ext in CARD_POSTER_VIDEO_EXTENSIONS else None
        if not poster:
            return web.Response(status=404, text='No poster')
        served_path, content_type = poster, 'image/webp'

    headers = {'Content-Type': content_type}
    if request.query.get('t'):
        headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return web.FileResponse(served_path, headers=headers)


async def api_card_cache(request):
    """GET /anomalous/card_cache - how many card images are cached and their size."""
    count, size = await asyncio.to_thread(thumbnail_cache_usage)
    return web.json_response({"count": count, "bytes": size, "limit": CARD_THUMBNAIL_CACHE_LIMIT})


async def api_clear_card_cache(request):
    """POST /anomalous/card_cache/clear - delete the derived card images (made again when shown)."""
    removed = await asyncio.to_thread(clear_thumbnail_cache)
    return web.json_response({"status": "ok", "removed": removed})


async def api_clear_cache(request):
    try:
        from .metadata import clear_metadata_cache

        if hasattr(folder_paths, "filename_list_cache"):
            folder_paths.filename_list_cache.clear()
        if hasattr(folder_paths, "cache_helper") and hasattr(folder_paths.cache_helper, "clear"):
            folder_paths.cache_helper.clear()
        clear_metadata_cache()
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})


def read_png_text_fast(path):
    try:
        with open(path, 'rb') as f:
            signature = f.read(8)
            if signature != b'\x89PNG\r\n\x1a\n':
                return None
            while True:
                length_bytes = f.read(4)
                if not length_bytes: break
                length = struct.unpack('>I', length_bytes)[0]
                chunk_type = f.read(4)
                if chunk_type == b'tEXt':
                    data = f.read(length)
                    keyword, text = data.split(b'\0', 1)
                    if keyword == b'prompt':
                        return text.decode('utf-8', errors='ignore')
                else:
                    f.seek(length, 1)
                f.seek(4, 1)
    except Exception:
        pass
    return None


async def api_get_model_images(request):
    model_name = request.rel_url.query.get('model_name', '')
    if not model_name:
        return web.json_response({'images': []})
        
    base_target = os.path.basename(model_name).lower()
    
    # We will search the output directory
    output_dir = folder_paths.get_output_directory()
    if not os.path.exists(output_dir):
        return web.json_response({'images': []})
        
    def find_images():
        matched_images = []
        for root, _, files in os.walk(output_dir):
            for file in files:
                if not file.lower().endswith('.png'):
                    continue
                full_path = os.path.join(root, file)
                prompt_text = read_png_text_fast(full_path)
                if not prompt_text:
                    continue
                try:
                    prompt_data = json.loads(prompt_text)
                    matched = any(
                        os.path.basename(v).lower() == base_target
                        for node in prompt_data.values()
                        if isinstance(node, dict) and 'class_type' in node
                        for v in node.get('inputs', {}).values()
                        if isinstance(v, str)
                    )
                    if not matched:
                        continue
                    rel_path = os.path.relpath(root, output_dir).replace('\\', '/')
                    if rel_path == '.':
                        rel_path = ''
                    url = f'/view?filename={urllib.parse.quote(file)}&type=output'
                    if rel_path:
                        url += f'&subfolder={urllib.parse.quote(rel_path)}'
                    matched_images.append({'url': url, 'mtime': os.path.getmtime(full_path)})
                except (OSError, ValueError, TypeError, json.JSONDecodeError):
                    pass
        matched_images.sort(key=lambda x: x['mtime'], reverse=True)
        return matched_images

    matched_images = await asyncio.to_thread(find_images)
    
    return web.json_response({'images': matched_images})
