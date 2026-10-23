"""What happened outside Anomalous while an AI works on a task, as steps of kind "outside" in the
AI workbench. Anomalous sees only the calls made to it: an AI app may also run commands and
scripts of its own, and one that edits pictures that way loses their workflow and the user's
earlier result. Two ways to see it:

check() looks, when the AI calls Anomalous (never in the background), at what changed since its
previous call: pictures in ComfyUI's output folder no ComfyUI run saved, and pictures in the
output or input folder rewritten in place (changed a while after they were made). Only the top of
each folder, by the files' own times (made, changed), at most MAX_ENTRIES entries. While ComfyUI
runs a prompt, new pictures wait until it ends (its history names them then). What it finds is
a step and goes to the AI with its next answer (tell), which says it may well be the user's own
doing. Without a creation time (Linux), output pictures are "new or changed" and the input
folder is not looked at (an upload looks the same).

log() is the AI's own word: what it ran or changed outside Anomalous, why, and which files.
"""

import os
import threading
import time
import uuid
from collections import OrderedDict

import folder_paths

from . import ai_tasks
from .mcp_tools import tool_text

PICTURES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".mp4", ".webm", ".mov"}
MAX_ENTRIES = 20000  # of a folder's top looked at in one check
MAX_FOUND = 12  # files named in one step
REWRITE_SECONDS = 60  # changed this long after it was made: rewritten, not just written
HISTORY_ITEMS = 300  # ComfyUI's latest runs whose saved pictures are no news
MAX_WATCHED = 16  # tasks whose last check is kept
MAX_TEXT, MAX_FILES, MAX_FILE = 300, 20, 200

_lock = threading.Lock()
_watched = OrderedDict()  # task id -> {"since": time of the last full check, "told": {(folder, name, changed)}}


def _queue():
    from server import PromptServer
    return PromptServer.instance.prompt_queue


def _busy():
    """Whether ComfyUI runs a prompt now (its pictures are in no history yet)."""
    try:
        running, _pending = _queue().get_current_queue_volatile()
    except Exception:  # noqa: BLE001 - no server (tests) or an older queue: nothing runs that we know of
        return False
    return bool(running)


def _saved_by_runs():
    """Names of the pictures ComfyUI's latest runs saved at the top of the output folder."""
    try:
        history = _queue().get_history(max_items=HISTORY_ITEMS, map_function=lambda record: record.get("outputs") or {})
    except Exception:  # noqa: BLE001 - no server (tests)
        return set()
    names = set()
    for outputs in history.values():
        for output in outputs.values() if isinstance(outputs, dict) else ():
            for items in output.values() if isinstance(output, dict) else ():
                for item in items if isinstance(items, list) else ():
                    if isinstance(item, dict) and item.get("type") == "output" and not item.get("subfolder") and item.get("filename"):
                        names.add(item["filename"])
    return names


def _times(entry):
    """(made, changed) of a folder entry; made is None where the system keeps no creation time."""
    stat = entry.stat()
    return getattr(stat, "st_birthtime", None), stat.st_mtime


def _changes(folder, root, since):
    """[(name, change, when)] of the pictures at the top of `root` changed after `since`:
    "rewritten", "new" or (no creation time) "changed"."""
    found = []
    try:
        with os.scandir(root) as entries:
            for at, entry in enumerate(entries):
                if at >= MAX_ENTRIES:
                    break
                if os.path.splitext(entry.name)[1].lower() not in PICTURES or not entry.is_file(follow_symlinks=False):
                    continue
                made, changed = _times(entry)
                if changed <= since and (made is None or made <= since):
                    continue
                if made is None:
                    found.append((entry.name, "changed", changed))
                elif changed - made > REWRITE_SECONDS:
                    found.append((entry.name, "rewritten", changed))
                elif made > since:
                    found.append((entry.name, "new", changed))
    except OSError:
        return []
    return [item for item in found if folder == "output" or item[1] == "rewritten"]


