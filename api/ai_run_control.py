"""Stopping a run an AI started (the workbench's stop button, the AI's stop_run): its prompts still
waiting leave ComfyUI's queue and the one running is interrupted, only while it is still that one
(ComfyUI's own cancel; never anyone else's prompt). The run's watcher (ai_task_runs.py) then ends
the step as "cancelled" with who stopped it; when the user did, the AI is told with its next answer.
The user's halt on a whole task (halt, the workbench's "Halt and take back"): its runs stop, a step
waiting for their OK is answered no, and the AI gets the halt before it can act again (ai_gates.check).
And the user's word on a finished run (set_verdict, the buttons under its pictures): it turned out
well, or not, kept on the run's step and told to the AI as their message."""

import time
import uuid

from . import ai_gates, ai_task_runs, ai_tasks


VERDICTS = ("good", "bad")
# What is off with a run's pictures, a click each under "not quite right" (ui_ai_verdict.js), in the words the AI gets:
# the eyes of an AI that is not sent the pictures (ai_privacy.py), and quicker than writing for any.
ISSUES = {"hands": "the hands are wrong", "face": "the face is off", "body": "the body or the pose is wrong",
          "composition": "the framing is off", "dark": "too dark", "bright": "too bright", "blurry": "blurry or short of detail",
          "style": "not the style they want", "subject": "not the subject they asked for", "extra": "something is extra or missing"}


HALT = ("The user called a halt on this task in Anomalous: your runs are stopped and what you changed on the canvas is "
        "taken back. Stop here: change, run and download nothing more for it until they ask you to, and tell them in "
        "a line that you stopped.")


class RunControlError(ValueError):
    pass


def _interrupt(queue, prompt_id):
    """Interrupts `prompt_id` if it is the prompt running now; True when it was."""
    if hasattr(queue, "interrupt_if_running"):
        return bool(queue.interrupt_if_running(prompt_id))
    running, _ = queue.get_current_queue()  # an older ComfyUI: check, then the global interrupt
    if not any(item[1] == prompt_id for item in running):
        return False
    import nodes
    nodes.interrupt_processing()
    return True


def stop(step_id, by="user", task_id=None, now=None):
    """Stops run step `step_id` (in task `task_id` when given). Returns {"task", "removed", "interrupted"}."""
    now = time.time() if now is None else now
    with ai_tasks._lock:
        tasks = ai_tasks._load()
        task = next((item for item in tasks.values() if (not task_id or item["id"] == task_id)
                     and any(step["id"] == step_id for step in item.get("steps") or [])), None)
        step = next((item for item in (task or {}).get("steps", []) if item["id"] == step_id), None)
        if not step or step.get("tool") != "run_workflow":
            raise RunControlError("No such run in this task")
        sheet = step.get("sheet")  # a job sheet: its own stop takes its runs out (job_sheets.py)
        if step.get("state") != "running" or not (step.get("prompt_ids") or sheet):
            raise RunControlError("This run is not going any more")
        prompts = list(step.get("prompt_ids") or [])
        step["stop"] = by
        if by == "user":
            task["steps"].append({
                "id": uuid.uuid4().hex[:10], "at": now, "ms": 0, "tool": "user_stop", "kind": "user", "ok": True,
                "state": "done", "summary": "user_stop", "stopped": step_id, "delivered": False, "results": [],
                "text": "The user stopped your run in Anomalous. Do not start it again unless they ask; ask_user what to change.",
            })
            del task["steps"][:-ai_tasks.MAX_STEPS]
        task["updated"] = max(task.get("updated", 0), now)
        ai_tasks._save(task)
    removed, interrupted = _take_out(sheet, prompts)
    ai_tasks._notify(task["id"])
    return {"task": task["id"], "removed": removed, "interrupted": interrupted}


def _take_out(sheet, prompts):
    """Stops job sheet `sheet`, else takes `prompts` out of ComfyUI's queue and interrupts the one running: (removed, interrupted)."""
    if sheet:
        from . import job_sheets
        try:
            job_sheets.ask(sheet, "stop")
        except job_sheets.SheetError:
            pass  # gone or ended already: nothing left to stop
        return 0, 0
    queue = ai_task_runs._queue()
    removed = sum(1 for prompt_id in prompts if queue.delete_queue_item(lambda item, pid=prompt_id: item[1] == pid))
    return removed, sum(1 for prompt_id in prompts if _interrupt(queue, prompt_id))


