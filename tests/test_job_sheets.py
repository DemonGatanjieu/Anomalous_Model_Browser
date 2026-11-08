"""The job sheet (任务单, api/job_sheets.py): rows checked, one sheet at a time, the page that runs it reporting
its runs, pause / stop / go on from another page, the AI, or with its page gone, and a sheet the AI gave written
on its run step. ComfyUI's queue and history are stand-ins; kept in a temporary folder."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import ai_run_control, ai_tasks, job_sheets, mcp_actions  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402

TMP = tempfile.mkdtemp(prefix="amb_job_sheets_")
FLOW = {"nodes": [{"id": 1, "type": "KSampler"}], "links": []}
PAGE, OTHER = "page-aaaa-1111", "page-bbbb-2222"


class Queue:
    """ComfyUI's queue and history, as much as the sheet reads."""

    def __init__(self):
        self.history, self.deleted, self.interrupted = {}, [], []

    def get_history(self, prompt_id=None):
        return {prompt_id: self.history[prompt_id]} if prompt_id in self.history else {}

    def delete_queue_item(self, match):
        self.deleted.append(match)
        return True

    def interrupt_if_running(self, prompt_id):
        self.interrupted.append(prompt_id)
        return True


def picture(name):
    return {"status": {"status_str": "success", "completed": True},
            "outputs": {"9": {"images": [{"filename": name, "subfolder": "", "type": "output"}]}}}


def isolate():
    ai_tasks.tasks_dir = lambda: os.path.join(TMP, "ai_tasks")
    os.makedirs(ai_tasks.tasks_dir(), exist_ok=True)
    ai_tasks._tasks = None
    ai_tasks._current.clear()
    ai_tasks._waiting[0] = None
    for folder in (TMP, ai_tasks.tasks_dir()):
        for name in os.listdir(folder):
            if os.path.isfile(os.path.join(folder, name)):
                os.remove(os.path.join(folder, name))


class SheetTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.queue = Queue()
        patch = mock.patch("api.ai_task_runs._queue", return_value=self.queue)
        patch.start()
        self.addCleanup(patch.stop)

    def start(self, **given):
        return job_sheets.start({"rows": ["a cat", {"prompt": "a dog", "count": 2}], "count": 3, "pause": 0,
                                 "workflow": FLOW, "page": PAGE, **given})

    def test_rows_are_checked(self):
        rows = job_sheets.rows_of(["a cat", {"values": {"cfg": 4}}, {}], count=2)
        self.assertEqual(rows, [{"prompt": "a cat", "count": 2}, {"values": {"cfg": 4}, "count": 2}, {"count": 2}],
                         "text is a prompt; a row with nothing runs the canvas as it is")
        for bad, words in ((["a", {"seed": 1}], "no part of a row"), ([{"prompt": "  "}], "prompt is text"),
                           ([{"count": 0}], "count is a whole number"), ([{"values": "cfg 4"}], "Row 1"), ([], "1 to 200"),
                           ([{"count": 50}] * 21, "1000")):
            with self.assertRaisesRegex(job_sheets.SheetError, words):
                job_sheets.rows_of(bad)
        with self.assertRaisesRegex(job_sheets.SheetError, "0 to 3600"):
            job_sheets.pause_of(-1)

    def test_one_sheet_at_a_time_and_a_gone_page_gives_way(self):
        sheet = self.start()
        self.assertEqual((sheet["total"], sheet["state"], sheet["by"]), (5, "running", "user"))
        self.assertEqual(job_sheets.workflow(), FLOW)
        with self.assertRaisesRegex(job_sheets.SheetError, "stop it first"):
            self.start()
        with mock.patch.object(job_sheets.time, "time", return_value=time.time() + job_sheets.STALE + 1):
            again = self.start(page=OTHER)
        self.assertNotEqual(again["id"], sheet["id"])

    def test_the_page_reports_runs_and_pictures(self):
        sheet = self.start()
        job_sheets.report({"id": sheet["id"], "page": PAGE, "queued": [["p1", 0]], "at": 1})
        job_sheets.report({"id": sheet["id"], "page": PAGE, "queued": [["p2", 1]], "at": 2})
        self.assertEqual(job_sheets.current()["now"], 0, "the run going is the first still in the queue")
        self.queue.history["p1"] = picture("one.png")
        now = job_sheets.report({"id": sheet["id"], "page": PAGE, "finished": [["p1", "ok"], ["nope", "ok"]]})
        self.assertEqual((now["done"], now["pictures"], now["pending"], now["now"]), (1, 1, ["p2"], 1))
        self.assertEqual(now["last"][0]["filename"], "one.png")
        now = job_sheets.report({"id": sheet["id"], "page": PAGE, "finished": [["p2", "error"]], "state": "paused", "note": "KSampler: out of memory"})
        self.assertEqual((now["failed"], now["state"], now["note"]), (1, "paused", "KSampler: out of memory"))
        with self.assertRaisesRegex(job_sheets.SheetError, "Another page"):
            job_sheets.report({"id": sheet["id"], "page": OTHER})

    def test_pause_stop_and_go_on(self):
        sheet = self.start()
        job_sheets.report({"id": sheet["id"], "page": PAGE, "queued": [["p1", 0], ["p2", 1]], "at": 2})
        asked = job_sheets.ask(sheet["id"], "pause", OTHER)
        self.assertEqual((asked["sheet"]["want"], asked["sheet"]["state"], asked["run"]), ("pause", "running", False),
                         "a live page runs it: it is asked")
        now = job_sheets.report({"id": sheet["id"], "page": PAGE, "state": "paused"})
        self.assertEqual((now["state"], now["want"]), ("paused", None))
        with mock.patch.object(job_sheets.time, "time", return_value=time.time() + job_sheets.STALE + 1):
            taken = job_sheets.ask(sheet["id"], "go", OTHER)
        self.assertEqual((taken["run"], taken["sheet"]["page"], taken["sheet"]["state"]), (True, OTHER, "running"),
                         "its page gone, the asking page runs it")
        stopped = job_sheets.ask(sheet["id"], "stop", OTHER)
        self.assertEqual(stopped["sheet"]["state"], "stopped")
        self.assertEqual(self.queue.interrupted, ["p1", "p2"], "its runs leave the queue at once")
        with self.assertRaisesRegex(job_sheets.SheetError, "ended"):
            job_sheets.ask(sheet["id"], "go", OTHER)
        job_sheets.clear(sheet["id"])
        self.assertIsNone(job_sheets.current())

    def test_a_sheet_the_ai_gave_is_its_run_step(self):
        task = ai_tasks.start_task("many prompts")["id"]
        ctx = {"client": "AI", "session": "", "task": task}
        with mock.patch.object(mcp_actions, "ask_page", side_effect=lambda action, args: self.start(task=args["task"], rows=args["rows"])) as page, \
                mock.patch.object(mcp_actions.mcp_fill, "fill", return_value=None):
            answer = mcp_actions.run_workflow(ctx, batch=2, sheet={"rows": ["a cat", "a dog"], "pause": 5})
            self.assertEqual(page.call_args[0][1]["rows"], [{"prompt": "a cat", "count": 2}, {"prompt": "a dog", "count": 2}])
            self.assertEqual(page.call_args[0][1]["pause"], 5.0)
            with self.assertRaisesRegex(ToolError, "prompts are its rows"):
                mcp_actions.run_workflow(ctx, prompts=["x"], sheet={"rows": ["a"]})
            job_sheets.ask(answer["id"], "stop", PAGE)
            mcp_actions.run_workflow(ctx, prompt="a barn", sheet={"rows": [{"values": {"cfg": 4}}, {"prompt": "a mill", "values": {"cfg": 7}}]})
            self.assertEqual([row.get("prompt") for row in page.call_args[0][1]["rows"]], ["a barn", "a mill"],
                             "prompt with a sheet: the prompt of the rows that have none")
            with self.assertRaisesRegex(ToolError, "1 to 200"):
                mcp_actions.run_workflow(ctx, sheet={"rows": []})
        job_sheets.ask(job_sheets.current()["id"], "stop", PAGE)  # the one the check above started goes
        sheet = job_sheets.start({"rows": ["a cat", "a dog"], "count": 2, "workflow": FLOW, "page": PAGE, "task": task})["id"]
        self.assertIn("end your turn", answer["note"])
        result = {"structuredContent": answer, "content": [{"type": "text", "text": "ok"}]}
        step = ai_tasks.finish_step("AI", "run_workflow", {"sheet": {}}, result, time.time(), task_id=task)
        job_sheets.attach(sheet, step["id"])
        job_sheets.report({"id": sheet, "page": PAGE, "queued": [["p1", 0]], "at": 1})
        self.queue.history["p1"] = picture("cat.png")
        job_sheets.report({"id": sheet, "page": PAGE, "finished": [["p1", "ok"]]})
        shown = next(item for item in ai_tasks.get_task(task)["steps"] if item["id"] == step["id"])
        self.assertEqual((shown["state"], shown["sheet"], shown["progress"]["prompt"]), ("running", sheet, 2))
        self.assertEqual([item["filename"] for item in shown["results"]], ["cat.png"])
        ai_run_control.stop(step["id"], by="user", task_id=task)
        self.assertEqual(job_sheets.current()["want"], "stop", "the page running it is asked")
        job_sheets.report({"id": sheet, "page": PAGE, "state": "stopped"})
        shown = next(item for item in ai_tasks.get_task(task)["steps"] if item["id"] == step["id"])
        self.assertEqual(shown["state"], "cancelled", "the workbench's stop stops the sheet")
        self.assertEqual(job_sheets.current()["state"], "stopped")


if __name__ == "__main__":
    unittest.main()
