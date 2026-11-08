"""What using a model takes besides its file (api/model_guide.py): the family's files a drawing
model loaded in parts needs, found by name in this ComfyUI's folders, and the model details' request,
which names a model by type, folder index, subfolder and file name only."""
import asyncio
import json
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from aiohttp.test_utils import make_mocked_request  # noqa: E402

from api import metadata, model_guide  # noqa: E402


def listing(files):
    return mock.patch.object(model_guide.folder_paths, "get_filename_list", side_effect=lambda folder: files.get(folder, []))


class FamilyTests(unittest.TestCase):
    def test_the_first_family_whose_mark_starts_the_base_model(self):
        self.assertEqual(model_guide.profile("Flux.1 S")["family"], "Flux.1 Schnell")
        self.assertEqual(model_guide.profile("Flux.1 Krea")["family"], "Flux.1")
        self.assertEqual(model_guide.profile("NoobAI")["family"], "Illustrious / NoobAI")
        self.assertEqual(model_guide.profile("ZImageTurbo")["family"], "Z-Image")
        self.assertIsNone(model_guide.profile(""))
        self.assertIsNone(model_guide.profile("Other"))

    def test_parts_are_found_by_name_and_only_for_a_model_loaded_in_parts(self):
        files = {"text_encoders": ["clip_l.safetensors", "t5/t5-v1_1-xxl-encoder-Q8_0.gguf"], "vae": ["aesthetic_vae.safetensors", "flux/ae.safetensors"]}
        with listing(files):
            self.assertEqual([part["found"] for part in model_guide.parts("unet", "Flux.1 D")],
                             ["clip_l.safetensors", "t5/t5-v1_1-xxl-encoder-Q8_0.gguf", "flux/ae.safetensors"])
            self.assertEqual(model_guide.parts("checkpoints", "Flux.1 D"), [], "a checkpoint carries its own")
            self.assertEqual(model_guide.parts("diffusion_models", "SDXL"), [])
        with listing({"vae": ["aesthetic_vae.safetensors"]}):
            self.assertEqual(model_guide.parts("unet", "Chroma")[1]["found"], "", "a short name must be the whole name")

    def test_usage_for_the_ai(self):
        with listing({}):
            self.assertEqual(model_guide.usage("diffusion_models", "Chroma")["needs"],
                             ["text_encoders: t5xxl (none here by that name)", "vae: ae (Flux VAE) (none here by that name)"])
        self.assertEqual(model_guide.usage("loras", "Pony")["family"], "Pony")
        self.assertEqual(model_guide.usage("loras", "Hunyuan Video"), {})


class RequestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = os.path.realpath(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        def resolve(kind, at, sub):
            if kind != "loras" or at != 0:
                raise KeyError(kind)
            return self.folder, self.folder
        patch = mock.patch.object(model_guide, "resolve_folder_subdir", side_effect=resolve)
        patch.start()
        self.addCleanup(patch.stop)
        metadata.clear_metadata_cache()

    def ask(self, filename, kind="loras", at="0"):
        request = make_mocked_request("GET", f"/anomalous/model_guide?type={kind}&path_idx={at}&subfolder=&filename={filename}")
        response = asyncio.run(model_guide.api_model_guide(request))
        return response.status, json.loads(response.body) if response.status == 200 else None

    def test_a_lora_scanned_before_gets_its_words_read_now(self):
        header = {"lora_unet_input_blocks_4_1_proj_in.lora_down.weight": {"dtype": "F16", "shape": [4, 4], "data_offsets": [0, 0]},
                  "__metadata__": {"ss_tag_frequency": json.dumps({"d": {"glowstyle": 4}})}}
        raw = json.dumps(header).encode("utf-8")
        Path(self.folder, "glow.safetensors").write_bytes(struct.pack("<Q", len(raw)) + raw)
        status, guide = self.ask("glow.safetensors")
        self.assertEqual((status, guide), (200, {"examples": {}, "words": ["glowstyle"], "parts": []}))

    def test_only_a_model_file_inside_its_folder(self):
        Path(self.folder, "note.png").write_bytes(b"x")
        self.assertEqual(self.ask("note.png")[0], 404)
        self.assertEqual(self.ask("missing.safetensors")[0], 404)
        self.assertEqual(self.ask("..%2Fother.safetensors")[0], 400)
        self.assertEqual(self.ask("x.safetensors", at="bad")[0], 400)
        self.assertEqual(self.ask("x.safetensors", kind="nope")[0], 400)


if __name__ == "__main__":
    unittest.main()
