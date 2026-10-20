"""MCP tools that shape the AI workbench's record (ai_tasks.py): begin_task names a piece of
work, report leaves a note for the user (with pictures made outside Anomalous's tools),
show_panel / update_panel draw a panel from Anomalous's blocks (ai_panels.py), get_answers
reads what the user picked or typed on it."""

from . import ai_panels, ai_tasks
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


def show_panel(ctx, title, blocks):
    try:
        panel = ai_panels.show(ctx.get("client") or "AI", title, blocks)
    except ai_panels.PanelError as error:
        raise ToolError(str(error))
    asks = [block["id"] for block in panel["blocks"] if block["type"] in ai_panels.INTERACTIVE]
    answer = {"panel": panel["id"], "shown": True}
    if asks:
        answer["questions"] = asks
        answer["note"] = ("The user answers in Anomalous when they get to it; call get_answers with this panel id "
                          "(wait_seconds up to 55 waits for it) before going on with what depends on it.")
    return answer


def update_panel(ctx, panel, title=None, blocks=None, closed=None):
    try:
        ai_panels.update(panel, title, blocks, closed)
    except ai_panels.PanelError as error:
        raise ToolError(str(error))
    return {"updated": True}


def get_answers(ctx, panel=None, wait_seconds=0):
    try:
        return ai_panels.get_answers(ctx.get("client") or "AI", panel, wait_seconds)
    except ai_panels.PanelError as error:
        raise ToolError(str(error))


BLOCKS_HELP = (
    "blocks, top to bottom, each {type, ...}: heading {text}; text {text, tone: normal|muted|tip|warning}; "
    "images {items: [{image: 'subfolder/name.png' from search_images, caption}], layout: row|grid|compare}; "
    "models {items: [{model_id from search_models, note}]} (cards with their covers, a click opens them); "
    "table {columns: [...], rows: [[...]]}; list {items: [...], ordered}; params {items: [{label, value}]}; "
    "choices {id, question, options: [{id, label, detail}] (2-8), multiple} (buttons the user presses); "
    "input {id, question, placeholder} (a line the user types); progress {label, value, max}; divider {}. "
    "Plain text only (no markup, no links); up to 30 blocks, 12 pictures or models a block."
)


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
    _task_tool("show_panel", "Show the user a panel",
               "Draws a panel in the AI workbench, in Anomalous's own style, from blocks: to compare pictures side by "
               "side, present models with their covers, lay out settings, a table, and to ask (buttons or a line of "
               "text). Use it when a choice is the user's, or to show results better than words do. " + BLOCKS_HELP,
               show_panel, {"title": {"type": "string"},
                            "blocks": {"type": "array", "items": {"type": "object"}, "maxItems": ai_panels.MAX_BLOCKS}},
               ["title", "blocks"]),
    _task_tool("update_panel", "Change a panel",
               "Changes a panel shown before: its title, its blocks (answers given to questions kept by id stay), or "
               "closed=true when its questions no longer matter (the user can no longer answer them).",
               update_panel, {"panel": {"type": "string"}, "title": {"type": "string"},
                              "blocks": {"type": "array", "items": {"type": "object"}, "maxItems": ai_panels.MAX_BLOCKS},
                              "closed": {"type": "boolean"}}, ["panel"]),
    _task_tool("get_answers", "Read the user's answers",
               "What the user picked or typed on your panels since you last asked (each answer once): for one panel, "
               "or all of yours. wait_seconds (up to 55) waits for an answer when none is there yet; still_waiting "
               "lists the questions not answered.",
               get_answers, {"panel": {"type": "string"},
                             "wait_seconds": {"type": "number", "minimum": 0, "maximum": ai_panels.MAX_WAIT, "default": 0}}),
])
