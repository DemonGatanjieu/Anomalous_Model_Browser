import os
import sys
import json
import urllib.parse
import urllib.request
import subprocess
import threading
import asyncio
from aiohttp import web
import folder_paths
import struct
import hashlib
import tempfile
import time


CARD_THUMBNAIL_EDGE = 512
CARD_THUMBNAIL_CACHE_LIMIT = 256 * 1024 * 1024
CARD_THUMBNAIL_STATIC_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.avif'}
_thumbnail_cleanup_lock = threading.Lock()
_thumbnail_generation_slots = threading.BoundedSemaphore(2)
_thumbnail_last_cleanup = 0.0
_thumbnail_created_since_cleanup = 0


def resolve_within(base_dir, *parts):
    """Resolve a path and require it to stay inside base_dir, including through symlinks."""
    base_real = os.path.realpath(base_dir)
    candidate = os.path.realpath(os.path.join(base_real, *parts))
    try:
        if os.path.commonpath([base_real, candidate]) != base_real:
            raise ValueError("Path escapes the configured directory")
    except ValueError:
        raise ValueError("Path escapes the configured directory")
    return candidate


def get_folder_root(folder_type, path_idx=0):
    paths = folder_paths.get_folder_paths(folder_type)
    if not paths or not isinstance(path_idx, int) or path_idx < 0 or path_idx >= len(paths):
        raise ValueError("Invalid folder path")
    return os.path.realpath(paths[path_idx])


def resolve_folder_subdir(folder_type, path_idx=0, subfolder='/'):
    base_dir = get_folder_root(folder_type, path_idx)
    relative = "" if subfolder in (None, "", "/") else str(subfolder).strip("/\\")
    return base_dir, resolve_within(base_dir, relative)


def require_filename(filename):
    if not isinstance(filename, str) or not filename or os.path.basename(filename) != filename:
        raise ValueError("Invalid filename")
    return filename


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


async def api_translate(request):
    try:
        data = await request.json()
        text = data.get("text", "")
        tl = data.get("target_lang", "zh-CN")
        if not text:
            return web.json_response({"translated": ""})
            
        # Try DeepL if API key exists
        script_dir = os.path.dirname(os.path.abspath(__file__))
        config_path = os.path.join(script_dir, "config.json")
        deepl_key = ""
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    deepl_key = cfg.get("DEEPL_API_KEY", "").strip()
            except:
                pass
                
        if deepl_key:
            deepl_map = { "zh-CN": "ZH", "en": "EN", "ja": "JA", "ko": "KO", "fr": "FR", "de": "DE", "es": "ES", "ru": "RU" }
            d_tl = deepl_map.get(tl, "EN")
            url = "https://api-free.deepl.com/v2/translate" if ":fx" in deepl_key else "https://api.deepl.com/v2/translate"
            payload = urllib.parse.urlencode({
                "auth_key": deepl_key,
                "text": text,
                "target_lang": d_tl
            }).encode('utf-8')
            req = urllib.request.Request(url, data=payload)
            with urllib.request.urlopen(req, timeout=5) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                return web.json_response({"translated": result["translations"][0]["text"]})
        else:
            # Fallback to Google Translate (free, no key)
            url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl={tl}&dt=t&q={urllib.parse.quote(text)}"
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                # Google Translate returns a list of fragments
                translated_text = "".join([part[0] for part in result[0]])
                return web.json_response({"translated": translated_text})
                
    except Exception as e:
        print(f"Translate Error: {e}")
        return web.json_response({"translated": text, "error": str(e)})


