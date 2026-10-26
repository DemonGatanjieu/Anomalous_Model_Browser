"""How long an AI waits for the user to answer its question (ask_user, a question on a panel).

One tool call waits at most ai_panels.MAX_WAIT (55 s, under the minute AI apps give a call), so
the answer to a question still open says whether to wait on with get_answers: until the time the
user set in the Gates window (ai_gates.answer_wait, from when it asked), and while the user is
typing an answer (the page posts POST /anomalous/ai_tasks/{id}/typing as they type) until a while
after their last key. Then the AI ends its turn and the user brings it back with a line to paste
(web/modules/ai_call_lines.js); or, when the user set so (ai_gates.no_answer "recommended"), each
open choice the AI marked a recommended option for takes it, marked as such for the user and the
AI (recommended_on_timeout), and the AI goes on; not once the user began writing (typed since the
question came): they stepped away mid-answer, and it waits for them. Typing is kept in memory only.
"""

import time

from . import ai_gates, ai_panels, ai_tasks

AFTER_TYPING = 60  # the user typed this recently: their answer is on its way
TOOK = ("The user did not answer in time and set that your recommended option goes then: Anomalous took it for "
        "them (recommended_on_timeout). Go on with it; a question without a recommended option stays open for the user.")
STOP = "You waited as long as the user set: end your turn now. They answer in Anomalous and tell you in your chat to go on."
WROTE = ("The user began writing an answer, then stepped away: end your turn now. Nothing is chosen for them; they "
         "finish it in Anomalous and tell you in your chat to go on.")
_typed = {}  # task id -> time of the user's last key


def take_recommended(task_id, step):
    """Answers each open choice of panel step `step` that has a recommended option with it. Returns how many."""
    taken = 0
    for block in step["panel"].get("blocks") or []:
        picked = [option["id"] for option in block.get("options") or [] if option.get("recommended")]
        if block.get("type") != "choices" or not picked or block.get("id") in (step.get("answers") or {}):
            continue
        try:
            ai_panels.answer(task_id, step["id"], block["id"], choice=picked if block.get("multiple") else picked[:1],
                             extra={"recommended_on_timeout": True})
            taken += 1
        except ai_panels.PanelError:
            pass
    return taken


def typing(task_id, now=None):
    """The user is typing in task `task_id` (an answer or a message). False for no such task."""
    with ai_tasks._lock:
        if not ai_tasks.get_task(task_id):
            return False
        _typed[task_id] = time.time() if now is None else now
        return True


def wait_on(panel_id, now=None, allow_recommended=True):
    """For a question of panel `panel_id` still open: {keep_waiting, seconds_left?, typing?, note}, or {}."""
    with ai_tasks._lock:
        task, step = ai_panels._find(panel_id)
        return _wait_on(task, step, now, allow_recommended)


def _wait_on(task, step, now, allow_recommended):
    """Check typing and commit a timeout choice under the same lock as user answers."""
    if not step:
        return {}
    now = time.time() if now is None else now
    typed = _typed.get(task["id"], 0)
    left = max(step["at"] + ai_gates.answer_wait(), typed + AFTER_TYPING) - now
    if left <= 0:
        wrote = typed >= step["at"]  # a half-written answer is theirs: no option is taken over it
        if allow_recommended and not wrote and ai_gates.no_answer() == "recommended" and take_recommended(task["id"], step):
            return {"keep_waiting": False, "took_recommended": True, "note": TOOK}
        return {"keep_waiting": False, "note": WROTE if wrote else STOP}
    typing_now = now - typed < AFTER_TYPING
    return {"keep_waiting": True, "seconds_left": round(left), **({"typing": True} if typing_now else {}),
            "note": ("The user is typing their answer" if typing_now else "The user has not answered yet")
                    + ": call get_answers(panel, wait_seconds=55) now, and again while keep_waiting is true. Do not "
                      "end your turn or ask the same in your own chat."}


def for_answer(answer, panel_id=None, now=None):
    """get_answers' `answer`, with how to wait on when nothing came back but questions still open:
    for panel `panel_id`, or without one for the newest open question while the user's time runs."""
    waiting = answer.get("still_waiting") or []
    if not waiting or answer.get("answers") or answer.get("messages"):
        return answer
    if panel_id is None:
        found = [wait_on(panel, now) for panel in dict.fromkeys(item["panel"] for item in waiting)]
        live = [item for item in found if item.get("keep_waiting")]
        status = max(live, key=lambda item: item["seconds_left"]) if live else next((item for item in found if item), {})
        took = any(item.get("took_recommended") for item in found)
        return {**answer, **status, **({"took_recommended": True} if took else {})}
    return {**answer, **wait_on(panel_id, now)}


def collect(client, panel_id=None, wait_seconds=0, task_id=None):
    """Wait unlocked, then deliver a timeout choice or a racing user answer in this same call."""
    answer = ai_panels.get_answers(client, panel_id, wait_seconds, task_id=task_id)
    if answer.get("answers") or answer.get("messages") or not answer.get("still_waiting"):
        return answer
    with ai_tasks._lock:
        # Input may have arrived after the long wait released its lock. Read it before choosing.
        answer = ai_panels.get_answers(client, panel_id, 0, task_id=task_id)
        if answer.get("answers") or answer.get("messages") or not answer.get("still_waiting"):
            return answer
        status = for_answer(answer, panel_id)
        fresh = ai_panels.get_answers(client, panel_id, 0, task_id=task_id)
        if fresh.get("answers") or fresh.get("messages"):
            if any(item.get("recommended_on_timeout") for item in fresh.get("answers", [])):
                fresh["note"] = TOOK
            return fresh
        return {**status, **fresh} if fresh.get("still_waiting") else fresh
