"""Panels the AI draws in its task (show_panel), from Anomalous's own blocks, and the answers
the user gives on them.

A panel is a step of the AI's current task (ai_tasks.py) holding a title and a list of blocks:
heading, text, images (from ComfyUI's output folder), models (the user's, by model_id), table,
list, params, choices (buttons; one or several picks) and input (a line of text), progress,
divider. Nothing the AI sends is run or rendered as markup: every block is checked here to be
one of these shapes, with plain strings of bounded length, pictures only from the output
folder and models only from the user's folders. The page draws them (ui_ai_panel.js).

The user's answers come back through POST /anomalous/ai_tasks/{task}/answer and wait in the
step until the AI asks for them (get_answers, which may wait a while for one). Anomalous
cannot call the AI itself; the page says so where it asks.
"""

import os
import threading
import time
import uuid

import folder_paths

from . import ai_tasks

MAX_BLOCKS = 30
MAX_ITEMS = 12
MAX_ROWS = 30
MAX_COLUMNS = 8
MAX_WAIT = 55
TONES = ("normal", "muted", "tip", "warning")
LAYOUTS = ("row", "grid", "compare")
INTERACTIVE = ("choices", "input")

_answered = threading.Condition(ai_tasks._lock)


class PanelError(ValueError):
    """What is wrong with a panel, for the AI to fix."""


def _text(value, limit, where, required=False):
    if value is None and not required:
        return ""
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise PanelError(f"{where} must be text")
    text = str(value).strip()
    if required and not text:
        raise PanelError(f"{where} is empty")
    return text[:limit]


def _list(value, limit, where):
    if value is None:
        return []
    if not isinstance(value, list):
        raise PanelError(f"{where} must be a list")
    if len(value) > limit:
        raise PanelError(f"{where} has more than {limit} items")
    return value


def _image(item, where):
    image = item.get("image") if isinstance(item, dict) else item
    found = ai_tasks._output_media(str(image or ""))
    if not found:
        raise PanelError(f"{where}: {image!r} is not a picture in ComfyUI's output folder (subfolder/name.png, as search_images gives it)")
    return {**found, "caption": _text(item.get("caption") if isinstance(item, dict) else "", 120, f"{where}.caption")}


def _model(item, where):
    from .mcp_tools import ToolError, _resolve_model
    from .model_media import _preview_url_for_model

    model_id = item.get("model_id") if isinstance(item, dict) else item
    try:
        folder_type, path_idx, base_dir, file_path = _resolve_model(model_id)
    except ToolError as error:
        raise PanelError(f"{where}: {error}")
    try:
        cover = _preview_url_for_model(folder_type, path_idx, base_dir, file_path) or ""
    except Exception:  # noqa: BLE001 - a card without its cover is still a card
        cover = ""
    return {"model_id": str(model_id), "folder": folder_type, "path_idx": path_idx,
            "rel": os.path.relpath(file_path, base_dir).replace(os.sep, "/"), "name": os.path.basename(file_path),
            "cover": cover, "note": _text(item.get("note") if isinstance(item, dict) else "", 160, f"{where}.note")}


