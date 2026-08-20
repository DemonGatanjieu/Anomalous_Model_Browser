from .metadata import get_metadata
import os
import sys
import json
import urllib.parse
import subprocess
import threading
import asyncio
import shutil
from aiohttp import web
import folder_paths
import struct
from .utils import get_active_folder_types, get_folder_view_mode, get_active_physical_basenames, require_filename, resolve_folder_subdir, resolve_within
try:
    from ..model_policies import is_physical_rename_protected, requires_hash_for_model_recovery
except ImportError:
    from model_policies import is_physical_rename_protected, requires_hash_for_model_recovery


# Cover and sidecar lifecycle is intentionally bounded to exact candidate paths.
# Do not replace these checks with a directory-wide glob/walk: model folders can
# contain thousands of files, while this list has a small, constant upper bound.
MEDIA_EXTENSIONS = ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi')
MODEL_EXTENSIONS = ('.safetensors', '.ckpt', '.pt', '.bin')
PREVIEW_SUFFIXES = tuple(f'.preview{ext}' for ext in MEDIA_EXTENSIONS)
CIVITAI_BACKUP_SUFFIXES = tuple(f'.civitai_bak{ext}' for ext in MEDIA_EXTENSIONS)
SIDECAR_SUFFIXES = (
    '.info', '.civitai.info', '.json', '.txt', '.yaml',
    *MEDIA_EXTENSIONS,
    *PREVIEW_SUFFIXES,
    *CIVITAI_BACKUP_SUFFIXES,
)


def _first_existing_sidecar(base_path, suffixes):
    for suffix in suffixes:
        candidate = f"{base_path}{suffix}"
        if os.path.isfile(candidate):
            return candidate, suffix
    return None, None


def _reset_model_cover(base_path):
    """Restore a recoverable cover without destroying the only existing image."""
    backup_path, backup_suffix = _first_existing_sidecar(base_path, CIVITAI_BACKUP_SUFFIXES)
    original_path, _ = _first_existing_sidecar(base_path, MEDIA_EXTENSIONS)
    preview_paths = [
        f"{base_path}{suffix}"
        for suffix in PREVIEW_SUFFIXES
        if os.path.isfile(f"{base_path}{suffix}")
    ]

    if backup_path:
        media_ext = backup_suffix[len('.civitai_bak'):]
        restored_path = f"{base_path}.preview{media_ext}"
        temp_path = f"{restored_path}.anomalous_tmp"
        try:
            # Copy first. If the backup cannot be read, the active custom cover
            # remains untouched. os.replace then makes the actual restore atomic.
            shutil.copy2(backup_path, temp_path)
            os.replace(temp_path, restored_path)
            for preview_path in preview_paths:
                if preview_path != restored_path and os.path.isfile(preview_path):
                    os.remove(preview_path)
        except Exception as exc:
            try:
                if os.path.isfile(temp_path):
                    os.remove(temp_path)
            except OSError:
                pass
            return False, 'restore_failed', str(exc)
        return True, 'civitai_backup', None

    if original_path:
        try:
            for preview_path in preview_paths:
                os.remove(preview_path)
        except Exception as exc:
            return False, 'restore_failed', str(exc)
        return True, 'original_cover', None

    if preview_paths:
        # There is no recoverable source. Keep the current cover instead of
        # turning a harmless Reset click into irreversible image loss.
        return False, 'preserved_current', 'No Civitai backup or original cover exists.'

    return True, 'no_cover', None


def _cache_token(file_path):
    try:
        return os.stat(file_path).st_mtime_ns
    except OSError:
        return 0


