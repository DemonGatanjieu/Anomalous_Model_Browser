"""MCP tools that shape the AI workbench's record (ai_tasks.py): begin_task names a piece of
work, report leaves a note for the user (with pictures made outside Anomalous's tools),
show_panel / update_panel draw a panel from Anomalous's blocks (ai_panels.py), get_answers
reads what the user picked or typed on it."""

from . import ai_marks, ai_panels, ai_task_runs, ai_tasks, ai_toolbox
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
                                         "Ask the user anything with ask_user: they answer in Anomalous's AI workbench, not in your chat. "
                                         "Every call from now on is a step of this task in Anomalous's AI workbench, "
                                         "where the user sees, opens and undoes them. Call report to explain a choice "
                                         "or to hand in pictures you made another way; report with done=true at the end."}
    box = ai_toolbox.effective(ai_tasks.get_task(task["id"]))
    if box:
        answer["toolbox"] = ai_toolbox.words(box)
    if task.get("about"):
        # Handed over from a model page, an image or a combo in Anomalous: the ids the tools take.
        answer["about"] = task["about"]
        answer["about_note"] = ("The user started this task from these in Anomalous; work with them: model_id goes to "
                                "set_model / add_lora / get_model, image to get_image_info, a combo's name to place_combo, "
                                "a workflow's name to open_workflow.")
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


def ask_user(ctx, question, options=None, multiple=False, other=True, wait_seconds=ai_panels.MAX_WAIT, task=None):
    """A question in the AI workbench, where the user watches the work: options to press (one may be
    recommended), a line of their own; waits for the answer."""
    block = ({"type": "choices", "id": "answer", "options": options, "multiple": bool(multiple), "other": bool(other)}
             if options else {"type": "input", "id": "answer", "question": str(question or "")[:200]})
    try:
        panel = ai_panels.show(ctx.get("client") or "AI", question, [block], session=ctx.get("session") or "",
                               task_id=task or ctx.get("task"), tool="ask_user")
        answer = ai_panels.get_answers(ctx.get("client") or "AI", panel["id"], wait_seconds)
    except ai_panels.PanelError as error:
        raise ToolError(str(error))
    given = next((item for item in answer["answers"] if item["question"] == "answer"), None)
    if not given:
        return {"answered": False, "panel": panel["id"],
                "note": "The user has not answered yet. Keep waiting with get_answers(panel, wait_seconds=55); "
                        "do not ask the same in your own chat, they answer in Anomalous."}
    out = {"answered": True, "panel": panel["id"]}
    if given.get("text"):
        out["text"] = given["text"]
        if given.get("choice") == ["other"]:
            out["note"] = "None of your options: the user wrote their own answer."
    else:
        out.update(choice=given.get("choice"), labels=given.get("labels"))
    return out


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


def get_toolbox(ctx, task=None):
    from . import mcp_tools
    from .mcp_canvas_edit import find_nodes

    task_id = task or ctx.get("task") or ai_tasks.active_task_id(ctx.get("client") or "AI", ctx.get("session") or "")
    box = ai_toolbox.effective(ai_tasks.get_task(task_id)) if task_id else None
    if not box:
        return {"picked": False, "note": "The user picked nothing for this task; use what fits."}
    answer = {"picked": True, "mode": box["mode"], "note": ai_toolbox.words(box)}
    if box.get("nodes"):
        found = find_nodes(ctx, types=box["nodes"])
        answer["nodes"] = found["nodes"]
        if found.get("not_found"):
            answer["page_only_nodes"] = found["not_found"]  # helpers that live only in the page: add_node takes them
    for kind, lister, key in (("combos", mcp_tools.list_combos, "combos"), ("workflows", mcp_tools.list_workflows, "workflows")):
        if box.get(kind):
            answer[kind] = [item for name in box[kind] for item in lister(name, 5)[key] if item["name"] == name][:ai_toolbox.MAX_ITEMS]
    if box.get("prompts"):
        from .ai_toolbox_catalog import everything

        prompts = {entry["id"]: entry for entry in everything()["prompts"]}
        answer["prompts"] = [prompts[name] for name in box["prompts"] if name in prompts]
    if box.get("models"):
        answer["models"] = []
        for model_id in box["models"]:
            try:
                found = mcp_tools.get_model(model_id)
                answer["models"].append(found[0] if isinstance(found, tuple) else found)  # without its cover picture
            except ToolError:
                answer["models"].append({"model_id": model_id, "missing": True})
    return answer


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
        "annotations": {"title": title, "readOnlyHint": name in ("run_status", "get_toolbox"), "destructiveHint": False,
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
    _task_tool("ask_user", "Ask the user",
               "Asks the user in Anomalous's AI workbench, where they watch your work, and waits for the answer: "
               "a question with options to press (2-8 {label, detail, recommended}: mark the one you suggest with "
               "recommended=true instead of writing it into the label) and, unless other=false, a line for their own "
               "answer; no options: a question they answer in a line. Use it for every choice or preference that is "
               "the user's while you work on an Anomalous task, never your own chat's question form. Returns the "
               "choice (or their text); if they have not answered within wait_seconds, keep waiting with get_answers.",
               ask_user, {"question": {"type": "string"},
                          "options": {"type": "array", "maxItems": 8, "items": {"type": "object", "properties": {
                              "label": {"type": "string"}, "detail": {"type": "string"}, "recommended": {"type": "boolean"}}}},
                          "multiple": {"type": "boolean", "default": False}, "other": {"type": "boolean", "default": True},
                          "wait_seconds": {"type": "number", "minimum": 0, "maximum": ai_panels.MAX_WAIT, "default": ai_panels.MAX_WAIT},
                          "task": _TASK_PROP},
               ["question"]),
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
               "its steps, percent, nodes done of all), done (with the pictures it saved) or failed; summary says it "
               "in one sentence. wait_seconds (up to 55) waits for it to end. Runs take a while: call this instead of "
               "guessing, looking in the output folder or at the screen. While a run goes, your other tools' answers "
               "carry the same news as your_run, and once more when it ends.",
               run_status, {"wait_seconds": {"type": "number", "minimum": 0, "maximum": ai_task_runs.MAX_STATUS_WAIT, "default": 0},
                            "task": _TASK_PROP}),
    _task_tool("get_toolbox", "What the user picked for you",
               "The node types, combos, saved workflows, prompts and models the user picked in the AI workbench for "
               "this task, in full (inputs and outputs of the nodes, the combos' models and prompts…), and how strictly: "
               "prefer (use them first) or only (add_node and new_workflow accept only those node types besides "
               "ComfyUI's built-in ones). begin_task says when there are any.",
               get_toolbox, {"task": _TASK_PROP}),
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
