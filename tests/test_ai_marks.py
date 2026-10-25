"""Marks the user draws on a picture for the AI (api/ai_marks.py): checked, kept with the task,
given to the AI as a message with the marked picture attached. Temporary folders only."""
import base64
import io
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

from api import ai_marks, ai_panels, ai_tasks, mcp_task_tools  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402
from test_ai_tasks import isolate, ok  # noqa: E402

OUTPUT = tempfile.mkdtemp(prefix="amb_ai_marks_output_")


def png(size=(64, 48)):
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buffer, "PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


MARKS = [{"shape": "box", "x": 0.2, "y": 0.1, "w": 0.2, "h": 0.2, "note": "头发再亮一点"}, {"shape": "pen", "x": 0.5, "y": 0.5, "w": 0.9, "h": 0.9}]


class MarkTests(unittest.TestCase):
    def setUp(self):
        isolate()
        Image.new("RGB", (8, 8)).save(os.path.join(OUTPUT, "a.png"))
        self.patch = mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT)
        self.patch.start()
        ai_tasks.record("Claude", "describe_canvas", {}, ok({}), time.time(), True)
        self.task = ai_tasks.list_tasks()[0]["id"]

    def tearDown(self):
        self.patch.stop()

    def test_marks_are_kept_with_the_task_and_reach_the_ai_with_the_picture(self):
        step = ai_marks.save(self.task, "a.png", png(), MARKS, "整体暖一点")
        self.assertEqual(step["marks"][1]["w"], 0.5, "a mark stays inside the picture")
        kept = ai_marks.path_of(self.task, step["marked"])
        self.assertTrue(kept and kept.startswith(ai_tasks.marks_dir(self.task)))
        self.assertNotIn(OUTPUT, kept, "never in the output folder")
        self.assertIn("Mark 1 (box, x 20–40%, y 10–30% of the picture): 头发再亮一点", step["text"])
        with mock.patch.object(ai_marks, "_image_content", return_value={"type": "image", "data": "x", "mimeType": "image/webp"}):
            result = ai_panels.attach_pending(ok({}), "Claude", task_id=self.task)
        message = result["structuredContent"]["user_messages"][0]
        self.assertEqual((message["kind"], message["image"]), ("marks", "a.png"))
        self.assertNotIn("_marked", message, "the path on disk stays here")
        self.assertEqual(result["content"][-1]["type"], "image", "the marked picture is attached")
        self.assertTrue(ai_tasks.get_task(self.task)["steps"][-1]["delivered"])
        ai_tasks.remove_task(self.task)
        self.assertFalse(os.path.exists(ai_tasks.marks_dir(self.task)), "gone with its task")

    def test_get_answers_gives_the_marked_picture_too(self):
        ai_marks.save(self.task, "a.png", png(), MARKS)
        with mock.patch.object(ai_marks, "_image_content", return_value={"type": "image", "data": "x", "mimeType": "image/webp"}):
            answer, pictures = mcp_task_tools.get_answers({"client": "Claude", "task": self.task})
        self.assertEqual(answer["messages"][0]["kind"], "marks")
        self.assertEqual(len(pictures), 1)

    def test_the_ai_replies_under_the_marks_in_anomalous(self):
        marks = ai_marks.save(self.task, "a.png", png(), MARKS)
        with mock.patch.object(ai_marks, "_image_content", return_value={"type": "image", "data": "x", "mimeType": "image/webp"}):
            result = ai_panels.attach_pending(ok({}), "Claude", task_id=self.task)
        self.assertIn("report(reply_to=", result["structuredContent"]["user_notice"])
        reply = mcp_task_tools.report({"client": "Claude", "task": self.task}, "### 发现" + chr(10) + "- 多了一只手", reply_to=marks["id"])
        self.assertTrue(reply["noted"])
        steps = {step["id"]: step for step in ai_tasks.get_task(self.task)["steps"]}
        note = next(step for step in steps.values() if step["tool"] == "report")
        self.assertEqual((note["reply_to"], steps[marks["id"]]["replied"]), (marks["id"], note["id"]))
        with self.assertRaises(ToolError):
            mcp_task_tools.report({"client": "Claude", "task": self.task}, "x", reply_to=note["id"])  # not the user's

    def test_marks_on_an_ended_task_open_it_again_for_the_ais_next_call(self):
        mcp_task_tools.report({"client": "Claude"}, "做完了", done=True)
        self.assertTrue(ai_tasks.get_task(self.task)["ended"])
        marks = ai_marks.save(self.task, "a.png", png(), MARKS)
        self.assertIsNone(ai_tasks.get_task(self.task)["ended"])
        with mock.patch.object(ai_marks, "_image_content", return_value={"type": "image", "data": "x", "mimeType": "image/webp"}):
            reply = mcp_task_tools.report({"client": "Claude"}, "改好了", reply_to=marks["id"])
        self.assertTrue(reply["noted"], "the reply lands under the marks, not in a new task")
        self.assertEqual(len(ai_tasks.list_tasks()), 1)

    def test_a_repaint_mask_becomes_the_picture_with_that_area_as_its_mask(self):
        inputs = tempfile.mkdtemp(prefix="amb_ai_marks_input_")
        buffer = io.BytesIO()
        mask = Image.new("L", (64, 48), 0)
        mask.paste(255, (0, 0, 32, 48))  # the left half
        mask.save(buffer, "PNG")
        data = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()
        with mock.patch.object(ai_marks.folder_paths, "get_input_directory", return_value=inputs):
            step = ai_marks.save(self.task, "a.png", png(), [], "去掉多余的手", mask=data)
            with self.assertRaises(ai_marks.MarksError):
                blank = io.BytesIO()
                Image.new("L", (8, 8), 0).save(blank, "PNG")
                ai_marks.save(self.task, "a.png", png(), [], "", mask="data:image/png;base64," + base64.b64encode(blank.getvalue()).decode())
        self.assertRegex(step["inpaint"], r"^anomalous_inpaint_[0-9a-f]{10}\.png$")
        with Image.open(os.path.join(inputs, step["inpaint"])) as made:
            self.assertEqual((made.mode, made.size), ("RGBA", (8, 8)))
            self.assertEqual((made.getpixel((1, 4))[3], made.getpixel((6, 4))[3]), (0, 255), "marked: transparent, so LoadImage's MASK is 1 there")
        with mock.patch.object(ai_marks, "_image_content", return_value=None):
            message = ai_panels.attach_pending(ok({}), "Claude", task_id=self.task)["structuredContent"]["user_messages"][0]
        self.assertEqual(message["inpaint_image"], step["inpaint"])
        self.assertIn("SetLatentNoiseMask", message["inpaint_note"])
        self.assertEqual(os.listdir(inputs), [step["inpaint"]], "an empty mask writes nothing")

    def test_how_to_change_it_reaches_the_ai_first_as_the_users_choice(self):
        inputs = tempfile.mkdtemp(prefix="amb_ai_marks_input_")
        buffer = io.BytesIO()
        Image.new("L", (8, 8), 255).save(buffer, "PNG")
        mask = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()
        with mock.patch.object(ai_marks.folder_paths, "get_input_directory", return_value=inputs):
            whole = ai_marks.save(self.task, "a.png", png(), MARKS, "亮一点", mask=mask, mode="whole")
            local = ai_marks.save(self.task, "a.png", png(), MARKS, mask=mask, mode="local")
            left = ai_marks.save(self.task, "a.png", png(), MARKS)
        self.assertEqual((whole["mode"], "inpaint" in whole), ("whole", False), "anew: no mask is kept even when one is sent")
        self.assertEqual(os.listdir(inputs), [local["inpaint"]])
        self.assertEqual(left["mode"], "auto")
        for step, words in ((whole, "make the whole picture anew"), (local, "change ONLY the marked areas"), (left, "up to you")):
            self.assertIn(words, step["text"].split(chr(10))[0], "the choice is the first thing the AI reads")
        with mock.patch.object(ai_marks, "_image_content", return_value=None):
            messages = ai_panels.attach_pending(ok({}), "Claude", task_id=self.task)["structuredContent"]["user_messages"]
        self.assertEqual([message["mode"] for message in messages], ["whole", "local", "auto"])
        self.assertEqual(["inpaint_image" in message for message in messages], [False, True, False])

    def test_what_is_refused(self):
        for image, picture, marks in [("../a.png", png(), MARKS), ("nope.png", png(), MARKS), ("a.png", "data:image/jpeg;base64,AAAA", MARKS),
                                      ("a.png", "data:image/png;base64," + base64.b64encode(b"not a png").decode(), MARKS),
                                      ("a.png", png((5000, 10)), MARKS), ("a.png", png(), []), ("a.png", png(), [{"shape": "star"}]),
                                      ("a.png", png(), MARKS * 11)]:
            with self.assertRaises(ai_marks.MarksError, msg=(image, marks[:1] if marks else marks)):
                ai_marks.save(self.task, image, picture, marks)
        with self.assertRaises(ai_marks.MarksError):
            ai_marks.save("no-task", "a.png", png(), MARKS)
        for mode in ("sometimes", "local"):  # not a way; only the marked areas without an area to repaint
            with self.assertRaises(ai_marks.MarksError, msg=mode):
                ai_marks.save(self.task, "a.png", png(), MARKS, mode=mode)
        self.assertIsNone(ai_marks.path_of(self.task, "../../x.png"))

    def test_path_on_another_drive_is_a_validation_error(self):
        with mock.patch.object(ai_tasks, "_output_media", side_effect=ValueError("Paths don't have the same drive")):
            with self.assertRaises(ai_marks.MarksError):
                ai_marks.save(self.task, "Z:/outside.png", png(), MARKS)


if __name__ == "__main__":
    unittest.main()
