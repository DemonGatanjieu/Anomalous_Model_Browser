"""File SHA-256 evidence and the model sidecars, shared by the standalone scanner and API.

A model's information comes in three layers, the user's first:
- <model>.anomalous.json  what the user set in the model editor (only the editor writes it);
- <model>.info            what a scan found: Civitai's record, or (id -1) what the file
                          itself tells; <model>.civitai.info is the same from other tools;
- the model file itself.
"""

import json
import os
import re


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
