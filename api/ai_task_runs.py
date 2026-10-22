"""What a workflow run an AI started made: after run_workflow (mcp_server.py), the prompts
ComfyUI queued for it are watched in its history until they end, and the pictures and videos
they saved become the step's results (ai_tasks.py keeps the step). A thread per run, polling
every RUN_POLL_SECONDS, for at most ai_tasks.RUN_WATCH_SECONDS; nothing runs when no AI ran
anything. While it runs, where it stands (queued and how many are ahead, the node running and
its steps, nodes done; read from ComfyUI's queue and its progress registry, never changed) is
the step's "progress", sent to the page with each change, and status() answers the AI's
run_status with it, waiting for the end when asked. tell() puts the same news in the AI's
other answers: where the run stands while it goes, and once that it ended."""

import json
import threading
import time

from . import ai_tasks

RUN_POLL_SECONDS = 2.0
MAX_STATUS_WAIT = 55


def _queue():
    from server import PromptServer
    return PromptServer.instance.prompt_queue


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


def _registry():
    """ComfyUI's per-node progress of the prompt running now, or None (an older ComfyUI has none)."""
    try:
        from comfy_execution import progress
    except ImportError:
        return None
    return progress.global_progress_registry


def progress_of(prompts):
    """Where the run of `prompts` stands: queued (how many are ahead), running (the node and its
    steps, nodes done of all), or None when ComfyUI cannot say."""
    try:
        running, pending = _queue().get_current_queue()
    except Exception:  # noqa: BLE001 - no server (tests)
        return None
    running_ids = [item[1] for item in running]
    order = [item[1] for item in sorted(pending, key=lambda item: item[0])]
    current = next((pid for pid in prompts if pid in running_ids), None)
    if not current:
        waiting = [pid for pid in prompts if pid in order]
        if not waiting:
            return None
        return {"state": "queued", "ahead": order.index(waiting[0]) + len(running_ids)}
    out = {"state": "running", "prompt": prompts.index(current) + 1, "prompts": len(prompts)}
    registry = _registry()
    if registry is None or registry.prompt_id != current:
        return out
    nodes = dict(registry.nodes)
    out["nodes_done"] = sum(1 for node in nodes.values() if node["state"].value == "finished")
    out["nodes"] = len(registry.dynprompt.original_prompt)
    active = next(((node_id, node) for node_id, node in nodes.items() if node["state"].value == "running"), None)
    if active:
        try:
            info = registry.dynprompt.get_node(active[0]) or {}
        except Exception:  # noqa: BLE001 - a node of the run that is gone already
            info = {}
        out["node"] = str((info.get("_meta") or {}).get("title") or info.get("class_type") or active[0])[:80]
        out["value"], out["max"] = int(active[1]["value"]), int(active[1]["max"])
    # Like ComfyUI's own tab title: the running node's steps; without steps, the nodes done.
    if out.get("max", 0) > 1:
        out["percent"] = max(0, min(100, round(100 * out["value"] / out["max"])))
    elif out["nodes"]:
        out["percent"] = max(0, min(100, round(100 * out["nodes_done"] / out["nodes"])))
    return out


def _show_progress(task_id, step_id, progress):
    """The run's progress on its step (kept in memory; the page hears of each change)."""
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        step = next((item for item in (task or {}).get("steps", []) if item["id"] == step_id), None)
        if not step or step.get("progress") == progress or step.get("state") != "running":
            return
        step["progress"] = progress
    ai_tasks._notify(task_id, {"progress": {"step": step_id, **progress}})


