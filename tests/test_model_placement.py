"""The models page's Tidy check (api/model_placement.py): models in the wrong folder, identical
copies, and moving a model with its covers and info. Files go to temporary folders."""
import asyncio
import hashlib
import json
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import model_placement  # noqa: E402


def safetensors(*names):
    raw = json.dumps({name: {"dtype": "F16", "shape": [4, 4], "data_offsets": [0, 0]} for name in names}).encode()
    return struct.pack("<Q", len(raw)) + raw


ANIMA = safetensors("net.blocks.0.self_attn.q_proj.weight", "net.llm_adapter.blocks.0.mlp.0.weight")
FLUX_WHOLE = safetensors("model.diffusion_model.double_blocks.0.img_attn.qkv.weight", "first_stage_model.encoder.down.0.block.0.conv1.weight")
LORA = safetensors("lora_unet_double_blocks_0_img_attn_proj.lora_up.weight")
LLLITE = safetensors("lllite_conditioning1.conv1.weight", "lllite_modules.0.down.weight")


class PlacementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = os.path.realpath(self.temp.name)
        self.roots = {kind: [os.path.join(base, kind)] for kind in ("checkpoints", "loras", "vae", "controlnet", "model_patches")}
        self.roots["diffusion_models"] = [os.path.join(base, "unet"), os.path.join(base, "diffusion_models")]
        for paths in self.roots.values():
            for path in paths:
                os.makedirs(path, exist_ok=True)
        self.hashes = {}
        self.patches = [
            mock.patch.object(model_placement.folder_paths, "folder_names_and_paths", {k: (v, set()) for k, v in self.roots.items()}),
            mock.patch.object(model_placement.folder_paths, "get_folder_paths", side_effect=lambda t: self.roots.get(t, [])),
            mock.patch("api.model_import.folder_paths.get_folder_paths", side_effect=lambda t: self.roots.get(t, [])),
            mock.patch.object(model_placement, "add_entry"),
            mock.patch.object(model_placement, "forget_file_lists"),
            mock.patch.object(model_placement, "get_metadata", side_effect=lambda path: {"hash": self.hashes.get(path, "")}),
        ]
        for patch in self.patches:
            patch.start()
        model_placement._heads.clear()
        model_placement._hashes.clear()

    def tearDown(self):
        for patch in reversed(self.patches):
            patch.stop()
        self.temp.cleanup()

    def put(self, kind, rel, data, index=0):
        path = os.path.join(self.roots[kind][index], *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        Path(path).write_bytes(data)
        return path

    def test_misplaced_models_and_where_they_go(self):
        self.put("checkpoints", "Anima/realskin.safetensors", ANIMA)
        self.put("diffusion_models", "Flux/flux-fp8.safetensors", FLUX_WHOLE)
        self.put("loras", "ok.safetensors", LORA)
        self.put("checkpoints", "unknown.safetensors", safetensors("something.weight"))
        data = model_placement.check()
        self.assertEqual(data["checked"], 4)
        found = {item["rel"]: item for item in data["misplaced"]}
        self.assertEqual(set(found), {"Anima/realskin.safetensors", "Flux/flux-fp8.safetensors"})
        anima = found["Anima/realskin.safetensors"]
        self.assertEqual((anima["kind"], anima["base"], anima["works"]), ("diffusion_models", "Anima", False))
        self.assertEqual(anima["to"], {"type": "diffusion_models", "root": 0, "rel": "Anima/realskin.safetensors"})
        self.assertEqual((anima["name"], anima["version"], anima["preview_url"]), ("realskin", "", ""))
        # A whole checkpoint in the diffusion models folder still loads there.
        self.assertTrue(found["Flux/flux-fp8.safetensors"]["works"])

    def test_a_model_patch_in_the_controlnet_folder(self):
        path = self.put("controlnet", "anima-lllite-depth.safetensors", LLLITE)
        home = model_placement.belongs(model_placement.one("controlnet", 0, "anima-lllite-depth.safetensors", path))
        self.assertEqual(home["to"], {"type": "model_patches", "root": 0, "rel": "anima-lllite-depth.safetensors"})
        self.assertFalse(home["works"])
        moved = self.put("model_patches", "ok.safetensors", LLLITE)
        self.assertIsNone(model_placement.belongs(model_placement.one("model_patches", 0, "ok.safetensors", moved)))

    def test_what_one_model_looks_like(self):
        self.put("controlnet", "Anima/depth.safetensors", LLLITE)
        self.put("loras", "plain.safetensors", safetensors("something.weight"))
        self.assertEqual(model_placement.look("controlnet", 0, "Anima/depth.safetensors"),
                         {"type": "controlnet", "root": 0, "rel": "Anima/depth.safetensors", "kind": "model_patches", "sure": True, "base": ""})
        self.assertEqual(model_placement.look("loras", "0", "plain.safetensors")["kind"], "")  # nothing to tell: no guess
        for args, code in ((("loras", 0, "../x.safetensors"), "bad_path"), (("loras", -1, "plain.safetensors"), "bad_path"),
                           (("loras", 0, "none.safetensors"), "gone"), (("nope", 0, "plain.safetensors"), "bad_type")):
            with self.assertRaises(model_placement.Refused) as refused:
                model_placement.look(*args)
            self.assertEqual(refused.exception.code, code, args)

    def test_identical_copies(self):
        first = self.put("loras", "a.safetensors", LORA)
        self.put("vae", "copy.safetensors", LORA)
        self.put("loras", "other.safetensors", LORA + b"x")
        # Large files never scanned are only counted until a deep check reads them.
        with mock.patch.object(model_placement, "AUTO_HASH", 10):
            data = model_placement.check()
        self.assertEqual(data["duplicates"], [])
        self.assertEqual(data["unchecked"], {"groups": 1, "bytes": 2 * len(LORA)})
        model_placement._hashes.clear()
        self.assertEqual(len(model_placement.check()["duplicates"]), 1)  # small ones are read at once
        deep = model_placement.check(deep=True)["duplicates"]
        self.assertEqual(len(deep), 1)
        self.assertEqual({item["rel"] for item in deep[0]["files"]}, {"a.safetensors", "copy.safetensors"})
        self.assertEqual(deep[0]["sha256"], hashlib.sha256(LORA).hexdigest())
        # The copy in the folder that fits what it is is the one to keep.
        self.assertEqual({item["rel"]: item["fits"] for item in deep[0]["files"]}, {"a.safetensors": True, "copy.safetensors": False})
        # Hashes from scans count without reading.
        model_placement._hashes.clear()
        self.hashes[first] = hashlib.sha256(LORA).hexdigest()
        with mock.patch.object(model_placement, "AUTO_HASH", 10):
            self.assertEqual(model_placement.check()["unchecked"]["groups"], 1)  # the copy is still unknown

    def test_move_takes_covers_and_info_along(self):
        source = self.put("checkpoints", "Anima/realskin.safetensors", ANIMA)
        for suffix in (".info", ".preview.png", ".civitai_bak.png", ".anomalous.json"):
            Path(source[:-len(".safetensors")] + suffix).write_text("x")
        self.put("diffusion_models", "Anima/realskin.safetensors", b"another model")
        moved = model_placement.move({"type": "checkpoints", "root": 0, "rel": "Anima/realskin.safetensors",
                                      "to_type": "diffusion_models", "to_root": 0, "to_rel": "Anima/realskin.safetensors"})
        self.assertEqual(moved["rel"], "Anima/realskin (2).safetensors")
        self.assertEqual(moved["left"], [])
        target = Path(self.roots["diffusion_models"][0], "Anima")
        self.assertEqual(sorted(os.listdir(target)), sorted([
            "realskin.safetensors", "realskin (2).safetensors", "realskin (2).info", "realskin (2).preview.png",
            "realskin (2).civitai_bak.png", "realskin (2).anomalous.json"]))
        self.assertEqual(os.listdir(os.path.dirname(source)), [])
        self.assertEqual(Path(target, "realskin.safetensors").read_bytes(), b"another model")

    def test_shared_covers_stay(self):
        source = self.put("checkpoints", "m.safetensors", ANIMA)
        self.put("checkpoints", "m.ckpt", b"older format, same name")
        Path(source[:-len(".safetensors")] + ".info").write_text("x")
        model_placement.move({"type": "checkpoints", "root": 0, "rel": "m.safetensors",
                              "to_type": "diffusion_models", "to_root": 1, "to_rel": "m.safetensors"})
        self.assertEqual(sorted(os.listdir(self.roots["checkpoints"][0])), ["m.ckpt", "m.info"])

    def test_refused_moves(self):
        self.put("checkpoints", "m.safetensors", ANIMA)
        for data, code in (({"type": "checkpoints", "rel": "gone.safetensors", "to_type": "loras", "to_rel": "x.safetensors"}, "gone"),
                           ({"type": "checkpoints", "rel": "../m.safetensors", "to_type": "loras", "to_rel": "x.safetensors"}, "bad_path"),
                           ({"type": "checkpoints", "rel": "m.safetensors", "to_type": "loras", "to_rel": "../x.safetensors"}, "bad_path"),
                           ({"type": "nope", "rel": "m.safetensors", "to_type": "loras", "to_rel": "x.safetensors"}, "bad_type")):
            with self.assertRaises(model_placement.Refused) as refused:
                model_placement.move(data)
            self.assertEqual(refused.exception.code, code)
        self.assertTrue(Path(self.roots["checkpoints"][0], "m.safetensors").exists())

    def test_move_only_from_this_computer(self):
        self.put("checkpoints", "m.safetensors", ANIMA)
        move = {"type": "checkpoints", "root": 0, "rel": "m.safetensors", "to_type": "loras", "to_root": 0, "to_rel": "m.safetensors"}

        async def run():
            app = web.Application()
            model_placement.register_routes(app)
            async with TestClient(TestServer(app)) as client:  # through a proxy: not this computer
                resp = await client.post("/anomalous/placement/move", json=move, headers={"X-Forwarded-For": "192.168.1.20"})
                return resp.status, await resp.json()
        self.assertEqual(asyncio.run(run()), (403, {"error": "not_local"}))
        self.assertTrue(Path(self.roots["checkpoints"][0], "m.safetensors").exists())


if __name__ == "__main__":
    unittest.main()
