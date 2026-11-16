"""SHA-256s the plugin has just read for a model file, kept for the scan that follows.

The scan (scraper.py) runs in a process of its own, so it cannot see what the server read: an
import that asked Civitai about a file (api/model_import.identify) notes the file's hash here,
the import's move carries the note to where the file went, and the scan takes it instead of
reading the whole file a second time. A note counts only while the file's size and
modification time are unchanged; the newest KEEP notes are kept. It is never the only proof:
a missing, stale or garbled note just means the scan reads the file itself.

Kept in `.known_hashes.json` beside this file (ignored by git). No imports from ComfyUI, so
the scan process and the tests load it as it is.
"""

import json
import os
import re
import threading

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".known_hashes.json")
KEEP = 64
_lock = threading.Lock()


def _key(path):
    return os.path.normcase(os.path.realpath(path))


def _read():
    try:
        with open(PATH, encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(data):
    temporary = PATH + ".tmp"
    try:
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        os.replace(temporary, PATH)
    except OSError:
        pass  # only a shortcut: the scan reads the file itself


def note(path, sha256):
    """Keep `sha256` for the file at `path` as it is now (size and modification time)."""
    digest = str(sha256 or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        return
    try:
        stat = os.stat(path)
    except OSError:
        return
    with _lock:
        data = _read()
        data.pop(_key(path), None)  # the newest last
        data[_key(path)] = [stat.st_size, stat.st_mtime_ns, digest]
        while len(data) > KEEP:
            data.pop(next(iter(data)))
        _write(data)


def known(path):
    """The noted SHA-256 of the file at `path`, or "" when there is none or the file changed."""
    entry = _read().get(_key(path))
    if not isinstance(entry, list) or len(entry) != 3:
        return ""
    try:
        stat = os.stat(path)
    except OSError:
        return ""
    size, mtime_ns, digest = entry
    if (size, mtime_ns) != (stat.st_size, stat.st_mtime_ns) or not re.fullmatch(r"[0-9a-f]{64}", str(digest)):
        return ""
    return digest


def carried(source, dest):
    """A noted file was moved or copied to `dest` (whole, checked by the mover): the note goes along."""
    entry = _read().get(_key(source))
    if isinstance(entry, list) and len(entry) == 3:
        note(dest, entry[2])
