"""MCP tools that shape the AI workbench's record (ai_tasks.py): begin_task names a piece of
work, report leaves a note for the user (with pictures made outside Anomalous's tools)."""

from . import ai_tasks
from .mcp_tools import MAX_LIMIT, ToolError, _schema


def begin_task(ctx, title):
    title = str(title or "").strip()
    if not title:
        raise ToolError("title is empty: a few words on what the user asked for.")
    task = ai_tasks.begin_task(ctx.get("client") or "AI", title)
    return {"task": task["id"], "note": "Every call from now on is a step of this task in Anomalous's AI workbench, "
                                       "where the user sees, opens and undoes them. Call report to explain a choice "
                                       "or to hand in pictures you made another way; report with done=true at the end."}


def report(ctx, text="", images=None, done=False):
    try:
        step, missing = ai_tasks.report(ctx.get("client") or "AI", text, images or [], bool(done))
    except ValueError as error:
        raise ToolError(str(error))
    answer = {"noted": True, "pictures": len(step["results"])}
    if missing:
        answer["not_found"] = missing
        answer["note"] = "Pictures are paths inside ComfyUI's output folder (subfolder/name.png), as search_images gives them."
    return answer


def _task_tool(name, title, description, run, properties, required=()):
    return name, {"run": run, "context": True, "spec": {
        "name": name, "title": title, "description": description,
        "inputSchema": _schema(properties, required),
        "annotations": {"title": title, "readOnlyHint": False, "destructiveHint": False,
                        "idempotentHint": False, "openWorldHint": False},
    }}


TASK_TOOLS = dict([
    _task_tool("begin_task", "Begin a task",
               "Call first when you start what the user asked for: names it in Anomalous's AI workbench, where the "
               "user sees each of your steps with what it made, and can open or undo it. Without it, your calls are "
               "grouped by themselves.",
               begin_task, {"title": {"type": "string", "description": "A few words, in the user's language."}},
               ["title"]),
    _task_tool("report", "Tell the user",
               "Leaves a note in the AI workbench: why you chose something, what to look at, what is left. images: "
               "pictures you made in ComfyUI's output folder (subfolder/name.png) that Anomalous's tools did not "
               "make, so they are kept with the task. done=true ends the task.",
               report, {"text": {"type": "string"},
                        "images": {"type": "array", "items": {"type": "string"}, "maxItems": MAX_LIMIT},
                        "done": {"type": "boolean", "default": False}}),
])
