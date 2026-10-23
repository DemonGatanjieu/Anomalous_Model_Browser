"""Panels the AI draws in its task (show_panel), from Anomalous's own blocks, and the answers
the user gives on them.

A panel is a step of the AI's current task (ai_tasks.py) holding a title and a list of blocks:
heading, text, images (from ComfyUI's output folder, with marks: circles or boxes and a label
at places given as fractions of the picture), slider (two pictures over each other, a line to
drag between them), picks (pictures with a reason and "take this one"), models (the user's, by
model_id), diagram (boxes and arrows, laid out by the page; a box can name a canvas node),
table, list, params, choices (buttons; one or several picks) and input (a line of text),
progress, divider. Nothing the AI sends is run or rendered as markup, and no drawing of its own
(SVG) is taken: every block is checked here to be one of these shapes, with plain strings and
numbers of bounded size, pictures only from the output folder and models only from the user's
folders. The page draws them (ui_ai_panel.js).

The user's answers come back through POST /anomalous/ai_tasks/{task}/answer and wait in the
step until the AI asks for them (get_answers, which may wait a while for one) or makes its next
successful MCP tool call (attach_pending). The user can also write to the AI in a task
(POST /anomalous/ai_tasks/{task}/message): the message is a step of its own and reaches the AI
the same way.
"""

import os
import threading
import time
import uuid

import folder_paths

from . import ai_marks, ai_tasks
from .mcp_tools import tool_text

MAX_BLOCKS = 30
MAX_ITEMS = 12
MAX_ROWS = 30
MAX_COLUMNS = 8
MAX_WAIT = 55
TONES = ("normal", "muted", "tip", "warning")
LAYOUTS = ("row", "grid", "compare")
INTERACTIVE = ("choices", "input", "picks")
INPAINT_NOTE = (
    "The user painted where to repaint. LoadImage(image=inpaint_image) gives the picture and, as MASK, that area. "
    "inpaint_image is already in ComfyUI's input folder, ready: do not check it with a command; "
    "get_image_info(image=inpaint_image, folder='input', include_image=true) shows it and the area, zoom_image a part "
    "of it larger. Repaint with a workflow; do not paint the picture with code of your own. "
    "Use the picture's own model and prompt (get_image_info on image), e.g. new_workflow: CheckpointLoaderSimple, "
    "LoadImage, CLIPTextEncode x2, VAEEncode(pixels, vae) -> SetLatentNoiseMask(samples, mask) -> KSampler "
    "(denoise 0.5-0.8 keeps the look; 1.0 with VAEEncodeForInpaint(grow_mask_by 8) replaces it) -> VAEDecode -> "
    "SaveImage; GrowMask softens the edge. Say in report what you set and why, ask_user the strength if unsure, "
    "and show the old and new picture with a slider panel."
)
COLORS = ("red", "green", "blue", "yellow", "purple")
MAX_MARKS = 8
MAX_NODES = 24
MAX_EDGES = 40

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


def _fraction(value, where):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 <= value <= 1:
        raise PanelError(f"{where} must be a number from 0 to 1 (a fraction of the picture)")
    return round(float(value), 4)


def _marks(value, where):
    marks = []
    for i, mark in enumerate(_list(value, MAX_MARKS, where)):
        here = f"{where}[{i}]"
        if not isinstance(mark, dict):
            raise PanelError(f"{here} must be {{x, y, w, h | r, label, color}}")
        out = {"x": _fraction(mark.get("x"), f"{here}.x"), "y": _fraction(mark.get("y"), f"{here}.y"),
               "label": _text(mark.get("label"), 60, f"{here}.label"),
               "color": mark.get("color") if mark.get("color") in COLORS else "red"}
        if mark.get("w") is not None or mark.get("h") is not None:
            out.update(w=_fraction(mark.get("w"), f"{here}.w"), h=_fraction(mark.get("h"), f"{here}.h"))
        else:
            out["r"] = _fraction(mark.get("r", 0.06), f"{here}.r")
        marks.append(out)
    return marks


