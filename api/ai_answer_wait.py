"""How long an AI waits for the user to answer its question (ask_user, a question on a panel).

One tool call waits at most ai_panels.MAX_WAIT (55 s, under the minute AI apps give a call), so
the answer to a question still open says whether to wait on with get_answers: until the time the
user set in the Gates window (ai_gates.answer_wait, from when it asked), and while the user is
typing an answer (the page posts POST /anomalous/ai_tasks/{id}/typing as they type) until a while
after their last key. Then the AI ends its turn and the user brings it back with a line to paste
(web/modules/ai_call_lines.js). Typing is kept in memory only.
"""

import time

from . import ai_gates, ai_panels, ai_tasks

AFTER_TYPING = 60  # the user typed this recently: their answer is on its way
_typed = {}  # task id -> time of the user's last key


def typing(task_id, now=None):
    """The user is typing in task `task_id` (an answer or a message). False for no such task."""
    if not ai_tasks.get_task(task_id):
        return False
    _typed[task_id] = time.time() if now is None else now
    return True


def wait_on(panel_id, now=None):
    """For a question of panel `panel_id` still open: {keep_waiting, seconds_left?, typing?, note}, or {}."""
    with ai_tasks._lock:
        task, step = ai_panels._find(panel_id)
    if not step:
        return {}
    now = time.time() if now is None else now
    typed = _typed.get(task["id"], 0)
    left = max(step["at"] + ai_gates.answer_wait(), typed + AFTER_TYPING) - now
    if left <= 0:
        return {"keep_waiting": False, "note": "You waited as long as the user set: end your turn now. They answer in "
                                               "Anomalous and tell you in your chat to go on."}
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
        found = [found for item in waiting if (found := wait_on(item["panel"], now)).get("keep_waiting")]
        return {**answer, **max(found, key=lambda item: item["seconds_left"])} if found else answer
    return {**answer, **wait_on(panel_id, now)}
