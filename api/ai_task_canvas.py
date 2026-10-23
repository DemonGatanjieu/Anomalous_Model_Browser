"""Each task's own canvas tab, kept by Anomalous rather than left to the AI: with "new" (the
default, set in the Gates window; each task can change it) the page copies the workflow open
now into a new tab named after the task before the AI's first change, and brings that tab back
before each later change, read or run (web/modules/mcp_task_tab.js); new_workflow and
open_workflow make the tab they open the task's. The user's own tab is never changed. With
"current" the AI works on whatever tab is open, as before.

mcp_server.py marks each tool call with its task (begin_call); mcp_bridge.ask_page adds the
task's canvas to the page actions that touch the canvas (spec) and keeps the tab the page
reports (remember); tell() tells the AI once when a tab was made for it.
"""

import contextvars
import json
import os
import time
import uuid

from . import ai_tasks
from .path_utils import atomic_write_json

MODES = ("new", "current")
DEFAULT = "new"
# Page actions (web/modules/mcp_bridge.js) that work on the canvas, so on the task's tab.
TAB_ACTIONS = {"describe_canvas", "set_prompt", "set_model", "add_lora", "place_combo", "check_models", "fix_models",
               "run_workflow", "download_missing", "add_node", "connect_nodes", "set_values", "remove_nodes", "new_workflow", "open_workflow"}
_call = contextvars.ContextVar("anomalous_task_canvas", default=None)


def _path():
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "ai_canvas.json")


def default_mode():
    try:
        with open(_path(), encoding="utf-8") as source:
            mode = json.load(source).get("mode")
    except (OSError, ValueError, AttributeError):
        mode = None
    return mode if mode in MODES else DEFAULT


def set_default(mode):
    if mode not in MODES:
        raise ValueError("canvas_tab is new or current")
    atomic_write_json(_path(), {"mode": mode})
    return mode


def mode_of(task):
    mode = ((task or {}).get("canvas") or {}).get("mode")
    return mode if mode in MODES else default_mode()


def set_mode(task_id, mode):
    """The user's choice for one task. Returns the task's canvas record."""
    if mode not in MODES:
        raise ValueError("canvas is new or current")
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        if not task:
            raise ValueError("No such task")
        if (task.get("canvas") or {}).get("mode", default_mode()) != mode:
            # The user's choice: the AI hears of it, and it is one of the task's decisions (ai_decisions.py).
            now = time.time()
            ai_tasks._add_step(task, {"id": uuid.uuid4().hex[:10], "at": now, "ms": 0, "tool": "user_canvas", "kind": "user", "ok": True,
                                      "state": "done", "summary": "user_canvas", "canvas": mode, "delivered": False, "results": [],
                                      "text": "The user chose that you work " + ("in a tab of the task's own." if mode == "new" else "on the canvas they have open.")})
        task["canvas"] = {**(task.get("canvas") or {}), "mode": mode}
        ai_tasks._save(task)
        canvas = dict(task["canvas"])
    ai_tasks._notify(task_id)
    return canvas


def begin_call(task_id):
    """Marks the tool call running now as task `task_id`'s; the holder says later what the page opened."""
    holder = {"task": task_id, "opened": None}
    _call.set(holder)
    return holder


def spec(action):
    """What the page needs for page action `action` of the call running now: {mode, tab, title}, or None."""
    holder = _call.get()
    if not holder or not holder.get("task") or action not in TAB_ACTIONS:
        return None
    task = ai_tasks.get_task(holder["task"])
    if not task:
        return None
    return {"mode": mode_of(task), "tab": (task.get("canvas") or {}).get("tab"), "title": (task.get("title") or "")[:60]}


def remember(tab):
    """Keeps the tab the page made or opened for the call's task ({path, name, made?})."""
    holder = _call.get()
    if not holder or not holder.get("task") or not isinstance(tab, dict) or not isinstance(tab.get("path"), str):
        return
    kept = {"path": tab["path"][:300], "name": str(tab.get("name") or "")[:120], "at": time.time()}
    with ai_tasks._lock:
        task = ai_tasks._load().get(holder["task"])
        if not task:
            return
        task["canvas"] = {**(task.get("canvas") or {}), "tab": kept}
        ai_tasks._save(task)
    ai_tasks._notify(holder["task"])
    holder["opened"] = {**kept, "made": bool(tab.get("made"))}


def tell(result, holder):
    """Says in the tool's answer that Anomalous made the task a tab of its own (once, when it did)."""
    opened = (holder or {}).get("opened")
    if not opened or not opened["made"] or not isinstance(result, dict) or result.get("isError"):
        return result
    data = dict(result.get("structuredContent") or {})
    data["canvas_tab"] = {"name": opened["name"], "note": (
        f"Anomalous copied the user's open workflow to a new tab \"{opened['name']}\" for this task (the user's "
        "setting): your canvas changes, reads and runs go there; the user's own tab stays as it was. Do not switch "
        "tabs yourself.")}
    result["structuredContent"] = data
    content = list(result.get("content") or [])
    text = {"type": "text", "text": json.dumps(data, ensure_ascii=False)}
    if content and isinstance(content[0], dict) and content[0].get("type") == "text":
        content[0] = text
    else:
        content.insert(0, text)
    result["content"] = content
    return result
