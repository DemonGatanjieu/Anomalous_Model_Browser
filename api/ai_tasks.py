"""AI tasks: what AI apps did through Anomalous's MCP endpoint, kept for the AI workbench page.

Every tool call an AI app makes (mcp_server.py) becomes a step of a task: a task is one piece
of work, named by the AI with begin_task, else the calls of one app that follow each other
without a long pause. A step starts in state "running" when the call begins and is updated in
place when it finishes: what was done (the tool, a short summary of its arguments), whether it
worked, and what came out of it, so the page can show it live and lead there: the models it
used, the combo it placed, the canvas change it made (by its activity log entry, for undo),
the pictures a run made (ai_task_runs.py watches ComfyUI's history until the run ends), the
audio it spoke. The AI can also leave a note (report), with pictures it made another way. What
each tool is (kind, stage of the work, gate) is action_catalog.py's; the user's own changes
made while an AI works join its task through ai_task_changes.py. A step a restart left
"running" is marked stopped when the record is read again.

The user can start a task first (New task, POST /anomalous/ai_tasks): it waits for an AI, and
the next app that calls takes it over, so the work it does next starts there instead of joining
the app's last task. Likewise an app whose task ended or paused goes on in the task the user wrote
to (a message, marks, pictures, materials) that it has not read yet, rather than starting one.

Tasks are files in the ComfyUI user folder (anomalous/ai_tasks/<id>.json), the newest
MAX_TASKS kept. Recording never fails a tool call: the record is a convenience. The page
learns of a change through the "anomalous.ai_task" event. Reading is open like the other
pages; renaming and removing are writes (local_guard.py keeps them to this computer). The
routes are in ai_tasks_routes.py.
"""

import json
import logging
import os
import re
import shutil
import threading
import time
import uuid

import folder_paths

from . import action_catalog, activity_log
from .path_utils import atomic_write_json

FORMAT = 1
MAX_TASKS = 300
MAX_STEPS = 400
MAX_TASK_BYTES = 2 * 1024 * 1024
IDLE_SECONDS = 20 * 60  # a longer pause between calls of one app starts a new task
WAITING_SECONDS = 12 * 60 * 60  # a task the user started waits this long for an AI to take it
MAX_TEXT = 300
MAX_NOTE = 2000
MAX_TITLE = 80
MAX_RESULTS = 40
RUN_WATCH_SECONDS = 30 * 60
MEDIA_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm"}

# What each tool is (its kind, stage and gate) is action_catalog.py's.
OWN_STEPS = {"report", "log_decision", "log_outside", "show_panel", "ask_user", "show_run_map", "propose_repaint_area"}  # make their step themselves (with its text or panel)

_lock = threading.RLock()
_tasks = None  # id -> task
_current = {}  # client/session key -> id of the task its calls go to
_waiting = [None]  # id of the task the user started that no AI has taken yet

log = logging.getLogger(__name__)


# ---------------------------------------------------------------- storage

def tasks_dir():
    user_dir = folder_paths.get_user_directory() if hasattr(folder_paths, "get_user_directory") else None
    if not user_dir:
        user_dir = os.path.join(folder_paths.base_path, "user")
    directory = os.path.join(user_dir, "anomalous", "ai_tasks")
    os.makedirs(directory, exist_ok=True)
    return directory


def _path(task_id):
    return os.path.join(tasks_dir(), f"{task_id}.json")


def marks_dir(task_id):
    """Where the pictures the user marked for a task are kept (ai_marks.py); gone with the task."""
    return os.path.join(os.path.dirname(tasks_dir()), "ai_marks", re.sub(r"[^\w-]", "", task_id))


def _forget(task_id):
    """The task's own files: its record and its marked pictures (the plugin's, not the user's pictures)."""
    try:
        os.remove(_path(task_id))
    except OSError:
        pass
    shutil.rmtree(marks_dir(task_id), ignore_errors=True)


