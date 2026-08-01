import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path


folder_paths = types.ModuleType("folder_paths")
sys.modules.setdefault("folder_paths", folder_paths)

API_PATH = Path(__file__).parents[1] / "api"
package = types.ModuleType("anomalous_test_api")
package.__path__ = [str(API_PATH)]
sys.modules[package.__name__] = package


def load_api_module(name):
    full_name = f"{package.__name__}.{name}"
    spec = importlib.util.spec_from_file_location(full_name, API_PATH / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[full_name] = module
    spec.loader.exec_module(module)
    return module


utils = load_api_module("utils")
metadata = load_api_module("metadata")
models = load_api_module("models")


class PathSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self.temp_dir.name)
        folder_paths.get_folder_paths = lambda folder_type: [self.root]

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_normal_subfolder_stays_inside_root(self):
        base, target = utils.resolve_folder_subdir("checkpoints", 0, "nested/models")
        self.assertEqual(base, self.root)
        self.assertEqual(target, os.path.join(self.root, "nested", "models"))

    def test_parent_traversal_is_rejected(self):
        with self.assertRaises(ValueError):
            utils.resolve_folder_subdir("checkpoints", 0, "../outside")

    def test_absolute_path_is_rejected(self):
        absolute_target = os.path.abspath(os.path.join(self.root, os.pardir, "outside"))
        with self.assertRaises(ValueError):
            utils.resolve_folder_subdir("checkpoints", 0, absolute_target)

    def test_negative_folder_index_is_rejected(self):
        with self.assertRaises(ValueError):
            utils.resolve_folder_subdir("checkpoints", -1, "/")

    def test_filename_must_be_a_basename(self):
        self.assertEqual(utils.require_filename("cover.png"), "cover.png")
        with self.assertRaises(ValueError):
            utils.require_filename(os.path.join("nested", "cover.png"))


class ImageEndpointSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self.temp_dir.name)
        folder_paths.get_folder_paths = lambda folder_type: [self.root]
        Path(self.root, "cover.png").write_bytes(b"not-a-real-png")

    async def asyncTearDown(self):
        self.temp_dir.cleanup()

    async def test_image_endpoint_rejects_absolute_filename(self):
        outside = os.path.abspath(os.path.join(self.root, os.pardir, "outside.txt"))
        request = types.SimpleNamespace(query={"type": "checkpoints", "path_idx": "0", "filename": outside})
        response = await utils.api_serve_image(request)
        self.assertEqual(response.status, 400)

    async def test_image_endpoint_accepts_supported_local_media(self):
        request = types.SimpleNamespace(query={"type": "checkpoints", "path_idx": "0", "filename": "cover.png"})
        response = await utils.api_serve_image(request)
        self.assertEqual(response.status, 200)

    async def test_image_endpoint_rejects_non_media_files(self):
        Path(self.root, "metadata.json").write_text("{}", encoding="utf-8")
        request = types.SimpleNamespace(query={"type": "checkpoints", "path_idx": "0", "filename": "metadata.json"})
        response = await utils.api_serve_image(request)
        self.assertEqual(response.status, 415)


