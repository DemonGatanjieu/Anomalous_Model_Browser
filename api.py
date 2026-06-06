import os
import sys
import json
import urllib.parse
import subprocess
import threading
from aiohttp import web
import folder_paths

def get_metadata(file_path):
    base_path = os.path.splitext(file_path)[0]
    metadata = {
        "name": os.path.basename(base_path),
        "description": "",
        "notes": "",
        "trainedWords": [],
        "baseModel": "",
        "civitai_url": ""
    }
    
    info_files = [f"{base_path}.civitai.info", f"{base_path}.info"]
    for info_file in info_files:
        if os.path.exists(info_file):
            try:
                with open(info_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    
                    name = data.get("name", "")
                    if "model" in data and isinstance(data["model"], dict):
                        model_name = data["model"].get("name", "")
                        name = f"{model_name} - {name}".strip(' -')
                        
                    description = data.get("description", "") or ""
                    if not description and "model" in data and isinstance(data["model"], dict):
                        description = data["model"].get("description", "")
                    notes = data.get("notes", "") 
                    trained_words = data.get("trainedWords", [])
                    base_model = data.get("baseModel", "")
                    
                    model_id = data.get("modelId", "")
                    version_id = data.get("id", "")
                    civitai_url = ""
                    if model_id:
                        # Handle Civitai's new mature content policy
                        nsfw_level = data.get("nsfwLevel", 1)
                        is_nsfw = False
                        if "model" in data and isinstance(data["model"], dict):
                            is_nsfw = data["model"].get("nsfw", False)
                        
                        domain = "civitai.red" if (nsfw_level > 1 or is_nsfw) else "civitai.com"
                        civitai_url = f"https://{domain}/models/{model_id}"
                        if version_id:
                            civitai_url += f"?modelVersionId={version_id}"
                    
                    metadata["name"] = name if name else metadata["name"]
                    metadata["description"] = description
                    metadata["notes"] = notes
                    metadata["trainedWords"] = trained_words
                    metadata["baseModel"] = base_model
                    metadata["civitai_url"] = civitai_url
                    break
            except Exception:
                pass
                
    return metadata


async def api_get_folders(request):
    types = ['checkpoints', 'loras', 'unet', 'diffusion_models']
    result = []
    seen_dirs = set()
    
    for t in types:
        try:
            paths = folder_paths.get_folder_paths(t)
        except Exception:
            continue
        if not paths:
            continue
            
        for path_idx, base_dir in enumerate(paths):
            if not os.path.exists(base_dir):
                continue
            real_path = os.path.realpath(base_dir)
            if real_path in seen_dirs:
                continue
            seen_dirs.add(real_path)
            
            tree = {}
            for root, dirs, files in os.walk(base_dir):
                has_models = any(f.endswith(('.safetensors', '.ckpt', '.pt')) for f in files)
                rel = os.path.relpath(root, base_dir)
                if rel == '.':
                    rel = '/'
                else:
                    rel = '/' + rel.replace('\\', '/')
                tree[rel] = {
                    "path": rel,
                    "name": os.path.basename(root) if rel != '/' else '[Root]',
                    "has_models": has_models,
                    "model_count": sum(1 for f in files if f.endswith(('.safetensors', '.ckpt', '.pt')))
                }
                
            label = t.capitalize()
            if path_idx > 0:
                label += f" ({os.path.basename(base_dir)})"
                
            result.append({
                "type": t,
                "path_idx": path_idx,
                "label": label,
                "folders": tree
            })
        
    return web.json_response({"folders": result})


async def api_get_models(request):
    folder_type = request.query.get('type', 'checkpoints')
    subfolder = request.query.get('subfolder', '/')
    try:
        path_idx = int(request.query.get('path_idx', 0))
    except:
        path_idx = 0
    
    try:
        paths = folder_paths.get_folder_paths(folder_type)
    except Exception:
        return web.json_response({"models": []})
    if not paths or path_idx >= len(paths):
        return web.json_response({"models": []})
        
    if '..' in subfolder:
        return web.Response(status=400, text='Invalid subfolder')
        
    base_dir = paths[path_idx]
    if subfolder == '/':
        target_dir = base_dir
        rel_subfolder = ""
    else:
        rel_subfolder = subfolder.strip('/')
        target_dir = os.path.join(base_dir, rel_subfolder)
        
    if not os.path.exists(target_dir):
        return web.json_response({"models": []})
        
    models = []
    try:
        entries = os.listdir(target_dir)
    except Exception:
        return web.json_response({"models": []})
        
    for f in sorted(entries):
        if f.endswith('.safetensors') or f.endswith('.ckpt') or f.endswith('.pt'):
            file_path = os.path.join(target_dir, f)
            if not os.path.isfile(file_path):
                continue
                
            meta = get_metadata(file_path)
            
            base_name = os.path.splitext(f)[0]
            preview_file = None
            for ext in ['.preview.png', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm']:
                if os.path.exists(os.path.join(target_dir, base_name + ext)):
                    preview_file = base_name + ext
                    break
            
            preview_url = ""
            if preview_file:
                q_type = urllib.parse.quote(folder_type)
                q_idx = str(path_idx)
                q_sub = urllib.parse.quote(rel_subfolder)
                q_file = urllib.parse.quote(preview_file)
                preview_url = f"/anomalous/image?type={q_type}&path_idx={q_idx}&subfolder={q_sub}&filename={q_file}"

            try:
                size_mb = round(os.path.getsize(file_path) / (1024 * 1024), 1)
            except Exception:
                size_mb = 0
                
            models.append({
                "filename": f,
                "size_mb": size_mb,
                "metadata": meta,
                "preview_url": preview_url
            })
            
    return web.json_response({"models": models})


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
        '.gif': 'image/gif'
    }
    content_type = content_types.get(ext, 'application/octet-stream')
    
    return web.FileResponse(file_path, headers={'Content-Type': content_type})



async def api_scan_status(request):
    folder_type = request.query.get('type', 'checkpoints')
    subfolder = request.query.get('subfolder', '/')
    try:
        path_idx = int(request.query.get('path_idx', 0))
    except:
        path_idx = 0
    try:
        paths = folder_paths.get_folder_paths(folder_type)
    except Exception:
        return web.json_response({"scanning": False})
    if not paths or path_idx >= len(paths) or '..' in subfolder:
        return web.json_response({"scanning": False})
    
    base_dir = paths[path_idx]
    if subfolder == '/':
        target_dir = base_dir
    else:
        target_dir = os.path.join(base_dir, subfolder.strip('/'))
    
    marker_file = os.path.join(target_dir, '.scan_in_progress')
    result_file = os.path.join(target_dir, '.scan_result.json')
    scanning = os.path.exists(marker_file)
    
    data = {"scanning": scanning}
    if not scanning and os.path.exists(result_file):
        try:
            with open(result_file, 'r', encoding='utf-8') as f:
                data["result"] = __import__('json').load(f)
            os.remove(result_file)
        except:
            pass
            
    return web.json_response(data)

async def api_scan_folder(request):
    """Launches the scraper in the background for a specific directory."""
    folder_type = request.query.get('type', 'checkpoints')
    subfolder = request.query.get('subfolder', '/')
    try:
        path_idx = int(request.query.get('path_idx', 0))
    except:
        path_idx = 0
        
    if '..' in subfolder:
        return web.json_response({"status": "error", "message": "Invalid subfolder"})
        
    try:
        paths = folder_paths.get_folder_paths(folder_type)
    except Exception:
        return web.json_response({"status": "error", "message": "Invalid folder type"})
        
    if not paths or path_idx >= len(paths):
        return web.json_response({"status": "error", "message": "Invalid path index"})
        
    base_dir = paths[path_idx]
    if subfolder == '/':
        target_dir = base_dir
    else:
        target_dir = os.path.join(base_dir, subfolder.strip('/'))
        
    if not os.path.exists(target_dir):
        return web.json_response({"status": "error", "message": "Directory does not exist"})
        
    # Get the scraper path relative to this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    scraper_path = os.path.join(script_dir, "scraper.py")
    
    if not os.path.exists(scraper_path):
        return web.json_response({"status": "error", "message": "scraper.py not found in extension directory"})
        
    print(f"[Anomalous Browser] Starting background scan for: {target_dir}")
    
    try:
        marker_file = os.path.join(target_dir, '.scan_in_progress')
        with open(marker_file, 'w') as f: f.write('1')
        def run_bg():
            try:
                subprocess.run(
                    [sys.executable, scraper_path, target_dir],
                    cwd=script_dir,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            finally:
                if os.path.exists(marker_file):
                    try: os.remove(marker_file)
                    except: pass
        
        threading.Thread(target=run_bg, daemon=True).start()
        
        return web.json_response({"status": "ok", "message": "Scan started in background. Check console for details."})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})