def _load():
    global _tasks
    if _tasks is None:
        _tasks = {}
        for name in os.listdir(tasks_dir()):
            if not name.endswith(".json"):
                continue
            try:
                with open(os.path.join(tasks_dir(), name), encoding="utf-8") as source:
                    task = json.load(source)
            except (OSError, ValueError):
                continue
            if isinstance(task, dict) and task.get("format") == FORMAT and isinstance(task.get("id"), str):
                _tasks[task["id"]] = task
                if _stop_running(task):
                    _save(task)
        # A task the user started before ComfyUI restarted still waits for the next AI.
        waiting = [task for task in _tasks.values() if task.get("waiting") and not task.get("ended")]
        if waiting and _waiting[0] is None:
            _waiting[0] = max(waiting, key=lambda task: task.get("started", 0))["id"]
    return _tasks


def _stop_running(task):
    """Steps a call or a run left "running" when ComfyUI stopped: nothing watches them any more."""
    stopped = False
    for step in task.get("steps") or []:
        if step.get("state") == "asking" and step.get("gate") and not step["gate"].get("timed_out"):
            step["gate"]["timed_out"] = True  # no old process is still waiting for this decision
            stopped = True
        if step.get("state") == "running":
            step.update(state="stopped", ok=False, error="ComfyUI 重启时这一步还没结束 / ComfyUI restarted before this step ended")
            stopped = True
    return stopped


def _save(task):
    try:
        atomic_write_json(_path(task["id"]), task, MAX_TASK_BYTES)
    except (OSError, ValueError) as error:
        log.warning("Anomalous AI tasks: %s not saved: %s", task["id"], error)


def _drop_oldest():
    tasks = _load()
    if len(tasks) <= MAX_TASKS:
        return
    for task in sorted(tasks.values(), key=lambda item: item.get("updated", 0))[: len(tasks) - MAX_TASKS]:
        tasks.pop(task["id"], None)
        _forget(task["id"])  # the pictures and files it made stay


def _notify(task_id, extra=None):
    try:
        from server import PromptServer
        PromptServer.instance.send_sync("anomalous.ai_task", {"id": task_id, **(extra or {})})
    except Exception:  # noqa: BLE001 - tests and early start have no server; the page polls on open
        pass


# ---------------------------------------------------------------- who is calling (named in ai_callers.py)

def _owner_key(client, session=""):
    return f"{client}::{session}" if session else client


def _bind_owner(client, session, task_id):
    _current[_owner_key(client, session)] = task_id
    if not session or client not in _current:
        _current[client] = task_id


# ---------------------------------------------------------------- tasks and steps

def _short(value, limit=MAX_TEXT):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit] + "…"


def _new_task(client, title="", now=None, session=""):
    now = time.time() if now is None else now
    task = {"format": FORMAT, "id": f"{int(now)}_{uuid.uuid4().hex[:8]}", "title": _short(title, MAX_TITLE),
            "title_from": "ai" if title else "auto", "client": client, "started": now, "updated": now,
            "ended": None, "steps": []}
    if session:
        task["session"] = session
    _load()[task["id"]] = task
    _bind_owner(client, session, task["id"])
    _drop_oldest()
    return task


def _claim_explicit(tasks, task_id, client, session=""):
    if not task_id or task_id not in tasks or tasks[task_id].get("ended"):
        return None
    picked = tasks[task_id]
    if picked.get("waiting"):
        if _waiting[0] == task_id:
            _waiting[0] = None
        picked["waiting"] = False
    if not picked.get("client"):
        picked["client"] = client
    _bind_owner(client, session, task_id)
    return picked


def _take_waiting(client, now, session=""):
    """The task the user started, now this app's (its own open task ends), or None."""
    task = _load().get(_waiting[0])
    _waiting[0] = None
    if not task or task.get("ended") or now - task.get("started", 0) > WAITING_SECONDS:
        return None
    owner = _owner_key(client, session)
    previous = _load().get(_current.get(owner) or (None if session else _current.get(client)))
    if previous and previous is not task and not previous.get("ended"):
        previous["ended"] = previous.get("updated")
        _save(previous)
    task["client"] = client
    if session:
        task["session"] = session
    task["waiting"] = False
    _bind_owner(client, session, task["id"])
    return task


ABOUT_TYPES = {"model": "model_id", "image": "image", "combo": "name", "workflow": "name"}  # what a task the user starts can be about


