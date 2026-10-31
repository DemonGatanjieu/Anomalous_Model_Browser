"""Privacy mode (隐私模式): a task the user keeps private sends the AI none of its pictures. The AI still
builds and runs workflows and knows the models; it hears how many pictures came out and whether the
run went well, and the user looks at them in Anomalous. Each task has its switch (task["privacy"],
in the task's header); new tasks follow the default the user sets in the Gates window
(user/anomalous/ai_privacy.json). Turning it on or off is a step the AI is told of, and one of the
task's decisions (ai_decisions.py).

All of it happens at one place: mcp_server.py hands every tool result to guard() before it leaves,
whatever tool or later step (run pictures, the user's messages) put a picture in it. A call that
cannot be tied to a task is private while the default is on or any private task is unfinished:
when in doubt, nothing is shown. The card in the AI app (mcp_apps.py) shows no pictures either.
"""

import json
import os
import time
import uuid

from . import ai_tasks
from .path_utils import atomic_write_json

NOTE = "Privacy mode: no pictures reach you, only how many and whether they came out. The user looks at them: ask with ask_user."


def _path():
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "ai_privacy.json")


def default_on():
    """Whether new tasks are private (the Gates window); off unless the user turned it on."""
    try:
        with open(_path(), encoding="utf-8") as source:
            return json.load(source).get("default") is True
    except (OSError, ValueError, AttributeError):
        return False


def set_default(on):
    """The default for new tasks. Turned off, the tasks that were private by it stay private."""
    if not isinstance(on, bool):
        raise ValueError("privacy is true or false")
    with ai_tasks._lock:
        if not on and default_on():
            for task in ai_tasks._load().values():
                if "privacy" not in task:
                    task["privacy"] = True
                    ai_tasks._save(task)
        atomic_write_json(_path(), {"default": on})
    return on


def is_private(task):
    """The task's own choice, else the default."""
    value = (task or {}).get("privacy")
    return value if isinstance(value, bool) else default_on()


def set_private(task_id, on):
    """The user's choice for one task, told to the AI as a step of theirs. Returns it."""
    if not isinstance(on, bool):
        raise ValueError("privacy is true or false")
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        if not task:
            raise ValueError("No such task")
        if is_private(task) != on:
            ai_tasks._add_step(task, {"id": uuid.uuid4().hex[:10], "at": time.time(), "ms": 0, "tool": "user_privacy", "kind": "user",
                                      "ok": True, "state": "done", "summary": "user_privacy", "privacy": on, "delivered": False, "results": [],
                                      "text": "The user turned privacy mode on for this task. " + NOTE if on else
                                      "The user turned privacy mode off for this task: you get the pictures again."})
        task["privacy"] = on
        ai_tasks._save(task)
    ai_tasks._notify(task_id)
    return on


def applies(task_id):
    """Whether a call of task `task_id` (None: none known) is private."""
    task = ai_tasks.get_task(task_id) if task_id else None
    if task:
        return is_private(task)
    if default_on():
        return True
    with ai_tasks._lock:
        return any(item.get("privacy") is True and not item.get("ended") for item in ai_tasks._load().values())


def guard(result, private):
    """`result` as it may leave: a private call's pictures taken out, with a word on why."""
    if not private or not isinstance(result, dict):
        return result
    content = [item for item in result.get("content") or [] if not (isinstance(item, dict) and item.get("type") == "image")]
    if len(content) == len(result.get("content") or []):
        return result
    content.append({"type": "text", "text": NOTE})
    result["content"] = content
    if isinstance(result.get("structuredContent"), dict):
        result["structuredContent"] = {**result["structuredContent"], "privacy": NOTE}
    return result