def _image(item, where):
    image = item.get("image") if isinstance(item, dict) else item
    found = ai_tasks._output_media(str(image or ""))
    if not found:
        raise PanelError(f"{where}: {image!r} is not a picture in ComfyUI's output folder (subfolder/name.png, as search_images gives it)")
    out = {**found, "caption": _text(item.get("caption") if isinstance(item, dict) else "", 120, f"{where}.caption")}
    if isinstance(item, dict) and item.get("marks"):
        out["marks"] = _marks(item["marks"], f"{where}.marks")
    return out


def _diagram(block, where):
    nodes, ids = [], set()
    for i, node in enumerate(_list(block.get("nodes"), MAX_NODES, f"{where}.nodes")):
        here = f"{where}.nodes[{i}]"
        if not isinstance(node, dict):
            raise PanelError(f"{here} must be {{id, label, detail, node_id}}")
        node_id = _text(node.get("id") or f"n{i + 1}", 40, f"{here}.id")
        if node_id in ids:
            raise PanelError(f"{here}.id {node_id!r} twice")
        ids.add(node_id)
        out = {"id": node_id, "label": _text(node.get("label"), 40, f"{here}.label", True),
               "detail": _text(node.get("detail"), 80, f"{here}.detail"),
               "color": node.get("color") if node.get("color") in COLORS else ""}
        if node.get("node_id") not in (None, ""):
            out["node_id"] = _text(node.get("node_id"), 20, f"{here}.node_id")
        nodes.append(out)
    if not nodes:
        raise PanelError(f"{where}.nodes is empty")
    edges = []
    for i, edge in enumerate(_list(block.get("edges"), MAX_EDGES, f"{where}.edges")):
        here = f"{where}.edges[{i}]"
        if not isinstance(edge, dict) or edge.get("from") not in ids or edge.get("to") not in ids:
            raise PanelError(f"{here} must be {{from, to, label}} naming two node ids")
        edges.append({"from": edge["from"], "to": edge["to"], "label": _text(edge.get("label"), 30, f"{here}.label")})
    return {"nodes": nodes, "edges": edges, "direction": "down" if block.get("direction") == "down" else "right"}


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
    elif kind == "slider":
        out.update(before=_image(block.get("before"), f"{where}.before"), after=_image(block.get("after"), f"{where}.after"),
                   before_label=_text(block.get("before_label"), 40, f"{where}.before_label"),
                   after_label=_text(block.get("after_label"), 40, f"{where}.after_label"))
    elif kind == "picks":
        items, ids = [], set()
        raw = _list(block.get("items"), MAX_ITEMS, f"{where}.items")
        if len(raw) < 2:
            raise PanelError(f"{where}.items needs 2 to {MAX_ITEMS} pictures")
        for i, item in enumerate(raw):
            here = f"{where}.items[{i}]"
            if not isinstance(item, dict):
                raise PanelError(f"{here} must be {{id, image, label, reason, recommended}}")
            item_id = _text(item.get("id") or f"p{i + 1}", 40, f"{here}.id")
            if item_id in ids:
                raise PanelError(f"{here}.id {item_id!r} twice")
            ids.add(item_id)
            picture = _image(item, here)
            items.append({**picture, "id": item_id, "label": _text(item.get("label"), 60, f"{here}.label"),
                          "reason": _text(item.get("reason"), 200, f"{here}.reason"), "recommended": item.get("recommended") is True})
        out.update(question=_text(block.get("question"), 200, f"{where}.question"), items=items,
                   multiple=block.get("multiple") is True)
    elif kind == "run_map":  # a run's real shape (ai_run_map.py), drawn by the page from the step; only show_run_map makes it
        out["step"] = _text(block.get("step"), 20, f"{where}.step", True)
    elif kind == "diagram":
        out.update(_diagram(block, where))
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
            options.append({"id": option_id, "label": label, "detail": _text(option.get("detail"), 200, f"{where}.options[{i}].detail"),
                            **({"recommended": True} if option.get("recommended") is True else {})})
        # other: a line for an answer none of the options is
        out.update(question=_text(block.get("question"), 200, f"{where}.question"), options=options,
                   multiple=block.get("multiple") is True, other=block.get("other") is True)
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
        raise PanelError(f"{where}.type {kind!r} is not one of heading, text, images, slider, picks, models, diagram, "
                         "table, list, params, choices, input, progress, divider")
    if kind in INTERACTIVE or block.get("id") is not None:
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