def _about(items):
    """What the user handed to the AI with a task (a model, an output image, a combo), checked: plain strings only."""
    out = []
    for item in items if isinstance(items, list) else []:
        key = ABOUT_TYPES.get(item.get("type")) if isinstance(item, dict) else None
        if key and isinstance(item.get(key), str) and item[key].strip():
            out.append({"type": item["type"], key: _short(item[key].strip(), 300),
                        **({"label": _short(item["label"], 120)} if isinstance(item.get("label"), str) else {})})
    return out[:5]


def start_task(title="", now=None, about=None, from_task=None):
    """A task the user starts; it waits for the next AI app that calls. `about`: what the user
    handed to the AI with it (from a model page, an image or a combo); `from_task`: the task it
    goes on from (ai_task_links.py). Returns the task."""
    now = time.time() if now is None else now
    with _lock:
        before = _load().get(_waiting[0])
        if before and not before.get("steps"):  # started before and never taken: this one replaces it
            remove_task(before["id"])
        task = {"format": FORMAT, "id": f"{int(now)}_{uuid.uuid4().hex[:8]}", "title": _short(str(title or "").strip(), MAX_TITLE),
                "title_from": "user", "client": "", "started": now, "updated": now, "ended": None, "steps": [], "waiting": True}
        if not task["title"]:
            task["title_from"] = "auto"
        if _about(about):
            task["about"] = _about(about)
        if from_task in _load():
            task["from"] = from_task
        _load()[task["id"]] = task
        _waiting[0] = task["id"]
        _drop_oldest()
        _save(task)
    _notify(task["id"])
    return task


def active_task_id(client, session="", task_id=None):
    """The active task id for this caller without creating a new task."""
    with _lock:
        tasks = _load()
        if task_id and task_id in tasks:
            return task_id
        found = _current.get(_owner_key(client, session)) or (None if session else _current.get(client))
        return found if found in tasks else None


def current_task(client, now=None, session="", task_id=None):
    """The task this app's calls go to now: an explicit task, one the user started for the next
    AI, else its open one, unless it paused too long."""
    now = time.time() if now is None else now
    with _lock:
        tasks = _load()
        picked = _claim_explicit(tasks, task_id, client, session)
        if picked:
            return picked
        waiting = _take_waiting(client, now, session=session)
        if waiting:
            return waiting
        task = tasks.get(_current.get(_owner_key(client, session)) or (None if session else _current.get(client)))
        if task and not task.get("ended") and now - task.get("updated", 0) < IDLE_SECONDS:
            _bind_owner(client, session, task["id"])
            return task
        if task and not task.get("ended"):
            task["ended"] = task.get("updated")
            _save(task)
        return _take_replied(tasks, client, now, session) or _new_task(client, now=now, session=session)


REPLIES = {"user_message", "user_marks", "user_pictures", "user_toolbox"}  # what the user gives the AI (ai_call_lines.js)
REPLY_FRESH = 2 * 3600  # an unread reply older than this no longer draws a new chat's calls to its task


def _take_replied(tasks, client, now, session="", previous=None):
    """The newest task of this app the user wrote to lately, since its AI last read (an ended one
    opens again), now this app's instead of a new one (its own open task `previous` ends), or None."""
    replied = max((task for task in tasks.values() if task.get("client") == client and any(
        step.get("kind") == "user" and step.get("tool") in REPLIES and not step.get("delivered")
        and now - step.get("at", 0) < REPLY_FRESH for step in task["steps"])),
        key=lambda task: task.get("updated", 0), default=None)
    if replied is None:
        return None
    if previous and previous is not replied and not previous.get("ended"):
        previous["ended"] = previous.get("updated")
        _save(previous)
    replied["ended"] = None
    _bind_owner(client, session, replied["id"])
    _save(replied)
    return replied