def clean_block(block, at, taken):
    """One block as the page may draw it, or PanelError."""
    where = f"blocks[{at}]"
    if not isinstance(block, dict) or not isinstance(block.get("type"), str):
        raise PanelError(f"{where} must be an object with a type")
    kind = block["type"]
    out = {"type": kind}
    if kind == "heading":
        out["text"] = _text(block.get("text"), 120, f"{where}.text", True)
    elif kind == "text":
        out["text"] = _text(block.get("text"), 4000, f"{where}.text", True)
        out["tone"] = block.get("tone") if block.get("tone") in TONES else "normal"
    elif kind == "images":
        items = _list(block.get("items"), MAX_ITEMS, f"{where}.items")
        if not items:
            raise PanelError(f"{where}.items is empty")
        out["items"] = [_image(item, f"{where}.items[{i}]") for i, item in enumerate(items)]
        out["layout"] = block.get("layout") if block.get("layout") in LAYOUTS else "row"
    elif kind == "models":
        items = _list(block.get("items"), MAX_ITEMS, f"{where}.items")
        if not items:
            raise PanelError(f"{where}.items is empty")
        out["items"] = [_model(item, f"{where}.items[{i}]") for i, item in enumerate(items)]
    elif kind == "table":
        columns = [_text(c, 60, f"{where}.columns") for c in _list(block.get("columns"), MAX_COLUMNS, f"{where}.columns")]
        rows = []
        for r, row in enumerate(_list(block.get("rows"), MAX_ROWS, f"{where}.rows")):
            cells = _list(row, MAX_COLUMNS, f"{where}.rows[{r}]")
            rows.append([_text(cell, 200, f"{where}.rows[{r}]") for cell in cells])
        if not rows:
            raise PanelError(f"{where}.rows is empty")
        out.update(columns=columns, rows=rows)
    elif kind == "list":
        items = [_text(item, 300, f"{where}.items") for item in _list(block.get("items"), MAX_ROWS, f"{where}.items")]
        if not items:
            raise PanelError(f"{where}.items is empty")
        out.update(items=items, ordered=block.get("ordered") is True)
    elif kind == "params":
        items = []
        for i, item in enumerate(_list(block.get("items"), MAX_ROWS, f"{where}.items")):
            if not isinstance(item, dict):
                raise PanelError(f"{where}.items[{i}] must be {{label, value}}")
            items.append({"label": _text(item.get("label"), 60, f"{where}.items[{i}].label", True),
                          "value": _text(item.get("value"), 300, f"{where}.items[{i}].value")})
        if not items:
            raise PanelError(f"{where}.items is empty")
        out["items"] = items
    elif kind == "choices":
        options, ids = [], set()
        raw = _list(block.get("options"), 8, f"{where}.options")
        if len(raw) < 2:
            raise PanelError(f"{where}.options needs 2 to 8 options")
        for i, option in enumerate(raw):
            if not isinstance(option, dict):
                option = {"label": option}
            label = _text(option.get("label"), 80, f"{where}.options[{i}].label", True)
            option_id = _text(option.get("id") or f"o{i + 1}", 40, f"{where}.options[{i}].id")
            if option_id in ids:
                raise PanelError(f"{where}.options: id {option_id!r} twice")
            ids.add(option_id)
            options.append({"id": option_id, "label": label, "detail": _text(option.get("detail"), 200, f"{where}.options[{i}].detail")})
        out.update(question=_text(block.get("question"), 200, f"{where}.question"), options=options,
                   multiple=block.get("multiple") is True)
    elif kind == "input":
        out.update(question=_text(block.get("question"), 200, f"{where}.question", True),
                   placeholder=_text(block.get("placeholder"), 80, f"{where}.placeholder"))
    elif kind == "progress":
        value, top = block.get("value"), block.get("max", 100)
        if not all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in (value, top)) or top <= 0:
            raise PanelError(f"{where}: value and max must be numbers, max above 0")
        out.update(label=_text(block.get("label"), 120, f"{where}.label"), value=max(0, min(value, top)), max=top)
    elif kind == "divider":
        pass
    else:
        raise PanelError(f"{where}.type {kind!r} is not one of heading, text, images, models, table, list, params, "
                         "choices, input, progress, divider")
    if kind in INTERACTIVE:
        block_id = _text(block.get("id") or f"q{at + 1}", 40, f"{where}.id")
        if block_id in taken:
            raise PanelError(f"{where}.id {block_id!r} twice")
        taken.add(block_id)
        out["id"] = block_id
    return out


def clean_blocks(blocks):
    blocks = _list(blocks, MAX_BLOCKS, "blocks")
    if not blocks:
        raise PanelError("blocks is empty")
    taken = set()
    return [clean_block(block, at, taken) for at, block in enumerate(blocks)]


def _find(panel_id):
    """(task, step) holding panel `panel_id`, or (None, None). Call under the lock."""
    for task in ai_tasks._load().values():
        for step in task.get("steps") or []:
            if step.get("kind") == "panel" and step.get("panel", {}).get("id") == panel_id:
                return task, step
    return None, None


def show(client, title, blocks, now=None):
    title = _text(title, 120, "title", True)
    panel = {"id": uuid.uuid4().hex[:10], "title": title, "blocks": clean_blocks(blocks), "closed": False}
    now = time.time() if now is None else now
    step = {"id": uuid.uuid4().hex[:10], "at": now, "ms": 0, "tool": "show_panel", "kind": "panel", "ok": True,
            "summary": f"show_panel: {title}", "panel": panel, "answers": {}, "results": []}
    with ai_tasks._lock:
        task = ai_tasks.current_task(client, now)
        ai_tasks._add_step(task, step)
        ai_tasks._save(task)
    ai_tasks._notify(task["id"], {"panel": title, "asks": any(b["type"] in INTERACTIVE for b in panel["blocks"])})
    return panel