def _block_ids(blocks):
    """Stable handles for deliberate edits; old records get them only when updated."""
    taken = {block["id"] for block in blocks if block.get("id")}
    out = []
    for block in blocks:
        block = dict(block)
        if not block.get("id"):
            block_id = uuid.uuid4().hex[:10]
            while block_id in taken:
                block_id = uuid.uuid4().hex[:10]
            block["id"] = block_id
            taken.add(block_id)
        out.append(block)
    return out


def _merge_blocks(existing, incoming):
    """Keep the order already seen, append new output, edit only identified blocks in place."""
    merged = list(existing)
    by_id = {block["id"]: at for at, block in enumerate(existing) if block.get("id")}
    used = set()
    for raw, block in zip(incoming, clean_blocks(incoming)):
        if block["type"] in INTERACTIVE and not raw.get("id"):
            # Positional q1/q2 defaults cannot identify a question in a partial append.
            block.pop("id")
        at = by_id.get(block.get("id"))
        if at is None and not block.get("id"):
            # A client may send its entire previous layout again. That cannot reorder it.
            at = next((i for i, old in enumerate(existing) if i not in used
                       and {key: value for key, value in old.items() if key != "id"} == block), None)
            if at is None and block["type"] == "progress":
                matches = [i for i, old in enumerate(existing) if old["type"] == "progress"
                           and old.get("label") == block.get("label")]
                if len(matches) == 1:
                    at = matches[0]
        if at is None:
            merged.append(block)
        else:
            if existing[at]["type"] != block["type"]:
                raise PanelError("An existing block id must keep its type; use a new id for new output.")
            merged[at] = {**block, **({"id": existing[at]["id"]} if existing[at].get("id") else {})}
            used.add(at)
    if len(merged) > MAX_BLOCKS:
        raise PanelError(f"The panel would exceed {MAX_BLOCKS} blocks; use show_panel for the next stage of work.")
    return _block_ids(merged)


def _find(panel_id):
    """(task, step) holding panel `panel_id`, or (None, None). Call under the lock."""
    for task in ai_tasks._load().values():
        for step in task.get("steps") or []:
            if step.get("kind") == "panel" and step.get("panel", {}).get("id") == panel_id:
                return task, step
    return None, None


def show(client, title, blocks, now=None, session="", task_id=None, tool="show_panel"):
    title = _text(title, 120, "title", True)
    panel = {"id": uuid.uuid4().hex[:10], "title": title, "blocks": _block_ids(clean_blocks(blocks)), "closed": False}
    now = time.time() if now is None else now
    step = {"id": uuid.uuid4().hex[:10], "at": now, "ms": 0, "tool": tool, "kind": "panel", "ok": True,
            "summary": f"{tool}: {title}", "panel": panel, "answers": {}, "results": []}
    with ai_tasks._lock:
        task = ai_tasks.current_task(client, now, session=session, task_id=task_id)
        ai_tasks._add_step(task, step)
        ai_tasks._save(task)
    ai_tasks._notify(task["id"], {"panel": title, "asks": any(b["type"] in INTERACTIVE for b in panel["blocks"])})
    return panel


def update(panel_id, title=None, blocks=None, closed=None):
    with ai_tasks._lock:
        task, step = _find(str(panel_id))
        if not step:
            raise PanelError(f"No panel {panel_id!r}; show_panel returns its id.")
        # Validate the whole update before replacing the saved panel.
        panel = dict(step["panel"])
        if title is not None:
            panel["title"] = _text(title, 120, "title", True)
        if blocks is not None:
            panel["blocks"] = _merge_blocks(panel["blocks"], blocks)
        if closed is not None:
            panel["closed"] = bool(closed)
        step["panel"] = panel
        task["updated"] = max(task.get("updated", 0), time.time())
        ai_tasks._save(task)
    ai_tasks._notify(task["id"])
    return panel


