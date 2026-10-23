"""get_situation: where an AI's task stands, in one answer small enough to stay in its chat.

The task (what the user asked last, questions and gates still waiting for them, decisions so
far, pictures made, steps done outside Anomalous), the canvas in brief (web/modules/
mcp_canvas_brief.js: a line per node, the inputs nothing feeds yet and the outputs that fit,
ComfyUI's errors), the latest run, and the one thing to do next. For an AI starting a new chat
on a task or unsure where it is: a small model reads this instead of describe_canvas, find_nodes
and the task's history. Unread messages of the user's come with it as with every answer
(ai_panels.attach_pending).
"""

from . import ai_decisions, ai_task_runs, ai_tasks
from .mcp_bridge import PageRefused, PageUnavailable, ask_page
from .mcp_tools import _schema, tool_text

BUDGET = 3600  # characters: Antigravity files away an answer past about 4,000 and has the AI open it
MAX_TEXT = 200


def _last_asked(task):
    """The user's latest words or marks in the task, in short."""
    for step in reversed(task.get("steps") or []):
        if step.get("kind") == "user" and step.get("tool") in ("user_message", "user_marks", "user_pictures"):
            return {"what": step["tool"].removeprefix("user_"), "text": str(step.get("text") or "")[:MAX_TEXT], "id": step["id"]}
    return None


def _canvas():
    try:
        return ask_page("describe_canvas", {"brief": True}, timeout=15)
    except PageUnavailable as error:
        return {"unavailable": str(error)}
    except PageRefused as error:  # no workflow open, or the task's tab cannot be opened
        return {"unavailable": str(error)}


def _next(summary, run, canvas):
    if summary["asks"]:
        return f"{summary['asks']} question(s) or gate(s) wait for the user: get_answers waits for their answer."
    if run.get("state") in ("queued", "running", "asking", "allowed"):
        return "A run is going: run_status(wait_seconds=55) waits for it; do not run again."
    if any("not in list" in str(item.get("error")) for item in canvas.get("errors") or ()):
        return ("A model or file the workflow names is not on this computer: check_workflow_models says which and what "
                "can stand in (fix_workflow_models, download_missing_models); do not guess other choices.")
    if canvas.get("errors"):
        return "ComfyUI refused the last run: fix the nodes in canvas.errors (set_values, connect_nodes), then run_workflow."
    if canvas.get("unwired"):
        return "Wire canvas.unwired with connect_nodes (fits lists outputs that fit each), then run_workflow."
    if run.get("state") == "done" and run.get("pictures"):
        return "Look at the run's pictures (zoom_image) and tell the user with report what came out."
    return "Go on with what the user asked (task.asked); run_workflow runs the canvas, report tells the user."


def get_situation(ctx, task=None):
    client, session = ctx.get("client") or "AI", ctx.get("session") or ""
    task_id = ai_tasks.active_task_id(client, session, task or ctx.get("task"))
    record = ai_tasks.get_task(task_id) if task_id else None
    run = {"state": "none"}
    answer = {}
    if record:
        summary = ai_tasks.task_summary(record)
        pictures = [item["filename"] for step in record.get("steps") or [] for item in step.get("results") or [] if item.get("type") == "image"]
        answer["task"] = {"id": record["id"], "title": record.get("title") or "", "steps": summary["steps"],
                          "asked": _last_asked(record), "waiting_for_user": summary["asks"],
                          "decisions": ai_decisions.lines(record, limit=4), "pictures": pictures[-3:],
                          "outside_anomalous": summary["kinds"].get("outside", 0)}
        status = ai_task_runs.status(client, session, task_id)
        run = {key: status[key] for key in ("state", "summary", "pictures") if status.get(key)}
    else:
        summary = {"asks": 0}
        answer["task"] = None
        answer["task_note"] = "No task yet: begin_task names what the user asked for."
    canvas = _canvas()
    answer.update(run=run, canvas=canvas)
    answer["next"] = _next(summary, run, canvas)
    # Stay under the budget: the canvas lines go first, then the decisions.
    while len(tool_text(answer)) > BUDGET and canvas.get("lines"):
        canvas["lines"].pop()
        canvas["more_nodes"] = canvas.get("more_nodes", 0) + 1
    while len(tool_text(answer)) > BUDGET and record and answer["task"]["decisions"]:
        answer["task"]["decisions"].pop(0)
    return answer


SITUATION_TOOLS = {
    "get_situation": {"run": get_situation, "context": True, "spec": {
        "name": "get_situation", "title": "Where things stand",
        "description": "One call, the whole picture: the task (what the user asked last, what waits for them, "
                       "decisions, pictures made), the canvas in brief (a line per node: what feeds it, what it "
                       "gives; the inputs nothing feeds yet with the outputs that fit them; ComfyUI's errors), the "
                       "latest run, and next: the one thing to do now. Call it first in a new chat on a task, and "
                       "whenever you are unsure, instead of describe_canvas, find_nodes or reading files.",
        "inputSchema": _schema({"task": {"type": "string", "description": "Optional task id returned by begin_task."}}),
        "annotations": {"title": "Where things stand", "readOnlyHint": True, "destructiveHint": False,
                        "idempotentHint": True, "openWorldHint": False},
    }},
}
