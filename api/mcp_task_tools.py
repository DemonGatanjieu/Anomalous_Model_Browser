"""MCP tools that shape the AI workbench's record (ai_tasks.py): begin_task names a piece of
work, report leaves a note for the user (with pictures made outside Anomalous's tools),
show_panel / update_panel draw a panel from Anomalous's blocks (ai_panels.py), get_answers
reads what the user picked or typed on it."""

from . import ai_marks, ai_panels, ai_task_runs, ai_tasks
from .mcp_tools import MAX_LIMIT, ToolError, _schema


def begin_task(ctx, title, new_task=False):
    title = str(title or "").strip()
    if not title:
        raise ToolError("title is empty: a few words on what the user asked for.")
    task = ai_tasks.begin_task(
        ctx.get("client") or "AI", title, new_task=bool(new_task),
        session=ctx.get("session") or "", task_id=ctx.get("task"),
    )
    answer = {"task": task["id"], "title": task["title"], "note": "Continue this task; do not begin another for its individual steps. "
                                         "Every call from now on is a step of this task in Anomalous's AI workbench, "
                                         "where the user sees, opens and undoes them. Call report to explain a choice "
                                         "or to hand in pictures you made another way; report with done=true at the end."}
    if task.get("about"):
        # Handed over from a model page, an image or a combo in Anomalous: the ids the tools take.
        answer["about"] = task["about"]
        answer["about_note"] = ("The user started this task from these in Anomalous; work with them: model_id goes to "
                                "set_model / add_lora / get_model, image to get_image_info, name to place_combo.")
    return answer


def report(ctx, text="", images=None, done=False, task=None):
    try:
        step, missing = ai_tasks.report(
            ctx.get("client") or "AI", text, images or [], bool(done),
            session=ctx.get("session") or "", task_id=task or ctx.get("task"),
        )
    except ValueError as error:
        raise ToolError(str(error))
    answer = {"noted": True, "pictures": len(step["results"])}
    if missing:
        answer["not_found"] = missing
        answer["note"] = "Pictures are paths inside ComfyUI's output folder (subfolder/name.png), as search_images gives them."
    return answer


def show_panel(ctx, title, blocks, task=None):
    try:
        panel = ai_panels.show(
            ctx.get("client") or "AI", title, blocks,
            session=ctx.get("session") or "", task_id=task or ctx.get("task"),
        )
    except ai_panels.PanelError as error:
        raise ToolError(str(error))
    asks = [block["id"] for block in panel["blocks"] if block["type"] in ai_panels.INTERACTIVE]
    answer = {"panel": panel["id"], "shown": True,
              "blocks": [{"id": block["id"], "type": block["type"]} for block in panel["blocks"]]}
    if asks:
        answer["questions"] = asks
        answer["note"] = ("The user answers in Anomalous when they get to it; call get_answers with this panel id "
                          "(wait_seconds up to 55 waits for it) before going on with what depends on it.")
    return answer


def update_panel(ctx, panel, title=None, blocks=None, closed=None, task=None):
    del ctx, task
    try:
        updated = ai_panels.update(panel, title, blocks, closed)
    except ai_panels.PanelError as error:
        raise ToolError(str(error))
    return {"updated": True, "blocks": [{"id": block.get("id"), "type": block["type"]}
                                        for block in updated["blocks"]]}


def run_status(ctx, wait_seconds=0, task=None):
    try:
        return ai_task_runs.status(ctx.get("client") or "AI", ctx.get("session") or "", task or ctx.get("task"), wait_seconds)
    except ValueError as error:
        raise ToolError(str(error))


def get_answers(ctx, panel=None, wait_seconds=0, task=None):
    try:
        client = ctx.get("client") or "AI"
        task_id = task or ctx.get("task") or None
        if not task_id and ctx.get("session"):
            task_id = ai_tasks.active_task_id(client, ctx["session"]) or ""
        answer = ai_panels.get_answers(client, panel, wait_seconds, task_id=task_id)
        return answer, ai_marks.image_items(answer.get("messages") or [])  # marked pictures, as pictures
    except ai_panels.PanelError as error:
        raise ToolError(str(error))


BLOCKS_HELP = (
    "blocks, top to bottom, each {type, ...}: heading {text}; text {text, tone: normal|muted|tip|warning}; "
    "images {items: [{image: 'subfolder/name.png' from search_images, caption, marks: [{x, y, r | w, h, label, "
    "color: red|green|blue|yellow|purple}]}], layout: row|grid|compare} (marks: circles or boxes with a label, x/y/w/h/r "
    "as fractions 0-1 of the picture, x/y the centre; a click on the label zooms there); "
    "slider {before: {image}, after: {image}, before_label, after_label} (one picture over the other, a line to drag); "
    "picks {id, question, items: [{id, image, label, reason, recommended}] (2-12), multiple} (pictures to choose from, "
    "each with 'take this one'; the user can also put a picture's workflow back on the canvas); "
    "diagram {nodes: [{id, label, detail, node_id, color}], edges: [{from, to, label}], direction: right|down} (boxes and "
    "arrows Anomalous lays out; node_id from describe_canvas makes a box find that node); "
    "models {items: [{model_id from search_models, note}]} (cards with their covers, a click opens them); "
    "table {columns: [...], rows: [[...]]}; list {items: [...], ordered}; params {items: [{label, value}]}; "
    "choices {id, question, options: [{id, label, detail}] (2-8), multiple} (buttons the user presses); "
    "input {id, question, placeholder} (a line the user types); progress {label, value, max}; divider {}. "
    "Each block may have a stable id; the tool returns block ids in display order. "
    "Plain text only (no markup, no links); up to 30 blocks, 12 pictures or models a block."
)

