import os
import sys
import json
import urllib.parse
import subprocess
import threading
import asyncio
import copy
from functools import lru_cache
from aiohttp import web
import folder_paths
import struct

def _read_safetensors_hash(file_path):
    """Extract hash from safetensors header metadata (O(1) fast read, no full-file SHA256)."""
    try:
        with open(file_path, "rb") as f:
            header_size_bytes = f.read(8)
            if len(header_size_bytes) < 8:
                return None
            header_size = struct.unpack('<Q', header_size_bytes)[0]
            if header_size > 100 * 1024 * 1024:
                return None
            
            header_json_bytes = f.read(header_size)
            header_str = header_json_bytes.decode('utf-8')
            header_json = json.loads(header_str)
            
            metadata = header_json.get('__metadata__', {})
            if not metadata:
                return None
                
            if 'modelspec.hash.sha256' in metadata:
                return metadata['modelspec.hash.sha256']
            if 'modelspec.hash.blake3' in metadata:
                return metadata['modelspec.hash.blake3']
                
    except Exception:
        pass
    return None


@lru_cache(maxsize=4096)
def _extract_safetensors_hash_cached(file_path, signature):
    return _read_safetensors_hash(file_path)


def _extract_safetensors_hash(file_path):
    normalized_path = os.path.realpath(file_path)
    return _extract_safetensors_hash_cached(normalized_path, _file_signature(normalized_path))


def _select_info_file(data, file_path):
    """Select the Civitai file entry that actually describes ``file_path``.

    A model version may contain a checkpoint, text encoder, and VAE in the same
    ``files`` array.  Taking the first SHA256 silently assigns the dependency's
    hash to every local sidecar copied from that version.  Physical byte size is
    the strongest cheap discriminator available here and remains valid after a
    local rename.  Filenames are intentionally excluded: local renames are the
    reason provenance recovery exists and cannot be identity evidence.
    """
    entries = []
    for file_info in data.get("files", []):
        if not isinstance(file_info, dict):
            continue
        hashes = file_info.get("hashes", {})
        sha256 = hashes.get("SHA256") if isinstance(hashes, dict) else None
        if not sha256:
            continue

        size_bytes = None
        try:
            if file_info.get("sizeKB") is not None:
                size_bytes = int(round(float(file_info["sizeKB"]) * 1024))
        except (TypeError, ValueError, OverflowError):
            pass
        entries.append((file_info, str(sha256), size_bytes))

    if not entries:
        return None

    try:
        physical_size = os.path.getsize(file_path)
    except OSError:
        physical_size = None

    if physical_size is not None:
        size_matches = [entry for entry in entries if entry[2] == physical_size]
        if len(size_matches) == 1:
            return size_matches[0][0]
        if len(size_matches) > 1:
            return None

    # Offline-generated metadata commonly contains one injected hash without
    # Civitai size/name data.  It is safe only when there is a single candidate.
    if len(entries) == 1:
        return entries[0][0]
    return None


def _select_info_hash(data, file_path):
    selected = _select_info_file(data, file_path)
    if not selected:
        return ""
    hashes = selected.get("hashes", {})
    return str(hashes.get("SHA256", "")) if isinstance(hashes, dict) else ""

def _read_metadata(file_path):
    base_path = os.path.splitext(file_path)[0]
    metadata = {
        "name": os.path.basename(base_path),
        "description": "",
        "notes": "",
        "trainedWords": [],
        "baseModel": "",
        "civitai_url": "",
        "hash": "",
        "custom_name": "",
        "custom_notes": ""
    }
    
    info_files = [f"{base_path}.info", f"{base_path}.civitai.info"]
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
                    
                    
                    selected_file = _select_info_file(data, file_path)
                    hash_val = ""
                    if selected_file:
                        hashes = selected_file.get("hashes", {})
                        if isinstance(hashes, dict):
                            hash_val = str(hashes.get("SHA256", ""))
                    
                    if name: metadata["name"] = name
                    if description: metadata["description"] = description
                    if notes: metadata["notes"] = notes
                    if trained_words: metadata["trainedWords"] = trained_words
                    if base_model: metadata["baseModel"] = base_model
                    if civitai_url: metadata["civitai_url"] = civitai_url
                    if hash_val: metadata["hash"] = hash_val
                    if "anomalous_custom_name" in data and data["anomalous_custom_name"]: metadata["custom_name"] = data["anomalous_custom_name"]
                    if "anomalous_custom_notes" in data and data["anomalous_custom_notes"]: metadata["custom_notes"] = data["anomalous_custom_notes"]
            except Exception:
                pass
    
    # Fallback: if no hash found from .info files, try extracting from safetensors header directly
    if not metadata["hash"] and file_path.endswith('.safetensors'):
        header_hash = _extract_safetensors_hash(file_path)
        if header_hash:
            metadata["hash"] = header_hash
                
    return metadata


def _file_signature(file_path):
    try:
        stat = os.stat(file_path)
        return (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    except OSError:
        return None


def _metadata_signature(file_path):
    base_path = os.path.splitext(file_path)[0]
    return (
        _file_signature(file_path),
        _file_signature(f"{base_path}.info"),
        _file_signature(f"{base_path}.civitai.info"),
    )


@lru_cache(maxsize=4096)
def _get_metadata_cached(file_path, signature):
    # ``signature`` is deliberately unused by the parser itself; it is part of
    # the cache key and changes whenever the model or either metadata sidecar
    # changes. The cache is bounded so removed/renamed models cannot grow it
    # without limit.
    return _read_metadata(file_path)


def get_metadata(file_path):
    normalized_path = os.path.realpath(file_path)
    signature = _metadata_signature(normalized_path)
    # Metadata contains mutable lists. Never expose the cached object directly.
    return copy.deepcopy(_get_metadata_cached(normalized_path, signature))


def clear_metadata_cache():
    _get_metadata_cached.cache_clear()
    _extract_safetensors_hash_cached.cache_clear()


def get_metadata_cache_info():
    return _get_metadata_cached.cache_info()


