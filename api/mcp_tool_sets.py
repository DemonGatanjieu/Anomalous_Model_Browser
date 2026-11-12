"""Which tools an AI app is offered. The address as it is offers every tool; `?tools=core` offers
Anomalous's short set for working in the AI app's own chat, `?tools=mine` the user's own choice (kept in
anomalous/ai_tool_sets.json, picked in the Connect an AI window). An app keeps the whole list in the AI's
context for the whole chat, so a shorter one leaves the AI more room (issue #27). It only shortens the
list: tools/call still takes every tool, and an unknown set name, or "mine" never chosen, offers all.

The short set leaves out the AI workbench (begin_task, report, ask_user…), the tools that move, scan or
download files, and the voice; it keeps the ways and skills (get_toolbox, read_guide), the closer look
(zoom_image) and stop_run. The instructions an app is given name only listed tools (instructions()):
a part naming a tool the set leaves out is dropped, and without the workbench the AI is told to ask and
explain in its own chat. The card's own tools (mcp_apps.APP_TOOLS) come along whenever a listed tool
shows the card.

GET /anomalous/ai_tool_sets: {core, mine, needed, tools: [{name, stage, size}], all_size};
POST {mine: [names]} keeps the user's choice (a write: this computer only, local_guard.py).
"""

import json
import os
import re

from aiohttp import web

from . import action_catalog, ai_tasks, mcp_apps
from .path_utils import atomic_write_json

CORE = (
    "get_situation", "describe_canvas", "find_nodes", "check_workflow_models", "run_status",
    "library_overview", "scan_report", "search_images", "get_image_info", "zoom_image", "list_combos",
    "list_workflows", "list_saved_prompts", "search_audio", "recent_activity", "search_models", "get_model",
    "set_prompt", "set_model", "add_lora", "place_combo", "download_missing_models", "run_workflow", "stop_run",
    "open_in_anomalous", "add_node", "add_nodes", "connect_nodes", "set_values", "remove_nodes", "new_workflow",
    "open_workflow", "get_toolbox", "read_guide",
)
NEEDED = ("begin_task", "report", "ask_user", "get_answers")  # what a task handed over in Anomalous needs
CHAT_NOTE = ("This connection has no workbench tools: ask the user and explain in your own chat, also where an "
             "answer or a skill says ask_user or report.")
_mine = None  # the user's choice, read once


def _path():
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "ai_tool_sets.json")


def mine():
    """The tools the user picked, in the registry's order; () before they ever picked."""
    global _mine
    if _mine is None:
        try:
            with open(_path(), encoding="utf-8") as source:
                stored = json.load(source).get("mine")
        except (OSError, ValueError, AttributeError):
            stored = None
        _mine = tuple(name for name in stored if isinstance(name, str)) if isinstance(stored, list) else ()
    return _mine


def save_mine(names, tools):
    """Keeps the user's choice: names of offered tools (the card's own come along by themselves)."""
    global _mine
    if not isinstance(names, list):
        raise ValueError("Expected {mine: [tool names]}")
    picked = tuple(name for name in tools if name in names and name not in mcp_apps.APP_TOOLS)
    if not picked:
        raise ValueError("Pick at least one tool")
    atomic_write_json(_path(), {"mine": list(picked)})
    _mine = picked
    return picked


def chosen(value, tools):
    """The names the address's ?tools= offers, or None for every tool."""
    picked = CORE if value == "core" else mine() if value == "mine" else ()
    names = {name for name in picked if name in tools}
    if not names:
        return None
    if names & set(mcp_apps.CARD_TOOLS):
        names |= set(mcp_apps.APP_TOOLS)
    return frozenset(names)


def instructions(parts, names, tools):
    """The server's instructions for the set `names` (None: all of them, as written)."""
    if names is None:
        return "".join(parts)
    pattern = re.compile(r"(?<![\w/])(" + "|".join(sorted(map(re.escape, tools), key=len, reverse=True)) + r")(?!\w)")
    kept = [part for part in parts if set(pattern.findall(part)) <= names]
    text = "".join(kept).rstrip()
    if text.endswith(";"):
        text = text[:-1] + "."
    if not set(NEEDED) <= names:
        text = f"{text} {CHAT_NOTE}"
    return text


def register_routes(app, tools, sizes):
    """GET/POST /anomalous/ai_tool_sets; `sizes()` gives {name: characters of its listed spec}."""
    def answer():
        size = sizes()
        offered = [name for name in tools if name not in mcp_apps.APP_TOOLS]
        return web.json_response({
            "core": list(CORE), "mine": list(mine()), "needed": list(NEEDED), "all_size": sum(size.values()),
            "card": {"tools": list(mcp_apps.CARD_TOOLS), "size": sum(size[name] for name in mcp_apps.APP_TOOLS)},
            "tools": [{"name": name, "stage": action_catalog.TOOLS[name].stage if name in action_catalog.TOOLS else None,
                       "size": size[name]} for name in offered],
        })

    async def api_tool_sets(request):
        if request.method == "POST":
            try:
                body = await request.json()
            except (ValueError, UnicodeDecodeError):
                body = None
            try:
                save_mine((body or {}).get("mine") if isinstance(body, dict) else None, tools)
            except ValueError as error:
                return web.json_response({"error": str(error)}, status=400)
        return answer()

    app.router.add_get("/anomalous/ai_tool_sets", api_tool_sets)
    app.router.add_post("/anomalous/ai_tool_sets", api_tool_sets)
