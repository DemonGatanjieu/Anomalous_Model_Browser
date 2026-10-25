"""The area to repaint, agreed between the AI and the user (api/ai_repaint.py): the AI's area beside
the user's marks on a panel, and once the user picks one, the picture in the input folder with that
area as its alpha. Temporary folders only."""
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

from api import ai_marks, ai_panels, ai_repaint, ai_tasks, mcp_task_tools  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402
from test_ai_marks import MARKS, png  # noqa: E402
from test_ai_tasks import isolate, ok  # noqa: E402
from test_mcp import rpc  # noqa: E402  (its module keeps tasks and gates in temporary folders; setUp's isolate comes after)

OUTPUT = tempfile.mkdtemp(prefix="amb_repaint_output_")
INPUT = tempfile.mkdtemp(prefix="amb_repaint_input_")
CTX = {"client": "Claude"}
AREA = [{"shape": "box", "x": 0.25, "y": 0.25, "w": 0.25, "h": 0.25}]


class RepaintTests(unittest.TestCase):
    def setUp(self):
        isolate()
        Image.new("RGB", (200, 100), (20, 120, 200)).save(os.path.join(OUTPUT, "girl.png"))
        for name in os.listdir(INPUT):
            os.remove(os.path.join(INPUT, name))
        for patch in (mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT),
                      mock.patch.object(ai_tasks.folder_paths, "get_input_directory", return_value=INPUT),
                      mock.patch.object(mcp_task_tools, "ASK_WAIT_MIN", 0)):
            patch.start()
            self.addCleanup(patch.stop)
        ai_tasks.record("Claude", "describe_canvas", {}, ok({}), time.time(), True)
        self.task = ai_tasks.list_tasks()[0]["id"]
        self.marks = ai_marks.save(self.task, "girl.png", png((200, 100)), MARKS, "手指怪怪的")

    def propose(self, **more):
        return mcp_task_tools.propose_repaint_area(CTX, "手指重画的范围", self.marks["id"], wait_seconds=0, **more)

    def panel_step(self, panel_id):
        return ai_panels._find(panel_id)[1]

    def pick(self, panel_id, choice=None, text=None, skip=False):
        step = self.panel_step(panel_id)
        extra = ai_repaint.prepare(self.task, step["id"], choice, text, skip)
        ai_panels.answer(self.task, step["id"], "answer", choice, text, skip=skip, extra=extra)
        return extra

    def test_both_areas_side_by_side_with_three_answers(self):
        got = self.propose(areas=AREA, grow=6, feather=4, note="往手腕多圈一点")
        self.assertEqual((got["answered"], got["keep_waiting"]), (False, True))
        step = self.panel_step(got["panel"])
        self.assertEqual(step["tool"], "propose_repaint_area")
        area, note, choices = step["panel"]["blocks"]
        self.assertEqual((area["type"], area["grow"], area["feather"], note["text"]), ("area", 6, 4, "往手腕多圈一点"))
        for side in ("yours", "ai"):
            self.assertTrue(ai_marks.path_of(self.task, area[side]), "drawn into the task's marks folder")
        self.assertEqual([option["id"] for option in choices["options"]], ["ai", "mine", "again"])
        self.assertEqual(choices["options"][0]["label_key"], "aiRepaintUseAi")
        self.assertEqual(os.listdir(INPUT), [], "nothing in the input folder before the user picks")

    def test_the_ais_area_becomes_the_picture_to_repaint(self):
        got = self.propose(areas=AREA, grow=6, feather=0)
        extra = self.pick(got["panel"], ["ai"])
        with Image.open(os.path.join(INPUT, extra["inpaint_image"])) as made:
            alpha = made.getchannel("A")
            self.assertEqual(made.size, (200, 100))
            self.assertEqual(alpha.getpixel((62, 31)), 0, "inside: repaint (MASK = 1 - alpha)")
            self.assertEqual(alpha.getpixel((47, 22)), 0, "grown by 6 px around the box")
            self.assertEqual(alpha.getpixel((150, 80)), 255, "outside stays")
        answer, _ = mcp_task_tools.get_answers(CTX, panel=got["panel"])
        item = answer["answers"][0]
        self.assertEqual((item["inpaint_image"], item["note"]), (extra["inpaint_image"], ai_panels.INPAINT_NOTE))

    def test_their_own_marks_your_call_and_marking_again(self):
        mine = self.pick(self.propose(areas=AREA)["panel"], ["mine"])
        with Image.open(os.path.join(INPUT, mine["inpaint_image"])) as made:
            self.assertEqual(made.getchannel("A").getpixel((60, 20)), 0, "their box (20-40%, 10-30%) as they drew it")
        self.assertIn("inpaint_image", self.pick(self.propose(areas=AREA)["panel"], skip=True), "your call takes the AI's")
        self.assertEqual(self.pick(self.propose()["panel"], ["again"]), {"note": ai_repaint.AGAIN_NOTE})
        self.assertEqual(self.pick(self.propose()["panel"], text="再往左一点"), {"note": ai_repaint.WORDS_NOTE})

    def test_a_refused_answer_leaves_no_picture(self):
        panel = self.propose(areas=AREA)["panel"]
        self.pick(panel, ["ai"])
        extra = ai_repaint.prepare(self.task, self.panel_step(panel)["id"], ["mine"], None)
        with self.assertRaises(ai_panels.PanelError):
            ai_panels.answer(self.task, self.panel_step(panel)["id"], "answer", ["mine"], extra=extra)
        ai_repaint.discard(extra)
        self.assertEqual(len(os.listdir(INPUT)), 1, "only the first answer's picture stays")

    def test_through_the_server_it_is_one_step_of_its_own(self):
        result = rpc("tools/call", {"name": "propose_repaint_area", "arguments": {
            "title": "范围", "marks": self.marks["id"], "wait_seconds": 0}}, "propose_repaint_area")["result"]
        self.assertFalse(result["isError"], result)
        steps = [step for step in ai_tasks.get_task(self.task)["steps"] if step["tool"] == "propose_repaint_area"]
        self.assertEqual([step["kind"] for step in steps], ["panel"], "no second step without its panel")
        self.assertTrue(ai_tasks.list_tasks())

    def test_what_is_refused(self):
        with self.assertRaises(ToolError):
            mcp_task_tools.propose_repaint_area(CTX, "x", "nope", wait_seconds=0)
        with self.assertRaises(ToolError):
            self.propose(areas=[{"shape": "star", "x": 0, "y": 0, "w": 0.1, "h": 0.1}])
        with self.assertRaises(ToolError):
            self.propose(grow=999)
        with self.assertRaises(ai_panels.PanelError):
            ai_panels.clean_blocks([{"type": "area", "yours": "../x.png", "ai": "0123456789.png"}])
        self.assertEqual(ai_repaint.prepare(self.task, self.marks["id"], ["ai"], None), {}, "not a repaint panel")


if __name__ == "__main__":
    unittest.main()
