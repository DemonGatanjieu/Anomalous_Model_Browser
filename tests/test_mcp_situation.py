"""get_situation (api/mcp_situation.py): the task, the canvas in brief and the next step in one
answer that stays small. The page's brief is stood in for; tasks go to a temporary folder."""
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_decisions, ai_panels, ai_task_runs, ai_tasks, mcp_situation  # noqa: E402
from api.mcp_bridge import PageUnavailable  # noqa: E402
from api.mcp_tools import tool_text  # noqa: E402
from test_ai_tasks import isolate, ok  # noqa: E402

CTX = {"client": "Flash"}
BRIEF = {"workflow": "海边.json", "node_count": 3, "lines": ["#3 KSampler | model←#1 latent_image←?LATENT | gives LATENT"],
         "unwired": [{"node": 3, "input": "latent_image", "type": "LATENT", "fits": ["#4 LATENT"]}]}


class SituationTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.page = mock.patch.object(mcp_situation, "ask_page", return_value=dict(BRIEF, lines=list(BRIEF["lines"])))
        self.asked = self.page.start()
        self.addCleanup(self.page.stop)
        ai_tasks.record("Flash", "describe_canvas", {}, ok({}), time.time(), True)
        self.task = ai_tasks.begin_task("Flash", "海边少女")["id"]

    def test_the_task_the_canvas_and_what_to_do_next(self):
        ai_panels.leave_message(self.task, "背景再亮一点")
        ai_decisions.log("Flash", "风格", "水彩", "用户选的", task_id=self.task)
        shown = ai_panels.show("Flash", "选一个", [{"type": "choices", "id": "pick", "options": [{"label": "A"}, {"label": "B"}]}], task_id=self.task)
        got = mcp_situation.get_situation(CTX)
        self.asked.assert_called_once_with("describe_canvas", {"brief": True}, timeout=15)
        self.assertEqual(got["task"]["title"], "海边少女")
        self.assertEqual(got["task"]["asked"]["text"], "背景再亮一点")
        self.assertEqual(got["task"]["waiting_for_user"], 1)
        self.assertIn("风格: 水彩", got["task"]["decisions"][0])
        self.assertEqual((got["run"]["state"], got["canvas"]["unwired"][0]["input"]), ("none", "latent_image"))
        self.assertIn("get_answers", got["next"])  # the user's answer first
        step = next(item for item in ai_tasks.get_task(self.task)["steps"] if item.get("panel", {}).get("id") == shown["id"])
        ai_panels.answer(self.task, step["id"], "pick", "o1")
        self.assertIn("connect_nodes", mcp_situation.get_situation(CTX)["next"])  # then the wire that is missing

    def test_next_follows_the_run_and_the_errors(self):
        nothing = {"asks": 0}
        self.assertIn("run_status", mcp_situation._next(nothing, {"state": "running"}, BRIEF))
        self.assertIn("canvas.errors", mcp_situation._next(nothing, {"state": "error"}, {"errors": [{"node": 3}]}))
        missing = {"errors": [{"node": 66, "error": "Value not in list: unet_name: 'z.safetensors' not in []"}]}
        self.assertIn("check_workflow_models", mcp_situation._next(nothing, {"state": "error"}, missing))
        self.assertIn("zoom_image", mcp_situation._next(nothing, {"state": "done", "pictures": ["a.png"]}, {"unwired": []}))
        self.assertIn("task.asked", mcp_situation._next(nothing, {"state": "none"}, {"unwired": []}))
        with mock.patch.object(ai_task_runs, "status", return_value={"state": "done", "summary": "finished", "pictures": ["a.png"], "seconds": 3}):
            self.assertEqual(mcp_situation.get_situation(CTX)["run"], {"state": "done", "summary": "finished", "pictures": ["a.png"]})

    def test_no_page_no_task_and_the_size(self):
        self.asked.side_effect = PageUnavailable("ComfyUI is not open in a browser on this computer.")
        self.assertIn("not open", mcp_situation.get_situation(CTX)["canvas"]["unavailable"])
        self.asked.side_effect = None
        self.assertIsNone(mcp_situation.get_situation({"client": "Nobody"})["task"])
        self.asked.return_value = {"node_count": 60, "lines": [f"#{at} SomeVeryLongNodeTypeName {'x' * 120}" for at in range(30)],
                                   "more_nodes": 30, "unwired": []}
        got = mcp_situation.get_situation(CTX)
        self.assertLessEqual(len(tool_text(got)), mcp_situation.BUDGET)
        self.assertEqual(len(got["canvas"]["lines"]) + got["canvas"]["more_nodes"], 60)  # what was left out is counted


if __name__ == "__main__":
    unittest.main()
