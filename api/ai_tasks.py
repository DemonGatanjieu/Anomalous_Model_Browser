"""AI tasks: what AI apps did through Anomalous's MCP endpoint, kept for the AI workbench page.

Every tool call an AI app makes (mcp_server.py) becomes a step of a task: a task is one piece
of work, named by the AI with begin_task, else the calls of one app that follow each other
without a long pause. A step starts in state "running" when the call begins and is updated in
place when it finishes: what was done (the tool, a short summary of its arguments), whether it
worked, and what came out of it, so the page can show it live and lead there: the models it
used, the combo it placed, the canvas change it made (by its activity log entry, for undo),
the pictures a run made (watched in ComfyUI's history until the run ends), the audio it spoke.
The AI can also leave a note (report), with pictures it made another way.

The user can start a task first (New task, POST /anomalous/ai_tasks): it waits for an AI, and
the next app that calls takes it over, so the work it does next starts there instead of joining
the app's last task.

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
import threading
import time
import uuid

import folder_paths

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
RUN_POLL_SECONDS = 2.0
MEDIA_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm"}

# What each tool is, for the page's colours and words. Tools not named are reads.
KINDS = {
    "set_prompt": "canvas", "set_model": "canvas", "add_lora": "canvas", "place_combo": "canvas",
    "fix_workflow_models": "canvas", "run_workflow": "run", "download_missing_models": "download",
    "download_model": "download", "scan_models": "scan", "speak": "speech", "open_in_anomalous": "show",
    "report": "note", "show_panel": "panel",
}
QUIET = {"begin_task", "update_panel", "get_answers"}  # not steps of their own
OWN_STEPS = {"report", "show_panel"}  # make their step themselves (with its text or panel)

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
        # A task the user started before ComfyUI restarted still waits for the next AI.
        waiting = [task for task in _tasks.values() if task.get("waiting") and not task.get("ended")]
        if waiting and _waiting[0] is None:
            _waiting[0] = max(waiting, key=lambda task: task.get("started", 0))["id"]
    return _tasks

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
        try:
            os.remove(_path(task["id"]))  # the plugin's own record; the pictures and files stay
        except OSError:
            pass

def _notify(task_id, extra=None):
    try:
        from server import PromptServer
        PromptServer.instance.send_sync("anomalous.ai_task", {"id": task_id, **(extra or {})})
    except Exception:  # noqa: BLE001 - tests and early start have no server; the page polls on open
        pass


# ---------------------------------------------------------------- who is calling

_CLIENT_NAMES = (
    ("claude-code", "Claude Code"), ("claude", "Claude"), ("cursor", "Cursor"), ("cherry", "Cherry Studio"),
    ("windsurf", "Windsurf"), ("codex", "Codex"), ("gemini", "Gemini"), ("vscode", "VS Code"), ("cline", "Cline"),
)

def client_of(headers, params):
    """A short name for the AI app making a call: the client info it sends, else its User-Agent."""
    meta = params.get("_meta") if isinstance(params.get("_meta"), dict) else {}
    info = meta.get("io.modelcontextprotocol/clientInfo")
    raw = info.get("name") if isinstance(info, dict) and isinstance(info.get("name"), str) else ""
    if not raw:
        raw = (headers.get("User-Agent") or "").split(" ")[0].split("/")[0]
    lowered = raw.lower()
    for key, name in _CLIENT_NAMES:
        if key in lowered:
            return name
    clean = re.sub(r"[^\w .-]", "", raw).strip()[:40]
    return clean or "AI"

def session_of(headers, params):
    """An optional session key when one app runs multiple MCP sessions at once."""
    meta = params.get("_meta") if isinstance(params.get("_meta"), dict) else {}
    raw = headers.get("Mcp-Session-Id") or headers.get("X-Anomalous-Session") or meta.get("sessionId") or meta.get("conversationId") or ""
    return re.sub(r"[^\w .:-]", "", str(raw)).strip()[:64] if isinstance(raw, str) else ""

def task_of(headers, params, arguments=None):
    """An explicit task id from headers, request metadata or tool arguments."""
    meta = params.get("_meta") if isinstance(params.get("_meta"), dict) else {}
    arg_task = arguments.get("task") if isinstance(arguments, dict) else None
    raw = arg_task or headers.get("X-Anomalous-Task") or meta.get("anomalous/task") or meta.get("task") or ""
    return re.sub(r"[^\w-]", "", str(raw)).strip()[:64] if isinstance(raw, str) else ""

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

def start_task(title="", now=None):
    """A task the user starts; it waits for the next AI app that calls. Returns the task."""
    now = time.time() if now is None else now
    with _lock:
        before = _load().get(_waiting[0])
        if before and not before.get("steps"):  # started before and never taken: this one replaces it
            remove_task(before["id"])
        task = {"format": FORMAT, "id": f"{int(now)}_{uuid.uuid4().hex[:8]}", "title": _short(str(title or "").strip(), MAX_TITLE),
                "title_from": "user", "client": "", "started": now, "updated": now, "ended": None, "steps": [], "waiting": True}
        if not task["title"]:
            task["title_from"] = "auto"
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
        return _new_task(client, now=now, session=session)

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
        if task is None:
            if previous and not previous.get("ended"):
                previous["ended"] = now
                _save(previous)
            task = _new_task(client, title, now, session=session)
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
    for key in ("title", "query", "text", "name", "character", "model_id", "url", "what", "names"):
        if arguments.get(key) not in (None, "", []):
            return _short(f"{tool}: {_short(arguments[key], 120)}", 160)
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
    if tool in ("download_model", "download_missing_models"):
        out.append({"type": "download"})
    return out[:MAX_RESULTS]

def _count_of(data):
    """How many things a read found: the length of its first list."""
    if isinstance(data, dict):
        for value in data.values():
            if isinstance(value, list):
                return len(value)
    return None

def begin_step(client, tool, arguments, started=None, read_only=False, session="", task_id=None):
    """Starts an in-flight step in state 'running' before a tool executes. Returns (task_id, step_id) or None."""
    if tool in QUIET or tool in OWN_STEPS:
        return None
    try:
        started = time.time() if started is None else started
        args = arguments if isinstance(arguments, dict) else {}
        step = {"id": uuid.uuid4().hex[:10], "at": started, "ms": 0, "tool": tool,
                "kind": KINDS.get(tool, "look" if read_only or tool not in KINDS else "act"),
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

def finish_step(client, tool, arguments, result, started, read_only=False, run_before=None,
                step_ref=None, session="", task_id=None):
    """Completes an in-flight step (or creates one if step_ref is None) with its final outcome. Never raises."""
    if tool in QUIET or tool in OWN_STEPS:
        return None
    try:
        args = arguments if isinstance(arguments, dict) else {}
        data = result.get("structuredContent") if isinstance(result, dict) else None
        failed = not isinstance(result, dict) or bool(result.get("isError"))
        error = _short(" ".join(item.get("text", "") for item in result.get("content") or [] if isinstance(item, dict))) if failed and isinstance(result, dict) else ""
        ms = max(0, int((time.time() - started) * 1000))
        kind = KINDS.get(tool, "look" if read_only or tool not in KINDS else "act")
        state = "error" if failed else ("running" if tool == "run_workflow" else "done")
        summary = summary_of(tool, args)
        results = [] if failed else results_of(tool, args, data)
        with _lock:
            task = _load().get(step_ref[0]) if isinstance(step_ref, tuple) and len(step_ref) == 2 else None
            step = next((item for item in (task or {}).get("steps", []) if item.get("id") == step_ref[1]), None) if task else None
            if task is None:
                task = current_task(client, started, session=session, task_id=task_id)
            if step is None:
                step = {"id": uuid.uuid4().hex[:10], "at": started, "ms": ms, "tool": tool, "kind": kind,
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
        _notify(task["id"])
        if tool == "run_workflow" and not failed:
            _watch_run(task["id"], step["id"], run_before or set())
        return step
    except Exception:  # noqa: BLE001 - the record must never fail the AI's call
        log.warning("Anomalous AI tasks: step of %s not recorded", tool, exc_info=True)
        return None

def record(client, tool, arguments, result, started, read_only=False, run_before=None, session="", task_id=None):
    """One tool call as a step of the app's current task. Never raises."""
    return finish_step(client, tool, arguments, result, started, read_only, run_before,
                       step_ref=None, session=session, task_id=task_id)


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

