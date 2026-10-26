"""Select a task to resume from unread user input, without changing task state or ownership;
whether a look belongs to the task just done; how many of a task's failures still stand.

Called under ai_tasks' lock when a caller has no recent open task. Explicit task selection
and the user's task waiting for the next AI take precedence in ai_tasks.
"""

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


def just_done(task, tasks, waiting, client, now):
    """`task` (the app's last one) when it said it is done (report done) moments ago: a look the AI
    takes right after (checking its result) goes there, the task staying ended, and no empty task is
    made for it. None when the user started a task for the next AI (`waiting`) or wrote to one."""
    if not task or not task.get("ended") or not 0 <= now - task["ended"] < AFTER_DONE:
        return None
    if not task["steps"] or task["steps"][-1].get("tool") != "report":
        return None
    if (waiting and not waiting.get("ended")) or latest_replied(tasks, client, now):
        return None
    return task


def unresolved(steps):
    """Failed steps the AI did not get past: no later call of the same tool went through (a wrong
    argument corrected on the next call, a run refused and then run, is no failure of the task)."""
    later_ok, count = set(), 0
    for step in reversed(steps):
        if step.get("ok"):
            later_ok.add(step.get("tool"))
        elif step.get("tool") not in later_ok:
            count += 1
    return count
