"""Panels the AI draws from Anomalous's blocks (api/ai_panels.py): what is let through, the
user's answers, and the AI waiting for them. Kept in a temporary folder."""
import copy
import json
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
    ai_tasks._waiting[0] = None
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


class StageTests(unittest.TestCase):
    """Marks on pictures, the slider, picks and the diagram: data only, laid out by the page."""

    def setUp(self):
        isolate()

    def test_marks_slider_picks_and_diagram(self):
        with mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT):
            blocks = ai_panels.clean_blocks([
                {"type": "images", "items": [{"image": "a.png", "marks": [
                    {"x": 0.6, "y": 0.5, "label": "手指修好了", "color": "green"},
                    {"x": 0.2, "y": 0.2, "w": 0.3, "h": 0.2, "label": "光影", "color": "pink"}]}]},
                {"type": "slider", "before": {"image": "a.png"}, "after": "b.png", "before_label": "改之前", "after_label": "改之后"},
                {"type": "picks", "id": "lora", "question": "哪个权重？", "items": [
                    {"id": "w06", "image": "a.png", "label": "0.6", "reason": "偏淡"},
                    {"image": "b.png", "label": "0.8", "reason": "推荐", "recommended": True}]},
                {"type": "diagram", "direction": "sideways", "nodes": [
                    {"id": "m", "label": "模型", "node_id": 4}, {"id": "s", "label": "采样", "color": "blue"}],
                 "edges": [{"from": "m", "to": "s", "label": "MODEL"}]},
            ])
        marks = blocks[0]["items"][0]["marks"]
        self.assertEqual(marks[0], {"x": 0.6, "y": 0.5, "label": "手指修好了", "color": "green", "r": 0.06})
        self.assertEqual(marks[1], {"x": 0.2, "y": 0.2, "label": "光影", "color": "red", "w": 0.3, "h": 0.2})
        self.assertEqual((blocks[1]["before"]["filename"], blocks[1]["after"]["filename"]), ("a.png", "b.png"))
        self.assertEqual([item["id"] for item in blocks[2]["items"]], ["w06", "p2"])
        self.assertTrue(blocks[2]["items"][1]["recommended"])
        self.assertEqual(blocks[2]["id"], "lora")
        self.assertEqual(blocks[3]["direction"], "right")
        self.assertEqual(blocks[3]["nodes"][0]["node_id"], "4")
        self.assertEqual(blocks[3]["edges"], [{"from": "m", "to": "s", "label": "MODEL"}])

    def test_stage_blocks_refused(self):
        bad = [
            [{"type": "images", "items": [{"image": "a.png", "marks": [{"x": 1.5, "y": 0}]}]}],
            [{"type": "images", "items": [{"image": "a.png", "marks": [{"x": 0.1, "y": 0.1}] * 9}]}],
            [{"type": "slider", "before": "a.png"}],
            [{"type": "picks", "items": [{"image": "a.png"}]}],
            [{"type": "picks", "items": [{"id": "x", "image": "a.png"}, {"id": "x", "image": "b.png"}]}],
            [{"type": "diagram", "nodes": []}],
            [{"type": "diagram", "nodes": [{"id": "a", "label": "A"}], "edges": [{"from": "a", "to": "zz"}]}],
            [{"type": "svg", "svg": "<svg onload=alert(1)>"}],
        ]
        with mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT):
            for blocks in bad:
                with self.assertRaises(ai_panels.PanelError, msg=str(blocks)[:80]):
                    ai_panels.clean_blocks(blocks)

    def test_a_pick_is_an_answer(self):
        with mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT):
            shown = ai_panels.show("A", "选一张", [{"type": "picks", "id": "pick", "question": "哪张？",
                                                 "items": [{"id": "l", "image": "a.png", "label": "左"}, {"id": "r", "image": "b.png"}]}])
        task_id = ai_tasks.list_tasks()[0]["id"]
        step = ai_tasks.get_task(task_id)["steps"][0]
        self.assertEqual(ai_tasks.list_tasks()[0]["asks"], 1)
        with self.assertRaises(ai_panels.PanelError):
            ai_panels.answer(task_id, step["id"], "pick", ["x"])
        ai_panels.answer(task_id, step["id"], "pick", ["r"])
        got = ai_panels.get_answers("A", shown["id"])["answers"]
        self.assertEqual(got, [{"panel": shown["id"], "question": "pick", "asked": "哪张？", "choice": ["r"], "labels": ["r"]}])


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
        with self.assertRaises(ai_panels.PanelError):
            ai_panels.answer(task["id"], step["id"], shown["blocks"][0]["id"], text="not a question")
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

    def test_messages_from_the_user(self):
        ai_tasks.record("Claude", "describe_canvas", {}, {"content": [], "structuredContent": {}, "isError": False}, 1.0, True)
        task_id = ai_tasks.list_tasks()[0]["id"]
        with self.assertRaises(ai_panels.PanelError):
            ai_panels.leave_message(task_id, "   ")
        with self.assertRaises(ai_panels.PanelError):
            ai_panels.leave_message("nope", "hi")
        threading.Timer(0.3, lambda: ai_panels.leave_message(task_id, " 背景再亮一点 ")).start()
        started = time.monotonic()
        got = mcp_task_tools.get_answers({"client": "Claude"}, None, 5)
        self.assertLess(time.monotonic() - started, 3, "a message wakes an AI waiting with no panel")
        self.assertEqual([m["text"] for m in got["messages"]], ["背景再亮一点"])
        self.assertEqual(ai_panels.get_answers("Claude"), {"answers": [], "still_waiting": []}, "each message once")
        step = ai_tasks.get_task(task_id)["steps"][-1]
        self.assertEqual((step["kind"], step["delivered"]), ("user", True))
        ai_panels.leave_message(task_id, "先别跑了")
        self.assertEqual(ai_panels.get_answers("Cursor"), {"answers": [], "still_waiting": []}, "another app does not get it")
        # Asking about one panel brings that panel's task's messages too.
        shown = ai_panels.show("Claude", "问", [CHOICES])
        got = ai_panels.get_answers("Claude", shown["id"])
        self.assertEqual([m["text"] for m in got["messages"]], ["先别跑了"])

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

    def test_later_results_append_even_when_client_prepends_them(self):
        plan = [{"type": "heading", "text": "搭配方案"},
                {"type": "text", "text": "先选模型"},
                {"type": "diagram", "nodes": [{"id": "sampler", "label": "采样器"}], "edges": []}]
        result = [{"type": "heading", "text": "成图结果"}, {"type": "images", "items": ["a.png"]}]
        shown = mcp_task_tools.show_panel({"client": "A"}, "过程", plan)
        with mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT):
            changed = mcp_task_tools.update_panel({}, shown["panel"], blocks=result + plan)
            again = mcp_task_tools.update_panel({}, shown["panel"], blocks=result + plan)
        task_id = ai_tasks.list_tasks()[0]["id"]
        task = ai_tasks.get_task(task_id)
        blocks = task["steps"][0]["panel"]["blocks"]
        self.assertEqual([b["type"] for b in blocks], ["heading", "text", "diagram", "heading", "images"])
        self.assertEqual([blocks[0]["text"], blocks[3]["text"]], ["搭配方案", "成图结果"])
        self.assertEqual(changed["blocks"][:3], shown["blocks"], "existing handles and order stay")
        self.assertEqual(again, changed, "retrying does not duplicate content")
        ai_tasks._tasks = None
        self.assertEqual(ai_tasks.get_task(task_id)["steps"][0]["panel"]["blocks"], blocks,
                         "chronological order survives reload")

    def test_partial_update_keeps_earlier_content_answers_and_progress_position(self):
        shown = ai_panels.show("A", "过程", [CHOICES, {"type": "progress", "value": 1, "max": 4}])
        task_id = ai_tasks.list_tasks()[0]["id"]
        step = ai_tasks.get_task(task_id)["steps"][0]
        ai_panels.answer(task_id, step["id"], "pick", "a")
        progress_id = shown["blocks"][1]["id"]
        changed = ai_panels.update(shown["id"], blocks=[{"type": "text", "text": "结果好了"},
                                  {"type": "progress", "id": progress_id, "value": 4, "max": 4}])
        self.assertEqual([b["type"] for b in changed["blocks"]], ["choices", "progress", "text"])
        self.assertEqual(changed["blocks"][1]["value"], 4)
        self.assertEqual(ai_panels.get_answers("A")["answers"][0]["choice"], ["a"])
        self.assertEqual(ai_panels.get_answers("A")["answers"], [])

    def test_invalid_update_keeps_panel_and_disk_unchanged(self):
        shown = ai_panels.show("A", "保留标题", [{"type": "text", "text": "保留内容"}])
        task_id = ai_tasks.list_tasks()[0]["id"]
        before = copy.deepcopy(ai_tasks.get_task(task_id))
        bad = [
            [{"type": "html"}],
            [{"type": "progress", "id": shown["blocks"][0]["id"], "value": 1}],
            [{"type": "text", "text": str(i)} for i in range(ai_panels.MAX_BLOCKS)],
            [{"type": "text", "id": "same", "text": "a"}, {"type": "divider", "id": "same"}],
        ]
        for blocks in bad:
            with self.subTest(blocks=blocks), self.assertRaises(ai_panels.PanelError):
                ai_panels.update(shown["id"], title="不能留下的新标题", blocks=blocks)
            self.assertEqual(ai_tasks.get_task(task_id), before)
            with open(ai_tasks._path(task_id), encoding="utf-8") as source:
                self.assertEqual(json.load(source), before)

    def test_anonymous_followup_question_does_not_replace_answered_question(self):
        original = {"type": "input", "question": "先画什么？"}
        followup = {"type": "input", "question": "结果要改哪里？"}
        shown = ai_panels.show("A", "问答", [original])
        task_id = ai_tasks.list_tasks()[0]["id"]
        step = ai_tasks.get_task(task_id)["steps"][0]
        first_id = shown["blocks"][0]["id"]
        ai_panels.answer(task_id, step["id"], first_id, text="海边")
        updated = ai_panels.update(shown["id"], blocks=[followup])
        self.assertEqual([b["question"] for b in updated["blocks"]], [original["question"], followup["question"]])
        self.assertNotEqual(updated["blocks"][1]["id"], first_id)
        again = ai_panels.update(shown["id"], blocks=[followup])
        self.assertEqual(again["blocks"], updated["blocks"], "an unchanged retry keeps the question id")
        self.assertEqual(ai_tasks.list_tasks()[0]["asks"], 1)
        self.assertEqual(ai_panels.get_answers("A")["answers"][0]["text"], "海边")

    def test_legacy_blocks_keep_order_when_updated(self):
        plan = [{"type": "text", "text": "之前的方案"}, {"type": "progress", "value": 1}]
        shown = ai_panels.show("A", "旧面板", plan)
        for block in shown["blocks"]:
            block.pop("id")  # old records did not give static blocks handles
        changed = ai_panels.update(shown["id"], blocks=[{"type": "text", "text": "后来的结果"},
                                  plan[0], {"type": "progress", "value": 100}])
        self.assertEqual([b["type"] for b in changed["blocks"]], ["text", "progress", "text"])
        self.assertEqual(changed["blocks"][1]["value"], 100)
        self.assertEqual(len({b["id"] for b in changed["blocks"]}), 3)


if __name__ == "__main__":
    unittest.main()
