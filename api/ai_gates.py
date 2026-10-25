"""Gates: what the user lets AI apps do through Anomalous's MCP endpoint without asking first.

Each acting tool has a gate in action_catalog.py (canvas, gpu, download, network, files) and each gate
a policy the user sets on the AI workbench: "auto" (go ahead), "ask" (wait for the user's OK)
or "never". mcp_server.py asks check() before running a tool. With "ask" the tool's step waits
in state "asking", showing what it would do, for up to WAIT_SECONDS: the user's Allow lets the
call go on, No answers the AI with the user's reason. When the user has not answered by then,
the AI is told to wait (get_answers) and call the same tool again; the user's later answer
reaches it as a message (ai_panels._collect), and an allowed call made again with the same
arguments goes ahead without asking twice. Policies are kept in the ComfyUI user folder
(anomalous/ai_gates.json); changing one is a write (local_guard.py keeps it to this computer).
The same window sets which tools AI apps are offered (tool_set: all, or the "daily" set of
action_catalog.DAILY for a small model's everyday runs, the rest on demand through mcp_directory's
use_tool; anomalous/ai_tools.json); an app sees a
change in a new chat (they keep the list a chat began with). It also sets how an AI waits for a
run (run_wait): "call", it ends its turn and the user tells it when the run is done (the AI
workbench gives them a line to paste), or "wait", it waits with run_status; and how long in all an
AI waits for the user's answer to its question (answer_wait, ai_answer_wait.py).
"""

import json
import os
import threading
import time

from . import action_catalog, ai_tasks
from .path_utils import atomic_write_json

POLICIES = ("auto", "ask", "never")
TOOL_SETS = ("full", "daily")
RUN_WAITS = ("call", "wait")
ANSWER_WAITS = (60, 180, 600)  # seconds; the first call waits 30-55 s, get_answers the rest
DEFAULTS = {"canvas": "auto", "gpu": "auto", "download": "ask", "network": "auto", "files": "ask"}
WAIT_SECONDS = 50  # below the minute many AI apps give a tool call
ALLOWED_SECONDS = 30 * 60  # an Allow the AI did not wait for holds this long for the same call
MAX_ARGS = 8

_decided = threading.Condition(ai_tasks._lock)


def _path():
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "ai_gates.json")


def policies():
    try:
        with open(_path(), encoding="utf-8") as source:
            stored = json.load(source)
    except (OSError, ValueError):
        stored = {}
    stored = stored if isinstance(stored, dict) else {}
    return {gate: stored.get(gate) if stored.get(gate) in POLICIES else default for gate, default in DEFAULTS.items()}


def set_policy(gate, policy):
    if gate not in DEFAULTS or policy not in POLICIES:
        raise ValueError("Unknown gate or policy")
    with _decided:
        current = policies()
        current[gate] = policy
        atomic_write_json(_path(), current)
    return current


def _tools_path():
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "ai_tools.json")


def _tool_settings():
    try:
        with open(_tools_path(), encoding="utf-8") as source:
            stored = json.load(source)
    except (OSError, ValueError):
        stored = {}
    return stored if isinstance(stored, dict) else {}


def _set_tool_setting(key, value):
    with _decided:
        atomic_write_json(_tools_path(), {**_tool_settings(), key: value})
    return value


def tool_set():
    """The tools AI apps are offered: "full" or "daily" (mcp_directory.py)."""
    chosen = _tool_settings().get("set")
    return chosen if chosen in TOOL_SETS else "full"


def set_tool_set(name):
    if name not in TOOL_SETS:
        raise ValueError("tools is full or daily")
    return _set_tool_setting("set", name)


def run_wait():
    """How an AI waits for its run: "call" (the user tells it when it is done) or "wait" (run_status)."""
    chosen = _tool_settings().get("runs")
    return chosen if chosen in RUN_WAITS else "call"


def set_run_wait(mode):
    if mode not in RUN_WAITS:
        raise ValueError("runs is call or wait")
    return _set_tool_setting("runs", mode)


def answer_wait():
    """How long in all an AI waits for the user's answer, in seconds (one of ANSWER_WAITS)."""
    chosen = _tool_settings().get("answer_wait")
    return chosen if chosen in ANSWER_WAITS else 180


def set_answer_wait(seconds):
    if seconds not in ANSWER_WAITS or isinstance(seconds, bool):
        raise ValueError("answer_wait is 60, 180 or 600")
    return _set_tool_setting("answer_wait", seconds)


