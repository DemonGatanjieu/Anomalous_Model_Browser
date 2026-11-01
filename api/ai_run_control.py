"""Stopping a run an AI started (the workbench's stop button, the AI's stop_run): its prompts still
waiting leave ComfyUI's queue and the one running is interrupted, only while it is still that one
(ComfyUI's own cancel; never anyone else's prompt). The run's watcher (ai_task_runs.py) then ends
the step as "cancelled" with who stopped it; when the user did, the AI is told with its next answer.
And the user's word on a finished run (set_verdict, the buttons under its pictures): it turned out
well, or not, kept on the run's step and told to the AI as their message."""

import time
import uuid

from . import ai_task_runs, ai_tasks


VERDICTS = ("good", "bad")


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
        if step.get("state") != "running" or not step.get("prompt_ids"):
            raise RunControlError("This run is not going any more")
        prompts = list(step["prompt_ids"])
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
    queue = ai_task_runs._queue()
    removed = sum(1 for prompt_id in prompts if queue.delete_queue_item(lambda item, pid=prompt_id: item[1] == pid))
    interrupted = sum(1 for prompt_id in prompts if _interrupt(queue, prompt_id))
    ai_tasks._notify(task["id"])
    return {"task": task["id"], "removed": removed, "interrupted": interrupted}


def set_verdict(task_id, step_id, verdict):
    """The user's word on finished run `step_id` of task `task_id`: "good", "bad" or None (taken back);
    a word given goes to the AI. Returns it."""
    if verdict not in (*VERDICTS, None):
        raise RunControlError("verdict is good, bad or null")
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        steps = (task or {}).get("steps", [])
        step = next((item for item in steps if item["id"] == step_id), None)
        if not step or step.get("tool") != "run_workflow" or step.get("state") != "done":
            raise RunControlError("No such finished run")
        if step.get("verdict") == verdict:
            return verdict
        if verdict:
            step["verdict"] = verdict
            number = sum(1 for item in steps[:steps.index(step) + 1] if item.get("tool") == "run_workflow")
            ai_tasks._add_step(task, {"id": uuid.uuid4().hex[:10], "at": time.time(), "ms": 0, "tool": "user_verdict", "kind": "user",
                                      "ok": True, "state": "done", "summary": "user_verdict", "verdict": verdict, "run": step_id,
                                      "delivered": False, "results": [], "text": (
                                          f"The user says run {number} of this task (step {step_id}) turned out well."
                                          if verdict == "good" else
                                          f"The user says run {number} of this task (step {step_id}) did not turn out well: "
                                          "change the way, a setting or the prompt before running again, or ask them what is off.")})
        else:
            step.pop("verdict", None)
        ai_tasks._save(task)
    ai_tasks._notify(task_id)
    return verdict