async def api_get_gallery_images(request):
    try:
        output_dir = folder_paths.get_output_directory()
        if not os.path.exists(output_dir):
            return web.json_response({"images": [], "total": 0, "page": 1, "pages": 0})
            
        page = max(1, int(request.query.get('page', 1)))
        limit = min(200, max(1, int(request.query.get('limit', 50))))
        
        valid_exts = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
        def collect_images():
            images = []
            for root, dirs, files in os.walk(output_dir):
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in valid_exts:
                        rel_path = os.path.relpath(root, output_dir)
                        subfolder = "" if rel_path == "." else rel_path.replace('\\', '/')
                        full_path = os.path.join(root, f)
                        try:
                            mtime = os.path.getmtime(full_path)
                        except OSError:
                            mtime = 0
                        images.append({
                            "filename": f,
                            "subfolder": subfolder,
                            "type": "output",
                            "mtime": mtime
                        })
            images.sort(key=lambda x: x['mtime'], reverse=True)
            return images

        images = await asyncio.to_thread(collect_images)
        
        total = len(images)
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        paginated_images = images[start_idx:end_idx]
        
        return web.json_response({
            "images": paginated_images,
            "total": total,
            "page": page,
            "pages": (total + limit - 1) // limit if limit > 0 else 0
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

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
            return web.json_response({"status": "success"})
        else:
            return web.json_response({"status": "error", "message": "File not found"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

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

def get_folder_view_mode():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.json")
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                return cfg.get("folder_view_mode", "abstract")
    except:
        pass
    return "abstract"

def get_all_physical_basenames():
    basenames = set()
    for t in folder_paths.folder_names_and_paths.keys():
        try:
            paths = folder_paths.get_folder_paths(t)
            if not paths: continue
            for p in paths:
                bn = os.path.basename(os.path.normpath(p))
                if bn: basenames.add(bn)
        except:
            pass
    return list(basenames)

def get_active_physical_basenames():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.json")
    
    all_bns = get_all_physical_basenames()
    active = []
    configured = set()
    
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                pfc = cfg.get("physical_folders_config")
                if pfc and isinstance(pfc, list):
                    for item in pfc:
                        bn = item.get("type")
                        if bn in all_bns:
                            configured.add(bn)
                            if item.get("visible", True):
                                active.append(bn)
                    
                    for bn in all_bns:
                        if bn not in configured:
                            active.append(bn)
                    return active
    except:
        pass
        
    return all_bns

def get_active_scan_paths():
    mode = get_folder_view_mode()
    paths = set()
    
    if mode == "physical":
        active_bns = set(get_active_physical_basenames())
        for t in folder_paths.folder_names_and_paths.keys():
            try:
                ps = folder_paths.get_folder_paths(t)
                if not ps: continue
                for p in ps:
                    if not os.path.exists(p): continue
                    bn = os.path.basename(os.path.normpath(p))
                    if bn in active_bns:
                        paths.add(os.path.realpath(p))
            except:
                pass
    else:
        active_types = get_active_folder_types()
        for t in active_types:
            try:
                ps = folder_paths.get_folder_paths(t)
                if not ps: continue
                for p in ps:
                    if not os.path.exists(p): continue
                    paths.add(os.path.realpath(p))
            except:
                pass
                
    return list(paths)

def get_active_folder_types():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.json")
    
    all_types = list(folder_paths.folder_names_and_paths.keys())
    default_types = ['checkpoints', 'loras', 'diffusion_models', 'unet', 'controlnet', 'vae']
    
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                ftc = cfg.get("folder_types_config")
                if ftc and isinstance(ftc, list):
                    active = []
                    configured_types = set()
                    for item in ftc:
                        t = item.get("type")
                        if t in all_types:
                            configured_types.add(t)
                            if item.get("visible", True):
                                active.append(t)
                    # For any newly registered types not in config, do not show them by default 
                    # unless they are in default_types
                    for t in all_types:
                        if t not in configured_types and t in default_types:
                            active.append(t)
                    return active
    except Exception:
        pass
    
    # Fallback if no config exists
    active = [t for t in default_types if t in all_types]
    return active

async def api_get_all_folder_types(request):
    mode = get_folder_view_mode()
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.json")
    
    result = []
    
    if mode == "physical":
        all_bns = get_all_physical_basenames()
        configured = set()
        try:
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    pfc = cfg.get("physical_folders_config")
                    if pfc and isinstance(pfc, list):
                        for item in pfc:
                            bn = item.get("type")
                            if bn in all_bns:
                                configured.add(bn)
                                result.append({
                                    "type": bn,
                                    "visible": item.get("visible", True)
                                })
        except:
            pass
            
        default_physical_types = ['checkpoints', 'loras', 'unet', 'diffusion_models', 'controlnet', 'vae']
        for bn in all_bns:
            if bn not in configured:
                result.append({
                    "type": bn,
                    "visible": bn in default_physical_types
                })
    else:
        # Abstract mode
        all_types = list(folder_paths.folder_names_and_paths.keys())
        default_types = ['checkpoints', 'loras', 'diffusion_models', 'controlnet', 'vae']
        configured_types = set()
        try:
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    ftc = cfg.get("folder_types_config")
                    if ftc and isinstance(ftc, list):
                        for item in ftc:
                            t = item.get("type")
                            if t in all_types:
                                configured_types.add(t)
                                result.append({
                                    "type": t,
                                    "visible": item.get("visible", True)
                                })
        except:
            pass
            
        for t in all_types:
            if t not in configured_types:
                result.append({
                    "type": t,
                    "visible": t in default_types
                })
                
    return web.json_response({"folder_types": result, "folder_view_mode": mode})
