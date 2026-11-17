"""Pictures the user releases to the AI of a private task (api/ai_release.py): a boxed part cut out of the
original with a margin and a dashed frame, drawn anew with no text in it; a stand-in workflow with the
positive prompt replaced; and the privacy guard letting those, and only those, through. Temporary folders only."""
import base64
import io
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

from PIL import Image, PngImagePlugin  # noqa: E402

from api import ai_marks, ai_panels, ai_privacy, ai_release, ai_sealed_models, ai_tasks, ai_toolbox_catalog  # noqa: E402
from test_ai_tasks import isolate, ok  # noqa: E402

OUTPUT = tempfile.mkdtemp(prefix="amb_ai_release_output_")


def marked_png():
    buffer = io.BytesIO()
    Image.new("RGB", (64, 48), (200, 30, 30)).save(buffer, "PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def picture_with_workflow(path, prompt):
    info = PngImagePlugin.PngInfo()
    info.add_text("prompt", json.dumps(prompt))
    info.add_text("workflow", json.dumps({"secret": "canarysecret"}))
    Image.new("RGB", (400, 300), (20, 120, 200)).save(path, "PNG", pnginfo=info)


PROMPT = {
    "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "private_model.safetensors"}},
    "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "canarysecret, two girls", "clip": ["1", 1]}},
    "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "lowres", "clip": ["1", 1]}},
    "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 4}},
    "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["4", 0], "seed": 7}},
    "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
    "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": "private"}},
}


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        isolate()
        picture_with_workflow(os.path.join(OUTPUT, "a.png"), PROMPT)
        self.patch = mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT)
        self.patch.start()
        self.library = mock.patch.object(ai_sealed_models, "_library", return_value=[])  # never the real library
        self.library.start()
        ai_tasks.record("Claude", "describe_canvas", {}, ok({}), time.time(), True)
        self.task = ai_tasks.list_tasks()[0]["id"]

    def tearDown(self):
        self.patch.stop()
        self.library.stop()
        ai_toolbox_catalog.forget()

    def test_a_part_is_cut_with_its_margin_and_frame_and_nothing_else_in_it(self):
        data, area = ai_release.crop(os.path.join(OUTPUT, "a.png"), {"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5})
        self.assertEqual(area, 0.25)
        with Image.open(io.BytesIO(data)) as part:
            self.assertEqual(part.width, 300, "the box (200 x 150) and a quarter of it on each side")
            self.assertIn(part.height, (224, 225))
            self.assertFalse({key for key in part.info if key not in ("dpi",)} & {"prompt", "workflow", "parameters"}, "no text travels with it")
            self.assertEqual(part.getpixel((50, 37)), (255, 64, 64), "the box's edge is framed in red")
        self.assertNotIn(b"canarysecret", data)

    def test_a_released_box_in_a_private_task_reaches_the_ai_as_its_only_picture(self):
        ai_privacy.set_private(self.task, True)
        marks = [{"shape": "box", "x": 0.1, "y": 0.1, "w": 0.3, "h": 0.3, "note": "hand", "release": True},
                 {"shape": "box", "x": 0.6, "y": 0.6, "w": 0.2, "h": 0.2, "note": "kept"}]
        step = ai_marks.save(self.task, "a.png", marked_png(), marks)
        self.assertEqual([item["file"] for item in step["released"]], [f"{step['id']}_r1.png"])
        self.assertIn("1 part(s) of this picture", step["text"])
        self.assertNotIn("part(s)", step["note"], "the words for the AI are not the user's own")
        self.assertTrue(ai_marks.path_of(self.task, step["released"][0]["file"]))
        result = ai_panels.attach_pending(ok({}), "Claude", task_id=self.task)
        guarded = ai_privacy.guard(result, True, self.task)
        images = [item for item in guarded["content"] if item.get("type") == "image"]
        self.assertEqual(len(images), 1, "the released part, not the marked picture")
        self.assertNotIn(ai_release.RELEASED, images[0], "the mark is taken off before it leaves")

    def test_outside_a_private_task_nothing_is_cut(self):
        step = ai_marks.save(self.task, "a.png", marked_png(), [{"shape": "box", "x": 0.1, "y": 0.1, "w": 0.3, "h": 0.3, "release": True}])
        self.assertNotIn("released", step)

    def test_the_guard_drops_every_other_picture(self):
        result = ok({})
        result["content"] = [{"type": "text", "text": "x"}, {"type": "image", "data": "a", "mimeType": "image/webp"},
                             {"type": "image", "data": "b", "mimeType": "image/webp", ai_release.RELEASED: True}]
        guarded = ai_privacy.guard(result, True, self.task)
        self.assertEqual([item.get("data") for item in guarded["content"] if item.get("type") == "image"], ["b"])
        plain = ok({})
        plain["content"] = [{"type": "image", "data": "b", ai_release.RELEASED: True}]
        self.assertNotIn(ai_release.RELEASED, ai_privacy.guard(plain, False, self.task)["content"][0])

    def test_a_stand_in_keeps_the_models_and_settings_with_a_harmless_prompt(self):
        made = ai_release.harmless(PROMPT)
        self.assertEqual(made["2"]["inputs"]["text"], ai_release.HARMLESS)
        self.assertEqual(made["3"]["inputs"]["text"], "lowres", "the negative prompt is not what the picture shows")
        self.assertEqual((made["4"]["inputs"]["batch_size"], made["5"]["inputs"]["seed"]), (1, 7))
        self.assertEqual(made["7"], {"class_type": "PreviewImage", "inputs": {"images": ["6", 0]}}, "previewed, not saved")
        self.assertEqual(PROMPT["2"]["inputs"]["text"], "canarysecret, two girls", "the original stays as it is")
        flux = {**PROMPT, "2": {"class_type": "CLIPTextEncodeFlux", "inputs": {"clip_l": "canarysecret", "t5xxl": "canarysecret", "guidance": 3.5, "clip": ["1", 1]}}}
        self.assertEqual({ai_release.harmless(flux)["2"]["inputs"][key] for key in ("clip_l", "t5xxl")}, {ai_release.HARMLESS})

    def test_a_stand_in_is_refused_when_it_would_carry_a_picture_or_has_no_prompt(self):
        with_picture = {**PROMPT, "8": {"class_type": "LoadImage", "inputs": {"image": "private.png"}}}
        with self.assertRaises(ai_release.ReleaseError):
            ai_release.harmless(with_picture)
        no_positive = {key: value for key, value in PROMPT.items() if key != "5"}
        with self.assertRaises(ai_release.ReleaseError):
            ai_release.harmless(no_positive)

    def test_a_stand_in_run_becomes_a_step_the_ai_gets_with_its_picture(self):
        ai_privacy.set_private(self.task, True)
        with ai_tasks._lock:
            task = ai_tasks._load()[self.task]
            task["steps"][-1]["results"] = [{"type": "image", "filename": "a.png", "subfolder": "", "folder": "output"}]
            ai_tasks._save(task)
        temp = tempfile.mkdtemp(prefix="amb_ai_release_temp_")
        Image.new("RGB", (512, 512), (240, 230, 200)).save(os.path.join(temp, "standin.png"))
        sent = []

        def local(_base, method, path, body=None):
            sent.append((method, path, body))
            if method == "POST":
                return 200, {"prompt_id": "p1"}
            return 200, {"p1": {"status": {"completed": True}, "outputs": {"7": {"images": [{"filename": "standin.png", "subfolder": "", "type": "temp"}]}}}}

        with mock.patch.object(ai_release, "_local", side_effect=local), mock.patch.object(ai_release, "POLL_SECONDS", 0), \
                mock.patch.object(ai_tasks.folder_paths, "get_temp_directory", return_value=temp):
            step = ai_release.standin(self.task, "http://127.0.0.1:8188")
        self.assertEqual(sent[0][2]["prompt"]["2"]["inputs"]["text"], ai_release.HARMLESS)
        self.assertEqual(step["tool"], "user_standin")
        self.assertTrue(ai_marks.path_of(self.task, step["released"][0]["file"]))
        result = ai_panels.attach_pending(ok({}), "Claude", task_id=self.task)
        guarded = ai_privacy.guard(result, True, self.task)
        self.assertEqual(sum(item.get("type") == "image" for item in guarded["content"]), 1)
        self.assertEqual([m.get("kind") for m in guarded["structuredContent"]["user_messages"]][-1], "standin")
        self.assertEqual(ai_release.released_items(ai_tasks.get_task(self.task))[-1]["kind"], "standin")


if __name__ == "__main__":
    unittest.main()
