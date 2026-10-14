"""The Tidy tab's "Not used lately" (api/model_usage.py): when each model and node pack was last
used, from output images and saved workflows in temporary folders."""
import json
import os
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image
from PIL.PngImagePlugin import PngInfo

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import image_search, model_usage  # noqa: E402

DAY = 24 * 3600
NOW = 1_800_000_000.0


def output(path, when, nodes):
    """A PNG whose prompt holds `nodes` ({id: (class_type, inputs)}), dated `when`."""
    info = PngInfo()
    info.add_text("prompt", json.dumps({key: {"class_type": kind, "inputs": inputs} for key, (kind, inputs) in nodes.items()}))
    Image.new("RGB", (2, 2)).save(path, pnginfo=info)
    os.utime(path, (when, when))


class Pack:
    def __init__(self, module):
        self.RELATIVE_PYTHON_MODULE = module


class UsageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.out, self.flows, self.recipes = base / "output", base / "workflows", base / "recipes"
        for folder in (self.out / "sub", self.flows, self.recipes):
            folder.mkdir(parents=True)
        self.models = [
            {"type": "checkpoints", "root": 0, "rel": "sdxl/fresh.safetensors", "size": 6},
            {"type": "loras", "root": 0, "rel": "old.safetensors", "size": 3},
            {"type": "loras", "root": 0, "rel": "style/kept.safetensors", "size": 2},
            {"type": "loras", "root": 0, "rel": "never.safetensors", "size": 9},
            {"type": "vae", "root": 0, "rel": "hashed.safetensors", "size": 1},
        ]
        nodes = types.SimpleNamespace(NODE_CLASS_MAPPINGS={
            "KSampler": Pack("nodes"),
            "Power Lora Loader (rgthree)": Pack("custom_nodes.rgthree-comfy"),
            "easy loraStack": Pack("custom_nodes.ComfyUI-Easy-Use"),
            "easy seed": Pack("custom_nodes.ComfyUI-Easy-Use.py.nodes"),
            "Unused Thing": Pack("custom_nodes.forgotten-pack"),
        })
        patches = [
            mock.patch.object(model_usage, "library", return_value=self.models),
            mock.patch.object(model_usage, "_card", side_effect=lambda item: {"name": Path(item["rel"]).stem, "version": "", "preview_url": ""}),
            mock.patch.object(model_usage, "_known_hash", side_effect=lambda item: "AB" * 32 if item["rel"] == "hashed.safetensors" else ""),
            mock.patch.object(model_usage, "part_dirs", return_value={"comfy_workflows": str(self.flows), "recipes": str(self.recipes), "materials": str(base / "nope")}),
            mock.patch.object(model_usage.folder_paths, "get_output_directory", return_value=str(self.out)),
            mock.patch.dict(sys.modules, {"nodes": nodes}),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        image_search._record_cache.clear()
        self.addCleanup(self.temp.cleanup)

    def test_models_and_packs_by_when_they_were_last_used(self):
        output(self.out / "a.png", NOW - 2 * DAY, {"1": ("CheckpointLoaderSimple", {"ckpt_name": "sdxl\\fresh.safetensors"}),
                                                     "2": ("KSampler", {"seed": 1})})
        output(self.out / "sub" / "b.png", NOW - 100 * DAY, {"1": ("LoraLoader", {"lora_name": "old.safetensors"}),
                                                              "2": ("Power Lora Loader (rgthree)", {"lora_1": {"on": True, "lora": "old.safetensors"}})})
        output(self.out / "c.png", NOW - 40 * DAY, {"1": ("easy seed", {"seed": 2})})
        (self.flows / "portrait.json").write_text(json.dumps({"nodes": [
            {"type": "LoraLoader", "widgets_values": ["style/kept.safetensors", 1, 1]},
            {"type": "easy loraStack", "widgets_values": [True, "simple", 1]}]}), encoding="utf-8")
        (self.recipes / "r.json").write_text(json.dumps({"models": [{"sha256": "ab" * 32}]}), encoding="utf-8")

        result = model_usage.check(now=NOW)
        models = {Path(item["rel"]).stem: item for item in result["models"]}
        self.assertNotIn("fresh", models)  # used two days ago
        self.assertEqual((models["old"]["last_used"], models["old"]["outputs"], models["old"]["saved"]), (NOW - 100 * DAY, 1, 0))  # one image naming it twice
        self.assertEqual((models["kept"]["last_used"], models["kept"]["saved"]), (None, 1))  # only in a saved workflow
        self.assertEqual((models["never"]["last_used"], models["never"]["outputs"], models["never"]["saved"]), (None, 0, 0))
        self.assertEqual(models["hashed"]["saved"], 1)  # its SHA-256 is in a recipe
        self.assertEqual(result["seen"], {"outputs": 3, "saved": 2, "capped": False})

        packs = {item["name"]: item for item in result["packs"]}
        self.assertEqual(sorted(packs), ["ComfyUI-Easy-Use", "forgotten-pack", "rgthree-comfy"])  # ComfyUI's own nodes are no pack
        self.assertEqual((packs["rgthree-comfy"]["last_used"], packs["rgthree-comfy"]["outputs"]), (NOW - 100 * DAY, 1))
        self.assertEqual((packs["ComfyUI-Easy-Use"]["nodes"], packs["ComfyUI-Easy-Use"]["last_used"], packs["ComfyUI-Easy-Use"]["saved"]),
                         (2, NOW - 40 * DAY, 1))
        self.assertEqual((packs["forgotten-pack"]["last_used"], packs["forgotten-pack"]["saved"]), (None, 0))

    def test_reading_stops_at_the_limits_and_says_so(self):
        for index in range(3):
            output(self.out / f"{index}.png", NOW - DAY, {"1": ("KSampler", {})})
        with mock.patch.object(model_usage, "MAX_IMAGES", 2):
            result = model_usage.check(now=NOW)
        self.assertEqual((result["seen"]["outputs"], result["seen"]["capped"]), (2, True))

    def test_a_broken_or_huge_saved_file_is_skipped(self):
        (self.flows / "broken.json").write_text("{not json", encoding="utf-8")
        (self.flows / "ok.json").write_text(json.dumps({"x": "never.safetensors"}), encoding="utf-8")
        with mock.patch.object(model_usage, "MAX_JSON_BYTES", 40):
            (self.flows / "big.json").write_text(json.dumps({"x": "old.safetensors", "pad": "x" * 100}), encoding="utf-8")
            result = model_usage.check(now=NOW)
        models = {Path(item["rel"]).stem: item for item in result["models"]}
        self.assertEqual((models["never"]["saved"], models["old"]["saved"]), (1, 0))


if __name__ == "__main__":
    unittest.main()
