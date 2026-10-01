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
from .folder_types import get_active_scan_paths
from .path_utils import resolve_folder_subdir
from .scan_report import ScanJob, locate_root
try:
    from ..model_policies import is_physical_rename_protected
except ImportError:
    from model_policies import is_physical_rename_protected


PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRAPER_PATH = os.path.join(PLUGIN_DIR, "scraper.py")
SCAN_SESSION_ID = uuid.uuid4().hex
SCAN_MARKER_LOCK = threading.Lock()
ACTIVE_SCAN_MARKERS = set()
SCAN_RUNTIME_STATE = {}


# Request field -> scraper switch, with the field's default. Both scan routes read these.
_SCRAPER_FLAGS = (
    ("offline_only", "--offline-only", False),
    ("virtual_rename", "--virtual-rename", False),
    ("force_overwrite", "--force-overwrite", False),
    ("retry_unmatched", "--retry-unmatched", False),
    ("skip_media", "--skip-media", False),
)


def _scraper_flags(data, skip_rename_default, physical_allowed):
    """The scraper's command-line switches for one scan request."""
    flags = [flag for field, flag, default in _SCRAPER_FLAGS if data.get(field, default)]
    if data.get("skip_rename", skip_rename_default):
        flags.append("--skip-rename")
    if data.get("physical_rename", False) and physical_allowed:
        flags.append("--physical-rename")
    if not data.get("use_local_metadata", True):
        flags.append("--skip-local-metadata")
    return flags


def _clear_folder_caches():
    """ComfyUI lists model folders from caches; a scan may have renamed files."""
    for cache in (getattr(folder_paths, "filename_list_cache", None), getattr(folder_paths, "cache_helper", None)):
        try:
            cache.clear()
        except Exception:
            pass


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
    """Launches the scraper in the background for one folder (a model card's scan)."""
    folder_type = request.query.get('type', 'checkpoints')
    subfolder = request.query.get('subfolder', '/')
    try:
        path_idx = int(request.query.get('path_idx', 0))
    except (TypeError, ValueError):
        path_idx = 0

    try:
        base_dir, target_dir = resolve_folder_subdir(folder_type, path_idx, subfolder)
    except (ValueError, KeyError):
        return web.json_response({"status": "error", "message": "Invalid folder type"})
    if not os.path.exists(target_dir):
        return web.json_response({"status": "error", "message": "Directory does not exist"})
    if not os.path.exists(SCRAPER_PATH):
        return web.json_response({"status": "error", "message": "scraper.py not found in extension directory"})

    print(f"[Anomalous Browser] Starting background scan for: {target_dir}")
    try:
        data = await request.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        return web.json_response({"status": "error", "message": "Invalid request body"}, status=400)

    flags = _scraper_flags(data, False, not is_physical_rename_protected(
        folder_type=folder_type,
        folder_path=target_dir,
    ))
    target_files_list = data.get("target_files", [])
    if not target_files_list:
        target_files_str = request.query.get('target_files', '')
        target_files_list = [f.strip() for f in target_files_str.split(',')] if target_files_str else []

    claimed = False
    try:
        marker_file = os.path.join(target_dir, '.scan_in_progress')
        progress_file = os.path.join(target_dir, '.scan_progress.json')
        targets_file = os.path.join(target_dir, '.scan_targets.json')
        report_file = os.path.join(target_dir, '.scan_report.jsonl')
        artifacts = (progress_file, targets_file, report_file)
        claimed, recovered = _claim_scan_marker(marker_file, "folder", artifacts)
        if not claimed:
            return web.json_response({"status": "error", "message": "Scan already in progress"}, status=409)

        if target_files_list:
            with open(targets_file, 'w', encoding='utf-8') as f:
                json.dump(target_files_list, f)
        job = ScanJob("one" if len(target_files_list) == 1 else "picked", data)

        def run_bg():
            try:
                cmd = [sys.executable, SCRAPER_PATH, target_dir, "--folder-type", folder_type, *flags]
                cmd.extend(["--progress-file", progress_file, "--report-file", report_file])
                process = subprocess.Popen(cmd, cwd=PLUGIN_DIR)
                _update_scan_marker(marker_file, worker_pid=process.pid)
                return_code = process.wait()
                job.add_folder(report_file, base_dir, (folder_type, path_idx))
                if return_code != 0:
                    job.add_error(f"Scanner exited with code {return_code}")
                    result_file = os.path.join(target_dir, '.scan_result.json')
                    with open(result_file, 'w', encoding='utf-8') as f:
                        json.dump({"success": 0, "fail": 1, "error": f"Scanner exited with code {return_code}"}, f)
            finally:
                _clear_folder_caches()
                job.finish()  # before the marker goes: whoever sees the scan end finds its result
                _release_scan_marker(marker_file, artifacts)

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