def check(task_id, now=None):
    """What changed outside Anomalous since the last check of `task_id`, as a step of the task
    (also returned), or None. The first check of a task only starts the watch."""
    if not task_id:
        return None
    now = time.time() if now is None else now
    with _lock:
        watch = _watched.get(task_id)
        if watch is None:
            _watched[task_id] = {"since": now, "told": set()}
            while len(_watched) > MAX_WATCHED:
                _watched.popitem(last=False)
            return None
        _watched.move_to_end(task_id)
        busy = _busy()
        saved = set() if busy else _saved_by_runs()
        files = []
        for folder, root in (("output", folder_paths.get_output_directory()), ("input", folder_paths.get_input_directory())):
            for name, change, when in _changes(folder, root, watch["since"]):
                if busy and change != "rewritten":
                    continue  # maybe the running prompt's: judged once it ends
                if change != "rewritten" and name in saved:
                    continue
                if (folder, name, when) not in watch["told"]:
                    watch["told"].add((folder, name, when))
                    files.append({"folder": folder, "name": name, "change": change})
        if not busy:
            # A file's change time can be a second or two after the clock read (Windows): kept as told
            # until it is older than the next check's start.
            watch.update(since=now, told={key for key in watch["told"] if key[2] > now})
    if not files:
        return None
    step = {"id": uuid.uuid4().hex[:10], "at": now, "ms": 0, "tool": "outside_files", "kind": "outside", "ok": True,
            "state": "done", "summary": "outside_files", "files": files[:MAX_FOUND], "more": max(0, len(files) - MAX_FOUND),
            "results": []}
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        if not task:
            return None
        ai_tasks._add_step(task, step)
        ai_tasks._save(task)
    ai_tasks._notify(task_id)
    return step


def tell(result, step):
    """Puts what check() found into the AI's tool result."""
    if not step or not isinstance(result, dict):
        return result
    files = [f"{item['folder']}/{item['name']} ({item['change']})" for item in step["files"]]
    note = ("Anomalous saw pictures change outside its tools since your previous call; it shows them to the user. "
            "It may be the user's own doing. If it was yours: never edit, crop, paint or overwrite pictures with code "
            "of your own (that loses their workflow and the user's earlier result); change a picture by running a "
            "ComfyUI workflow, look at one with zoom_image, and say what you ran outside Anomalous with log_outside.")
    if result.get("isError"):
        result["content"] = list(result.get("content") or []) + [{"type": "text", "text": f"{note} Files: {', '.join(files)}"}]
        return result
    data = result.get("structuredContent")
    data = dict(data) if isinstance(data, dict) else {}
    data["outside_changes"], data["outside_note"] = files, note
    result["structuredContent"] = data
    content = list(result.get("content") or [])
    text = {"type": "text", "text": tool_text(data)}
    if content and isinstance(content[0], dict) and content[0].get("type") == "text":
        content[0] = text
    else:
        content.insert(0, text)
    result["content"] = content
    return result


def _line(value, limit, what):
    value = str(value or "").strip()
    if len(value) > limit:
        raise ValueError(f"{what} is longer than {limit} characters.")
    return value


def log(client, what, why="", files=None, now=None, session="", task_id=None):
    """The AI's word on what it did outside Anomalous, as a step of its task. Returns the step."""
    what = _line(what, MAX_TEXT, "what")
    if not what:
        raise ValueError("what is empty: the command, script or change you made outside Anomalous.")
    if files is not None and not isinstance(files, list):
        raise ValueError("files is a list of the files you read, wrote or changed.")
    named = [_line(item, MAX_FILE, "a file") for item in (files or [])[:MAX_FILES] if str(item or "").strip()]
    now = time.time() if now is None else now
    step = {"id": uuid.uuid4().hex[:10], "at": now, "ms": 0, "tool": "log_outside", "kind": "outside", "ok": True,
            "state": "done", "summary": f"log_outside: {what[:80]}", "what": what, "why": _line(why, MAX_TEXT, "why"),
            "files": named, "results": []}
    with ai_tasks._lock:
        task = ai_tasks.current_task(client, now, session=session, task_id=task_id)
        ai_tasks._add_step(task, step)
        ai_tasks._save(task)
    ai_tasks._notify(task["id"])
    return step
