"""Select a task to resume from unread user input, without changing task state or ownership;
whether a look belongs to the task just done; how many of a task's failures still stand.

Called under ai_tasks' lock when a caller has no recent open task. Explicit task selection
and the user's task waiting for the next AI take precedence in ai_tasks.
"""

import json

REPLIES = {"user_message", "user_marks", "user_pictures", "user_toolbox"}
REPLY_FRESH = 2 * 3600
AFTER_DONE = 5 * 60  # a look this soon after the AI said its task is done is part of that task, not a new one


def _reply_at(task, now):
    """Latest unread user input; a tool still running keeps its task from automatic takeover."""
    if any(step.get("state") == "running" for step in task["steps"]):
        return 0
    replies = []
    for step in task["steps"]:
        if step.get("kind") == "user" and step.get("tool") in REPLIES:
            replies.append(step)
        elif step.get("kind") == "panel":
            replies.extend((step.get("answers") or {}).values())
    return max((r.get("at", 0) for r in replies if not r.get("delivered") and not r.get("recommended_on_timeout")
                and 0 <= now - r.get("at", 0) < REPLY_FRESH), default=0)


def latest_replied(tasks, client, now):
    """The task of this app with the latest eligible reply, or None."""
    candidates = ((at, task) for task in tasks.values() if task.get("client") == client and (at := _reply_at(task, now)))
    _, task = max(candidates, key=lambda item: item[0], default=(0, None))
    return task


def just_done(task, tasks, waiting, client, now, explicit=False):
    """`task` (the app's last one) when it said it is done (report done) moments ago: a look the AI
    takes right after (checking its result) goes there, the task staying ended, and what it shows or
    asks the user about it (a before and after, "happy with it?") opens it again; no new task is made
    for either. Automatic selection yields to a waiting task or unread reply; an explicit
    task id keeps the same precedence as selecting an open task."""
    if not task or not task.get("ended") or not 0 <= now - task["ended"] < AFTER_DONE:
        return None
    if not any(step.get("tool") == "report" and step.get("at") == task["ended"] for step in task["steps"]):
        return None  # it ended by a pause or another task, not by the AI saying it is done
    if not explicit and ((waiting and not waiting.get("ended")) or latest_replied(tasks, client, now)):
        return None
    return task


RECOVERY_TARGETS = {
    "set_model": ("node_id",), "set_prompt": ("node_id", "role"), "set_values": ("node_id",),
    "connect_nodes": ("from_node_id", "to_node_id", "input"), "remove_nodes": ("node_ids",),
    "run_workflow": ("workflow",), "open_workflow": ("workflow",),
    "get_model": ("model_id",), "move_model": ("model_id",), "download_model": ("url",),
    "get_image_info": ("image",), "zoom_image": ("image",),
}


def recovery_target(tool, arguments):
    """Keep target identity, not prompt text or changed values, to distinguish independent retries."""
    target = {key: arguments[key] for key in RECOVERY_TARGETS.get(tool, ()) if arguments.get(key) is not None}
    if tool == "set_prompt":
        target["role"] = arguments.get("role") or "positive"
    for key, value in target.items():
        if key.endswith("node_id"):
            target[key] = str(value)
        elif key == "node_ids" and isinstance(value, list):
            target[key] = sorted(map(str, value))
    if tool == "set_values" and isinstance(arguments.get("values"), dict):
        values = arguments["values"]
        if arguments.get("node_id") is None and values and all(isinstance(value, dict) for value in values.values()):
            target["settings"] = {str(node): sorted(settings) for node, settings in values.items()}
        else:
            target["settings"] = sorted(values)
    return json.dumps(target, sort_keys=True, ensure_ascii=False) if target else None


def unresolved(steps):
    """Only completed successful calls to the same recorded target resolve an earlier failure. A
    failure that named no target (its arguments missing or misnamed, as a light model's first try
    often is) is resolved by any later completed success of the same tool."""
    later_ok, later_tools, count = set(), set(), 0
    for step in reversed(steps):
        key = (step.get("tool"), step.get("recovery_target"))
        if step.get("ok") and step.get("state") in (None, "done"):
            later_ok.add(key)
            later_tools.add(key[0])
        elif not step.get("ok") and key not in later_ok and not (key[1] is None and key[0] in later_tools):
            count += 1
    return count