def describe(tool, arguments):
    """What a call would do, as [{label, value}] for the card the user answers."""
    out = []
    for key, value in list((arguments or {}).items())[:MAX_ARGS]:
        if key == "task":
            continue
        if key == "model_id":  # its name, and the folder it is in
            value = " · ".join(filter(None, (ai_tasks._model_result(value).get("name") or value, str(value).split(":")[0])))
        out.append({"label": key, "value": ai_tasks._short(value, 400)})
    return out


def _signature(tool, arguments):
    return json.dumps([tool, {k: v for k, v in (arguments or {}).items() if k != "task"}], sort_keys=True, ensure_ascii=False)


def _blocked(text):
    return {"content": [{"type": "text", "text": text}], "isError": True}


def _step(step_ref):
    task = ai_tasks._load().get(step_ref[0]) if step_ref else None
    step = next((item for item in (task or {}).get("steps", []) if item.get("id") == step_ref[1]), None) if task else None
    return task, step


def check(tool, arguments, step_ref, now=None):
    """None when the call may go ahead; else the result to give the AI instead of running it."""
    gate = action_catalog.entry(tool).gate
    if gate and set(arguments or {}) & set(action_catalog.ALSO_CANVAS.get(tool, ())):
        strict = {"auto": 0, "ask": 1, "never": 2}
        gate = max((gate, "canvas"), key=lambda name: strict.get(policies().get(name, "auto"), 0))
    policy = policies().get(gate, "auto") if gate else "auto"
    if policy == "auto":
        return None
    if policy == "never":
        return _blocked(f"The user does not let AI apps do this ({gate}) through Anomalous; tell them what you "
                        "wanted to do instead, or ask them to change it in the AI workbench (Gates).")
    now = time.time() if now is None else now
    signature = _signature(tool, arguments)
    with _decided:
        task, step = _step(step_ref)
        if not step:
            return _blocked("Approval could not be recorded; nothing was done. Retry after reopening the AI workbench.")
        # An Allow given after the AI stopped waiting: the same call again goes ahead.
        for earlier in task["steps"]:
            asked = earlier.get("gate") or {}
            if (asked.get("timed_out") and asked.get("signature") == signature
                    and asked.get("decision") == "allow" and not asked.get("used")
                    and now - asked.get("at", 0) < ALLOWED_SECONDS):
                asked["used"] = True
                earlier["state"] = "done"
                step["gate"] = {"gate": gate, "signature": signature, "decision": "allow", "used": True, "earlier": earlier["id"]}
                ai_tasks._save(task)
                return None
        step["state"] = "asking"
        step["gate"] = {"gate": gate, "signature": signature, "lines": describe(tool, arguments), "asked": now}
        ai_tasks._save(task)
        task_id = task["id"]
    ai_tasks._notify(task_id, {"gate": gate, "asks": True})
    with _decided:
        _decided.wait_for(lambda: "decision" in step["gate"], WAIT_SECONDS)
        asked = step["gate"]
        if asked.get("decision") == "allow":
            asked["used"] = True
            step["state"] = "running"
            ai_tasks._save(task)
            return None
        if asked.get("decision") == "deny":
            return _blocked("你没有允许 / The user said no to this in Anomalous." + (f" They said: {asked['text']}" if asked.get("text") else ""))
        asked["timed_out"] = True
        ai_tasks._save(task)
    return {"content": [{"type": "text", "text": "Waiting for the user's OK in Anomalous's AI workbench: nothing was done yet. "
                                                 "Call get_answers (wait_seconds up to 55) to hear their answer; once they allow "
                                                 "it, call this tool again with the same arguments."}],
            "structuredContent": {"waiting_for_user": True, "gate": gate}, "isError": False}


def decide(task_id, step_id, decision, text="", remember=False, now=None):
    """The user's answer to a step that asks: "allow" or "deny" (with words for the AI)."""
    if decision not in ("allow", "deny"):
        raise ValueError("decision is allow or deny")
    with _decided:
        task, step = _step((task_id, step_id))
        asked = (step or {}).get("gate")
        if not asked or step.get("state") != "asking":
            raise ValueError("Nothing waits for an answer there")
        asked.update(decision=decision, at=time.time() if now is None else now)
        if text:
            asked["text"] = ai_tasks._short(str(text).strip(), 1000)
        if asked.get("timed_out"):
            # The AI stopped waiting: it hears of the answer as a message, and an Allow waits for its call.
            asked["delivered"] = False
            step["state"] = "allowed" if decision == "allow" else "error"
        else:
            step["state"] = "running" if decision == "allow" else "error"
        if decision == "deny":
            step.update(ok=False, error="你没有允许 / You said no")
        ai_tasks._save(task)
        _decided.notify_all()
    if remember and decision == "allow":
        set_policy(asked["gate"], "auto")
    ai_tasks._notify(task_id)
    from . import ai_panels
    ai_panels.wake()
    return step
