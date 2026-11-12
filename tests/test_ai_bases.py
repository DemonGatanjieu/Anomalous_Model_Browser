"""The bases the user picks from (api/ai_bases.py): a base_only run's previews become a picks panel,
the picked one is kept in the output folder and its seed held for the next run, and that run's base is
compared with it. Stand-in history, page and folders; temporary folders only."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

import folder_paths  # noqa: E402

from api import ai_bases, ai_panels, ai_task_runs, ai_tasks, mcp_actions  # noqa: E402
from test_ai_tasks import isolate, ok  # noqa: E402

BASES = {"bases": [{"node": "32", "type": "KSamplerAdvanced", "names": ["noise_seed"]}], "shows": ["9"], "saved": ["9"],
         "prefix": "two_pass/base"}


def record(seed, filename, folder="temp", node="9"):
    prompt = {"32": {"class_type": "KSamplerAdvanced", "inputs": {"noise_seed": seed}},
              node: {"class_type": "PreviewImage", "inputs": {"images": ["7", 0]}}}
    return {"prompt": [0, "id", prompt, {}, [node]], "status": {"completed": True, "status_str": "success"},
            "outputs": {node: {"images": [{"filename": filename, "subfolder": "", "type": folder}]}}}


class BaseTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.folders = tempfile.TemporaryDirectory()
        self.temp, self.output = (os.path.join(self.folders.name, name) for name in ("temp", "output"))
        for folder in (self.temp, self.output):
            os.makedirs(folder)
        for patch in (mock.patch.object(folder_paths, "get_temp_directory", return_value=self.temp),
                      mock.patch.object(folder_paths, "get_output_directory", return_value=self.output)):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(self.folders.cleanup)

    def picture(self, folder, name, colour):
        Image.new("RGB", (64, 96), colour).save(os.path.join(folder, name))

    def run_step(self, **fields):
        ai_tasks.record("Claude", "run_workflow", {"batch": 2}, ok({"queued": 2}), time.time())
        task_id = ai_tasks.list_tasks()[0]["id"]
        with ai_tasks._lock:
            task = ai_tasks._load()[task_id]
            step = task["steps"][-1]
            step.update(state="done", prompt_ids=["p1", "p2"], **fields)
            ai_tasks._save(task)
        return task_id, step["id"]

    def offered(self):
        self.picture(self.temp, "ComfyUI_temp_a_00001_.png", "red")
        self.picture(self.temp, "ComfyUI_temp_a_00002_.png", "blue")
        task_id, step_id = self.run_step(bases=BASES)
        history = {"p1": record(101, "ComfyUI_temp_a_00001_.png"), "p2": record(102, "ComfyUI_temp_a_00002_.png")}
        panel = ai_bases.offer(task_id, step_id, ["p1", "p2"], history)
        self.assertIsNone(ai_bases.offer(task_id, step_id, ["p1", "p2"], history), "offered once")
        return task_id, panel

    def test_a_base_only_run_ends_in_a_picks_panel_with_each_seed(self):
        task_id, panel = self.offered()
        self.assertEqual((panel["title_key"], panel["blocks"][0]["question_key"]), ("aiBaseTitle", "aiBaseQuestion"))
        items = panel["blocks"][0]["items"]
        self.assertEqual([(item["filename"], item["folder"], item["label"]) for item in items],
                         [("ComfyUI_temp_a_00001_.png", "temp", "1 · seed 101"), ("ComfyUI_temp_a_00002_.png", "temp", "2 · seed 102")])
        run = next(step for step in ai_tasks.get_task(task_id)["steps"] if step["tool"] == "run_workflow")
        self.assertIn("get_answers", ai_task_runs.status("Claude", task_id=task_id, step_id=run["id"])["next"])
        self.assertIn("pick from", ai_task_runs.summary(run))

    def test_the_picked_base_is_kept_and_its_seed_held(self):
        task_id, panel = self.offered()
        step_id = next(step["id"] for step in ai_tasks.get_task(task_id)["steps"] if step["tool"] == "pick_base")
        extra = ai_bases.prepare(task_id, step_id, ["b2"])
        self.assertEqual(extra["kept"], "two_pass/base_00001_.png")
        with Image.open(os.path.join(self.output, "two_pass", "base_00001_.png")) as kept:
            self.assertEqual(kept.getpixel((0, 0)), (0, 0, 255))
        answers = ai_panels.answer(task_id, step_id, "base", ["b2"], extra=extra)
        self.assertEqual(answers["base"]["seed"], 102)
        ai_bases.hold(task_id, extra)
        hold = ai_bases.hold_of(task_id)
        self.assertTrue(hold.pop("kept_input").startswith("anomalous_reference_"), "LoadImage reads its input copy")
        self.assertEqual(hold, {"node": "32", "type": "KSamplerAdvanced", "names": ["noise_seed"],
                                "seed": 102, "kept": "two_pass/base_00001_.png", "show": "9", "picked_on": step_id})
        self.assertEqual(ai_bases.prepare(task_id, "other", ["b1"]), {}, "other panels bring nothing")

    def test_another_base_may_be_taken_instead_until_new_bases_come(self):
        task_id, _panel = self.offered()
        step_id = next(step["id"] for step in ai_tasks.get_task(task_id)["steps"] if step["tool"] == "pick_base")
        extra = ai_bases.prepare(task_id, step_id, ["b2"])
        ai_panels.answer(task_id, step_id, "base", ["b2"], extra=extra)
        ai_bases.hold(task_id, extra)
        self.assertEqual(ai_panels.get_answers("Claude", task_id=task_id)["answers"][0]["choice"], ["b2"])
        with self.assertRaisesRegex(ai_panels.PanelError, "Already answered"):
            ai_panels.answer(task_id, step_id, "base", ["b1"])

        answers = ai_bases.change(task_id, step_id, ["b1"])
        self.assertEqual((answers["base"]["choice"], answers["base"]["seed"], answers["base"]["delivered"]), (["b1"], 101, False))
        hold = ai_bases.hold_of(task_id)
        self.assertEqual((hold["seed"], hold["kept"], hold["picked_on"]), (101, "two_pass/base_00002_.png", step_id))
        with Image.open(os.path.join(self.output, "two_pass", "base_00002_.png")) as kept:
            self.assertEqual(kept.getpixel((0, 0)), (255, 0, 0))
        self.assertTrue(os.path.isfile(os.path.join(self.output, "two_pass", "base_00001_.png")), "the first copy stays")
        told = ai_panels.get_answers("Claude", task_id=task_id)["answers"]
        self.assertEqual(told[0]["choice"], ["b1"])
        self.assertIn("took another base instead", told[0]["note"])
        self.assertIn("seed 101", told[0]["note"])

        self.assertEqual(ai_bases.change(task_id, step_id, ["b1"])["base"]["choice"], ["b1"])
        self.assertFalse(os.path.exists(os.path.join(self.output, "two_pass", "base_00003_.png")), "a second click copies nothing")
        with self.assertRaisesRegex(ValueError, "Pick one"):
            ai_bases.change(task_id, step_id, ["b9"])
        ai_bases.forget(task_id)  # newer bases came
        with self.assertRaisesRegex(ValueError, "newer bases"):
            ai_bases.change(task_id, step_id, ["b2"])
        self.assertEqual(ai_tasks.get_task(task_id)["steps"][-1]["answers"]["base"]["choice"], ["b1"])

    def test_a_preview_gone_after_a_restart_says_its_seed(self):
        task_id, _panel = self.offered()
        step_id = next(step["id"] for step in ai_tasks.get_task(task_id)["steps"] if step["tool"] == "pick_base")
        os.remove(os.path.join(self.temp, "ComfyUI_temp_a_00001_.png"))
        with self.assertRaisesRegex(ValueError, "seed 101"):
            ai_bases.prepare(task_id, step_id, ["b1"])

    def test_the_next_run_holds_the_pick_and_a_new_base_only_run_drops_it(self):
        task_id, _panel = self.offered()
        hold = {"node": "32", "type": "KSamplerAdvanced", "names": ["noise_seed"], "seed": 102, "kept": "two_pass/base_00001_.png",
                "kept_input": "anomalous_reference_x.png", "show": "9", "picked_on": "s1"}
        ai_bases.hold(task_id, {"base": hold})
        sent = []

        held = {"held": True, "kept": True}

        def page(action, args, required_capability=None):
            sent.append(args)
            return {"prompt_ids": ["p3"], "held": held} if "hold" in args else {"prompt_ids": ["p4"], "base": BASES}
        ctx = {"task": task_id}
        with mock.patch.object(mcp_actions, "ask_page", page):
            got = mcp_actions.run_workflow(ctx)
            self.assertIn("grows from the base the user picked (two_pass/base_00001_.png)", got["held"])
            self.assertNotIn("base_check", got, "the kept picture itself: nothing to compare")
            held["kept"] = False  # a latent handed on (the mid-way switch): drawn again from its seed
            got = mcp_actions.run_workflow(ctx)
            self.assertEqual(sent[-1]["hold"]["seed"], 102)
            self.assertIn("seed 102 on node 32", got["held"])
            self.assertEqual(got["base_check"], {"show": "9", "kept": "two_pass/base_00001_.png"})
            got = mcp_actions.run_workflow(ctx, batch=4, base_only=True)
        self.assertEqual(sent[-1], {"batch": 4, "base_only": True})
        self.assertEqual(got["base_only"], BASES)
        self.assertIsNone(ai_bases.hold_of(task_id))

    def test_the_run_on_the_picked_base_says_whether_its_base_is_that_picture(self):
        self.picture(self.output, "kept.png", "red")
        self.picture(self.output, "again.png", "red")
        self.picture(self.output, "other.png", "green")
        for saved, same in (("again.png", True), ("other.png", False)):
            isolate()
            task_id, step_id = self.run_step(base_check={"show": "9", "kept": "kept.png"})
            ai_bases.check(task_id, step_id, ["p1"], {"p1": record(102, saved, folder="output")})
            run = ai_tasks.get_task(task_id)["steps"][-1]
            self.assertIs(run["base_check"]["same"], same)
            self.assertIn("is the one the user picked" if same else "is NOT the one", ai_task_runs.summary(run))


if __name__ == "__main__":
    unittest.main()
