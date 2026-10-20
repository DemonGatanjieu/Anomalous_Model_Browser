"""The AI workbench's record (api/ai_tasks.py): tasks, steps, what they made, notes, the routes.

Everything is kept in a temporary folder: no test writes into the real ComfyUI user folder."""
import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import ai_tasks, mcp_task_tools  # noqa: E402

TMP = tempfile.mkdtemp(prefix="amb_ai_tasks_")
OUTPUT = tempfile.mkdtemp(prefix="amb_ai_output_")


def isolate():
    """Point the record at an empty temporary folder (called by every test module that makes calls)."""
    ai_tasks.tasks_dir = lambda: TMP
    ai_tasks._tasks = None
    ai_tasks._current.clear()
    for name in os.listdir(TMP):
        os.remove(os.path.join(TMP, name))


def ok(data):
    return {"content": [{"type": "text", "text": json.dumps(data)}], "structuredContent": data, "isError": False}


def failed(message):
    return {"content": [{"type": "text", "text": message}], "isError": True}


class TaskTests(unittest.TestCase):
    def setUp(self):
        isolate()

    def test_calls_of_one_app_make_one_task_until_a_long_pause(self):
        ai_tasks.record("Claude Code", "search_models", {"query": "arona"}, ok({"models": [1, 2, 3]}), 1000.0, True)
        ai_tasks.record("Claude Code", "place_combo", {"name": "K"}, ok({"_activity": "e1"}), 1001.0)
        ai_tasks.record("Cursor", "list_combos", {}, ok({"combos": []}), 1002.0, True)
        tasks = ai_tasks.list_tasks()
        self.assertEqual(len(tasks), 2)
        claude = next(task for task in tasks if task["client"] == "Claude Code")
        self.assertEqual((claude["steps"], claude["kinds"]), (2, {"look": 1, "canvas": 1}))
        self.assertEqual(claude["title"], "place_combo: K", "named after its first change")
        detail = ai_tasks.get_task(claude["id"])
        look, place = detail["steps"]
        self.assertEqual(look["count"], 3)
        self.assertEqual(place["results"], [{"type": "combo", "name": "K"}, {"type": "canvas", "activity": "e1"}])
        # Kept on disk, read back after a restart.
        ai_tasks._tasks = None
        self.assertEqual(ai_tasks.get_task(claude["id"])["steps"][1]["tool"], "place_combo")
        # A long pause starts a new task; the old one is ended.
        with mock.patch.object(ai_tasks.time, "time", return_value=time_after(claude, ai_tasks.IDLE_SECONDS + 5)):
            ai_tasks.record("Claude Code", "describe_canvas", {}, ok({}), ai_tasks.time.time(), True)
        self.assertEqual(len([task for task in ai_tasks.list_tasks() if task["client"] == "Claude Code"]), 2)
        self.assertTrue(ai_tasks.get_task(claude["id"])["ended"])

    def test_begin_task_names_it_and_ends_the_last(self):
        ai_tasks.record("Claude", "describe_canvas", {}, ok({}), 10.0, True)
        first = ai_tasks.list_tasks()[0]["id"]
        answer = mcp_task_tools.begin_task({"client": "Claude"}, "画一张海边的阿罗娜")
        self.assertTrue(ai_tasks.get_task(first)["ended"])
        ai_tasks.record("Claude", "run_workflow", {"batch": 2}, failed("No workflow is open"), 20.0)
        task = ai_tasks.get_task(answer["task"])
        self.assertEqual(task["title"], "画一张海边的阿罗娜")
        step = task["steps"][0]
        self.assertFalse(step["ok"])
        self.assertEqual(step["error"], "No workflow is open")
        self.assertEqual(step["results"], [])
        self.assertEqual(ai_tasks.list_tasks()[0]["errors"], 1)
        with self.assertRaises(mcp_task_tools.ToolError):
            mcp_task_tools.begin_task({"client": "Claude"}, "  ")

    def test_what_steps_made(self):
        with mock.patch.object(ai_tasks, "_model_result", side_effect=lambda model_id: {"type": "model", "model_id": model_id}):
            ai_tasks.record("A", "add_lora", {"model_id": "m1"}, ok({"_activity": "e2"}), 1.0)
        ai_tasks.record("A", "speak", {"character": "Aris", "text": "hi"}, ok({"done": True, "files": ["audio/Aris/a.flac"]}), 2.0)
        ai_tasks.record("A", "scan_models", {"what": "new"}, ok({"started": True}), 3.0)
        steps = ai_tasks.get_task(ai_tasks.list_tasks()[0]["id"])["steps"]
        self.assertEqual([step["kind"] for step in steps], ["canvas", "speech", "scan"])
        self.assertEqual(steps[0]["results"], [{"type": "model", "model_id": "m1"}, {"type": "canvas", "activity": "e2"}])
        self.assertEqual(steps[1]["results"], [{"type": "audio", "file": "audio/Aris/a.flac"}])
        self.assertEqual(steps[2]["results"], [{"type": "scan"}])
        self.assertIsNone(ai_tasks.record("A", "begin_task", {"title": "x"}, ok({}), 4.0), "begin_task is not a step")

    def test_a_run_keeps_the_pictures_it_made(self):
        ai_tasks.record("A", "run_workflow", {"batch": 1}, ok({"queued": 1}), 1.0)  # no server: nothing to watch
        task_id = ai_tasks.list_tasks()[0]["id"]
        step = ai_tasks.get_task(task_id)["steps"][0]
        history = {"p1": {"status": {"completed": True, "status_str": "success"},
                          "outputs": {"9": {"images": [{"filename": "a.png", "subfolder": "x", "type": "output"},
                                                       {"filename": "t.png", "subfolder": "", "type": "temp"}]}}}}
        self.assertFalse(ai_tasks._finish_run(task_id, step["id"], ["p1", "p2"], history), "p2 still runs")
        self.assertEqual(ai_tasks.get_task(task_id)["steps"][0]["state"], "running")
        history["p2"] = {"status": {"status_str": "error"}, "outputs": history["p1"]["outputs"]}  # cached: same file
        self.assertTrue(ai_tasks._finish_run(task_id, step["id"], ["p1", "p2"], history))
        step = ai_tasks.get_task(task_id)["steps"][0]
        self.assertEqual(step["results"], [{"type": "image", "filename": "a.png", "subfolder": "x", "folder": "output"}])
        self.assertEqual((step["state"], step["ok"]), ("error", False))
        self.assertEqual(ai_tasks.list_tasks()[0]["cover"]["filename"], "a.png")

    def test_report_keeps_only_pictures_in_the_output_folder(self):
        os.makedirs(os.path.join(OUTPUT, "sub"), exist_ok=True)
        Path(OUTPUT, "sub", "made.png").write_bytes(b"png")
        Path(OUTPUT, "notes.txt").write_text("x")
        with mock.patch.object(ai_tasks.folder_paths, "get_output_directory", return_value=OUTPUT):
            answer = mcp_task_tools.report({"client": "A"}, "图 2 的手不对，换了种子", ["sub/made.png", "../secret.png", "notes.txt", "nope.png"], True)
        self.assertEqual(answer["pictures"], 1)
        self.assertEqual(answer["not_found"], ["../secret.png", "notes.txt", "nope.png"])
        task = ai_tasks.get_task(ai_tasks.list_tasks()[0]["id"])
        self.assertTrue(task["ended"])
        self.assertEqual(task["steps"][0]["text"], "图 2 的手不对，换了种子")
        self.assertEqual(task["steps"][0]["results"], [{"type": "image", "filename": "made.png", "subfolder": "sub", "folder": "output"}])
        with self.assertRaises(mcp_task_tools.ToolError):
            mcp_task_tools.report({"client": "A"}, "  ")

    def test_rename_remove_and_the_oldest_go(self):
        ai_tasks.record("A", "describe_canvas", {}, ok({}), 1.0, True)
        task_id = ai_tasks.list_tasks()[0]["id"]
        self.assertEqual(ai_tasks.rename_task(task_id, " 我的任务 ")["title"], "我的任务")
        self.assertTrue(ai_tasks.remove_task(task_id))
        self.assertFalse(os.path.exists(os.path.join(TMP, f"{task_id}.json")))
        self.assertFalse(ai_tasks.remove_task(task_id))
        with mock.patch.object(ai_tasks, "MAX_TASKS", 3):
            for index in range(5):
                ai_tasks.begin_task("A", f"t{index}", now=100.0 + index)
        self.assertEqual([task["title"] for task in ai_tasks.list_tasks()], ["t4", "t3", "t2"])
        self.assertEqual(len(os.listdir(TMP)), 3)

    def test_client_names(self):
        self.assertEqual(ai_tasks.client_of({}, {"_meta": {"io.modelcontextprotocol/clientInfo": {"name": "claude-code"}}}), "Claude Code")
        self.assertEqual(ai_tasks.client_of({"User-Agent": "Cursor/1.2 (win)"}, {}), "Cursor")
        self.assertEqual(ai_tasks.client_of({"User-Agent": "my<tool>/1"}, {}), "mytool")
        self.assertEqual(ai_tasks.client_of({}, {}), "AI")

    def test_routes(self):
        ai_tasks.record("A", "describe_canvas", {}, ok({}), 1.0, True)
        task_id = ai_tasks.list_tasks()[0]["id"]

        def call(handler, method="GET", body=None, task=None):
            request = mock.Mock()
            request.query = {}
            request.match_info = {"task_id": task} if task else {}
            request.json = lambda: asyncio.sleep(0, body)
            response = asyncio.run(handler(request))
            return response.status, json.loads(response.text)

        self.assertEqual(call(ai_tasks.api_list)[1]["tasks"][0]["id"], task_id)
        self.assertEqual(call(ai_tasks.api_get, task=task_id)[1]["task"]["id"], task_id)
        self.assertEqual(call(ai_tasks.api_get, task="nope")[0], 404)
        self.assertEqual(call(ai_tasks.api_change, body={"title": "新名字"}, task=task_id)[1]["task"]["title"], "新名字")
        self.assertEqual(call(ai_tasks.api_change, body=[], task=task_id)[0], 400)
        self.assertTrue(call(ai_tasks.api_change, body={"remove": True}, task=task_id)[1]["removed"])


def time_after(task, seconds):
    return task["updated"] + seconds


if __name__ == "__main__":
    unittest.main()
