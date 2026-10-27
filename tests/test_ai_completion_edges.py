"""Completion follow-ups and error recovery use real task records in temporary storage."""
import unittest

from test_ai_tasks import isolate, ok, failed
from api import ai_panels, ai_tasks
from api.ai_task_handoff import AFTER_DONE


class CompletionEdges(unittest.TestCase):
    def setUp(self):
        isolate()

    def done(self, session="one"):
        task = ai_tasks.begin_task("A", "Finished", now=100, session=session)
        ai_tasks.report("A", "Done", done=True, now=110, session=session)
        return task

    def test_explicit_read_after_done_stays_in_finished_task(self):
        task = self.done()
        ref = ai_tasks.begin_step("A", "get_situation", {}, 111, True, session="one", task_id=task["id"])
        ai_tasks.finish_step("A", "get_situation", {}, ok({}), 111, True, step_ref=ref)
        self.assertEqual(ref[0], task["id"])
        self.assertEqual(task["ended"], 110)
        self.assertEqual(len(ai_tasks.list_tasks()), 1)

    def test_explicit_panel_uses_named_finished_task_not_another_active_task(self):
        finished = self.done()
        active = ai_tasks.begin_task("A", "Other", now=112, session="one", new_task=True)
        panel = ai_panels.show("A", "Result", [{"type": "text", "text": "Before / after"}],
                               now=113, session="one", task_id=finished["id"])
        self.assertEqual(ai_panels._find(panel["id"])[0]["id"], finished["id"])
        self.assertIsNone(finished["ended"])
        self.assertFalse(active["steps"])

    def test_read_without_step_reference_keeps_explicit_finished_task(self):
        task = self.done()
        ai_tasks.record("A", "describe_canvas", {}, ok({}), 111, True, session="one", task_id=task["id"])
        self.assertEqual(len(ai_tasks.list_tasks()), 1)
        self.assertEqual(task["steps"][-1]["tool"], "describe_canvas")
        self.assertEqual(task["ended"], 110)

    def test_running_retry_does_not_hide_previous_failure(self):
        ai_tasks.record("A", "set_model", {"node_id": 1, "model_id": "missing"}, failed("Missing model"), 100)
        ref = ai_tasks.begin_step("A", "set_model", {"node_id": 1, "model_id": "found"}, 101)
        task = ai_tasks.get_task(ref[0])
        self.assertEqual(ai_tasks.task_summary(task)["errors"], 1)
        ai_tasks.finish_step("A", "set_model", {"node_id": 1, "model_id": "found"}, ok({}), 101, step_ref=ref)
        self.assertEqual(ai_tasks.task_summary(ai_tasks.get_task(ref[0]))["errors"], 0)

    def test_waiting_for_approval_is_not_a_successful_retry(self):
        ai_tasks.record("A", "set_prompt", {"prompt": "x"}, failed("Failed"), 100)
        ai_tasks.record("A", "set_prompt", {"prompt": "x"}, ok({"waiting_for_user": True}), 101)
        self.assertEqual(ai_tasks.list_tasks()[0]["errors"], 1)

    def test_a_retry_with_the_arguments_put_right_resolves_a_failure_that_named_none(self):
        ai_tasks.record("A", "set_model", {"node": 1, "model": "x"}, failed("Unknown arguments"), 100)
        ai_tasks.record("A", "get_model", {}, failed("model_id is required"), 101)
        ai_tasks.record("A", "set_model", {"node_id": 1, "model_id": "x"}, ok({}), 102)
        ai_tasks.record("A", "get_model", {"model_id": "loras:0:a.safetensors"}, ok({}), 103)
        self.assertEqual(ai_tasks.list_tasks()[0]["errors"], 0)

    def test_success_on_a_different_node_does_not_resolve_a_failure(self):
        ai_tasks.record("A", "set_model", {"node_id": 1, "model_id": "missing"}, failed("Missing model"), 100)
        ai_tasks.record("A", "set_model", {"node_id": 2, "model_id": "found"}, ok({}), 101)
        self.assertEqual(ai_tasks.list_tasks()[0]["errors"], 1)

    def test_cancelled_run_is_not_a_successful_retry(self):
        task = {"id": "cancelled", "steps": [
            {"tool": "run_workflow", "kind": "run", "ok": False, "state": "error", "results": []},
            {"tool": "run_workflow", "kind": "run", "ok": True, "state": "cancelled", "results": []},
        ]}
        self.assertEqual(ai_tasks.task_summary(task)["errors"], 1)

    def test_automatic_followup_yields_to_a_waiting_task(self):
        finished = self.done()
        waiting = ai_tasks.start_task("Next", now=111)
        ref = ai_tasks.begin_step("A", "get_situation", {}, 112, True, session="one")
        self.assertEqual(ref[0], waiting["id"])
        self.assertEqual(finished["ended"], 110)

    def test_explicit_followup_does_not_consume_an_unrelated_waiting_task(self):
        finished = self.done()
        waiting = ai_tasks.start_task("Next", now=111)
        ref = ai_tasks.begin_step("A", "get_situation", {}, 112, True, session="one", task_id=finished["id"])
        self.assertEqual(ref[0], finished["id"])
        self.assertTrue(waiting["waiting"])
        self.assertEqual(ai_tasks._waiting[0], waiting["id"])

    def test_automatic_followup_does_not_cross_sessions_or_completion_window(self):
        for session, when in (("two", 111), ("one", 110 + AFTER_DONE)):
            with self.subTest(session=session, when=when):
                isolate()
                finished = self.done()
                ref = ai_tasks.begin_step("A", "get_situation", {}, when, True, session=session)
                self.assertNotEqual(ref[0], finished["id"])

    def test_a_different_setting_does_not_resolve_the_failed_setting(self):
        ai_tasks.record("A", "set_values", {"node_id": 1, "values": {"steps": 0}}, failed("Invalid steps"), 100)
        ai_tasks.record("A", "set_values", {"node_id": 1, "values": {"cfg": 5}}, ok({}), 101)
        self.assertEqual(ai_tasks.list_tasks()[0]["errors"], 1)
        ai_tasks.record("A", "set_values", {"node_id": "1", "values": {"steps": 20}}, ok({}), 102)
        self.assertEqual(ai_tasks.list_tasks()[0]["errors"], 0)

    def test_recovery_target_survives_reloading_task_records(self):
        ai_tasks.record("A", "set_model", {"node_id": 1, "model_id": "missing"}, failed("Missing"), 100)
        ai_tasks.record("A", "set_model", {"node_id": 2, "model_id": "present"}, ok({}), 101)
        ai_tasks._tasks = None
        self.assertEqual(ai_tasks.list_tasks()[0]["errors"], 1)

    def test_batch_settings_keep_node_and_setting_identity(self):
        ai_tasks.record("A", "set_values", {"values": {"1": {"steps": 0}}}, failed("Invalid steps"), 100)
        ai_tasks.record("A", "set_values", {"values": {"1": {"cfg": 5}}}, ok({}), 101)
        self.assertEqual(ai_tasks.list_tasks()[0]["errors"], 1)
        ai_tasks.record("A", "set_values", {"values": {"1": {"steps": 20}}}, ok({}), 102)
        self.assertEqual(ai_tasks.list_tasks()[0]["errors"], 0)