def _finish_run(task_id, step_id, prompts, history):
    if not prompts:
        _stop_run(task_id, step_id, "没有找到已排队的运行 / No queued run was found; completion cannot be confirmed")
        return True
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
        failed = failed or bool(step.get("submission_error"))
        results = [item for item in step["results"] if item["type"] != "image"] + images[:ai_tasks.MAX_RESULTS]
        if (done < len(prompts) and results == step["results"] and step.get("prompts") == len(prompts)
                and (not failed or step.get("ok") is False)):
            return False  # nothing new to keep: no write
        step["results"] = results
        step["state"] = "running" if done < len(prompts) else ("error" if failed else "done")
        step["prompts"] = len(prompts)
        if failed:
            step["ok"] = False
            step["error"] = step.get("submission_error") or "ComfyUI 运行出错 / The run failed"
        if done >= len(prompts):
            step.pop("progress", None)
            step["ms"] = int((time.time() - step["at"]) * 1000)
            task["updated"] = max(task["updated"], time.time())
        ai_tasks._save(task)
    ai_tasks._notify(task_id)
    return done >= len(prompts)


def _stop_run(task_id, step_id, reason):
    """Monitoring ended without proof of completion; never pretend the run succeeded."""
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        step = next((item for item in (task or {}).get("steps", []) if item["id"] == step_id), None)
        if not step or step.get("state") != "running":
            return
        step.update(state="stopped", ok=False, error=reason, ms=max(0, int((time.time() - step["at"]) * 1000)))
        step.pop("progress", None)
        task["updated"] = max(task["updated"], time.time())
        ai_tasks._save(task)
    ai_tasks._notify(task_id)


def watch(step_id, receipt):
    """Follow only IDs returned by this submission, in batch order; never infer ownership from the queue."""
    with ai_tasks._lock:
        task_id = next((task["id"] for task in ai_tasks._load().values()
                        if any(step["id"] == step_id for step in task.get("steps") or [])), None)
    if not task_id:
        return
    prompts = receipt.get("prompt_ids") or []
    if not prompts:
        _stop_run(task_id, step_id, "缺少运行 ID / Missing submission IDs; refresh ComfyUI before retrying")
        return
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        step = next((item for item in (task or {}).get("steps", []) if item["id"] == step_id), None)
        if not step:
            return  # The user may remove the task while its submission is returning.
        step["prompt_ids"] = list(prompts)
        if receipt.get("submission_error"):
            step.update(submission_error=receipt["submission_error"], error=receipt["submission_error"], ok=False)
        ai_tasks._save(task)

    def follow():
        start = time.monotonic()
        while time.monotonic() - start < ai_tasks.RUN_WATCH_SECONDS:
            try:
                history = {pid: _queue().get_history(prompt_id=pid).get(pid) for pid in prompts}
            except Exception:  # noqa: BLE001 - stop the receipt, not the actual ComfyUI run
                _stop_run(task_id, step_id, "无法读取运行记录 / Run history could not be read; check ComfyUI's queue")
                return
            if _finish_run(task_id, step_id, prompts, {k: v for k, v in history.items() if v}):
                return
            try:
                progress = progress_of(prompts)
            except (AttributeError, KeyError, TypeError, ValueError):
                progress = None  # progress is optional; keep watching the authoritative history
            if progress:
                _show_progress(task_id, step_id, progress)
            time.sleep(RUN_POLL_SECONDS)
        _stop_run(task_id, step_id, "运行跟踪已超时，未停止出图 / Monitoring timed out; the workflow was not cancelled. Check ComfyUI's queue")

    threading.Thread(target=follow, name="anomalous-ai-run", daemon=True).start()


def summary(run):
    """One sentence for the AI on where run step `run` stands."""
    state, progress = run.get("state"), run.get("progress") or {}
    if state == "running" and progress.get("state") == "queued":
        return f"Your run is queued, {progress.get('ahead', 0)} ahead of it; it has not started. Do not run it again."
    if state == "running":
        parts = []
        if progress.get("prompts", 0) > 1:
            parts.append(f"run {progress['prompt']} of {progress['prompts']}")
        if progress.get("node"):
            parts.append(f"{progress['node']} step {progress['value']}/{progress['max']}" if progress.get("max", 0) > 1
                         else progress["node"])
        if "percent" in progress:
            parts.append(f"{progress['percent']}%")
        if progress.get("nodes"):
            parts.append(f"{progress['nodes_done']} of {progress['nodes']} nodes done")
        parts.append(f"{round(time.time() - run['at'])} s so far")
        return (f"Your run is still going ({', '.join(parts)}). It has not finished: call run_status with "
                "wait_seconds to wait for it; do not look in the output folder or guess.")
    if state == "done":
        pictures = [item["filename"] for item in run.get("results") or [] if item.get("type") == "image"]
        return f"Your run finished in {round(run.get('ms', 0) / 1000)} s with {len(pictures)} picture(s): {', '.join(pictures[:8])}."
    if state in ("asking", "allowed"):
        return "Your run waits for the user's OK in Anomalous; it has not started."
    return f"Your run did not finish: {run.get('error') or state}."


