"""The record of what works (api/ai_evidence.py): a run counts for the ways it still has, the skills
fetched before it and the packs of its nodes, by its main model's base model; the user's picks,
keeps and word say how it went; the AI is told it in begin_task, get_toolbox and add_nodes once the
user shows it or in a training round, a use's way that did best is picked first, and the user can
let custom nodes in only by the ways.
Temporary folders only."""
import os
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_evidence, ai_gates, ai_panels, ai_skills, ai_task_runs, ai_tasks, mcp_canvas_edit, mcp_task_tools, reference_blocks  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402
from test_ai_panels import OUTPUT  # noqa: E402  (a.png and b.png in a temporary output folder)
from test_ai_tasks import isolate, ok  # noqa: E402

# A LanPaint repaint on an Illustrious checkpoint, its model through a LoRA.
PROMPT = {"4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "Illustrious/wai.safetensors"}},
          "10": {"class_type": "LoraLoader", "inputs": {"model": ["4", 0], "clip": ["4", 1], "lora_name": "x.safetensors",
                                                         "strength_model": 1.0, "strength_clip": 1.0}},
          "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "1girl", "clip": ["10", 1]}},
          "12": {"class_type": "LoadImage", "inputs": {"image": "in.png"}},
          "13": {"class_type": "LanPaint_ImageEncode", "inputs": {"image": ["12", 0], "vae": ["4", 2]}},
          "3": {"class_type": "LanPaint_KSampler", "inputs": {"model": ["10", 0], "positive": ["6", 0], "negative": ["6", 0],
                                                              "latent_image": ["13", 0], "seed": 1, "steps": 20}},
          "14": {"class_type": "LanPaint_ImageDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
          "9": {"class_type": "SaveImage", "inputs": {"images": ["14", 0], "filename_prefix": "AMB"}}}
INFO = {"LanPaint_KSampler": {"python_module": "custom_nodes.LanPaint"}, "KJThing": {"python_module": "custom_nodes.ComfyUI-KJNodes"},
        "KSampler": {"python_module": "nodes"}}


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        isolate()
        for patcher in (mock.patch.object(ai_evidence.model_advice, "_main_base", side_effect=lambda name: "Illustrious" if "Illustrious" in name else "Anima"),
                        mock.patch.object(ai_evidence, "_packs", side_effect=lambda types: ["LanPaint"] if "LanPaint_KSampler" in types else []),
                        mock.patch.object(ai_evidence.kept_images, "kept_keys", return_value=set()),
                        mock.patch.object(ai_task_runs.ai_run_watch, "vram", return_value=None),  # no card asked
                        mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT),
                        mock.patch.object(ai_gates, "_tools_path", lambda: os.path.join(os.path.dirname(ai_evidence._path()), "ai_tools.json"))):
            patcher.start()
            self.addCleanup(patcher.stop)
        ai_tasks.record("Gemini", "add_nodes", {"use": "repaint", "want": "best"}, ok({"way": "inpaint_lanpaint"}), time.time())
        self.task = ai_tasks.active_task_id("Gemini")
        ai_skills.note_use("Gemini", {"skill": "prompt_pose", "for_model": None}, task_id=self.task)

    def run_with(self, prompt, picture="a.png"):
        """A run of the task with `prompt`, seen queued and then done with `picture`: its step's id."""
        step = ai_tasks.record("Gemini", "run_workflow", {}, ok({"queued": 1}), time.time(), task_id=self.task)
        ai_task_runs._estimate(self.task, step["id"], [0, "p1", prompt, {}, []])
        ai_task_runs._finish_run(self.task, step["id"], ["p1"], {"p1": {"status": {"completed": True}, "outputs": {
            "9": {"images": [{"filename": picture, "subfolder": "", "type": "output"}]}}}})
        return step["id"]

    def test_a_run_counts_for_what_it_used_on_its_model(self):
        step_id = self.run_with(PROMPT)
        used = next(step for step in ai_tasks.get_task(self.task)["steps"] if step["id"] == step_id)["used"]
        self.assertEqual((used["model"], used["base"], used["packs"], used["skills"]), ("wai.safetensors", "Illustrious", ["LanPaint"], ["prompt_pose"]),
                         "the model is followed from the sampler through the LoRA")
        self.assertEqual([way["name"] for way in used["ways"]], ["inpaint_lanpaint"])
        found = ai_evidence.tally()
        self.assertEqual(found["way"]["inpaint_lanpaint"]["Illustrious"]["runs"], 1)
        self.assertEqual(found["skill"]["prompt_pose"]["Illustrious"]["clients"], ["Gemini"])
        self.assertEqual(found["pack"]["LanPaint"]["Illustrious"]["good"], 0, "nobody said how it went yet")

    def test_a_way_taken_off_the_canvas_does_not_count(self):
        plain = {key: node for key, node in PROMPT.items() if not node["class_type"].startswith("LanPaint")}
        plain["3"] = {"class_type": "KSampler", "inputs": {"model": ["10", 0], "positive": ["6", 0], "negative": ["6", 0], "latent_image": ["6", 0]}}
        self.run_with(plain)
        self.assertNotIn("inpaint_lanpaint", ai_evidence.tally()["way"])
        self.assertIn("prompt_pose", ai_evidence.tally()["skill"], "the advice it went by still counts")

    def test_picks_keeps_and_the_users_word_say_how_it_went(self):
        first, second = self.run_with(PROMPT, "a.png"), self.run_with(PROMPT, "b.png")
        shown = ai_panels.show("Gemini", "Which?", [{"type": "picks", "id": "p", "question": "Which?",
                                                      "items": [{"id": "a", "image": "a.png"}, {"id": "b", "image": "b.png"}]}], task_id=self.task)
        step = next(item for item in ai_tasks.get_task(self.task)["steps"] if item.get("panel", {}).get("id") == shown["id"])
        ai_panels.answer(self.task, step["id"], "p", choice="a")
        count = ai_evidence.tally()["way"]["inpaint_lanpaint"]["Illustrious"]
        self.assertEqual((count["runs"], count["good"], count["passed"]), (2, 1, 1), "picked: good; passed over: not chosen")
        ai_evidence.set_verdict(self.task, first, "bad")
        count = ai_evidence.tally()["way"]["inpaint_lanpaint"]["Illustrious"]
        self.assertEqual((count["good"], count["bad"]), (0, 1), "the user's own word goes over a pick")
        told = [item for item in ai_tasks.get_task(self.task)["steps"] if item["tool"] == "user_verdict"]
        self.assertTrue(told and not told[0]["delivered"] and "did not turn out well" in told[0]["text"], "the AI is told")
        ai_evidence.set_verdict(self.task, first, None)
        with mock.patch.object(ai_evidence.kept_images, "kept_keys", return_value={("", "b.png")}):
            count = ai_evidence.tally()["way"]["inpaint_lanpaint"]["Illustrious"]
        self.assertEqual((count["good"], count["bad"], count["passed"]), (2, 0, 0), "kept in the gallery: good")
        with self.assertRaises(ValueError):
            ai_evidence.set_verdict(self.task, second, "great")

    def test_the_ai_reads_it_at_a_glance(self):
        self.assertNotIn("record", mcp_task_tools.begin_task({"client": "Gemini", "task": self.task}, "repaint"), "nothing ran yet")
        step_id = self.run_with(PROMPT)
        ai_evidence.set_verdict(self.task, step_id, "good")
        ai_gates.set_record_view("shown")
        begun = mcp_task_tools.begin_task({"client": "Gemini", "task": self.task}, "repaint")
        self.assertIn("inpaint_lanpaint (way) Illustrious: 1 good of 1", begun["record"])
        self.assertLessEqual(len(begun["record"]), ai_evidence.OVERVIEW_CHARS + 100, "a few words in begin_task")
        with mock.patch.object(mcp_task_tools, "_canvas_model", return_value=None):
            fetched = mcp_task_tools.get_toolbox({"client": "Gemini", "task": self.task}, skill="prompt_pose")
        self.assertIn("Illustrious 1 runs: 1 good", fetched["record"])
        self.assertIn("(run by Gemini)", fetched["record"], "which AI ran it, for the next one to go on from")
        self.assertIn("record", mcp_task_tools.get_toolbox({"client": "Gemini", "task": self.task}))

    def test_hidden_from_the_ai_until_the_user_shows_it_or_starts_a_round(self):
        ai_evidence.set_verdict(self.task, self.run_with(PROMPT), "good")
        self.assertEqual(ai_gates.record_view(), "hidden", "hidden by default")
        self.assertNotIn("record", mcp_task_tools.begin_task({"client": "Gemini", "task": self.task}, "repaint"))
        with mock.patch.object(mcp_task_tools, "_canvas_model", return_value=None):
            fetched = mcp_task_tools.get_toolbox({"client": "Gemini", "task": self.task}, skill="prompt_pose")
        self.assertNotIn("record", fetched, "the skill's advice alone")
        self.assertNotIn("record", mcp_task_tools.get_toolbox({"client": "Gemini", "task": self.task}))
        self.assertEqual(mcp_canvas_edit._record({"task": self.task}, "inpaint_lanpaint", []), "")
        self.assertEqual(ai_evidence.order("way", ["inpaint_basic", "inpaint_lanpaint"], lambda: "Illustrious"),
                         ["inpaint_lanpaint", "inpaint_basic"], "the way that did best still comes first")
        with mock.patch.object(ai_gates.ai_tasks, "get_task", return_value={"training": {"kind": "skill"}}):
            self.assertTrue(ai_gates.record_shown(self.task), "a training round the user started shows it")
        ai_gates.set_record_view("shown")
        self.assertIn("Your runs with this way", mcp_canvas_edit._record({"task": self.task}, "inpaint_lanpaint", []))
        with self.assertRaises(ValueError):
            ai_gates.set_record_view("some")

    def test_the_way_that_did_best_on_the_model_comes_first(self):
        asked = []
        self.assertEqual(ai_evidence.order("way", ["a", "b"], lambda: asked.append(1)), ["a", "b"])
        self.assertFalse(asked, "nothing ran: the canvas is not even asked")
        ai_evidence.set_verdict(self.task, self.run_with(PROMPT), "good")
        self.assertEqual(ai_evidence.order("way", ["inpaint_basic", "inpaint_lanpaint"], lambda: "Illustrious"), ["inpaint_lanpaint", "inpaint_basic"])
        self.assertEqual(ai_evidence.order("way", ["inpaint_basic", "inpaint_lanpaint"], lambda: "Anima"), ["inpaint_basic", "inpaint_lanpaint"],
                         "on another model it is untried")
        info = {kind: {} for block in ("inpaint_basic", "inpaint_crop_stitch") for kind in reference_blocks.BLOCKS[block]["packs"]}
        self.assertEqual(reference_blocks.pick("repaint", None, info), "inpaint_crop_stitch", "by rank")
        self.assertEqual(reference_blocks.pick("repaint", None, info, order=lambda names: list(reversed(names))), "inpaint_basic")

    def test_custom_nodes_only_by_the_ways_when_the_user_says_so(self):
        ctx = {"client": "Gemini", "task": self.task}
        with mock.patch.object(mcp_canvas_edit, "object_info", return_value=INFO):
            mcp_canvas_edit._allowed(ctx, ["KJThing"])
            ai_gates.set_node_rule("ways")
            with self.assertRaisesRegex(ToolError, "only by the ready-made ways"):
                mcp_canvas_edit._allowed(ctx, ["KJThing"])
            mcp_canvas_edit._allowed(ctx, ["LanPaint_KSampler", "KSampler"])  # a way's node, ComfyUI's own
            ai_gates.set_node_rule("any")
        with self.assertRaises(ValueError):
            ai_gates.set_node_rule("some")


if __name__ == "__main__":
    unittest.main()
