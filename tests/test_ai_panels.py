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

from api import ai_answer_wait, ai_gates, ai_panels, ai_tasks, mcp_task_tools  # noqa: E402

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
        got, pictures = mcp_task_tools.get_answers({"client": "Claude"}, shown["panel"])
        self.assertEqual(pictures, [], "no marked pictures here")
        self.assertEqual(got["answers"], [{"panel": shown["panel"], "question": "pick", "asked": "选哪张？", "choice": ["b"], "labels": ["右边"]}])
        self.assertEqual(got["still_waiting"], [{"panel": shown["panel"], "question": "more"}])
        self.assertEqual(ai_panels.get_answers("Claude")["answers"], [], "each answer is given once")
        ai_panels.answer(task["id"], step["id"], "more", text="  背景再亮一点 ")
        self.assertEqual(ai_panels.get_answers("Claude")["answers"][0]["text"], "背景再亮一点")
        self.assertEqual(ai_panels.get_answers("Cursor")["answers"], [], "another app's panels are not its")

    def test_a_skipped_question_and_when_the_ai_got_each_answer(self):
        shown = ai_panels.show("A", "细节", [CHOICES, {"type": "input", "id": "more", "question": "补充细节（可选）"}])
        task = ai_tasks.list_tasks()[0]["id"]
        step = ai_tasks.get_task(task)["steps"][0]["id"]
        ai_panels.answer(task, step, "pick", ["a"])
        ai_panels.answer(task, step, "more", skip=True)
        self.assertEqual(ai_tasks.list_tasks()[0]["asks"], 0, "a skipped question waits no more")
        got = ai_panels.get_answers("A", shown["id"])
        self.assertEqual(got["answers"][1], {"panel": shown["id"], "question": "more", "asked": "补充细节（可选）", "skipped": True})
        answers = ai_tasks.get_task(task)["steps"][0]["answers"]
        self.assertTrue(all(given["delivered"] and given["delivered_at"] >= given["at"] for given in answers.values()),
                        "the page shows when the AI got each answer")
        self.assertTrue(ai_panels.leave_message(task, "继续")["id"])
        ai_panels.get_answers("A")
        self.assertTrue(ai_tasks.get_task(task)["steps"][-1]["delivered_at"])

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
        got, _ = mcp_task_tools.get_answers({"client": "Claude"}, None, 5)
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
        self.assertGreaterEqual(step["panel"]["changed"], step["at"])  # when its numbers were written
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


    def test_attach_pending_delivers_once_and_skips_errors(self):
        shown = ai_panels.show("Claude", "挑一张", [CHOICES])
        task_id = ai_tasks.list_tasks()[0]["id"]
        step = ai_tasks.get_task(task_id)["steps"][0]
        ai_panels.answer(task_id, step["id"], "pick", "a")
        ai_panels.leave_message(task_id, "再来一张特写")
        notified = []
        with mock.patch.object(ai_tasks, "_notify", side_effect=notified.append):
            failed = {"content": [{"type": "text", "text": "err"}], "structuredContent": {}, "isError": True}
            self.assertEqual(ai_panels.attach_pending(copy.deepcopy(failed), "Claude", task_id=task_id), failed)
            self.assertEqual(notified, [], "failed tool calls must not consume pending messages or answers")
            ok_res = {"content": [{"type": "text", "text": json.dumps({"total": 1})}], "structuredContent": {"total": 1}, "isError": False}
            delivered = ai_panels.attach_pending(ok_res, "Claude", task_id=task_id)
        self.assertIn(task_id, notified)
        self.assertEqual([m["text"] for m in delivered["structuredContent"]["user_messages"]], ["再来一张特写"])
        self.assertEqual(delivered["structuredContent"]["user_answers"][0]["choice"], ["a"])
        again = {"content": [{"type": "text", "text": "{}"}], "structuredContent": {}, "isError": False}
        self.assertNotIn("user_messages", ai_panels.attach_pending(again, "Claude", task_id=task_id)["structuredContent"])

    def test_explicit_task_never_consumes_another_sessions_input(self):
        first = ai_tasks.begin_task("Claude", "first", session="one")["id"]
        second = ai_tasks.begin_task("Claude", "second", session="two")["id"]
        ai_panels.leave_message(first, "first only")
        ai_panels.leave_message(second, "second only")
        result = {"content": [], "structuredContent": {}}
        ai_panels.attach_pending(result, "Claude", task_id=first)
        self.assertEqual([m["text"] for m in result["structuredContent"]["user_messages"]], ["first only"])
        self.assertFalse(ai_tasks.get_task(second)["steps"][-1]["delivered"])
        self.assertEqual(ai_panels.get_answers("Claude", task_id="missing").get("messages", []), [])
        self.assertEqual(ai_panels.get_answers("Claude", task_id=second)["messages"][0]["text"], "second only")

    def test_get_answers_tool_resolves_its_session_before_collecting(self):
        first = ai_tasks.begin_task("Claude", "first", session="one")["id"]
        second = ai_tasks.begin_task("Claude", "second", session="two")["id"]
        ai_panels.leave_message(first, "one")
        ai_panels.leave_message(second, "two")
        self.assertNotIn("messages", mcp_task_tools.get_answers({"client": "Claude", "session": "unknown"})[0])
        answer, _ = mcp_task_tools.get_answers({"client": "Claude", "session": "two", "task": ""})
        self.assertEqual([m["text"] for m in answer["messages"]], ["two"])
        self.assertFalse(ai_tasks.get_task(first)["steps"][-1]["delivered"])
        answer, _ = mcp_task_tools.get_answers({"client": "Claude", "session": "", "task": ""})
        self.assertEqual([m["text"] for m in answer["messages"]], ["one"], "legacy callers without routing still read their own input")