def _collect_folder_models(target_dir, folder_type, path_idx, rel_subfolder, page, limit):
    """Collect one folder in a worker thread with a single directory listing."""
    try:
        with os.scandir(target_dir) as iterator:
            file_entries = {}
            for entry in iterator:
                try:
                    if entry.is_file():
                        file_entries[entry.name] = entry
                except OSError:
                    continue
    except OSError:
        return {"models": [], "total": 0, "page": page, "limit": limit}

    valid_files = sorted(
        (name for name in file_entries if name.endswith(('.safetensors', '.ckpt', '.pt'))),
        key=str.lower,
    )
    total = len(valid_files)
    if limit > 0:
        start = max(0, (page - 1) * limit)
        sliced = valid_files[start:start + limit]
    else:
        sliced = valid_files

    q_type = urllib.parse.quote(folder_type)
    q_idx = str(path_idx)
    q_sub = urllib.parse.quote(rel_subfolder.strip('/')) if rel_subfolder and rel_subfolder != '/' else ""
    models = []
    for filename in sliced:
        file_path = os.path.join(target_dir, filename)
        metadata = get_metadata(file_path)
        base_name = os.path.splitext(filename)[0]
        preview_file = next(
            (base_name + suffix for suffix in PREVIEW_SUFFIXES + MEDIA_EXTENSIONS if base_name + suffix in file_entries),
            None,
        )
        preview_url = ""
        if preview_file:
            q_file = urllib.parse.quote(preview_file)
            try:
                preview_version = file_entries[preview_file].stat().st_mtime_ns
            except OSError:
                preview_version = 0
            preview_url = (
                f"/anomalous/image?type={q_type}&path_idx={q_idx}&subfolder={q_sub}"
                f"&filename={q_file}&t={preview_version}"
            )
        try:
            model_stat = file_entries[filename].stat()
            size_bytes = model_stat.st_size
            size_mb = round(size_bytes / (1024 * 1024), 2)
        except OSError:
            size_mb = 0
            size_bytes = 0
        models.append({
            "filename": filename,
            "file_path": os.path.abspath(file_path),
            "size_mb": size_mb,
            "size_bytes": size_bytes,
            "metadata": metadata,
            "preview_url": preview_url,
            "type": folder_type,
            "path_idx": path_idx,
            "subfolder": rel_subfolder,
        })
    return {"models": models, "total": total, "page": page, "limit": limit}

def _collect_folders():
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
        
    return {"folders": result}


async def api_get_folders(request):
    return web.json_response(await asyncio.to_thread(_collect_folders))


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
    payload = await asyncio.to_thread(
        _collect_folder_models,
        target_dir,
        folder_type,
        path_idx,
        rel_subfolder,
        page,
        limit,
    )
    return web.json_response(payload)

def _iter_search_models():
    for folder_type in folder_paths.folder_names_and_paths.keys():
        try:
            paths = folder_paths.get_folder_paths(folder_type)
        except Exception:
            continue
        for path_idx, base_dir in enumerate(paths):
            if not os.path.isdir(base_dir):
                continue
            for root, _, files in os.walk(base_dir):
                for filename in files:
                    if filename.lower().endswith(MODEL_EXTENSIONS + ('.sft',)):
                        yield folder_type, path_idx, base_dir, os.path.join(root, filename)


def _find_model_sync(search):
    normalized_search = search.replace('\\', '/').lower()
    for folder_type, path_idx, base_dir, file_path in _iter_search_models():
        normalized_path = file_path.replace(os.sep, '/').lower()
        if normalized_search in os.path.basename(file_path).lower() or normalized_search in normalized_path:
            return _model_info_for_path(folder_type, path_idx, base_dir, file_path)

    for folder_type, path_idx, base_dir, file_path in _iter_search_models():
        metadata = get_metadata(file_path)
        searchable_names = (metadata.get('custom_name', ''), metadata.get('name', ''))
        if any(normalized_search in str(name).lower() for name in searchable_names if name):
            return _model_info_for_path(folder_type, path_idx, base_dir, file_path)
    return None


async def api_find_model(request):
    search = request.query.get('search', '').strip()
    if not search:
        return web.json_response({"status": "error", "message": "No search query provided"})

    result = await asyncio.to_thread(_find_model_sync, search)
    if not result:
        return web.json_response({"status": "error", "message": "Model not found"})
    return web.json_response({
        "status": "success",
        "model": result,
        "type": result["type"],
        "path_idx": result["path_idx"],
        "subfolder": result["subfolder"],
    })

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
        # Sidecars are keyed by stem, not by the main model extension. If a
        # second real model shares this stem, preserve the shared sidecars for
        # the survivor instead of treating that model as cleanup debris.
        shared_stem_in_use = any(
            os.path.isfile(os.path.join(target_dir, base_name + model_ext))
            for model_ext in MODEL_EXTENSIONS
        )
        deleted_files = [filename]
        if not shared_stem_in_use:
            for suffix in SIDECAR_SUFFIXES:
                file_to_del = os.path.join(target_dir, base_name + suffix)
                if os.path.isfile(file_to_del):
                    try:
                        os.remove(file_to_del)
                        deleted_files.append(base_name + suffix)
                    except Exception as e:
                        print(f"[Anomalous Browser] Warning: Failed to delete {file_to_del}: {e}")
                    
        # 3. 修正：前端期待的成功状态是 "success" 而不是 "ok"
        return web.json_response({
            "status": "success",
            "deleted": deleted_files,
            "sidecars_preserved": shared_stem_in_use,
        })
        
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
                            for ext in PREVIEW_SUFFIXES + MEDIA_EXTENSIONS:
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

