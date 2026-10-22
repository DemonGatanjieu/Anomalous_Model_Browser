"""A run an AI started (api/ai_task_runs.py): where it stands, read from a stand-in ComfyUI queue
and progress registry, on its step and for the AI's run_status. Temporary folders only."""
import sys
import threading
import time
import unittest
from enum import Enum
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_task_runs, ai_tasks  # noqa: E402
from test_ai_tasks import isolate, ok  # noqa: E402


class State(Enum):
    Pending = "pending"
    Running = "running"
    Finished = "finished"


class Queue:
    def __init__(self, running=(), pending=()):
        self.running, self.pending = list(running), list(pending)

    def get_current_queue(self):
        return self.running, self.pending


def registry(prompt_id, nodes):
    prompt = {"3": {"class_type": "KSampler", "_meta": {"title": "采样器"}}, "4": {"class_type": "CheckpointLoaderSimple"},
              "8": {"class_type": "VAEDecode"}, "9": {"class_type": "SaveImage"}}
    return SimpleNamespace(prompt_id=prompt_id, nodes=nodes,
                           dynprompt=SimpleNamespace(original_prompt=prompt, get_node=lambda node_id: prompt[node_id]))


class ProgressTests(unittest.TestCase):
    def setUp(self):
        isolate()

    def test_queued_then_running_with_the_node_and_its_steps(self):
        queue = Queue(running=[(5, "other")], pending=[(7, "mine"), (6, "first")])
        with mock.patch.object(ai_task_runs, "_queue", return_value=queue):
            self.assertEqual(ai_task_runs.progress_of(["mine"]), {"state": "queued", "ahead": 2})
            queue.running, queue.pending = [(7, "mine")], []
            nodes = {"4": {"state": State.Finished, "value": 1, "max": 1}, "3": {"state": State.Running, "value": 14, "max": 28}}
            with mock.patch.object(ai_task_runs, "_registry", return_value=registry("mine", nodes)):
                got = ai_task_runs.progress_of(["mine"])
        self.assertEqual(got, {"state": "running", "prompt": 1, "prompts": 1, "nodes_done": 1, "nodes": 4,
                               "node": "采样器", "value": 14, "max": 28, "percent": 50})
        with mock.patch.object(ai_task_runs, "_queue", side_effect=RuntimeError("no server")):
            self.assertIsNone(ai_task_runs.progress_of(["mine"]))

    def test_progress_reaches_the_step_and_run_status_waits_for_the_end(self):
        ai_tasks.record("Claude", "run_workflow", {"batch": 1}, ok({"queued": 1}), time.time())
        task_id = ai_tasks.list_tasks()[0]["id"]
        step_id = ai_tasks.get_task(task_id)["steps"][0]["id"]
        with mock.patch.object(ai_tasks, "_notify") as told:
            ai_task_runs._show_progress(task_id, step_id, {"state": "running", "value": 3, "max": 20})
            ai_task_runs._show_progress(task_id, step_id, {"state": "running", "value": 3, "max": 20})
        self.assertEqual(told.call_count, 1, "the page hears only of changes")
        self.assertEqual(told.call_args[0][1]["progress"]["value"], 3)
        status = ai_task_runs.status("Claude")
        self.assertEqual((status["state"], status["progress"]["max"]), ("running", 20))
        self.assertIn("instead of guessing", status["note"])
        history = {"p1": {"status": {"completed": True}, "outputs": {"9": {"images": [{"filename": "a.png", "subfolder": "x", "type": "output"}]}}}}
        threading.Timer(0.3, ai_task_runs._finish_run, (task_id, step_id, ["p1"], history)).start()
        status = ai_task_runs.status("Claude", wait_seconds=5)
        self.assertEqual((status["state"], status["pictures"]), ("done", ["x/a.png"]))
        self.assertNotIn("progress", ai_tasks.get_task(task_id)["steps"][0], "a finished run has no progress left")

    def test_a_run_saves_only_when_something_changes(self):
        ai_tasks.record("A", "run_workflow", {}, ok({}), time.time())
        task_id = ai_tasks.list_tasks()[0]["id"]
        step_id = ai_tasks.get_task(task_id)["steps"][0]["id"]
        with mock.patch.object(ai_tasks, "_save") as saved:
            ai_task_runs._finish_run(task_id, step_id, ["p1"], {})
            ai_task_runs._finish_run(task_id, step_id, ["p1"], {})
        self.assertEqual(saved.call_count, 1)

    def test_no_run_yet(self):
        ai_tasks.record("A", "describe_canvas", {}, ok({}), time.time(), True)
        with self.assertRaises(ValueError):
            ai_task_runs.status("A")

    def run_step(self):
        step = ai_tasks.record("A", "run_workflow", {}, ok({"queued": 1}), time.time())
        return ai_tasks.active_task_id("A"), step["id"]

    def test_no_queued_prompt_is_not_success(self):
        task, step = self.run_step()
        ai_task_runs._finish_run(task, step, [], {})
        self.assertEqual(ai_task_runs.status("A")["state"], "stopped")
        self.assertFalse(ai_tasks.get_task(task)["steps"][-1]["ok"])

    def test_failure_is_recorded_even_when_other_prompts_are_pending(self):
        task, step = self.run_step()
        ai_task_runs._finish_run(task, step, ["one", "two"], {})
        ai_task_runs._finish_run(task, step, ["one", "two"], {"one": {"status": {"status_str": "error"}}})
        self.assertFalse(ai_tasks.get_task(task)["steps"][-1]["ok"])
        self.assertIn("error", ai_task_runs.status("A"))

    def test_watcher_timeout_and_history_failure_stop_the_receipt(self):
        # Run the actual watcher synchronously; replace only time and host queue boundaries.
        def inline_thread(target, **kwargs):
            return SimpleNamespace(start=target)
        for fail_history in (False, True):
            isolate()
            task, step = self.run_step()
            queue = mock.Mock()
            queue.get_history.side_effect = OSError("unavailable")
            with mock.patch.object(ai_task_runs.threading, "Thread", side_effect=inline_thread), \
                    mock.patch.object(ai_task_runs, "_queue", return_value=queue), \
                    mock.patch.object(ai_tasks, "RUN_WATCH_SECONDS", 60 if fail_history else 0):
                ai_task_runs.watch(step, {"prompt_ids": ["mine"]})
            status = ai_task_runs.status("A")
            self.assertEqual(status["state"], "stopped")
            self.assertIn("history" if fail_history else "timed out", status["error"])

    def test_batch_progress_keeps_total_and_current_index(self):
        task, step = self.run_step()
        queue = Queue(running=[(2, "two")])
        with mock.patch.object(ai_task_runs, "_queue", return_value=queue), mock.patch.object(ai_task_runs, "_registry", return_value=None):
            self.assertEqual(ai_task_runs.progress_of(["one", "two"]), {"state": "running", "prompt": 2, "prompts": 2})

    def test_two_tasks_collect_only_their_receipts_and_keep_batch_order(self):
        def record(filename):
            return {"status": {"completed": True}, "outputs": {"1": {"images": [{"filename": filename, "type": "output"}]}}}
        history = {pid: record(pid + ".png") for pid in ("z-first", "a-second", "other-ai", "manual")}
        queue = mock.Mock()
        queue.get_history.side_effect = lambda prompt_id: {prompt_id: history[prompt_id]}
        with mock.patch.object(ai_task_runs.threading, "Thread", side_effect=lambda target, **kw: SimpleNamespace(start=target)), \
                mock.patch.object(ai_task_runs, "_queue", return_value=queue):
            task, step = self.run_step()
            ai_task_runs.watch(step, {"prompt_ids": ["z-first", "a-second"]})
            second = ai_tasks.begin_task("B", "other")["id"]
            other = ai_tasks.record("B", "run_workflow", {}, ok({}), time.time())
            ai_task_runs.watch(other["id"], {"prompt_ids": ["other-ai"], "submission_error": "Only 1 of 2 prompts accepted"})
        self.assertEqual(ai_task_runs.status("A")["pictures"], ["z-first.png", "a-second.png"])
        self.assertEqual(ai_task_runs.status("B")["pictures"], ["other-ai.png"])
        self.assertEqual(ai_task_runs.status("B")["state"], "error")
        self.assertNotIn(mock.call(prompt_id="manual"), queue.get_history.call_args_list)