def answer(task_id, step_id, block_id, choice=None, text=None, now=None, skip=False):
    """The user's answer to one block of a panel (from the page), or `skip` it. Returns the step's answers."""
    with _answered:
        task = ai_tasks._load().get(task_id)
        step = next((item for item in (task or {}).get("steps") or [] if item.get("id") == step_id), None)
        if not step or step.get("kind") != "panel":
            raise PanelError("No such panel")
        if step["panel"].get("closed"):
            raise PanelError("The AI closed this panel")
        block = next((b for b in step["panel"]["blocks"] if b.get("id") == block_id), None)
        if not block or block["type"] not in INTERACTIVE:
            raise PanelError("No such question")
        if block_id in step.setdefault("answers", {}):
            raise PanelError("Already answered")
        entry = {"at": time.time() if now is None else now, "delivered": False}
        if skip:
            entry["skipped"] = True
        elif block["type"] == "choices" and block.get("other") and not choice and isinstance(text, str) and text.strip():
            entry.update(choice=["other"], labels=["other"], text=_text(text, 2000, "text", True))
        elif block["type"] in ("choices", "picks"):
            picked = choice if isinstance(choice, list) else [choice]
            options = block["options"] if block["type"] == "choices" else block["items"]
            known = {option["id"]: option.get("label") or option["id"] for option in options}
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


MAX_MESSAGE = 2000


def leave_message(task_id, text, refs=None, now=None):
    """A message from the user to the AI working on task `task_id`, with what its "@" point at and
    the pictures attached (ai_message_refs.py); words may be left out when something is attached.
    Returns the step."""
    from . import ai_message_refs

    try:
        refs = ai_message_refs.clean(refs)
    except ai_message_refs.RefsError as error:
        raise PanelError(str(error))
    text = _text(text, MAX_MESSAGE, "text", not refs)
    now = time.time() if now is None else now
    step = {"id": uuid.uuid4().hex[:10], "at": now, "ms": 0, "tool": "user_message", "kind": "user", "ok": True,
            "summary": "user_message", "text": text, "delivered": False, "results": [], **({"refs": refs} if refs else {})}
    with _answered:
        task = ai_tasks._load().get(task_id)
        if not task:
            raise PanelError("No such task")
        task["steps"].append(step)
        del task["steps"][:-ai_tasks.MAX_STEPS]
        task["updated"] = max(task.get("updated", 0), now)
        ai_tasks._save(task)
        _answered.notify_all()
    ai_tasks._notify(task_id)
    return step


def _collect(client, panel_id, task_id=None):
    """Answers and messages not given to the AI yet (its own tasks, task `task_id`, or panel
    `panel_id` and the messages of that panel's task), marked as given. Under the lock."""
    out, waiting, messages, changed = [], [], [], set()
    tasks = ai_tasks._load()
    panel_task = _find(panel_id)[0] if panel_id is not None else None
    named_task = tasks.get(task_id) if task_id else None
    for task in tasks.values():
        if panel_id is not None:
            if task is not panel_task:
                continue
        elif task_id is not None:
            if task is not named_task:
                continue
        elif task.get("client") != client:
            continue
        for step in task.get("steps") or []:
            if step.get("kind") == "user" and not step.get("delivered") and (panel_id is None or task is panel_task):
                step.update(delivered=True, delivered_at=time.time())
                changed.add(task["id"])
                message = {"id": step["id"], "task": task["id"], "text": step["text"], "at": step["at"]}
                if step.get("tool") == "user_activity":
                    message["kind"] = "change"  # something the user changed in Anomalous, not words to the AI
                elif step.get("tool") == "user_pictures":
                    from . import ai_pictures
                    message.update(ai_pictures.message_of(step))  # the pictures themselves go with it
                elif step.get("refs"):
                    from . import ai_message_refs
                    message.update(ai_message_refs.message_of(step))  # what its "@" point at, pictures attached
                elif step.get("tool") == "user_stop":
                    message["kind"] = "stop"  # the user stopped the AI's run (ai_run_control.py)
                elif step.get("tool") == "user_toolbox":
                    message["kind"] = "toolbox"  # what the user picked for the AI to work with (ai_toolbox.py)
                elif step.get("tool") == "user_marks":
                    # Marks on a picture: the picture's path for the AI, and the marked one attached (ai_marks.image_items).
                    message.update(kind="marks", image="/".join(part for part in (step["image"].get("subfolder"), step["image"]["filename"]) if part),
                                   _marked=ai_marks.path_of(task["id"], step.get("marked")))
                    if step.get("inpaint"):
                        message.update(inpaint_image=step["inpaint"], inpaint_note=INPAINT_NOTE)
                messages.append(message)
                continue
            asked = step.get("gate") or {}
            if asked.get("timed_out") and asked.get("decision") and not asked.get("delivered") and panel_id is None:
                asked["delivered"] = True
                changed.add(task["id"])
                messages.append({"id": step["id"], "task": task["id"], "kind": "gate", "at": asked.get("at"),
                                 "text": (f"The user allowed {step['tool']}: call it again with the same arguments now."
                                          if asked["decision"] == "allow" else
                                          f"The user said no to {step['tool']}." + (f" They said: {asked['text']}" if asked.get("text") else ""))})
                continue
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
                given.update(delivered=True, delivered_at=time.time())
                changed.add(task["id"])
                item = {"panel": panel["id"], "question": block["id"], "asked": block.get("question", "")}
                item.update({key: given[key] for key in ("choice", "labels", "text", "skipped") if key in given})
                out.append(item)
    for tid in changed:
        ai_tasks._save(tasks[tid])
    return out, waiting, messages, changed