RESOLVABLE_MODEL_TYPES = (
    'checkpoints', 'loras', 'unet', 'diffusion_models', 'controlnet',
    'vae', 'vae_approx', 'clip', 'text_encoders', 'clip_vision',
)


def _parse_resolution_types(expected_types_raw):
    if not expected_types_raw:
        return RESOLVABLE_MODEL_TYPES
    requested = tuple(dict.fromkeys(
        value.strip() for value in str(expected_types_raw).split(',') if value.strip()
    ))
    if not requested or any(value not in RESOLVABLE_MODEL_TYPES for value in requested):
        raise ValueError("Invalid model type")
    return requested


def _collect_resolution_candidates(types):
    candidates = []
    seen_realpaths = set()
    for folder_type in types:
        try:
            paths = folder_paths.get_folder_paths(folder_type)
        except Exception:
            continue
        for base_dir in paths or []:
            if not os.path.exists(base_dir):
                continue
            for root, _, files in os.walk(base_dir):
                for filename in files:
                    if not filename.lower().endswith(MODEL_EXTENSIONS):
                        continue
                    file_path = os.path.join(root, filename)
                    real_path = os.path.realpath(file_path)
                    if real_path in seen_realpaths:
                        continue
                    try:
                        file_size = os.path.getsize(file_path)
                    except OSError:
                        continue
                    seen_realpaths.add(real_path)
                    candidates.append({
                        "type": folder_type,
                        "filename": os.path.relpath(file_path, base_dir).replace('\\', '/'),
                        "path": file_path,
                        "size": file_size,
                    })
    return candidates


def _candidate_hashes(candidate):
    from .metadata import _extract_safetensors_hash

    if "hashes" in candidate:
        return candidate["hashes"]
    values = set()
    metadata = candidate.get("metadata")
    if metadata is None:
        metadata = get_metadata(candidate["path"])
        candidate["metadata"] = metadata
    meta_hash = metadata.get("hash", "")
    if meta_hash:
        values.add(str(meta_hash).upper())
    if candidate["path"].lower().endswith('.safetensors'):
        header_hash = _extract_safetensors_hash(candidate["path"])
        if header_hash:
            values.add(str(header_hash).upper())
    candidate["hashes"] = values
    return values


def _resolved_payload(candidate, **details):
    payload = {
        "found": True,
        "type": candidate["type"],
        "filename": candidate["filename"],
    }
    payload.update(details)
    return payload


def _compute_and_save_fallback_info(file_path, file_hash):
    try:
        base_path = os.path.splitext(file_path)[0]
        info_path = base_path + ".info"
        civitai_info_path = base_path + ".civitai.info"
        if not os.path.exists(info_path) and not os.path.exists(civitai_info_path):
            from scraper import infer_base_model_from_header
            filename = os.path.basename(file_path)
            inferred_base = infer_base_model_from_header(file_path) if file_path.lower().endswith('.safetensors') else ""
            if inferred_base == 'Unknown':
                inferred_base = ""
            info_data = {
                "id": -1,
                "modelId": -1,
                "name": os.path.splitext(filename)[0],
                "baseModel": inferred_base,
                "description": "<p>Automatically inferred by Anomalous Local Engine.</p>",
                "model": {
                    "name": os.path.splitext(filename)[0],
                    "type": "LORA" if "lora" in file_path.lower() else "Checkpoint"
                },
                "files": [{"hashes": {"SHA256": file_hash.lower()}}]
            }
            with open(info_path, 'w', encoding='utf-8') as f:
                json.dump(info_data, f, ensure_ascii=True, indent=4)
    except Exception:
        pass


