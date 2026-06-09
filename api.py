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
        "civitai_url": "",
        "hash": ""
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
                    
                    
                    hash_val = ""
                    for file_info in data.get("files", []):
                        if isinstance(file_info, dict):
                            hashes = file_info.get("hashes", {})
                            if isinstance(hashes, dict) and "SHA256" in hashes:
                                hash_val = hashes["SHA256"]
                                break
                    
                    metadata["name"] = name if name else metadata["name"]
                    metadata["description"] = description
                    metadata["notes"] = notes
                    metadata["trainedWords"] = trained_words
                    metadata["baseModel"] = base_model
                    metadata["civitai_url"] = civitai_url
                    metadata["hash"] = hash_val
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
                size_bytes = os.path.getsize(file_path)
                size_mb = round(size_bytes / (1024 * 1024), 1)
            except Exception:
                size_mb = 0
                size_bytes = 0
                
            models.append({
                "filename": f,
                "size_mb": size_mb,
                "size_bytes": size_bytes,
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
                if hasattr(folder_paths, "filename_list_cache"):
                    folder_paths.filename_list_cache.clear()
                if hasattr(folder_paths, "cache_helper") and hasattr(folder_paths.cache_helper, "clear"):
                    folder_paths.cache_helper.clear()
                    
                if os.path.exists(marker_file):
                    try: os.remove(marker_file)
                    except: pass
        
        threading.Thread(target=run_bg, daemon=True).start()
        
        return web.json_response({"status": "ok", "message": "Scan started in background. Check console for details."})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})

async def api_scan_all(request):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    scraper_path = os.path.join(script_dir, "scraper.py")
    marker_file = os.path.join(script_dir, '.global_scan_in_progress')
    
    if os.path.exists(marker_file):
        return web.json_response({"status": "error", "message": "Global scan already in progress"})
        
    try:
        with open(marker_file, 'w') as f: f.write('1')
        
        def run_global_bg():
            try:
                types = ['checkpoints', 'loras', 'unet', 'diffusion_models']
                for t in types:
                    try:
                        paths = folder_paths.get_folder_paths(t)
                        if not paths: continue
                        for base_dir in paths:
                            if not os.path.exists(base_dir): continue
                            print(f"[Anomalous Browser] Global scan processing: {base_dir}")
                            subprocess.run(
                                [sys.executable, scraper_path, base_dir, "--skip-rename", "--skip-media"],
                                cwd=script_dir,
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL
                            )
                    except Exception as e:
                        print(f"[Anomalous Browser] Global scan error on {t}: {e}")
            finally:
                if hasattr(folder_paths, "filename_list_cache"):
                    folder_paths.filename_list_cache.clear()
                if hasattr(folder_paths, "cache_helper") and hasattr(folder_paths.cache_helper, "clear"):
                    folder_paths.cache_helper.clear()
                    
                if os.path.exists(marker_file):
                    try: os.remove(marker_file)
                    except: pass
                    
        threading.Thread(target=run_global_bg, daemon=True).start()
        return web.json_response({"status": "ok", "message": "Global scan started"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})

async def api_global_scan_status(request):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    marker_file = os.path.join(script_dir, '.global_scan_in_progress')
    return web.json_response({"scanning": os.path.exists(marker_file)})
async def api_clear_cache(request):
    try:
        if hasattr(folder_paths, "filename_list_cache"):
            folder_paths.filename_list_cache.clear()
        if hasattr(folder_paths, "cache_helper") and hasattr(folder_paths.cache_helper, "clear"):
            folder_paths.cache_helper.clear()
        return web.json_response({"status": "success"})
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
                        m_bm = str(meta.get("baseModel", "")).strip().lower().replace(" ", "")
                        req_bm = str(base_model).strip().lower().replace(" ", "")
                        
                        if req_bm and m_bm and (req_bm in m_bm or m_bm in req_bm):
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
                            if preview_file:
                                q_type = urllib.parse.quote(t)
                                q_idx = str(path_idx)
                                q_sub = urllib.parse.quote(rel_subfolder.strip('/')) if rel_subfolder != '/' else ""
                                q_file = urllib.parse.quote(preview_file)
                                preview_url = f"/anomalous/image?type={q_type}&path_idx={q_idx}&subfolder={q_sub}&filename={q_file}"
                            
                            try:
                                size_bytes = os.path.getsize(file_path)
                                size_mb = round(size_bytes / (1024 * 1024), 1)
                            except Exception:
                                size_mb = 0
                                size_bytes = 0

                            compatible_models.append({
                                "type": t,
                                "path_idx": path_idx,
                                "subfolder": rel_subfolder,
                                "filename": f,
                                "size_mb": size_mb,
                                "size_bytes": size_bytes,
                                "preview_url": preview_url,
                                "metadata": meta
                            })
                        
    return web.json_response({"models": compatible_models})

