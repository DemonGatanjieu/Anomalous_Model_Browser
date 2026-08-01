import os
import sys
import json
import urllib.parse
import subprocess
import threading
import asyncio
from aiohttp import web
import folder_paths
import struct

async def api_serve_image(request):
    """Dedicated image serving endpoint for model preview images."""
    folder_type = request.query.get('type', 'checkpoints')
    try:
        path_idx = int(request.query.get('path_idx', 0))
    except:
        path_idx = 0
    subfolder = request.query.get('subfolder', '')
    filename = request.query.get('filename', '')
    
    if not filename or '..' in filename or '..' in subfolder:
        return web.Response(status=400, text='Invalid request')
    
    try:
        paths = folder_paths.get_folder_paths(folder_type)
    except Exception:
        return web.Response(status=404, text='Folder type not found')
    if not paths or path_idx >= len(paths):
        return web.Response(status=404, text='Folder type not found')
    
    base_dir = paths[path_idx]
    if subfolder:
        file_path = os.path.join(base_dir, subfolder, filename)
    else:
        file_path = os.path.join(base_dir, filename)
    
    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        return web.Response(status=404, text='Image not found')
    
    ext = os.path.splitext(filename)[1].lower()
    content_types = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo'
    }
    content_type = content_types.get(ext, 'application/octet-stream')
    
    return web.FileResponse(file_path, headers={'Content-Type': content_type})



async def api_clear_cache(request):
    try:
        if hasattr(folder_paths, "filename_list_cache"):
            folder_paths.filename_list_cache.clear()
        if hasattr(folder_paths, "cache_helper") and hasattr(folder_paths.cache_helper, "clear"):
            folder_paths.cache_helper.clear()
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
            
        page = int(request.query.get('page', 1))
        limit = int(request.query.get('limit', 50))
        
        valid_exts = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
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
                    except:
                        mtime = 0
                    images.append({
                        "filename": f,
                        "subfolder": subfolder,
                        "type": "output",
                        "mtime": mtime
                    })
                    
        # Sort by mtime descending (newest first)
        images.sort(key=lambda x: x['mtime'], reverse=True)
        
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
        
        if not filename or '..' in filename or '..' in subfolder:
            return web.json_response({"status": "error", "message": "Invalid parameters"})
            
        output_dir = folder_paths.get_output_directory()
        if subfolder:
            file_path = os.path.join(output_dir, subfolder, filename)
        else:
            file_path = os.path.join(output_dir, filename)
        
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
        
    matched_images = []
    
    # Search all PNGs in output_dir
    for root, _, files in os.walk(output_dir):
        for file in files:
            if file.lower().endswith('.png'):
                full_path = os.path.join(root, file)
                prompt_text = read_png_text_fast(full_path)
                if prompt_text:
                    try:
                        prompt_data = json.loads(prompt_text)
                        matched = False
                        for node_id, node in prompt_data.items():
                            if 'class_type' in node:
                                inputs = node.get('inputs', {})
                                for k, v in inputs.items():
                                    if isinstance(v, str):
                                        try:
                                            if os.path.basename(v).lower() == base_target:
                                                matched = True
                                                break
                                        except Exception:
                                            pass
                            if matched:
                                break
                                
                        if matched:
                            # Match found
                            rel_path = os.path.relpath(root, output_dir).replace('\\', '/')
                            if rel_path == '.': rel_path = ''
                            
                            # Standard comfyUI /view format:
                            # /view?filename=XX.png&type=output&subfolder=YY
                            url = f'/view?filename={urllib.parse.quote(file)}&type=output'
                            if rel_path:
                                url += f'&subfolder={urllib.parse.quote(rel_path)}'
                                
                            mtime = os.path.getmtime(full_path)
                            matched_images.append({
                                'url': url,
                                'mtime': mtime
                            })
                    except Exception:
                        pass
                        
    # Sort by mtime descending (newest first)
    matched_images.sort(key=lambda x: x['mtime'], reverse=True)
    
    return web.json_response({'images': matched_images})

def get_active_folder_types():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.json")
    
    all_types = list(folder_paths.folder_names_and_paths.keys())
    default_types = ['checkpoints', 'loras', 'unet', 'diffusion_models', 'controlnet', 'vae', 'embeddings', 'upscale_models']
    
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
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.json")
    
    all_types = list(folder_paths.folder_names_and_paths.keys())
    default_types = ['checkpoints', 'loras', 'unet', 'diffusion_models', 'controlnet', 'vae', 'embeddings', 'upscale_models']
    
    result = []
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
    except Exception:
        pass
        
    # Append unconfigured types
    for t in all_types:
        if t not in configured_types:
            result.append({
                "type": t,
                "visible": t in default_types
            })
            
    return web.json_response({"folder_types": result})
