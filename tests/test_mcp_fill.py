"""run_workflow's blanks (api/mcp_fill.py): a saved workflow, or one of its 方案, opened for the task
once and reused, the blanks filled before the run, a picture from the input or output folder, and
the gate a run that changes the canvas asks at. The page is stood in for; folders and tasks are temporary."""
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

from PIL import Image  # noqa: E402

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
                        mock.patch.object(mcp_fill, "saved_workflow", return_value=("海边.json", "海边", None))):
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

    def test_a_plan_opens_its_workflow_with_that_set_and_has_a_tab_of_its_own(self):
        with mock.patch.object(mcp_fill, "saved_workflow", return_value=("海边.json", "海边 / 夕阳", "params_1.json")):
            self.answers = [{"opened": "海边 / 夕阳"}, {"set": {}}]
            self.assertEqual(mcp_fill.fill(self.ctx, "海边 / 夕阳"), {"workflow": "海边 / 夕阳"})
        self.assertEqual(self.calls[0], ("open_workflow", {"filename": "海边.json", "name": "海边 / 夕阳", "plan": "params_1.json"}))
        self.assertEqual(self.calls[1], ("fill_slots", {"filename": "海边.json#params_1.json"}), "the plan's tab, not the workflow's own")

    def test_a_gallery_picture_runs_its_own_workflow_in_a_tab_of_its_own(self):
        picture = {"subfolder": "cmp", "filename": "made_00001_.png"}
        with mock.patch.object(mcp_fill, "saved_workflow", side_effect=mcp_tools.ToolError("No saved workflow")), \
                mock.patch.object(mcp_fill, "picture_workflow", return_value=picture):
            self.answers = [{"opened": "made_00001_"}, {"set": {"prompt": "x"}}]
            self.assertEqual(mcp_fill.fill(self.ctx, "cmp/made_00001_.png", prompt="x")["workflow"], "made_00001_")
        self.assertEqual(self.calls[0], ("open_workflow", {"picture": picture, "name": "made_00001_"}))
        self.assertEqual(self.calls[1][1]["filename"], "picture:cmp/made_00001_.png", "the tab is the picture's, reused next time")
        with mock.patch.object(mcp_fill, "saved_workflow", side_effect=mcp_tools.ToolError("No saved workflow")), \
                mock.patch.object(mcp_fill, "picture_workflow", return_value=None), self.assertRaises(mcp_tools.ToolError):
            mcp_fill.fill(self.ctx, "海边夕阳")

    def test_blanks_alone_and_nothing_at_all(self):
        self.assertIsNone(mcp_fill.fill(self.ctx, None, prompt=""))
        self.assertEqual(self.calls, [])
        self.answers = [{"set": {"size": [4]}}]
        self.assertEqual(mcp_fill.fill(self.ctx, None, width=1024), {"size": [4]})
        self.assertEqual(self.calls, [("fill_slots", {"filename": None, "width": 1024})])

    def test_other_settings_go_by_name_and_bad_ones_never_reach_the_page(self):
        self.answers = [{"set": {"values": [3, 12]}}]
        self.assertEqual(mcp_fill.fill(self.ctx, None, values={"steps": 30, "12": {"denoise": 0.5}}), {"values": [3, 12]})
        self.assertEqual(self.calls[-1], ("fill_slots", {"filename": None, "values": {"steps": 30, "12": {"denoise": 0.5}}}))
        with self.assertRaises(mcp_tools.ToolError):
            mcp_fill.fill(self.ctx, None, values={"sampler": {"denoise": 0.5}})
        self.assertEqual(len(self.calls), 1)

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
    def test_input_as_it_is_output_copied_there(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(os.path.realpath(temp.name))
        for name in ("output", "input"):
            (root / name).mkdir()
            patcher = mock.patch.object(mcp_tools.folder_paths, f"get_{name}_directory", return_value=str(root / name))
            patcher.start()
            self.addCleanup(patcher.stop)
        (root / "input" / "mask.png").write_bytes(b"x")
        Image.new("RGB", (4, 4), "red").save(root / "output" / "result.png")
        self.assertEqual(mcp_fill._picture("mask.png"), "mask.png")
        copied = mcp_fill._picture("result.png")  # not "result.png [output]": ComfyUI's page flags it as missing later
        self.assertTrue(copied.startswith("anomalous_reference_"))
        self.assertTrue((root / "input" / copied).is_file())
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


class SavedTests(unittest.TestCase):
    """Saved workflows and their 方案 as list_workflows lists them and run_workflow finds them."""

    def setUp(self):
        user = tempfile.mkdtemp(prefix="amb_fill_saved_")
        patcher = mock.patch.object(mcp_tools.folder_paths, "get_user_directory", return_value=user)
        patcher.start()
        self.addCleanup(patcher.stop)
        own = {"parameter_signature": {"value": "own"}}
        for folder, name, data in (("anomalous_recipes", "recipe_a.json", {"name": "Anima 两段", "timestamp": 2, **own}),
                                   ("anomalous_recipes", "recipe_b.json", {"name": "海边", "timestamp": 1}),
                                   ("anomalous_parameters", "params_1.json", {"name": "左", "recipe_filename": "recipe_a.json", "timestamp": 1}),
                                   ("anomalous_parameters", "params_2.json", {"name": "中", "recipe_filename": "recipe_a.json", "timestamp": 2}),
                                   ("anomalous_parameters", "params_0.json", {"name": "Anima 两段", "recipe_filename": "recipe_a.json",
                                                                              "timestamp": 3, **own})):
            os.makedirs(os.path.join(user, "workflows", folder), exist_ok=True)
            with open(os.path.join(user, "workflows", folder, name), "w", encoding="utf-8") as target:
                json.dump(data, target)

    def test_each_workflow_lists_its_plans_and_a_run_finds_them(self):
        listed = {item["name"]: item for item in mcp_tools.list_workflows()["workflows"]}
        self.assertEqual(listed["Anima 两段"]["plans"], ["Anima 两段 / 中", "Anima 两段 / 左"],
                         "newest first, named for run_workflow; the set equal to the workflow's own values is left out")
        self.assertNotIn("plans", listed["海边"])
        self.assertEqual([item["name"] for item in mcp_tools.list_workflows("左")["workflows"]], ["Anima 两段"], "found by a plan's name")
        self.assertEqual(mcp_fill.saved_workflow("海边"), ("recipe_b.json", "海边", None))
        self.assertEqual(mcp_fill.saved_workflow("Anima 两段 / 左"), ("recipe_a.json", "Anima 两段 / 左", "params_1.json"))
        for wrong in ("Anima 两段 / 右", "海边 / 左", "nothing", ""):
            with self.assertRaises(mcp_tools.ToolError, msg=wrong):
                mcp_fill.saved_workflow(wrong)


if __name__ == "__main__":
    unittest.main()
