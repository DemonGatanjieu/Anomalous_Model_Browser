"""Model import: telling what a model file is from its header (model_kind.py), finding the
dropped file on this computer, and putting it into the models folder without replacing
anything (api/model_import.py). No network; files go to temporary folders."""
import asyncio
import json
import os
import struct
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

import model_identity  # noqa: E402
import model_kind  # noqa: E402
from api import model_import  # noqa: E402


def tensors(*names, shapes=None, meta=None):
    header = {name: {"dtype": "F16", "shape": (shapes or {}).get(name, [4, 4]), "data_offsets": [0, 0]} for name in names}
    if meta:
        header["__metadata__"] = meta
    return header


def safetensors_bytes(header):
    raw = json.dumps(header).encode("utf-8")
    return struct.pack("<Q", len(raw)) + raw + b"\0" * 64


def gguf_bytes(arch, names=()):
    def text(value):
        raw = value.encode("utf-8")
        return struct.pack("<Q", len(raw)) + raw
    data = b"GGUF" + struct.pack("<I", 3) + struct.pack("<Q", len(names)) + struct.pack("<Q", 2)
    data += text("general.architecture") + struct.pack("<I", 8) + text(arch)
    data += text("tokenizer.tokens") + struct.pack("<I", 9) + struct.pack("<I", 8) + struct.pack("<Q", 2) + text("a") + text("b")
    for name in names:
        data += text(name) + struct.pack("<I", 2) + struct.pack("<QQ", 4, 4) + struct.pack("<I", 1) + struct.pack("<Q", 0)
    return data


def kind_of(header):
    return model_kind.classify("safetensors", header)


