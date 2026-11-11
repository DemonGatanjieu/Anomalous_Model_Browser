"""What a private task's AI was sent: every tool call as it came in (its arguments, tokens and
all) and the text of the answer as it left, after ai_privacy.guard took out what the task keeps.
Kept beside the task (user/anomalous/ai_sent/<task>/calls.jsonl, gone with it) so the user can
read for themselves what went out and look for a word in it (the task's menu, "What the AI was
sent", GET /anomalous/ai_tasks/{id}/sent). A line per call, the newest MAX_CALLS of them; a long
text is cut at MAX_TEXT with how much was cut. Pictures are counted, not kept: a private task
sends none."""

import json
import os
import threading
import time

from . import ai_tasks

MAX_CALLS = 300
SPARE = 50  # lines over MAX_CALLS before the file is cut back to it
MAX_TEXT = 20_000
MAX_ARGUMENTS = 4_000
_lock = threading.Lock()
_counts = {}  # task id -> lines in its file, while this ComfyUI runs


def _path(task_id):
    return os.path.join(ai_tasks.marks_dir(task_id, "ai_sent"), "calls.jsonl")


def _cut(text, limit):
    return text if len(text) <= limit else f"{text[:limit]}… (+{len(text) - limit})"


def _lines(task_id):
    try:
        with open(_path(task_id), encoding="utf-8") as source:
            return source.readlines()
    except OSError:
        return []


def keep(task_id, tool, arguments, result):
    """One call of private task `task_id` as its AI had it: what it wrote and what it was answered."""
    content = [item for item in (result.get("content") or [] if isinstance(result, dict) else []) if isinstance(item, dict)]
    texts = [str(item.get("text") or "") for item in content if item.get("type") == "text"]
    line = json.dumps({"at": time.time(), "tool": tool, "arguments": _cut(json.dumps(arguments, ensure_ascii=False), MAX_ARGUMENTS),
                       "text": _cut("\n".join(texts), MAX_TEXT), "pictures": sum(1 for item in content if item.get("type") == "image"),
                       "error": bool(isinstance(result, dict) and result.get("isError"))}, ensure_ascii=False) + "\n"
    path = _path(task_id)
    with _lock:
        if task_id not in _counts:
            _counts[task_id] = len(_lines(task_id))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as out:
            out.write(line)
        _counts[task_id] += 1
        if _counts[task_id] > MAX_CALLS + SPARE:
            kept = _lines(task_id)[-MAX_CALLS:]
            with open(path + ".part", "w", encoding="utf-8") as out:
                out.writelines(kept)
            os.replace(path + ".part", path)
            _counts[task_id] = MAX_CALLS


def calls(task_id):
    """The calls kept for `task_id`, oldest first; [] when it has none."""
    found = []
    for line in _lines(task_id)[-MAX_CALLS:]:
        try:
            found.append(json.loads(line))
        except ValueError:
            continue
    return found
