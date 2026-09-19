"""Model folder discovery, listing, search, and presentation lookup."""

import asyncio
import json
import os
import urllib.parse

from aiohttp import web
import folder_paths

from .metadata import get_metadata
from .model_constants import MEDIA_EXTENSIONS, MODEL_EXTENSIONS, PREVIEW_SUFFIXES
from .model_media import _cache_token, _preview_url_for_model
from .folder_types import (
    get_active_folder_types, get_active_model_roots,
    get_active_physical_basenames, get_folder_view_mode,
)
from .path_utils import resolve_folder_subdir

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
    source_library_extensions = {'.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.sft', '.gguf'}
    all_tuples = []
    for model_root in get_active_model_roots():
        t = model_root["type"]
        path_idx = model_root["path_idx"]
        base_dir = model_root["base_dir"]
        for root, dirs, files in os.walk(base_dir):
            for f in files:
                if os.path.splitext(f)[1].lower() in source_library_extensions:
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
