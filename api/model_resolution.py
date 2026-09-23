"""Cryptographic and size-based missing-model resolution."""

import asyncio
import json
import os
import struct
import threading

from aiohttp import web
import folder_paths

try:
    from ..model_identity import computed_file_identity, normalise_sha256
except ImportError:
    from model_identity import computed_file_identity, normalise_sha256
try:
    from ..model_policies import requires_hash_for_model_recovery
except ImportError:
    from model_policies import requires_hash_for_model_recovery
from .metadata import get_metadata
from .model_constants import MODEL_EXTENSIONS, RESOLVABLE_MODEL_TYPES
from .utils import atomic_write_json

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
    if "hashes" in candidate:
        return candidate["hashes"]
    values = set()
    metadata = candidate.get("metadata")
    if metadata is None:
        metadata = get_metadata(candidate["path"])
        candidate["metadata"] = metadata
    meta_hash = normalise_sha256(metadata.get("hash", ""))
    if meta_hash:
        values.add(str(meta_hash).upper())
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


def _size_candidate_payload(candidate, require_hash=False):
    """Expose one in-category size match for explicit user confirmation only."""
    return {
        "found": False,
        "confirmation_required": True,
        "matched_by_size": True,
        "hash_required": bool(require_hash),
        "type": candidate["type"],
        "filename": candidate["filename"],
        "size": candidate["size"],
    }


def _compute_and_save_fallback_info(file_path, file_hash):
    try:
        base_path = os.path.splitext(file_path)[0]
        info_path = base_path + ".info"
        civitai_info_path = base_path + ".civitai.info"
        if os.path.exists(info_path) or os.path.exists(civitai_info_path):
            info_path = info_path if os.path.exists(info_path) else civitai_info_path
            with open(info_path, encoding='utf-8') as source:
                info_data = json.load(source)
        else:
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
        info_data["anomalous_file_identity"] = computed_file_identity(file_path, file_hash)
        atomic_write_json(info_path, info_data)
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
        if hash_matches or size_matches:
            return {"found": False, "identity_conflict": True}
        return {"found": False}

    if has_target_hash:
        hash_matches = [candidate for candidate in candidates if target_hash in _candidate_hashes(candidate)]
        if len(hash_matches) == 1:
            return _resolved_payload(hash_matches[0], matched_by_hash=True)
        if len(hash_matches) > 1:
            return {"found": False, "ambiguous": True}

    if target_size is not None:
        if len(size_matches) == 1:
            return _size_candidate_payload(size_matches[0], require_hash=require_hash)
        if len(size_matches) > 1:
            return {"found": False, "ambiguous": True}
    if require_hash:
        return {"found": False, "hash_required": True}
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


def collect_model_hash_index():
    """Scanned models keyed by relative path and basename -> {hash, size, url}.

    Ambiguous keys (same name, different hash) are dropped. Shared by the
    all-hashes endpoint and the output gallery's hash search.
    """
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
                            model_url = ""
                            if meta:
                                model_url = meta.get("source_url") or meta.get("civitai_url") or ""
                            
                            rel_path = os.path.relpath(file_path, base_dir)
                            if rel_path.startswith('.\\') or rel_path.startswith('./'):
                                rel_path = rel_path[2:]
                            rel_path = rel_path.replace('\\', '/')
                            basename = os.path.basename(file_path)
                            
                            val = {"hash": hash_val, "size": size_bytes, "url": model_url}
                            add_hash(rel_path, val)
                            add_hash(basename, val)
        except Exception:
            pass
    return hashes


async def api_get_all_hashes(request):
    """
    Returns a dictionary of all scanned models with their hash and size.
    Keyed by both relative path and basename for maximum frontend resilience.
    """
    hashes = await asyncio.to_thread(collect_model_hash_index)
    return web.json_response(hashes)
