"""What a model file's header says (model_kind.inspect_file: kind, base model, format), kept on
disk so each file version is read once, also across restarts. With many models, or models on a
network drive (a NAS, a cloud server's model disk), reading every header again each time the
scan page or a models folder opens takes minutes; the header only changes with the file.

Kept in user/anomalous/model_heads.json by the file's real path, with its size and time: a
changed file is read again. At most MAX_ENTRIES files, the longest unused dropped first, and
written a few seconds after the last change (one write for a whole folder). Only this plugin
reads it; it is a cache, not data to back up. It is kept on disk once the plugin's routes are
set up (keep_on_disk); before that (tests, tools) it lives in memory only."""

import os
import threading
import time

from .activity_log import log_path
from .path_utils import atomic_write_json

try:
    from ..model_identity import read_json
    from ..model_kind import inspect_file
except ImportError:  # loaded outside the package (tests)
    from model_identity import read_json
    from model_kind import inspect_file

MAX_ENTRIES = 50000  # about 6 MB on disk; a library has far fewer models
MAX_BYTES = 64 * 1024 * 1024  # a cache file larger than this is not read (nor written)
SAVE_AFTER_S = 5
FIELDS = ("kind", "base", "sure", "format")

_lock = threading.Lock()
_heads = None  # {real path: [size, mtime_ns, last used (days), kind, base, sure, format]}
_timer = None
_on_disk = False


def keep_on_disk():
    """From now on the cache is read from and written to cache_path() (the plugin's start)."""
    global _on_disk
    _on_disk = True


def cache_path():
    return os.path.join(os.path.dirname(log_path()), "model_heads.json")


def _load():
    global _heads
    if _heads is None:
        try:
            data = read_json(cache_path()) if _on_disk and os.path.getsize(cache_path()) <= MAX_BYTES else None
        except OSError:
            data = None
        _heads = {key: value for key, value in (data or {}).items()
                  if isinstance(key, str) and isinstance(value, list) and len(value) == 3 + len(FIELDS)}
    return _heads


def save():
    """Writes the cache now (also what the timer does)."""
    global _timer
    with _lock:
        _timer = None
        heads = _load()
        if len(heads) > MAX_ENTRIES:
            for key in sorted(heads, key=lambda name: heads[name][2])[:len(heads) - MAX_ENTRIES]:
                del heads[key]
        snapshot = dict(heads)
    try:
        atomic_write_json(cache_path(), snapshot, max_bytes=MAX_BYTES)
    except (OSError, ValueError) as error:
        print(f"[Anomalous Browser] Model header cache not saved: {error}")


def _save_soon():
    global _timer
    if _on_disk and _timer is None:
        _timer = threading.Timer(SAVE_AFTER_S, save)
        _timer.daemon = True
        _timer.start()


def inspect(path):
    """model_kind.inspect_file(path), from the cache while the file is unchanged."""
    try:
        stat = os.stat(path)
    except OSError:
        return inspect_file(path)
    real, today = os.path.realpath(path), int(time.time() // 86400)
    with _lock:
        known = _load().get(real)
        if known and known[0] == stat.st_size and known[1] == stat.st_mtime_ns:
            if known[2] != today:
                known[2] = today
                _save_soon()
            return dict(zip(FIELDS, known[3:]))
    found = inspect_file(path)
    with _lock:
        _load()[real] = [stat.st_size, stat.st_mtime_ns, today, *(found.get(field) for field in FIELDS)]
        _save_soon()
    return found
