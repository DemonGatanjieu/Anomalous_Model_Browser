from .metadata import get_metadata
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
from .utils import get_active_folder_types, get_folder_view_mode, get_active_physical_basenames, require_filename, resolve_folder_subdir, resolve_within

async def api_get_folders(request):
    mode = get_folder_view_mode()
    result = []
    seen_dirs = set()
    
    if mode == "physical":
        active_bns = get_active_physical_basenames()
        all_paths_info = []
        
        for t in folder_paths.folder_names_and_paths.keys():
            try:
                paths = folder_paths.get_folder_paths(t)
                if not paths: continue
                for path_idx, base_dir in enumerate(paths):
                    if not os.path.exists(base_dir): continue
                    real_path = os.path.realpath(base_dir)
                    if real_path in seen_dirs: continue
                    seen_dirs.add(real_path)
                    
                    bn = os.path.basename(os.path.normpath(base_dir))
                    all_paths_info.append({
                        "t": t,
                        "path_idx": path_idx,
                        "base_dir": base_dir,
                        "bn": bn
                    })
            except:
                pass
                
        for target_bn in active_bns:
            matched = [p for p in all_paths_info if p["bn"] == target_bn]
            if not matched: continue
            
            for item in matched:
                base_dir = item["base_dir"]
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
                
                label = item["bn"]
                if len(matched) > 1:
                    label += f" ({item['path_idx'] + 1})"
                    
                result.append({
                    "type": item["t"],
                    "path_idx": item["path_idx"],
                    "label": label,
                    "folders": tree
                })
    else:
        types = get_active_folder_types()
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
                    
                try:
                    folder_basename = os.path.basename(os.path.normpath(base_dir))
                    if not folder_basename:
                        folder_basename = t
                except:
                    folder_basename = t
                    
                label = folder_basename
                    
                basenames = []
                try:
                    basenames = [os.path.basename(os.path.normpath(p)) for p in paths]
                except:
                    pass
                if basenames.count(folder_basename) > 1:
                    label += f" ({path_idx + 1})"
                    
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
    page = int(request.query.get('page', 1))
    limit = int(request.query.get('limit', 0))
    try:
        path_idx = int(request.query.get('path_idx', 0))
    except:
        path_idx = 0
    try:
        paths = folder_paths.get_folder_paths(folder_type)
    except Exception:
        return web.json_response({"models": [], "total": 0})
    try:
        base_dir, target_dir = resolve_folder_subdir(folder_type, path_idx, subfolder)
    except (ValueError, KeyError):
        return web.Response(status=400, text='Invalid subfolder')
    rel_subfolder = "" if subfolder == '/' else subfolder.strip('/\\')
    if not os.path.exists(target_dir):
        return web.json_response({"models": [], "total": 0})
    try:
        entries = os.listdir(target_dir)
    except Exception:
        return web.json_response({"models": [], "total": 0})
        
    valid_files = [f for f in entries if f.endswith(('.safetensors', '.ckpt', '.pt')) and os.path.isfile(os.path.join(target_dir, f))]
    valid_files.sort(key=lambda x: x.lower())
    total = len(valid_files)
    
    if limit > 0:
        start = (page - 1) * limit
        end = start + limit
        sliced = valid_files[start:end]
    else:
        sliced = valid_files
        
    models = []
    import urllib.parse
    for f in sliced:
        file_path = os.path.join(target_dir, f)
        meta = get_metadata(file_path)
        base_name = os.path.splitext(f)[0]
        preview_file = None
        for ext in ['.preview.png', '.preview.jpg', '.preview.jpeg', '.preview.webp', '.preview.gif', '.preview.avif', '.preview.mp4', '.preview.webm', '.preview.mov', '.preview.avi', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi']:
            if os.path.exists(os.path.join(target_dir, base_name + ext)):
                preview_file = base_name + ext
                break
        preview_url = ""
        if preview_file:
            q_type = urllib.parse.quote(folder_type)
            q_idx = str(path_idx)
            q_sub = urllib.parse.quote(rel_subfolder.strip('/')) if rel_subfolder and rel_subfolder != '/' else ""
            q_file = urllib.parse.quote(preview_file)
            try: mtime = int(os.path.getmtime(os.path.join(target_dir, preview_file)))
            except: mtime = 0
            preview_url = f"/anomalous/image?type={q_type}&path_idx={q_idx}&subfolder={q_sub}&filename={q_file}&t={mtime}"
        try:
            size_bytes = os.path.getsize(file_path)
            size_mb = round(size_bytes / (1024 * 1024), 2)
        except:
            size_mb = 0; size_bytes = 0
        models.append({
            "filename": f, "size_mb": size_mb, "size_bytes": size_bytes,
            "metadata": meta, "preview_url": preview_url, "type": folder_type,
            "path_idx": path_idx, "subfolder": rel_subfolder
        })
    return web.json_response({"models": models, "total": total, "page": page, "limit": limit})

async def api_find_model(request):
    search = request.query.get('search', '').lower()
    if not search:
        return web.json_response({"status": "error", "message": "No search query provided"})
        
    for folder_type in folder_paths.folder_names_and_paths.keys():
        paths = folder_paths.get_folder_paths(folder_type)
        if not paths: continue
        for path_idx, base_dir in enumerate(paths):
            if not os.path.exists(base_dir): continue
            for root, dirs, files in os.walk(base_dir):
                for f in files:
                    if f.endswith('.safetensors') or f.endswith('.ckpt') or f.endswith('.pt') or f.endswith('.bin') or f.endswith('.sft'):
                        search_norm = search.replace(os.sep, '/')
                        abs_path_norm = os.path.join(root, f).replace(os.sep, '/').lower()
                        if search_norm in f.lower() or search_norm in abs_path_norm:
                            rel_subfolder = os.path.relpath(root, base_dir)
                            if rel_subfolder == '.': rel_subfolder = '/'
                            
                            file_path = os.path.join(root, f)
                            meta = get_metadata(file_path)
                            
                            base_name = os.path.splitext(f)[0]
                            preview_file = None
                            for ext in ['.preview.png', '.preview.jpg', '.preview.jpeg', '.preview.webp', '.preview.gif', '.preview.avif', '.preview.mp4', '.preview.webm', '.preview.mov', '.preview.avi', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi']:
                                if os.path.exists(os.path.join(root, base_name + ext)):
                                    preview_file = base_name + ext
                                    break
                                    
                            preview_url = ""
                            if preview_file:
                                q_type = urllib.parse.quote(folder_type)
                                q_idx = str(path_idx)
                                q_sub = urllib.parse.quote(rel_subfolder)
                                q_file = urllib.parse.quote(preview_file)
                                try: mtime = int(os.path.getmtime(os.path.join(root, preview_file)))
                                except: mtime = 0
                                preview_url = f"/anomalous/image?type={q_type}&path_idx={q_idx}&subfolder={q_sub}&filename={q_file}&t={mtime}"

                            try: size_mb = round(os.path.getsize(file_path) / (1024 * 1024), 1)
                            except: size_mb = 0

                            modelData = {
                                "filename": f,
                                "size_mb": size_mb,
                                "metadata": meta,
                                "preview_url": preview_url
                            }
                            return web.json_response({
                                "status": "success",
                                "model": modelData,
                                "type": folder_type,
                                "path_idx": path_idx,
                                "subfolder": rel_subfolder
                            })
                            
    return web.json_response({"status": "error", "message": "Model not found"})

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
            
        try:
            filename = require_filename(filename)
            _, target_dir = resolve_folder_subdir(folder_type, path_idx, subfolder)
            model_path = resolve_within(target_dir, filename)
        except (ValueError, KeyError):
            return web.json_response({"status": "error", "message": "Invalid request parameters"}, status=400)
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
            '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi',
            '.preview.png', '.preview.jpg', '.preview.jpeg', '.preview.webp', '.preview.gif', '.preview.avif',
            '.preview.mp4', '.preview.webm', '.preview.mov', '.preview.avi',
            '.civitai_bak.png', '.civitai_bak.jpg', '.civitai_bak.jpeg', '.civitai_bak.webp',
            '.civitai_bak.gif', '.civitai_bak.avif', '.civitai_bak.mp4', '.civitai_bak.webm',
            '.civitai_bak.mov', '.civitai_bak.avi',
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
                            for ext in ['.preview.png', '.preview.jpg', '.preview.jpeg', '.preview.webp', '.preview.gif', '.preview.avif', '.preview.mp4', '.preview.webm', '.preview.mov', '.preview.avi', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi']:
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

async def api_base_models(request):
    target_types = get_active_folder_types()
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

async def api_resolve_hash(request):
    from .metadata import _extract_safetensors_hash
    target_hash = request.query.get("hash", "").strip().upper()
    size_str = request.query.get("size", "").strip()
    filename_query = request.query.get("filename", "").strip()
    expected_types_raw = request.query.get("type", "").strip()
    target_size = int(size_str) if size_str.isdigit() else None
    
    if not target_hash and not target_size and not filename_query:
        return web.json_response({"found": False})

    all_types = ['checkpoints', 'loras', 'unet', 'diffusion_models', 'controlnet', 'vae']
    if expected_types_raw:
        requested_types = [value.strip() for value in expected_types_raw.split(',') if value.strip()]
        if not requested_types or any(value not in all_types for value in requested_types):
            return web.json_response({"found": False, "error": "Invalid model type"}, status=400)
        types = list(dict.fromkeys(requested_types))
    else:
        types = all_types
    
    # Layer 1: Exact path/filename check for pre-flight imports.
    if filename_query:
        normalized_query = filename_query.replace('\\', '/').lstrip('./')
        query_basename = normalized_query.rsplit('/', 1)[-1]
        for t in types:
            try:
                paths = folder_paths.get_folder_paths(t)
            except Exception:
                continue
            for base_dir in paths or []:
                if not os.path.exists(base_dir):
                    continue
                for root, dirs, files in os.walk(base_dir):
                    for file in files:
                        if not file.endswith(('.safetensors', '.ckpt', '.pt')):
                            continue
                        rel_path = os.path.relpath(os.path.join(root, file), base_dir).replace('\\', '/')
                        if rel_path == normalized_query or ('/' not in normalized_query and file == query_basename):
                            return web.json_response({"found": True, "type": t, "filename": rel_path, "matched_by_filename": True})

    # Layer 2: Gather candidates once, then intersect hash and byte size.  Hash
    # sidecars can be stale or can describe another file from the same Civitai
    # model version, so a disagreement must be handled explicitly.
    candidates = []
    seen_realpaths = set()
    for t in types:
        try:
            paths = folder_paths.get_folder_paths(t)
        except Exception:
            continue
        for base_dir in paths or []:
            if not os.path.exists(base_dir):
                continue
            for root, dirs, files in os.walk(base_dir):
                for file in files:
                    if not file.lower().endswith(('.safetensors', '.ckpt', '.pt')):
                        continue
                    file_path = os.path.join(root, file)
                    real_path = os.path.realpath(file_path)
                    if real_path in seen_realpaths:
                        continue
                    try:
                        file_size = os.path.getsize(file_path)
                    except OSError:
                        continue
                    seen_realpaths.add(real_path)
                    candidates.append({
                        "type": t,
                        "filename": os.path.relpath(file_path, base_dir).replace('\\', '/'),
                        "path": file_path,
                        "size": file_size,
                    })

    has_target_hash = bool(target_hash and target_hash != "UNKNOWN")

    def candidate_metadata(candidate):
        if "metadata" not in candidate:
            candidate["metadata"] = get_metadata(candidate["path"])
        return candidate["metadata"]

    def candidate_hashes(candidate):
        if "hashes" in candidate:
            return candidate["hashes"]
        values = set()
        meta_hash = candidate_metadata(candidate).get("hash", "")
        if meta_hash:
            values.add(str(meta_hash).upper())
        if candidate["path"].lower().endswith('.safetensors'):
            header_hash = _extract_safetensors_hash(candidate["path"])
            if header_hash:
                values.add(str(header_hash).upper())
        candidate["hashes"] = values
        return values

    def respond(candidate, **details):
        payload = {
            "found": True,
            "type": candidate["type"],
            "filename": candidate["filename"],
        }
        payload.update(details)
        return web.json_response(payload)

    size_matches = [candidate for candidate in candidates if target_size is not None and candidate["size"] == target_size]

    if has_target_hash and target_size is not None:
        combined_matches = [candidate for candidate in size_matches if target_hash in candidate_hashes(candidate)]
        if len(combined_matches) == 1:
            return respond(combined_matches[0], matched_by_hash=True, matched_by_size=True)
        if len(combined_matches) > 1:
            return web.json_response({"found": False, "ambiguous": True})

        # Check whether the supplied hash points at a different local file.  If
        # so, neither identifier can safely win without a model-type constraint.
        hash_matches = [candidate for candidate in candidates if target_hash in candidate_hashes(candidate)]
        if hash_matches:
            return web.json_response({"found": False, "identity_conflict": True})

        # No file in the expected category owns the saved hash.  This is the
        # legacy poisoned-sidecar case.  A unique in-category byte size may
        # recover it; equal-sized candidates remain unresolved by design.
        if len(size_matches) == 1:
            return respond(size_matches[0], matched_by_size=True, stale_hash=True)
        if len(size_matches) > 1:
            return web.json_response({"found": False, "ambiguous": True})

    if has_target_hash:
        hash_matches = [candidate for candidate in candidates if target_hash in candidate_hashes(candidate)]
        if len(hash_matches) == 1:
            return respond(hash_matches[0], matched_by_hash=True)
        if len(hash_matches) > 1:
            return web.json_response({"found": False, "ambiguous": True})

    if target_size is not None:
        if len(size_matches) == 1:
            return respond(size_matches[0], matched_by_size=True)
        if len(size_matches) > 1:
            return web.json_response({"found": False, "ambiguous": True})

    return web.json_response({"found": False})

async def api_get_all_hashes(request):
    """
    Returns a dictionary of all scanned models with their hash and size.
    Keyed by both relative path and basename for maximum frontend resilience.
    """
    import asyncio
    
    def fetch_all():
        hashes = {}
        ambiguous_keys = set()

        def add_hash(key, value):
            if key in ambiguous_keys:
                return
            existing = hashes.get(key)
            if existing is None or existing == value:
                hashes[key] = value
            else:
                hashes.pop(key, None)
                ambiguous_keys.add(key)

        types = ['checkpoints', 'loras', 'unet', 'diffusion_models', 'controlnet', 'vae']
        seen_dirs = set()
        for t in types:
            try:
                paths = folder_paths.get_folder_paths(t)
                if not paths: continue
                for base_dir in paths:
                    if base_dir in seen_dirs: continue
                    seen_dirs.add(base_dir)
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
                                add_hash(rel_path, val)
                                add_hash(basename, val)
            except Exception:
                pass
        return hashes
        
    hashes = await asyncio.to_thread(fetch_all)
    return web.json_response(hashes)

async def api_update_metadata(request):
    try:
        data = await request.json()
        folder_type = data.get('type', 'checkpoints')
        subfolder = data.get('subfolder', '/')
        filename = data.get('filename', '')
        custom_name = data.get('custom_name', '')
        custom_notes = data.get('custom_notes', '')
        physical_rename = data.get('physical_rename', False)
        try: path_idx = int(data.get('path_idx', 0))
        except: path_idx = 0

        try:
            filename = require_filename(filename)
            _, target_dir = resolve_folder_subdir(folder_type, path_idx, subfolder)
            file_path = resolve_within(target_dir, filename)
        except (ValueError, KeyError):
            return web.json_response({"status": "error", "message": "Invalid request parameters"}, status=400)
        
        if not os.path.exists(file_path):
            return web.json_response({"status": "error", "message": "Model not found"})
            
        base_name = os.path.splitext(file_path)[0]
        ext = os.path.splitext(file_path)[1]
        info_file = f"{base_name}.civitai.info"
        
        info_data = {}
        if os.path.exists(info_file):
            parsed = False
            for enc in ['utf-8', 'utf-8-sig', 'mbcs', 'latin-1']:
                try:
                    with open(info_file, 'r', encoding=enc) as f:
                        info_data = json.load(f)
                    parsed = True
                    break
                except Exception:
                    pass
            if not parsed:
                return web.json_response({"status": "error", "message": "Failed to parse existing .civitai.info file due to encoding or corruption. Rename aborted to prevent data loss."})
                
        info_data["anomalous_custom_name"] = custom_name
        info_data["anomalous_custom_notes"] = custom_notes
        
        reset_cover = data.get('reset_cover', False)
        if reset_cover:
            # 1. Delete any custom active cover (.preview.*)
            for ext in ['.preview.png', '.preview.jpg', '.preview.jpeg', '.preview.webp', '.preview.gif', '.preview.avif', '.preview.mp4', '.preview.webm', '.preview.mov', '.preview.avi']:
                p = f"{base_name}{ext}"
                if os.path.exists(p):
                    try: os.remove(p)
                    except: pass
                    
            # 2. If a Civitai backup exists, copy it back to .preview.* so standard ComfyUI can see it
            for ext in ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi']:
                civitai_bak = f"{base_name}.civitai_bak{ext}"
                if os.path.exists(civitai_bak):
                    restored_p = f"{base_name}.preview{ext}"
                    import shutil
                    try: shutil.copy2(civitai_bak, restored_p)
                    except: pass

        with open(info_file, 'w', encoding='utf-8') as f:
            json.dump(info_data, f, indent=4, ensure_ascii=False)
            
        new_filename = filename
        
        if physical_rename and custom_name:
            import re
            safe_name = re.sub(r'[<>:"/\\|?*]', '_', custom_name).strip(' .')
            if not safe_name:
                return web.json_response({"status": "error", "message": "The physical filename cannot be empty."}, status=400)
            new_file_path = os.path.join(target_dir, f"{safe_name}{ext}")
            
            if new_file_path != file_path and not os.path.exists(new_file_path):
                os.rename(file_path, new_file_path)
                
                for suffix in ['.info', '.civitai.info', '.json', '.txt', '.yaml', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi', '.preview.png', '.preview.jpg', '.preview.jpeg', '.preview.webp', '.preview.gif', '.preview.avif', '.preview.mp4', '.preview.webm', '.preview.mov', '.preview.avi', '.civitai_bak.png', '.civitai_bak.jpg', '.civitai_bak.jpeg', '.civitai_bak.webp', '.civitai_bak.gif', '.civitai_bak.avif', '.civitai_bak.mp4', '.civitai_bak.webm', '.civitai_bak.mov', '.civitai_bak.avi']:
                    old_sidecar = f"{base_name}{suffix}"
                    if os.path.exists(old_sidecar):
                        os.rename(old_sidecar, os.path.join(target_dir, f"{safe_name}{suffix}"))
                    
                new_filename = f"{safe_name}{ext}"
            elif os.path.exists(new_file_path) and new_file_path != file_path:
                return web.json_response({"status": "error", "message": "A file with the target physical name already exists."})
            
        return web.json_response({"status": "success", "new_filename": new_filename})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})

async def _handle_custom_cover(target_dir, filename, save_func, source_ext='.png'):
    base_name = os.path.splitext(filename)[0]
    
    # Always save custom covers with a .preview.[ext] suffix so standard nodes recognize them as covers.
    if source_ext.startswith('.preview.'):
        preview_ext = source_ext
    else:
        preview_ext = f".preview{source_ext}"
        
    dest_path = os.path.join(target_dir, f"{base_name}{preview_ext}")
    
    # Delete any existing .preview.* files to ensure only one custom cover is active
    for ext in ['.preview.png', '.preview.jpg', '.preview.jpeg', '.preview.webp', '.preview.gif', '.preview.avif', '.preview.mp4', '.preview.webm', '.preview.mov', '.preview.avi']:
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


import struct

async def api_resolve_paths_to_previews(request):
    try:
        data = await request.json()
        paths = data.get('paths', [])
    except:
        return web.json_response({"previews": {}})
        
    previews = {}
    all_models = {}
    
    for folder_type in folder_paths.folder_names_and_paths.keys():
        folder_dirs = folder_paths.get_folder_paths(folder_type)
        if not folder_dirs: continue
        for path_idx, base_dir in enumerate(folder_dirs):
            if not os.path.exists(base_dir): continue
            for root, dirs, files in os.walk(base_dir):
                for f in files:
                    if f.endswith('.safetensors') or f.endswith('.ckpt') or f.endswith('.pt') or f.endswith('.bin') or f.endswith('.sft'):
                        rel_path = os.path.relpath(os.path.join(root, f), base_dir).replace(os.sep, '/')
                        base_name = os.path.splitext(f)[0]
                        preview_file = None
                        for ext in ['.preview.png', '.preview.jpg', '.preview.jpeg', '.preview.webp', '.preview.gif', '.preview.avif', '.preview.mp4', '.preview.webm', '.preview.mov', '.preview.avi', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi']:
                            if os.path.exists(os.path.join(root, base_name + ext)):
                                preview_file = base_name + ext
                                break
                                
                        preview_url = ""
                        if preview_file:
                            rel_subfolder = os.path.relpath(root, base_dir)
                            if rel_subfolder == '.': rel_subfolder = '/'
                            q_type = urllib.parse.quote(folder_type)
                            q_idx = str(path_idx)
                            q_sub = urllib.parse.quote(rel_subfolder)
                            q_file = urllib.parse.quote(preview_file)
                            try: mtime = int(os.path.getmtime(os.path.join(root, preview_file)))
                            except: mtime = 0
                            preview_url = f"/anomalous/image?type={q_type}&path_idx={q_idx}&subfolder={q_sub}&filename={q_file}&t={mtime}"
                        
                        all_models[rel_path.lower()] = preview_url
                        all_models[f.lower()] = preview_url

    for p in paths:
        p_norm = p.replace(os.sep, '/').lower()
        if p_norm in all_models:
            previews[p] = all_models[p_norm]
        else:
            fname = p.split('/')[-1].split('\\')[-1].lower()
            if fname in all_models:
                previews[p] = all_models[fname]
                
    return web.json_response({"previews": previews})




async def api_get_all_scan_models(request):
    import urllib.parse
    page = int(request.query.get('page', 1))
    limit = int(request.query.get('limit', 0))
    target_types = get_active_folder_types()
    all_tuples = []
    seen_dirs = set()
    for t in target_types:
        try:
            paths = folder_paths.get_folder_paths(t)
        except Exception:
            continue
        if not paths: continue
        for path_idx, base_dir in enumerate(paths):
            if base_dir in seen_dirs: continue
            seen_dirs.add(base_dir)
            if not os.path.exists(base_dir): continue
            for root, dirs, files in os.walk(base_dir):
                for f in files:
                    if f.endswith(('.safetensors', '.ckpt', '.pt', '.bin', '.sft')):
                        all_tuples.append((t, path_idx, root, base_dir, f))
                        
    all_tuples.sort(key=lambda x: (x[0], x[4].lower()))
    total = len(all_tuples)
    
    if limit > 0:
        start = (page - 1) * limit
        end = start + limit
        sliced = all_tuples[start:end]
    else:
        sliced = all_tuples
        
    all_models = []
    for t, path_idx, root, base_dir, f in sliced:
        file_path = os.path.join(root, f)
        rel_subfolder = os.path.relpath(root, base_dir)
        if rel_subfolder == '.': rel_subfolder = ''
        else: rel_subfolder = rel_subfolder.replace('\\', '/')
        try:
            size_bytes = os.path.getsize(file_path)
            size_mb = round(size_bytes / (1024 * 1024), 2)
        except:
            size_bytes = 0; size_mb = 0
        meta = get_metadata(file_path)
        base_name = os.path.splitext(f)[0]
        preview_file = None
        for ext in ['.preview.png', '.preview.jpg', '.preview.jpeg', '.preview.webp', '.preview.gif', '.preview.avif', '.preview.mp4', '.preview.webm', '.preview.mov', '.preview.avi', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi']:
            if os.path.exists(os.path.join(root, base_name + ext)):
                preview_file = base_name + ext
                break
        preview_url = ""
        if preview_file:
            q_type = urllib.parse.quote(t)
            q_idx = str(path_idx)
            q_sub = urllib.parse.quote(rel_subfolder.strip('/')) if rel_subfolder and rel_subfolder != '/' else ""
            q_file = urllib.parse.quote(preview_file)
            try: mtime = int(os.path.getmtime(os.path.join(root, preview_file)))
            except: mtime = 0
            preview_url = f"/anomalous/image?type={q_type}&path_idx={q_idx}&subfolder={q_sub}&filename={q_file}&t={mtime}"
        all_models.append({
            "type": t, "path_idx": path_idx, "subfolder": rel_subfolder,
            "filename": f, "size_mb": size_mb, "size_bytes": size_bytes,
            "preview_url": preview_url, "metadata": meta
        })
    return web.json_response({"models": all_models, "total": total, "page": page, "limit": limit})

async def api_batch_select(request):
    folder_key = request.query.get('folderKey', 'ALL')
    action = request.query.get('action', 'all')
    
    def matches_condition(file_path, root, base_name):
        if action == 'all':
            return True
        elif action == 'no_preview':
            for ext in ['.preview.png', '.preview.jpg', '.preview.jpeg', '.preview.webp', '.preview.gif', '.preview.avif', '.preview.mp4', '.preview.webm', '.preview.mov', '.preview.avi', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi']:
                if os.path.exists(os.path.join(root, base_name + ext)):
                    return False
            return True
        elif action == 'no_desc':
            info_file = file_path + '.info'
            civitai_info = os.path.join(root, base_name + '.civitai.info')
            if os.path.exists(civitai_info):
                try:
                    with open(civitai_info, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        if data.get('description', '').strip():
                            return False
                except: pass
            if os.path.exists(info_file):
                try:
                    with open(info_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        if data.get('description', '').strip():
                            return False
                except: pass
            return True
        return False

    results = {}
    
    if folder_key == 'ALL':
        target_types = get_active_folder_types()
        seen_dirs = set()
        for t in target_types:
            try: paths = folder_paths.get_folder_paths(t)
            except Exception: continue
            if not paths: continue
            for path_idx, base_dir in enumerate(paths):
                if base_dir in seen_dirs: continue
                seen_dirs.add(base_dir)
                if not os.path.exists(base_dir): continue
                for root, dirs, files in os.walk(base_dir):
                    for f in files:
                        if f.endswith(('.safetensors', '.ckpt', '.pt', '.bin', '.sft')):
                            file_path = os.path.join(root, f)
                            base_name = os.path.splitext(f)[0]
                            if matches_condition(file_path, root, base_name):
                                rel_subfolder = os.path.relpath(root, base_dir)
                                if rel_subfolder == '.': rel_subfolder = ''
                                else: rel_subfolder = rel_subfolder.replace('\\', '/')
                                fkey = f"{t}|{path_idx}|{rel_subfolder}"
                                if fkey not in results: results[fkey] = []
                                results[fkey].append(f)
    else:
        parts = folder_key.split('|')
        if len(parts) >= 3:
            t = parts[0]
            path_idx = int(parts[1])
            subfolder = parts[2]
            
            try: paths = folder_paths.get_folder_paths(t)
            except Exception: paths = []
            
            if paths and path_idx < len(paths):
                try:
                    base_dir, target_dir = resolve_folder_subdir(t, path_idx, subfolder)
                except ValueError:
                    return web.json_response({"selected": {}})
                    
                if os.path.exists(target_dir):
                    try: entries = os.listdir(target_dir)
                    except: entries = []
                    for f in entries:
                        if f.endswith(('.safetensors', '.ckpt', '.pt', '.bin', '.sft')):
                            file_path = os.path.join(target_dir, f)
                            if os.path.isfile(file_path):
                                base_name = os.path.splitext(f)[0]
                                if matches_condition(file_path, target_dir, base_name):
                                    if folder_key not in results: results[folder_key] = []
                                    results[folder_key].append(f)
                                    
    return web.json_response({"selected": results})
