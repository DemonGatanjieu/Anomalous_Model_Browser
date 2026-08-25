import os
import sys
import json
import urllib.parse
import subprocess
import threading
import asyncio
import ctypes
from ctypes import wintypes
import time
import uuid
from aiohttp import web
import folder_paths
import struct
from .utils import get_active_folder_types, get_active_scan_paths, resolve_folder_subdir
try:
    from ..model_policies import is_physical_rename_protected
except ImportError:
    from model_policies import is_physical_rename_protected


SCAN_SESSION_ID = uuid.uuid4().hex
SCAN_MARKER_LOCK = threading.Lock()
ACTIVE_SCAN_MARKERS = set()
SCAN_RUNTIME_STATE = {}


def _read_json_file(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            value = json.load(f)
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, TypeError):
        return None


def _remove_file(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        return True
    except OSError:
        return False
    return True


def _pid_is_running(pid):
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    if pid == os.getpid():
        return True
    if os.name == 'nt':
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        open_process = kernel32.OpenProcess
        open_process.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        open_process.restype = wintypes.HANDLE
        get_exit_code = kernel32.GetExitCodeProcess
        get_exit_code.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
        get_exit_code.restype = wintypes.BOOL
        close_handle = kernel32.CloseHandle
        close_handle.argtypes = (wintypes.HANDLE,)
        close_handle.restype = wintypes.BOOL
        process = open_process(0x1000, False, pid)
        if not process:
            return False
        try:
            exit_code = wintypes.DWORD()
            return bool(get_exit_code(process, ctypes.byref(exit_code))) and exit_code.value == 259
        finally:
            close_handle(process)
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def _write_marker(marker_file, marker):
    temp_file = f"{marker_file}.{os.getpid()}.{threading.get_ident()}.tmp"
    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump(marker, f)
    os.replace(temp_file, marker_file)


def _marker_owner_is_running(marker):
    if not marker:
        return False
    if marker.get("session_id") == SCAN_SESSION_ID:
        return marker.get("marker_file") in ACTIVE_SCAN_MARKERS
    worker_pid = marker.get("worker_pid")
    if worker_pid:
        return _pid_is_running(worker_pid)
    return _pid_is_running(marker.get("owner_pid"))


def _cleanup_scan_artifacts(marker_file, artifact_files=()):
    _remove_file(marker_file)
    for path in artifact_files:
        _remove_file(path)


def _claim_scan_marker(marker_file, kind, artifact_files=()):
    recovered = False
    with SCAN_MARKER_LOCK:
        if marker_file in ACTIVE_SCAN_MARKERS:
            return False, False
        if os.path.exists(marker_file):
            marker = _read_json_file(marker_file)
            if _marker_owner_is_running(marker):
                return False, False
            _cleanup_scan_artifacts(marker_file, artifact_files)
            recovered = True

        marker = {
            "version": 2,
            "job_id": uuid.uuid4().hex,
            "kind": kind,
            "session_id": SCAN_SESSION_ID,
            "owner_pid": os.getpid(),
            "worker_pid": 0,
            "started_at": time.time(),
            "marker_file": marker_file,
        }
        try:
            with open(marker_file, 'x', encoding='utf-8') as f:
                json.dump(marker, f)
        except FileExistsError:
            return False, recovered
        ACTIVE_SCAN_MARKERS.add(marker_file)
        SCAN_RUNTIME_STATE[marker_file] = {
            "phase": "preparing",
            "error": "",
            "recovered": recovered,
        }
    return True, recovered


def _update_scan_marker(marker_file, **values):
    with SCAN_MARKER_LOCK:
        if marker_file not in ACTIVE_SCAN_MARKERS:
            return
        marker = _read_json_file(marker_file) or {}
        marker.update(values)
        marker["marker_file"] = marker_file
        _write_marker(marker_file, marker)


def _update_scan_state(marker_file, **values):
    with SCAN_MARKER_LOCK:
        if marker_file in ACTIVE_SCAN_MARKERS:
            SCAN_RUNTIME_STATE.setdefault(marker_file, {}).update(values)


def _release_scan_marker(marker_file, artifact_files=()):
    with SCAN_MARKER_LOCK:
        ACTIVE_SCAN_MARKERS.discard(marker_file)
        SCAN_RUNTIME_STATE.pop(marker_file, None)
        _cleanup_scan_artifacts(marker_file, artifact_files)


def _scan_marker_status(marker_file, artifact_files=()):
    with SCAN_MARKER_LOCK:
        if marker_file in ACTIVE_SCAN_MARKERS:
            return True, False, _read_json_file(marker_file) or {}
        if not os.path.exists(marker_file):
            return False, False, {}
        marker = _read_json_file(marker_file)
        if _marker_owner_is_running(marker):
            return True, False, marker or {}
        _cleanup_scan_artifacts(marker_file, artifact_files)
        return False, True, marker or {}


def _scan_status_payload(marker_file, progress_file, artifact_files=()):
    scanning, interrupted, marker = _scan_marker_status(marker_file, artifact_files)
    data = {
        "scanning": scanning,
        "interrupted": interrupted,
        "job_id": marker.get("job_id", ""),
        "phase": "idle",
        "total": 0,
        "current": 0,
        "filename": "",
    }
    if scanning:
        with SCAN_MARKER_LOCK:
            data.update(SCAN_RUNTIME_STATE.get(marker_file, {}))
        progress = _read_json_file(progress_file)
        if progress:
            data.update(progress)
    return data


def _protected_type_for_path(folder_path):
    """Resolve protected registered aliases for a global physical-folder scan."""
    target = os.path.realpath(folder_path)
    for folder_type in folder_paths.folder_names_and_paths.keys():
        if not is_physical_rename_protected(folder_type=folder_type):
            continue
        try:
            if any(os.path.realpath(path) == target for path in folder_paths.get_folder_paths(folder_type)):
                return folder_type
        except Exception:
            continue
    return ""

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
    if not paths or path_idx < 0 or path_idx >= len(paths):
        return web.json_response({"scanning": False})
    try:
        base_dir, target_dir = resolve_folder_subdir(folder_type, path_idx, subfolder)
    except ValueError:
        return web.json_response({"scanning": False})
    
    marker_file = os.path.join(target_dir, '.scan_in_progress')
    progress_file = os.path.join(target_dir, '.scan_progress.json')
    targets_file = os.path.join(target_dir, '.scan_targets.json')
    result_file = os.path.join(target_dir, '.scan_result.json')
    data = _scan_status_payload(marker_file, progress_file, (progress_file, targets_file))

    if not data["scanning"] and os.path.exists(result_file):
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
        
    try:
        base_dir, target_dir = resolve_folder_subdir(folder_type, path_idx, subfolder)
    except (ValueError, KeyError):
        return web.json_response({"status": "error", "message": "Invalid folder type"})
        
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
    physical_rename_requested = data.get("physical_rename", False)
    physical_rename = physical_rename_requested and not is_physical_rename_protected(
        folder_type=folder_type,
        folder_path=target_dir,
    )
    force_overwrite = data.get("force_overwrite", False)
    
    target_files_list = data.get("target_files", [])
    if not target_files_list:
        target_files_str = request.query.get('target_files', '')
        target_files_list = [f.strip() for f in target_files_str.split(',')] if target_files_str else []
    
    claimed = False
    try:
        marker_file = os.path.join(target_dir, '.scan_in_progress')
        progress_file = os.path.join(target_dir, '.scan_progress.json')
        targets_file = os.path.join(target_dir, '.scan_targets.json')
        claimed, recovered = _claim_scan_marker(
            marker_file,
            "folder",
            (progress_file, targets_file),
        )
        if not claimed:
            return web.json_response({"status": "error", "message": "Scan already in progress"}, status=409)

        if target_files_list:
            with open(targets_file, 'w', encoding='utf-8') as f:
                __import__('json').dump(target_files_list, f)

        def run_bg():
            try:
                cmd = [sys.executable, scraper_path, target_dir, "--folder-type", folder_type]
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
                
                cmd.extend(["--progress-file", progress_file])
                process = subprocess.Popen(cmd, cwd=plugin_dir)
                _update_scan_marker(marker_file, worker_pid=process.pid)
                return_code = process.wait()
                if return_code != 0:
                    result_file = os.path.join(target_dir, '.scan_result.json')
                    with open(result_file, 'w', encoding='utf-8') as f:
                        json.dump({"success": 0, "fail": 1, "error": f"Scanner exited with code {return_code}"}, f)
            finally:
                if hasattr(folder_paths, "filename_list_cache"):
                    try: folder_paths.filename_list_cache.clear()
                    except: pass
                if hasattr(folder_paths, "cache_helper") and hasattr(folder_paths.cache_helper, "clear"):
                    try: folder_paths.cache_helper.clear()
                    except: pass
                    
                _release_scan_marker(marker_file, (progress_file, targets_file))
        
        threading.Thread(target=run_bg, daemon=True).start()
        
        return web.json_response({
            "status": "ok",
            "message": "Scan started in background. Check console for details.",
            "recovered": recovered,
        })
    except Exception as e:
        if claimed:
            _release_scan_marker(marker_file, (progress_file, targets_file))
        return web.json_response({"status": "error", "message": str(e)})

async def api_scan_all(request):
    plugin_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    scraper_path = os.path.join(plugin_dir, "scraper.py")
    marker_file = os.path.join(plugin_dir, '.global_scan_in_progress')
    progress_file = os.path.join(plugin_dir, '.global_scan_progress.json')
        
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
    
    claimed = False
    try:
        claimed, recovered = _claim_scan_marker(marker_file, "global", (progress_file,))
        if not claimed:
            return web.json_response({"status": "error", "message": "Global scan already in progress"}, status=409)

        def run_global_bg():
            try:
                paths_to_scan = get_active_scan_paths()
                paths_to_scan = [path for path in paths_to_scan if os.path.exists(path)]
                _update_scan_state(
                    marker_file,
                    phase="preparing",
                    folder_total=len(paths_to_scan),
                    folder_current=0,
                    folder="",
                )
                for folder_index, base_dir in enumerate(paths_to_scan, 1):
                    if not os.path.exists(base_dir): continue
                    try:
                        print(f"[Anomalous Browser] Global scan processing: {base_dir}")
                        _remove_file(progress_file)
                        _update_scan_state(
                            marker_file,
                            phase="enumerating",
                            folder_total=len(paths_to_scan),
                            folder_current=folder_index,
                            folder=os.path.basename(os.path.normpath(base_dir)) or base_dir,
                            error="",
                        )
                        cmd = [sys.executable, scraper_path, base_dir]
                        protected_type = _protected_type_for_path(base_dir)
                        if protected_type:
                            cmd.extend(["--folder-type", protected_type])
                        if offline_only:
                            cmd.append("--offline-only")
                        if skip_rename:
                            cmd.append("--skip-rename")
                        if virtual_rename:
                            cmd.append("--virtual-rename")
                        if physical_rename and not is_physical_rename_protected(
                            folder_type=protected_type,
                            folder_path=base_dir,
                        ):
                            cmd.append("--physical-rename")
                        if force_overwrite:
                            cmd.append("--force-overwrite")
                        if skip_media:
                            cmd.append("--skip-media")
                        if not use_local_metadata:
                            cmd.append("--skip-local-metadata")
                        cmd.extend(["--progress-file", progress_file])
                        process = subprocess.Popen(cmd, cwd=plugin_dir)
                        _update_scan_marker(marker_file, worker_pid=process.pid)
                        return_code = process.wait()
                        _update_scan_marker(marker_file, worker_pid=0)
                        if return_code != 0:
                            message = f"Scanner exited with code {return_code}: {base_dir}"
                            _update_scan_state(marker_file, error=message)
                            print(f"[Anomalous Browser] {message}")
                    except Exception as e:
                        _update_scan_state(marker_file, error=str(e))
                        print(f"[Anomalous Browser] Global scan error on {base_dir}: {e}")
            finally:
                if hasattr(folder_paths, "filename_list_cache"):
                    try: folder_paths.filename_list_cache.clear()
                    except: pass
                if hasattr(folder_paths, "cache_helper") and hasattr(folder_paths.cache_helper, "clear"):
                    try: folder_paths.cache_helper.clear()
                    except: pass
                    
                _release_scan_marker(marker_file, (progress_file,))
                    
        threading.Thread(target=run_global_bg, daemon=True).start()
        return web.json_response({"status": "ok", "message": "Global scan started", "recovered": recovered})
    except Exception as e:
        if claimed:
            _release_scan_marker(marker_file, (progress_file,))
        return web.json_response({"status": "error", "message": str(e)})

async def api_global_scan_status(request):
    plugin_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    marker_file = os.path.join(plugin_dir, '.global_scan_in_progress')
    progress_file = os.path.join(plugin_dir, '.global_scan_progress.json')
    return web.json_response(_scan_status_payload(marker_file, progress_file, (progress_file,)))
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
GLOBAL_SCAN_LOCK = threading.Lock()

async def api_scan_missing_models_status(request):
    return web.json_response(GLOBAL_SCAN_STATE)

async def api_scan_missing_models(request):
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

    with GLOBAL_SCAN_LOCK:
        if GLOBAL_SCAN_STATE["scanning"]:
            return web.json_response({"status": "error", "message": "Scan already in progress"}, status=409)
        GLOBAL_SCAN_STATE["scanning"] = True
        GLOBAL_SCAN_STATE["total"] = 0
        GLOBAL_SCAN_STATE["current"] = 0
        GLOBAL_SCAN_STATE["filename"] = "Initializing..."
        GLOBAL_SCAN_STATE["error"] = ""

    try:
        data = await request.json()
    except Exception:
        data = {}
        
    force_overwrite = data.get("force_overwrite", False)

    def run_deep_scan():
        try:
            paths_to_scan = get_active_scan_paths()
            files_to_scan = []
            for base_dir in paths_to_scan:
                if not os.path.exists(base_dir): continue
                for root, dirs, files in os.walk(base_dir):
                    for file in files:
                        if not file.endswith('.safetensors'):
                            continue
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
                    GLOBAL_SCAN_STATE["error"] = f"{filename}: {e}"
                    
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
                
    try:
        threading.Thread(target=run_deep_scan, daemon=True).start()
    except Exception as e:
        GLOBAL_SCAN_STATE["scanning"] = False
        GLOBAL_SCAN_STATE["error"] = str(e)
        return web.json_response({"status": "error", "message": str(e)}, status=500)
    return web.json_response({"status": "success", "message": "Deep scan started in background"})
