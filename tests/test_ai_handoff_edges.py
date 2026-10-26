"""Task handoff and answer deadlines, using only the existing temporary test store."""
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

from test_ai_tasks import isolate
from api import ai_answer_wait, ai_gates, ai_panels, ai_tasks, mcp_task_tools


class HandoffEdges(unittest.TestCase):
    def setUp(self):
        isolate()
        ai_answer_wait._typed.clear()
        self.ctx = {"client": "A", "session": "one"}

    def ask(self, recommended=True):
        options = [{"id": "a", "label": "A", "recommended": recommended}, {"id": "b", "label": "B"}]
        with mock.patch.object(mcp_task_tools, "ASK_WAIT_MIN", 0):
            return mcp_task_tools.ask_user(self.ctx, "Which?", options, wait_seconds=0)

    def test_unscoped_timeout_delivers_auto_answer_in_same_call(self):
        with mock.patch.object(ai_gates, "answer_wait", return_value=0):
            self.ask()
            with mock.patch.object(ai_gates, "no_answer", return_value="recommended"):
                answer, _ = mcp_task_tools.get_answers(self.ctx)
        self.assertEqual(answer["answers"][0]["choice"], ["a"])
        self.assertTrue(answer["answers"][0]["recommended_on_timeout"])
        self.assertEqual(answer["still_waiting"], [])

    def test_unscoped_expired_question_tells_ai_to_stop(self):
        with mock.patch.object(ai_gates, "answer_wait", return_value=0):
            self.ask(False)
            answer, _ = mcp_task_tools.get_answers(self.ctx)
        self.assertIs(answer.get("keep_waiting"), False)
        self.assertIn("end your turn", answer["note"])

    def test_user_answer_wins_race_with_auto_pick_and_is_returned_now(self):
        with mock.patch.object(ai_gates, "answer_wait", return_value=0):
            asked = self.ask()
            original = ai_panels.answer
            def user_first(task_id, step_id, block_id, **kwargs):
                original(task_id, step_id, block_id, choice=["b"])
                return original(task_id, step_id, block_id, **kwargs)
            with mock.patch.object(ai_gates, "no_answer", return_value="recommended"), \
                    mock.patch.object(ai_panels, "answer", side_effect=user_first):
                answer, _ = mcp_task_tools.get_answers(self.ctx, panel=asked["panel"])
        self.assertEqual(answer["answers"][0]["choice"], ["b"])
        self.assertNotIn("recommended_on_timeout", answer["answers"][0])
        self.assertNotIn("end your turn", answer.get("note", ""))

    def test_resume_uses_user_reply_time_not_background_task_update(self):
        older = ai_tasks.begin_task("A", "Older", now=100)
        ai_panels.leave_message(older["id"], "first", now=110)
        newer = ai_tasks.begin_task("A", "Newer", now=120, new_task=True)
        ai_panels.leave_message(newer["id"], "second", now=130)
        older["updated"] = 140  # a late run monitor / metadata update is not a new user reply
        ai_tasks._current.clear()
        self.assertEqual(ai_tasks.current_task("A", now=150)["id"], newer["id"])

    def test_new_session_does_not_take_another_sessions_inflight_task(self):
        busy = ai_tasks.begin_task("A", "Busy", now=100, session="one")
        ai_panels.leave_message(busy["id"], "keep working", now=101)
        running = ai_tasks.begin_step("A", "describe_canvas", {}, 102, True, session="one")
        self.assertIsNotNone(running)
        other = ai_tasks.current_task("A", now=103, session="two")
        self.assertNotEqual(other["id"], busy["id"])
        self.assertEqual(ai_tasks.active_task_id("A", "one"), busy["id"])

    def test_recent_panel_answer_can_resume_its_task(self):
        asked = self.ask()
        task, step = ai_panels._find(asked["panel"])
        task["ended"] = time.time()
        ai_panels.answer(task["id"], step["id"], "answer", choice=["b"])
        ai_tasks._current.clear()
        self.assertEqual(ai_tasks.current_task("A", session="next")["id"], task["id"])

    def test_typing_defers_automatic_choice(self):
        asked = self.ask()
        task, step = ai_panels._find(asked["panel"])
        late = step["at"] + ai_gates.answer_wait() + 5
        ai_answer_wait.typing(task["id"], now=late - 1)
        with mock.patch.object(ai_gates, "no_answer", return_value="recommended"):
            answer = ai_answer_wait.wait_on(asked["panel"], now=late)
        self.assertTrue(answer["keep_waiting"])
        self.assertTrue(answer["typing"])
        self.assertFalse(step.get("answers"))

    def test_a_half_written_answer_is_never_overruled(self):
        asked = self.ask()
        task, step = ai_panels._find(asked["panel"])
        ai_answer_wait.typing(task["id"], now=step["at"] + 30)  # then they walked away
        late = step["at"] + 30 + ai_answer_wait.AFTER_TYPING + ai_gates.answer_wait()
        with mock.patch.object(ai_gates, "no_answer", return_value="recommended"):
            answer = ai_answer_wait.wait_on(asked["panel"], now=late)
        self.assertIs(answer["keep_waiting"], False, "the AI does not wait forever")
        self.assertIn("began writing", answer["note"])
        self.assertFalse(step.get("answers"), "the recommended option is not taken over their words")

    def test_typing_before_the_question_does_not_count_as_an_answer(self):
        asked = self.ask()
        task, step = ai_panels._find(asked["panel"])
        ai_answer_wait.typing(task["id"], now=step["at"] - 100)  # a message to the AI, before it asked
        with mock.patch.object(ai_gates, "no_answer", return_value="recommended"):
            answer = ai_answer_wait.wait_on(asked["panel"], now=step["at"] + ai_gates.answer_wait() + 1)
        self.assertTrue(answer.get("took_recommended"))

    def test_ineligible_replies_never_resume_a_task(self):
        for entry in ({"at": 100}, {"at": 7301}, {"at": 7299, "delivered": True},
                      {"at": 7299, "recommended_on_timeout": True}):
            with self.subTest(entry=entry):
                isolate()
                task = ai_tasks.begin_task("A", "Old", now=100)
                task["steps"].append({"kind": "panel", "answers": {"answer": entry}})
                ai_tasks._current.clear()
                self.assertNotEqual(ai_tasks.current_task("A", now=7300)["id"], task["id"])

    def test_timeout_with_multiple_panels_delivers_once_and_keeps_other_question(self):
        asked = self.ask()
        other = self.ask(False)
        task, step = ai_panels._find(asked["panel"])
        step["at"] -= ai_gates.answer_wait() + 5
        with mock.patch.object(ai_gates, "no_answer", return_value="recommended"):
            answer, _ = mcp_task_tools.get_answers(self.ctx)
            again, _ = mcp_task_tools.get_answers(self.ctx)
        self.assertEqual(len(answer["answers"]), 1)
        self.assertEqual(answer["still_waiting"], [{"panel": other["panel"], "question": "answer"}])
        self.assertEqual(again["answers"], [])
        self.assertTrue(again["keep_waiting"])

    def test_ask_user_returns_a_racing_user_answer(self):
        original = ai_panels.answer
        def user_first(task_id, step_id, block_id, **kwargs):
            original(task_id, step_id, block_id, choice=["b"])
            return original(task_id, step_id, block_id, **kwargs)
        with mock.patch.object(ai_gates, "answer_wait", return_value=0), \
                mock.patch.object(ai_gates, "no_answer", return_value="recommended"), \
                mock.patch.object(ai_panels, "answer", side_effect=user_first):
            got = self.ask()
        self.assertTrue(got["answered"])
        self.assertEqual(got["choice"], ["b"])

    def test_ask_user_delivers_messages_and_images_received_while_waiting(self):
        from api import ai_marks
        original = ai_panels.get_answers
        sent = []
        def message_first(client, panel_id=None, *args, **kwargs):
            if not sent:
                task, _ = ai_panels._find(panel_id)
                sent.append(ai_panels.leave_message(task["id"], "Stop and read this first"))
            return original(client, panel_id, *args, **kwargs)
        with mock.patch.object(mcp_task_tools, "ASK_WAIT_MIN", 0), \
                mock.patch.object(ai_panels, "get_answers", side_effect=message_first), \
                mock.patch.object(ai_marks, "image_items", return_value=[{"type": "image"}]) as images:
            got, media = mcp_task_tools.TASK_TOOLS["ask_user"]["run"](self.ctx, question="Which?", wait_seconds=0)
        self.assertFalse(got["answered"])
        self.assertEqual(got["messages"][0]["id"], sent[0]["id"])
        self.assertEqual(media, [{"type": "image"}])
        images.assert_called_once_with(got["messages"])
        self.assertNotIn("messages", original("A"))

    def test_simultaneous_user_answer_and_timeout_commit_only_one_choice(self):
        asked = self.ask()
        task, step = ai_panels._find(asked["panel"])
        late = step["at"] + ai_gates.answer_wait() + 5
        start = threading.Barrier(2)
        def user():
            start.wait(timeout=5)
            try:
                ai_panels.answer(task["id"], step["id"], "answer", choice=["b"])
                return True
            except ai_panels.PanelError as error:
                self.assertEqual(str(error), "Already answered")
                return False
        def timeout():
            start.wait(timeout=5)
            return ai_answer_wait.wait_on(asked["panel"], now=late)
        with mock.patch.object(ai_gates, "no_answer", return_value="recommended"), ThreadPoolExecutor(2) as pool:
            user_result, timeout_result = pool.submit(user), pool.submit(timeout)
            won = user_result.result(timeout=10)
            timeout_result.result(timeout=10)
        received = ai_panels.get_answers("A", asked["panel"])
        self.assertEqual(len(received["answers"]), 1)
        self.assertEqual(received["answers"][0]["choice"], ["b"] if won else ["a"])
        self.assertEqual(bool(received["answers"][0].get("recommended_on_timeout")), not won)
        self.assertEqual(ai_panels.get_answers("A", asked["panel"])["answers"], [])

    def test_message_arriving_at_deadline_prevents_an_automatic_choice(self):
        asked = self.ask()
        task, step = ai_panels._find(asked["panel"])
        step["at"] -= ai_gates.answer_wait() + 5
        original = ai_panels.get_answers
        sent = []
        def message_after_snapshot(*args, **kwargs):
            snapshot = original(*args, **kwargs)
            if not sent:
                sent.append(ai_panels.leave_message(task["id"], "Stop, I changed my mind"))
            return snapshot
        with mock.patch.object(ai_panels, "get_answers", side_effect=message_after_snapshot), \
                mock.patch.object(ai_gates, "no_answer", return_value="recommended"):
            result, _ = mcp_task_tools.get_answers(self.ctx)
        self.assertEqual(result["messages"][0]["id"], sent[0]["id"])
        self.assertEqual(result["answers"], [])
        self.assertFalse(step.get("answers"))
