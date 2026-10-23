"""Which task a task goes on from ("接着"), so work split over tasks is found together: a task an
AI begins as new while on another (ai_tasks.begin_task), or one the user starts while looking at
another (ai_tasks.start_task), keeps that one as its "from". The user can link a task to another
or take the link off (set_from); links() gives a task's own "from" and the tasks that go on from it,
and an AI beginning a task that goes on from another hears what was decided there."""

from . import ai_decisions, ai_tasks


class LinkError(ValueError):
    pass


def set_from(task_id, parent_id):
    """Task `task_id` goes on from `parent_id` (None: from none). Refuses a loop. Returns the parent id."""
    with ai_tasks._lock:
        tasks = ai_tasks._load()
        task = tasks.get(task_id)
        if not task:
            raise LinkError("No such task")
        if parent_id is not None:
            if parent_id not in tasks or parent_id == task_id:
                raise LinkError("No such other task")
            seen, at = set(), parent_id
            while at and at not in seen:  # going up from the parent must not come back here
                if at == task_id:
                    raise LinkError("That task already goes on from this one")
                seen.add(at)
                at = (tasks.get(at) or {}).get("from")
            task["from"] = parent_id
        else:
            task.pop("from", None)
        ai_tasks._save(task)
    ai_tasks._notify(task_id)
    return parent_id


def links(task_id):
    """{from: {id, title} | None, next: [{id, title}]} of task `task_id`, the next oldest first."""
    with ai_tasks._lock:
        tasks = ai_tasks._load()
        task = tasks.get(task_id) or {}
        brief = lambda item: {"id": item["id"], "title": item.get("title") or ""}  # noqa: E731
        parent = tasks.get(task.get("from"))
        later = sorted((item for item in tasks.values() if item.get("from") == task_id), key=lambda item: item.get("started", 0))
        return {"from": brief(parent) if parent else None, "next": [brief(item) for item in later]}


def carried(task):
    """For an AI beginning `task`: the task it goes on from and what was decided there, or None."""
    parent = ai_tasks.get_task(task.get("from")) if task.get("from") else None
    if not parent:
        return None
    return {"task": parent["id"], "title": parent.get("title") or "", "decisions": ai_decisions.lines(parent),
            "note": "This task goes on from that one; keep to what was decided there unless the user says otherwise."}
