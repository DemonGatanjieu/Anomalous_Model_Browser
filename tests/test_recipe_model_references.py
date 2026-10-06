from pathlib import Path
import sys
import unittest
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import recipe_schema


class RecipeModelReferenceTests(unittest.TestCase):
    def _references(self, nodes):
        with mock.patch.object(recipe_schema, '_identity_for_reference', return_value=({"status": "unavailable"}, None)):
            return recipe_schema._build_model_references({"workflow": {"nodes": nodes}, "params": {}})

    def test_all_in_one_loaders_use_verified_layouts_and_skip_placeholders(self):
        refs = self._references([
            {"id": 1, "type": "easy a1111Loader", "widgets_values": ["base.safetensors", "Baked VAE", -2, "style.safetensors"]},
            {"id": 2, "type": "easy fullLoader", "widgets_values": ["full.safetensors", "Default", "vae.safetensors", -2, "None"]},
        ])
        self.assertEqual(
            [(r["node_id"], r["widget_index"], r["category"], r["widget_name"], r["saved_value"]) for r in refs],
            [
                (1, 0, "checkpoint", "ckpt_name", "base.safetensors"),
                (1, 3, "lora", "lora_name", "style.safetensors"),
                (2, 0, "checkpoint", "ckpt_name", "full.safetensors"),
                (2, 2, "vae", "vae_name", "vae.safetensors"),
            ],
        )

    def test_native_labels_and_unknown_nodes_are_unchanged(self):
        refs = self._references([
            {"id": 3, "type": "CheckpointLoaderSimple", "widgets_values": ["sdxl.safetensors"]},
            {"id": 4, "type": "SomeCustomLoader", "widgets_values": ["other_vae.safetensors"]},
        ])
        self.assertEqual([(r["node_id"], r["category"], r["widget_name"]) for r in refs], [(3, "checkpoint", "checkpoint")])


if __name__ == '__main__':
    unittest.main()
