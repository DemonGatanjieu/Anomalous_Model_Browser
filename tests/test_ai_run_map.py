"""A run's shape and what changed (ai_run_map.py), the task's own canvas tab (ai_task_canvas.py),
pictures handed to the AI (ai_pictures.py) and show_run_map."""
import json
import os
import time
import unittest
from unittest import mock

from PIL import Image
from PIL.PngImagePlugin import PngInfo

from test_ai_tasks import OUTPUT, isolate, ok
from api import ai_panels, ai_pictures, ai_run_map, ai_task_canvas, ai_tasks, mcp_task_tools


def lora_workflow(steps=20, strength=0.65):
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sdxl/Kirazuri_v4.safetensors"}, "_meta": {"title": "Kirazuri"}},
        "10": {"class_type": "LoraLoader", "inputs": {"model": ["4", 0], "clip": ["4", 1], "lora_name": "agefx.safetensors",
                                                        "strength_model": strength, "strength_clip": 1}},
        "11": {"class_type": "Reroute", "inputs": {"": ["10", 0]}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["10", 1], "text": "irena, grey hair,   witch hat"}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["10", 1], "text": "lowres"}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1536, "batch_size": 2}},
        "3": {"class_type": "KSampler", "inputs": {"model": ["11", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0],
                                                    "seed": 123, "steps": steps, "cfg": 5, "sampler_name": "euler", "scheduler": "normal", "denoise": 1}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "irena"}},
    }


class MapTests(unittest.TestCase):
    def test_boxes_roles_facts_and_links_through_plumbing(self):
        shape = ai_run_map.map_of(lora_workflow())
        boxes = {box["id"]: box for box in shape["boxes"]}
        self.assertNotIn("11", boxes, "a reroute is wired through, not shown")
        self.assertEqual(boxes["4"]["role"], "model")
        self.assertEqual(boxes["4"]["facts"]["file"], "Kirazuri_v4")
        self.assertEqual((boxes["10"]["role"], boxes["10"]["facts"]["strength"]), ("lora", 0.65))
        self.assertEqual(boxes["6"]["facts"], {"text": "irena, grey hair, witch hat", "polarity": "positive"})
        self.assertEqual(boxes["7"]["facts"]["polarity"], "negative")
        self.assertEqual(boxes["5"]["facts"], {"width": 1024, "height": 1536, "batch": 2})
        self.assertEqual(boxes["3"]["facts"], {"steps": 20, "cfg": 5, "sampler_name": "euler", "scheduler": "normal", "denoise": 1})
        self.assertIn({"from": "10", "to": "3", "type": "MODEL", "input": "model"}, [
            {**link, "type": "MODEL"} for link in shape["links"] if link["from"] == "10" and link["to"] == "3"])
        self.assertNotIn("3.seed", shape["params"], "the seed changes every run; it is no change to report")

    def test_changes_since_the_run_before(self):
        before = ai_run_map.map_of(lora_workflow())
        after_workflow = lora_workflow(steps=30, strength=0.8)
        after_workflow["12"] = {"class_type": "LoraLoader", "inputs": {"model": ["10", 0], "lora_name": "light.safetensors"}}
        del after_workflow["9"]
        changes = ai_run_map.changes(before, ai_run_map.map_of(after_workflow))
        self.assertIn({"node": "12", "title": "LoraLoader", "change": "added"}, changes)
        self.assertIn({"node": "9", "title": "SaveImage", "change": "removed"}, changes)
        self.assertIn({"node": "3", "title": "KSampler", "key": "steps", "from": "20", "to": "30"}, changes)
        self.assertIn({"node": "10", "title": "LoraLoader", "key": "strength_model", "from": "0.65", "to": "0.8"}, changes)
        self.assertEqual(ai_run_map.changes(None, before), [])

    def test_a_huge_workflow_keeps_what_makes_the_picture(self):
        workflow = lora_workflow()
        for index in range(40):
            workflow[f"x{index}"] = {"class_type": "SomeHelper", "inputs": {"value": index}}
        shape = ai_run_map.map_of(workflow)
        self.assertEqual(len(shape["boxes"]), ai_run_map.MAX_BOXES)
        self.assertTrue({"3", "4", "10", "6", "5"} <= {box["id"] for box in shape["boxes"]})


class TaskCanvasTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.task = ai_tasks.begin_task("A", "Irena portrait")["id"]

    def test_the_task_gets_its_tab_and_the_ai_is_told_once(self):
        self.assertEqual(ai_task_canvas.default_mode(), "new")
        self.assertIsNone(ai_task_canvas.spec("set_values"), "outside a tool call there is no task")
        holder = ai_task_canvas.begin_call(self.task)
        self.assertEqual(ai_task_canvas.spec("set_values"), {"mode": "new", "tab": None, "title": "Irena portrait"})
        self.assertIsNone(ai_task_canvas.spec("open_model"), "not a canvas action")
        ai_task_canvas.remember({"path": "workflows/Irena portrait 101500.json", "name": "Irena portrait 101500", "made": True})
        self.assertEqual(ai_tasks.get_task(self.task)["canvas"]["tab"]["path"], "workflows/Irena portrait 101500.json")
        told = ai_task_canvas.tell(ok({"done": True}), holder)
        self.assertIn("Irena portrait 101500", told["structuredContent"]["canvas_tab"]["note"])
        again = ai_task_canvas.begin_call(self.task)
        self.assertEqual(ai_task_canvas.spec("add_node")["tab"]["name"], "Irena portrait 101500")
        self.assertNotIn("canvas_tab", ai_task_canvas.tell(ok({}), again)["structuredContent"])

    def test_the_user_chooses_per_task_and_by_default(self):
        ai_task_canvas.set_mode(self.task, "current")
        ai_task_canvas.begin_call(self.task)
        self.assertEqual(ai_task_canvas.spec("set_values")["mode"], "current")
        other = ai_tasks.begin_task("B", "Other", new_task=True)["id"]
        ai_task_canvas.set_default("current")
        self.assertEqual(ai_task_canvas.mode_of(ai_tasks.get_task(other)), "current")
        with self.assertRaises(ValueError):
            ai_task_canvas.set_mode(self.task, "sideways")
        with self.assertRaises(ValueError):
            ai_task_canvas.set_default("sideways")
        ai_task_canvas.set_default("new")


def picture(name, workflow=None):
    info = PngInfo()
    if workflow:
        info.add_text("prompt", json.dumps(workflow))
    Image.new("RGB", (64, 96), (40, 80, 120)).save(os.path.join(OUTPUT, name), pnginfo=info)
    return name


class PictureTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.task = ai_tasks.begin_task("A", "Look at these")["id"]
        self.patch = mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_pictures_reach_the_ai_themselves_with_what_made_them(self):
        ai_pictures.hand(self.task, [picture("one.png", lora_workflow())])
        ai_pictures.hand(self.task, [picture("two.png")])
        steps = ai_tasks.get_task(self.task)["steps"]
        self.assertEqual(len(steps), 1, "pictures handed before the AI looked join one step")
        self.assertEqual([item["filename"] for item in steps[0]["results"]], ["one.png", "two.png"])
        result = ai_panels.attach_pending(ok({}), "A", task_id=self.task)
        message = result["structuredContent"]["user_messages"][0]
        self.assertEqual((message["kind"], message["images"]), ("pictures", ["one.png", "two.png"]))
        made = message["made_with"][0]
        self.assertEqual((made["models"], made["loras"], made["positive"], made["size"]),
                         (["Kirazuri_v4"], ["agefx (0.65)"], "irena, grey hair, witch hat", "1024x1536"))
        self.assertEqual(message["made_with"][1], {"image": "two.png"})
        self.assertEqual(sum(1 for item in result["content"] if item.get("type") == "image"), 2)
        self.assertNotIn("_pictures", message)

    def test_only_output_pictures_and_open_tasks(self):
        for images in ([], ["../secret.png"], ["missing.png"], [picture("x.png")] * 9):
            with self.assertRaises(ai_pictures.PicturesError):
                ai_pictures.hand(self.task, images)
        with self.assertRaises(ai_pictures.PicturesError):
            ai_pictures.hand("nope", [picture("y.png")])


class ShowRunMapTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.task = ai_tasks.begin_task("A", "Run")["id"]
        self.ctx = {"client": "A", "task": self.task}

    def test_the_stage_shows_the_latest_run_that_has_its_shape(self):
        from api.mcp_tools import ToolError
        with self.assertRaises(ToolError):
            mcp_task_tools.show_run_map(self.ctx, "结构")
        step = ai_tasks.record("A", "run_workflow", {}, ok({}), time.time())
        with ai_tasks._lock:
            task = ai_tasks._load()[self.task]
            task["steps"][-1].update(map=ai_run_map.map_of(lora_workflow()), changes=[])
            ai_tasks._save(task)
        answer = mcp_task_tools.show_run_map(self.ctx, "结构")
        self.assertEqual(answer["run"], step["id"])
        panel = ai_tasks.get_task(self.task)["steps"][-1]["panel"]
        self.assertEqual(panel["blocks"][0]["type"], "run_map")
        self.assertEqual(panel["blocks"][0]["step"], step["id"])


if __name__ == "__main__":
    unittest.main()