def wake():
    """Anything waiting in get_answers looks again (the user added something to a task)."""
    with _answered:
        _answered.notify_all()


def get_answers(client, panel_id=None, wait_seconds=0, task_id=None):
    """The user's new answers and messages; with `wait_seconds`, waits up to that long (MAX_WAIT)
    for one: for a panel's question still open, or (no panel named) for anything the user sends."""
    deadline = time.monotonic() + max(0, min(float(wait_seconds or 0), MAX_WAIT))
    panel_id = str(panel_id) if panel_id else None
    notified = set()
    try:
        with _answered:
            if panel_id is not None and _find(panel_id)[1] is None:
                raise PanelError(f"No panel {panel_id!r}; show_panel returns its id.")
            while True:
                answers, waiting, messages, changed = _collect(client, panel_id, task_id=task_id)
                notified.update(changed)
                left = deadline - time.monotonic()
                if answers or messages or left <= 0 or (panel_id is not None and not waiting):
                    answer = {"answers": answers, "still_waiting": waiting}
                    if messages:
                        answer["messages"] = messages
                    return answer
                _answered.wait(left)
    finally:
        for tid in notified:
            ai_tasks._notify(tid)


def attach_pending(result, client, task_id=None):
    """Attaches unread user messages and panel answers to a successful tool result so an AI
    that does not call get_answers still receives them once."""
    if not isinstance(result, dict) or result.get("isError"):
        return result
    with _answered:
        answers, waiting, messages, changed = _collect(client, None, task_id=task_id)
    for tid in changed:
        ai_tasks._notify(tid)
    if not answers and not messages:
        return result
    data = result.get("structuredContent")
    data = dict(data) if isinstance(data, dict) else {}
    if messages:
        data["user_messages"] = messages
    if answers:
        data["user_answers"] = answers
    if waiting:
        data["still_waiting"] = waiting
    data["user_notice"] = (
        "The user sent new input in the AI workbench. Read user_messages / user_answers and follow them; you may "
        "reply in your chat or in Anomalous (report(reply_to=<its id>)), but once you and the user settle what to do, "
        "record it with log_decision so the decision stays in Anomalous; "
        "kind=change messages are changes the user made themselves while you worked: keep them, do not undo them; "
        "kind=marks messages are places the user marked on a picture to change (the marked picture is attached): "
        "say what you see and how you would fix it (show_panel can show the picture with your own marks), "
        "ask_user which fix to do, and log_decision the fix chosen (related: the marks' id); "
        "kind=toolbox messages are the nodes, combos, workflows, prompts and models the user picked for you to use; "
        "kind=stop: the user stopped your run, so do not run it again until they say what to change; "
        "kind=pictures: pictures the user handed you (attached), with made_with read from each picture's own workflow."
    )
    pictures = ai_marks.image_items(messages)
    result["structuredContent"] = data
    content = list(result.get("content") or [])
    if content and isinstance(content[0], dict) and content[0].get("type") == "text":
        content[0] = {"type": "text", "text": tool_text(data)}
    else:
        content.insert(0, {"type": "text", "text": tool_text(data)})
    result["content"] = content + pictures
    return result