def begin_task(client, title, now=None, new_task=False, session="", task_id=None):
    """Name or resume the active task; only an explicit new piece of work splits it."""
    now = time.time() if now is None else now
    with _lock:
        tasks = _load()
        previous = tasks.get(_current.get(_owner_key(client, session)) or (None if session else _current.get(client)))
        task = None if new_task else _claim_explicit(tasks, task_id, client, session)
        if task is None:
            task = _take_waiting(client, now, session=session)
        if task is None and not new_task and previous and not previous.get("ended") and now - previous.get("updated", 0) < IDLE_SECONDS:
            task = previous
        if task is None and not new_task:
            task = _take_replied(tasks, client, now, session, previous)
        if task is None:
            if previous and not previous.get("ended"):
                previous["ended"] = now
                _save(previous)
            task = _new_task(client, title, now, session=session)
            if new_task and previous:
                task["from"] = previous["id"]  # begun from that one (ai_task_links.py)
        elif not task.get("title") or task.get("title_from") == "auto":
            task["title"] = _short(title, MAX_TITLE)
            task["title_from"] = "ai"
        _bind_owner(client, session, task["id"])
        task["updated"] = now
        _save(task)
    _notify(task["id"])
    return task


def _add_step(task, step):
    task["steps"].append(step)
    del task["steps"][:-MAX_STEPS]
    task["updated"] = max(task.get("updated", 0), step["at"] + step.get("ms", 0) / 1000)
    if task.get("title_from") == "auto" and not task.get("title") and step["kind"] not in ("look", "note") and step["ok"]:
        task["title"] = step["summary"][:MAX_TITLE]


def summary_of(tool, arguments):
    """A few words on what a call asked for: its main argument."""
    for key in ("title", "query", "text", "name", "workflow", "character", "model_id", "url", "what", "names", "type", "types"):
        if arguments.get(key) not in (None, "", []):
            value = arguments[key]
            if key == "model_id":  # "type:0:folder/file.safetensors": the file, and where it moves to
                value = str(value).split(":", 2)[-1].rsplit("/", 1)[-1] + (f" → {arguments['to_type']}" if arguments.get("to_type") else "")
            return _short(f"{tool}: {_short(value, 120)}", 160)
    return tool


def _model_result(model_id):
    from .mcp_tools import _resolve_model
    try:
        folder_type, path_idx, base_dir, file_path = _resolve_model(model_id)
    except Exception:  # noqa: BLE001 - a model that went away is still worth its id
        return {"type": "model", "model_id": str(model_id)}
    rel = os.path.relpath(file_path, base_dir).replace(os.sep, "/")
    return {"type": "model", "model_id": str(model_id), "folder": folder_type, "path_idx": path_idx, "rel": rel,
            "name": os.path.basename(file_path)}


def results_of(tool, arguments, data):
    """What came out of a call, for the page to show and lead to."""
    data = data if isinstance(data, dict) else {}
    out = []
    if tool in ("set_model", "add_lora", "open_in_anomalous") and arguments.get("model_id"):
        out.append(_model_result(arguments["model_id"]))
    if tool == "place_combo" and arguments.get("name"):
        out.append({"type": "combo", "name": _short(arguments["name"], 120)})
    if isinstance(data.get("_activity"), str):
        out.append({"type": "canvas", "activity": data["_activity"]})
    if tool == "speak":
        out.extend({"type": "audio", "file": _short(f, 200)} for f in data.get("files") or [] if isinstance(f, str))
    if tool == "scan_models" and data.get("started"):
        out.append({"type": "scan"})
    if tool == "download_model" and data.get("started"):
        out.append({**_download_result(data), "name": _short(str(data.get("model") or ""), 160)})
    if tool == "download_missing_models":
        out.extend(_download_result(item) for item in data.get("started") or [] if isinstance(item, dict))
    return out[:MAX_RESULTS]


def _download_result(started):
    """A download the AI started (mcp_actions' answer): the file it makes, and its size when the site said."""
    size = started.get("size")
    return {"type": "download", "file": _short(str(started.get("to") or "").rsplit("/", 1)[-1], 200),
            "size": size if isinstance(size, int) and size > 0 else None}


def _count_of(data):
    """How many things a read found: the length of its first list."""
    if isinstance(data, dict):
        for value in data.values():
            if isinstance(value, list):
                return len(value)
    return None


