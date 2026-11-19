"""The quick search's model list in a few words (api/quick_index.py)."""

from pathlib import Path
import sys
import unittest

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import quick_index


def model(**fields):
    base = {"type": "loras", "path_idx": 0, "subfolder": "chars", "filename": "a.safetensors",
            "size_bytes": 10, "preview_url": "/anomalous/image?x", "metadata": {}}
    base.update(fields)
    return base


class CompactModelsTest(unittest.TestCase):
    def test_names_base_and_words(self):
        found = quick_index.compact_models([model(metadata={
            "custom_name": " Ahri ", "name": "Ahri LoRA", "baseModel": "Illustrious",
            "trainedWords": ["ahri", "fox ears", "", "a", "b", "c", "d", "e"], "description": "long",
        })])
        self.assertEqual(found, [{
            "type": "loras", "path_idx": 0, "subfolder": "chars", "filename": "a.safetensors",
            "name": "Ahri", "civitai_name": "Ahri LoRA", "base": "Illustrious", "base_guess": "", "page": 0, "version": 0, "version_name": "",
            "words": ["ahri", "fox ears", "a", "b", "c", "d"], "preview_url": "/anomalous/image?x", "ai_name": "",
        }])

    def test_one_line_per_file_and_no_node_pack_files(self):
        found = quick_index.compact_models([
            model(type="unet", subfolder="", filename="flux.safetensors"),
            model(type="diffusion_models", subfolder="", filename="flux.safetensors"),
            model(type="custom_nodes", filename="pack.pt"),
            model(metadata={"trigger_words": "one word"}),
        ])
        self.assertEqual([item["type"] for item in found], ["unet", "loras"])
        self.assertEqual(found[1]["words"], ["one word"])

    def test_scan_state_only_when_asked(self):
        scanned = model(metadata={"info_source": "civitai", "unmatched_reason": "", "scan_choice": "", "not_drawing": False})
        self.assertNotIn("scan", quick_index.compact_models([scanned])[0])
        self.assertEqual(quick_index.compact_models([scanned], scan_state=True)[0]["scan"],
                         {"info_source": "civitai", "unmatched_reason": "", "scan_choice": "", "not_drawing": False})


if __name__ == "__main__":
    unittest.main()
