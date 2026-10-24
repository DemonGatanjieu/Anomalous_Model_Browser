"""Gates (api/ai_gates.py): what AI apps may do without asking, the step that waits for the
user's OK, an answer that comes after the AI stopped waiting. Everything in temporary folders."""
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_gates, ai_panels, ai_tasks  # noqa: E402
from test_ai_tasks import isolate, ok  # noqa: E402

GATES = tempfile.mkdtemp(prefix="amb_ai_gates_")


class GateTests(unittest.TestCase):
    def setUp(self):
        isolate()
        ai_gates._path = lambda: os.path.join(GATES, "ai_gates.json")
        if os.path.exists(ai_gates._path()):
            os.remove(ai_gates._path())

    def call(self, tool, arguments):
        """What mcp_server does: a running step, the gate, then the outcome recorded."""
        ref = ai_tasks.begin_step("Claude", tool, arguments, time.time(), False)
        verdict = ai_gates.check(tool, arguments, ref)
        result = verdict if verdict is not None else ok({"done": True})
        ai_tasks.finish_step("Claude", tool, arguments, result, time.time(), False, step_ref=ref)
        return ref, verdict

    def answer_soon(self, ref, decision, text=""):
        def later():
            for _ in range(100):
                task = ai_tasks.get_task(ref[0])
                if any(step.get("state") == "asking" for step in task["steps"]):
                    ai_gates.decide(ref[0], ref[1], decision, text)
                    return
                time.sleep(0.02)
        threading.Thread(target=later).start()

    def test_policies(self):
        self.assertEqual(ai_gates.policies(), ai_gates.DEFAULTS)
        self.assertEqual(ai_gates.set_policy("gpu", "ask")["gpu"], "ask")
        self.assertEqual(ai_gates.policies()["gpu"], "ask")
        with self.assertRaises(ValueError):
            ai_gates.set_policy("gpu", "maybe")
        with open(ai_gates._path(), "w", encoding="utf-8") as target:
            json.dump({"canvas": "never", "gpu": "nonsense"}, target)
        self.assertEqual((ai_gates.policies()["canvas"], ai_gates.policies()["gpu"]), ("never", "auto"))

    def test_the_tools_offered(self):
        ai_gates._tools_path = lambda: os.path.join(GATES, "ai_tools.json")
        if os.path.exists(ai_gates._tools_path()):
            os.remove(ai_gates._tools_path())
        self.assertEqual(ai_gates.tool_set(), "full")
        self.assertEqual(ai_gates.set_tool_set("daily"), "daily")
        self.assertEqual(ai_gates.tool_set(), "daily")
        with self.assertRaises(ValueError):
            ai_gates.set_tool_set("tiny")
        with open(ai_gates._tools_path(), "w", encoding="utf-8") as target:
            target.write("[1]")
        self.assertEqual(ai_gates.tool_set(), "full", "a broken file offers everything")

    def test_how_the_ai_waits_for_a_run(self):
        ai_gates._tools_path = lambda: os.path.join(GATES, "ai_tools.json")
        if os.path.exists(ai_gates._tools_path()):
            os.remove(ai_gates._tools_path())
        self.assertEqual(ai_gates.run_wait(), "call", "the user tells the AI when it is done")
        ai_gates.set_tool_set("daily")
        self.assertEqual(ai_gates.set_run_wait("wait"), "wait")
        self.assertEqual((ai_gates.run_wait(), ai_gates.tool_set()), ("wait", "daily"), "one setting keeps the other")
        with self.assertRaises(ValueError):
            ai_gates.set_run_wait("soon")

    def test_auto_and_never(self):
        self.assertIsNone(self.call("set_prompt", {"text": "x"})[1])
        self.assertIsNone(self.call("search_models", {})[1], "reads have no gate")
        ai_gates.set_policy("canvas", "never")
        ref, verdict = self.call("set_prompt", {"text": "x"})
        self.assertTrue(verdict["isError"])
        self.assertEqual(ai_tasks.get_task(ref[0])["steps"][-1]["state"], "error")

    def test_ask_and_allow(self):
        ai_gates.set_policy("gpu", "ask")
        ref = ai_tasks.begin_step("Claude", "run_workflow", {"batch": 2}, time.time(), False)
        self.answer_soon(ref, "allow")
        self.assertIsNone(ai_gates.check("run_workflow", {"batch": 2}, ref))
        step = ai_tasks.get_task(ref[0])["steps"][0]
        self.assertEqual((step["state"], step["gate"]["decision"]), ("running", "allow"))
        self.assertEqual(step["gate"]["lines"], [{"label": "batch", "value": "2"}])

    def test_ask_and_no_with_words(self):
        ai_gates.set_policy("download", "ask")
        ref = ai_tasks.begin_step("Claude", "download_model", {"type": "loras", "url": "u"}, time.time(), False)
        self.answer_soon(ref, "deny", "use the one I have")
        verdict = ai_gates.check("download_model", {"type": "loras", "url": "u"}, ref)
        self.assertTrue(verdict["isError"])
        self.assertIn("use the one I have", verdict["content"][0]["text"])

    def test_one_allow_cannot_authorize_another_call(self):
        ai_gates.set_policy("gpu", "ask")
        ref = ai_tasks.begin_step("Claude", "run_workflow", {}, time.time())
        self.answer_soon(ref, "allow")
        self.assertIsNone(ai_gates.check("run_workflow", {}, ref))
        with mock.patch.object(ai_gates, "WAIT_SECONDS", 0):
            _, verdict = self.call("run_workflow", {})
        self.assertTrue(verdict["structuredContent"]["waiting_for_user"])

    def test_late_allow_is_consumed_only_once_even_after_retry(self):
        ai_gates.set_policy("gpu", "ask")
        with mock.patch.object(ai_gates, "WAIT_SECONDS", 0):
            ref, _ = self.call("run_workflow", {})
            ai_gates.decide(*ref, "allow")
            self.assertIsNone(self.call("run_workflow", {})[1])
            self.assertTrue(self.call("run_workflow", {})[1]["structuredContent"]["waiting_for_user"])

    def test_ask_fails_closed_without_its_record(self):
        ai_gates.set_policy("gpu", "ask")
        for ref in (None, ("missing", "missing")):
            self.assertTrue(ai_gates.check("run_workflow", {}, ref)["isError"])

    def test_late_decision_survives_tool_completion_race(self):
        ai_gates.set_policy("gpu", "ask")
        for decision, expected in (("allow", "allowed"), ("deny", "error")):
            arguments = {"batch": 1 if decision == "allow" else 2}
            ref = ai_tasks.begin_step("Claude", "run_workflow", arguments, time.time())
            with mock.patch.object(ai_gates, "WAIT_SECONDS", 0):
                verdict = ai_gates.check("run_workflow", arguments, ref)
            ai_gates.decide(*ref, decision)
            ai_tasks.finish_step("Claude", "run_workflow", {}, verdict, time.time(), step_ref=ref)
            step = ai_tasks.get_task(ref[0])["steps"][-1]
            self.assertEqual(step["state"], expected)
            self.assertEqual(step["ok"], decision == "allow")

    def test_restart_makes_pending_gate_answer_deliverable(self):
        ai_gates.set_policy("gpu", "ask")
        ref = ai_tasks.begin_step("Claude", "run_workflow", {}, time.time())
        task = ai_tasks._load()[ref[0]]
        task["steps"][-1].update(state="asking", gate={"gate": "gpu", "signature": ai_gates._signature("run_workflow", {})})
        ai_tasks._save(task)
        ai_tasks._tasks = None  # the call waiting on the old process is gone
        ai_gates.decide(*ref, "allow")
        self.assertEqual(ai_tasks.get_task(ref[0])["steps"][-1]["state"], "allowed")
        self.assertEqual(ai_panels.get_answers("Claude", task_id=ref[0])["messages"][0]["kind"], "gate")

    def test_late_decision_wakes_a_waiting_answer_reader(self):
        ai_gates.set_policy("gpu", "ask")
        with mock.patch.object(ai_gates, "WAIT_SECONDS", 0):
            ref, _ = self.call("run_workflow", {})
        waiting = threading.Event()
        original = ai_panels._answered.wait
        def wait(timeout=None):
            waiting.set()
            return original(timeout)
        answers = []
        with mock.patch.object(ai_panels._answered, "wait", side_effect=wait):
            reader = threading.Thread(target=lambda: answers.append(ai_panels.get_answers("Claude", task_id=ref[0], wait_seconds=3)))
            reader.start()
            self.assertTrue(waiting.wait(1))
            ai_gates.decide(*ref, "allow")
            reader.join(1)
            woke_promptly = not reader.is_alive()
            reader.join(3)
        self.assertTrue(woke_promptly, "a decision should wake get_answers, not wait out its timeout")
        self.assertEqual(answers[0]["messages"][0]["kind"], "gate")

    def test_an_answer_after_the_ai_stopped_waiting(self):
        ai_gates.set_policy("gpu", "ask")
        ai_gates.WAIT_SECONDS, wait = 0.05, ai_gates.WAIT_SECONDS
        try:
            ref, verdict = self.call("run_workflow", {"batch": 1})
        finally:
            ai_gates.WAIT_SECONDS = wait
        self.assertTrue(verdict["structuredContent"]["waiting_for_user"])
        self.assertFalse(verdict["isError"])
        self.assertEqual(ai_tasks.get_task(ref[0])["steps"][0]["state"], "asking")
        self.assertEqual(ai_tasks.list_tasks()[0]["asks"], 1, "the task asks the user")
        ai_gates.decide(ref[0], ref[1], "allow", remember=True)
        self.assertEqual(ai_tasks.get_task(ref[0])["steps"][0]["state"], "allowed")
        self.assertEqual(ai_gates.policies()["gpu"], "auto", "remembered: no more asking")
        message = ai_panels.attach_pending(ok({}), "Claude", task_id=ref[0])["structuredContent"]["user_messages"][0]
        self.assertEqual(message["kind"], "gate")
        self.assertIn("call it again", message["text"])
        ai_gates.set_policy("gpu", "ask")
        again, verdict = self.call("run_workflow", {"batch": 1})
        self.assertIsNone(verdict, "the same call goes ahead without asking twice")
        steps = ai_tasks.get_task(ref[0])["steps"]
        self.assertEqual(steps[0]["state"], "done")
        with self.assertRaises(ValueError):
            ai_gates.decide(ref[0], ref[1], "allow")


if __name__ == "__main__":
    unittest.main()