class NewsTests(unittest.TestCase):
    """The AI hears where its run stands in its other answers, and once that it ended."""

    def setUp(self):
        isolate()
        self.step = ai_tasks.record("A", "run_workflow", {}, ok({"queued": 1}), time.time())
        self.task = ai_tasks.active_task_id("A")
        with ai_tasks._lock:
            task = ai_tasks._load()[self.task]
            task["steps"][-1]["prompt_ids"] = ["p1"]
            ai_tasks._save(task)

    def told(self):
        return ai_task_runs.tell({"content": [{"type": "text", "text": "{}"}], "structuredContent": {"n": 1}}, self.task)

    def test_while_it_goes_every_answer_says_where_it_stands(self):
        with mock.patch.object(ai_tasks, "_notify"):
            ai_task_runs._show_progress(self.task, self.step["id"], {"state": "running", "prompt": 1, "prompts": 1, "node": "KSampler",
                                                                     "value": 14, "max": 28, "percent": 50, "nodes_done": 3, "nodes": 9})
        for _ in range(2):
            result = self.told()
            run = result["structuredContent"]["your_run"]
            self.assertEqual((run["state"], run["progress"]["percent"]), ("running", 50))
            self.assertIn("KSampler step 14/28, 50%, 3 of 9 nodes done", run["summary"])
            self.assertIn("your_run", result["content"][0]["text"], "the text says it too")
            self.assertEqual(result["structuredContent"]["n"], 1, "the tool's own answer stays")

    def test_the_end_is_told_once(self):
        history = {"p1": {"status": {"completed": True}, "outputs": {"9": {"images": [{"filename": "a.png", "type": "output"}]}}}}
        with mock.patch.object(ai_tasks, "_notify"):
            ai_task_runs._finish_run(self.task, self.step["id"], ["p1"], history)
        self.assertIn("finished", self.told()["structuredContent"]["your_run"]["summary"])
        self.assertNotIn("your_run", self.told()["structuredContent"])

    def test_run_status_telling_the_end_is_enough(self):
        with mock.patch.object(ai_tasks, "_notify"):
            ai_task_runs._finish_run(self.task, self.step["id"], ["p1"], {"p1": {"status": {"completed": True}}})
        self.assertIn("finished", ai_task_runs.status("A")["summary"])
        self.assertNotIn("your_run", self.told()["structuredContent"])

    def test_no_run_no_news(self):
        ai_tasks.begin_task("A", "other", new_task=True)
        self.assertIsNone(ai_task_runs.news(ai_tasks.active_task_id("A")))


if __name__ == "__main__":
    unittest.main()
