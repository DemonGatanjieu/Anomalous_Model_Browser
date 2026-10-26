"""A directory of the tools by what an AI wants to do, so it goes straight to the right one, as
ARCHITECTURE.md does for the code: each tool offered under its stage of the work
(action_catalog.TOOLS), with its title, in the catalog's order. It is built from the registry,
so a new tool shows up by itself (tests/test_mcp_directory.py checks that every stage has a
heading). mcp_server.py puts it into begin_task's answer, and into get_situation's while there
is no task yet.

With the "daily" tool set (ai_gates.tool_set) AI apps are offered action_catalog.DAILY and two
tools of this module for the rest, which the directory marks: tool_help gives the description and
arguments of tools named in the directory, use_tool calls one. use_tool has no run of its own:
mcp_server.py makes the call the tool it names before anything else, so gates, steps and answers
are that tool's.

AI apps keep the tool list they fetched (Antigravity files it away and refetches only when it
reconnects), so after the user switches the tool set, or Anomalous is updated, an app can call by a
list that is no longer offered. stale() spots that from the call; the answer then tells the AI, and
the task notes it (task["stale_tools"]) so the workbench tells the user how to reconnect, until the
app fetches the list again (cleared()).
"""

import time

from . import action_catalog, ai_tasks
from .mcp_tools import ToolError, _schema, retext

DIRECTORY_TOOLS = ("tool_help", "use_tool")
MAX_HELP = 3  # tool specs in one answer: three stay under what Antigravity files away
ON_DEMAND = " [use_tool]"
ON_DEMAND_NOTE = " Tools marked [use_tool] are not in your tool list: tool_help(names) gives their arguments, use_tool(name, arguments) calls one."

SECTIONS = (  # stage -> heading, in the order work usually goes
    ("run", "Run a workflow"), ("canvas", "The workflow on the canvas"), ("model", "Models"), ("prompt", "Prompts"),
    ("combo", "Combos"), ("picture", "Pictures"), ("voice", "Voices"), ("library", "The library"),
    (None, "The task and the user"),
)
NOTE = "The tools by what you want to do: go straight to the one you need instead of looking around first."
STALE_NOTE = ("Your app holds an older list of Anomalous's tools than the one offered now (the user changed the tool "
              "set, or Anomalous was updated). The call went through, but tell the user in report to reconnect the "
              "app to Anomalous (Antigravity: restart it, or switch the anomalous MCP server off and on) and to go on "
              "in a new chat.")


def directory(specs, offered=None):
    """{heading: "tool (title), ..."} for the tools of `specs` {name: spec}; with `offered` (the names
    in the AI's tool list), the others are marked as reached through use_tool."""
    sections = {}
    for name, entry in action_catalog.TOOLS.items():
        if name in specs:
            mark = ON_DEMAND if offered is not None and name not in offered else ""
            sections.setdefault(entry.stage, []).append(f"{name} ({specs[name].get('title') or name}){mark}")
    return {"note": NOTE + (ON_DEMAND_NOTE if offered is not None else ""),
            **{heading: ", ".join(sections[stage]) for stage, heading in SECTIONS if stage in sections}}


def attach(result, name, specs, offered=None):
    """Puts the directory into begin_task's answer, and into get_situation's while there is no task."""
    data = result.get("structuredContent") if isinstance(result, dict) and not result.get("isError") else None
    if not isinstance(data, dict) or not (name == "begin_task" or (name == "get_situation" and not data.get("task"))):
        return result
    retext(result, {**data, "directory": directory(specs, offered)})
    return result


def help_of(tools, names):
    """tool_help: what tools `names` do and take, from the server's `tools` {name: tool}."""
    if not isinstance(names, list) or not 0 < len(names) <= MAX_HELP:
        raise ToolError(f"names lists 1 to {MAX_HELP} tool names from the directory.")
    found, missing = [], []
    for name in names:
        tool = tools.get(name) if isinstance(name, str) and name not in DIRECTORY_TOOLS else None
        if tool:
            schema = tool["spec"]["inputSchema"]
            found.append({"name": name, "description": tool["spec"].get("description", ""),
                          "arguments": schema.get("properties", {}), "required": schema.get("required", [])})
        else:
            missing.append(str(name)[:60])
    return {"tools": found, **({"not_found": missing} if missing else {}),
            "next": "use_tool(name, arguments) calls one, with arguments as listed."}


def refused(text):
    """A use_tool call that names no tool it can make."""
    return {"content": [{"type": "text", "text": text}], "isError": True}


def hinted(result, name):
    """A failed use_tool call, with where its arguments are told."""
    if isinstance(result, dict) and result.get("isError") and result.get("content"):
        first = result["content"][0]
        result["content"][0] = {**first, "text": f"{first.get('text', '')} tool_help(names=[\"{name}\"]) shows its arguments."}
    return result


def stale(name, via, offered):
    """Whether a call of `name` (`via` use_tool) shows the app holds an older list than `offered`, the
    names offered now: tool_help or use_tool when they are not offered, use_tool for a tool offered
    directly, or a tool the list does not have."""
    if via:
        return "use_tool" not in offered or name in offered
    return name not in offered


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


def cleared(client):
    """The AI app `client` fetched the tool list again: the notes on its tasks go."""
    with ai_tasks._lock:
        changed = [task for task in ai_tasks._load().values() if task.get("stale_tools") and task.get("client") == client]
        for task in changed:
            task.pop("stale_tools")
            ai_tasks._save(task)
    for task in changed:
        ai_tasks._notify(task["id"])


def directory_tools(registry):
    """tool_help and use_tool, `registry()` giving the server's tools."""
    def tool_help(names):
        return help_of(registry(), names)

    return {
        "tool_help": {"run": tool_help, "spec": {
            "name": "tool_help", "title": "What a tool takes",
            "description": f"The description and arguments of up to {MAX_HELP} tools named in the directory, to call "
                           "them with use_tool.",
            "inputSchema": _schema({"names": {"type": "array", "items": {"type": "string"}, "maxItems": MAX_HELP}}, ["names"]),
            "annotations": {"title": "What a tool takes", "readOnlyHint": True, "destructiveHint": False,
                            "idempotentHint": True, "openWorldHint": False},
        }},
        "use_tool": {"spec": {
            "name": "use_tool", "title": "Use a tool",
            "description": "Calls a tool of the directory that is not in your tool list: name, and its arguments as "
                           "tool_help gives them. It is that tool's call in every way (its answer, the user's gates).",
            "inputSchema": _schema({"name": {"type": "string"}, "arguments": {"type": "object"}}, ["name"]),
            "annotations": {"title": "Use a tool", "readOnlyHint": False, "destructiveHint": True,
                            "idempotentHint": False, "openWorldHint": False},
        }},
    }
