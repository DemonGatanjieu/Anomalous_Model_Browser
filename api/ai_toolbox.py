"""What the user hands the AI to work with ("给 AI 的素材", web/modules/ui_ai_toolbox.js): node
types, whole custom node packs (by folder: every node type in it), combos, workflows, saved
prompts and models picked for a task, and how strictly: prefer
(the AI is told to use them first) or only (add_node and new_workflow refuse other node types,
except ComfyUI's own built-in ones and the helpers that live only in the page). Favourites
(user/anomalous/ai_toolbox.json) are what a task has until the user picks for it. A pick is a
"user_toolbox" step the AI receives like a message (kind toolbox, ai_panels.py); begin_task
names the task's picks and get_toolbox gives them in full. The catalogue the picker shows uses
the same names the AI's tools use: node types from ComfyUI's /object_info (mcp_canvas_edit.py),
the rest from ai_toolbox_catalog.py."""

import json
import os
import threading
import time
import uuid

from . import ai_tasks
from .path_utils import atomic_write_json

KINDS = ("nodes", "packs", "combos", "workflows", "prompts", "models")
MODES = ("prefer", "only")
MAX_ITEMS = 60
MAX_NAME = 300
_lock = threading.Lock()


class ToolboxError(ValueError):
    pass


def _path():
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "ai_toolbox.json")


def clean(picks):
    """{kind: [names]} for KINDS: strings only, each kind once per name, at most MAX_ITEMS."""
    if not isinstance(picks, dict):
        raise ToolboxError("Expected {nodes, packs, combos, workflows, prompts, models}")
    out = {}
    for kind in KINDS:
        items = picks.get(kind) or []
        if not isinstance(items, list) or len(items) > MAX_ITEMS:
            raise ToolboxError(f"{kind}: a list of up to {MAX_ITEMS} names")
        names = []
        for item in items:
            if not isinstance(item, str) or not item.strip() or len(item) > MAX_NAME:
                raise ToolboxError(f"{kind}: names are text of up to {MAX_NAME} characters")
            if item.strip() not in names:
                names.append(item.strip())
        out[kind] = names
    return out


def count(box):
    return sum(len((box or {}).get(kind) or []) for kind in KINDS)


def favorites():
    try:
        with open(_path(), encoding="utf-8") as source:
            return clean(json.load(source))
    except (OSError, ValueError):
        return clean({})


def set_favorites(picks):
    picks = clean(picks)
    with _lock:
        atomic_write_json(_path(), picks)
    return picks


def effective(task):
    """The task's picks ({mode, kinds…, "from": task|favorites}), or None when it has none."""
    box = (task or {}).get("toolbox")
    if box:
        return {**box, "from": "task"}
    liked = favorites()
    return {"mode": "prefer", **liked, "from": "favorites"} if count(liked) else None


def words(box):
    """The picks in a sentence or two for the AI."""
    parts = []
    labels = {"nodes": "node types", "packs": "custom node packs (every node type in these folders; get_toolbox lists them)",
              "combos": "combos (place_combo)", "workflows": "workflows (open_workflow opens one in a new tab)",
              "prompts": "prompts (combo:<name> / workflow:<name> are the prompts inside that combo or workflow)",
              "models": "models (model_id for set_model / add_lora / get_model)"}
    for kind in KINDS:
        if box.get(kind):
            parts.append(f"{labels[kind]}: {', '.join(box[kind])}")
    how = ("Use ONLY these node types (and those of the picked packs) when you add nodes; ComfyUI's own built-in nodes stay allowed. "
           if box.get("mode") == "only" else "Use these first. ")
    return f"The user picked these for you to work with. {how}{'; '.join(parts)}. get_toolbox gives them in full."


def pick(task_id, picks, mode="prefer", now=None):
    """The user's picks for task `task_id`: kept on the task and given to the AI as a step. Returns the step."""
    if mode not in MODES:
        raise ToolboxError("mode is prefer or only")
    picks = clean(picks)
    now = time.time() if now is None else now
    box = {"mode": mode, **picks}
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        if not task:
            raise ToolboxError("No such task")
        task["toolbox"] = box
        step = {"id": uuid.uuid4().hex[:10], "at": now, "ms": 0, "tool": "user_toolbox", "kind": "user", "ok": True,
                "state": "done", "summary": "user_toolbox", "toolbox": box,
                "text": words(box) if count(box) else "The user took back the things they picked for you; use what fits.",
                "delivered": False, "results": []}
        task["steps"].append(step)
        del task["steps"][:-ai_tasks.MAX_STEPS]
        task["updated"] = max(task.get("updated", 0), now)
        ai_tasks._save(task)
    ai_tasks._notify(task_id)
    return step


def builtin(info):
    """Whether a node type (its /object_info entry) is ComfyUI's own and free: not a custom node, not a paid API node."""
    module = str((info or {}).get("python_module") or "")
    return module == "nodes" or module.startswith("comfy_extras")


def chosen(box, name, info):
    """Whether node type `name` (its /object_info entry) is among picks `box`: itself, or its pack."""
    return bool(box) and (name in (box.get("nodes") or []) or source_of(info) in (box.get("packs") or []))


def refused(task_id, types, info):
    """The node types among `types` the task's "only" picks do not allow (page-only helpers, unknown to /object_info, pass)."""
    box = effective(ai_tasks.get_task(task_id)) if task_id else None
    if not box or box.get("mode") != "only":
        return []
    return sorted({name for name in types if name in info and not chosen(box, name, info[name]) and not builtin(info[name])})


def source_of(info):
    """Where a node type comes from: its custom node folder, "builtin", or "api" (paid API nodes)."""
    module = str((info or {}).get("python_module") or "")
    if module.startswith("custom_nodes."):
        return module.split(".")[1]
    return "api" if module.startswith("comfy_api_nodes") else "builtin"


def catalog(kind):
    """What the picker lists besides node types (ai_toolbox_catalog.py); the page has those itself."""
    from .ai_toolbox_catalog import everything

    if kind != "all":
        raise ToolboxError("kind is all; node types come from the page")
    return everything()
