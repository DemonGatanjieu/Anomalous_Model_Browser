"""A task's key decisions, kept in Anomalous to look back on ("决策"). Talk may happen anywhere,
in the AI's own chat too; what was settled is kept here: the AI records it (log_decision: what,
why, what was left out, who decided, the steps it is about), and what the user decided in
Anomalous itself is read from the task's own steps (a panel answer, a gate's allow or no, the
materials handed over, the canvas mode, a stop). decisions() lists both, oldest first; gap() says
how much the AI did since its last recorded decision, for a quiet reminder."""

import time
import uuid

from . import ai_tasks

BY = ("user", "ai", "together")
MAX_TEXT = 600
MAX_REJECTED = 6
MAX_RELATED = 8
QUESTIONS = ("choices", "input", "picks")


def log(client, title, decision, reason="", rejected=None, by="user", related=None, now=None, session="", task_id=None):
    """A decision the AI records. `related`: ids of this task's steps it is about. Returns the step."""
    title, decision = str(title or "").strip(), str(decision or "").strip()
    if not title or not decision:
        raise ValueError("title (what was decided about) and decision (what was decided) are needed")
    if by not in BY:
        raise ValueError(f"by is one of {', '.join(BY)}")
    rejected = [ai_tasks._short(str(item).strip(), 200) for item in (rejected or []) if str(item).strip()][:MAX_REJECTED]
    now = time.time() if now is None else now
    record = {"title": ai_tasks._short(title, 200), "decision": ai_tasks._short(decision, MAX_TEXT),
              "reason": ai_tasks._short(str(reason or "").strip(), MAX_TEXT), "rejected": rejected, "by": by, "related": []}
    step = {"id": uuid.uuid4().hex[:10], "at": now, "ms": 0, "tool": "log_decision", "kind": "decision", "ok": True,
            "state": "done", "summary": "log_decision", "text": record["decision"], "decision": record, "results": []}
    with ai_tasks._lock:
        task = ai_tasks.current_task(client, now, session=session, task_id=task_id)
        known = {item["id"] for item in task["steps"]}
        record["related"] = [str(item) for item in (related or []) if str(item) in known][:MAX_RELATED]
        ai_tasks._add_step(task, step)
        ai_tasks._save(task)
    ai_tasks._notify(task["id"])
    return step


def decisions(task):
    """Every decision of `task`, oldest first: {type: logged | answer | gate | toolbox | canvas | stop, step, at, …}."""
    out = []
    for step in (task or {}).get("steps") or []:
        tool = step.get("tool")
        if step.get("kind") == "decision":
            out.append({"type": "logged", "step": step["id"], "at": step["at"], **step["decision"]})
        elif step.get("kind") == "panel":
            blocks = {block.get("id"): block for block in step["panel"].get("blocks") or []}
            for block_id, given in (step.get("answers") or {}).items():
                block = blocks.get(block_id) or {}
                out.append({"type": "answer", "step": step["id"], "at": given.get("at", step["at"]),
                            "question": block.get("question") or step["panel"].get("title") or "",
                            "answer": "、".join(given.get("labels") or []) if given.get("labels") and given.get("choice") != ["other"] else given.get("text", ""),
                            "skipped": bool(given.get("skipped")), "timed_out": bool(given.get("recommended_on_timeout"))})
        elif (step.get("gate") or {}).get("at"):
            asked = step["gate"]
            out.append({"type": "gate", "step": step["id"], "at": asked["at"], "tool": tool,
                        "allowed": asked.get("decision") == "allow", "text": asked.get("text", "")})
        elif tool == "user_toolbox":
            box = step.get("toolbox") or {}
            count = sum(len(value) for value in box.values() if isinstance(value, list))
            out.append({"type": "toolbox", "step": step["id"], "at": step["at"], "mode": box.get("mode", "prefer"), "count": count})
        elif tool == "user_canvas":
            out.append({"type": "canvas", "step": step["id"], "at": step["at"], "mode": step.get("canvas")})
        elif tool == "user_stop":
            out.append({"type": "stop", "step": step["id"], "at": step["at"]})
    return sorted(out, key=lambda item: item["at"])


def gap(task):
    """Runs and canvas changes of the AI since its last recorded decision ({runs, canvas}), or None when there are none."""
    runs = canvas = 0
    for step in reversed((task or {}).get("steps") or []):
        if step.get("kind") == "decision":
            break
        runs += step.get("kind") == "run"
        canvas += step.get("kind") == "canvas"
    return {"runs": runs, "canvas": canvas} if runs or canvas else None


def lines(task, limit=12):
    """The latest decisions in a line each, for an AI picking the task up again."""
    words = []
    for item in decisions(task)[-limit:]:
        if item["type"] == "logged":
            words.append(f"{item['title']}: {item['decision']}" + (f" (because {item['reason']})" if item["reason"] else ""))
        elif item["type"] == "answer":
            words.append(f"Nobody answered \"{item['question']}\" in time; your recommended option was taken: {item['answer']}" if item["timed_out"] else
                         f"The user answered \"{item['question']}\": " + ("left it to you" if item["skipped"] else item["answer"]))
        elif item["type"] == "gate":
            words.append(f"The user {'allowed' if item['allowed'] else 'refused'} {item['tool']}" + (f": {item['text']}" if item["text"] else ""))
        elif item["type"] == "toolbox":
            words.append(f"The user handed over {item['count']} materials ({item['mode']})")
        elif item["type"] == "canvas":
            words.append("The user set the canvas mode to " + ("the task's own tab" if item["mode"] == "new" else "their open canvas"))
        else:
            words.append("The user stopped a run")
    return words
