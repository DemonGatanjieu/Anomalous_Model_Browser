"""The examples Anomalous ships (api/example_workflows.py): ComfyUI's own nodes only, no model or picture
of any machine in the files, filled in from what is here, and reachable by an AI when no saved workflow fits."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import example_workflows as examples, mcp_fill, mcp_tools  # noqa: E402

OWN_NODES = {"CheckpointLoaderSimple", "CLIPTextEncode", "EmptyLatentImage", "KSampler", "VAEDecode", "VAEEncode",
             "SaveImage", "LoadImage", "LatentUpscaleBy", "SetLatentNoiseMask"}


class ExampleTests(unittest.TestCase):
    def test_the_files_use_own_nodes_and_name_nothing_of_a_machine(self):
        self.assertEqual(set(examples.EXAMPLES), {"text_to_picture", "two_pass", "picture_to_picture", "repaint"})
        for key, example in examples.EXAMPLES.items():
            nodes = example["workflow"]["nodes"]
            self.assertLessEqual({node["type"] for node in nodes}, OWN_NODES, key)
            for node in nodes:
                if node["type"] in ("CheckpointLoaderSimple", "LoadImage"):
                    self.assertEqual(node["widgets_values"][0], "", key)
            self.assertTrue(example["title"]["zh"] and example["title"]["en"] and example["about"]["zh"] and example["about"]["en"] and example["ai"], key)
            text = json.dumps(example)
            for mark in (".safetensors", ".ckpt", ".png", ".jpg", ".webp", "widgets_values_named"):
                self.assertNotIn(mark, text, key)

    def test_every_link_joins_nodes_that_are_there(self):
        for key, example in examples.EXAMPLES.items():
            ids = {node["id"] for node in example["workflow"]["nodes"]}
            for link in example["workflow"]["links"]:
                self.assertLessEqual({link[1], link[3]}, ids, key)

    def test_read_fills_in_what_is_here(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "a.png").write_bytes(b"x")
            with mock.patch.object(examples, "_checkpoint", return_value="mine.safetensors"), \
                    mock.patch.object(examples.folder_paths, "get_input_directory", return_value=folder, create=True):
                data = examples.read("repaint")
        values = {node["type"]: node["widgets_values"][0] for node in data["workflow"]["nodes"] if node["type"] in ("CheckpointLoaderSimple", "LoadImage")}
        self.assertEqual(values, {"CheckpointLoaderSimple": "mine.safetensors", "LoadImage": "a.png"})
        self.assertFalse(data["lacks_model"])
        self.assertEqual(next(node for node in examples.EXAMPLES["repaint"]["workflow"]["nodes"] if node["type"] == "LoadImage")["widgets_values"][0], "", "the shipped one stays blank")
        self.assertIsNone(examples.read("nothing"))

    def test_read_says_when_there_is_no_model(self):
        with mock.patch.object(examples, "_checkpoint", return_value=""), mock.patch.object(examples, "_picture", return_value=""):
            self.assertTrue(examples.read("text_to_picture")["lacks_model"])

    def test_a_checkpoint_the_settings_suit_comes_first(self):
        from api import model_advice
        names = ["flux.safetensors", "xl.safetensors"]
        with mock.patch.object(examples.folder_paths, "get_filename_list", return_value=names, create=True), \
                mock.patch.object(examples.folder_paths, "get_full_path", side_effect=lambda _kind, name: name, create=True), \
                mock.patch.object(model_advice, "base_of", side_effect=lambda path: "SDXL 1.0" if path.startswith("xl") else "Flux.1 D"):
            self.assertEqual(examples._checkpoint(), "xl.safetensors")
        with mock.patch.object(examples.folder_paths, "get_filename_list", return_value=[], create=True):
            self.assertEqual(examples._checkpoint(), "")

    def test_an_ai_gets_them_when_no_saved_workflow_fits(self):
        with mock.patch.object(mcp_tools, "_list_recipes", return_value=[]), mock.patch.object(mcp_tools, "plans", return_value={}), \
                mock.patch.object(mcp_tools, "get_recipes_dir", return_value=""):
            listed = mcp_tools.list_workflows()
            found = mcp_tools.list_workflows("repaint")
        self.assertEqual(listed["total_matches"], 4)
        self.assertTrue(all(item["example"] for item in listed["workflows"]))
        self.assertEqual([item["name"] for item in found["workflows"]], ["Example: repaint an area"])

    def test_saved_workflows_come_instead_of_them(self):
        recipe = {"filename": "recipe_1.json", "data": {"name": "Mine"}}
        with mock.patch.object(mcp_tools, "_list_recipes", return_value=[recipe]), mock.patch.object(mcp_tools, "plans", return_value={}), \
                mock.patch.object(mcp_tools, "get_recipes_dir", return_value=""):
            self.assertEqual([item["name"] for item in mcp_tools.list_workflows()["workflows"]], ["Mine"])

    def test_they_open_by_name_but_a_saved_one_of_that_name_wins(self):
        name = "Example: two passes"
        with mock.patch("api.recipe_store._list_recipes", return_value=[]), mock.patch("api.recipe_store.get_recipes_dir", return_value=""):
            self.assertEqual(mcp_fill.saved_workflow(name), ("example:two_pass", name, None))
        recipe = {"filename": "recipe_1.json", "data": {"name": name}}
        with mock.patch("api.recipe_store._list_recipes", return_value=[recipe]), mock.patch("api.recipe_store.get_recipes_dir", return_value=""):
            self.assertEqual(mcp_fill.saved_workflow(name)[0], "recipe_1.json")


if __name__ == "__main__":
    unittest.main()
