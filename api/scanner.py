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
from .utils import get_active_folder_types, get_active_scan_paths

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
    plugin_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    scraper_path = os.path.join(plugin_dir, "scraper.py")
    
    if not os.path.exists(scraper_path):
        return web.json_response({"status": "error", "message": "scraper.py not found in extension directory"})
        
    print(f"[Anomalous Browser] Starting background scan for: {target_dir}")
    
    try:
        data = await request.json()
    except Exception:
        data = {}
        
    offline_only = data.get("offline_only", False)
    skip_rename = data.get("skip_rename", False)
    virtual_rename = data.get("virtual_rename", False)
    physical_rename = data.get("physical_rename", False)
    force_overwrite = data.get("force_overwrite", False)
    
    target_files_list = data.get("target_files", [])
    if not target_files_list:
        target_files_str = request.query.get('target_files', '')
        target_files_list = [f.strip() for f in target_files_str.split(',')] if target_files_str else []
    
    try:
        if target_files_list:
            targets_file = os.path.join(target_dir, '.scan_targets.json')
            with open(targets_file, 'w', encoding='utf-8') as f:
                __import__('json').dump(target_files_list, f)
                
        marker_file = os.path.join(target_dir, '.scan_in_progress')
        with open(marker_file, 'w') as f: f.write('1')
        def run_bg():
            try:
                cmd = [sys.executable, scraper_path, target_dir]
                if offline_only:
                    cmd.append("--offline-only")
                if skip_rename:
                    cmd.append("--skip-rename")
                if virtual_rename:
                    cmd.append("--virtual-rename")
                if physical_rename:
                    cmd.append("--physical-rename")
                if force_overwrite:
                    cmd.append("--force-overwrite")
                
                subprocess.run(
                    cmd,
                    cwd=plugin_dir,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            finally:
                if hasattr(folder_paths, "filename_list_cache"):
                    try: folder_paths.filename_list_cache.clear()
                    except: pass
                if hasattr(folder_paths, "cache_helper") and hasattr(folder_paths.cache_helper, "clear"):
                    try: folder_paths.cache_helper.clear()
                    except: pass
                    
                if os.path.exists(marker_file):
                    try: os.remove(marker_file)
                    except: pass
        
        threading.Thread(target=run_bg, daemon=True).start()
        
        return web.json_response({"status": "ok", "message": "Scan started in background. Check console for details."})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})

async def api_scan_all(request):
    plugin_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    scraper_path = os.path.join(plugin_dir, "scraper.py")
    marker_file = os.path.join(plugin_dir, '.global_scan_in_progress')
    
    if os.path.exists(marker_file):
        return web.json_response({"status": "error", "message": "Global scan already in progress"})
        
    try:
        data = await request.json()
    except Exception:
        data = {}
        
    offline_only = data.get("offline_only", False)
    use_local_metadata = data.get("use_local_metadata", True)
    skip_rename = data.get("skip_rename", True)
    virtual_rename = data.get("virtual_rename", False)
    physical_rename = data.get("physical_rename", False)
    force_overwrite = data.get("force_overwrite", False)
    skip_media = data.get("skip_media", False)
    
    try:
        with open(marker_file, 'w') as f: f.write('1')
        
        def run_global_bg():
            try:
                paths_to_scan = get_active_scan_paths()
                for base_dir in paths_to_scan:
                    if not os.path.exists(base_dir): continue
                    try:
                        print(f"[Anomalous Browser] Global scan processing: {base_dir}")
                        cmd = [sys.executable, scraper_path, base_dir]
                        if offline_only:
                            cmd.append("--offline-only")
                        if skip_rename:
                            cmd.append("--skip-rename")
                        if virtual_rename:
                            cmd.append("--virtual-rename")
                        if physical_rename:
                            cmd.append("--physical-rename")
                        if force_overwrite:
                            cmd.append("--force-overwrite")
                        if skip_media:
                            cmd.append("--skip-media")
                        if not use_local_metadata:
                            cmd.append("--skip-local-metadata")
                        subprocess.run(
                            cmd,
                            cwd=plugin_dir,
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL
                        )
                    except Exception as e:
                        print(f"[Anomalous Browser] Global scan error on {base_dir}: {e}")
            finally:
                if hasattr(folder_paths, "filename_list_cache"):
                    try: folder_paths.filename_list_cache.clear()
                    except: pass
                if hasattr(folder_paths, "cache_helper") and hasattr(folder_paths.cache_helper, "clear"):
                    try: folder_paths.cache_helper.clear()
                    except: pass
                    
                if os.path.exists(marker_file):
                    try: os.remove(marker_file)
                    except: pass
                    
        threading.Thread(target=run_global_bg, daemon=True).start()
        return web.json_response({"status": "ok", "message": "Global scan started"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})

async def api_global_scan_status(request):
    plugin_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    marker_file = os.path.join(plugin_dir, '.global_scan_in_progress')
    return web.json_response({"scanning": os.path.exists(marker_file)})
async def api_clean_civitai_info(request):
    try:
        paths_to_clean = get_active_scan_paths()
        deleted_count = 0
        for base_dir in paths_to_clean:
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

GLOBAL_SCAN_STATE = {
    "scanning": False,
    "total": 0,
    "current": 0,
    "filename": "",
    "error": ""
}

async def api_scan_missing_models_status(request):
    return web.json_response(GLOBAL_SCAN_STATE)

