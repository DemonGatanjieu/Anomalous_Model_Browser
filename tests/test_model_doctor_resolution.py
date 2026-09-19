import os
import sys
import unittest
import tempfile
import json
import hashlib
from pathlib import Path
from unittest import mock

PLUGIN_DIR = Path(__file__).resolve().parents[1]
COMFY_ROOT = PLUGIN_DIR.parents[1]
sys.path.insert(0, str(COMFY_ROOT))
sys.path.insert(0, str(PLUGIN_DIR))

from api import models
from api import utils


class ModelDoctorResolutionTests(unittest.TestCase):
    def test_default_folder_types_contains_unet(self):
        paths = utils.get_active_scan_paths()
        # In current physical mode or default abstract mode, scan paths must be non-empty
        self.assertTrue(isinstance(paths, list))
        self.assertIn("unet", models.RESOLVABLE_MODEL_TYPES)

    def test_foundation_component_types_are_resolvable(self):
        for folder_type in ("vae", "vae_approx", "clip", "text_encoders", "clip_vision"):
            self.assertIn(folder_type, models.RESOLVABLE_MODEL_TYPES)

    def test_dynamic_hash_resolution_for_unindexed_model(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_content = b"TEST_MODEL_SAFESENSOR_CONTENT_DATA_123456"
            model_size = len(model_content)
            model_hash = hashlib.sha256(model_content).hexdigest().upper()

            model_file = os.path.join(temp_dir, "renamed_model.safetensors")
            with open(model_file, "wb") as f:
                f.write(model_content)

            candidate = {
                "type": "unet",
                "filename": "renamed_model.safetensors",
                "path": model_file,
                "size": model_size
            }

            # Candidates have no pre-existing hash metadata
            candidates = [candidate]

            # Resolve using target_hash and target_size
            result = models._resolve_from_candidates(candidates, target_hash=model_hash, target_size=model_size)

            self.assertTrue(result.get("found"))
            self.assertEqual(result.get("filename"), "renamed_model.safetensors")
            self.assertTrue(result.get("matched_by_hash"))
            self.assertTrue(result.get("matched_by_size"))

            # Check that fallback info was created
            info_file = os.path.join(temp_dir, "renamed_model.info")
            self.assertTrue(os.path.exists(info_file))
            with open(info_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.assertEqual(data["files"][0]["hashes"]["SHA256"], model_hash.lower())

    def test_dynamic_hash_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_content = b"ANOTHER_MODEL_CONTENT_WITH_SAME_SIZE_BYTES"
            model_size = len(model_content)

            model_file = os.path.join(temp_dir, "different_model.safetensors")
            with open(model_file, "wb") as f:
                f.write(model_content)

            candidate = {
                "type": "unet",
                "filename": "different_model.safetensors",
                "path": model_file,
                "size": model_size
            }

            fake_target_hash = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            result = models._resolve_from_candidates([candidate], target_hash=fake_target_hash, target_size=model_size)

            self.assertFalse(result.get("found"))
            self.assertTrue(result.get("identity_conflict"))

    def test_absent_model_with_hash_and_size_returns_not_found_without_conflict(self):
        # When model does not exist locally (no candidates at all, or no matching size/hash)
        result = models._resolve_from_candidates([], target_hash="A" * 64, target_size=123456)
        self.assertFalse(result.get("found"))
        self.assertFalse(result.get("identity_conflict"))

        # When candidates exist but have completely different size and different hash
        unrelated_candidate = {
            "type": "unet",
            "filename": "other.safetensors",
            "path": "/fake/other.safetensors",
            "size": 999999,
            "hashes": {"B" * 64},
        }
        result2 = models._resolve_from_candidates([unrelated_candidate], target_hash="A" * 64, target_size=123456)
        self.assertFalse(result2.get("found"))
        self.assertFalse(result2.get("identity_conflict"))

    def test_hash_match_with_size_mismatch_returns_identity_conflict(self):
        # Candidate has matching hash but differing size -> true identity conflict
        candidate = {
            "type": "unet",
            "filename": "model.safetensors",
            "path": "/fake/model.safetensors",
            "size": 1000,
            "hashes": {"A" * 64},
        }
        result = models._resolve_from_candidates([candidate], target_hash="A" * 64, target_size=2000)
        self.assertFalse(result.get("found"))
        self.assertTrue(result.get("identity_conflict"))

    def test_unique_size_match_requires_manual_confirmation(self):
        candidate = {
            "type": "loras",
            "filename": "renamed_lora.safetensors",
            "path": __file__,
            "size": 1234,
        }
        result = models._resolve_from_candidates([candidate], target_size=1234)
        self.assertFalse(result.get("found"))
        self.assertTrue(result.get("confirmation_required"))
        self.assertTrue(result.get("matched_by_size"))
        self.assertEqual(result.get("filename"), "renamed_lora.safetensors")

    def test_foundation_component_offers_size_candidate_without_auto_recovery(self):
        candidate = {
            "type": "vae",
            "filename": "renamed_vae.safetensors",
            "path": __file__,
            "size": 1234,
        }
        result = models._resolve_from_candidates(
            [candidate],
            target_size=1234,
            require_hash=True,
        )
        self.assertFalse(result.get("found"))
        self.assertTrue(result.get("hash_required"))
        self.assertTrue(result.get("confirmation_required"))
        self.assertEqual(result.get("filename"), "renamed_vae.safetensors")

    def test_foundation_component_recovers_different_name_by_hash(self):
        candidate = {
            "type": "text_encoders",
            "filename": "new_clip_name.safetensors",
            "path": __file__,
            "size": 4321,
            "hashes": {"A" * 64},
        }
        result = models._resolve_from_candidates(
            [candidate],
            target_hash="A" * 64,
            require_hash=True,
        )
        self.assertTrue(result.get("found"))
        self.assertEqual(result.get("filename"), "new_clip_name.safetensors")
        self.assertTrue(result.get("matched_by_hash"))

    def test_model_search_falls_back_to_virtual_display_name(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_file = os.path.join(temp_dir, "opaque_name.safetensors")
            with open(model_file, "wb") as handle:
                handle.write(b"model")
            with open(os.path.splitext(model_file)[0] + ".civitai.info", "w", encoding="utf-8") as handle:
                json.dump({"anomalous_custom_name": "Readable Qwen VAE"}, handle)

            with mock.patch.object(models.folder_paths, "folder_names_and_paths", {"vae": object()}), mock.patch.object(
                models.folder_paths,
                "get_folder_paths",
                return_value=[temp_dir],
            ):
                result = models._find_model_sync("readable qwen")

            self.assertIsNotNone(result)
            self.assertEqual(result["filename"], "opaque_name.safetensors")
            self.assertEqual(result["file_path"], os.path.abspath(model_file))


if __name__ == "__main__":
    unittest.main()