def _resolve_from_candidates(candidates, target_hash="", target_size=None, filename_query="", require_hash=False):
    target_hash = str(target_hash or "").strip().upper()
    # A saved filename/path is not identity evidence. It is intentionally
    # ignored here; exact path lookup for previews lives in the bounded
    # resolve_paths_to_previews endpoint and does not activate a model match.

    has_target_hash = bool(target_hash and target_hash != "UNKNOWN")
    size_matches = [
        candidate for candidate in candidates
        if target_size is not None and candidate["size"] == target_size
    ]

    if has_target_hash and target_size is not None:
        combined_matches = [candidate for candidate in size_matches if target_hash in _candidate_hashes(candidate)]
        if len(combined_matches) == 1:
            return _resolved_payload(combined_matches[0], matched_by_hash=True, matched_by_size=True)
        if len(combined_matches) > 1:
            return {"found": False, "ambiguous": True}

        # If no combined match found from static cache, but there are size-matching candidates without hash metadata,
        # dynamically compute their hash on-demand to test against target_hash
        unhashed_size_matches = [c for c in size_matches if not _candidate_hashes(c)]
        if unhashed_size_matches:
            from scraper import calculate_sha256
            for candidate in unhashed_size_matches:
                try:
                    computed_hash = calculate_sha256(candidate["path"]).upper()
                    candidate.setdefault("hashes", set()).add(computed_hash)
                    if computed_hash == target_hash:
                        _compute_and_save_fallback_info(candidate["path"], computed_hash)
                except Exception:
                    pass

            dynamic_matches = [c for c in size_matches if target_hash in c.get("hashes", set())]
            if len(dynamic_matches) == 1:
                return _resolved_payload(dynamic_matches[0], matched_by_hash=True, matched_by_size=True)
            if len(dynamic_matches) > 1:
                return {"found": False, "ambiguous": True}

        hash_matches = [candidate for candidate in candidates if target_hash in _candidate_hashes(candidate)]
        if hash_matches:
            return {"found": False, "identity_conflict": True}
        return {"found": False, "identity_conflict": True}

    if has_target_hash:
        hash_matches = [candidate for candidate in candidates if target_hash in _candidate_hashes(candidate)]
        if len(hash_matches) == 1:
            return _resolved_payload(hash_matches[0], matched_by_hash=True)
        if len(hash_matches) > 1:
            return {"found": False, "ambiguous": True}

    if require_hash:
        return {"found": False, "hash_required": True}

    if target_size is not None:
        if len(size_matches) == 1:
            return _resolved_payload(size_matches[0], matched_by_size=True)
        if len(size_matches) > 1:
            return {"found": False, "ambiguous": True}
    return {"found": False}


async def api_resolve_hash(request):
    target_hash = request.query.get("hash", "").strip().upper()
    size_str = request.query.get("size", "").strip()
    filename_query = request.query.get("filename", "").strip()
    target_size = int(size_str) if size_str.isdigit() else None
    if not target_hash and target_size is None and not filename_query:
        return web.json_response({"found": False})
    try:
        types = _parse_resolution_types(request.query.get("type", "").strip())
    except ValueError as exc:
        return web.json_response({"found": False, "error": str(exc)}, status=400)

    def resolve_one():
        candidates = _collect_resolution_candidates(types)
        return _resolve_from_candidates(
            candidates,
            target_hash,
            target_size,
            filename_query,
            require_hash=requires_hash_for_model_recovery(types),
        )

    return web.json_response(await asyncio.to_thread(resolve_one))


