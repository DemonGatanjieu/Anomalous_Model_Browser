"""Known-model identity matching (api/model_match.py, api/reference_blocks.py, api/example_workflows.py):
exact physical size + SHA-256 matching across renames/mirrors, cache & fast-reject behavior,
and Layer 2 open version/header fallback for Anima LLLite and block loaders. Temporary files only."""

import hashlib
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

import known_hashes  # noqa: E402
from api import example_workflows as examples, model_match, reference_blocks  # noqa: E402
from api.metadata import clear_metadata_cache  # noqa: E402

ALL_NODES = {
    kind: {}
    for block in reference_blocks.BLOCKS.values()
    for kind in block["packs"]
} | {
    kind: {}
    for kind in (*examples.LOADERS, *(k for item in examples.EXAMPLES.values() for k in item.get("packs") or {}))
}


def _spec_for(payload, folder, canonical_name, base="Anima"):
    return {
        "title": canonical_name,
        "file": canonical_name,
        "folder": folder,
        "subfolder": "",
        "size": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "license": "MIT",
        "base": base,
        "sources": [{"site": "civitai", "url": "https://civitai.com/api/download/models/1"}],
    }


def _safetensors_bytes(keys):
    header = json.dumps({key: {"dtype": "F16", "shape": [1], "data_offsets": [0, 2]} for key in keys}).encode("utf-8")
    return struct.pack("<Q", len(header)) + header + b"\x00\x00"


class ModelMatchTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        model_match.clear_cache()
        clear_metadata_cache()
        kh_patch = mock.patch.object(known_hashes, "PATH", os.path.join(self.dir.name, ".known_hashes.json"))
        kh_patch.start()
        self.addCleanup(kh_patch.stop)
        self.addCleanup(model_match.clear_cache)

    def _folder_env(self, files_by_folder):
        """Patch folder_paths.get_full_path and get_filename_list for isolated temp folders."""
        import folder_paths

        def get_full_path(folder, name):
            mapping = files_by_folder.get(folder) or {}
            path = mapping.get(name)
            if not path and isinstance(name, str):
                path = mapping.get(name.replace("\\", "/"))
            return path

        def get_filename_list(folder):
            return list((files_by_folder.get(folder) or {}).keys())

        p1 = mock.patch.object(folder_paths, "get_full_path", side_effect=get_full_path, create=True)
        p2 = mock.patch.object(folder_paths, "get_filename_list", side_effect=get_filename_list, create=True)
        p1.start()
        p2.start()
        self.addCleanup(p1.stop)
        self.addCleanup(p2.stop)

    def test_renamed_anima_tile_v2_matched_by_sha256_over_v1_and_clears_example_lack(self):
        v2_bytes = _safetensors_bytes(["lllite_conditioning1.conv1.weight"]) + b"v2-tile-weights"
        v1_bytes = b"anima-tile-v1-different-bytes"
        cn_dir = Path(self.dir.name, "controlnet")
        cn_dir.mkdir(parents=True)

        # Mirror / user renames sorted below v1 alphabetically or in arbitrary Chinese name
        v1_path = cn_dir / "anima_tiled_lllite_v1.safetensors"
        v2_path = cn_dir / "anima_tile_lllite_v2.safetensors"
        cn_name_path = cn_dir / "我的精修.safetensors"
        v1_path.write_bytes(v1_bytes)
        v2_path.write_bytes(v2_bytes)
        cn_name_path.write_bytes(v2_bytes)

        models = {**reference_blocks.MODELS, "anima_tile_repair": _spec_for(v2_bytes, "controlnet", "animaTileRepair_v20.safetensors")}
        self._folder_env({"controlnet": {"anima_tiled_lllite_v1.safetensors": str(v1_path), "anima_tile_lllite_v2.safetensors": str(v2_path)}})
        info = {
            **ALL_NODES,
            "UNETLoader": {"input": {"required": {"unet_name": [["anima_2b.safetensors"]]}}},
            "CLIPLoader": {"input": {"required": {"clip_name": [["qwen_3_06b.safetensors"]]}}},
            "VAELoader": {"input": {"required": {"vae_name": [["qwen_image_vae.safetensors"]]}}},
            "AnimaLLLiteApply_sdscripts": {"input": {"required": {"lllite_name": [[
                "anima_tiled_lllite_v1.safetensors", "anima_tile_lllite_v2.safetensors"]]}}},
        }
        with mock.patch.object(reference_blocks, "MODELS", models), \
                mock.patch("api.model_advice._main_base", return_value="Anima"):
            self.assertEqual(reference_blocks._lllite(info, "tile"), "anima_tile_lllite_v2.safetensors")
            fills = examples._fills(info)
            self.assertEqual(fills["AnimaLLLiteApply_sdscripts"], "anima_tile_lllite_v2.safetensors")
            self.assertEqual(examples._lacks(examples.EXAMPLES["two_pass_anima_tile"], info, fills), [])

            # Even a completely custom Chinese filename with no 'anima'/'tile' words matches via SHA-256
            model_match.clear_cache()
            self._folder_env({"controlnet": {"anima_tiled_lllite_v1.safetensors": str(v1_path), "我的精修.safetensors": str(cn_name_path)}})
            cn_info = {**info, "AnimaLLLiteApply_sdscripts": {"input": {"required": {"lllite_name": [[
                "anima_tiled_lllite_v1.safetensors", "我的精修.safetensors"]]}}}}
            self.assertEqual(reference_blocks._lllite(cn_info, "tile"), "我的精修.safetensors")

    def test_size_fast_reject_and_hash_cache_reuse(self):
        target_bytes = b"exact-target-payload-123456"
        other_size_bytes = b"different-size"
        wrong_same_size_bytes = b"wrong-target-payload-123456"
        assert len(target_bytes) == len(wrong_same_size_bytes)

        cn_dir = Path(self.dir.name, "cn_cache")
        cn_dir.mkdir(parents=True)
        diff_path = cn_dir / "diff_size.safetensors"
        same_wrong_path = cn_dir / "same_size_wrong.safetensors"
        match_path = cn_dir / "match.safetensors"
        diff_path.write_bytes(other_size_bytes)
        same_wrong_path.write_bytes(wrong_same_size_bytes)
        match_path.write_bytes(target_bytes)

        spec = _spec_for(target_bytes, "controlnet", "target.safetensors")
        self._folder_env({"controlnet": {
            "diff_size.safetensors": str(diff_path),
            "same_size_wrong.safetensors": str(same_wrong_path),
            "match.safetensors": str(match_path),
        }})
        choices = ["diff_size.safetensors", "same_size_wrong.safetensors", "match.safetensors"]

        with mock.patch.object(model_match, "file_sha256", wraps=model_match.file_sha256) as hasher:
            self.assertEqual(model_match.match_in_choices(choices, "controlnet", (spec,)), "match.safetensors")
            hashed_paths = {Path(call.args[0]).name for call in hasher.call_args_list}
            self.assertEqual(hashed_paths, {"same_size_wrong.safetensors", "match.safetensors"}, "different-size file is never hashed")
            first_count = hasher.call_count
            self.assertEqual(model_match.match_in_choices(choices, "controlnet", (spec,)), "match.safetensors")
            self.assertEqual(hasher.call_count, first_count, "second lookup reuses memory hash cache")

        # Verified sidecar hash avoids file hashing completely
        model_match.clear_cache()
        meta_dir = Path(self.dir.name, "cn_meta")
        meta_dir.mkdir(parents=True)
        meta_file = meta_dir / "renamed_scanned.safetensors"
        meta_file.write_bytes(target_bytes)
        self._folder_env({"controlnet": {"renamed_scanned.safetensors": str(meta_file)}})
        with mock.patch.object(model_match, "get_metadata", return_value={"hash": spec["sha256"]}), \
                mock.patch.object(model_match, "file_sha256", side_effect=AssertionError("should reuse sidecar hash")):
            self.assertEqual(model_match.match_in_choices(["renamed_scanned.safetensors"], "controlnet", (spec,)),
                             "renamed_scanned.safetensors")

    def test_corrupt_or_wrong_file_with_exact_filename_is_not_marked_installed(self):
        good_bytes = b"real-anima-tile-v2-weights"
        bad_bytes = b"corrupt-or-v1-bytes"
        spec = _spec_for(good_bytes, "controlnet", "animaTileRepair_v20.safetensors")

        d = Path(self.dir.name, "installed_check")
        d.mkdir(parents=True)
        bad_canonical = d / "animaTileRepair_v20.safetensors"
        bad_canonical.write_bytes(bad_bytes)
        self._folder_env({"controlnet": {"animaTileRepair_v20.safetensors": str(bad_canonical)}})
        self.assertFalse(reference_blocks._installed(spec), "canonical filename with wrong bytes must report uninstalled")

        model_match.clear_cache()
        good_renamed = d / "custom_mirror_name.safetensors"
        good_renamed.write_bytes(good_bytes)
        self._folder_env({"controlnet": {"custom_mirror_name.safetensors": str(good_renamed)}})
        self.assertTrue(reference_blocks._installed(spec), "renamed copy with exact size + SHA-256 reports installed")

    def test_lllite_layer2_open_fallback_prefers_newer_version_and_rejects_non_lllite_safetensors(self):
        cn_dir = Path(self.dir.name, "layer2")
        cn_dir.mkdir(parents=True)
        sdxl_cn = cn_dir / "anima_sdxl_tile.safetensors"
        sdxl_cn.write_bytes(_safetensors_bytes(["control_model.input_blocks.0.0.weight"]))
        v1_lllite = cn_dir / "anima_tiled_lllite_v1.safetensors"
        v1_lllite.write_bytes(_safetensors_bytes(["lllite_conditioning1.conv1.weight"]))
        v3_lllite = cn_dir / "Anima/anima_tile_custom_v3.safetensors"
        v3_lllite.parent.mkdir(parents=True)
        v3_lllite.write_bytes(_safetensors_bytes(["lllite_conditioning1.conv1.weight"]))

        # Fake non-LLLite header alone raises MissingModel
        self._folder_env({"controlnet": {"anima_sdxl_tile.safetensors": str(sdxl_cn)}})
        only_fake = {**ALL_NODES, "AnimaLLLiteApply_sdscripts": {"input": {"required": {"lllite_name": [["anima_sdxl_tile.safetensors"]]}}}}
        with self.assertRaises(reference_blocks.MissingModel):
            reference_blocks._lllite(only_fake, "tile")

        # Real LLLite v3 beats v1 even though 'd' > '_', and beats/ignores non-LLLite controlnet
        self._folder_env({"controlnet": {
            "anima_sdxl_tile.safetensors": str(sdxl_cn),
            "anima_tiled_lllite_v1.safetensors": str(v1_lllite),
            "Anima/anima_tile_custom_v3.safetensors": str(v3_lllite),
        }})
        mixed = {**ALL_NODES, "AnimaLLLiteApply_sdscripts": {"input": {"required": {"lllite_name": [[
            "anima_sdxl_tile.safetensors", "anima_tiled_lllite_v1.safetensors", "Anima/anima_tile_custom_v3.safetensors"]]}}}}
        self.assertEqual(reference_blocks._lllite(mixed, "tile"), "Anima/anima_tile_custom_v3.safetensors")

    def test_other_known_block_models_match_when_renamed(self):
        lora_b = b"turbo-lora-bytes"
        det_b = b"face-detector-bytes"
        sam_b = b"sam3-checkpoint-bytes"
        cn_b = b"union-promax-bytes"

        d = Path(self.dir.name, "others")
        d.mkdir(parents=True)
        (d / "renamed_turbo.safetensors").write_bytes(lora_b)
        (d / "custom_face.pt").write_bytes(det_b)
        (d / "renamed_sam3.safetensors").write_bytes(sam_b)
        (d / "renamed_promax.safetensors").write_bytes(cn_b)

        models = {
            **reference_blocks.MODELS,
            "anima_turbo_lora": _spec_for(lora_b, "loras", "anima-turbo-lora-v0.2.safetensors"),
            "face_yolov8m": _spec_for(det_b, "ultralytics_bbox", "face_yolov8m.pt", base=""),
            "sam3_1": _spec_for(sam_b, "checkpoints", "sam3.1_multiplex_fp16.safetensors", base=""),
            "union_promax_sdxl": _spec_for(cn_b, "controlnet", "xinsir-controlnet-union-sdxl-promax.safetensors", base="SDXL 1.0"),
        }
        self._folder_env({
            "loras": {"renamed_turbo.safetensors": str(d / "renamed_turbo.safetensors")},
            "ultralytics_bbox": {"custom_face.pt": str(d / "custom_face.pt")},
            "checkpoints": {"renamed_sam3.safetensors": str(d / "renamed_sam3.safetensors")},
            "controlnet": {"renamed_promax.safetensors": str(d / "renamed_promax.safetensors")},
        })
        info = {
            **ALL_NODES,
            "SetUnionControlNetType": {},
            "LoraLoaderModelOnly": {"input": {"required": {"lora_name": [["renamed_turbo.safetensors"]]}}},
            "UltralyticsDetectorProvider": {"input": {"required": {"model_name": [["bbox/custom_face.pt"]]}}},
            "CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [["renamed_sam3.safetensors"]]}}},
            "ControlNetLoader": {"input": {"required": {"control_net_name": [["renamed_promax.safetensors"]]}}},
        }
        with mock.patch.object(reference_blocks, "MODELS", models):
            self.assertEqual(reference_blocks._lora(info, "anima-turbo-lora"), "renamed_turbo.safetensors")
            self.assertEqual(reference_blocks._detector(info, "face_yolov8"), "bbox/custom_face.pt")
            self.assertEqual(reference_blocks._checkpoint(info, "sam3"), "renamed_sam3.safetensors")
            self.assertEqual(reference_blocks._controlnet(info, "lineart", "Illustrious", lambda _: ""), "renamed_promax.safetensors")
            built = reference_blocks.nodes_of("color_lineart", info, "lines.png", lambda: "Illustrious")
            self.assertEqual(built["controlnet"]["inputs"]["control_net_name"], "renamed_promax.safetensors")
            self.assertEqual(built["union_type"]["inputs"]["type"], "canny/lineart/anime_lineart/mlsd",
                             "renamed union ProMax still wires SetUnionControlNetType")


if __name__ == "__main__":
    unittest.main()