def _global_scan_plan(data):
    """The folders a scan-page scan runs through: [(scan dir, (type, path_idx) or None, base dir,
    file names or None, folder type for the rename policy)]. `data["targets"]`, when given, is
    the picked models: [{type, path_idx, subfolder, files}]; otherwise every active folder."""
    targets = data.get("targets")
    if not targets:
        plan = []
        for base_dir in get_active_scan_paths():
            if os.path.exists(base_dir):
                plan.append((base_dir, locate_root(base_dir), base_dir, None, _protected_type_for_path(base_dir)))
        return plan
    if not isinstance(targets, list):
        raise ValueError("targets must be a list")
    plan = []
    for target in targets:
        files = target.get("files") if isinstance(target, dict) else None
        if not isinstance(files, list) or not all(isinstance(name, str) for name in files):
            raise ValueError("each target needs a list of file names")
        path_idx = int(target.get("path_idx", 0))
        base_dir, target_dir = resolve_folder_subdir(target.get("type"), path_idx, target.get("subfolder") or "/")
        if files and os.path.isdir(target_dir):
            plan.append((target_dir, (target["type"], path_idx), base_dir, files, target["type"]))
    return plan


async def api_scan_all(request):
    """Scans every active models folder, or the picked models (`targets`), one folder after another."""
    marker_file = os.path.join(PLUGIN_DIR, '.global_scan_in_progress')
    progress_file = os.path.join(PLUGIN_DIR, '.global_scan_progress.json')
    targets_file = os.path.join(PLUGIN_DIR, '.global_scan_targets.json')
    report_file = os.path.join(PLUGIN_DIR, '.global_scan_report.jsonl')
    artifacts = (progress_file, targets_file, report_file)

    try:
        data = await request.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        return web.json_response({"status": "error", "message": "Invalid request body"}, status=400)
    try:
        plan = _global_scan_plan(data) if data.get("targets") else None
    except (ValueError, KeyError, TypeError) as e:
        return web.json_response({"status": "error", "message": f"Invalid targets: {e}"}, status=400)
    picked = sum(len(files) for _dir, _loc, _base, files, _type in plan or ())
    job = ScanJob("all" if plan is None else "one" if picked == 1 else "picked", data)

    claimed = False
    try:
        claimed, recovered = _claim_scan_marker(marker_file, "global", artifacts)
        if not claimed:
            return web.json_response({"status": "error", "message": "Global scan already in progress"}, status=409)

        def run_global_bg():
            try:
                folders = plan if plan is not None else _global_scan_plan(data)
                _update_scan_state(marker_file, phase="preparing", folder_total=len(folders), folder_current=0, folder="")
                for folder_index, (scan_dir, located, base_dir, files, policy_type) in enumerate(folders, 1):
                    try:
                        print(f"[Anomalous Browser] Global scan processing: {scan_dir}")
                        _remove_file(progress_file)
                        _update_scan_state(
                            marker_file,
                            phase="enumerating",
                            folder_total=len(folders),
                            folder_current=folder_index,
                            folder=os.path.basename(os.path.normpath(scan_dir)) or scan_dir,
                            error="",
                        )
                        cmd = [sys.executable, SCRAPER_PATH, scan_dir]
                        if policy_type:
                            cmd.extend(["--folder-type", policy_type])
                        cmd.extend(_scraper_flags(data, True, not is_physical_rename_protected(
                            folder_type=policy_type,
                            folder_path=scan_dir,
                        )))
                        if files is not None:
                            with open(targets_file, 'w', encoding='utf-8') as f:
                                json.dump(files, f)
                            cmd.extend(["--targets-file", targets_file])
                        if job.civitai_down:  # an earlier folder found Civitai unreachable
                            cmd.append("--civitai-down")
                        cmd.extend(["--progress-file", progress_file, "--report-file", report_file])
                        process = subprocess.Popen(cmd, cwd=PLUGIN_DIR)
                        _update_scan_marker(marker_file, worker_pid=process.pid)
                        return_code = process.wait()
                        _update_scan_marker(marker_file, worker_pid=0)
                        job.add_folder(report_file, base_dir, located)
                        if return_code != 0:
                            message = f"Scanner exited with code {return_code}: {scan_dir}"
                            _update_scan_state(marker_file, error=message)
                            job.add_error(message)
                            print(f"[Anomalous Browser] {message}")
                    except Exception as e:
                        _update_scan_state(marker_file, error=str(e))
                        job.add_error(f"{scan_dir}: {e}")
                        print(f"[Anomalous Browser] Global scan error on {scan_dir}: {e}")
            finally:
                _clear_folder_caches()
                job.finish()  # before the marker goes: whoever sees the scan end finds its result
                _release_scan_marker(marker_file, artifacts)

        threading.Thread(target=run_global_bg, daemon=True).start()
        return web.json_response({"status": "ok", "message": "Global scan started", "recovered": recovered})
    except Exception as e:
        if claimed:
            _release_scan_marker(marker_file, artifacts)
        return web.json_response({"status": "error", "message": str(e)})


async def api_global_scan_status(request):
    marker_file = os.path.join(PLUGIN_DIR, '.global_scan_in_progress')
    progress_file = os.path.join(PLUGIN_DIR, '.global_scan_progress.json')
    return web.json_response(_scan_status_payload(marker_file, progress_file, (progress_file,)))