def halt(task_id, drop_tab=False, now=None):
    """The user calls a halt on task `task_id`: its runs stop, a step waiting for their OK is answered no, and
    one step tells the AI. `drop_tab`: the page closes the tab made for the task, so the task lets go of it
    (a later change copies the open workflow anew). Returns {"task", "stopped"}."""
    now = time.time() if now is None else now
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        if not task:
            raise RunControlError("No such task")
        runs = [step for step in task["steps"] if step.get("tool") == "run_workflow" and step.get("state") == "running"
                and (step.get("prompt_ids") or step.get("sheet"))]
        for step in runs:
            step["stop"] = "user"
        asking = [step["id"] for step in task["steps"] if step.get("state") == "asking"]
        if drop_tab:
            (task.get("canvas") or {}).pop("tab", None)
        task["steps"].append({
            "id": uuid.uuid4().hex[:10], "at": now, "ms": 0, "tool": "user_halt", "kind": "user", "ok": True, "state": "done",
            "summary": "user_halt", "stopped": len(runs), "delivered": False, "results": [], "text": HALT,
        })
        del task["steps"][:-ai_tasks.MAX_STEPS]
        task["updated"] = max(task.get("updated", 0), now)
        ai_tasks._save(task)
    for step_id in asking:
        try:
            ai_gates.decide(task_id, step_id, "deny", "They called a halt on the task.")
        except ValueError:
            pass  # answered meanwhile
    for step in runs:
        _take_out(step.get("sheet"), list(step.get("prompt_ids") or []))
    ai_tasks._notify(task_id)
    return {"task": task_id, "stopped": len(runs)}


def set_verdict(task_id, step_id, verdict, issues=None):
    """The user's word on finished run `step_id` of task `task_id`: "good", "bad" or None (taken back), with
    "bad" what is off (`issues`, keys of ISSUES). A word given goes to the AI; one it has not fetched yet is
    corrected where it stands, so picking issues one by one says it once. Returns the verdict."""
    if verdict not in (*VERDICTS, None):
        raise RunControlError("verdict is good, bad or null")
    issues = [name for name in ISSUES if name in issues] if verdict == "bad" and isinstance(issues, list) else []
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        steps = (task or {}).get("steps", [])
        step = next((item for item in steps if item["id"] == step_id), None)
        if not step or step.get("tool") != "run_workflow" or step.get("state") != "done":
            raise RunControlError("No such finished run")
        if step.get("verdict") == verdict and step.get("issues", []) == issues:
            return verdict
        if verdict:
            step.update(verdict=verdict, issues=issues)
            number = sum(1 for item in steps[:steps.index(step) + 1] if item.get("tool") == "run_workflow")
            text = (f"The user says run {number} of this task (step {step_id}) turned out well." if verdict == "good" else
                    f"The user says run {number} of this task (step {step_id}) did not turn out well: "
                    + ("; ".join(ISSUES[name] for name in issues) + ". Change what causes that (the way, a setting, the prompt) "
                       "before running again." if issues else
                       "change the way, a setting or the prompt before running again, or ask them what is off."))
            told = next((item for item in reversed(steps) if item.get("tool") == "user_verdict" and item.get("run") == step_id
                         and not item.get("delivered")), None)
            if told:
                told.update(at=time.time(), verdict=verdict, issues=issues, text=text)
            else:
                ai_tasks._add_step(task, {"id": uuid.uuid4().hex[:10], "at": time.time(), "ms": 0, "tool": "user_verdict", "kind": "user",
                                          "ok": True, "state": "done", "summary": "user_verdict", "verdict": verdict, "issues": issues,
                                          "run": step_id, "delivered": False, "results": [], "text": text})
        else:
            step.pop("verdict", None)
            step.pop("issues", None)
        ai_tasks._save(task)
    ai_tasks._notify(task_id)
    return verdict