def report(client, text, images=None, done=False, now=None, session="", task_id=None):
    """A note from the AI, with pictures it made (in ComfyUI's output folder). Returns the step."""
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
        _add_step(task, step)
        if done:
            task["ended"] = now
        _save(task)
    _notify(task["id"])
    return step, missing


# ---------------------------------------------------------------- what a run made

def _queue():
    from server import PromptServer
    return PromptServer.instance.prompt_queue

def prompt_ids():
    """Prompts queued, running or recently done: before and after run_workflow, the new ones are its."""
    try:
        queue = _queue()
        running, pending = queue.get_current_queue()
        ids = {item[1] for item in [*running, *pending]}
        ids.update(queue.get_history(max_items=64).keys())
        return ids
    except Exception:  # noqa: BLE001 - no server (tests): nothing to watch
        return set()

def outputs_of(record_):
    """Saved pictures and videos in one history record."""
    out = []
    for output in (record_.get("outputs") or {}).values():
        for key in ("images", "gifs", "videos"):
            for item in output.get(key) or []:
                if isinstance(item, dict) and item.get("type") == "output" and item.get("filename"):
                    out.append({"type": "image", "filename": item["filename"], "subfolder": item.get("subfolder") or "",
                                "folder": "output"})
    return out

def _finish_run(task_id, step_id, prompts, history):
    images, failed, done = [], False, 0
    for prompt_id in prompts:
        record_ = history.get(prompt_id)
        if not record_:
            continue
        status = record_.get("status") or {}
        if status.get("status_str") == "error":
            failed = True
            done += 1
        elif status.get("completed"):
            done += 1
        for image in outputs_of(record_):
            if image not in images:  # a prompt ComfyUI answers from its cache repeats the same file
                images.append(image)
    with _lock:
        task = _load().get(task_id)
        step = next((item for item in (task or {}).get("steps", []) if item["id"] == step_id), None)
        if not step:
            return True
        step["results"] = [item for item in step["results"] if item["type"] != "image"] + images[:MAX_RESULTS]
        step["state"] = "running" if done < len(prompts) else ("error" if failed else "done")
        step["prompts"] = len(prompts)
        if failed:
            step["ok"] = False
            step["error"] = "ComfyUI 运行出错 / The run failed"
        if done >= len(prompts):
            step["ms"] = int((time.time() - step["at"]) * 1000)
            task["updated"] = max(task["updated"], time.time())
        _save(task)
    _notify(task_id)
    return done >= len(prompts)

