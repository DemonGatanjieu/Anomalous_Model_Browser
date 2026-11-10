"""An Anima LLLite on a model it was not made for (api/lllite_fit.py): the blocks each file's header names are
counted; a model with more blocks than the LLLite has modules for is the problem, anything a header cannot
tell is let through. Temporary files only."""
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import lllite_fit  # noqa: E402


def head_file(folder, name, keys):
    """A file with a safetensors header naming `keys` and no tensor data."""
    header = json.dumps({key: {"dtype": "F16", "shape": [1], "data_offsets": [0, 2]} for key in keys}).encode("utf-8")
    path = Path(folder, name)
    path.write_bytes(struct.pack("<Q", len(header)) + header)
    return str(path)


class FitTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.mkdtemp(prefix="amb_lllite_fit_")
        model = lambda count, prefix="net.": [f"{prefix}blocks.{index}.attn.weight" for index in range(count)] + [f"{prefix}final_layer.weight"]  # noqa: E731
        lllite = [f"lllite_dit_blocks_{index}_self_attn_{part}_proj.depth_embed" for index in range(28) for part in ("q", "k")] + ["lllite_conditioning1.conv1.weight"]
        self.files = {
            ("diffusion_models", "small.safetensors"): head_file(folder, "small.safetensors", model(28)),
            ("diffusion_models", "Anima\\large.safetensors"): head_file(folder, "large.safetensors", model(40)),
            ("diffusion_models", "bare.safetensors"): head_file(folder, "bare.safetensors", model(40, "")),
            ("checkpoints", "xl.safetensors"): head_file(folder, "xl.safetensors", ["model.diffusion_model.input_blocks.0.0.weight",
                                                                                    "model.diffusion_model.output_blocks.11.0.weight"]),
            ("diffusion_models", "model.gguf"): str(Path(folder, "model.gguf")),
            ("controlnet", "tile.safetensors"): head_file(folder, "tile.safetensors", lllite),
            ("controlnet", "plain.safetensors"): head_file(folder, "plain.safetensors", ["control_model.weight"]),
        }
        Path(folder, "model.gguf").write_bytes(b"not a header")
        patcher = mock.patch.object(lllite_fit.folder_paths, "get_full_path", side_effect=lambda folder, name: self.files.get((folder, name)), create=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_model_with_more_blocks_than_the_lllite_was_made_for_is_the_problem(self):
        self.assertEqual(lllite_fit.problem("Anima\\large.safetensors", "tile.safetensors"),
                         {"model": "large.safetensors", "lllite": "tile.safetensors", "blocks": 40, "made_for": 28})
        self.assertEqual(lllite_fit.problem("bare.safetensors", "tile.safetensors")["blocks"], 40, "block names with no prefix")
        self.assertIsNone(lllite_fit.problem("small.safetensors", "tile.safetensors"))

    def test_what_a_header_cannot_tell_is_let_through(self):
        for model, lllite, why in (("xl.safetensors", "tile.safetensors", "a checkpoint of another family names no such blocks"),
                                   ("model.gguf", "tile.safetensors", "a format whose header is not read"),
                                   ("gone.safetensors", "tile.safetensors", "a model not here"),
                                   ("Anima\\large.safetensors", "plain.safetensors", "not an LLLite"),
                                   ("Anima\\large.safetensors", "gone.safetensors", "an LLLite not here")):
            self.assertIsNone(lllite_fit.problem(model, lllite), why)

    def test_check_goes_through_the_uses_and_keeps_the_problems(self):
        uses = [{"model": "small.safetensors", "lllite": "tile.safetensors"}, {"model": "Anima\\large.safetensors", "lllite": "tile.safetensors"},
                {"model": 3}, "odd", {"lllite": "tile.safetensors"}]
        self.assertEqual([item["model"] for item in lllite_fit.check(uses)], ["large.safetensors"])
        self.assertEqual(lllite_fit.check([]), [])


if __name__ == "__main__":
    unittest.main()
