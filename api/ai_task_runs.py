"""What a workflow run an AI started made: after run_workflow (mcp_server.py), the prompts
ComfyUI queued for it are watched in its history until they end, and the pictures and videos
they saved become the step's results (ai_tasks.py keeps the step). A thread per run, polling
every RUN_POLL_SECONDS, for at most ai_tasks.RUN_WATCH_SECONDS; nothing runs when no AI ran
anything."""

import threading
import time

from . import ai_tasks

RUN_POLL_SECONDS = 2.0


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
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        step = next((item for item in (task or {}).get("steps", []) if item["id"] == step_id), None)
        if not step:
            return True
        step["results"] = [item for item in step["results"] if item["type"] != "image"] + images[:ai_tasks.MAX_RESULTS]
        step["state"] = "running" if done < len(prompts) else ("error" if failed else "done")
        step["prompts"] = len(prompts)
        if failed:
            step["ok"] = False
            step["error"] = "ComfyUI 运行出错 / The run failed"
        if done >= len(prompts):
            step["ms"] = int((time.time() - step["at"]) * 1000)
            task["updated"] = max(task["updated"], time.time())
        ai_tasks._save(task)
    ai_tasks._notify(task_id)
    return done >= len(prompts)


def watch(step_id, before):
    """Follows the run of step `step_id` (prompts not in `before`) until it ends."""
    with ai_tasks._lock:
        task_id = next((task["id"] for task in ai_tasks._load().values()
                        if any(step["id"] == step_id for step in task.get("steps") or [])), None)
    if not task_id:
        return

    def follow():
        start = time.monotonic()
        prompts = []
        while time.monotonic() - start < ai_tasks.RUN_WATCH_SECONDS:
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

    threading.Thread(target=follow, name="anomalous-ai-run", daemon=True).start()
