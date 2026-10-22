"""Anomalous's card inside the AI app's conversation (the MCP Apps extension,
io.modelcontextprotocol/ui): AI apps that support it (Claude, ChatGPT, VS Code…) show the page
mcp_app/task_card.html under the results of the tools in CARD_TOOLS, in a sandboxed frame of
theirs. It is Anomalous's own page, never anything an AI wrote; the AI's data reaches it only as
text. The card reads the task through app_task_view and answers the AI's questions through
app_answer, two tools for the card only (visibility "app": apps that follow the extension keep
them from the AI; an AI that calls them anyway only reads its own task or answers its own
question). Their results go to the card, not the AI. The card never answers a gate:
an OK for what an AI may do is only given in Anomalous (ai_gates.py), so a tool the AI could
reach can never grant it. The pictures it shows are the gallery's thumbnails, inline (the frame
loads nothing from this server).
"""

import os

from . import ai_panels, ai_tasks
from .mcp_tools import ToolError, _image_content, _resolve_image, _schema

EXTENSION = "io.modelcontextprotocol/ui"
MIME = "text/html;profile=mcp-app"
CARD_URI = "ui://anomalous/task-card.html"
CARD_TOOLS = ("show_panel", "ask_user", "report", "run_workflow", "begin_task")
MAX_PICTURES = 6
MAX_STEPS = 8
HTML = os.path.join(os.path.dirname(__file__), "mcp_app", "task_card.html")


def resources():
    return [{"uri": CARD_URI, "name": "task-card", "title": "Anomalous task card", "mimeType": MIME,
             "description": "What the AI is doing in Anomalous: its steps, pictures and questions."}]


def read(uri):
    """resources/read for the card, or None for another address."""
    if uri != CARD_URI:
        return None
    with open(HTML, encoding="utf-8") as source:
        html = source.read()
    return {"contents": [{"uri": CARD_URI, "mimeType": MIME, "text": html, "_meta": {"ui": {"prefersBorder": True}}}]}


def with_card(spec):
    """A tool's spec naming the card that shows its results (and the older flat key some apps read)."""
    if spec["name"] not in CARD_TOOLS:
        return spec
    return {**spec, "_meta": {**spec.get("_meta", {}), "ui": {"resourceUri": CARD_URI}, "ui/resourceUri": CARD_URI}}


def _picture(result):
    rel = "/".join(part for part in (result.get("subfolder"), result.get("filename")) if part)
    try:
        _, path = _resolve_image(rel)
    except ToolError:
        return None
    item = _image_content(path)
    return {"name": result["filename"], "src": f"data:{item['mimeType']};base64,{item['data']}"} if item else None


def _words(step):
    """A line for a step: its note or panel title, else what it was about (its summary without the tool)."""
    summary = step.get("summary", "")
    about = summary.split(": ", 1)[1] if summary.startswith(f"{step['tool']}: ") else summary
    return ai_tasks._short(step.get("text") or (step.get("panel") or {}).get("title") or about or step["tool"], 120)


def _answered(step):
    """What the user already answered on a panel step: [{question, answer}]."""
    blocks = {block["id"]: block for block in step["panel"]["blocks"]}
    return [{"question": blocks.get(block, {}).get("question", ""), "answer": "、".join(given.get("labels") or [given.get("text", "")])}
            for block, given in step.get("answers", {}).items()]


def _questions(step):
    """The open questions of a panel step, as the card draws them (choices and picks as buttons, input as a line)."""
    panel = step["panel"]
    out = []
    for block in panel["blocks"]:
        if block["type"] not in ai_panels.INTERACTIVE or block["id"] in step.get("answers", {}) or panel.get("closed"):
            continue
        options = block.get("options") or [{"id": item["id"], "label": item.get("label") or item["id"]} for item in block.get("items", [])]
        out.append({"panel": panel["id"], "block": block["id"], "type": block["type"], "question": block.get("question", ""),
                    "options": [{"id": option["id"], "label": option.get("label") or option["id"]} for option in options]})
    return out


def task_view(ctx, panel=None, task=None):
    """The card's view of a task: the panel's task, task `task`, or the calling app's active one."""
    with ai_tasks._lock:
        found = ai_panels._find(str(panel))[0] if panel else None
        task_id = found["id"] if found else task or ai_tasks.active_task_id(ctx.get("client") or "AI", ctx.get("session") or "")
        record = ai_tasks.get_task(task_id) if task_id else None
    if not record:
        raise ToolError("No task to show.")
    steps = [step for step in record["steps"] if step.get("kind") != "look"]
    pictures = [result for step in record["steps"] for result in step.get("results") or [] if result.get("type") == "image"]
    seen, shown = set(), []
    for result in reversed(pictures):
        key = (result.get("subfolder"), result.get("filename"))
        if key in seen or len(shown) >= MAX_PICTURES:
            continue
        seen.add(key)
        picture = _picture(result)
        if picture:
            shown.append(picture)
    return {
        "task": record["id"], "title": record.get("title") or "", "ended": bool(record.get("ended")),
        "steps": [{"tool": step["tool"], "kind": step["kind"], "state": step.get("state", "done"), "ok": step.get("ok", True),
                   "stage": step.get("stage"), "text": _words(step)}
                  for step in steps[-MAX_STEPS:]],
        "pictures": list(reversed(shown)),
        "questions": [question for step in record["steps"] if step.get("kind") == "panel" for question in _questions(step)],
        "answered": [item for step in record["steps"] if step.get("kind") == "panel" for item in _answered(step)][-3:],
        "asking": [step.get("gate", {}).get("gate") for step in record["steps"] if step.get("state") == "asking"],
        "open_url": f"{ctx.get('base_url', '')}/",
    }


def answer(ctx, panel, block, choice=None, text=None):
    """The user's answer from the card to one of the AI's questions (never a gate)."""
    task, step = None, None
    with ai_tasks._lock:
        task, step = ai_panels._find(str(panel))
    if not step:
        raise ToolError("No such panel.")
    try:
        ai_panels.answer(task["id"], step["id"], str(block), choice, text)
    except ai_panels.PanelError as error:
        raise ToolError(str(error))
    return {"answered": True}


def _app_tool(name, title, description, run, properties, required=()):
    return name, {"run": run, "context": True, "spec": {
        "name": name, "title": title, "description": description, "inputSchema": _schema(properties, required),
        "annotations": {"title": title, "readOnlyHint": name == "app_task_view"},
        "_meta": {"ui": {"resourceUri": CARD_URI, "visibility": ["app"]}},
    }}


APP_TOOLS = dict([
    _app_tool("app_task_view", "Card: the task", "Only for Anomalous's own card in the conversation; never call it.",
              task_view, {"panel": {"type": "string"}, "task": {"type": "string"}}),
    _app_tool("app_answer", "Card: answer", "Only for Anomalous's own card, when the user answers there; never call it.",
              answer, {"panel": {"type": "string"}, "block": {"type": "string"}, "choice": {"type": "array", "items": {"type": "string"}},
                       "text": {"type": "string"}}, ["panel", "block"]),
])
