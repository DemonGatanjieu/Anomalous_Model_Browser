"""A run's console, time left and size warnings (ai_run_watch.py), and stopping it (ai_run_control.py)."""
import time
import unittest
from datetime import datetime
from unittest import mock

from test_ai_tasks import isolate, ok
from api import ai_panels, ai_run_control, ai_run_watch, ai_task_runs, ai_tasks


def logs(started, *chunks):
    at = datetime.fromtimestamp(started + 1).isoformat()
    return [{"t": at, "m": chunk} for chunk in chunks]


class ConsoleTests(unittest.TestCase):
    def test_the_bar_redrawn_in_place_is_its_latest_and_colours_go(self):
        started = time.time()
        entries = [{"t": datetime.fromtimestamp(started - 60).isoformat(), "m": "old line\n"}] + logs(
            started, "\x1b[32m[INFO]\x1b[0m Requested to load RRDBNet\n",
            "\r  0%|          | 0/50 [00:00<?, ?it/s, Model Initializing ...]",
            "\r 12%|#2        | 6/50 [00:03<00:22,  1.95it/s, Model Initializing ...]")
        lines = ai_run_watch.console_since(started, entries)
        self.assertEqual(lines[0], "[INFO] Requested to load RRDBNet")
        self.assertTrue(lines[-1].endswith("Model Initializing ...]"))
        self.assertNotIn("old line", lines)
        bar = ai_run_watch.bar_of(lines)
        self.assertEqual((bar["value"], bar["max"], bar["left"], bar["note"]), (6, 50, 22, "Model Initializing ..."))
        self.assertAlmostEqual(bar["rate"], 0.51, places=2)

    def test_no_bar_when_the_last_line_is_not_one(self):
        self.assertIsNone(ai_run_watch.bar_of(["[INFO] got prompt"]))
        self.assertIsNone(ai_run_watch.bar_of([]))
        self.assertNotIn("left", ai_run_watch.bar_of(["0/50 [00:00<?, ?it/s]"]))

    def test_pace_from_steps_seen(self):
        pace = ai_run_watch.Pace()
        self.assertIsNone(pace.update("k", 2, 20, now=100))
        self.assertEqual(pace.update("k", 6, 20, now=108), {"rate": 2.0, "left": 28})
        self.assertIsNone(pace.update("other", 1, 20, now=110), "another node starts over")


def prompt_upscaled_then_sampled():
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": "in.png"}},
        "2": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "4x-UltraSharp.pth"}},
        "3": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["2", 0], "image": ["1", 0]}},
        "4": {"class_type": "VAEEncode", "inputs": {"pixels": ["3", 0], "vae": ["9", 2]}},
        "5": {"class_type": "KSampler", "inputs": {"model": ["9", 0], "latent_image": ["4", 0], "steps": 50, "denoise": 0.4},
              "_meta": {"title": "Detail pass"}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["9", 2]}},
        "9": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "a.safetensors"}},
    }


class EstimateTests(unittest.TestCase):
    def test_an_upscaled_picture_sampled_again_is_warned_with_the_plain_upscale(self):
        found = ai_run_watch.estimate(prompt_upscaled_then_sampled(), 12288, image_size=lambda name: (1024, 1024))
        self.assertEqual(found["samplers"][0], {"node": "5", "title": "Detail pass", "width": 4096, "height": 4096,
                                                "batch": 1, "steps": 50, "upscaled": True})
        kinds = [warning["kind"] for warning in found["warnings"]]
        self.assertEqual(kinds, ["upscale_resample", "big_decode"])
        self.assertIn("upscale model alone", ai_run_watch.warning_words(found["warnings"][0]))

    def test_a_usual_picture_has_no_warning_and_sizes_follow_scale_nodes(self):
        prompt = {
            "1": {"class_type": "EmptyLatentImage", "inputs": {"width": 832, "height": 1216, "batch_size": 2}},
            "2": {"class_type": "KSampler", "inputs": {"latent_image": ["1", 0], "steps": 28}},
            "3": {"class_type": "LatentUpscaleBy", "inputs": {"samples": ["2", 0], "scale_by": 1.5}},
            "4": {"class_type": "BasicScheduler", "inputs": {"steps": 12}},
            "5": {"class_type": "SamplerCustom", "inputs": {"latent_image": ["3", 0], "sigmas": ["4", 0]}},
        }
        found = ai_run_watch.estimate(prompt, 24576)
        self.assertEqual([(item["width"], item["height"], item["batch"], item["steps"]) for item in found["samplers"]],
                         [(832, 1216, 2, 28), (1248, 1824, 2, 12)])
        self.assertEqual(found["warnings"], [])

    def test_a_small_card_is_warned_sooner(self):
        prompt = {"1": {"class_type": "EmptyLatentImage", "inputs": {"width": 2048, "height": 1536, "batch_size": 1}},
                  "2": {"class_type": "KSampler", "inputs": {"latent_image": ["1", 0], "steps": 20}}}
        self.assertEqual(ai_run_watch.estimate(prompt, 24576)["warnings"], [])
        self.assertEqual(ai_run_watch.estimate(prompt, 6144)["warnings"][0]["kind"], "big_sample")

    def test_a_huge_saved_picture_after_an_upscale_model_is_warned(self):
        prompt = {"1": {"class_type": "EmptyLatentImage", "inputs": {"width": 5120, "height": 3328, "batch_size": 1}},
                  "2": {"class_type": "KSampler", "inputs": {"latent_image": ["1", 0], "steps": 35}},
                  "3": {"class_type": "VAEDecodeTiled", "inputs": {"samples": ["2", 0]}},
                  "4": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "4x-UltraSharp.pth"}},
                  "5": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["4", 0], "image": ["3", 0]}},
                  "6": {"class_type": "SaveImage", "inputs": {"images": ["5", 0]}, "_meta": {"title": "Save 4x"}},
                  "7": {"class_type": "SaveImage", "inputs": {"images": ["3", 0]}}}
        saved = [item for item in ai_run_watch.estimate(prompt, 98304)["warnings"] if item["kind"] == "big_save"]
        self.assertEqual(saved, [{"kind": "big_save", "node": "6", "title": "Save 4x", "width": 20480, "height": 13312,
                                  "megapixels": 260, "megabytes": 310.0}])
        self.assertIn("upscale less", ai_run_watch.warning_words(saved[0]))

    def test_odd_prompts_do_not_break_it(self):
        loop = {"1": {"class_type": "X", "inputs": {"image": ["2", 0]}}, "2": {"class_type": "Y", "inputs": {"image": ["1", 0]}},
                "3": {"class_type": "KSampler", "inputs": {"latent_image": ["1", 0]}}, "4": "junk"}
        self.assertEqual(ai_run_watch.estimate(loop), {"samplers": [], "warnings": [], "comfort_mp": 4.2})


class StopTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.task = ai_tasks.begin_task("A", "Test")["id"]
        self.step = ai_tasks.record("A", "run_workflow", {}, ok({}), time.time())
        with ai_tasks._lock:
            task = ai_tasks._load()[self.task]
            task["steps"][-1]["prompt_ids"] = ["running", "waiting"]
            ai_tasks._save(task)
        self.queue = mock.Mock(spec=["delete_queue_item", "interrupt_if_running", "get_current_queue"])
        self.queue.delete_queue_item.side_effect = lambda match: match((2, "waiting"))
        self.queue.interrupt_if_running.side_effect = lambda pid: pid == "running"

    def test_the_user_stops_it_and_the_ai_is_told(self):
        with mock.patch.object(ai_task_runs, "_queue", return_value=self.queue):
            answer = ai_run_control.stop(self.step["id"], "user", self.task)
        self.assertEqual((answer["removed"], answer["interrupted"]), (1, 1))
        # The interrupted prompt ends "error" in its history; the removed one never gets one.
        ai_task_runs._finish_run(self.task, self.step["id"], ["running", "waiting"],
                                 {"running": {"status": {"status_str": "error"}}}, queued=set())
        step = ai_tasks.get_task(self.task)["steps"][0]
        self.assertEqual((step["state"], step["ok"], step["stop"]), ("cancelled", True, "user"))
        self.assertIn("user stopped", ai_task_runs.summary(step))
        result = ai_panels.attach_pending(ok({}), "A", task_id=self.task)
        self.assertEqual(result["structuredContent"]["user_messages"][0]["kind"], "stop")

    def test_only_a_run_still_going_can_be_stopped(self):
        ai_task_runs._finish_run(self.task, self.step["id"], ["running", "waiting"],
                                 {"running": {"status": {"completed": True}}, "waiting": {"status": {"completed": True}}})
        with mock.patch.object(ai_task_runs, "_queue", return_value=self.queue), self.assertRaises(ai_run_control.RunControlError):
            ai_run_control.stop(self.step["id"], "user", self.task)
        with self.assertRaises(ai_run_control.RunControlError):
            ai_run_control.stop("nope", "user", self.task)
        self.queue.delete_queue_item.assert_not_called()

    def test_the_ai_hears_the_warnings_while_its_run_waits_or_goes(self):
        warning = {"kind": "big_sample", "node": "2", "title": "KSampler", "width": 4096, "height": 4096, "megapixels": 16.0}
        run = {"state": "running", "at": time.time(), "progress": {"state": "queued", "ahead": 1}, "estimate": {"warnings": [warning]}}
        self.assertIn("16.0 megapixels", ai_task_runs.summary(run))
        self.assertIn("stop_run", ai_task_runs.summary({**run, "progress": {"state": "running"}}))
        self.assertNotIn("Warning", ai_task_runs.summary({**run, "state": "done", "ms": 1000}))

    def test_a_stopped_prompt_still_queued_is_not_counted_done(self):
        with mock.patch.object(ai_task_runs, "_queue", return_value=self.queue):
            ai_run_control.stop(self.step["id"], "ai", self.task)
        self.assertFalse(ai_task_runs._finish_run(self.task, self.step["id"], ["running", "waiting"], {}, queued={"waiting"}))
        self.assertEqual(ai_tasks.get_task(self.task)["steps"][0]["state"], "running")


if __name__ == "__main__":
    unittest.main()