def news(task_id):
    """The run news for the AI working on task `task_id`: while its latest run goes, and once after it ends."""
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id) if task_id else None
        run = next((step for step in reversed((task or {}).get("steps", [])) if step.get("tool") == "run_workflow"), None)
        if not run or not run.get("prompt_ids") or run.get("told"):
            return None
        answer = {"state": run.get("state"), "summary": summary(run)}
        if run.get("state") == "running" and run.get("progress"):
            answer["progress"] = run["progress"]
        if run.get("state") not in ("running", "asking", "allowed"):
            run["told"] = True
            ai_tasks._save(task)
        return answer


def tell(result, task_id):
    """Puts the run news (news()) into a tool result, so the AI need not go and look."""
    run = news(task_id) if isinstance(result, dict) and not result.get("isError") else None
    if not run:
        return result
    data = result.get("structuredContent")
    data = dict(data) if isinstance(data, dict) else {}
    data["your_run"] = run
    result["structuredContent"] = data
    content = list(result.get("content") or [])
    text = {"type": "text", "text": json.dumps(data, ensure_ascii=False)}
    if content and isinstance(content[0], dict) and content[0].get("type") == "text":
        content[0] = text
    else:
        content.insert(0, text)
    result["content"] = content
    return result


def status(client, session="", task_id=None, wait_seconds=0):
    """The AI's run_status: its task's latest run, where it stands, and what it made; with
    `wait_seconds`, waits (up to MAX_STATUS_WAIT) until the run ends."""
    task_id = ai_tasks.active_task_id(client, session, task_id)
    deadline = time.monotonic() + max(0.0, min(float(wait_seconds or 0), MAX_STATUS_WAIT))
    while True:
        task = ai_tasks.get_task(task_id) if task_id else None
        run = next((step for step in reversed((task or {}).get("steps", [])) if step.get("tool") == "run_workflow"), None)
        if not run:
            raise ValueError("No run in this task yet: run_workflow starts one.")
        if run.get("state") not in ("running", "asking", "allowed") or time.monotonic() >= deadline:
            break
        time.sleep(1)
    answer = {"state": run.get("state"), "seconds": round(run.get("ms", 0) / 1000) if run.get("state") != "running"
              else round(time.time() - run["at"]), "summary": summary(run)}
    if run.get("state") not in ("running", "asking", "allowed") and not run.get("told"):
        with ai_tasks._lock:  # told here: the next answers need not repeat it
            task = ai_tasks._load().get(task_id)
            step = next((item for item in (task or {}).get("steps", []) if item["id"] == run["id"]), None)
            if step is not None:
                step["told"] = True
                ai_tasks._save(task)
    if run.get("progress"):
        answer["progress"] = run["progress"]
    if run.get("prompt_ids"):
        answer["prompt_ids"] = run["prompt_ids"]
    pictures = ["/".join(part for part in (item.get("subfolder"), item["filename"]) if part)
                for item in run.get("results") or [] if item.get("type") == "image"]
    if pictures:
        answer["pictures"] = pictures
    if run.get("error"):
        answer["error"] = run["error"]
    answer["note"] = {
        "running": "Still running: call run_status again (wait_seconds up to 55) instead of guessing it is done.",
        "done": "Finished: the pictures are in the output folder (search_images / get_image_info show them).",
        "asking": "Waiting for the user's OK in Anomalous before it runs.",
    }.get(run.get("state"), "The run did not finish; see error.")
    return answer
