"""run_workflow's blanks (api/mcp_fill.py): a saved workflow opened for the task once and reused,
the blanks filled before the run, a picture from the input or output folder, and the gate a run
that changes the canvas asks at. The page is stood in for; folders and tasks are temporary."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_gates, ai_task_canvas, ai_tasks, mcp_actions, mcp_fill, mcp_tools  # noqa: E402
from test_ai_tasks import isolate  # noqa: E402

GATES = tempfile.mkdtemp(prefix="amb_fill_gates_")


class FillTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.task = ai_tasks.begin_task("Flash", "海边少女")["id"]
        self.ctx = {"client": "Flash", "task": self.task}
        self.calls, self.answers = [], []

        def page(action, args, timeout=30):
            self.calls.append((action, dict(args)))
            return self.answers.pop(0)
        for patcher in (mock.patch.object(mcp_fill, "ask_page", side_effect=page),
                        mock.patch.object(mcp_fill, "saved_workflow", return_value=("海边.json", "海边"))):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_opened_once_for_the_task_then_reused(self):
        self.answers = [{"opened": "海边 0312"}, {"set": {"prompt": [6]}}]
        got = mcp_fill.fill(self.ctx, "海边", prompt="少女", seed=None)
        self.assertEqual(got, {"workflow": "海边", "prompt": [6]})
        self.assertEqual([action for action, _ in self.calls], ["open_workflow", "fill_slots"], "no tab yet: opened first")
        self.assertEqual(self.calls[1][1], {"filename": "海边.json", "prompt": "少女"}, "a blank left out is not sent")
        with ai_tasks._lock:
            ai_tasks._load()[self.task]["canvas"] = {"mode": "new", "tab": {"path": "海边 0312.json", "name": "海边 0312"}}
        self.calls, self.answers = [], [{"set": {"seed": [3]}}]
        self.assertEqual(mcp_fill.fill(self.ctx, "海边", seed=7), {"workflow": "海边", "seed": [3]})
        self.assertEqual([action for action, _ in self.calls], ["fill_slots"], "the task's tab already holds it")

    def test_another_workflow_on_the_tab_opens_this_one(self):
        ai_task_canvas.set_mode(self.task, "current")
        self.answers = [{"needs_open": True}, {"opened": "海边"}, {"set": {}}]
        self.assertEqual(mcp_fill.fill(self.ctx, "海边"), {"workflow": "海边"})
        self.assertEqual([action for action, _ in self.calls], ["fill_slots", "open_workflow", "fill_slots"])
        self.calls, self.answers = [], [{"needs_open": True}, {"opened": "海边"}, {"needs_open": True}]
        with self.assertRaises(mcp_tools.ToolError):
            mcp_fill.fill(self.ctx, "海边")

    def test_blanks_alone_and_nothing_at_all(self):
        self.assertIsNone(mcp_fill.fill(self.ctx, None, prompt=""))
        self.assertEqual(self.calls, [])
        self.answers = [{"set": {"size": [4]}}]
        self.assertEqual(mcp_fill.fill(self.ctx, None, width=1024), {"size": [4]})
        self.assertEqual(self.calls, [("fill_slots", {"filename": None, "width": 1024})])

    def test_the_run_carries_what_was_filled_and_stops_when_it_fails(self):
        with mock.patch.object(mcp_actions, "ask_page", return_value={"prompt_ids": ["p1"]}) as run:
            self.answers = [{"opened": "海边"}, {"set": {"prompt": [6]}}]
            answer = mcp_actions.run_workflow(self.ctx, workflow="海边", prompt="少女", wait_seconds=0)
            self.assertEqual(answer["filled"], {"workflow": "海边", "prompt": [6]})
            self.assertEqual(run.call_args.args[0], "run_workflow")
            run.reset_mock()
            with mock.patch.object(mcp_fill, "fill", side_effect=mcp_tools.ToolError("No positive prompt box")):
                with self.assertRaises(mcp_tools.ToolError):
                    mcp_actions.run_workflow(self.ctx, prompt="少女", wait_seconds=0)
            run.assert_not_called()  # nothing queued


class PictureTests(unittest.TestCase):
    def test_input_as_it_is_output_marked(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(os.path.realpath(temp.name))
        for name in ("output", "input"):
            (root / name).mkdir()
            patcher = mock.patch.object(mcp_tools.folder_paths, f"get_{name}_directory", return_value=str(root / name))
            patcher.start()
            self.addCleanup(patcher.stop)
        (root / "input" / "mask.png").write_bytes(b"x")
        (root / "output" / "result.png").write_bytes(b"x")
        self.assertEqual(mcp_fill._picture("mask.png"), "mask.png")
        self.assertEqual(mcp_fill._picture("result.png"), "result.png [output]")
        with self.assertRaises(mcp_tools.ToolError):
            mcp_fill._picture("missing.png")


class GateTests(unittest.TestCase):
    def setUp(self):
        isolate()
        ai_gates._path = lambda: os.path.join(GATES, "ai_gates.json")
        if os.path.exists(ai_gates._path()):
            os.remove(ai_gates._path())

    def test_a_run_that_fills_the_canvas_asks_as_the_canvas_does(self):
        ai_gates.set_policy("canvas", "never")
        ref = ai_tasks.begin_step("Flash", "run_workflow", {}, time.time(), False)
        self.assertIsNone(ai_gates.check("run_workflow", {"batch": 1}, ref), "a plain run: the GPU's gate (auto)")
        blocked = ai_gates.check("run_workflow", {"prompt": "少女"}, ref)
        self.assertTrue(blocked["isError"])
        self.assertIn("canvas", blocked["content"][0]["text"])


if __name__ == "__main__":
    unittest.main()