class AskUserTests(unittest.TestCase):
    """ask_user: the AI's question shows in the workbench and the answer comes back to the same call."""

    def setUp(self):
        isolate()
        self.ctx = {"client": "Gemini", "session": "s1"}

    def answer_later(self, delay=0, **given):
        def go():
            time.sleep(delay)
            for _ in range(100):
                tasks = ai_tasks.list_tasks()
                task = ai_tasks.get_task(tasks[0]["id"]) if tasks else None
                step = next((item for item in (task or {}).get("steps", []) if item.get("kind") == "panel"), None)
                if step:
                    ai_panels.answer(task["id"], step["id"], "answer", **given)
                    return
                time.sleep(0.02)
        threading.Thread(target=go, daemon=True).start()

    def test_a_pick_comes_back_and_the_recommended_one_is_marked(self):
        options = [{"label": "光与暗双生少女", "detail": "高难度", "recommended": True}, {"label": "猫耳娘咖啡馆"}]
        self.answer_later(choice=["o2"])
        got = mcp_task_tools.ask_user(self.ctx, "先测哪种双人题材？", options, wait_seconds=5)
        self.assertEqual((got["answered"], got["labels"]), (True, ["猫耳娘咖啡馆"]))
        step = ai_tasks.get_task(ai_tasks.list_tasks()[0]["id"])["steps"][0]
        block = step["panel"]["blocks"][0]
        self.assertEqual((step["panel"]["title"], block["options"][0].get("recommended"), block["other"]), ("先测哪种双人题材？", True, True))
        self.assertEqual(step["tool"], "ask_user", "the timeline says the AI asked")

    def test_a_skipped_question_says_so(self):
        self.answer_later(skip=True)
        got = mcp_task_tools.ask_user(self.ctx, "要不要加光效？", ["要", "不要"], wait_seconds=5)
        self.assertEqual((got["answered"], got["skipped"]), (True, True))
        self.assertIn("left this to you", got["note"])

    def test_their_own_answer_when_no_option_fits(self):
        self.answer_later(text="冰与火，但要室内")
        got = mcp_task_tools.ask_user(self.ctx, "选哪个？", ["甲", "乙"], wait_seconds=5)
        self.assertEqual((got["text"], got["answered"]), ("冰与火，但要室内", True))
        self.assertIn("own answer", got["note"])

    def test_it_waits_a_while_even_when_told_not_to(self):
        self.answer_later(delay=0.3, choice=["o1"])
        with mock.patch.object(mcp_task_tools, "ASK_WAIT_MIN", 5):
            got = mcp_task_tools.ask_user(self.ctx, "修不修手？", ["修", "不修"], wait_seconds=0)
        self.assertEqual((got["answered"], got["labels"]), (True, ["修"]), "the user answering in Anomalous needs no word in the chat")

    def test_unanswered_it_waits_on_for_the_users_time_and_while_they_type(self):
        with mock.patch.object(mcp_task_tools, "ASK_WAIT_MIN", 0):
            got = mcp_task_tools.ask_user(self.ctx, "手指怎么修？", ["只重画手指", "整张重画"], wait_seconds=0)
        self.assertEqual((got["answered"], got["keep_waiting"]), (False, True))
        self.assertGreater(got["seconds_left"], 170, "three minutes unless the user set otherwise")
        task_id = ai_tasks.list_tasks()[0]["id"]
        asked = ai_tasks.get_task(task_id)["steps"][0]["at"]
        late = asked + ai_gates.answer_wait() + 5
        self.assertFalse(ai_answer_wait.wait_on(got["panel"], now=late)["keep_waiting"])
        self.assertIn("end your turn", ai_answer_wait.wait_on(got["panel"], now=late)["note"])
        self.assertTrue(ai_answer_wait.typing(task_id, now=late - 10))
        typing = ai_answer_wait.wait_on(got["panel"], now=late)
        self.assertEqual((typing["keep_waiting"], typing["typing"]), (True, True), "typing keeps the AI waiting")
        answer, _ = mcp_task_tools.get_answers(self.ctx, panel=got["panel"])
        self.assertTrue(answer["keep_waiting"], "get_answers says it too")
        self.assertFalse(ai_answer_wait.typing("no_such_task"))

    def test_on_the_users_word_time_running_out_takes_the_recommended_option(self):
        from api import ai_decisions
        options = [{"label": "只重画手指", "recommended": True}, {"label": "整张重画"}]
        with mock.patch.object(mcp_task_tools, "ASK_WAIT_MIN", 0):
            got = mcp_task_tools.ask_user(self.ctx, "手指怎么修？", options, wait_seconds=0)
            plain = mcp_task_tools.ask_user(self.ctx, "几张？", ["一", "二"], wait_seconds=0)
        task_id = ai_tasks.list_tasks()[0]["id"]
        late = time.time() + ai_gates.answer_wait() + 5
        self.assertIn("end your turn", ai_answer_wait.wait_on(got["panel"], now=late)["note"], "by default nobody answers for the user")
        with mock.patch.object(ai_gates, "no_answer", return_value="recommended"):
            told = ai_answer_wait.wait_on(got["panel"], now=late)
            self.assertIn("end your turn", ai_answer_wait.wait_on(plain["panel"], now=late)["note"], "no recommended option: left open")
        self.assertEqual((told["keep_waiting"], told["took_recommended"]), (False, True))
        answer, _ = mcp_task_tools.get_answers(self.ctx, panel=got["panel"])
        item = answer["answers"][0]
        self.assertEqual((item["labels"], item["recommended_on_timeout"]), (["只重画手指"], True))
        self.assertIn("in time", ai_decisions.lines(ai_tasks.get_task(task_id))[-1], "the decisions say how it was answered")

    def test_the_recommended_option_taken_on_time_comes_in_the_same_call(self):
        options = [{"label": "只重画手指", "recommended": True}, {"label": "整张重画"}]
        with mock.patch.object(mcp_task_tools, "ASK_WAIT_MIN", 0), mock.patch.object(ai_gates, "answer_wait", return_value=0):
            asked = mcp_task_tools.ask_user(self.ctx, "手指怎么修？", options, wait_seconds=0)
            self.assertFalse(asked["answered"], "the default: the AI waits for the user")
            with mock.patch.object(ai_gates, "no_answer", return_value="recommended"):
                answer, _ = mcp_task_tools.get_answers(self.ctx, panel=asked["panel"])
                again = mcp_task_tools.ask_user(self.ctx, "还要放大吗？", options, wait_seconds=0)
        self.assertEqual(answer["answers"][0]["labels"], ["只重画手指"], "get_answers hands it over at once")
        self.assertIn("took it for them", answer["note"])
        self.assertEqual((again["answered"], again["labels"], again["recommended_on_timeout"]), (True, ["只重画手指"], True))

    def test_a_note_or_panel_alone_says_to_ask_before_stopping(self):
        self.assertIn("ask_user", mcp_task_tools.report(self.ctx, "换好了 LoRA")["next"])
        self.assertIn("ask it with ask_user", mcp_task_tools.report(self.ctx, "要不要再亮一点？")["next"])
        self.assertNotIn("next", mcp_task_tools.report(self.ctx, "做完了", done=True))
        shown = mcp_task_tools.show_panel(self.ctx, "方案", [{"type": "text", "text": "先修手"}])
        self.assertIn("ask_user", shown["next"])

    def test_no_options_is_a_line_and_no_answer_yet_says_how_to_keep_waiting(self):
        with mock.patch.object(mcp_task_tools, "ASK_WAIT_MIN", 0):
            got = mcp_task_tools.ask_user(self.ctx, "想要几张？", wait_seconds=0)
        self.assertFalse(got["answered"])
        self.assertIn("get_answers", got["note"])
        step = ai_tasks.get_task(ai_tasks.list_tasks()[0]["id"])["steps"][0]
        self.assertEqual(step["panel"]["blocks"][0]["type"], "input")

    def test_other_text_only_where_the_question_allows_it(self):
        panel = ai_panels.show("Gemini", "q", [{"type": "choices", "id": "answer", "options": ["a", "b"]}])
        task = ai_tasks.list_tasks()[0]["id"]
        step = ai_tasks.get_task(task)["steps"][0]["id"]
        with self.assertRaises(ai_panels.PanelError):
            ai_panels.answer(task, step, "answer", text="随便")
        self.assertTrue(panel["id"])


if __name__ == "__main__":
    unittest.main()