def update(panel_id, title=None, blocks=None, closed=None):
    with ai_tasks._lock:
        task, step = _find(str(panel_id))
        if not step:
            raise PanelError(f"No panel {panel_id!r}; show_panel returns its id.")
        panel = step["panel"]
        if title is not None:
            panel["title"] = _text(title, 120, "title", True)
        if blocks is not None:
            panel["blocks"] = clean_blocks(blocks)
            keep = {block["id"] for block in panel["blocks"] if block["type"] in INTERACTIVE}
            step["answers"] = {key: value for key, value in step.get("answers", {}).items() if key in keep}
        if closed is not None:
            panel["closed"] = bool(closed)
        task["updated"] = max(task.get("updated", 0), time.time())
        ai_tasks._save(task)
    ai_tasks._notify(task["id"])
    return panel


def answer(task_id, step_id, block_id, choice=None, text=None, now=None):
    """The user's answer to one block of a panel (from the page). Returns the step's answers."""
    with _answered:
        task = ai_tasks._load().get(task_id)
        step = next((item for item in (task or {}).get("steps") or [] if item.get("id") == step_id), None)
        if not step or step.get("kind") != "panel":
            raise PanelError("No such panel")
        if step["panel"].get("closed"):
            raise PanelError("The AI closed this panel")
        block = next((b for b in step["panel"]["blocks"] if b.get("id") == block_id), None)
        if not block:
            raise PanelError("No such question")
        if block_id in step.setdefault("answers", {}):
            raise PanelError("Already answered")
        entry = {"at": time.time() if now is None else now, "delivered": False}
        if block["type"] == "choices":
            picked = choice if isinstance(choice, list) else [choice]
            known = {option["id"]: option["label"] for option in block["options"]}
            picked = [str(item) for item in picked if str(item) in known]
            if not picked or (len(picked) > 1 and not block.get("multiple")):
                raise PanelError("Pick one of the options")
            entry.update(choice=picked, labels=[known[item] for item in picked])
        else:
            value = _text(text, 2000, "text", True)
            entry["text"] = value
        step["answers"][block_id] = entry
        task["updated"] = max(task.get("updated", 0), entry["at"])
        ai_tasks._save(task)
        _answered.notify_all()
        answers = dict(step["answers"])
    ai_tasks._notify(task_id)
    return answers


def _collect(client, panel_id):
    """Answers not given to the AI yet (its own tasks, or panel `panel_id`), marked as given. Under the lock."""
    out, waiting, changed = [], [], set()
    for task in ai_tasks._load().values():
        if panel_id is None and task.get("client") != client:
            continue
        for step in task.get("steps") or []:
            panel = step.get("panel")
            if step.get("kind") != "panel" or (panel_id is not None and panel["id"] != panel_id):
                continue
            for block in panel["blocks"]:
                if block["type"] not in INTERACTIVE:
                    continue
                given = step.get("answers", {}).get(block["id"])
                if not given:
                    if not panel.get("closed"):
                        waiting.append({"panel": panel["id"], "question": block["id"]})
                    continue
                if given.get("delivered"):
                    continue
                given["delivered"] = True
                changed.add(task["id"])
                item = {"panel": panel["id"], "question": block["id"], "asked": block.get("question", "")}
                item.update({key: given[key] for key in ("choice", "labels", "text") if key in given})
                out.append(item)
    for task_id in changed:
        ai_tasks._save(ai_tasks._load()[task_id])
    return out, waiting


def get_answers(client, panel_id=None, wait_seconds=0):
    """The user's new answers; with `wait_seconds`, waits up to that long (MAX_WAIT) for one."""
    deadline = time.monotonic() + max(0, min(float(wait_seconds or 0), MAX_WAIT))
    panel_id = str(panel_id) if panel_id else None
    with _answered:
        if panel_id is not None and _find(panel_id)[1] is None:
            raise PanelError(f"No panel {panel_id!r}; show_panel returns its id.")
        while True:
            answers, waiting = _collect(client, panel_id)
            left = deadline - time.monotonic()
            if answers or not waiting or left <= 0:
                return {"answers": answers, "still_waiting": waiting}
            _answered.wait(left)
