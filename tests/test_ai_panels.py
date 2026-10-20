"""Panels the AI draws from Anomalous's blocks (api/ai_panels.py): what is let through, the
user's answers, and the AI waiting for them. Kept in a temporary folder."""
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import ai_panels, ai_tasks, mcp_task_tools  # noqa: E402

TMP = tempfile.mkdtemp(prefix="amb_ai_panels_")
OUTPUT = tempfile.mkdtemp(prefix="amb_ai_panels_out_")
Path(OUTPUT, "a.png").write_bytes(b"png")
Path(OUTPUT, "b.png").write_bytes(b"png")


def isolate():
    ai_tasks.tasks_dir = lambda: TMP
    ai_tasks._tasks = None
    ai_tasks._current.clear()
    for name in os.listdir(TMP):
        os.remove(os.path.join(TMP, name))


CHOICES = {"type": "choices", "id": "pick", "question": "选哪张？", "options": [{"id": "a", "label": "左边"}, {"id": "b", "label": "右边"}]}


class BlockTests(unittest.TestCase):
    def test_every_kind_of_block_and_what_is_left_out(self):
        with mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT):
            blocks = ai_panels.clean_blocks([
                {"type": "heading", "text": "  两张对比 "},
                {"type": "text", "text": "<b>不是网页</b>", "tone": "loud"},
                {"type": "images", "items": [{"image": "a.png", "caption": "左"}, "b.png"], "layout": "compare"},
                {"type": "table", "columns": ["项", "值"], "rows": [["步数", 40], ["CFG", 7.5]]},
                {"type": "list", "items": ["一", "二"], "ordered": True},
                {"type": "params", "items": [{"label": "种子", "value": 42}]},
                CHOICES,
                {"type": "input", "question": "还想改什么？"},
                {"type": "progress", "label": "放大", "value": 150, "max": 100},
                {"type": "divider", "extra": "ignored"},
            ])
        self.assertEqual(blocks[0]["text"], "两张对比")
        self.assertEqual(blocks[1], {"type": "text", "text": "<b>不是网页</b>", "tone": "normal"}, "text stays text")
        self.assertEqual(blocks[2]["items"][1], {"type": "image", "filename": "b.png", "subfolder": "", "folder": "output", "caption": ""})
        self.assertEqual(blocks[3]["rows"], [["步数", "40"], ["CFG", "7.5"]])
        self.assertEqual(blocks[6]["options"][1], {"id": "b", "label": "右边", "detail": ""})
        self.assertEqual(blocks[7]["id"], "q8", "a question without an id gets one")
        self.assertEqual(blocks[8]["value"], 100)
        self.assertEqual(blocks[9], {"type": "divider"})

    def test_refused(self):
        bad = [
            [],
            [{"type": "html", "html": "<script>"}],
            [{"type": "text", "text": "  "}],
            [{"type": "images", "items": ["../secret.png"]}],
            [{"type": "images", "items": [{"image": "a.png"}] * 13}],
            [{"type": "choices", "options": ["only one"]}],
            [{"type": "choices", "options": [{"id": "x", "label": "1"}, {"id": "x", "label": "2"}]}],
            [CHOICES, CHOICES],
            [{"type": "models", "items": ["loras:0:../../x.safetensors"]}],
            [{"type": "progress", "value": "half"}],
            [{"type": "heading", "text": {"a": 1}}],
            [{"type": "text", "text": "x"}] * 31,
        ]
        with mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT):
            for blocks in bad:
                with self.assertRaises(ai_panels.PanelError, msg=str(blocks)[:80]):
                    ai_panels.clean_blocks(blocks)


