"""What changed outside Anomalous while an AI works (api/ai_outside.py): pictures no run saved and
pictures rewritten in place, found when the AI calls, told once; and the AI's own word on what it
did with other tools. Pictures go to temporary folders; their times are set by the test."""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_outside, ai_tasks, mcp_task_tools  # noqa: E402
from test_ai_tasks import isolate, ok  # noqa: E402


class OutsideTests(unittest.TestCase):
    def setUp(self):
        isolate()
        ai_outside._watched.clear()
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.dirs = {name: Path(os.path.realpath(temp.name)) / name for name in ("output", "input")}
        for path in self.dirs.values():
            path.mkdir()
        self.times, self.saved, self.busy = {}, set(), False
        for patcher in (
            mock.patch.object(ai_outside.folder_paths, "get_output_directory", return_value=str(self.dirs["output"])),
            mock.patch.object(ai_outside.folder_paths, "get_input_directory", return_value=str(self.dirs["input"])),
            mock.patch.object(ai_outside, "_times", side_effect=lambda entry: self.times[entry.name]),
            mock.patch.object(ai_outside, "_saved_by_runs", side_effect=lambda: set(self.saved)),
            mock.patch.object(ai_outside, "_busy", side_effect=lambda: self.busy),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        ai_tasks.record("Gemini", "describe_canvas", {}, ok({}), time.time(), True)
        self.task = ai_tasks.list_tasks()[0]["id"]

    def picture(self, folder, name, made, changed):
        (self.dirs[folder] / name).write_bytes(b"x")
        self.times[name] = (made, changed)

    def found(self, now):
        step = ai_outside.check(self.task, now=now)
        return step and {(item["folder"], item["name"], item["change"]) for item in step["files"]}

    def test_new_and_rewritten_pictures_not_a_runs_nor_an_upload(self):
        self.assertIsNone(ai_outside.check(self.task, now=100))  # the task's first call only starts the watch
        self.picture("output", "script.png", 150, 150)  # no run saved it
        self.picture("output", "run_00001_.png", 150, 151)
        self.saved = {"run_00001_.png"}
        self.picture("output", "old.png", 10, 160)  # rewritten in place
        self.picture("output", "notes.txt", 150, 150)  # not a picture
        self.picture("output", "before.png", 10, 20)  # unchanged
        self.picture("input", "upload.png", 150, 150)  # new in the input folder: an upload looks the same
        self.picture("input", "mask.png", 10, 170)
        self.assertEqual(self.found(200), {("output", "script.png", "new"), ("output", "old.png", "rewritten"),
                                           ("input", "mask.png", "rewritten")})
        step = ai_tasks.get_task(self.task)["steps"][-1]
        self.assertEqual((step["tool"], step["kind"], step["results"]), ("outside_files", "outside", []))  # no results: not the task's pictures
        self.assertIsNone(ai_outside.check(self.task, now=300))  # told once
        self.picture("output", "late.png", 10, 352)  # its change time ahead of the clock read at 350
        self.assertEqual(self.found(350), {("output", "late.png", "rewritten")})
        self.assertIsNone(ai_outside.check(self.task, now=351))  # still after this check's start: not told again
        self.times["old.png"] = (10, 380)
        self.assertEqual(self.found(400), {("output", "old.png", "rewritten")})  # rewritten again

    def test_new_pictures_wait_while_a_prompt_runs(self):
        ai_outside.check(self.task, now=100)
        self.busy = True
        self.picture("output", "maybe_the_runs.png", 150, 150)
        self.picture("output", "old.png", 10, 160)
        self.assertEqual(self.found(200), {("output", "old.png", "rewritten")})
        self.busy = False
        self.assertEqual(self.found(300), {("output", "maybe_the_runs.png", "new")})  # no run saved it after all; old.png told already

    def test_without_a_creation_time_output_only(self):
        ai_outside.check(self.task, now=100)
        self.picture("output", "x.png", None, 150)
        self.picture("input", "y.png", None, 150)
        self.assertEqual(self.found(200), {("output", "x.png", "changed")})
        self.assertIsNone(ai_outside.check(None))

    def test_the_ai_is_told(self):
        step = {"files": [{"folder": "output", "name": "old.png", "change": "rewritten"}]}
        told = ai_outside.tell(ok({"done": True}), step)
        self.assertEqual(told["structuredContent"]["outside_changes"], ["output/old.png (rewritten)"])
        self.assertIn("log_outside", json.loads(told["content"][0]["text"])["outside_note"])
        failed = ai_outside.tell({"content": [{"type": "text", "text": "boom"}], "isError": True}, step)
        self.assertEqual(failed["content"][0]["text"], "boom")
        self.assertIn("output/old.png", failed["content"][-1]["text"])
        self.assertNotIn("outside_note", ai_outside.tell(ok({}), None)["structuredContent"])

    def test_the_ais_own_word(self):
        answer = mcp_task_tools.log_outside({"client": "Gemini"}, "python crop.py", "to cut out the hand", ["output/a.png", " "])
        step = ai_tasks.get_task(self.task)["steps"][-1]
        self.assertEqual(answer["step"], step["id"])
        self.assertEqual((step["tool"], step["kind"], step["what"], step["why"], step["files"]),
                         ("log_outside", "outside", "python crop.py", "to cut out the hand", ["output/a.png"]))
        self.assertEqual(ai_tasks.list_tasks()[0]["kinds"]["outside"], 1)
        for what in ("  ", "x" * 301):
            with self.assertRaises(mcp_task_tools.ToolError):
                mcp_task_tools.log_outside({"client": "Gemini"}, what)
        with self.assertRaises(mcp_task_tools.ToolError):
            mcp_task_tools.log_outside({"client": "Gemini"}, "x", files="a.png")


if __name__ == "__main__":
    unittest.main()
