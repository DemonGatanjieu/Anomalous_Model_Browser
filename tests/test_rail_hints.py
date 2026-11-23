"""What an earlier version left on disk, for the rail to keep those pages (api/rail_hints.py): each kind
found by one file, saved prompts told from a node's saved values, and nothing created along the way."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import rail_hints  # noqa: E402

NONE = {"combos": False, "prompts": False, "ai": False, "saves": False, "assistant": False, "scan": False}


def node_material(node_type):
    return {"kind": "node_parameter_selection", "name": node_type,
            "workflow": {"nodes": [{"id": 1, "type": node_type, "widgets_values": [1]}]}}


class RailHintsTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.user = Path(os.path.realpath(temp.name))
        patch = mock.patch.object(rail_hints.folder_paths, "get_user_directory", return_value=str(self.user))
        patch.start()
        self.addCleanup(patch.stop)

    def write(self, relative, value):
        path = self.user / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding="utf-8")

    def test_a_new_user_has_nothing_and_no_folder_is_made(self):
        self.assertEqual(rail_hints.collect_rail_hints(), NONE)
        self.assertEqual(list(self.user.iterdir()), [])

    def test_empty_folders_and_hidden_files_say_nothing(self):
        for folder in ("workflows/anomalous_notebooks", "workflows/anomalous_materials", "workflows/anomalous_saves/abc", "anomalous/ai_tasks"):
            (self.user / folder).mkdir(parents=True)
        self.write("workflows/anomalous_notebooks/.legacy_imported.json", {})
        self.write("workflows/anomalous_materials/notes.txt", {})
        self.assertEqual(rail_hints.collect_rail_hints(), NONE)

    def test_node_values_are_current_node_and_saved_prompts_are_prompts(self):
        self.write("workflows/anomalous_materials/a.json", node_material("KSampler"))
        self.assertEqual(rail_hints.collect_rail_hints(), {**NONE, "assistant": True})
        self.write("workflows/anomalous_materials/b.json", {"kind": "prompt_text", "name": "p", "note": {"text": "1girl"}})
        self.assertEqual(rail_hints.collect_rail_hints(), {**NONE, "assistant": True, "prompts": True})

    def test_a_prompt_node_kept_is_a_prompt_and_a_whole_workflow_neither(self):
        self.write("workflows/anomalous_materials/a.json", node_material("CLIPTextEncode"))
        self.write("workflows/anomalous_materials/b.json", {"kind": "image_workflow_snapshot", "name": "w", "workflow": {"nodes": []}})
        self.write("workflows/anomalous_materials/c.json", ["not", "a", "material"])
        (self.user / "workflows/anomalous_materials/d.json").write_text("{broken", encoding="utf-8")
        self.assertEqual(rail_hints.collect_rail_hints(), {**NONE, "prompts": True})

    def test_materials_read_are_bounded(self):
        with mock.patch.object(rail_hints, "MAX_MATERIAL_BYTES", 10):
            self.write("workflows/anomalous_materials/a.json", node_material("KSampler"))
            self.assertEqual(rail_hints.collect_rail_hints(), NONE)
        with mock.patch.object(rail_hints, "MAX_MATERIALS", 0):
            self.assertEqual(rail_hints.collect_rail_hints(), NONE)

    def test_each_kind_is_found_by_one_file(self):
        self.write("workflows/anomalous_notebooks/combo.json", {"name": "c"})
        self.write("anomalous/ai_tasks/t1.json", {"id": "t1"})
        self.write("workflows/anomalous_saves/aaaaaaaa-1111/index.json", {"saves": []})
        self.write("anomalous/last_scan.json", {"models": []})
        self.assertEqual(rail_hints.collect_rail_hints(), {**NONE, "combos": True, "ai": True, "saves": True, "scan": True})

    def test_a_scan_page_summary_is_not_a_scan(self):
        self.write("anomalous/scan_summary.json", {"summary": {}})  # written by opening the scan page
        self.assertEqual(rail_hints.collect_rail_hints(), NONE)


if __name__ == "__main__":
    unittest.main()