async def api_scan_missing_models(request):
    if GLOBAL_SCAN_STATE["scanning"]:
        return web.json_response({"status": "error", "message": "Scan already in progress"})
        
    import sys
    import threading
    import traceback
    
    plugin_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if plugin_dir not in sys.path:
        sys.path.insert(0, plugin_dir)
        
    try:
        from scraper import extract_safetensors_hash, calculate_sha256, fetch_civitai_info, infer_base_model_from_header
    except ImportError:
        return web.json_response({"status": "error", "message": "Failed to load scraper module"})

    try:
        data = await request.json()
    except Exception:
        data = {}
        
    force_overwrite = data.get("force_overwrite", False)

    # Prevent race condition: set state immediately in main thread
    GLOBAL_SCAN_STATE["scanning"] = True
    GLOBAL_SCAN_STATE["total"] = 0
    GLOBAL_SCAN_STATE["current"] = 0
    GLOBAL_SCAN_STATE["filename"] = "Initializing..."
    GLOBAL_SCAN_STATE["error"] = ""

    def run_deep_scan():
        try:
            paths_to_scan = get_active_scan_paths()
            files_to_scan = []
            for base_dir in paths_to_scan:
                if not os.path.exists(base_dir): continue
            for root, dirs, files in os.walk(base_dir):
                for file in files:
                    if file.endswith('.safetensors'):
                        file_path = os.path.join(root, file)
                        base_path = os.path.splitext(file_path)[0]
                        info_path = base_path + ".info"
                        civitai_info_path = base_path + ".civitai.info"
                        
                        # Check if a valid info file exists
                        has_valid_info = False
                        actual_info = info_path if os.path.exists(info_path) else (civitai_info_path if os.path.exists(civitai_info_path) else None)
                        
                        if force_overwrite:
                            actual_info = None
                            
                        if actual_info:
                            try:
                                with open(actual_info, 'r', encoding='utf-8') as f:
                                    data = json.load(f)
                                    for fi in data.get("files", []):
                                        if isinstance(fi, dict) and "hashes" in fi and "SHA256" in fi["hashes"]:
                                            if fi["hashes"]["SHA256"]:
                                                has_valid_info = True
                                                break
                            except Exception:
                                pass
                                
                        if not has_valid_info:
                            files_to_scan.append(file_path)
            
            GLOBAL_SCAN_STATE["total"] = len(files_to_scan)
            
            for idx, file_path in enumerate(files_to_scan):
                filename = os.path.basename(file_path)
                GLOBAL_SCAN_STATE["current"] = idx + 1
                GLOBAL_SCAN_STATE["filename"] = filename
                
                try:
                    civitai_data = None
                    file_hash = None
                    
                    # Fallback 1: Try header hash on Civitai
                    header_hash = extract_safetensors_hash(file_path)
                    if header_hash:
                        civitai_data = fetch_civitai_info(header_hash)
                        if civitai_data:
                            file_hash = header_hash
                            
                    # Fallback 2: If header hash fails, compute full SHA256
                    if not civitai_data:
                        full_hash = calculate_sha256(file_path)
                        civitai_data = fetch_civitai_info(full_hash)
                        file_hash = full_hash
                        
                    # Fallback 3: Local Offline Inference
                    if not civitai_data:
                        inferred_base = infer_base_model_from_header(file_path)
                        if inferred_base == 'Unknown':
                            inferred_base = ""
                            
                        if not file_hash:
                            file_hash = header_hash or calculate_sha256(file_path)
                            
                        civitai_data = {
                            "id": -1,
                            "modelId": -1,
                            "name": os.path.splitext(filename)[0],
                            "baseModel": inferred_base,
                            "description": "<p>Automatically inferred by Anomalous Local Engine.</p>",
                            "model": {
                                "name": os.path.splitext(filename)[0],
                                "type": "LORA" if "lora" in file_path.lower() else "Checkpoint"
                            },
                            "files": [{"hashes": {"SHA256": file_hash}}]
                        }
                        
                    # Ensure SHA256 is explicitly injected into the info data
                    if civitai_data:
                        if not civitai_data.get("files"):
                            civitai_data["files"] = [{"hashes": {"SHA256": file_hash}}]
                        elif isinstance(civitai_data["files"][0], dict):
                            if "hashes" not in civitai_data["files"][0]:
                                civitai_data["files"][0]["hashes"] = {}
                            civitai_data["files"][0]["hashes"]["SHA256"] = file_hash
                            
                    # Save info file
                    info_path = os.path.splitext(file_path)[0] + ".info"
                    with open(info_path, 'w', encoding='utf-8') as f:
                        json.dump(civitai_data, f, ensure_ascii=True, indent=4)
                        
                except Exception as e:
                    pass
                    
        except Exception as e:
            GLOBAL_SCAN_STATE["error"] = str(e)
            traceback.print_exc()
        finally:
            GLOBAL_SCAN_STATE["scanning"] = False
            GLOBAL_SCAN_STATE["filename"] = ""
            
            # Clear caches
            if hasattr(folder_paths, "filename_list_cache"):
                folder_paths.filename_list_cache.clear()
            if hasattr(folder_paths, "cache_helper") and hasattr(folder_paths.cache_helper, "clear"):
                folder_paths.cache_helper.clear()
                
    threading.Thread(target=run_deep_scan, daemon=True).start()
    return web.json_response({"status": "success", "message": "Deep scan started in background"})