async def api_get_config(request):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.json")
    has_key = False
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                has_key = bool(cfg.get("CIVITAI_API_KEY", "").strip())
        except:
            pass
    return web.json_response({"has_api_key": has_key})

async def api_save_config(request):
    try:
        data = await request.json()
        api_key = data.get("api_key", "").strip()
        script_dir = os.path.dirname(os.path.abspath(__file__))
        config_path = os.path.join(script_dir, "config.json")
        
        cfg = {}
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
            except:
                pass
                
        cfg["CIVITAI_API_KEY"] = api_key
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=4)
            
        return web.json_response({"status": "ok"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})


async def api_delete_model(request):
    try:
        data = await request.json()
        folder_type = data.get('type', 'checkpoints')
        subfolder = data.get('subfolder', '/')
        filename = data.get('filename', '')
        try:
            path_idx = int(data.get('path_idx', 0))
        except:
            path_idx = 0
            
        if not filename or '..' in filename or '..' in subfolder:
            return web.json_response({"status": "error", "message": "Invalid request parameters"})
            
        try:
            paths = folder_paths.get_folder_paths(folder_type)
        except Exception:
            return web.json_response({"status": "error", "message": "Invalid folder type"})
            
        if not paths or path_idx >= len(paths):
            return web.json_response({"status": "error", "message": "Invalid path index"})
            
        base_dir = paths[path_idx]
        if subfolder == '/':
            target_dir = base_dir
        else:
            target_dir = os.path.join(base_dir, subfolder.strip('/'))
            
        model_path = os.path.join(target_dir, filename)
        if not os.path.exists(model_path):
            return web.json_response({"status": "error", "message": "Model file not found"})
            
        # 1. 优先尝试删除你点击的主模型文件
        try:
            os.remove(model_path)
        except Exception as e:
            error_msg = str(e)
            if "being used" in error_msg or "WinError 32" in error_msg or "Permission" in error_msg:
                error_msg = "文件被占用 (正在被 ComfyUI 使用)。请先重启 ComfyUI 或在工作流中卸载该模型后再删除！"
            return web.json_response({"status": "error", "message": f"主模型删除失败: {error_msg}"})

        base_name = os.path.splitext(filename)[0]
        
        # 2. 主模型成功删除后，再清理配套的垃圾文件
        associated_exts = [
            '.safetensors', '.ckpt', '.pt', '.bin',
            '.info', '.civitai.info', 
            '.png', '.preview.png', '.jpg', '.jpeg', '.webp', '.gif',
            '.json', '.txt', '.yaml'
        ]
        
        deleted_files = [filename]
        for ext in associated_exts:
            file_to_del = os.path.join(target_dir, base_name + ext)
            if file_to_del == model_path:
                continue
            if os.path.exists(file_to_del) and os.path.isfile(file_to_del):
                try:
                    os.remove(file_to_del)
                    deleted_files.append(base_name + ext)
                except Exception as e:
                    print(f"[Anomalous Browser] Warning: Failed to delete {file_to_del}: {e}")
                    
        # 3. 修正：前端期待的成功状态是 "success" 而不是 "ok"
        return web.json_response({"status": "success", "deleted": deleted_files})
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)

