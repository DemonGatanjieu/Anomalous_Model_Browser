"""File SHA-256 evidence shared by the standalone scanner and API."""

import os
import re


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
