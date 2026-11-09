"""任务单 (the job sheet): many runs of one workflow one after another. Each row is a prompt, settings by
name, or nothing (the workflow as it is), with how many runs it gets; a pause between pictures if wanted. The
ComfyUI page runs it (web/modules/job_sheet_run.js): it keeps the workflow as it was at the start, queues each
run from a copy off the canvas, and the next one only when the one before has ended and the pause is over (one
ahead with no pause). This file keeps the one sheet of this ComfyUI and where it stands: its rows, the runs'
prompt ids, the pictures made, the page running it and what was asked of that page (pause, stop, go on). A
page that said nothing for STALE seconds is gone: the sheet waits for a page to take it over, the same tab
after a reload by itself. Stop takes the sheet's waiting runs out of ComfyUI's queue here and interrupts its
running one. A sheet an AI gave (run_workflow(sheet=…), mcp_actions.py) is that call's step in the task: its
progress, pictures and end are written on the step (ai_tasks.py), so run_status and the workbench follow it
like a run. Kept in user/anomalous/job_sheet.json and its workflow beside it; every change goes to the pages
as "anomalous.job_sheet"."""

import json
import os
import random
import re
import threading
import time
import uuid

from aiohttp import web

from . import ai_tasks
from .path_utils import atomic_write_json

MAX_ROWS = 200
MAX_COUNT = 50  # runs of one row
MAX_TOTAL = 1000  # runs of a sheet
MAX_PAUSE = 3600  # seconds between pictures
MAX_TEXT = 20000
MAX_WORKFLOW = 20 * 1024 * 1024
STALE = 45  # seconds without word from the page running a sheet: that page is gone
LAST = 8  # newest pictures the card shows
SEED_TOP = 1125899906842624  # ComfyUI's widest seed; web/modules/snapshot_plan.js
ENDED = ("done", "stopped")
WANTS = ("pause", "stop", "go")
ROW_KEYS = ("prompt", "negative", "values", "count")
PAGE = re.compile(r"^[0-9A-Za-z-]{8,64}$")
SHEET, WORKFLOW = "job_sheet.json", "job_sheet_workflow.json"

_lock = threading.Lock()


class SheetError(ValueError):
    """What is wrong with a sheet or a word about it, said to whoever gave it."""


def _path(name):
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), name)


def _load():
    try:
        with open(_path(SHEET), encoding="utf-8") as source:
            sheet = json.load(source)
    except (OSError, ValueError):
        return None
    return sheet if isinstance(sheet, dict) and sheet.get("id") else None


def _stale(sheet, now=None):
    return (time.time() if now is None else now) - sheet.get("heard", 0) > STALE


def public(sheet):
    """What the pages and the AI see of `sheet`: all but the runs' ids, with the run going (`now`, its place in
    the sheet) and whether its page is gone."""
    if not sheet:
        return None
    now = dict(sheet["ids"]).get(sheet["pending"][0]) if sheet["pending"] else None
    return {**{key: value for key, value in sheet.items() if key != "ids"}, "now": now, "stale": _stale(sheet)}


def _tell(sheet):
    try:
        from server import PromptServer
        PromptServer.instance.send_sync("anomalous.job_sheet", {"sheet": public(sheet)})
    except Exception:  # noqa: BLE001 - tests and early start have no server; the page reads it on open
        pass


def _save(sheet):
    atomic_write_json(_path(SHEET), sheet)
    _tell(sheet)


def _count(value, what):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_COUNT:
        raise SheetError(f"{what} is a whole number from 1 to {MAX_COUNT}.")
    return value


