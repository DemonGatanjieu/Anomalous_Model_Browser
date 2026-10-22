"""Attach explicitly identified external ComfyUI submissions to an AI task; never guess ownership."""
import json
import math
import time

from . import ai_task_runs, ai_tasks
from .mcp_tools import ToolError


def checked_wait(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 55:
        raise ToolError("wait_seconds must be a number between 0 and 55.")
    return value


def track_run(ctx, prompt_ids, task=None, wait_seconds=15):
    wait_seconds = checked_wait(wait_seconds)
    if (not isinstance(prompt_ids, list) or not 1 <= len(prompt_ids) <= 8
            or any(not isinstance(pid, str) or not pid or len(pid) > 128 for pid in prompt_ids)
            or len(set(prompt_ids)) != len(prompt_ids)):
        raise ToolError("Give 1–8 unique prompt_ids returned by your own ComfyUI /prompt submissions.")
    client, session = ctx.get("client") or "AI", ctx.get("session") or ""
    task_id = task or ctx.get("task") or ai_tasks.active_task_id(client, session)
    with ai_tasks._lock:
        target = ai_tasks._load().get(task_id)
        if not target or target.get("ended"):
            raise ToolError("Begin or resume an open task before attaching a run; pass its task ID.")
        existing = None
        for candidate in ai_tasks._load().values():
            for step in candidate.get("steps", []):
                ids = step.get("prompt_ids") or []
                if set(ids).intersection(prompt_ids):
                    if candidate["id"] != task_id or ids != prompt_ids:
                        raise ToolError("A prompt ID is already attached to another run. Do not reassign it.")
                    existing = step
        if existing is None:
            try:
                queue = ai_task_runs._queue()
                running, pending = queue.get_current_queue()
                known = {item[1] for item in [*running, *pending]}
                missing = [pid for pid in prompt_ids if pid not in known and not queue.get_history(prompt_id=pid).get(pid)]
            except Exception as error:
                raise ToolError("Cannot read ComfyUI's queue/history; nothing was attached.") from error
            if missing:
                raise ToolError("Unknown prompt IDs: " + ", ".join(missing) + ". Use this server's submission receipts.")
            receipt = {"prompt_ids": prompt_ids, "queued": len(prompt_ids)}
            result = {"structuredContent": receipt, "content": []}
            step = ai_tasks.record(client, "run_workflow", {}, result, time.time(), session=session, task_id=task_id)
            if not step:
                raise ToolError("Could not record the run; nothing was queued by this tool.")
            step.update(prompt_ids=list(prompt_ids), source="external")
            ai_tasks._save(target)
            ai_task_runs.watch(step["id"], receipt)
            existing = step
    answer = ai_task_runs.status(client, session, task_id, wait_seconds, step_id=existing["id"])
    return {"task": task_id, "attached": True, **answer}


def wait_for_receipt(result, client, session, task_id, wait_seconds=15, step_id=None):
    """Return authoritative execution state alongside submission receipts, with a bounded wait."""
    answer = ai_task_runs.status(client, session, task_id, wait_seconds, step_id=step_id)
    data = {**result.get("structuredContent", {}), **answer, "task": task_id}
    result["structuredContent"] = data
    content = list(result.get("content") or [])
    text = {"type": "text", "text": json.dumps(data, ensure_ascii=False)}
    if content and content[0].get("type") == "text":
        content[0] = text
    else:
        content.insert(0, text)
    result["content"] = content
    return result