async def api_resolve_hash_batch(request):
    try:
        data = await request.json()
        items = data.get("items", [])
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)
    if not isinstance(items, list) or len(items) > 256:
        return web.json_response({"error": "items must be a list with at most 256 entries"}, status=400)

    parsed_items = []
    try:
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                raise ValueError("Invalid batch item")
            size_value = item.get("size")
            size_string = str(size_value).strip() if size_value is not None else ""
            parsed_items.append({
                "key": str(item.get("key", index)),
                "hash": str(item.get("hash", "")).strip().upper(),
                "size": int(size_string) if size_string.isdigit() else None,
                "types": _parse_resolution_types(str(item.get("type", "")).strip()),
            })
    except (TypeError, ValueError) as exc:
        return web.json_response({"error": str(exc)}, status=400)

    def resolve_batch():
        candidate_groups = {}
        results = []
        for item in parsed_items:
            types = item["types"]
            if types not in candidate_groups:
                candidate_groups[types] = _collect_resolution_candidates(types)
            result = _resolve_from_candidates(
                candidate_groups[types],
                item["hash"],
                item["size"],
                require_hash=requires_hash_for_model_recovery(types),
            )
            results.append({"key": item["key"], "result": result})
        return results

    return web.json_response({"results": await asyncio.to_thread(resolve_batch)})

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

        types = RESOLVABLE_MODEL_TYPES
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
                            if file.lower().endswith(MODEL_EXTENSIONS):
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
        physical_rename_requested = data.get('physical_rename', False)
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

        physical_rename_skipped = physical_rename_requested and is_physical_rename_protected(
            folder_type=folder_type,
            folder_path=target_dir,
        )
        physical_rename = physical_rename_requested and not physical_rename_skipped
            
        base_name = os.path.splitext(file_path)[0]
        model_ext = os.path.splitext(file_path)[1]
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
        cover_reset = None
        cover_reset_source = None
        cover_reset_warning = None
        if reset_cover:
            cover_reset, cover_reset_source, cover_reset_warning = _reset_model_cover(base_name)

        with open(info_file, 'w', encoding='utf-8') as f:
            json.dump(info_data, f, indent=4, ensure_ascii=False)
            
        new_filename = filename
        
        if physical_rename and custom_name:
            import re
            safe_name = re.sub(r'[<>:"/\\|?*]', '_', custom_name).strip(' .')
            if not safe_name:
                return web.json_response({"status": "error", "message": "The physical filename cannot be empty."}, status=400)
            new_file_path = os.path.join(target_dir, f"{safe_name}{model_ext}")
            
            if new_file_path != file_path and not os.path.exists(new_file_path):
                os.rename(file_path, new_file_path)
                
                for suffix in SIDECAR_SUFFIXES:
                    old_sidecar = f"{base_name}{suffix}"
                    if os.path.isfile(old_sidecar):
                        os.rename(old_sidecar, os.path.join(target_dir, f"{safe_name}{suffix}"))

                new_filename = f"{safe_name}{model_ext}"
            elif os.path.exists(new_file_path) and new_file_path != file_path:
                return web.json_response({"status": "error", "message": "A file with the target physical name already exists."})
            
        response_data = {
            "status": "success",
            "new_filename": new_filename,
            "physical_rename_skipped": physical_rename_skipped,
        }
        if reset_cover:
            response_data.update({
                "cover_reset": cover_reset,
                "cover_reset_source": cover_reset_source,
                "cover_reset_warning": cover_reset_warning,
            })
        return web.json_response(response_data)
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


import struct


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


def _model_info_for_path(folder_type, path_idx, base_dir, file_path):
    root = os.path.dirname(file_path)
    rel_subfolder = os.path.relpath(root, base_dir)
    if rel_subfolder == '.':
        rel_subfolder = '/'
    else:
        rel_subfolder = '/' + rel_subfolder.replace(os.sep, '/')
    try:
        size_bytes = os.path.getsize(file_path)
    except OSError:
        size_bytes = 0
    return {
        "type": folder_type,
        "path_idx": path_idx,
        "subfolder": rel_subfolder,
        "filename": os.path.basename(file_path),
        "file_path": os.path.abspath(file_path),
        "size_bytes": size_bytes,
        "size_mb": round(size_bytes / (1024 * 1024), 2),
        "preview_url": _preview_url_for_model(folder_type, path_idx, base_dir, file_path),
        "metadata": get_metadata(file_path),
    }


def _allowed_folder_types(requested_types=None):
    available = list(folder_paths.folder_names_and_paths.keys())
    if requested_types is None:
        return available
    if not isinstance(requested_types, list):
        return []
    allowed = set(available)
    return list(dict.fromkeys(
        folder_type
        for folder_type in requested_types
        if isinstance(folder_type, str) and folder_type in allowed
    ))


def _resolve_paths_to_model_info_sync(paths, folder_types=None, exact_only=False):
    requested = [
        (path, path.replace('\\', '/').lower(), path.replace('\\', '/'))
        for path in paths
        if isinstance(path, str)
    ]
    exact_results = {}
    roots = []
    for folder_type in _allowed_folder_types(folder_types):
        try:
            folder_dirs = folder_paths.get_folder_paths(folder_type)
        except Exception:
            continue
        for path_idx, base_dir in enumerate(folder_dirs or []):
            if not os.path.isdir(base_dir):
                continue
            real_base_dir = os.path.realpath(base_dir)
            roots.append((folder_type, path_idx, real_base_dir))
            for original, _, relative_path in requested:
                relative = relative_path.replace('/', os.sep)
                candidate = os.path.realpath(os.path.join(real_base_dir, relative))
                try:
                    if os.path.commonpath((real_base_dir, candidate)) != real_base_dir:
                        continue
                except ValueError:
                    continue
                if os.path.isfile(candidate) and candidate.lower().endswith(('.safetensors', '.ckpt', '.pt', '.bin', '.sft')):
                    exact_results[original] = _model_info_for_path(folder_type, path_idx, base_dir, candidate)

    unresolved = [(original, normalized) for original, normalized, _ in requested if original not in exact_results]
    if exact_only or not unresolved:
        return exact_results

    wanted_relpaths = {normalized for _, normalized in unresolved}
    wanted_basenames = {normalized.rsplit('/', 1)[-1] for _, normalized in unresolved}
    rel_matches = {}
    basename_matches = {}
    for folder_type, path_idx, base_dir in roots:
        for root, _, files in os.walk(base_dir):
            for filename in files:
                if not filename.lower().endswith(('.safetensors', '.ckpt', '.pt', '.bin', '.sft')):
                    continue
                rel_path = os.path.relpath(os.path.join(root, filename), base_dir).replace(os.sep, '/').lower()
                basename = filename.lower()
                if rel_path not in wanted_relpaths and basename not in wanted_basenames:
                    continue
                candidate_info = _model_info_for_path(
                    folder_type,
                    path_idx,
                    base_dir,
                    os.path.join(root, filename),
                )
                if rel_path in wanted_relpaths:
                    rel_matches[rel_path] = candidate_info
                if basename in wanted_basenames:
                    basename_matches[basename] = candidate_info

    model_info = dict(exact_results)
    for original, normalized in unresolved:
        if normalized in rel_matches:
            model_info[original] = rel_matches[normalized]
        else:
            basename = normalized.rsplit('/', 1)[-1]
            if basename in basename_matches:
                model_info[original] = basename_matches[basename]
    return model_info


