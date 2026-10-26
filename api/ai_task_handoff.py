"""Select a task to resume from unread user input, without changing task state or ownership.

Called under ai_tasks' lock when a caller has no recent open task. Explicit task selection
and the user's task waiting for the next AI take precedence in ai_tasks.
"""

REPLIES = {"user_message", "user_marks", "user_pictures", "user_toolbox"}
REPLY_FRESH = 2 * 3600


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
