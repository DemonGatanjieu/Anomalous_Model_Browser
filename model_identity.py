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

try:
    from .model_kind import MAX_HEADER, inspect_file
except ImportError:  # the standalone scanner imports this file on its own
    from model_kind import MAX_HEADER, inspect_file


USER_INFO_SUFFIX = ".anomalous.json"


def read_json(path):
    """A JSON object from ``path``; None when missing, unreadable or not an object."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


SCAN_CHOICES = ("skip", "scan")


def scan_choice(base):
    """What the user chose about scanning a model, kept in <model>.anomalous.json ("scan"):
    "skip" (a scan of its folder leaves it out; picking it by hand still scans it), "scan"
    (asked once, scanned like any other) or "" (not chosen). ``base``: the path without extension."""
    choice = (read_json(base + USER_INFO_SUFFIX) or {}).get("scan")
    return choice if choice in SCAN_CHOICES else ""


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
# not be reached; the scan was offline; the file's header is damaged (safetensors_damage), so
# neither Civitai nor the header can tell what it is. Scans before this was recorded leave it empty.
UNMATCHED_REASONS = ("not_found", "network", "offline", "damaged")


def safetensors_damage(file_path):
    """What is wrong with a .safetensors file's header, or "" when it reads whole: "short" (no
    room for the header's length), "header_size" (longer than the file), "header" (not the JSON
    of a tensor list) or "truncated" (a tensor ends past the file's end: a download cut short).
    Reads only the header. A file that cannot be opened now says nothing ("")."""
    try:
        size = os.path.getsize(file_path)
        with open(file_path, "rb") as handle:
            head = handle.read(8)
            if len(head) < 8:
                return "short"
            header_size = struct.unpack("<Q", head)[0]
            if not header_size or header_size > MAX_HEADER or 8 + header_size > size:
                return "header_size"
            header = json.loads(handle.read(header_size).decode("utf-8"))
    except OSError:
        return ""
    except ValueError:  # bad UTF-8 or JSON
        return "header"
    if not isinstance(header, dict):
        return "header"
    data_size = size - 8 - header_size
    for name, tensor in header.items():
        if name == "__metadata__":
            continue
        offsets = tensor.get("data_offsets") if isinstance(tensor, dict) else None
        if not (isinstance(offsets, list) and len(offsets) == 2 and all(isinstance(value, int) for value in offsets)
                and 0 <= offsets[0] <= offsets[1]):
            return "header"
        if offsets[1] > data_size:
            return "truncated"
    return ""


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
    """The base model a .safetensors / .gguf header tells (model_kind.py), else 'Unknown'."""
    return inspect_file(file_path).get("base") or "Unknown"
