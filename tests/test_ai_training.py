"""Training rounds (api/ai_training.py): a round the user starts is a task waiting for an AI with
its plan; each run that ends fills the trial it fits; the AI is told what is next once, and to
compare a model's trials in a picks panel with its own pick, where the user's pick and the AI's
are kept apart (api/ai_evidence.py). Temporary folders only."""
import os
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_answer_wait, ai_evidence, ai_gates, ai_panels, ai_training, ai_tasks, mcp_task_tools  # noqa: E402
from test_ai_panels import OUTPUT  # noqa: E402  (a.png and b.png in a temporary output folder)
from test_ai_tasks import isolate, ok  # noqa: E402

MODELS = {"checkpoints:0:il.safetensors": ("il.safetensors", "Illustrious"), "checkpoints:0:anima.safetensors": ("anima.safetensors", "Anima")}


def resolve(model_id):
    file, _base = MODELS[model_id]
    return "checkpoints", 0, "/models", f"/models/{file}"


class TrainingTests(unittest.TestCase):
    def setUp(self):
        isolate()
        for patcher in (mock.patch.object(ai_training, "_resolve_model", side_effect=resolve),
                        mock.patch.object(ai_training, "get_metadata", side_effect=lambda path: {
                            "baseModel": next(base for file, base in MODELS.values() if path.endswith(file))}),
                        mock.patch.object(ai_evidence.kept_images, "kept_keys", return_value=set()),
                        mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT),
                        mock.patch.object(mcp_task_tools, "_canvas_model", return_value=None),
                        mock.patch.object(ai_gates, "_tools_path", lambda: os.path.join(os.path.dirname(ai_evidence._path()), "ai_tools.json"))):
            patcher.start()
            self.addCleanup(patcher.stop)

    def start(self, each=1):
        return ai_training.start("Training", list(MODELS), skill="prompt_pose", each=each, subject="a girl holding a cup")

    def finish(self, task_id, model, skills, picture):
        """A run of the task that ended with `picture`, on `model`, the skills `skills` fetched before it."""
        step = ai_tasks.record("Gemini", "run_workflow", {}, ok({"queued": 1}), time.time(), task_id=task_id)
        with ai_tasks._lock:
            task = ai_tasks._load()[task_id]
            stored = next(item for item in task["steps"] if item["id"] == step["id"])
            stored.update(state="done", used={"model": model, "base": "", "ways": [], "skills": skills, "packs": []},
                          results=[{"type": "image", "filename": picture, "subfolder": "", "folder": "output"}])
            ai_tasks._save(task)
        ai_evidence.note_run(task_id, step["id"])
        ai_training.note_run(task_id, step["id"])
        return step["id"]

    def test_a_round_is_a_task_waiting_for_an_ai_with_its_plan(self):
        task = self.start(each=2)
        plan = task["training"]
        self.assertTrue(task["waiting"])
        self.assertEqual([item["model_id"] for item in task["about"]], list(MODELS), "the AI gets the models' ids")
        self.assertEqual([model["base"] for model in plan["models"]], ["Illustrious", "Anima"])
        self.assertEqual(len(plan["trials"]), 8, "2 models × with and without × 2 pictures")
        self.assertEqual({trial["item"] for trial in plan["trials"][:4]}, {ai_training.WITHOUT}, "every trial without the skill first")
        begun = mcp_task_tools.begin_task({"client": "Gemini"}, "training")
        self.assertEqual(begun["task"], task["id"], "the next AI that calls takes it")
        self.assertIn("without the skill, then with its advice", begun["training"]["goal"])
        self.assertIn("Next: il (set_model checkpoints:0:il.safetensors), without the skill", begun["training"]["now"])
        self.assertEqual(ai_training.tell(begun_result := ok(begun), task["id"]), begun_result, "the brief is not written over")
        self.assertNotIn("training", ai_training.tell(ok({}), task["id"])["structuredContent"], "nothing new before a trial is done")

    def test_wrong_rounds_are_refused(self):
        for kwargs in ({"skill": "privacy", "subject": "x"}, {"skill": "prompt_pose", "subject": ""}, {"skill": "nope", "subject": "x"},
                       {"use": "repaint", "info": {}}):
            with self.subTest(**{key: str(value) for key, value in kwargs.items()}), self.assertRaises(ai_training.TrainingError):
                ai_training.start("Training", list(MODELS), **kwargs)
        with self.assertRaises(ai_training.TrainingError):
            ai_training.start("Training", [], skill="prompt_pose", subject="x")

    def test_runs_fill_the_trials_they_fit_and_the_ai_hears_what_is_next(self):
        task = self.start()
        self.finish(task["id"], "other.safetensors", [], "a.png")
        self.assertFalse(any(trial["run"] for trial in ai_tasks.get_task(task["id"])["training"]["trials"]), "another model fits no trial")
        first = self.finish(task["id"], "il.safetensors", [], "a.png")
        trials = ai_tasks.get_task(task["id"])["training"]["trials"]
        self.assertEqual((trials[0]["run"], trials[0]["item"]), (first, ai_training.WITHOUT))
        told = ai_training.tell(ok({}), task["id"])["structuredContent"]["training"]
        self.assertIn("1 of 4 trials done", told)
        self.assertNotIn("training", ai_training.tell(ok({}), task["id"])["structuredContent"], "told once")
        self.finish(task["id"], "anima.safetensors", [], "b.png")
        self.finish(task["id"], "il.safetensors", ["prompt_pose"], "b.png")
        told = ai_training.tell(ok({}), task["id"])["structuredContent"]["training"]
        self.assertIn("The trials on il are done", told)
        self.assertIn("'a.png', 'b.png'", told, "the pictures to put side by side")
        self.assertIn("recommended=true", told)
        self.finish(task["id"], "anima.safetensors", ["prompt_pose"], "a.png")
        told = ai_training.tell(ok({}), task["id"])["structuredContent"]["training"]
        self.assertIn("4 of 4", told)
        self.assertIn("report what did best", told)

    def test_the_ais_pick_and_the_users_are_kept_apart(self):
        task = self.start()
        first = self.finish(task["id"], "il.safetensors", ["prompt_pose"], "a.png")
        self.finish(task["id"], "anima.safetensors", ["prompt_pose"], "b.png")
        shown = ai_panels.show("Gemini", "Which?", [{"type": "picks", "id": "p", "question": "Which turned out best?",
                                                     "items": [{"id": "a", "image": "a.png", "recommended": True}, {"id": "b", "image": "b.png"}]}],
                               task_id=task["id"])
        step = next(item for item in ai_tasks.get_task(task["id"])["steps"] if item.get("panel", {}).get("id") == shown["id"])
        with mock.patch.object(ai_answer_wait.ai_gates, "no_answer", return_value="recommended"):
            self.assertEqual(ai_answer_wait.take_recommended(task["id"], step), 1, "a picks block left to the AI takes its pick")
        answered = next(item for item in ai_tasks.get_task(task["id"])["steps"] if item["id"] == step["id"])["answers"]["p"]
        self.assertEqual(answered["choice"], ["a"])
        runs = ai_evidence._runs()
        self.assertTrue(runs[first].get("ai_picked"))
        self.assertFalse(runs[first].get("picked"), "the user did not pick: no word of theirs")
        count = ai_evidence.tally()["skill"]["prompt_pose"][""]
        self.assertEqual((count["good"], count["ai_good"], count["ai_passed"]), (0, 1, 1))
        self.assertIn("the AI's own judgement: 1 picked, 1 passed over", ai_evidence.words("skill", "prompt_pose"))


if __name__ == "__main__":
    unittest.main()