class KindTests(unittest.TestCase):
    def test_loras_and_their_base_models(self):
        sdxl = kind_of(tensors("lora_unet_input_blocks_4_1_proj_in.lora_down.weight", "lora_te1_text_model_encoder_layers_0_mlp_fc1.alpha"))
        self.assertEqual((sdxl["kind"], sdxl["base"], sdxl["sure"]), ("loras", "SDXL", True))
        # Diffusers names say nothing: the cross-attention width does (768 = SD 1.5).
        sd15 = kind_of(tensors("unet.down_blocks.1.attentions.0.transformer_blocks.0.attn2.to_k.lora_A.weight",
                               shapes={"unet.down_blocks.1.attentions.0.transformer_blocks.0.attn2.to_k.lora_A.weight": [16, 768]}))
        self.assertEqual((sd15["kind"], sd15["base"]), ("loras", "SD 1.5"))
        flux = kind_of(tensors("lora_unet_double_blocks_0_img_attn_proj.lora_up.weight"))
        self.assertEqual((flux["kind"], flux["base"]), ("loras", "Flux.1 D"))
        # Anima (Cosmos-Predict2 with a Qwen3 adapter): Civitai calls it a Checkpoint, it goes in diffusion models.
        anima = kind_of(tensors("net.blocks.0.self_attn.q_proj.weight", "net.blocks.0.cross_attn.k_proj.weight",
                                "net.x_embedder.proj.1.weight", "net.llm_adapter.blocks.0.mlp.0.weight"))
        self.assertEqual((anima["kind"], anima["base"], anima["sure"]), ("diffusion_models", "Anima", True))
        bare = kind_of(tensors("blocks.0.self_attn.q_proj.weight", "blocks.0.cross_attn.k_proj.weight",
                               "blocks.0.adaln_modulation_self_attn.1.weight", "llm_adapter.blocks.0.mlp.0.weight"))
        self.assertEqual((bare["kind"], bare["base"]), ("diffusion_models", "Anima"))
        wan = kind_of(tensors("diffusion_model.blocks.0.self_attn.q.lora_A.weight", "diffusion_model.blocks.0.cross_attn.k.lora_B.weight"))
        self.assertEqual(wan["base"], "Wan Video")
        # SDXL's families only show in what it was trained on.
        illustrious = kind_of(tensors("lora_unet_output_blocks_0_1_proj_in.lora_down.weight",
                                      meta={"ss_base_model_version": "sdxl_base_v1-0", "ss_sd_model_name": "illustriousXL_v01.safetensors"}))
        self.assertEqual(illustrious["base"], "Illustrious")
        lycoris = kind_of(tensors("lora_unet_down_blocks_0_attentions_0_proj_in.hada_w1_a"))
        self.assertEqual(lycoris["kind"], "loras")

    def test_whole_models_and_their_parts(self):
        checkpoint = kind_of(tensors("model.diffusion_model.input_blocks.0.0.weight", "model.diffusion_model.label_emb.0.0.weight",
                                     "first_stage_model.encoder.down.0.block.0.conv1.weight", "conditioner.embedders.1.model.ln_final.weight"))
        self.assertEqual((checkpoint["kind"], checkpoint["base"]), ("checkpoints", "SDXL"))
        merged = kind_of(tensors("model.diffusion_model.input_blocks.0.0.weight", "first_stage_model.decoder.up.0.block.0.conv1.weight",
                                 "lora_te_text_model_encoder_layers_0_mlp_fc1.lora_down.weight"))
        self.assertEqual(merged["kind"], "checkpoints")  # a merge that kept a LoRA's keys
        flux = kind_of(tensors("double_blocks.0.img_attn.qkv.weight", "img_in.weight", "single_blocks.0.linear1.weight"))
        self.assertEqual((flux["kind"], flux["base"]), ("diffusion_models", "Flux.1 D"))
        # Qwen-Image also has img_in: not taken for Flux.
        qwen = kind_of(tensors("transformer_blocks.0.img_mod.1.weight", "img_in.weight", "txt_norm.weight"))
        self.assertEqual((qwen["kind"], qwen["base"]), ("diffusion_models", "Qwen"))
        vae = kind_of(tensors("encoder.down.0.block.0.conv1.weight", "decoder.up.0.block.0.conv1.weight"))
        self.assertEqual((vae["kind"], vae["base"], vae["sure"]), ("vae", "", True))
        t5 = kind_of(tensors("encoder.block.0.layer.0.SelfAttention.q.weight", "shared.weight"))
        self.assertEqual(t5["kind"], "text_encoders")
        clip = kind_of(tensors("text_model.encoder.layers.0.mlp.fc1.weight"))
        self.assertEqual(clip["kind"], "text_encoders")
        vision = kind_of(tensors("vision_model.encoder.layers.0.mlp.fc1.weight"))
        self.assertEqual(vision["kind"], "clip_vision")
        control = kind_of(tensors("control_model.input_hint_block.0.weight", "control_model.zero_convs.0.0.weight"))
        self.assertEqual(control["kind"], "controlnet")

    def test_embeddings(self):
        self.assertEqual(kind_of(tensors("clip_l", "clip_g")), {"kind": "embeddings", "base": "SDXL", "sure": True})
        sd15 = kind_of(tensors("emb_params", shapes={"emb_params": [8, 768]}))
        self.assertEqual((sd15["kind"], sd15["base"]), ("embeddings", "SD 1.5"))

    def test_unknown_files_are_not_guessed(self):
        self.assertEqual(kind_of(tensors("something.weight")), {"kind": "", "base": "", "sure": False})
        self.assertEqual(model_kind.classify(None, None), {"kind": "", "base": "", "sure": False})

    def test_gguf(self):
        flux = model_kind.classify("gguf", model_kind.parse_gguf(gguf_bytes("flux", ["double_blocks.0.img_attn.qkv.weight"])))
        self.assertEqual((flux["kind"], flux["base"]), ("diffusion_models", "Flux.1 D"))
        self.assertEqual(model_kind.parse_gguf(gguf_bytes("flux", ["a.weight"]))["keys"], ["a.weight"])
        self.assertEqual(model_kind.classify("gguf", model_kind.parse_gguf(gguf_bytes("t5encoder")))["kind"], "text_encoders")
        # Cut short: what fits is still read.
        self.assertEqual(model_kind.parse_gguf(gguf_bytes("wan")[:70])["meta"].get("general.architecture"), "wan")
        self.assertIsNone(model_kind.parse_gguf(b"not a gguf"))

    def test_files_on_disk_and_the_scanner(self):
        with tempfile.TemporaryDirectory() as temp:
            lora = os.path.join(temp, "x.safetensors")
            Path(lora).write_bytes(safetensors_bytes(tensors("lora_unet_double_blocks_0_img_attn_proj.lora_up.weight")))
            self.assertEqual(model_kind.inspect_file(lora)["kind"], "loras")
            self.assertEqual(model_identity.infer_base_model_from_header(lora), "Flux.1 D")
            pickle = os.path.join(temp, "x.ckpt")
            Path(pickle).write_bytes(b"\x80\x02whatever")
            self.assertEqual(model_kind.inspect_file(pickle), {"kind": "", "base": "", "sure": False, "format": None})
            self.assertEqual(model_identity.infer_base_model_from_header(pickle), "Unknown")
            broken = os.path.join(temp, "y.safetensors")
            Path(broken).write_bytes(struct.pack("<Q", 10 ** 12))
            self.assertEqual(model_kind.read_head(broken), (None, None))


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = os.path.realpath(self.temp.name)
        self.loras = os.path.join(base, "models", "loras")
        self.downloads = os.path.join(base, "Downloads")
        os.makedirs(self.loras)
        os.makedirs(os.path.join(self.downloads, "a", "b"))
        roots = {"loras": [self.loras], "vae": [os.path.join(base, "models", "vae")]}
        self.patches = [
            mock.patch.object(model_import.folder_paths, "folder_names_and_paths", {name: (paths, set()) for name, paths in roots.items()}),
            mock.patch.object(model_import.folder_paths, "get_folder_paths", side_effect=lambda t: roots.get(t, [])),
            mock.patch.object(model_import, "add_entry"),
            mock.patch.object(model_import, "forget_file_lists"),
            mock.patch.object(model_import, "search_folders", return_value=[("downloads", self.downloads)]),
        ]
        for patch in self.patches:
            patch.start()
        self.data = safetensors_bytes(tensors("lora_unet_double_blocks_0_img_attn_proj.lora_up.weight"))

    def tearDown(self):
        for patch in reversed(self.patches):
            patch.stop()
        self.temp.cleanup()

    def dropped(self, *parts):
        path = os.path.join(self.downloads, *parts)
        Path(path).write_bytes(self.data)
        return path, os.stat(path).st_mtime * 1000

    def test_the_dropped_file_is_found_by_name_size_and_time(self):
        path, mtime = self.dropped("a", "Cool.safetensors")
        size = len(self.data)
        self.assertEqual(model_import.find_original("cool.safetensors", size, mtime), ("downloads", path))
        self.assertIsNone(model_import.find_original("cool.safetensors", size + 1, mtime))
        self.assertIsNone(model_import.find_original("cool.safetensors", size, mtime - 60000))
        # In subfolders two deep, not deeper.
        self.dropped("a", "b", "two.safetensors")
        self.assertIsNotNone(model_import.find_original("two.safetensors", size, 0))
        os.makedirs(os.path.join(self.downloads, "a", "b", "c"))
        self.dropped("a", "b", "c", "three.safetensors")
        self.assertIsNone(model_import.find_original("three.safetensors", size, 0))

    def test_inspect_found_and_not_found(self):
        path, mtime = self.dropped("cool.safetensors")
        found = model_import.inspect("cool.safetensors", len(self.data), mtime, b"", local=True)
        self.assertEqual((found["kind"], found["base"], found["where"]), ("loras", "Flux.1 D", "downloads"))
        self.assertTrue(found["token"])
        # Asked from another computer: never looked for, judged from the bytes sent.
        remote = model_import.inspect("cool.safetensors", len(self.data), mtime, self.data, local=False)
        self.assertNotIn("token", remote)
        self.assertEqual(remote["kind"], "loras")
        # A type this ComfyUI has no folder for is not offered.
        control = safetensors_bytes(tensors("control_model.input_hint_block.0.weight"))
        self.assertEqual(model_import.inspect("c.safetensors", len(control), 0, control, local=False)["kind"], "")

    def test_place_moves_and_never_replaces(self):
        path, mtime = self.dropped("cool.safetensors")
        token = model_import.inspect("cool.safetensors", len(self.data), mtime, b"", local=True)["token"]
        Path(self.loras, "Flux").mkdir()
        Path(self.loras, "Flux", "cool.safetensors").write_bytes(b"older")
        placed = model_import.place({"token": token, "type": "loras", "root": 0, "rel": "Flux/cool.safetensors"})
        self.assertEqual(placed["rel"], "Flux/cool (2).safetensors")
        self.assertFalse(os.path.exists(path))
        self.assertEqual(Path(self.loras, "Flux", "cool.safetensors").read_bytes(), b"older")
        self.assertEqual(Path(self.loras, "Flux", "cool (2).safetensors").read_bytes(), self.data)
        with self.assertRaises(model_import.Refused) as refused:
            model_import.place({"token": token, "type": "loras", "root": 0, "rel": "x.safetensors"})
        self.assertEqual(refused.exception.code, "gone")

    def test_place_keeps_the_original_when_asked(self):
        path, mtime = self.dropped("cool.safetensors")
        token = model_import.inspect("cool.safetensors", len(self.data), mtime, b"", local=True)["token"]
        model_import.place({"token": token, "type": "loras", "root": 0, "rel": "cool.safetensors", "keep": True})
        self.assertTrue(os.path.exists(path))
        self.assertEqual(Path(self.loras, "cool.safetensors").read_bytes(), self.data)
        self.assertFalse(Path(self.loras, "cool.safetensors.part").exists())

    def test_a_failed_copy_leaves_nothing_behind(self):
        path, _ = self.dropped("cool.safetensors")
        dest = os.path.join(self.loras, "cool.safetensors")
        with mock.patch.object(model_import.shutil, "copyfile", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                model_import.move_into(path, dest, keep=True)
        self.assertTrue(os.path.exists(path))
        self.assertFalse(os.path.exists(dest))

    def test_destinations_stay_inside_the_models_folder(self):
        for data, code in (({"type": "checkpoints", "rel": "a.safetensors"}, "bad_type"),
                           ({"type": "loras", "root": 3, "rel": "a.safetensors"}, "bad_root"),
                           ({"type": "loras", "rel": "../a.safetensors"}, "bad_path"),
                           ({"type": "loras", "rel": "a.txt"}, "bad_name")):
            with self.assertRaises(model_import.Refused) as refused:
                model_import.destination(data)
            self.assertEqual(refused.exception.code, code)

    def test_upload(self):
        async def run():
            app = web.Application()
            model_import.register_routes(app)
            async with TestClient(TestServer(app)) as client:
                ok = await client.put("/anomalous/import/upload", params={"type": "loras", "root": "0", "rel": "up/new.safetensors",
                                                                         "size": str(len(self.data))}, data=self.data)
                short = await client.put("/anomalous/import/upload", params={"type": "loras", "root": "0", "rel": "up/short.safetensors",
                                                                            "size": str(len(self.data) + 5)}, data=self.data)
                return ok.status, await ok.json(), short.status, await short.json()
        status, body, short_status, short_body = asyncio.run(run())
        self.assertEqual((status, body["rel"]), (200, "up/new.safetensors"))
        self.assertEqual(Path(self.loras, "up", "new.safetensors").read_bytes(), self.data)
        self.assertEqual((short_status, short_body["error"]), (400, "incomplete"))
        self.assertEqual(sorted(os.listdir(os.path.join(self.loras, "up"))), ["new.safetensors"])

    def test_identify_reports_civitai_and_a_copy_already_there(self):
        path, mtime = self.dropped("cool.safetensors")
        token = model_import.inspect("cool.safetensors", len(self.data), mtime, b"", local=True)["token"]
        record = {"found": True, "base_model": "Illustrious", "model_name": "Cool", "version_name": "v2", "page": "p"}
        with mock.patch.object(model_import, "civitai_by_hash", return_value=record), \
                mock.patch.object(model_import, "_same_hash", return_value="Flux/old.safetensors"):
            found = model_import.identify(token)
        self.assertEqual(found["civitai"]["version_name"], "v2")
        self.assertEqual(found["duplicate"], "Flux/old.safetensors")
        with mock.patch.object(model_import, "civitai_by_hash", side_effect=model_import.SourceUnreachable("down")), \
                mock.patch.object(model_import, "_same_hash", return_value=None):
            self.assertEqual(model_import.identify(token)["reason"], "network")


if __name__ == "__main__":
    unittest.main()