def begin_step(client, tool, arguments, started=None, read_only=False, session="", task_id=None):
    """Starts an in-flight step in state 'running' before a tool executes. Returns (task_id, step_id) or None."""
    if not action_catalog.is_step(tool) or tool in OWN_STEPS:
        return None
    try:
        started = time.time() if started is None else started
        args = arguments if isinstance(arguments, dict) else {}
        what = action_catalog.entry(tool, read_only)
        step = {"id": uuid.uuid4().hex[:10], "at": started, "ms": 0, "tool": tool, "kind": what.kind, "stage": what.stage,
                "ok": True, "state": "running", "summary": summary_of(tool, args), "results": []}
        with _lock:
            task = current_task(client, started, session=session, task_id=task_id)
            _add_step(task, step)
            _save(task)
        _notify(task["id"])
        return task["id"], step["id"]
    except Exception:  # noqa: BLE001 - the record must never fail the AI's call
        log.warning("Anomalous AI tasks: begin_step of %s failed", tool, exc_info=True)
        return None


def finish_step(client, tool, arguments, result, started, read_only=False, step_ref=None, session="", task_id=None):
    """Completes an in-flight step (or creates one if step_ref is None) with its final outcome. Never raises."""
    if not action_catalog.is_step(tool) or tool in OWN_STEPS:
        return None
    try:
        args = arguments if isinstance(arguments, dict) else {}
        data = result.get("structuredContent") if isinstance(result, dict) else None
        failed = not isinstance(result, dict) or bool(result.get("isError"))
        error = _short(" ".join(item.get("text", "") for item in result.get("content") or [] if isinstance(item, dict))) if failed and isinstance(result, dict) else ""
        ms = max(0, int((time.time() - started) * 1000))
        what = action_catalog.entry(tool, read_only)
        kind = what.kind
        waiting = isinstance(data, dict) and data.get("waiting_for_user")  # a gate the user has not answered (ai_gates.py)
        state = "error" if failed else "asking" if waiting else "running" if tool == "run_workflow" else "done"
        summary = summary_of(tool, args)
        results = [] if failed else results_of(tool, args, data)
        with _lock:
            task = _load().get(step_ref[0]) if isinstance(step_ref, tuple) and len(step_ref) == 2 else None
            step = next((item for item in (task or {}).get("steps", []) if item.get("id") == step_ref[1]), None) if task else None
            # A user can answer just after check() times out, before this call returns.
            gate = (step or {}).get("gate") or {}
            if waiting and gate.get("decision"):
                failed = gate["decision"] == "deny"
                state = "error" if failed else "done" if gate.get("used") else "allowed"
                error = (step.get("error") or "你没有允许 / You said no") if failed else ""
            if task is None:
                task = current_task(client, started, session=session, task_id=task_id)
            if step is None:
                step = {"id": uuid.uuid4().hex[:10], "at": started, "ms": ms, "tool": tool, "kind": kind, "stage": what.stage,
                        "ok": not failed, "state": state, "summary": summary, "results": results}
                _add_step(task, step)
            else:
                step.update(ms=ms, ok=not failed, state=state, summary=summary, results=results)
            if error:
                step["error"] = error
            else:
                step.pop("error", None)
            if kind == "look" and not failed and tool.startswith(("search_", "list_")):
                step["count"] = _count_of(data)
            task["updated"] = max(task.get("updated", 0), step["at"] + ms / 1000)
            if task.get("title_from") == "auto" and not task.get("title") and kind not in ("look", "note") and step["ok"]:
                task["title"] = summary[:MAX_TITLE]
            _save(task)
        for result in results:
            if result["type"] == "canvas":
                activity_log.tag(result["activity"], task["id"])  # the activity page links back to the task
        _notify(task["id"])
        return step
    except Exception:  # noqa: BLE001 - the record must never fail the AI's call
        log.warning("Anomalous AI tasks: step of %s not recorded", tool, exc_info=True)
        return None


def record(client, tool, arguments, result, started, read_only=False, session="", task_id=None):
    """One tool call as a step of the app's current task. Never raises."""
    return finish_step(client, tool, arguments, result, started, read_only, session=session, task_id=task_id)


# ---------------------------------------------------------------- notes from the AI

