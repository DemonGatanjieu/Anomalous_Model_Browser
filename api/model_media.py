"""Model preview lookup and bounded custom-cover operations."""

import asyncio
import os
import shutil
import urllib.parse

from aiohttp import web
import folder_paths

from .model_constants import MEDIA_EXTENSIONS, PREVIEW_SUFFIXES
try:
    from ..model_sidecars import backups, is_civitai_cover, keep_aside
except ImportError:
    from model_sidecars import backups, is_civitai_cover, keep_aside
from .trash import move_to_trash
from .utils import model_file_within, require_filename, resolve_folder_subdir, resolve_within

def _cache_token(file_path):
    try:
        return os.stat(file_path).st_mtime_ns
    except OSError:
        return 0


async def _handle_custom_cover(target_dir, filename, save_func, source_ext='.png'):
    base_name = os.path.splitext(filename)[0]
    
    # Always save custom covers with a .preview.[ext] suffix so standard nodes recognize them as covers.
    if source_ext.startswith('.preview.'):
        preview_ext = source_ext
    else:
        preview_ext = f".preview{source_ext}"
        
    dest_path = os.path.join(target_dir, f"{base_name}{preview_ext}")
    
    # Civitai's picture, when it is the cover, is kept aside first, to bring back from the editor.
    base = os.path.join(target_dir, base_name)
    covers = [path for path in (os.path.join(target_dir, f"{base_name}{ext}") for ext in PREVIEW_SUFFIXES) if os.path.isfile(path)]
    if not backups(base):
        civitai = next((path for path in covers if is_civitai_cover(path, base, [])), None)
        if civitai:
            keep_aside(base, civitai)

    # Only one cover is active: the others go to the Recycle Bin (a failure keeps them).
    older = [os.path.join(target_dir, f"{base_name}{ext}") for ext in PREVIEW_SUFFIXES]
    try:
        move_to_trash(*[path for path in older if path != dest_path])
    except OSError as e:
        print(f"[Anomalous Browser] Old cover kept: {e}")

    await save_func(dest_path)


async def api_set_custom_cover(request):
    try:
        data = await request.json()
        folder_type = data.get('type', 'checkpoints')
        subfolder = data.get('subfolder', '/')
        filename = data.get('filename', '')
        source_image = data.get('source_image', '')
        try: path_idx = int(data.get('path_idx', 0))
        except: path_idx = 0

        try:
            filename = require_filename(filename)
            _, target_dir = resolve_folder_subdir(folder_type, path_idx, subfolder)
            output_dir = folder_paths.get_output_directory()
            src_path = resolve_within(output_dir, source_image)
        except (ValueError, KeyError):
            return web.json_response({"status": "error", "message": "Invalid request parameters"}, status=400)
        if not os.path.exists(src_path):
            return web.json_response({"status": "error", "message": "Source image not found in output directory"})
            
        source_ext = os.path.splitext(src_path)[1].lower()
        if source_ext not in {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi'}:
            return web.json_response({"status": "error", "message": "Unsupported cover format"}, status=415)
            
        async def save_copy(dest_path):
            import shutil
            import asyncio
            await asyncio.to_thread(shutil.copy2, src_path, dest_path)
            
        await _handle_custom_cover(target_dir, filename, save_copy, source_ext)
        
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})


async def api_upload_custom_cover(request):
    try:
        data = await request.post()
        folder_type = data.get('type', 'checkpoints')
        subfolder = data.get('subfolder', '/')
        filename = data.get('filename', '')
        try: path_idx = int(data.get('path_idx', 0))
        except: path_idx = 0
        
        image_field = data.get('image')

        try:
            filename = require_filename(filename)
            _, target_dir = resolve_folder_subdir(folder_type, path_idx, subfolder)
        except (ValueError, KeyError):
            return web.json_response({"status": "error", "message": "Invalid request parameters"}, status=400)
        if image_field is None:
            return web.json_response({"status": "error", "message": "Image is required"}, status=400)
        
        image_data = image_field.file.read()
        if len(image_data) > 100 * 1024 * 1024:
            return web.json_response({"status": "error", "message": "Cover file is too large"}, status=413)
        
        upload_filename = image_field.filename
        source_ext = os.path.splitext(upload_filename)[1].lower()
        if source_ext not in {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi'}:
            return web.json_response({"status": "error", "message": "Unsupported cover format"}, status=415)
        
        async def save_upload(dest_path):
            def write_file():
                with open(dest_path, 'wb') as f:
                    f.write(image_data)
            import asyncio
            await asyncio.to_thread(write_file)
            
        await _handle_custom_cover(target_dir, filename, save_upload, source_ext)
        
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})


def _preview_url_for_model(folder_type, path_idx, base_dir, file_path):
    root = os.path.dirname(file_path)
    filename = os.path.basename(file_path)
    base_name = os.path.splitext(filename)[0]
    preview_file = next(
        (
            base_name + suffix
            for suffix in PREVIEW_SUFFIXES + MEDIA_EXTENSIONS
            if os.path.isfile(os.path.join(root, base_name + suffix))
        ),
        None,
    )
    if not preview_file:
        return ""
    return _media_url(folder_type, path_idx, base_dir, os.path.join(root, preview_file))


def _media_url(folder_type, path_idx, base_dir, media_path):
    """The /anomalous/image URL of a file beside a model, with a token that changes with it."""
    rel_subfolder = os.path.relpath(os.path.dirname(media_path), base_dir)
    if rel_subfolder == '.':
        rel_subfolder = '/'
    q_type = urllib.parse.quote(folder_type)
    q_idx = str(path_idx)
    q_sub = urllib.parse.quote(rel_subfolder)
    q_file = urllib.parse.quote(os.path.basename(media_path))
    version = _cache_token(media_path)
    return f"/anomalous/image?type={q_type}&path_idx={q_idx}&subfolder={q_sub}&filename={q_file}&t={version}"


def _model_covers(folder_type, path_idx, base_dir, file_path):
    """Civitai's own image kept aside (<model>.civitai_bak.*, beside or in .amb) as a URL, or "",
    and whether the cover shown is another picture (the user's), not Civitai's (model_sidecars)."""
    base = os.path.splitext(file_path)[0]
    kept = backups(base)
    saved = kept[0] if kept else ""
    shown = next((base + suffix for suffix in PREVIEW_SUFFIXES + MEDIA_EXTENSIONS if os.path.isfile(base + suffix)), "")
    custom = bool(shown) and not is_civitai_cover(shown, base, kept)
    return {"civitai": _media_url(folder_type, path_idx, base_dir, saved) if saved else "", "custom": custom}


async def api_model_covers(request):
    """GET /anomalous/model_covers?type&path_idx&subfolder&filename - for the model editor: the
    Civitai cover it can bring back, and whether the one shown is the user's."""
    try:
        folder_type = request.query.get('type', '')
        path_idx = int(request.query.get('path_idx', 0))
        filename = require_filename(request.query.get('filename', ''))
        base_dir, target_dir = resolve_folder_subdir(folder_type, path_idx, request.query.get('subfolder', '/'))
        file_path = model_file_within(target_dir, filename)
    except (ValueError, KeyError, TypeError):
        return web.json_response({"error": "Invalid model location"}, status=400)
    if not os.path.isfile(file_path):
        return web.json_response({"error": "Model not found"}, status=404)
    return web.json_response(await asyncio.to_thread(_model_covers, folder_type, path_idx, base_dir, file_path))
