"""Filesystem containment and atomic JSON helpers."""

import json
import os
import tempfile

import folder_paths


def resolve_within(base_dir, *parts):
    """Resolve a path and require it to stay inside base_dir, including through symlinks."""
    base_real = os.path.realpath(base_dir)
    candidate = os.path.realpath(os.path.join(base_real, *parts))
    try:
        if os.path.commonpath([base_real, candidate]) != base_real:
            raise ValueError("Path escapes the configured directory")
    except ValueError:
        raise ValueError("Path escapes the configured directory")
    return candidate


def get_folder_root(folder_type, path_idx=0):
    paths = folder_paths.get_folder_paths(folder_type)
    if not paths or not isinstance(path_idx, int) or path_idx < 0 or path_idx >= len(paths):
        raise ValueError("Invalid folder path")
    return os.path.realpath(paths[path_idx])


def resolve_folder_subdir(folder_type, path_idx=0, subfolder='/'):
    base_dir = get_folder_root(folder_type, path_idx)
    relative = "" if subfolder in (None, "", "/") else str(subfolder).strip("/\\")
    return base_dir, resolve_within(base_dir, relative)


def require_filename(filename):
    if not isinstance(filename, str) or not filename or os.path.basename(filename) != filename:
        raise ValueError("Invalid filename")
    return filename


def atomic_write_json(path, value, max_bytes=12 * 1024 * 1024):
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > max_bytes:
        raise ValueError("JSON record is too large")
    fd, temporary = tempfile.mkstemp(prefix=".write-", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)
