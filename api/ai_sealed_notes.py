"""Per-token brief notes the user writes for the AI on a private task's hidden items (api_sealed.py).

In the workbench's Privacy Overview (web/modules/ui_ai_privacy_overview.js), each [P*], [img*] or
[M*] token has an optional single-line note so the user can tell the AI what that hidden thing is
for ("主正面提示词，保持双人抱姿") without exposing the sealed text itself. Notes travel cleanly:
when present before begin_task / get_situation they arrive with the task, and mid-task edits mark
`sealed_notes_dirty` so ai_panels.py delivers them once as user_messages (kind sealed_notes) — all
passing through ai_privacy.guard so accidental copies of sealed words are masked before leaving.
"""

import re
import time

from . import ai_tasks

MAX_NOTE = 160
MAX_NOTES = 120
_TOKEN = re.compile(r"^\[(?:P|img|M)\d+\]$")


def _clean_text(value):
    return " ".join(str(value or "").split())[:MAX_NOTE]


def notes_of(task):
    """Sanitized `{token: note}` mapping from `task`, keeping only existing sealed tokens with text."""
    if not isinstance(task, dict):
        return {}
    sealed = task.get("sealed") or {}
    raw = task.get("sealed_notes") or {}
    if not isinstance(sealed, dict) or not isinstance(raw, dict):
        return {}
    out = {}
    for token, text in raw.items():
        key = str(token or "").strip()
        cleaned = _clean_text(text)
        if _TOKEN.match(key) and key in sealed and cleaned:
            out[key] = cleaned
    return out


def set_notes(task_id, raw_notes):
    """Merge-update `{token: text}` notes on `task_id` (empty text clears a token). Returns saved dict."""
    if not isinstance(raw_notes, dict):
        raise ValueError("Expected {notes: {token: text}}")
    changed = False
    with ai_tasks._lock:
        tasks = ai_tasks._load()
        task = tasks.get(task_id)
        if not task:
            raise LookupError("not_found")
        sealed = task.get("sealed") or {}
        if not isinstance(sealed, dict):
            sealed = {}
        current = notes_of(task)
        old = dict(current)
        for token, text in raw_notes.items():
            key = str(token or "").strip()
            if not _TOKEN.match(key):
                raise ValueError(f"Invalid sealed token: {key}")
            if key not in sealed:
                raise ValueError(f"Unknown sealed token: {key}")
            cleaned = _clean_text(text)
            if cleaned:
                current[key] = cleaned
            else:
                current.pop(key, None)
        if len(current) > MAX_NOTES:
            raise ValueError(f"At most {MAX_NOTES} notes per task")
        if current != old:
            if current:
                task["sealed_notes"] = current
            else:
                task.pop("sealed_notes", None)
            task["sealed_notes_dirty"] = True
            task["updated"] = time.time()
            ai_tasks._save(task)
            changed = True
    if changed:
        ai_tasks._notify(task_id)
    return dict(current)


def mark_seen(task_id):
    """Return current notes for `task_id` and clear any pending `sealed_notes_dirty` flag."""
    with ai_tasks._lock:
        tasks = ai_tasks._load()
        task = tasks.get(task_id)
        if not task:
            return {}
        notes = notes_of(task)
        if task.pop("sealed_notes_dirty", None) is not None:
            ai_tasks._save(task)
        return notes


def take_pending(task):
    """Called under `ai_tasks._lock` (ai_panels._collect): pop dirty flag and return message dict or None."""
    if not isinstance(task, dict) or not task.get("sealed_notes_dirty"):
        return None
    task.pop("sealed_notes_dirty", None)
    notes = notes_of(task)
    now = time.time()
    if notes:
        pairs = "; ".join(f"{tok}: {val}" for tok, val in notes.items())
        text = f"The user added or updated notes on hidden items (meaning of each token; sealed originals stay hidden): {pairs}"
    else:
        text = "The user cleared their notes on hidden items."
    return {
        "id": f"notes_{int(now * 1000)}",
        "task": task["id"],
        "kind": "sealed_notes",
        "at": now,
        "notes": notes,
        "text": text,
    }