class MetadataHashSelectionTests(unittest.TestCase):
    def test_multifile_info_hash_is_selected_by_physical_size(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_path = Path(temp_dir, "renamed-model.safetensors")
            model_path.write_bytes(b"the-local-model")
            dependency_hash = "A" * 64
            model_hash = "B" * 64
            info = {
                "files": [
                    {
                        "name": "dependency-vae.safetensors",
                        "sizeKB": 5 / 1024,
                        "hashes": {"SHA256": dependency_hash},
                    },
                    {
                        "name": "original-model-name.safetensors",
                        "sizeKB": model_path.stat().st_size / 1024,
                        "hashes": {"SHA256": model_hash},
                    },
                ]
            }
            model_path.with_suffix(".info").write_text(json.dumps(info), encoding="utf-8")

            result = metadata.get_metadata(str(model_path))
            self.assertEqual(result["hash"], model_hash)
            self.assertEqual(result["source_filename"], "original-model-name.safetensors")

    def test_ambiguous_multifile_info_does_not_use_first_hash(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_path = Path(temp_dir, "renamed-model.safetensors")
            model_path.write_bytes(b"size-not-listed")
            info = {
                "files": [
                    {"name": "a.safetensors", "sizeKB": 1, "hashes": {"SHA256": "A" * 64}},
                    {"name": "b.safetensors", "sizeKB": 2, "hashes": {"SHA256": "B" * 64}},
                ]
            }
            model_path.with_suffix(".info").write_text(json.dumps(info), encoding="utf-8")

            self.assertEqual(metadata.get_metadata(str(model_path))["hash"], "")


class HashResolutionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        temp_root = Path(self.temp_dir.name)
        self.checkpoint_root = temp_root / "checkpoints"
        self.lora_root = temp_root / "loras"
        checkpoint_file = self.checkpoint_root / "a" / "shared.safetensors"
        lora_file = self.lora_root / "b" / "shared.safetensors"
        checkpoint_file.parent.mkdir(parents=True)
        lora_file.parent.mkdir(parents=True)
        checkpoint_file.write_bytes(b"wrong-size-match")
        lora_file.write_bytes(b"correct-hash-model-with-a-different-size")
        self.checkpoint_hash = "1" * 64
        self.lora_hash = "2" * 64
        for file_path, file_hash in ((checkpoint_file, self.checkpoint_hash), (lora_file, self.lora_hash)):
            info_path = file_path.with_suffix(".info")
            info_path.write_text(json.dumps({"files": [{"hashes": {"SHA256": file_hash}}]}), encoding="utf-8")
        self.checkpoint_size = checkpoint_file.stat().st_size
        self.lora_size = lora_file.stat().st_size
        mapping = {"checkpoints": [str(self.checkpoint_root)], "loras": [str(self.lora_root)]}
        folder_paths.get_folder_paths = lambda folder_type: mapping.get(folder_type, [])

    async def asyncTearDown(self):
        self.temp_dir.cleanup()

    async def test_ambiguous_basename_alias_is_omitted(self):
        response = await models.api_get_all_hashes(types.SimpleNamespace())
        hashes = json.loads(response.text)
        self.assertNotIn("shared.safetensors", hashes)
        self.assertEqual(hashes["a/shared.safetensors"]["hash"], self.checkpoint_hash)
        self.assertEqual(hashes["b/shared.safetensors"]["hash"], self.lora_hash)

    async def test_matching_hash_and_size_resolve_same_file(self):
        request = types.SimpleNamespace(query={"hash": self.lora_hash, "size": str(self.lora_size)})
        response = await models.api_resolve_hash(request)
        result = json.loads(response.text)
        self.assertTrue(result["found"])
        self.assertEqual(result["type"], "loras")
        self.assertEqual(result["filename"], "b/shared.safetensors")
        self.assertTrue(result["matched_by_hash"])
        self.assertTrue(result["matched_by_size"])

    async def test_conflicting_hash_and_size_are_rejected_without_type_context(self):
        request = types.SimpleNamespace(query={"hash": self.lora_hash, "size": str(self.checkpoint_size)})
        response = await models.api_resolve_hash(request)
        result = json.loads(response.text)
        self.assertFalse(result["found"])
        self.assertTrue(result["identity_conflict"])

    async def test_stale_hash_recovers_by_unique_size_in_expected_type(self):
        request = types.SimpleNamespace(query={
            "hash": self.lora_hash,
            "size": str(self.checkpoint_size),
            "type": "checkpoints",
        })
        response = await models.api_resolve_hash(request)
        result = json.loads(response.text)
        self.assertTrue(result["found"])
        self.assertEqual(result["type"], "checkpoints")
        self.assertEqual(result["filename"], "a/shared.safetensors")
        self.assertTrue(result["stale_hash"])

    async def test_expected_type_prevents_cross_category_hash_match(self):
        request = types.SimpleNamespace(query={"hash": self.checkpoint_hash, "size": "", "type": "loras"})
        response = await models.api_resolve_hash(request)
        result = json.loads(response.text)
        self.assertFalse(result["found"])

    async def test_source_filename_disambiguates_equal_sizes_with_stale_hash(self):
        original = self.checkpoint_root / "a" / "shared.safetensors"
        original_info = original.with_suffix(".info")
        original_info.write_text(json.dumps({"files": [{
            "name": "original-checkpoint.safetensors",
            "sizeKB": self.checkpoint_size / 1024,
            "hashes": {"SHA256": self.checkpoint_hash},
        }]}), encoding="utf-8")

        duplicate_size = self.checkpoint_root / "c" / "other.safetensors"
        duplicate_size.parent.mkdir(parents=True)
        duplicate_size.write_bytes(original.read_bytes())
        duplicate_size.with_suffix(".info").write_text(json.dumps({"files": [{
            "name": "different-checkpoint.safetensors",
            "sizeKB": self.checkpoint_size / 1024,
            "hashes": {"SHA256": "3" * 64},
        }]}), encoding="utf-8")

        request = types.SimpleNamespace(query={
            "hash": self.lora_hash,
            "size": str(self.checkpoint_size),
            "filename": "original-checkpoint.safetensors",
            "type": "checkpoints",
        })
        response = await models.api_resolve_hash(request)
        result = json.loads(response.text)
        self.assertTrue(result["found"])
        self.assertEqual(result["filename"], "a/shared.safetensors")
        self.assertTrue(result["matched_by_filename_hint"])


if __name__ == "__main__":
    unittest.main()
