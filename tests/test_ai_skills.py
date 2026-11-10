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

from api import ai_skills, ai_tasks, mcp_actions, mcp_fit, mcp_task_tools, reference_blocks  # noqa: E402
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

    def test_staged_picture_is_discovered_and_points_to_the_ways(self):
        with mock.patch.object(mcp_task_tools, "_blocks", lambda ctx: {}):
            listed = mcp_task_tools.begin_task(self.ctx, "a picture in two passes")["skills"]
        self.assertIn("staged_picture", listed)
        answer = mcp_task_tools.get_toolbox(self.ctx, skill="staged_picture")
        advice, ways = " ".join(answer["advice"]), " ".join(answer["ways"])
        for way in ("use='refine', want='midway'", "use='upscale', want='tile'", "use='refine':", "its own model copy",
                    "use='refine', want='character'", "use='refine', want='background'", "use='upscale', want='character'",
                    "may cross families", "may enlarge at the switch", "draws the blur sharp"):
            self.assertIn(way, ways)
        self.assertNotIn("want=", advice, "which ways there are is told from the blocks, not written into the skill")
        self.assertIn('"ways" lists those this ComfyUI can run now', advice)
        self.assertIn("add_lora it onto the second model", advice)
        self.assertIn("Never add a style, artist or LoRA the user did not pick", advice)
        self.assertIn("control_after_generate", advice)
        self.assertIn("base_only=true", advice)
        self.assertIn("does not sit on its bench", advice)
        ai_skills.set_on("staged_picture", False)
        self.assertNotIn("staged_picture", ai_skills.directory())
        with self.assertRaises(ai_skills.SkillError):
            ai_skills.get("staged_picture")

    def test_a_skill_lists_only_the_ways_that_can_run_here(self):
        every = ai_skills.get("staged_picture")["ways"]
        self.assertEqual(len(every), len([block for block in reference_blocks.BLOCKS.values() if block["job"] in ("refine", "upscale")]),
                         "each way of the skill's uses says when it is the one to take")
        own_nodes = {kind: {} for kind in ("CheckpointLoaderSimple", "KSampler")}  # no pack, no upscale model
        here = ai_skills.get("staged_picture", info=own_nodes)["ways"]
        self.assertEqual([line.split(":")[0] for line in here], ["use='refine'", "use='refine', want='midway'"])
        with mock.patch.object(reference_blocks, "turned_off", return_value={"switch_midway"}):
            self.assertEqual([line.split(":")[0] for line in ai_skills.get("staged_picture", info=own_nodes)["ways"]], ["use='refine'"])
        self.assertNotIn("ways", ai_skills.get("prompt_pose"), "a skill that names no uses lists none")

    def test_every_answer_fits_what_an_ai_app_shows_in_the_chat(self):
        for name, skill in ai_skills.SKILLS.items():
            forms = ({"name": "a.safetensors", "params": params} for params in (0, 1, 10 ** 11)) if skill.get("by_model") else (None,)
            for model in forms:
                with self.subTest(skill=name, model=model):
                    answer = ai_skills.get(name, model, bool(skill.get("private_only")))  # every way listed: the longest it gets
                    self.assertLessEqual(mcp_fit.size(answer), mcp_fit.BUDGET)

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

    def test_a_skill_fetched_is_a_step_once_until_the_next_run(self):
        def fetch(params):
            with mock.patch.object(mcp_task_tools, "_canvas_model", return_value={"name": "Anima/K.safetensors", "params": params}):
                return mcp_task_tools.get_toolbox(self.ctx, skill="prompt_pose")
        steps = lambda: [step for step in ai_tasks.get_task(self.ctx["task"])["steps"] if step["tool"] == "use_skill"]
        self.assertEqual(fetch(2_100_000_000)["for_model"], {"form": "small", "model": "K", "billions": 2.1})
        fetch(2_100_000_000)
        self.assertEqual(len(steps()), 1, "the same advice again adds nothing")
        self.assertEqual((steps()[0]["kind"], steps()[0]["title"]["zh"]), ("skill", "写提示词·动作适合模型"))
        fetch(12_000_000_000)
        self.assertEqual([step["for_model"]["form"] for step in steps()], ["small", "large"], "another form is a step")
        ai_tasks.record("Gemini", "run_workflow", {}, ok({}), time.time(), task_id=self.ctx["task"])
        fetch(12_000_000_000)
        self.assertEqual(len(steps()), 3, "after a run it is told again")

    def test_a_skill_does_not_name_a_task(self):
        task = {"title": "", "title_from": "auto", "steps": []}  # a task the AI began without a title
        ai_tasks._add_step(task, {"id": "s", "at": time.time(), "tool": "use_skill", "kind": "skill", "ok": True, "summary": "use_skill"})
        self.assertEqual(task["title"], "")

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