def pause_of(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= MAX_PAUSE:
        raise SheetError(f"pause is seconds between pictures, 0 to {MAX_PAUSE}.")
    return round(float(value), 1)


def rows_of(rows, count=1):
    """The rows checked: [{prompt?, negative?, values?, count}]. A row given as text is its prompt; a row with
    none of them runs the workflow as it is. `count`: a row's runs when it does not say."""
    from .mcp_fill import node_values
    from .mcp_tools import ToolError

    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS:
        raise SheetError(f"rows is a list of 1 to {MAX_ROWS} rows.")
    count = _count(count, "count")
    out = []
    for at, row in enumerate(rows, 1):
        row = {"prompt": row} if isinstance(row, str) else row
        if not isinstance(row, dict):
            raise SheetError(f"Row {at} is a prompt, or {{prompt, negative, values, count}}.")
        unknown = sorted(set(row) - set(ROW_KEYS))
        if unknown:
            raise SheetError(f"Row {at}: {', '.join(unknown)[:80]} is no part of a row ({', '.join(ROW_KEYS)}).")
        item = {}
        for key in ("prompt", "negative"):
            text = row.get(key)
            if text is None:
                continue
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
                raise SheetError(f"Row {at}: {key} is text of up to {MAX_TEXT} characters.")
            item[key] = text
        if row.get("values") is not None:
            try:
                item["values"] = node_values(row["values"])
            except ToolError as error:
                raise SheetError(f"Row {at}: {error}") from error
        item["count"] = _count(row.get("count", count), f"Row {at}'s count")
        out.append(item)
    total = sum(item["count"] for item in out)
    if total > MAX_TOTAL:
        raise SheetError(f"{total} runs in all; a sheet takes up to {MAX_TOTAL}.")
    return out


def current():
    return public(_load())


def workflow():
    try:
        with open(_path(WORKFLOW), encoding="utf-8") as source:
            return json.load(source)
    except (OSError, ValueError):
        return None


def _end_old(sheet):
    """An unfinished sheet a new one replaces: it ends stopped, on its step too."""
    if sheet and sheet["state"] not in ENDED:
        sheet.update(state="stopped", want=None, note=sheet.get("note") or "replaced")
        _sync_step(sheet)


def start(body):
    """A new sheet from the page that runs it: {rows, count?, pause?, same_seeds?, workflow, title?, page, task?}."""
    page = body.get("page")
    if not isinstance(page, str) or not PAGE.match(page):
        raise SheetError("page is the id of the page that runs the sheet.")
    rows = rows_of(body.get("rows"), body.get("count", 1))
    pause = pause_of(body.get("pause", 0))
    flow = body.get("workflow")
    if not isinstance(flow, dict) or not flow.get("nodes"):
        raise SheetError("The sheet needs the workflow it runs, with its nodes.")
    if len(json.dumps(flow)) > MAX_WORKFLOW:
        raise SheetError("This workflow is too big for a sheet.")
    task = body.get("task") if isinstance(body.get("task"), str) and ai_tasks.get_task(body["task"]) else None
    now = time.time()
    with _lock:
        old = _load()
        if old and old["state"] not in ENDED and not _stale(old, now):
            raise SheetError(f"A sheet is going ({old['done']} of {old['total']} runs done): stop it first, or wait.")
        _end_old(old)
        sheet = {"id": uuid.uuid4().hex[:12], "by": "ai" if task else "user", "task": task, "step": None,
                 "title": str(body.get("title") or "")[:120], "rows": rows, "pause": pause,
                 "same_seeds": bool(body.get("same_seeds")), "base": random.randrange(SEED_TOP - MAX_COUNT),
                 "total": sum(row["count"] for row in rows), "state": "running", "want": None, "at": 0, "done": 0,
                 "failed": 0, "pictures": 0, "last": [], "ids": [], "pending": [], "page": page, "heard": now,
                 "started": now, "ended": None, "note": ""}
        atomic_write_json(_path(WORKFLOW), flow)
        _save(sheet)
    return public(sheet)


def _pictures(prompt_id):
    """The pictures run `prompt_id` saved, from ComfyUI's history."""
    from .ai_task_runs import _queue, outputs_of

    try:
        record = _queue().get_history(prompt_id=prompt_id).get(prompt_id)
    except Exception:  # noqa: BLE001 - only the pictures are missed; the page said the run ended
        return []
    return outputs_of(record) if record else []


def _drop(prompt_ids):
    """`prompt_ids` out of ComfyUI's queue, the one running interrupted (ai_run_control.py: only while it is ours)."""
    if not prompt_ids:
        return
    from .ai_run_control import _interrupt
    from .ai_task_runs import _queue

    try:
        queue = _queue()
        for prompt_id in prompt_ids:
            queue.delete_queue_item(lambda item, pid=prompt_id: item[1] == pid)
            _interrupt(queue, prompt_id)
    except Exception:  # noqa: BLE001 - the queue may be gone with ComfyUI; nothing is left to stop then
        pass


def report(body):
    """Word from the page running the sheet: {id, page, at, queued: [[prompt id, run]], finished: [[prompt id,
    outcome]], state?, note?}; outcome "ok", "error" or "gone" (taken out of the queue). Answers the sheet,
    whose `want` says what was asked of the page."""
    pictures, dropped = [], []
    with _lock:
        sheet = _load()
        if not sheet or sheet["id"] != body.get("id"):
            raise SheetError("This sheet is gone.")
        if sheet["page"] != body.get("page"):
            raise SheetError("Another page runs this sheet now.")
        if sheet["state"] in ENDED:
            return public(sheet)
        sheet["heard"] = time.time()
        known = {pid for pid, _ in sheet["ids"]}
        for item in body.get("queued") or []:
            if (isinstance(item, list) and len(item) == 2 and isinstance(item[0], str) and 0 < len(item[0]) <= 128
                    and isinstance(item[1], int) and item[0] not in known):
                sheet["ids"].append(item)
                sheet["pending"].append(item[0])
                known.add(item[0])
                if sheet["want"] == "stop":
                    dropped.append(item[0])  # queued as stop was asked: it goes too
        for item in body.get("finished") or []:
            if not (isinstance(item, list) and len(item) == 2 and item[0] in sheet["pending"]):
                continue
            sheet["pending"].remove(item[0])
            sheet["done"] += 1
            if item[1] == "error":
                sheet["failed"] += 1
            made = _pictures(item[0]) if item[1] == "ok" else []
            pictures += made
            sheet["pictures"] += len(made)
        if pictures:
            sheet["last"] = (sheet["last"] + pictures)[-LAST:]
        at = body.get("at")
        if isinstance(at, int) and 0 <= at <= sheet["total"]:
            sheet["at"] = at
        state = body.get("state")
        if state in ("running", "paused", "stopped", "done"):
            if state != sheet["state"]:
                sheet["want"] = None
            sheet["state"] = state
            if state in ENDED:
                sheet["ended"] = time.time()
        if isinstance(body.get("note"), str):
            sheet["note"] = body["note"][:500]
        _save(sheet)
        _sync_step(sheet, pictures)
    _drop(dropped)
    return public(sheet)


def ask(sheet_id, want, page=None):
    """The user or the AI asks the sheet to pause, stop or go on. A live page running it hears it and answers by
    its report; with that page gone it is done here, and "go" makes the asking page the one that runs it.
    Answers {sheet, run}: run means the asking page runs the sheet from now on."""
    if want not in WANTS:
        raise SheetError(f"want is one of {', '.join(WANTS)}.")
    dropped = []
    with _lock:
        sheet = _load()
        if not sheet or sheet["id"] != sheet_id:
            raise SheetError("This sheet is gone.")
        if sheet["state"] in ENDED:
            if want == "go":
                raise SheetError("This sheet has ended; start it again.")
            return {"sheet": public(sheet), "run": False}
        alive = not _stale(sheet)
        if want == "stop":
            dropped = list(sheet["pending"])  # here, whoever runs it: the GPU is free at once
        if want == "go" and (not alive or sheet["page"] == page):
            if not isinstance(page, str) or not PAGE.match(page):
                raise SheetError("Go on from a ComfyUI page: the sheet runs there.")
            sheet.update(state="running", want=None, page=page, heard=time.time(), note="")
            run = True
        elif alive and sheet["page"] != page:
            sheet["want"] = want
            run = False
        else:  # no live page runs it, or the asking page does: it is done here
            sheet["want"] = None
            sheet["state"] = "stopped" if want == "stop" else "paused" if want == "pause" else sheet["state"]
            if want == "stop":
                sheet["ended"] = time.time()
            run = False
        _save(sheet)
        _sync_step(sheet)
    _drop(dropped)
    return {"sheet": public(sheet), "run": run}


def clear(sheet_id):
    """Takes away a sheet that is not going (the card's close)."""
    with _lock:
        sheet = _load()
        if not sheet or sheet["id"] != sheet_id:
            return
        if sheet["state"] not in ENDED and not _stale(sheet):
            raise SheetError("This sheet is going: stop it first.")
        _end_old(sheet)
        for name in (SHEET, WORKFLOW):
            try:
                os.remove(_path(name))
            except OSError:
                pass
    _tell(None)


def attach(sheet_id, step_id):
    """The AI's call that started sheet `sheet_id` became run step `step_id` (mcp_server.py)."""
    with ai_tasks._lock:
        task_id = next((task["id"] for task in ai_tasks._load().values()
                        if any(step["id"] == step_id for step in task.get("steps") or [])), None)
    with _lock:
        sheet = _load()
        if not task_id or not sheet or sheet["id"] != sheet_id:
            return
        sheet.update(task=task_id, step=step_id)
        atomic_write_json(_path(SHEET), sheet)
        _sync_step(sheet)


def _words(sheet):
    return f"任务单 {sheet['done']}/{sheet['total']} / Job sheet: {sheet['done']} of {sheet['total']} runs"


def _sync_step(sheet, pictures=()):
    """Where the sheet stands, on the task step that started it: its progress while it goes, the newest pictures,
    and its end as a run's (done, cancelled, error; the line to paste to the AI as ai_task_runs.py gives it)."""
    if not sheet.get("task") or not sheet.get("step"):
        return
    from . import ai_gates

    with ai_tasks._lock:
        task = ai_tasks._load().get(sheet["task"])
        step = next((item for item in (task or {}).get("steps", []) if item["id"] == sheet["step"]), None)
        if not step:
            return
        step["sheet"] = sheet["id"]
        step["sheet_total"] = sheet["total"]
        if pictures:
            kept = [item for item in step["results"] if item["type"] != "image"]
            shown = [item for item in step["results"] if item["type"] == "image"]
            step["results"] = kept + (shown + list(pictures))[-ai_tasks.MAX_RESULTS:]
        if sheet["state"] not in ENDED:
            step["state"] = "running"
            paused = " · 暂停 / paused" if sheet["state"] == "paused" else ""
            step["progress"] = {"state": "running", "prompts": sheet["total"], "prompt": min(sheet["done"] + 1, sheet["total"]),
                                "note": _words(sheet) + paused + (f" · {sheet['note']}" if sheet["note"] else "")}
        elif step.get("state") == "running":
            step.pop("progress", None)
            failed = sheet["failed"] and not sheet["pictures"]
            step["state"] = "cancelled" if sheet["state"] == "stopped" else "error" if failed else "done"
            step["prompts"] = sheet["done"]
            if sheet["failed"]:
                step["error"] = f"{sheet['failed']} of {sheet['done']} runs failed. {sheet['note']}".strip()
                step["ok"] = not failed
            step["ms"] = int((time.time() - step["at"]) * 1000)
            if step["state"] in ("done", "error") and not step.get("told") and ai_gates.run_wait() == "call":
                step["call_ai"] = True
        task["updated"] = max(task["updated"], time.time())
        ai_tasks._save(task)
    ai_tasks._notify(sheet["task"])


# ---------------------------------------------------------------- routes

async def _body(request):
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise SheetError("Expected a JSON object.")
    return body


def _answer(run):
    async def handler(request):
        import asyncio

        try:
            body = await _body(request) if request.method == "POST" else {}
            return web.json_response(await asyncio.to_thread(run, body))
        except SheetError as error:
            return web.json_response({"error": str(error)}, status=400)
    return handler


api_get = _answer(lambda body: {"sheet": current()})
api_workflow = _answer(lambda body: {"workflow": workflow()})
api_start = _answer(lambda body: {"sheet": start(body)})
api_report = _answer(lambda body: {"sheet": report(body)})
api_ask = _answer(lambda body: ask(body.get("id"), body.get("want"), body.get("page")))
api_clear = _answer(lambda body: clear(body.get("id")) or {"sheet": None})
