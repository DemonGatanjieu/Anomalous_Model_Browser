"""A task's key decisions (ai_decisions.py): the AI records them with log_decision, the user's own
choices in Anomalous are read from the task's steps, and an AI picking the task up hears them."""
import time
import unittest

from test_ai_tasks import isolate, ok
from api import ai_decisions, ai_gates, ai_panels, ai_task_canvas, ai_tasks, ai_toolbox, mcp_task_tools
from api.mcp_tools import ToolError


class DecisionTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.task = ai_tasks.begin_task("A", "水彩少女")["id"]
        self.ctx = {"client": "A", "task": self.task}

    def test_the_ai_records_what_was_settled_and_what_it_is_about(self):
        run = ai_tasks.record("A", "run_workflow", {}, ok({}), time.time())
        answer = mcp_task_tools.log_decision(self.ctx, "背景", "水晶湖畔，光线偏冷", reason="和发色更搭",
                                             rejected=["晨光森林"], by="together", related=[run["id"], "nope"])
        self.assertEqual(answer["related"], [run["id"]], "only this task's steps")
        step = ai_tasks.get_task(self.task)["steps"][-1]
        self.assertEqual((step["kind"], step["decision"]["by"], step["decision"]["rejected"]), ("decision", "together", ["晨光森林"]))
        with self.assertRaises(ToolError):
            mcp_task_tools.log_decision(self.ctx, "背景", "")
        with self.assertRaises(ToolError):
            mcp_task_tools.log_decision(self.ctx, "背景", "x", by="boss")

    def test_the_users_own_choices_are_decisions_too_and_the_ai_hears_them_again(self):
        shown = ai_panels.show("A", "风格", [{"type": "choices", "id": "style", "question": "选风格？", "options": ["水彩", "厚涂"]},
                                             {"type": "input", "id": "more", "question": "补充？"}], task_id=self.task)
        step = next(item for item in ai_tasks.get_task(self.task)["steps"] if item.get("kind") == "panel")
        ai_panels.answer(self.task, step["id"], "style", ["o1"])
        ai_panels.answer(self.task, step["id"], "more", skip=True)
        ai_toolbox.pick(self.task, {"nodes": ["KSampler"]}, "only")
        ai_task_canvas.set_mode(self.task, "current")
        ai_task_canvas.set_mode(self.task, "current")  # no change: no second decision
        mcp_task_tools.log_decision(self.ctx, "尺寸", "竖图 832×1216", by="user")
        found = ai_decisions.decisions(ai_tasks.get_task(self.task))
        self.assertEqual([item["type"] for item in found], ["answer", "answer", "toolbox", "canvas", "logged"])
        self.assertEqual((found[0]["question"], found[0]["answer"]), ("选风格？", "水彩"))
        self.assertTrue(found[1]["skipped"])
        self.assertEqual((found[2]["mode"], found[2]["count"]), ("only", 1))
        self.assertEqual(found[3]["mode"], "current")
        begun = mcp_task_tools.begin_task(self.ctx, "继续")
        self.assertIn("尺寸: 竖图 832×1216", begun["decisions"])
        self.assertIn('The user answered "选风格？": 水彩', begun["decisions"])
        self.assertTrue(shown["id"])

    def test_a_gate_answer_is_a_decision_and_the_gap_counts_work_since_the_last_one(self):
        self.assertIsNone(ai_decisions.gap(ai_tasks.get_task(self.task)))
        ai_tasks.record("A", "run_workflow", {}, ok({}), time.time())
        ai_tasks.record("A", "set_values", {}, ok({}), time.time())
        self.assertEqual(ai_decisions.gap(ai_tasks.get_task(self.task)), {"runs": 1, "canvas": 1})
        mcp_task_tools.log_decision(self.ctx, "步数", "30 步")
        self.assertIsNone(ai_decisions.gap(ai_tasks.get_task(self.task)))
        with ai_tasks._lock:
            task = ai_tasks._load()[self.task]
            task["steps"].append({"id": "g1", "at": time.time(), "tool": "download_model", "kind": "download", "ok": True,
                                  "state": "asking", "gate": {"gate": "download", "signature": "x"}, "results": []})
            ai_tasks._save(task)
        ai_gates.decide(self.task, "g1", "deny", "先别下")
        gate = next(item for item in ai_decisions.decisions(ai_tasks.get_task(self.task)) if item["type"] == "gate")
        self.assertEqual((gate["tool"], gate["allowed"], gate["text"]), ("download_model", False, "先别下"))


if __name__ == "__main__":
    unittest.main()
