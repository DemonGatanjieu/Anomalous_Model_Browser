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

def _extract_safetensors_hash(file_path):
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
                
            for k, v in metadata.items():
                if ('hash' in k.lower() or 'civitai' in k.lower()) and isinstance(v, str):
                    if len(v) == 64 and all(c in '0123456789abcdefABCDEF' for c in v):
                        return v
    except Exception:
        pass
    return None

def get_metadata(file_path):
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
                    
                    
                    hash_val = ""
                    for file_info in data.get("files", []):
                        if isinstance(file_info, dict):
                            hashes = file_info.get("hashes", {})
                            if isinstance(hashes, dict) and "SHA256" in hashes:
                                hash_val = hashes["SHA256"]
                                break
                    
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


