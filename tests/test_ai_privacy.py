"""Privacy mode (api/ai_privacy.py): a private task's pictures never leave through any tool, nor
through what is added after the tool (run pictures, the user's messages); the switch per task and
the default, told to the AI; a call tied to no task is private when in doubt; the card shows no
pictures. Temporary folders only."""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_decisions, ai_gates, ai_privacy, ai_tasks, mcp_apps, mcp_server, mcp_task_tools  # noqa: E402
from test_mcp import rpc  # noqa: E402  (its module keeps tasks and gates in temporary folders)

SETTING = os.path.join(tempfile.mkdtemp(prefix="amb_privacy_"), "ai_privacy.json")
PICTURE = {"type": "image", "data": "aGVsbG8=", "mimeType": "image/png"}


def with_picture(*args, **kwargs):
    data = {"done": True}
    return {"content": [{"type": "text", "text": json.dumps(data)}, PICTURE], "structuredContent": data, "isError": False}


class PrivacyTests(unittest.TestCase):
    def setUp(self):
        ai_tasks._tasks, ai_tasks._current = None, {}
        for name in os.listdir(ai_tasks.tasks_dir()):
            os.remove(os.path.join(ai_tasks.tasks_dir(), name))
        if os.path.exists(SETTING):
            os.remove(SETTING)
        patcher = mock.patch.object(ai_privacy, "_path", lambda: SETTING)
        patcher.start()
        self.addCleanup(patcher.stop)

    def task(self, private=None):
        task = ai_tasks.begin_task("test", "a private picture", new_task=True)
        if private is not None:
            ai_privacy.set_private(task["id"], private)
        return task["id"]

    def test_guard_takes_the_pictures_out_and_says_why(self):
        kept = ai_privacy.guard(with_picture(), True)
        self.assertEqual([item["type"] for item in kept["content"]], ["text", "text"])
        self.assertEqual(kept["structuredContent"]["privacy"], ai_privacy.NOTE)
        self.assertIn(PICTURE, ai_privacy.guard(with_picture(), False)["content"])
        plain = {"content": [{"type": "text", "text": "{}"}], "structuredContent": {}}
        self.assertNotIn("privacy", ai_privacy.guard(plain, True)["structuredContent"], "nothing taken, nothing said")

    def test_no_tool_lets_a_picture_through_for_a_private_task(self):
        task = self.task(True)
        with mock.patch.object(mcp_server, "call_tool", side_effect=with_picture), \
                mock.patch.object(ai_gates, "check", return_value=None), \
                mock.patch.object(mcp_server.ai_task_runs, "watch"), \
                mock.patch.object(mcp_server.ai_run_tracking, "wait_for_receipt"):
            for name in mcp_server.TOOLS:
                with self.subTest(tool=name):
                    result = rpc("tools/call", {"name": name, "arguments": {"task": task}}, name)["result"]
                    self.assertFalse([item for item in result["content"] if item.get("type") == "image"])
                    self.assertNotIn("aGVsbG8=", json.dumps(result))

    def test_pictures_added_after_the_tool_are_taken_out_too(self):
        task = self.task(True)
        add = lambda result, task_id: result["content"].append(PICTURE)  # as a finished run's pictures are
        with mock.patch.object(mcp_server.ai_task_runs, "show_pictures", side_effect=add):
            result = rpc("tools/call", {"name": "get_answers", "arguments": {"task": task}}, "get_answers")["result"]
        self.assertNotIn("aGVsbG8=", json.dumps(result))
        self.task(False)  # another task, not private: the run's pictures go to the AI
        with mock.patch.object(mcp_server.ai_task_runs, "show_pictures", side_effect=add):
            result = rpc("tools/call", {"name": "get_answers", "arguments": {}}, "get_answers")["result"]
        self.assertIn("aGVsbG8=", json.dumps(result))

    def test_the_switch_per_task_is_told_to_the_ai_and_a_decision(self):
        task = self.task()
        self.assertFalse(ai_privacy.is_private(ai_tasks.get_task(task)))
        ai_privacy.set_private(task, True)
        ai_privacy.set_private(task, True)  # again: nothing new
        record = ai_tasks.get_task(task)
        steps = [step for step in record["steps"] if step["tool"] == "user_privacy"]
        self.assertEqual(len(steps), 1)
        self.assertFalse(steps[0]["delivered"])
        self.assertIn("privacy mode on", steps[0]["text"])
        self.assertIn("The user turned privacy mode on: no pictures reach you", ai_decisions.lines(record))
        with self.assertRaises(ValueError):
            ai_privacy.set_private(task, "yes")

    def test_the_default_and_calls_tied_to_no_task(self):
        self.assertFalse(ai_privacy.applies(None))
        ai_privacy.set_default(True)
        task = self.task()
        self.assertTrue(ai_privacy.applies(task), "a new task follows the default")
        self.assertTrue(ai_privacy.applies(None))
        ai_privacy.set_default(False)
        self.assertTrue(ai_privacy.applies(task), "a task private by the old default stays private")
        self.assertTrue(ai_privacy.applies(None), "an unfinished private task: in doubt, private")
        ai_tasks.get_task(task)  # loaded
        with ai_tasks._lock:
            ai_tasks._load()[task]["ended"] = time.time()
        self.assertFalse(ai_privacy.applies(None))

    def test_begin_task_says_so_and_the_card_shows_no_pictures(self):
        task = self.task(True)
        with mock.patch.object(mcp_task_tools, "_blocks", lambda ctx: {}):
            answer = mcp_task_tools.begin_task({"client": "test", "task": task}, "a private picture")
        self.assertEqual(answer["privacy"], ai_privacy.NOTE)
        self.assertNotIn("skills", answer, "no prompt advice: the user writes the prompts")
        with ai_tasks._lock:
            ai_tasks._load()[task]["steps"].append({"id": "r", "at": time.time(), "tool": "run_workflow", "kind": "run",
                                                    "results": [{"type": "image", "filename": "a.png", "subfolder": ""}]})
        with mock.patch.object(mcp_apps, "_picture", return_value={"name": "a.png", "src": "data:image/png;base64,aGVsbG8="}):
            view = mcp_apps.task_view({"client": "test"}, task=task)
            self.assertEqual((view["pictures"], view["private"]), ([], True))
            ai_privacy.set_private(task, False)
            self.assertEqual(len(mcp_apps.task_view({"client": "test"}, task=task)["pictures"]), 1)


if __name__ == "__main__":
    unittest.main()