def _resolve_paths_to_previews_sync(paths, folder_types=None, exact_only=False):
    model_info = _resolve_paths_to_model_info_sync(paths, folder_types, exact_only)
    return {path: item.get("preview_url", "") for path, item in model_info.items()}


async def api_resolve_paths_to_previews(request):
    try:
        data = await request.json()
        paths = data.get('paths', [])
        folder_types = data.get('folder_types')
        context_requests = data.get('context_requests', [])
        exact_only = data.get('exact_only') is True
    except:
        return web.json_response({"previews": {}, "models": {}, "context_models": {}})

    model_info = await asyncio.to_thread(_resolve_paths_to_model_info_sync, paths, folder_types, exact_only)
    context_models = {}
    if isinstance(context_requests, list):
        for item in context_requests[:16]:
            if not isinstance(item, dict):
                continue
            context_path = item.get('path')
            if not isinstance(context_path, str) or not context_path:
                continue
            resolved = await asyncio.to_thread(
                _resolve_paths_to_model_info_sync,
                [context_path],
                item.get('folder_types'),
                item.get('exact_only') is True or exact_only,
            )
            if context_path in resolved:
                context_key = item.get('key')
                if not isinstance(context_key, str) or not context_key:
                    context_key = context_path
                context_models[context_key] = resolved[context_path]

    previews = {path: item.get("preview_url", "") for path, item in model_info.items()}
    return web.json_response({
        "previews": previews,
        "models": model_info,
        "context_models": context_models,
    })




def _collect_all_scan_models(page, limit):
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
        for ext in PREVIEW_SUFFIXES + MEDIA_EXTENSIONS:
            if os.path.exists(os.path.join(root, base_name + ext)):
                preview_file = base_name + ext
                break
        preview_url = ""
        if preview_file:
            q_type = urllib.parse.quote(t)
            q_idx = str(path_idx)
            q_sub = urllib.parse.quote(rel_subfolder.strip('/')) if rel_subfolder and rel_subfolder != '/' else ""
            q_file = urllib.parse.quote(preview_file)
            mtime = _cache_token(os.path.join(root, preview_file))
            preview_url = f"/anomalous/image?type={q_type}&path_idx={q_idx}&subfolder={q_sub}&filename={q_file}&t={mtime}"
        all_models.append({
            "type": t, "path_idx": path_idx, "subfolder": rel_subfolder,
            "filename": f, "size_mb": size_mb, "size_bytes": size_bytes,
            "preview_url": preview_url, "metadata": meta
        })
    return {"models": all_models, "total": total, "page": page, "limit": limit}


async def api_get_all_scan_models(request):
    page = int(request.query.get('page', 1))
    limit = int(request.query.get('limit', 0))
    payload = await asyncio.to_thread(_collect_all_scan_models, page, limit)
    return web.json_response(payload)

async def api_batch_select(request):
    folder_key = request.query.get('folderKey', 'ALL')
    action = request.query.get('action', 'all')
    
    def matches_condition(file_path, root, base_name):
        if action == 'all':
            return True
        elif action == 'no_preview':
            for ext in PREVIEW_SUFFIXES + MEDIA_EXTENSIONS:
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