class AnswerTests(unittest.TestCase):
    def setUp(self):
        isolate()

    def test_show_answer_and_read_once(self):
        shown = mcp_task_tools.show_panel({"client": "Claude"}, "挑一张", [{"type": "text", "text": "看看"}, CHOICES,
                                                                       {"type": "input", "id": "more", "question": "还要改吗"}])
        self.assertEqual(shown["questions"], ["pick", "more"])
        task = ai_tasks.list_tasks()[0]
        self.assertEqual((task["asks"], task["kinds"]), (2, {"panel": 1}))
        step = ai_tasks.get_task(task["id"])["steps"][0]
        self.assertEqual(step["panel"]["title"], "挑一张")
        self.assertEqual(ai_panels.get_answers("Claude", shown["panel"])["answers"], [])
        with self.assertRaises(ai_panels.PanelError):
            ai_panels.answer(task["id"], step["id"], "pick", ["c"])
        with self.assertRaises(ai_panels.PanelError):
            ai_panels.answer(task["id"], step["id"], "pick", ["a", "b"])  # one pick only
        ai_panels.answer(task["id"], step["id"], "pick", ["b"])
        with self.assertRaises(ai_panels.PanelError):
            ai_panels.answer(task["id"], step["id"], "pick", ["a"])  # already answered
        self.assertEqual(ai_tasks.list_tasks()[0]["asks"], 1)
        got = mcp_task_tools.get_answers({"client": "Claude"}, shown["panel"])
        self.assertEqual(got["answers"], [{"panel": shown["panel"], "question": "pick", "asked": "选哪张？", "choice": ["b"], "labels": ["右边"]}])
        self.assertEqual(got["still_waiting"], [{"panel": shown["panel"], "question": "more"}])
        self.assertEqual(ai_panels.get_answers("Claude")["answers"], [], "each answer is given once")
        ai_panels.answer(task["id"], step["id"], "more", text="  背景再亮一点 ")
        self.assertEqual(ai_panels.get_answers("Claude")["answers"][0]["text"], "背景再亮一点")
        self.assertEqual(ai_panels.get_answers("Cursor")["answers"], [], "another app's panels are not its")

    def test_waiting_for_an_answer(self):
        shown = ai_panels.show("A", "等你", [CHOICES])
        task = ai_tasks.list_tasks()[0]
        step = ai_tasks.get_task(task["id"])["steps"][0]
        threading.Timer(0.3, lambda: ai_panels.answer(task["id"], step["id"], "pick", "a")).start()
        started = time.monotonic()
        got = ai_panels.get_answers("A", shown["id"], wait_seconds=5)
        self.assertLess(time.monotonic() - started, 3)
        self.assertEqual(got["answers"][0]["choice"], ["a"])
        started = time.monotonic()
        self.assertEqual(ai_panels.get_answers("A", shown["id"], wait_seconds=5), {"answers": [], "still_waiting": []},
                         "nothing left to wait for: no wait")
        self.assertLess(time.monotonic() - started, 1)

    def test_update_and_close(self):
        shown = ai_panels.show("A", "进度", [{"type": "progress", "value": 1, "max": 4}, CHOICES])
        ai_panels.update(shown["id"], blocks=[{"type": "progress", "value": 3, "max": 4}, CHOICES])
        task_id = ai_tasks.list_tasks()[0]["id"]
        step = ai_tasks.get_task(task_id)["steps"][0]
        self.assertEqual(step["panel"]["blocks"][0]["value"], 3)
        ai_panels.update(shown["id"], closed=True)
        with self.assertRaises(ai_panels.PanelError):
            ai_panels.answer(task_id, step["id"], "pick", "a")
        self.assertEqual(ai_tasks.list_tasks()[0]["asks"], 0)
        with self.assertRaises(mcp_task_tools.ToolError):
            mcp_task_tools.update_panel({}, "nope", title="x")
        with self.assertRaises(mcp_task_tools.ToolError):
            mcp_task_tools.get_answers({}, "nope")
        with self.assertRaises(mcp_task_tools.ToolError):
            mcp_task_tools.show_panel({}, "坏的", [{"type": "html"}])


if __name__ == "__main__":
    unittest.main()