def _output_media(path):
    """An output-folder file the AI names ("subfolder/name.png"), as an image result, or None."""
    root = os.path.realpath(folder_paths.get_output_directory())
    full = os.path.realpath(os.path.join(root, str(path).replace("\\", "/").lstrip("/")))
    if os.path.commonpath((root, full)) != root or not os.path.isfile(full):
        return None
    if os.path.splitext(full)[1].lower() not in MEDIA_EXTS:
        return None
    rel = os.path.relpath(full, root).replace(os.sep, "/")
    subfolder, _, filename = rel.rpartition("/")
    return {"type": "image", "filename": filename, "subfolder": subfolder, "folder": "output"}


def report(client, text, images=None, done=False, now=None, session="", task_id=None, reply_to=None):
    """A note from the AI, with pictures it made (in ComfyUI's output folder); `reply_to`: the user's
    message or marks it answers (both steps then point at each other). Returns the step."""
    text = str(text or "").strip()
    if not text and not images:
        raise ValueError("text or images is needed")
    results, missing = [], []
    for path in (images or [])[:MAX_RESULTS]:
        item = _output_media(path)
        (results.append(item) if item else missing.append(str(path)))
    now = time.time() if now is None else now
    step = {"id": uuid.uuid4().hex[:10], "at": now, "ms": 0, "tool": "report", "kind": "note", "ok": True,
            "state": "done", "summary": "report", "text": _short(text, MAX_NOTE), "results": results}
    with _lock:
        task = current_task(client, now, session=session, task_id=task_id)
        asked = next((item for item in task["steps"] if reply_to and item["id"] == reply_to and item.get("kind") == "user"), None)
        if reply_to and not asked:
            raise ValueError("reply_to is the id of the user's message or marks (user_messages[].id) in this task")
        if asked:
            step["reply_to"], asked["replied"] = asked["id"], step["id"]
        _add_step(task, step)
        if done:
            task["ended"] = now
        _save(task)
    _notify(task["id"])
    return step, missing


# ---------------------------------------------------------------- the page's view

def task_summary(task, now=None):
    now = time.time() if now is None else now
    steps = task.get("steps") or []
    kinds = {}
    for step in steps:
        kinds[step["kind"]] = kinds.get(step["kind"], 0) + 1
    images = [item for step in steps for item in step.get("results") or [] if item.get("type") == "image"]
    asks = sum(1 for step in steps if step.get("kind") == "panel" and not step["panel"].get("closed")
               for block in step["panel"]["blocks"] if block.get("type") in ("choices", "input", "picks")
               and block.get("id") and block["id"] not in step.get("answers", {}))
    asks += sum(1 for step in steps if step.get("state") == "asking")
    return {
        "id": task["id"], "title": task.get("title") or "", "client": task.get("client") or ("" if task.get("waiting") else "AI"),
        "started": task.get("started"), "updated": task.get("updated"), "ended": task.get("ended"),
        "waiting": bool(task.get("waiting")) and not task.get("ended"),
        "live": any(step.get("state") == "running" and now - step.get("at", 0) < RUN_WATCH_SECONDS for step in steps),
        "steps": len(steps), "kinds": kinds, "errors": sum(1 for step in steps if not step.get("ok")),
        "images": len(images), "cover": images[-1] if images else None, "asks": asks, "from": task.get("from"),
    }


def list_tasks(limit=100):
    with _lock:
        tasks = sorted(_load().values(), key=lambda task: task.get("updated", 0), reverse=True)
        return [task_summary(task) for task in tasks[:limit]]


def get_task(task_id):
    with _lock:
        task = _load().get(task_id)
        return json.loads(json.dumps(task)) if task else None


def rename_task(task_id, title):
    with _lock:
        task = _load().get(task_id)
        if not task:
            return None
        task["title"] = _short(str(title or "").strip(), MAX_TITLE)
        task["title_from"] = "user" if task["title"] else "auto"
        _save(task)
        return task


def remove_task(task_id):
    with _lock:
        task = _load().pop(task_id, None)
        if not task:
            return False
        for client, current in list(_current.items()):
            if current == task_id:
                _current.pop(client, None)
        if _waiting[0] == task_id:
            _waiting[0] = None
        _forget(task_id)
        return True
