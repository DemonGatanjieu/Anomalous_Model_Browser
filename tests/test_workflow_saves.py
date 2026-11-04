"""Saves of a workflow (api/workflow_saves.py): they last, a group is found by its key or its file, its
runs' pictures come from ComfyUI's history, and nothing goes except by the user, to the Recycle Bin."""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import workflow_saves  # noqa: E402

KEY = "aaaaaaaa-1111"
WORKFLOW = {"nodes": [], "extra": {"anomalous_saves": KEY}}


class FakeQueue:
    def __init__(self):
        self.history = {}
        self.pending = []

    def get_current_queue(self):
        return [], [(number, prompt_id) for number, prompt_id in enumerate(self.pending)]

    def get_history(self, prompt_id=None):
        return {prompt_id: self.history[prompt_id]} if prompt_id in self.history else {}


def picture(name, kind="output"):
    return {"filename": name, "subfolder": "", "type": kind}


class SavesTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(os.path.realpath(temp.name))
        self.output = self.root / "output"
        self.output.mkdir()
        self.queue = FakeQueue()
        self.trashed = []
        for patcher in (
            mock.patch.object(workflow_saves, "saves_dir", return_value=str(self.root / "saves")),
            mock.patch.object(workflow_saves, "_queue", return_value=self.queue),
            mock.patch.object(workflow_saves, "move_to_trash", side_effect=self.trash),
            mock.patch.object(workflow_saves.folder_paths, "get_directory_by_type", return_value=str(self.output)),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def trash(self, *paths):
        for path in paths:
            self.trashed.append(path)
            if os.path.isfile(path):
                os.remove(path)

    def add(self, key=KEY, title="tab", path=""):
        return workflow_saves.add_save(key, WORKFLOW, title, path, [])

    def test_a_save_lasts_with_its_whole_workflow(self):
        group = workflow_saves.add_save(KEY, WORKFLOW, "tab", "", [{"kind": "changed", "widget": "steps"}])
        save = group["saves"][0]
        self.assertEqual((save["count"], save["pictures"], save["running"]), (1, [], 0))
        self.assertEqual(save["changes"], [{"kind": "changed", "widget": "steps"}])
        self.assertEqual(workflow_saves.read_group(KEY)["saves"][0]["id"], save["id"])
        self.assertEqual(workflow_saves.read_workflow(KEY, save["id"]), WORKFLOW)

    def test_a_group_is_found_by_key_or_by_its_file(self):
        self.add(path="workflows/a.json")
        self.assertIsNone(workflow_saves.read_group("bbbbbbbb-2222"))
        self.assertIsNone(workflow_saves.read_group("", "workflows/other.json"))
        self.assertEqual(workflow_saves.read_group("", "workflows/a.json")["key"], KEY)
        self.assertEqual(workflow_saves.read_group("bbbbbbbb-2222", "workflows/a.json")["key"], KEY, "a key with no group: its file's")

    def test_a_group_stops_at_the_most_it_takes_and_drops_nothing(self):
        with mock.patch.object(workflow_saves, "MAX_SAVES", 2):
            self.add()
            self.add()
            with self.assertRaises(workflow_saves.SavesFull):
                self.add()
        self.assertEqual(len(workflow_saves.read_group(KEY)["saves"]), 2)

    def test_pictures_come_from_the_history_once_a_run_is_done(self):
        save = self.add()["saves"][0]
        self.queue.pending = ["run1", "run2"]
        workflow_saves.note_runs(KEY, save["id"], ["run1", "run2"])
        self.assertEqual(workflow_saves.read_group(KEY)["saves"][0]["running"], 2)
        (self.output / "a.png").write_bytes(b"x")
        self.queue.pending = ["run2"]
        self.queue.history["run1"] = {"outputs": {"9": {"images": [picture("a.png"), picture("preview.png", "temp"), picture("clip.mp4")]}}}
        shown = workflow_saves.read_group(KEY)["saves"][0]
        self.assertEqual((shown["running"], shown["pictures"]), (1, [picture("a.png")]), "what it saved, not its previews")
        self.queue.pending = []
        self.queue.history["run2"] = {"outputs": {"9": {"images": [picture("a.png")]}}}
        shown = workflow_saves.read_group(KEY)["saves"][0]
        self.assertEqual((shown["running"], shown["pictures"]), (0, [picture("a.png")]), "a run from the cache adds no second one")

    def test_a_run_that_saved_nothing_shows_its_previews(self):
        save = self.add()["saves"][0]
        workflow_saves.note_runs(KEY, save["id"], ["run1"])
        (self.output / "preview.png").write_bytes(b"x")
        self.queue.history["run1"] = {"outputs": {"9": {"images": [picture("preview.png", "temp")]}}}
        self.assertEqual(workflow_saves.read_group(KEY)["saves"][0]["pictures"], [picture("preview.png", "temp")])

    def test_a_picture_gone_is_not_shown_and_a_run_off_the_queue_is_forgotten(self):
        save = self.add()["saves"][0]
        self.queue.pending = ["run1", "lost"]
        workflow_saves.note_runs(KEY, save["id"], ["run1", "lost"])
        self.assertEqual(workflow_saves.read_group(KEY)["saves"][0]["running"], 2, "on the queue: still to come")
        self.queue.pending = []
        (self.output / "a.png").write_bytes(b"x")
        self.queue.history["run1"] = {"outputs": {"9": {"images": [picture("a.png")]}}}
        shown = workflow_saves.read_group(KEY)["saves"][0]
        self.assertEqual((shown["running"], len(shown["pictures"])), (0, 1), "taken off the queue, it made nothing")
        (self.output / "a.png").unlink()
        self.assertEqual(workflow_saves.read_group(KEY)["saves"][0]["pictures"], [])

    def test_a_save_goes_to_the_recycle_bin_and_the_last_takes_the_group(self):
        first = self.add()["saves"][0]
        second = self.add()["saves"][1]
        group = workflow_saves.remove_save(KEY, first["id"])
        self.assertEqual([save["id"] for save in group["saves"]], [second["id"]])
        self.assertTrue(self.trashed[0].endswith(f"{first['id']}.json"))
        self.assertIsNone(workflow_saves.remove_save(KEY, second["id"]))
        self.assertIsNone(workflow_saves.read_group(KEY))
        self.assertFalse((self.root / "saves" / KEY).exists())

    def test_the_save_after_a_removed_one_says_what_it_changes_now(self):
        self.add()
        middle = self.add()["saves"][1]
        third = self.add()["saves"][2]
        changes = [{"kind": "changed", "node": "n", "widget": "w", "before": 1, "after": 3}]
        group = workflow_saves.remove_save(KEY, middle["id"], changes)
        self.assertEqual(group["saves"][1]["id"], third["id"])
        self.assertEqual(group["saves"][1]["changes"], changes)

    def test_a_save_stays_when_the_recycle_bin_says_no(self):
        save = self.add()["saves"][0]
        with mock.patch.object(workflow_saves, "move_to_trash", side_effect=workflow_saves.TrashUnavailable("no bin")):
            with self.assertRaises(workflow_saves.TrashUnavailable):
                workflow_saves.remove_save(KEY, save["id"])
        self.assertEqual(len(workflow_saves.read_group(KEY)["saves"]), 1)

    def test_a_whole_group_goes_together(self):
        self.add()
        workflow_saves.remove_group(KEY)
        self.assertTrue(self.trashed[0].endswith(KEY))
        with self.assertRaises(LookupError):
            workflow_saves.remove_group("bbbbbbbb-2222")

    def test_the_list_says_the_newest_group_first_with_its_newest_picture(self):
        save = self.add(title="old")["saves"][0]
        workflow_saves.note_runs(KEY, save["id"], ["run1"])
        (self.output / "a.png").write_bytes(b"x")
        self.queue.history["run1"] = {"outputs": {"9": {"images": [picture("a.png")]}}}
        workflow_saves.read_group(KEY)
        time.sleep(0.01)
        self.add("bbbbbbbb-2222", title="new")
        listed = workflow_saves.list_groups()
        self.assertEqual([item["title"] for item in listed], ["new", "old"])
        self.assertEqual((listed[1]["count"], listed[1]["cover"]), (1, picture("a.png")))

    def test_names_from_the_page_never_reach_outside_the_store(self):
        for key in ("../up", "a/b", "", None):
            with self.assertRaises(ValueError):
                workflow_saves._folder(key)
        with self.assertRaises(ValueError):
            workflow_saves.read_workflow(KEY, "../index")
        self.assertFalse(workflow_saves._there({"type": "output", "subfolder": "..", "filename": "secret.png"}))

    def test_runs_of_a_save_stay_in_range(self):
        save = self.add()["saves"][0]
        self.assertEqual(workflow_saves.set_count(KEY, save["id"], 99)["saves"][0]["count"], workflow_saves.MAX_RUNS)
        self.assertEqual(workflow_saves.set_count(KEY, save["id"], 0)["saves"][0]["count"], 1)
        with self.assertRaises(LookupError):
            workflow_saves.set_count(KEY, "000000000000", 2)


if __name__ == "__main__":
    unittest.main()