def _watch_run(task_id, step_id, before):
    def watch():
        start = time.monotonic()
        prompts = []
        while time.monotonic() - start < RUN_WATCH_SECONDS:
            if not prompts:
                prompts = sorted(prompt_ids() - before)
                if not prompts and time.monotonic() - start > 10:
                    _finish_run(task_id, step_id, [], {})
                    return  # nothing was queued after all
            if prompts:
                try:
                    history = {pid: _queue().get_history(prompt_id=pid).get(pid) for pid in prompts}
                except Exception:  # noqa: BLE001
                    return
                if _finish_run(task_id, step_id, prompts, {k: v for k, v in history.items() if v}):
                    return
            time.sleep(RUN_POLL_SECONDS)

    with _lock:
        task = _load().get(task_id)
        step = next((item for item in (task or {}).get("steps", []) if item["id"] == step_id), None)
        if step:
            step["state"] = "running"
            _save(task)
    threading.Thread(target=watch, name="anomalous-ai-run", daemon=True).start()


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
    return {
        "id": task["id"], "title": task.get("title") or "", "client": task.get("client") or ("" if task.get("waiting") else "AI"),
        "started": task.get("started"), "updated": task.get("updated"), "ended": task.get("ended"),
        "waiting": bool(task.get("waiting")) and not task.get("ended"),
        "live": (not task.get("ended") and not task.get("waiting") and now - task.get("updated", 0) < 90)
                or any(step.get("state") == "running" and now - step.get("at", 0) < RUN_WATCH_SECONDS for step in steps),
        "steps": len(steps), "kinds": kinds, "errors": sum(1 for step in steps if not step.get("ok")),
        "images": len(images), "cover": images[-1] if images else None, "asks": asks,
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
        try:
            os.remove(_path(task_id))
        except OSError:
            pass
        return True
