"""Combos as Current node reads them (api/notebooks.py): a structure's nodes by type with what their slots hold now,
a plain combo's prompt on a text box, nothing for another type."""
import sys
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api.notebooks import _combo_nodes  # noqa: E402

STRUCTURED = {"kind": "nodes", "values": {"s1": "a lake", "s2": "blurry", "s3": "m.safetensors"}, "structure": {
    "nodes": [{"key": "n1", "type": "CLIPTextEncode", "title": "", "widgets": [["text", "old words"]]},
              {"key": "n2", "type": "CLIPTextEncode", "title": "Bad", "widgets": [["text", "old bad"]]},
              {"key": "n3", "type": "KSampler", "widgets": [["steps", 20], ["cfg", 5]]},
              {"key": "n4", "type": "Power Lora Loader (rgthree)", "widgets": [["PowerLoraLoaderHeaderWidget", {}]]}],
    "slots": [{"id": "s1", "node": "n1", "widget": "text", "kind": "text", "role": "positive"},
              {"id": "s2", "node": "n2", "widget": "text", "kind": "text", "role": "negative"},
              {"id": "s3", "node": "n4", "widget": "lora_1", "kind": "model", "field": "lora"}]}}


class ComboNodesTests(unittest.TestCase):
    def test_a_structure_gives_its_nodes_with_what_the_slots_hold_now(self):
        self.assertEqual(_combo_nodes(STRUCTURED, "CLIPTextEncode"), [
            {"title": "", "role": "positive", "values": {"text": "a lake"}},
            {"title": "Bad", "role": "negative", "values": {"text": "blurry"}}])
        self.assertEqual(_combo_nodes(STRUCTURED, "KSampler"), [{"title": "", "role": "", "values": {"steps": 20, "cfg": 5}}])

    def test_a_row_slot_is_no_box_of_the_node(self):
        self.assertEqual(_combo_nodes(STRUCTURED, "Power Lora Loader (rgthree)")[0]["values"], {"PowerLoraLoaderHeaderWidget": {}})

    def test_a_plain_combo_has_only_its_prompt(self):
        plain = {"promptEn": " a lake ", "mainModel": {}}
        self.assertEqual(_combo_nodes(plain, "CLIPTextEncode"), [{"title": "", "role": "positive", "values": {"text": "a lake"}}])
        self.assertEqual(_combo_nodes(plain, "KSampler"), [])
        self.assertEqual(_combo_nodes({"promptEn": ""}, "CLIPTextEncode"), [])

    def test_a_node_type_it_does_not_hold(self):
        self.assertEqual(_combo_nodes(STRUCTURED, "VAEDecode"), [])


if __name__ == "__main__":
    unittest.main()
