"""Model cover, thumbnail-cache, and generated-image lookup routes."""

import asyncio
import hashlib
import json
import os
import struct
import threading
import urllib.parse

from aiohttp import web
import folder_paths

from .path_utils import require_filename, resolve_folder_subdir, resolve_within


CARD_THUMBNAIL_EDGE = 512
CARD_THUMBNAIL_CACHE_LIMIT = 256 * 1024 * 1024
CARD_THUMBNAIL_STATIC_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.avif'}
_thumbnail_cleanup_lock = threading.Lock()
_thumbnail_generation_slots = threading.BoundedSemaphore(2)
_thumbnail_last_cleanup = 0.0
_thumbnail_created_since_cleanup = 0


def _thumbnail_cache_directory():
    try:
        base_dir = folder_paths.get_temp_directory()
    except Exception:
        base_dir = None
    if not isinstance(base_dir, (str, os.PathLike)):
        base_dir = tempfile.gettempdir()
    cache_dir = os.path.join(base_dir, "anomalous_model_browser", "card_thumbnails")
    os.makedirs(cache_dir, exist_ok=True)
    return cache_dir


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


def _build_card_thumbnail_impl(source_path):
    """Return a cached 512px WebP card image, or the original on any safe fallback."""
    try:
        from PIL import Image, ImageOps

        source_stat = os.stat(source_path)
        cache_key = "\0".join((
            os.path.realpath(source_path),
            str(source_stat.st_size),
            str(source_stat.st_mtime_ns),
            str(getattr(source_stat, 'st_ctime_ns', 0)),
            str(CARD_THUMBNAIL_EDGE),
        ))
        digest = hashlib.sha256(cache_key.encode('utf-8', errors='surrogatepass')).hexdigest()
        cache_dir = _thumbnail_cache_directory()
        cached_path = os.path.join(cache_dir, f"{digest}.webp")
        if os.path.isfile(cached_path):
            try:
                os.utime(cached_path, None)
            except OSError:
                pass
            _prune_thumbnail_cache(cache_dir)
            return cached_path

        with Image.open(source_path) as image:
            if getattr(image, 'is_animated', False):
                return source_path
            image = ImageOps.exif_transpose(image)
            if max(image.size) <= CARD_THUMBNAIL_EDGE:
                return source_path
            resampling = getattr(Image, 'Resampling', Image).LANCZOS
            image.thumbnail((CARD_THUMBNAIL_EDGE, CARD_THUMBNAIL_EDGE), resampling)
            if image.mode not in ('RGB', 'RGBA'):
                image = image.convert('RGBA' if 'transparency' in image.info else 'RGB')
            temp_path = (
                f"{cached_path}.{os.getpid()}.{threading.get_ident()}.tmp"
            )
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
        return cached_path
    except Exception:
        return source_path


def _build_card_thumbnail(source_path):
    # Bound simultaneous decodes so opening a large folder cannot monopolize CPU/RAM.
    with _thumbnail_generation_slots:
        return _build_card_thumbnail_impl(source_path)


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
        '.avi': 'video/x-msvideo'
    }
    content_type = content_types.get(ext)
    if content_type is None:
        return web.Response(status=415, text='Unsupported media type')
    
    served_path = file_path
    if (
        request.query.get('variant') == 'card'
        and ext in CARD_THUMBNAIL_STATIC_EXTENSIONS
    ):
        served_path = await asyncio.to_thread(_build_card_thumbnail, file_path)
        if served_path != file_path:
            content_type = 'image/webp'

    headers = {'Content-Type': content_type}
    if request.query.get('t'):
        headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return web.FileResponse(served_path, headers=headers)


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
