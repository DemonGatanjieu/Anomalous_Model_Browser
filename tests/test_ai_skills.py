"""Skills (api/ai_skills.py): advice an AI fetches for a kind of job. begin_task lists the ones on,
get_toolbox(skill=…) gives one, a skill the user turned off is neither listed nor given, and the
prompt tools only point at the skill. Temporary folders only."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_skills, ai_tasks, mcp_actions, mcp_task_tools  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402
from test_ai_tasks import isolate, ok  # noqa: E402

OFF = os.path.join(tempfile.mkdtemp(prefix="amb_ai_skills_"), "ai_skills.json")


class SkillTests(unittest.TestCase):
    def setUp(self):
        isolate()
        if os.path.exists(OFF):
            os.remove(OFF)
        for patcher in (mock.patch.object(ai_skills, "_off_path", lambda: OFF),
                        mock.patch.object(mcp_task_tools, "_canvas_model", return_value=None)):  # no page here
            patcher.start()
            self.addCleanup(patcher.stop)
        ai_tasks.record("Gemini", "describe_canvas", {}, ok({}), time.time(), True)
        self.ctx = {"client": "Gemini", "task": ai_tasks.list_tasks()[0]["id"]}

    def test_every_skill_file_is_complete(self):
        self.assertIn("prompt_pose", ai_skills.SKILLS)
        for name, skill in ai_skills.SKILLS.items():
            with self.subTest(skill=name):
                self.assertTrue(skill["short"] and skill["text"])
                for field in ("title", "about"):
                    self.assertTrue(skill[field]["zh"] and skill[field]["en"])

    def test_begin_task_lists_them_and_get_toolbox_gives_one(self):
        with mock.patch.object(mcp_task_tools, "_blocks", lambda ctx: {}):
            listed = mcp_task_tools.begin_task(self.ctx, "a picture")["skills"]
        self.assertIn("prompt_pose", listed)
        self.assertIn("get_toolbox(skill=", listed)
        advice = mcp_task_tools.get_toolbox(self.ctx, skill="prompt_pose")["advice"]
        self.assertTrue(any("as it is" in line for line in advice), "the user's own text is kept")
        with self.assertRaises(ToolError):
            mcp_task_tools.get_toolbox(self.ctx, skill="no_such_skill")

    def test_the_advice_goes_by_the_size_of_the_canvas_model(self):
        def advice(model):
            with mock.patch.object(mcp_task_tools, "_canvas_model", return_value=model):
                return " ".join(mcp_task_tools.get_toolbox(self.ctx, skill="prompt_pose")["advice"])
        large = advice({"name": r"Flux_Kontext\flux1-kontext-dev-Q4_K_S.gguf", "params": 11_900_000_000})
        self.assertIn("flux1-kontext-dev-Q4_K_S is a large model (11.9 billion parameters)", large)
        self.assertNotIn("hide them naturally", large)
        small = advice({"name": "Anima/Kirazuri.safetensors", "params": 2_090_000_000})
        self.assertIn("Kirazuri is a smaller model (2.1 billion parameters)", small)
        self.assertIn("hide them naturally", small)
        self.assertIn("An option, not a rule", small)
        for unknown in (None, {"name": "x.ckpt", "params": 0}):
            self.assertIn("not known", advice(unknown))
        self.assertTrue(advice(None).startswith("For a prompt you write yourself."), "the user's own words first")

    def test_a_skill_turned_off_is_neither_listed_nor_given(self):
        ai_skills.set_on("prompt_pose", False)
        self.assertFalse(next(item for item in ai_skills.status() if item["name"] == "prompt_pose")["on"])
        self.assertNotIn("prompt_pose", ai_skills.directory())
        with self.assertRaises(ToolError):
            mcp_task_tools.get_toolbox(self.ctx, skill="prompt_pose")
        ai_skills.set_on("prompt_pose", True)
        self.assertIn("prompt_pose", ai_skills.directory())
        with self.assertRaises(ai_skills.SkillError):
            ai_skills.set_on("no_such_skill", False)

    def test_the_prompt_tools_point_at_the_skill(self):
        for tool in ("set_prompt", "run_workflow"):
            with self.subTest(tool=tool):
                words = mcp_actions.ACTIONS[tool]["spec"]["inputSchema"]["properties"]["prompt"]["description"]
                self.assertIn('skill="prompt_pose"', words)


if __name__ == "__main__":
    unittest.main()
