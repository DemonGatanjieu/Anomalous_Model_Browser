"""External submissions: exact ownership, duplicate registration, and authoritative results."""
import time
import unittest
from types import SimpleNamespace
from unittest import mock

from test_ai_tasks import isolate, ok
from api import ai_run_tracking, ai_task_runs, ai_tasks
from api.mcp_tools import ToolError


class TrackingTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.task = ai_tasks.begin_task("A", "Test")["id"]
        self.ctx = {"client": "A", "task": self.task}
        self.queue = mock.Mock()
        self.queue.get_current_queue.return_value = ([], [(1, "one"), (2, "two")])
        self.queue.get_history.side_effect = lambda prompt_id: {prompt_id: {
            "status": {"completed": True}, "outputs": {"1": {"images": [{"filename": prompt_id + ".png", "type": "output"}]}}
        }} if prompt_id in ("one", "two") else {}

    def test_external_completion_and_repeated_attachment(self):
        with mock.patch.object(ai_task_runs, "_queue", return_value=self.queue), \
                mock.patch.object(ai_task_runs.threading, "Thread", side_effect=lambda target, **kw: SimpleNamespace(start=target)):
            answer = ai_run_tracking.track_run(self.ctx, ["one"], wait_seconds=0)
            self.assertEqual(answer["state"], "done")
            self.assertEqual(answer["pictures"], ["one.png"])
            ai_run_tracking.track_run(self.ctx, ["two"], wait_seconds=0)
            again = ai_run_tracking.track_run(self.ctx, ["one"], wait_seconds=0)
            self.assertEqual(again["prompt_ids"], ["one"], "retry answers this receipt, not the latest run")
        self.assertEqual(len(ai_tasks.get_task(self.task)["steps"]), 2)

    def test_unknown_or_already_owned_ids_are_not_attached(self):
        with mock.patch.object(ai_task_runs, "_queue", return_value=self.queue), mock.patch.object(ai_task_runs, "watch"):
            with self.assertRaises(ToolError):
                ai_run_tracking.track_run(self.ctx, ["unknown"], wait_seconds=0)
            self.assertEqual(ai_tasks.get_task(self.task)["steps"], [])
            ai_run_tracking.track_run(self.ctx, ["one"], wait_seconds=0)
            other = ai_tasks.begin_task("B", "Other")["id"]
            with self.assertRaises(ToolError):
                ai_run_tracking.track_run({"client": "B", "task": other}, ["one"], wait_seconds=0)
            self.assertEqual(ai_tasks.get_task(other)["steps"], [])

    def test_bad_wait_is_rejected_before_registration(self):
        for value in ("later", float("nan"), True):
            with self.assertRaises(ToolError):
                ai_run_tracking.track_run(self.ctx, ["one"], wait_seconds=value)
        self.assertEqual(ai_tasks.get_task(self.task)["steps"], [])
        self.assertEqual([ai_run_tracking.checked_wait(value) for value in (-1, 30, 120)], [0, 30, 55], "too long: one call's longest")

    def test_recent_contact_and_silence_do_not_claim_execution(self):
        self.assertFalse(ai_tasks.task_summary(ai_tasks.get_task(self.task))["live"])
        step = ai_tasks.record("A", "run_workflow", {}, ok({}), time.time())
        self.assertTrue(ai_tasks.task_summary(ai_tasks.get_task(self.task))["live"])
        ai_task_runs._finish_run(self.task, step["id"], ["one"], {"one": {"status": {"completed": True}}})
        self.assertFalse(ai_tasks.task_summary(ai_tasks.get_task(self.task))["live"])

    def test_receipt_wait_includes_actual_failure(self):
        step = ai_tasks.record("A", "run_workflow", {}, ok({}), time.time())
        ai_task_runs._finish_run(self.task, step["id"], ["one"], {"one": {"status": {"status_str": "error"}}})
        result = ok({"prompt_ids": ["one"], "queued": 1})
        ai_run_tracking.wait_for_receipt(result, "A", "", self.task, 0, step["id"])
        self.assertEqual(result["structuredContent"]["state"], "error")
        self.assertEqual(result["structuredContent"]["prompt_ids"], ["one"])
        self.assertIn('"state": "error"', result["content"][0]["text"])


if __name__ == "__main__":
    unittest.main()