async def api_clean_civitai_info(request):
    try:
        types = ['checkpoints', 'loras', 'unet', 'diffusion_models']
        deleted_count = 0
        for t in types:
            try:
                paths = folder_paths.get_folder_paths(t)
            except Exception:
                continue
            if not paths: continue
            
            for base_dir in paths:
                if not os.path.exists(base_dir): continue
                for root, dirs, files in os.walk(base_dir):
                    for file in files:
                        if file.endswith('.civitai.info'):
                            file_path = os.path.join(root, file)
                            try:
                                os.remove(file_path)
                                deleted_count += 1
                            except Exception as e:
                                pass
                                
        return web.json_response({"status": "success", "count": deleted_count})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

async def api_compatible_models(request):
    base_model = request.query.get('base_model', '')
    target_type = request.query.get('target_type', 'loras')
    
    if not base_model:
        return web.json_response({"models": []})
        
    target_types = [t.strip() for t in target_type.split(',')]
    compatible_models = []
    seen_files = set()
    
    for t in target_types:
        try:
            paths = folder_paths.get_folder_paths(t)
        except Exception:
            continue
            
        if not paths:
            continue
            
        for path_idx, base_dir in enumerate(paths):
            if not os.path.exists(base_dir):
                continue
                
            for root, _, files in os.walk(base_dir):
                for f in files:
                    if f.endswith('.safetensors') or f.endswith('.ckpt') or f.endswith('.pt'):
                        file_path = os.path.join(root, f)
                        real_path = os.path.realpath(file_path)
                        if real_path in seen_files:
                            continue
                        seen_files.add(real_path)
                        
                        meta = get_metadata(file_path)
                        
                        m_bm = str(meta.get("baseModel", "")).strip().lower()
                        req_bm = str(base_model).strip().lower()
                        if m_bm and m_bm == req_bm:
                            rel_subfolder = os.path.relpath(root, base_dir)
                            if rel_subfolder == '.':
                                rel_subfolder = '/'
                            else:
                                rel_subfolder = '/' + rel_subfolder.replace('\\', '/')
                                
                            base_name = os.path.splitext(f)[0]
                            preview_file = None
                            for ext in ['.preview.png', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm']:
                                if os.path.exists(os.path.join(root, base_name + ext)):
                                    preview_file = base_name + ext
                                    break
                            
                            preview_url = ""
                            preview_url = ""
                            if preview_file:
                                q_type = urllib.parse.quote(t)
                                q_idx = str(path_idx)
                                q_sub = urllib.parse.quote(rel_subfolder.strip('/')) if rel_subfolder != '/' else ""
                                q_file = urllib.parse.quote(preview_file)
                                preview_url = f"/anomalous/image?type={q_type}&path_idx={q_idx}&subfolder={q_sub}&filename={q_file}"
                            
                            try:
                                size_mb = round(os.path.getsize(file_path) / (1024 * 1024), 1)
                            except:
                                size_mb = 0
                            
                            compatible_models.append({
                                "type": t,
                                "path_idx": path_idx,
                                "subfolder": rel_subfolder,
                                "filename": f,
                                "size_mb": size_mb,
                                "preview_url": preview_url,
                                "metadata": meta
                            })
                        
    return web.json_response({"models": compatible_models})


def setup_routes(app):
    app.router.add_get('/anomalous/folders', api_get_folders)
    app.router.add_get('/anomalous/models', api_get_models)
    app.router.add_get('/anomalous/image', api_serve_image)
    app.router.add_post('/anomalous/scan', api_scan_folder)
    app.router.add_get('/anomalous/scan_status', api_scan_status)
    app.router.add_get('/anomalous/config', api_get_config)
    app.router.add_post('/anomalous/save_config', api_save_config)
    app.router.add_post('/anomalous/delete_model', api_delete_model)
    app.router.add_post('/anomalous/clean_civitai_info', api_clean_civitai_info)
    app.router.add_get('/anomalous/compatible_models', api_compatible_models)