_TASK_PROP = {"type": "string", "description": "Optional task id returned by begin_task."}


def _task_tool(name, title, description, run, properties, required=()):
    return name, {"run": run, "context": True, "spec": {
        "name": name, "title": title, "description": description,
        "inputSchema": _schema(properties, required),
        "annotations": {"title": title, "readOnlyHint": name == "run_status", "destructiveHint": False,
                        "idempotentHint": False, "openWorldHint": False},
    }}


TASK_TOOLS = dict([
    _task_tool("begin_task", "Begin a task",
               "Call first when you start what the user asked for: names it in Anomalous's AI workbench, where the "
               "user sees each of your steps with what it made, and can open or undo it. Reuses the user's waiting "
               "task or your active task, including any preliminary reads. Use new_task=true only for a separate "
               "user request, never for another step of the same work.",
               begin_task, {"title": {"type": "string", "description": "A few words, in the user's language."},
                            "new_task": {"type": "boolean", "default": False}},
               ["title"]),
    _task_tool("report", "Tell the user",
               "Leaves a note in the AI workbench: why you chose something, what to look at, what is left. images: "
               "pictures you made in ComfyUI's output folder (subfolder/name.png) that Anomalous's tools did not "
               "make, so they are kept with the task. done=true ends the task.",
               report, {"text": {"type": "string"},
                        "images": {"type": "array", "items": {"type": "string"}, "maxItems": MAX_LIMIT},
                        "done": {"type": "boolean", "default": False}, "task": _TASK_PROP}),
    _task_tool("show_panel", "Show the user a panel",
               "Draws a panel in the AI workbench, in Anomalous's own style, from blocks: to compare pictures side by "
               "side, present models with their covers, lay out settings, a table, and to ask (buttons or a line of "
               "text). Use a new panel for each new phase (plan, workflow, then results), in the order they happen. "
               "Use it when a choice is the user's, or to show results better than words do. " + BLOCKS_HELP,
               show_panel, {"title": {"type": "string"},
                            "blocks": {"type": "array", "items": {"type": "object"}, "maxItems": ai_panels.MAX_BLOCKS},
                            "task": _TASK_PROP},
               ["title", "blocks"]),
    _task_tool("update_panel", "Change a panel",
               "Adds new output at the BOTTOM of an existing panel, preserving earlier content and its order. "
               "Send only the new blocks; repeated unchanged blocks are kept once. To deliberately correct an "
               "existing block or update a progress bar/question in place, include its returned block id and "
               "the same type. Omitted blocks are retained, not deleted. Never reuse an old block id for a new "
               "result: append it or use show_panel for the next phase. Up to 30 total blocks per panel. "
               "Can also change title, or set closed=true to stop answers; existing answers stay.",
               update_panel, {"panel": {"type": "string"}, "title": {"type": "string"},
                              "blocks": {"type": "array", "items": {"type": "object"}, "maxItems": ai_panels.MAX_BLOCKS},
                              "closed": {"type": "boolean"}, "task": _TASK_PROP}, ["panel"]),
    _task_tool("run_status", "How the run is going",
               "Where your task's latest workflow run stands: queued (how many runs are ahead), running (which node, "
               "its steps, nodes done of all), done (with the pictures it saved) or failed. wait_seconds (up to 55) "
               "waits for it to end. Runs take a while: call this instead of guessing whether a run has finished.",
               run_status, {"wait_seconds": {"type": "number", "minimum": 0, "maximum": ai_task_runs.MAX_STATUS_WAIT, "default": 0},
                            "task": _TASK_PROP}),
    _task_tool("get_answers", "Read the user's answers and messages",
               "What the user picked or typed on your panels, and what they wrote to you in the AI workbench "
               "(messages: a change of mind, 'stop', 'make it brighter'; kind=change: something they changed "
               "themselves in Anomalous while you worked, keep it), since you last asked; each once. For one "
               "panel (and its task's messages), or all of yours. wait_seconds (up to 55) waits when nothing is there "
               "yet: for that panel's open questions, or with no panel for anything the user sends. still_waiting "
               "lists the questions not answered. Check it between steps of longer work.",
               get_answers, {"panel": {"type": "string"},
                             "wait_seconds": {"type": "number", "minimum": 0, "maximum": ai_panels.MAX_WAIT, "default": 0},
                             "task": _TASK_PROP}),
])
