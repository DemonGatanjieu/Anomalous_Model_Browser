"""The plan card (蓝图): an AI's big steps for a picture as ready-made blocks (api/mcp_plans.py), shown to the
user, who drops steps, swaps a step's model and says build or writes what to change (api/ai_plans.py), and
built as a chain when they say so, at once with "build without asking". Kept in a temporary folder."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import ai_panels, ai_plans, ai_tasks, mcp_plans, reference_blocks  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402

TMP = tempfile.mkdtemp(prefix="amb_ai_plans_")
A, B, C = "diffusion_models:0:Anima/harem.safetensors", "diffusion_models:0:Anima/kirazuri.safetensors", "diffusion_models:0:Anima/other.safetensors"
STEPS = [{"block": "picture", "title": reference_blocks.BLOCKS["picture"]["title"], "model": A, "model_name": "Harem",
          "choices": [{"model_id": C, "name": "Other"}]},
         {"block": "refine_other_model", "title": reference_blocks.BLOCKS["refine_other_model"]["title"], "model": B,
          "model_name": "Kirazuri", "choices": [{"model_id": C, "name": "Other"}]},
         {"block": "detail_face_hands", "title": reference_blocks.BLOCKS["detail_face_hands"]["title"], "model": None},
         {"block": "upscale", "title": reference_blocks.BLOCKS["upscale"]["title"], "model": None}]


def isolate():
    ai_tasks.tasks_dir = lambda: TMP
    ai_tasks._tasks = None
    ai_tasks._current.clear()
    ai_tasks._waiting[0] = None
    for name in os.listdir(TMP):
        os.remove(os.path.join(TMP, name))
    ai_plans.set_auto(False)


class CardTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.task = ai_tasks.start_task("a picture in steps")["id"]

    def card(self):
        panel = ai_panels.show("AI", "Blueprint", [{"type": "plan", "id": "answer", "steps": STEPS}], task_id=self.task, tool="add_nodes")
        return panel, next(step for step in ai_tasks.get_task(self.task)["steps"] if step.get("panel", {}).get("id") == panel["id"])

    def test_only_ready_made_blocks_are_steps(self):
        with self.assertRaisesRegex(ai_panels.PanelError, "ready-made blocks"):
            ai_panels.clean_blocks([{"type": "plan", "id": "answer", "steps": [{"block": "rm -rf"}]}])

    def test_the_user_drops_steps_and_swaps_a_model_from_those_listed(self):
        self.assertEqual(ai_plans.kept(STEPS, {"drop": [2], "models": {"1": C}}),
                         [{"block": "picture", "model": A}, {"block": "refine_other_model", "model": C}, {"block": "upscale", "model": None}])
        with self.assertRaisesRegex(ValueError, "first step"):
            ai_plans.kept(STEPS, {"drop": [0]})
        with self.assertRaisesRegex(ValueError, "listed with it"):
            ai_plans.kept(STEPS, {"models": {"1": "loras:0:x.safetensors"}})

    def test_build_and_words_as_answers(self):
        _panel, step = self.card()
        extra = ai_plans.prepare(self.task, step["id"], ["build"], {"drop": [3]}, True)
        self.assertEqual([item["block"] for item in extra["plan"]], ["picture", "refine_other_model", "detail_face_hands"])
        self.assertTrue(ai_plans.auto(), "build without asking is kept")
        answers = ai_panels.answer(self.task, step["id"], "answer", ["build"], extra=extra)
        self.assertEqual(answers["answer"]["choice"], ["build"])
        handed = ai_panels.get_answers("AI", step["panel"]["id"])["answers"][0]
        self.assertEqual(handed["plan"], extra["plan"], "the steps kept reach the AI, not only the button pressed")
        self.assertIn("add_nodes(route=", handed["note"])
        _panel, other = self.card()
        self.assertIsNone(ai_plans.prepare(self.task, other["id"], None, None, None), "words are no build")
        self.assertEqual(ai_panels.answer(self.task, other["id"], "answer", text="先修手再放大")["answer"]["text"], "先修手再放大")
        _panel, third = self.card()
        with self.assertRaises(ai_panels.PanelError):
            ai_panels.answer(self.task, third["id"], "answer", text="  ")


class ProposeTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.task = ai_tasks.start_task("a picture in steps")["id"]
        self.ctx = {"client": "AI", "task": self.task}
        for patch in (mock.patch("api.mcp_canvas_edit.object_info", return_value={}),
                      mock.patch.object(mcp_plans, "_model", side_effect=lambda model: ({A: "Harem", B: "Kirazuri"}[model], "diffusion_models", "Anima")),
                      mock.patch.object(mcp_plans, "_choices", return_value=[{"model_id": C, "name": "Other"}]),
                      mock.patch.object(mcp_plans.reference_blocks, "pick", side_effect=lambda use, want, *rest: {
                          "picture": "picture", "refine": "refine_other_model", "detail": "detail_face_hands", "upscale": "upscale"}[use])):
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_plan_starts_with_its_picture_and_a_model_needs_a_loader(self):
        with self.assertRaisesRegex(ToolError, "the picture alone is add_nodes"):
            mcp_plans.resolve(self.ctx, [{"use": "picture", "model": A}])
        with self.assertRaisesRegex(ToolError, "starts with the picture"):
            mcp_plans.resolve(self.ctx, [{"use": "upscale"}, {"use": "upscale"}])
        with self.assertRaisesRegex(ToolError, "name the picture's model"):
            mcp_plans.resolve(self.ctx, [{"use": "picture"}, {"use": "upscale"}])
        with self.assertRaisesRegex(ToolError, "no loader of its own"):
            mcp_plans.resolve(self.ctx, [{"use": "picture", "model": A}, {"use": "upscale", "model": B}])
        steps = mcp_plans.resolve(self.ctx, [{"use": "picture", "model": A}, {"use": "refine", "model": B}, {"use": "detail"}])
        self.assertEqual([(step["block"], step.get("model_name")) for step in steps],
                         [("picture", "Harem"), ("refine_other_model", "Kirazuri"), ("detail_face_hands", None)])

    def test_a_models_name_does_and_a_given_picture_way_gives_way_to_one_that_chains(self):
        found = {"models": [{"model_id": A, "name": "MiaoMiao Harem_Anima_1.5"}, {"model_id": B, "name": "Harem"},
                            {"model_id": "loras:0:harem.safetensors", "name": "Harem"}]}
        picks = {("detail", "hands"): "fix_hands", ("detail", None): "detail_face_hands", ("picture", None): "picture"}
        with mock.patch.object(mcp_plans, "search_models", return_value=found), \
                mock.patch.object(mcp_plans.reference_blocks, "pick", side_effect=lambda use, want, *rest: picks[(use, want)]):
            steps = mcp_plans.resolve(self.ctx, [{"use": "picture", "model": "MiaoMiao Harem_Anima_1.5"}, {"use": "detail", "want": "hands"}])
            self.assertEqual([(step["block"], step.get("model")) for step in steps], [("picture", A), ("detail_face_hands", None)],
                             "fix_hands works on a picture handed over; in a plan the details of the step before")
            with self.assertRaisesRegex(ToolError, "is the name of 2"):
                mcp_plans.resolve(self.ctx, [{"use": "picture", "model": "harem"}, {"use": "detail"}])

    def test_built_when_the_user_says_build_or_at_once_when_they_set_it(self):
        built = {"steps": [{"block": "picture", "nodes": {}}, {"block": "refine_other_model", "nodes": {}}], "nodes": {"1.save": "9"}}
        plan = [{"use": "picture", "model": A}, {"use": "refine", "model": B}]
        with mock.patch.object(mcp_plans.block_chain, "build", return_value=built) as chain, \
                mock.patch.object(mcp_plans.ai_answer_wait, "collect", return_value={"answers": [
                    {"question": "answer", "choice": ["build"], "plan": [{"block": "picture", "model": A}]}]}):
            answer = mcp_plans.propose(self.ctx, plan)
        self.assertIn("base_only=true", answer["next"])
        self.assertEqual(chain.call_args.args[1], [{"block": "picture", "model": A, "loras": []}], "as the user left it")
        ai_plans.set_auto(True)
        with mock.patch.object(mcp_plans.block_chain, "build", return_value=built), \
                mock.patch.object(mcp_plans.ai_answer_wait, "collect") as wait:
            answer = mcp_plans.propose(self.ctx, plan)
        wait.assert_not_called()
        self.assertIn("without asking", answer["note"])
        step = [item for item in ai_tasks.get_task(self.task)["steps"] if item.get("panel")][-1]
        self.assertTrue(step["answers"]["answer"]["auto"], "the card shows it was built at once")

    def test_after_a_plan_of_several_steps_the_first_run_shows_bases(self):
        from api import mcp_actions

        built = {"steps": [{"block": "picture", "nodes": {}}, {"block": "upscale", "nodes": {}}], "nodes": {}}
        with mock.patch.object(mcp_plans.block_chain, "build", return_value=built), \
                mock.patch.object(mcp_plans.ai_answer_wait, "collect", return_value={"answers": [
                    {"question": "answer", "choice": ["build"], "plan": [{"block": "picture", "model": A}, {"block": "upscale", "model": None}]}]}):
            mcp_plans.propose(self.ctx, [{"use": "picture", "model": A}, {"use": "upscale"}])
        self.assertTrue(ai_plans.due(self.task, ai_plans.PREVIEWS))
        sent = []
        with mock.patch.object(mcp_actions.mcp_fill, "fill", return_value={"prompt": "x"}), \
                mock.patch.object(mcp_actions, "_submit", side_effect=lambda batch, base_only, hold: (sent.append((batch, base_only)), (["p1", "p2", "p3"], {}))[1]), \
                mock.patch.object(mcp_actions, "_base_words"):
            answer = mcp_actions.run_workflow(self.ctx, prompt="a girl under cherry blossoms")
            self.assertEqual(sent, [(3, True)], "the first run is three bases, though the AI asked for the whole")
            self.assertIn("picks one before the whole plan runs", answer["plan_note"])
            self.assertFalse(ai_plans.due(self.task, ai_plans.PREVIEWS))
            with self.assertRaisesRegex(ToolError, "picks one of the plan's bases first"):
                mcp_actions.run_workflow(self.ctx, prompt="a girl under cherry blossoms")
            mcp_actions.run_workflow(self.ctx, prompt="a girl under cherry blossoms")
        self.assertEqual(sent[-1], (1, False), "said once: then the whole runs as asked")

    def test_words_build_nothing_and_a_late_build_goes_by_the_cards_id(self):
        plan = [{"use": "picture", "model": A}, {"use": "detail"}]
        with mock.patch.object(mcp_plans.ai_answer_wait, "collect", return_value={"answers": [{"question": "answer", "text": "先修手"}]}):
            answer = mcp_plans.propose(self.ctx, plan)
        self.assertEqual(answer["text"], "先修手")
        self.assertIn("call add_nodes(plan=", answer["note"])
        with mock.patch.object(mcp_plans.ai_answer_wait, "collect", return_value={"answers": [], "still_waiting": ["answer"]}):
            waiting = mcp_plans.propose(self.ctx, plan)
        self.assertIn(f"add_nodes(route={waiting['panel']!r})", waiting["note"])
        with self.assertRaisesRegex(ToolError, "not answered"):
            mcp_plans.build_answered(self.ctx, waiting["panel"])
        self.assertTrue(mcp_plans.is_card(self.ctx, waiting["panel"]))
        step = mcp_plans._step(self.ctx, waiting["panel"])
        ai_panels.answer(self.task, step["id"], "answer", ["build"], extra={"plan": [{"block": "picture", "model": A}]})
        with mock.patch.object(mcp_plans.block_chain, "build", return_value={"steps": [{"block": "picture", "nodes": {}}], "nodes": {}}):
            self.assertIn("no second pass", mcp_plans.build_answered(self.ctx, waiting["panel"])["next"])


if __name__ == "__main__":
    unittest.main()
