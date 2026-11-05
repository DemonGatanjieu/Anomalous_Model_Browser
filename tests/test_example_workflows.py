"""The examples Anomalous ships (api/example_workflows.py): ComfyUI's own nodes but for what a version says it
needs, no model or picture of any machine in the files, filled in from what is here, what is missing said,
the Tile version in step with the way, and reachable by an AI when no saved workflow fits."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import example_workflows as examples, mcp_fill, mcp_tools, reference_blocks  # noqa: E402

OWN_NODES = {"CheckpointLoaderSimple", "UNETLoader", "CLIPLoader", "VAELoader", "CLIPTextEncode", "EmptyLatentImage", "KSampler", "VAEDecode",
             "VAEEncode", "VAEEncodeTiled", "VAEDecodeTiled", "SaveImage", "LoadImage", "LatentUpscaleBy", "SetLatentNoiseMask"}
FILES = ("CheckpointLoaderSimple", "UNETLoader", "CLIPLoader", "VAELoader", "AnimaLLLiteApply_sdscripts", "LoadImage")
EVERYTHING = {"CheckpointLoaderSimple": "xl.safetensors", "UNETLoader": "anima.safetensors", "CLIPLoader": "qwen.safetensors",
              "VAELoader": "vae.safetensors", "AnimaLLLiteApply_sdscripts": "tile.safetensors", "LoadImage": "a.png"}
ALL_HERE = {kind: {} for kind in examples.LOADERS}


class ExampleTests(unittest.TestCase):
    def test_the_files_use_own_nodes_and_name_nothing_of_a_machine(self):
        self.assertEqual(tuple(examples.EXAMPLES), examples.ORDER)
        for key, example in examples.EXAMPLES.items():
            nodes = example["workflow"]["nodes"]
            self.assertLessEqual({node["type"] for node in nodes}, OWN_NODES | set(example.get("packs") or {}), key)
            for node in nodes:
                if node["type"] in FILES:
                    self.assertEqual(node["widgets_values"][0], "", key)
            for field in ("title", "version", "about"):
                self.assertTrue(example[field]["zh"] and example[field]["en"], (key, field))
            self.assertTrue(example["ai"] and example["family"] in examples.FAMILIES, key)
            text = json.dumps(example)
            for mark in (".safetensors", ".ckpt", ".png", ".jpg", ".webp", "widgets_values_named"):
                self.assertNotIn(mark, text, key)

    def test_every_link_joins_nodes_that_are_there(self):
        for key, example in examples.EXAMPLES.items():
            ids = {node["id"] for node in example["workflow"]["nodes"]}
            for link in example["workflow"]["links"]:
                self.assertLessEqual({link[1], link[3]}, ids, key)

    def test_the_tile_version_is_the_way_on_anima(self):
        way = reference_blocks.BLOCKS["upscale_tile"]["variants"]["anima"]["nodes"]
        nodes = examples.EXAMPLES["two_pass_anima_tile"]["workflow"]["nodes"]
        of = lambda kind: [node for node in nodes if node["type"] == kind]  # noqa: E731
        tile = of("AnimaLLLiteApply_sdscripts")[0]["widgets_values"]
        self.assertEqual((tile[1], tile[2], tile[3], tile[4]), tuple(way["tile"]["inputs"][name] for name in ("strength", "start_percent", "end_percent", "preserve_wrapper")))
        self.assertEqual(of("LatentUpscaleBy")[0]["widgets_values"], [way["enlarge"]["inputs"]["upscale_method"], way["enlarge"]["inputs"]["scale_by"]])
        redraw = of("KSampler")[1]["widgets_values"]  # seed, after, steps, cfg, sampler, scheduler, denoise
        self.assertEqual(redraw[2:], [way["redraw"]["inputs"][name] for name in ("steps", "cfg", "sampler_name", "scheduler", "denoise")])

    def test_read_fills_in_what_is_here(self):
        with mock.patch.object(examples, "_here", return_value=ALL_HERE), mock.patch.object(examples, "_fills", return_value=EVERYTHING):
            data = examples.read("two_pass_anima_tile")
        values = {node["type"]: node["widgets_values"][0] for node in data["workflow"]["nodes"] if node["type"] in FILES}
        self.assertEqual(values, {kind: EVERYTHING[kind] for kind in ("UNETLoader", "CLIPLoader", "VAELoader", "AnimaLLLiteApply_sdscripts")})
        shipped = next(node for node in examples.EXAMPLES["two_pass_anima_tile"]["workflow"]["nodes"] if node["type"] == "UNETLoader")
        self.assertEqual(shipped["widgets_values"][0], "", "the shipped one stays blank")
        with mock.patch.object(examples, "_here", return_value=ALL_HERE), mock.patch.object(examples, "_fills", return_value=EVERYTHING):
            self.assertIsNone(examples.read("nothing"))

    def test_the_picture_taken_is_comfyuis_own_else_the_first(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "b.png").write_bytes(b"x")
            Path(folder, "note.txt").write_bytes(b"x")
            with mock.patch.object(examples.folder_paths, "get_input_directory", return_value=folder, create=True):
                self.assertEqual(examples._picture(), "b.png")
                Path(folder, "example.png").write_bytes(b"x")
                self.assertEqual(examples._picture(), "example.png")

    def test_a_model_of_the_family_comes_first(self):
        from api import model_advice
        info = {"CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [["flux.safetensors", "xl.safetensors"]]}}}}
        with mock.patch.object(model_advice, "_main_base", side_effect=lambda name: "SDXL 1.0" if name.startswith("xl") else "Flux.1 D"):
            self.assertEqual(examples._model(info, "CheckpointLoaderSimple", "ckpt_name", "sd"), "xl.safetensors")
            self.assertEqual(examples._model(info, "CheckpointLoaderSimple", "ckpt_name", "anima"), "")

    def test_what_a_version_lacks_is_said(self):
        tile = examples.EXAMPLES["two_pass_anima_tile"]
        self.assertEqual(examples._lacks(tile, ALL_HERE, EVERYTHING), [])
        no_pack = {kind: {} for kind in examples.LOADERS if kind != "AnimaLLLiteApply_sdscripts"}
        self.assertEqual(examples._lacks(tile, no_pack, EVERYTHING), [{"pack": "ComfyUI-Anima-LLLite"}])
        self.assertEqual(examples._lacks(tile, ALL_HERE, {**EVERYTHING, "AnimaLLLiteApply_sdscripts": ""}), [{"model": "AnimaLLLiteApply_sdscripts"}])
        self.assertEqual(examples._lacks(examples.EXAMPLES["text_to_picture"], ALL_HERE, {**EVERYTHING, "UNETLoader": ""}), [], "not its loader")
        self.assertEqual(examples._lacks(examples.EXAMPLES["text_to_picture"], ALL_HERE, {**EVERYTHING, "CheckpointLoaderSimple": ""}), [{"model": "CheckpointLoaderSimple"}])

    def listed(self, query="", recipes=(), fills=EVERYTHING):
        with mock.patch.object(mcp_tools, "_list_recipes", return_value=list(recipes)), mock.patch.object(mcp_tools, "plans", return_value={}), \
                mock.patch.object(mcp_tools, "get_recipes_dir", return_value=""), mock.patch.object(examples, "_here", return_value=ALL_HERE), \
                mock.patch.object(examples, "_fills", return_value=fills):
            return mcp_tools.list_workflows(query)

    def test_an_ai_gets_those_that_can_run_when_no_saved_workflow_fits(self):
        listed = self.listed()
        self.assertEqual(listed["total_matches"], len(examples.ORDER))
        self.assertTrue(all(item["example"] and item["for_models"] for item in listed["workflows"]))
        self.assertEqual([item["name"] for item in self.listed("repaint")["workflows"]], ["Example: repaint an area"])
        names = [item["name"] for item in self.listed(fills={**EVERYTHING, "UNETLoader": ""})["workflows"]]
        self.assertFalse([name for name in names if "Anima" in name], "no Anima model here")

    def test_saved_workflows_come_instead_of_them(self):
        recipe = {"filename": "recipe_1.json", "data": {"name": "Mine"}}
        self.assertEqual([item["name"] for item in self.listed(recipes=[recipe])["workflows"]], ["Mine"])

    def test_they_open_by_name_but_a_saved_one_of_that_name_wins(self):
        name = "Example: two passes"
        with mock.patch("api.recipe_store._list_recipes", return_value=[]), mock.patch("api.recipe_store.get_recipes_dir", return_value=""):
            self.assertEqual(mcp_fill.saved_workflow(name), ("example:two_pass", name, None))
        recipe = {"filename": "recipe_1.json", "data": {"name": name}}
        with mock.patch("api.recipe_store._list_recipes", return_value=[recipe]), mock.patch("api.recipe_store.get_recipes_dir", return_value=""):
            self.assertEqual(mcp_fill.saved_workflow(name)[0], "recipe_1.json")


if __name__ == "__main__":
    unittest.main()