async def api_get_notebooks(request):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    nb_dir = os.path.join(script_dir, "notebooks")
    if not os.path.exists(nb_dir):
        os.makedirs(nb_dir)
    
    notebooks = []
    for f in os.listdir(nb_dir):
        if f.endswith('.json'):
            try:
                with open(os.path.join(nb_dir, f), 'r', encoding='utf-8') as file:
                    data = json.load(file)
                    notebooks.append({
                        "filename": f,
                        "name": data.get("name", f.replace('.json', '')),
                        "data": data
                    })
            except Exception:
                pass
    return web.json_response({"notebooks": notebooks})

async def api_save_notebook(request):
    try:
        data = await request.json()
        filename = data.get("filename", "")
        if not filename or '..' in filename:
            return web.json_response({"status": "error", "message": "Invalid filename"})
        if not filename.endswith('.json'):
            filename += '.json'
            
        script_dir = os.path.dirname(os.path.abspath(__file__))
        nb_dir = os.path.join(script_dir, "notebooks")
        if not os.path.exists(nb_dir):
            os.makedirs(nb_dir)
            
        file_path = os.path.join(nb_dir, filename)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data.get("data", {}), f, indent=4, ensure_ascii=False)
            
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})

async def api_delete_notebook(request):
    try:
        data = await request.json()
        filename = data.get("filename", "")
        if not filename or '..' in filename:
            return web.json_response({"status": "error", "message": "Invalid filename"})
            
        script_dir = os.path.dirname(os.path.abspath(__file__))
        nb_dir = os.path.join(script_dir, "notebooks")
        file_path = os.path.join(nb_dir, filename)
        
        if os.path.exists(file_path):
            os.remove(file_path)
            return web.json_response({"status": "success"})
        return web.json_response({"status": "error", "message": "File not found"})
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


async def api_base_models(request):
    target_types = ['checkpoints', 'unet', 'diffusion_models', 'loras']
    base_models = set()
    seen_files = set()
    
    for t in target_types:
        try:
            paths = folder_paths.get_folder_paths(t)
        except Exception:
            continue
        if not paths: continue
            
        for base_dir in paths:
            if not os.path.exists(base_dir): continue
            for root, _, files in os.walk(base_dir):
                for f in files:
                    if f.endswith('.safetensors') or f.endswith('.ckpt') or f.endswith('.pt'):
                        file_path = os.path.join(root, f)
                        real_path = os.path.realpath(file_path)
                        if real_path in seen_files: continue
                        seen_files.add(real_path)
                        
                        meta = get_metadata(file_path)
                        m_bm = meta.get("baseModel", "")
                        if m_bm and str(m_bm).strip():
                            # Remove typical generic strings that might pollute
                            clean_bm = str(m_bm).strip()
                            base_models.add(clean_bm)
                            
    return web.json_response({"base_models": sorted(list(base_models))})

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

