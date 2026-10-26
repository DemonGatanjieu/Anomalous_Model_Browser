"""A directory of the tools by what an AI wants to do, so it goes straight to the right one, as
ARCHITECTURE.md does for the code: each tool under its stage of the work (action_catalog.TOOLS),
with its title, in the catalog's order. It is built from the registry, so a new tool shows up by
itself (tests/test_mcp_directory.py checks that every stage has a heading). mcp_server.py puts it
into begin_task's answer, and into get_situation's while there is no task yet.

AI apps keep the tool list they fetched (Antigravity files it away and fetches it again only when
it reconnects), so after Anomalous is updated an app can go on with the old one: new tools missing,
gone ones still called. listed() keeps which list each app fetched last (a fingerprint, in
anomalous/ai_tool_lists.json); a call from an app whose list is not today's tells the AI, and notes
it on the task (task["stale_tools"]) so the workbench tells the user how to reconnect, until the app
fetches the list again.
"""

import hashlib
import json
import os
import time

from . import action_catalog, ai_tasks
from .mcp_tools import retext
from .path_utils import atomic_write_json

SECTIONS = (  # stage -> heading, in the order work usually goes
    ("run", "Run a workflow"), ("canvas", "The workflow on the canvas"), ("model", "Models"), ("prompt", "Prompts"),
    ("combo", "Combos"), ("picture", "Pictures"), ("voice", "Voices"), ("library", "The library"),
    (None, "The task and the user"),
)
NOTE = "The tools by what you want to do: go straight to the one you need instead of looking around first."
STALE_NOTE = ("Your app holds an older list of Anomalous's tools (Anomalous was updated since it fetched it): some may "
              "be missing or gone. The call went through, but tell the user in report to reconnect the app to Anomalous "
              "(Antigravity: restart it, or switch the anomalous MCP server off and on) and to go on in a new chat.")
_lists = None  # app -> fingerprint of the tool list it fetched last


def directory(specs):
    """{heading: "tool (title), ..."} for the tools of `specs` {name: spec}."""
    sections = {}
    for name, entry in action_catalog.TOOLS.items():
        if name in specs:
            sections.setdefault(entry.stage, []).append(f"{name} ({specs[name].get('title') or name})")
    return {"note": NOTE, **{heading: ", ".join(sections[stage]) for stage, heading in SECTIONS if stage in sections}}


def attach(result, name, specs):
    """Puts the directory into begin_task's answer, and into get_situation's while there is no task."""
    data = result.get("structuredContent") if isinstance(result, dict) and not result.get("isError") else None
    if not isinstance(data, dict) or not (name == "begin_task" or (name == "get_situation" and not data.get("task"))):
        return result
    retext(result, {**data, "directory": directory(specs)})
    return result


def fingerprint(tools):
    return hashlib.sha256(json.dumps(tools, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def _path():
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "ai_tool_lists.json")


def _known():
    global _lists
    if _lists is None:
        try:
            with open(_path(), encoding="utf-8") as source:
                stored = json.load(source)
        except (OSError, ValueError):
            stored = {}
        _lists = stored if isinstance(stored, dict) else {}
    return _lists


def listed(client, tools):
    """The app `client` fetched `tools`: kept, and the notes on its tasks go."""
    with ai_tasks._lock:
        known = _known()
        if known.get(client) != fingerprint(tools):
            known[client] = fingerprint(tools)
            atomic_write_json(_path(), known)
        changed = [task for task in ai_tasks._load().values() if task.get("stale_tools") and task.get("client") == client]
        for task in changed:
            task.pop("stale_tools")
            ai_tasks._save(task)
    for task in changed:
        ai_tasks._notify(task["id"])


def stale(client, tools):
    """Whether the app `client` fetched another list than `tools` last (one never seen fetching: no)."""
    with ai_tasks._lock:
        known = _known().get(client)
    return bool(known) and known != fingerprint(tools)


def tell_stale(result, task_id):
    """Says so in the call's answer, and notes it on the task for the workbench."""
    if isinstance(result, dict):
        data = result.get("structuredContent")
        first = (result.get("content") or [None])[0]
        if isinstance(data, dict) and not result.get("isError"):
            retext(result, {**data, "tool_list": STALE_NOTE})
        elif isinstance(first, dict) and first.get("type") == "text":
            result["content"][0] = {**first, "text": f"{first.get('text', '')} {STALE_NOTE}"}
    if not task_id:
        return result
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        if task is None or task.get("stale_tools"):
            return result
        task["stale_tools"] = time.time()
        ai_tasks._save(task)
    ai_tasks._notify(task_id)
    return result
