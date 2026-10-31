"""The user's own changes in Anomalous while an AI works on a task: each activity log entry the
user makes (activity_log.py tells note_activity of every new entry) becomes a step of the task
the AI called within USER_STEP_SECONDS, and the entry names that task back. The AI is told of it
with its next call (ai_panels.attach_pending, a message of kind "change"), so it keeps the user's
change instead of working over it. The AI's own canvas changes (via mcp) are its steps already;
which actions count, and their stage, is action_catalog.USER_ACTIONS. A private task's
(ai_privacy.py) are told with what was typed sealed (ai_sealed.py): the AI hears that a prompt
changed, not what it says."""

import time
import uuid

from . import action_catalog, activity_log, ai_privacy, ai_sealed, ai_tasks

USER_STEP_SECONDS = 10 * 60


def _live_task(now):
    """The task an AI is working on now (it called within USER_STEP_SECONDS), or None."""
    live = [task for task in ai_tasks._load().values() if not task.get("ended") and not task.get("waiting")
            and now - task.get("updated", 0) < USER_STEP_SECONDS]
    return max(live, key=lambda task: task.get("updated", 0)) if live else None


def _change_text(entry, seal=lambda value: value):
    """What the user changed, in words for the AI; `seal(value)` for what was before and after."""
    if entry.get("action") == "image_delete" and entry.get("target"):
        return (f"Deleted the picture {entry['target']} (to the Recycle Bin): it is gone from the output folder, "
                "so do not use, show or hand it in again; another picture is needed for what it was for.")
    if entry.get("source") != "canvas":
        words = str(entry.get("action", "")).replace("_", " ")
        return f"{words}: {entry['target']}" if entry.get("target") else words
    lines = []
    for change in (entry.get("detail") or {}).get("changes") or []:
        if change.get("kind") == "changed":
            lines.append(f"{change.get('node')} {change.get('widget')}: {seal(change.get('before'))} -> {seal(change.get('after'))}")
        elif change.get("kind") == "opened":
            lines.append(f"opened the workflow {change.get('node')}")
        else:
            lines.append(f"{change.get('kind')} {change.get('node')}")
    return "Changed on the canvas: " + "; ".join(lines[:8])


def note_activity(entry):
    """A new activity log entry: a step of the AI's task when the user made it while the AI worked."""
    stage = action_catalog.USER_ACTIONS.get(entry.get("action"))
    if stage is None or (entry.get("detail") or {}).get("via") == "mcp":
        return None
    at = entry.get("time") or time.time()
    with ai_tasks._lock:
        task = _live_task(at)
        if not task:
            return None
        seals = ai_sealed.Seals(task["id"]) if ai_privacy.is_private(task) else None
        text = _change_text(entry, (lambda value: ai_sealed.seal_text(seals, value)) if seals else (lambda value: value))
        if seals:
            seals.save()
        step = {"id": uuid.uuid4().hex[:10], "at": at, "ms": 0, "tool": "user_activity", "kind": "user", "stage": stage,
                "ok": True, "state": "done", "summary": entry.get("action", ""),
                "text": ai_tasks._short(text, ai_tasks.MAX_NOTE), "activity": entry["id"],
                "delivered": False, "results": []}
        # Appended without moving "updated": the user's own changes do not keep the AI's task open.
        task["steps"].append(step)
        del task["steps"][:-ai_tasks.MAX_STEPS]
        ai_tasks._save(task)
    activity_log.tag(entry["id"], task["id"])
    ai_tasks._notify(task["id"])
    return step
