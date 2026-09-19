import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]


def load_folder_types(fake_folder_paths):
    sys.modules["folder_paths"] = fake_folder_paths
    spec = importlib.util.spec_from_file_location("amb_folder_types_test", ROOT / "api" / "folder_types.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_model_catalog(fake_folder_paths, metadata_reader):
    package = types.ModuleType("amb_catalog_test")
    package.__path__ = [str(ROOT)]
    api_package = types.ModuleType("amb_catalog_test.api")
    api_package.__path__ = [str(ROOT / "api")]
    sys.modules["amb_catalog_test"] = package
    sys.modules["amb_catalog_test.api"] = api_package
    sys.modules["folder_paths"] = fake_folder_paths

    dependencies = {
        "metadata": {"get_metadata": metadata_reader},
        "model_constants": {
            "MEDIA_EXTENSIONS": [], "MODEL_EXTENSIONS": [], "PREVIEW_SUFFIXES": [],
        },
        "model_media": {
            "_cache_token": lambda path: "0", "_preview_url_for_model": lambda *args: "",
        },
        "path_utils": {"resolve_folder_subdir": lambda *args: None},
        "folder_types": {
            "get_active_folder_types": lambda: [],
            "get_active_model_roots": lambda: [],
            "get_active_physical_basenames": lambda: [],
            "get_folder_view_mode": lambda: "abstract",
        },
    }
    for name, attrs in dependencies.items():
        module = types.ModuleType(f"amb_catalog_test.api.{name}")
        for attr_name, value in attrs.items():
            setattr(module, attr_name, value)
        sys.modules[module.__name__] = module

    spec = importlib.util.spec_from_file_location(
        "amb_catalog_test.api.model_catalog", ROOT / "api" / "model_catalog.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_metadata():
    package = types.ModuleType("amb_metadata_test")
    package.__path__ = [str(ROOT)]
    api_package = types.ModuleType("amb_metadata_test.api")
    api_package.__path__ = [str(ROOT / "api")]
    identity = types.ModuleType("amb_metadata_test.model_identity")
    identity.sidecar_file_hash = lambda data, file_path, selected_file: ("", "")
    sys.modules[package.__name__] = package
    sys.modules[api_package.__name__] = api_package
    sys.modules[identity.__name__] = identity
    sys.modules.setdefault("folder_paths", types.SimpleNamespace())
    spec = importlib.util.spec_from_file_location(
        "amb_metadata_test.api.metadata", ROOT / "api" / "metadata.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ModelSourceRootTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.checkpoints_a = root / "checkpoints-a"
        self.checkpoints_b = root / "checkpoints-b"
        self.clip = root / "clip"
        for path in (self.checkpoints_a, self.checkpoints_b, self.clip):
            path.mkdir()
        self.fake = types.SimpleNamespace(
            folder_names_and_paths={"checkpoints": object(), "clip": object()},
            get_folder_paths=lambda kind: {
                "checkpoints": [str(self.checkpoints_a), str(self.checkpoints_b)],
                "clip": [str(self.clip)],
            }[kind],
        )
        self.module = load_folder_types(self.fake)

    def tearDown(self):
        self.temp.cleanup()

    def test_abstract_mode_keeps_only_enabled_categories_and_locators(self):
        with mock.patch.object(self.module, "get_folder_view_mode", return_value="abstract"), \
             mock.patch.object(self.module, "get_active_folder_types", return_value=["checkpoints"]):
            roots = self.module.get_active_model_roots()
        self.assertEqual([item["path_idx"] for item in roots], [0, 1])
        self.assertEqual({item["type"] for item in roots}, {"checkpoints"})
        self.assertNotIn(os.path.realpath(self.clip), {item["base_dir"] for item in roots})

    def test_physical_mode_checks_each_registered_root(self):
        with mock.patch.object(self.module, "get_folder_view_mode", return_value="physical"), \
             mock.patch.object(self.module, "get_active_physical_basenames", return_value=["checkpoints-b"]):
            roots = self.module.get_active_model_roots()
        self.assertEqual(roots, [{
            "type": "checkpoints",
            "path_idx": 1,
            "base_dir": os.path.realpath(self.checkpoints_b),
        }])

    def test_realpath_aliases_are_deduplicated(self):
        self.fake.get_folder_paths = lambda kind: [str(self.checkpoints_a)]
        with mock.patch.object(self.module, "get_folder_view_mode", return_value="abstract"), \
             mock.patch.object(self.module, "get_active_folder_types", return_value=["checkpoints", "clip"]):
            roots = self.module.get_active_model_roots()
        self.assertEqual(len(roots), 1)
        self.assertEqual((roots[0]["type"], roots[0]["path_idx"]), ("checkpoints", 0))

    def test_physical_defaults_do_not_auto_enable_clip(self):
        with mock.patch.object(self.module, "get_all_physical_basenames", return_value=["checkpoints", "clip"]), \
             mock.patch.object(self.module.os.path, "exists", return_value=False):
            active = self.module.get_active_physical_basenames()
        self.assertEqual(active, ["checkpoints"])


class ModelSourceCatalogTests(unittest.TestCase):
    def test_lists_gguf_and_pth_case_insensitively_without_touching_hidden_root(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            visible = root / "visible"
            hidden = root / "hidden"
            visible.mkdir()
            hidden.mkdir()
            for filename in ("A.GGUF", "b.pTh", "c.safetensors", "ignore.png"):
                (visible / filename).write_bytes(b"x")
            (hidden / "secret.GGUF").write_bytes(b"x")

            metadata_reads = []
            catalog = load_model_catalog(
                types.SimpleNamespace(folder_names_and_paths={}),
                lambda path: metadata_reads.append(path) or {},
            )
            catalog.get_active_model_roots = lambda: [{
                "type": "text_encoders", "path_idx": 2, "base_dir": str(visible),
            }]
            walked = []
            real_walk = os.walk
            with mock.patch.object(catalog.os, "walk", side_effect=lambda path: walked.append(path) or real_walk(path)):
                payload = catalog._collect_all_scan_models(1, 0)

            self.assertEqual({item["filename"] for item in payload["models"]}, {"A.GGUF", "b.pTh", "c.safetensors"})
            self.assertEqual({item["path_idx"] for item in payload["models"]}, {2})
            self.assertEqual(walked, [str(visible)])
            self.assertTrue(metadata_reads)
            self.assertFalse(any(str(hidden) in path for path in metadata_reads))

    def test_same_filename_in_distinct_roots_remains_distinct(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            roots = [root / "one", root / "two"]
            for directory in roots:
                directory.mkdir()
                (directory / "same.PTH").write_bytes(b"x")
            catalog = load_model_catalog(types.SimpleNamespace(folder_names_and_paths={}), lambda path: {})
            catalog.get_active_model_roots = lambda: [
                {"type": "clip", "path_idx": index, "base_dir": str(directory)}
                for index, directory in enumerate(roots)
            ]
            payload = catalog._collect_all_scan_models(1, 0)
            self.assertEqual(payload["total"], 2)
            self.assertEqual([item["path_idx"] for item in payload["models"]], [0, 1])


class ModelSourceMetadataTests(unittest.TestCase):
    def test_offline_sentinel_ids_do_not_become_civitai_sources(self):
        metadata = load_metadata()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "offline.safetensors")
            path.write_bytes(b"payload")
            path.with_suffix(".info").write_text(json.dumps({"id": -1, "modelId": -1}))
            result = metadata.get_metadata(str(path))
        self.assertEqual(result["civitai_url"], "")
        self.assertNotIn("model_id", result)
        self.assertNotIn("version_id", result)

    def test_positive_civitai_ids_still_build_release_url(self):
        metadata = load_metadata()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "online.safetensors")
            path.write_bytes(b"payload")
            path.with_suffix(".info").write_text(json.dumps({"id": "456", "modelId": "123"}))
            result = metadata.get_metadata(str(path))
        self.assertEqual(result["civitai_url"], "https://civitai.com/models/123?modelVersionId=456")
        self.assertEqual(result["model_id"], 123)
        self.assertEqual(result["version_id"], 456)


if __name__ == "__main__":
    unittest.main()
