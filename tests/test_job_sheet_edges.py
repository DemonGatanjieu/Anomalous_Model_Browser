"""Job-sheet cancellation and receipts when the page and MCP return in a different order."""
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_tasks, job_sheets  # noqa: E402
from test_job_sheets import FLOW, OTHER, PAGE, Queue, isolate, picture  # noqa: E402


class SheetEdgeTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.queue = Queue()
        patch = mock.patch("api.ai_task_runs._queue", return_value=self.queue)
        patch.start()
        self.addCleanup(patch.stop)

    def start(self, **given):
        return job_sheets.start({"rows": ["a cat"], "workflow": FLOW, "page": PAGE, **given})

    def report(self, sheet, **fields):
        return job_sheets.report({"id": sheet["id"], "page": PAGE, **fields})

    def step(self, task):
        result = {"structuredContent": {}, "content": [{"type": "text", "text": "ok"}]}
        return ai_tasks.finish_step("AI", "run_workflow", {"sheet": {}}, result, time.time(), task_id=task)

    def test_clearing_a_stale_sheet_stops_its_pending_runs(self):
        sheet = self.start()
        self.report(sheet, queued=[["old-run", 0]], at=1)
        with mock.patch.object(job_sheets.time, "time", return_value=time.time() + job_sheets.STALE + 1):
            job_sheets.clear(sheet["id"])
        self.assertEqual(self.queue.interrupted, ["old-run"])
        self.assertTrue(self.queue.deleted[0]((0, "old-run")))
        self.assertFalse(self.queue.deleted[0]((0, "someone-else")))
        self.assertIsNone(job_sheets.current())

    def test_replacing_a_stale_sheet_stops_only_its_runs(self):
        sheet = self.start()
        self.report(sheet, queued=[["old-run", 0]], at=1)
        with mock.patch.object(job_sheets.time, "time", return_value=time.time() + job_sheets.STALE + 1):
            new = self.start(page=OTHER)
        self.assertEqual(self.queue.interrupted, ["old-run"])
        self.assertEqual(job_sheets.current()["id"], new["id"])
        self.assertNotEqual(new["id"], sheet["id"])

    def test_a_late_queue_receipt_after_stop_is_cancelled(self):
        sheet = self.start()
        job_sheets.ask(sheet["id"], "stop", PAGE)
        now = self.report(sheet, queued=[["late-run", 0]], at=1, state="running")
        self.assertEqual(self.queue.interrupted, ["late-run"])
        self.assertEqual(now["state"], "stopped")
        self.assertEqual(job_sheets.current()["state"], "stopped")

    def test_a_report_of_pause_does_not_erase_a_stop_request(self):
        sheet = self.start()
        job_sheets.ask(sheet["id"], "stop", OTHER)
        now = self.report(sheet, state="paused")
        self.assertTrue(now["state"] == "stopped" or now["want"] == "stop")

    def test_binding_the_ai_step_keeps_earlier_pictures_once(self):
        task = ai_tasks.start_task("fast sheet")["id"]
        sheet = self.start(task=task)
        self.queue.history["fast-run"] = picture("cached.png")
        self.report(sheet, queued=[["fast-run", 0]], finished=[["fast-run", "ok"]], at=1, state="done")
        step = self.step(task)
        job_sheets.attach(sheet["id"], step["id"])
        job_sheets.attach(sheet["id"], step["id"])
        shown = next(item for item in ai_tasks.get_task(task)["steps"] if item["id"] == step["id"])
        self.assertEqual([item["filename"] for item in shown["results"] if item["type"] == "image"], ["cached.png"])
        self.assertEqual(shown["state"], "done")

    def test_non_successful_runs_do_not_become_a_successful_sheet(self):
        for outcome in ("interrupted", "gone"):
            with self.subTest(outcome=outcome):
                isolate()
                task = ai_tasks.start_task("interrupted sheet")["id"]
                sheet = self.start(task=task)
                step = self.step(task)
                job_sheets.attach(sheet["id"], step["id"])
                self.report(sheet, queued=[["p1", 0]], finished=[["p1", outcome]], at=1, state="done")
                shown = next(item for item in ai_tasks.get_task(task)["steps"] if item["id"] == step["id"])
                self.assertEqual(shown["state"], "error")
                self.assertFalse(shown["ok"])


if __name__ == "__main__":
    unittest.main()
