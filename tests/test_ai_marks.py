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

    def test_what_is_refused(self):
        for image, picture, marks in [("../a.png", png(), MARKS), ("nope.png", png(), MARKS), ("a.png", "data:image/jpeg;base64,AAAA", MARKS),
                                      ("a.png", "data:image/png;base64," + base64.b64encode(b"not a png").decode(), MARKS),
                                      ("a.png", png((5000, 10)), MARKS), ("a.png", png(), []), ("a.png", png(), [{"shape": "star"}]),
                                      ("a.png", png(), MARKS * 11)]:
            with self.assertRaises(ai_marks.MarksError, msg=(image, marks[:1] if marks else marks)):
                ai_marks.save(self.task, image, picture, marks)
        with self.assertRaises(ai_marks.MarksError):
            ai_marks.save("no-task", "a.png", png(), MARKS)
        self.assertIsNone(ai_marks.path_of(self.task, "../../x.png"))


if __name__ == "__main__":
    unittest.main()
