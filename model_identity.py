"""File SHA-256 evidence, the base model a safetensors header tells, and the model
sidecars, shared by the standalone scanner and API.

A model's information comes in three layers, the user's first:
- <model>.anomalous.json  what the user set in the model editor (only the editor writes it);
- <model>.info            what a scan found: Civitai's record, or (id -1) what the file
                          itself tells; <model>.civitai.info is the same from other tools;
- the model file itself.
"""

import hashlib
import json
import os
import re
import struct


USER_INFO_SUFFIX = ".anomalous.json"


def read_json(path):
    """A JSON object from ``path``; None when missing, unreadable or not an object."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def scan_info_path(base):
    """The sidecar holding a scan result: <model>.info, else another tool's <model>.civitai.info.
    A .civitai.info with only edits made in older versions (no Civitai ids) does not count,
    so editing a model's name never makes it look scanned. ``base``: the path without extension."""
    if os.path.exists(base + ".info"):
        return base + ".info"
    data = read_json(base + ".civitai.info")
    if data is not None and ("id" in data or "modelId" in data):
        return base + ".civitai.info"
    return None


def sidecar_info(base):
    """The scan result (see scan_info_path) as a dict; None when there is none or it is unreadable."""
    path = scan_info_path(base)
    return read_json(path) if path else None


def is_unmatched(info):
    """Info the scanner wrote from the file alone: Civitai had no match, or was not reachable then."""
    return isinstance(info, dict) and info.get("id") == -1


# Why an unmatched model has no Civitai record: Civitai does not know the file; Civitai could
# not be reached; the scan was offline. Scans before this was recorded leave it empty.
UNMATCHED_REASONS = ("not_found", "network", "offline")


def unmatched_reason(info):
    """One of UNMATCHED_REASONS for an unmatched model's info, else ""."""
    reason = info.get("anomalous_unmatched_reason") if is_unmatched(info) else ""
    return reason if reason in UNMATCHED_REASONS else ""


def normalise_sha256(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", value.strip()):
        return ""
    return value.strip().lower()


def computed_file_identity(path, digest):
    digest = normalise_sha256(digest)
    if not digest:
        raise ValueError("Invalid file SHA-256")
    stat = os.stat(path)
    return {
        "algorithm": "sha256", "scope": "file", "value": digest,
        "size": stat.st_size, "mtime_ns": stat.st_mtime_ns, "source": "computed",
    }


def sidecar_file_hash(data, path, selected_file):
    """Keep cached file evidence separate from unverified embedded model hashes."""
    identity = data.get("anomalous_file_identity")
    if identity is not None:
        if not isinstance(identity, dict) or identity.get("algorithm") != "sha256" or identity.get("scope") != "file":
            return "", ""
        stat = os.stat(path)
        if identity.get("size") != stat.st_size or identity.get("mtime_ns") != stat.st_mtime_ns:
            return "", ""
        return normalise_sha256(identity.get("value")), "computed file SHA-256"
    # Older offline records could label a BLAKE3/tensor digest as SHA-256.
    # Keep their presentation data, but require a scan or on-demand verification.
    if data.get("id") == -1 or data.get("modelId") == -1:
        return "", ""
    hashes = selected_file.get("hashes", {}) if isinstance(selected_file, dict) else {}
    return normalise_sha256(hashes.get("SHA256")), "sidecar file SHA-256"


def file_sha256(path):
    """The complete file's SHA-256, hex."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(4096 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def infer_base_model_from_header(file_path: str) -> str:
    """从 safetensors 头文件的张量键名推断底层 Base Model (用于脱机/HuggingFace 兼容)"""
    try:
        with open(file_path, "rb") as f:
            header_size_bytes = f.read(8)
            if len(header_size_bytes) < 8: return 'Unknown'
            header_size = struct.unpack('<Q', header_size_bytes)[0]
            if header_size > 100 * 1024 * 1024: return 'Unknown'
            
            header_json = json.loads(f.read(header_size).decode('utf-8'))
            
            # 1. 尝试从 __metadata__ 提取
            metadata = header_json.get('__metadata__', {})
            arch = metadata.get('modelspec.architecture', '')
            if 'stable-diffusion-xl' in arch.lower(): return 'SDXL'
            if 'stable-diffusion-v1' in arch.lower() or 'runwayml/stable-diffusion-v1-5' in arch.lower(): return 'SD 1.5'
            if 'flux' in arch.lower(): return 'Flux.1 D'
            if 'sd3' in arch.lower(): return 'SD3'
            
            # 2. 暴力张量键名指纹匹配 (Tensor Fingerprinting)
            # 把前 500 个键拼接成字符串以提高检索效率，大部分核心键都在前面
            keys_str = " ".join(list(header_json.keys())[:500])
            
            # Flux 指纹
            if 'double_blocks.0.img_attn' in keys_str or 'img_in.weight' in keys_str: return 'Flux.1 D'
            # SD3 指纹
            if 'joint_blocks.0.x_block' in keys_str: return 'SD3'
            # SDXL 指纹 (包含两套 text encoder)
            if 'conditioner.embedders.1.model' in keys_str or 'label_emb.0.0.weight' in keys_str: return 'SDXL'
            # SD 1.5 指纹
            if 'cond_stage_model.transformer.text_model' in keys_str or 'model.diffusion_model.input_blocks.0.0.weight' in keys_str: return 'SD 1.5'
            
            return 'Unknown'
    except Exception as e:
        print(f"[-] 离线底模推断失败: {e}")
        return 'Unknown'
