"""Match recommended and required models against ComfyUI's files by byte size and SHA-256.

Keeps file-identity resolution for ready-made blocks and example workflows in one place:
exact size fast-reject plus verified full-file SHA-256 first (reusing metadata sidecars,
known_hashes, and a bounded memory cache), before any open filename or header fallback.
"""

import os
import threading

try:
    from .. import known_hashes
    from ..model_identity import file_sha256, normalise_sha256
except ImportError:  # loaded outside the package (tests)
    import known_hashes
    from model_identity import file_sha256, normalise_sha256
from . import model_heads
from .metadata import get_metadata

_CACHE_LIMIT = 4096
_lock = threading.Lock()
_hashes = {}


def clear_cache():
    """Drop cached file hashes (used by tests)."""
    with _lock:
        _hashes.clear()


def _remember(key, stamp, digest):
    with _lock:
        if len(_hashes) >= _CACHE_LIMIT:
            _hashes.clear()
        _hashes[key] = (*stamp, digest)


def known_hash(path, compute=False):
    """Verified lowercase SHA-256 of `path`, using caches before optional full-file hashing."""
    try:
        stat = os.stat(path)
    except OSError:
        return ""
    key = os.path.normcase(os.path.realpath(path))
    stamp = (stat.st_size, stat.st_mtime_ns)
    with _lock:
        hit = _hashes.get(key)
    if hit and hit[:2] == stamp:
        return hit[2]

    try:
        digest = normalise_sha256(get_metadata(path).get("hash"))
    except Exception:  # noqa: BLE001 - sidecar errors must not block matching
        digest = ""
    if not digest:
        digest = normalise_sha256(known_hashes.known(path))
    if not digest and compute:
        try:
            digest = normalise_sha256(file_sha256(path))
        except OSError:
            digest = ""
    if digest:
        _remember(key, stamp, digest)
    return digest


def full_path(folder, choice):
    """Existing local file path for a ComfyUI dropdown `choice` under `folder`, or None."""
    if not folder or not isinstance(choice, str) or not choice.strip():
        return None
    try:
        import folder_paths
        path = folder_paths.get_full_path(folder, choice)
        if not path and folder == "ultralytics_bbox":
            clean = choice.replace("\\", "/")
            if clean.startswith("bbox/"):
                path = folder_paths.get_full_path(folder, clean[5:])
    except Exception:  # noqa: BLE001 - no ComfyUI (tests) or unknown folder type
        return None
    return path if path and os.path.isfile(path) else None


def matches_spec(path, spec):
    """Whether physical file `path` matches `spec`'s exact byte size and SHA-256."""
    if not isinstance(spec, dict):
        return False
    expected_sha = normalise_sha256(spec.get("sha256"))
    expected_size = spec.get("size")
    if not expected_sha or not isinstance(expected_size, int) or expected_size <= 0:
        return False
    try:
        if os.path.getsize(path) != expected_size:
            return False
    except OSError:
        return False
    return known_hash(path, compute=True) == expected_sha


def match_spec_in_choices(choices, folder, specs):
    """First `(choice, spec)` whose file under `folder` matches a spec in `specs`, else `(None, None)`."""
    spec_list = [specs] if isinstance(specs, dict) else list(specs or ())
    if not spec_list or not choices:
        return None, None
    resolved = [(choice, path) for choice in choices if (path := full_path(folder, choice))]
    for spec in spec_list:
        for choice, path in resolved:
            if matches_spec(path, spec):
                return choice, spec
    return None, None


def match_in_choices(choices, folder, specs):
    """First ComfyUI dropdown choice matching `specs` by exact size + SHA-256, else None."""
    return match_spec_in_choices(choices, folder, specs)[0]


def find_installed(spec):
    """Whether `spec` from block_models.json is installed in its ComfyUI folder."""
    folder = spec.get("folder") or ""
    try:
        import folder_paths
        names = folder_paths.get_filename_list(folder)
    except Exception:  # noqa: BLE001 - no ComfyUI (tests) or unknown folder type
        return False
    if match_in_choices(names, folder, (spec,)):
        return True
    target_name = str(spec.get("file") or "").lower()
    return any(
        os.path.basename(name.replace("\\", "/")).lower() == target_name and full_path(folder, name) is None
        for name in names
    )


def is_non_lllite(folder, choice):
    """True when `choice` resolves to a safetensors file whose header is confirmed non-LLLite."""
    path = full_path(folder, choice)
    if not path:
        return False
    try:
        info = model_heads.inspect(path)
    except Exception:  # noqa: BLE001 - unreadable header does not reject fallback
        return False
    return bool(info.get("format") == "safetensors" and info.get("kind") and info.get("form") != "lllite")
