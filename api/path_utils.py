"""Filesystem containment and atomic JSON helpers."""

import json
import os
import tempfile

import folder_paths

from .recipe_constants import MODEL_FILE_SUFFIXES


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


def _model_roots():
    for folder_type in getattr(folder_paths, "folder_names_and_paths", {}):
        try:
            paths = folder_paths.get_folder_paths(folder_type)
        except Exception:
            continue
        for path_index, base_dir in enumerate(paths or []):
            if os.path.isdir(base_dir):
                yield folder_type, path_index, os.path.realpath(base_dir)


def model_file_within(directory, filename):
    """The model file `filename` (a bare name) in `directory`, which was resolved inside its
    models folder already, as named: a model that is a link stays the link (on a cloud server
    the models folder links into a shared, read-only model disk). Its covers and info are the
    ones beside the link, edits are written there and a delete moves the link; only the folder
    part must stay inside the models folder, and the name cannot leave it."""
    return os.path.join(directory, require_filename(filename))


def model_reference_within(base_dir, relative):
    """model_file_within for a path relative to the models folder `base_dir` (subfolders and
    a file name): the subfolders must stay inside it, through links too."""
    head, name = os.path.split(relative)
    return model_file_within(resolve_within(base_dir, head), name)


def _resolve_exact_model_reference(saved_value):
    """Resolve one saved model value without recursive scanning or hashing."""
    if not isinstance(saved_value, str) or not saved_value.strip():
        return None
    relative_value = saved_value.replace("/", os.sep)
    for folder_type, path_index, base_dir in _model_roots():
        try:
            candidate = model_reference_within(base_dir, relative_value)
        except ValueError:
            continue
        if not os.path.isfile(candidate) or not candidate.lower().endswith(MODEL_FILE_SUFFIXES):
            continue
        return {
            "path": candidate,
            "folder_type": folder_type,
            "path_index": path_index,
        }
    return None


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
    if not isinstance(filename, str) or filename in ("", ".", "..") or os.path.basename(filename) != filename:
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