async def api_resolve_hash(request):
    target_hash = request.query.get("hash", "").strip().upper()
    size_str = request.query.get("size", "").strip()
    filename_query = request.query.get("filename", "").strip()
    target_size = int(size_str) if size_str.isdigit() else None
    
    if not target_hash and not target_size and not filename_query:
        return web.json_response({"found": False})

    types = ['checkpoints', 'loras', 'unet', 'diffusion_models']
    
    # First pass: try exact hash match in .info files
    if target_hash:
        for t in types:
            try:
                paths = folder_paths.get_folder_paths(t)
            except Exception:
                continue
            if not paths:
                continue
                
            for base_dir in paths:
                if not os.path.exists(base_dir):
                    continue
                    
                for root, dirs, files in os.walk(base_dir):
                    for file in files:
                        if file.endswith('.safetensors') or file.endswith('.ckpt') or file.endswith('.pt'):
                            file_path = os.path.join(root, file)
                            meta = get_metadata(file_path)
                            if meta.get("hash", "").upper() == target_hash:
                                # ComfyUI widget expects relative path from folder_paths base_dir
                                rel_path = os.path.relpath(file_path, base_dir)
                                if rel_path.startswith('.\\') or rel_path.startswith('./'):
                                    rel_path = rel_path[2:]
                                rel_path = rel_path.replace('\\', '/')
                                return web.json_response({
                                    "found": True,
                                    "type": t,
                                    "filename": rel_path
                                })
                                
    # Second pass: Fallback size match
    if target_size is not None:
        size_matches = []
        seen_realpaths = set()
        for t in types:
            try:
                paths = folder_paths.get_folder_paths(t)
            except Exception:
                continue
            if not paths:
                continue
                
            for base_dir in paths:
                if not os.path.exists(base_dir):
                    continue
                    
                for root, dirs, files in os.walk(base_dir):
                    for file in files:
                        if file.endswith('.safetensors') or file.endswith('.ckpt') or file.endswith('.pt'):
                            file_path = os.path.join(root, file)
                            try:
                                if os.path.getsize(file_path) == target_size:
                                    real_p = os.path.realpath(file_path)
                                    if real_p in seen_realpaths:
                                        continue
                                    seen_realpaths.add(real_p)
                                    
                                    rel_path = os.path.relpath(file_path, base_dir)
                                    if rel_path.startswith('.\\') or rel_path.startswith('./'):
                                        rel_path = rel_path[2:]
                                    rel_path = rel_path.replace('\\', '/')
                                    size_matches.append({
                                        "type": t,
                                        "filename": rel_path
                                    })
                            except Exception:
                                pass
                                
        # If exactly ONE file matches the size, it's a definitive match
        if len(size_matches) == 1:
            return web.json_response({
                "found": True,
                "type": size_matches[0]["type"],
                "filename": size_matches[0]["filename"],
                "matched_by_size": True
            })

    return web.json_response({"found": False})

async def api_get_all_hashes(request):
    """
    Returns a dictionary of all scanned models with their hash and size.
    Keyed by both relative path and basename for maximum frontend resilience.
    """
    import asyncio
    
    def fetch_all():
        hashes = {}
        types = ['checkpoints', 'loras', 'unet', 'diffusion_models']
        for t in types:
            try:
                paths = folder_paths.get_folder_paths(t)
                if not paths: continue
                for base_dir in paths:
                    if not os.path.exists(base_dir): continue
                    for root, dirs, files in os.walk(base_dir):
                        for file in files:
                            if file.endswith('.safetensors') or file.endswith('.ckpt') or file.endswith('.pt'):
                                file_path = os.path.join(root, file)
                                try:
                                    size_bytes = os.path.getsize(file_path)
                                except Exception:
                                    size_bytes = 0
                                    
                                meta = get_metadata(file_path)
                                hash_val = ""
                                if meta and meta.get("hash"):
                                    hash_val = meta["hash"]
                                
                                rel_path = os.path.relpath(file_path, base_dir)
                                if rel_path.startswith('.\\') or rel_path.startswith('./'):
                                    rel_path = rel_path[2:]
                                rel_path = rel_path.replace('\\', '/')
                                basename = os.path.basename(file_path)
                                
                                val = {"hash": hash_val, "size": size_bytes}
                                hashes[rel_path] = val
                                hashes[basename] = val
            except Exception:
                pass
        return hashes
        
    hashes = await asyncio.to_thread(fetch_all)
    return web.json_response(hashes)

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
    app.router.add_get('/anomalous/notebooks', api_get_notebooks)
    app.router.add_post('/anomalous/save_notebook', api_save_notebook)
    app.router.add_post('/anomalous/delete_notebook', api_delete_notebook)
    app.router.add_post('/anomalous/translate', api_translate)
    app.router.add_get('/anomalous/base_models', api_base_models)
    app.router.add_get('/anomalous/gallery_images', api_get_gallery_images)
    app.router.add_post('/anomalous/delete_gallery_image', api_delete_gallery_image)
    app.router.add_get('/anomalous/resolve_hash', api_resolve_hash)
    app.router.add_get('/anomalous/all_hashes', api_get_all_hashes)
    app.router.add_post('/anomalous/scan_all', api_scan_all)
    app.router.add_get('/anomalous/global_scan_status', api_global_scan_status)
