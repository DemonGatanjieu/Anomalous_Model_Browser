"""Model preview lookup and bounded custom-cover operations."""

import asyncio
import os
import shutil
import urllib.parse

from aiohttp import web
import folder_paths

from .model_constants import MEDIA_EXTENSIONS, PREVIEW_SUFFIXES
from .utils import require_filename, resolve_folder_subdir, resolve_within

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
    
    # Delete any existing .preview.* files to ensure only one custom cover is active
    for ext in PREVIEW_SUFFIXES:
        p = os.path.join(target_dir, f"{base_name}{ext}")
        if os.path.exists(p) and p != dest_path:
            try: os.remove(p)
            except: pass
            
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
    rel_subfolder = os.path.relpath(root, base_dir)
    if rel_subfolder == '.':
        rel_subfolder = '/'
    q_type = urllib.parse.quote(folder_type)
    q_idx = str(path_idx)
    q_sub = urllib.parse.quote(rel_subfolder)
    q_file = urllib.parse.quote(preview_file)
    version = _cache_token(os.path.join(root, preview_file))
    return f"/anomalous/image?type={q_type}&path_idx={q_idx}&subfolder={q_sub}&filename={q_file}&t={version}"
