"""A model that is a link (on a cloud server the models folder links into a shared, read-only
model disk) is the link: its covers and info are the ones beside it, and its name is the link's."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import metadata, model_import, path_utils


class ModelLinkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(os.path.realpath(self.temp.name), "loras")
        (self.root / "sub").mkdir(parents=True)
        self.model = self.root / "sub" / "style.safetensors"
        self.model.write_bytes(b"model")
        Path(str(self.model)[:-12] + ".info").write_text(json.dumps({"id": 7, "modelId": 3, "name": "v1"}), encoding="utf-8")
        metadata.clear_metadata_cache()
        # The model is a link into the platform's model disk, outside the models folder: what
        # resolving it gives (this computer cannot make links in tests).
        real = os.path.realpath
        outside = os.path.join(self.temp.name, "disk", "6b4679369a8f39728585bf250dd86e8")
        self.resolve = mock.patch("os.path.realpath", side_effect=lambda p: outside if os.path.basename(p) == "style.safetensors" else real(p))

    def tearDown(self):
        self.temp.cleanup()

    def test_its_info_and_name_are_the_ones_beside_the_link(self):
        with self.resolve:
            found = metadata.get_metadata(str(self.model))
        self.assertEqual((found["info_source"], found["name"]), ("civitai", "v1"))
        Path(str(self.model)[:-12] + ".info").unlink()
        metadata.clear_metadata_cache()
        with self.resolve:
            self.assertEqual(metadata.get_metadata(str(self.model))["name"], "style")  # not the disk's file name

    def test_a_model_named_in_its_folder_stays_the_link_but_cannot_leave_the_folder(self):
        folder = str(self.root / "sub")
        with self.resolve:
            self.assertEqual(path_utils.model_file_within(folder, "style.safetensors"), str(self.model))
            self.assertEqual(path_utils.model_reference_within(str(self.root), os.path.join("sub", "style.safetensors")), str(self.model))
        for name in ("..", ".", "", "../x.safetensors", "sub/style.safetensors"):
            with self.assertRaises(ValueError, msg=name):
                path_utils.model_file_within(folder, name)
        with self.assertRaises(ValueError):
            path_utils.model_reference_within(str(self.root), os.path.join("..", "elsewhere", "x.safetensors"))

    def test_moving_a_linked_model_renames_the_link_instead_of_copying_the_disk(self):
        # The link is on the server's disk; the file behind it is on the platform's model disk.
        real_stat = os.stat
        def stat(path, *args, **kwargs):
            found = real_stat(path, *args, **kwargs)
            if os.path.basename(path) != "style.safetensors":
                return found
            return os.stat_result((found.st_mode, found.st_ino, found.st_dev + 1, *tuple(found)[3:]))
        dest = str(self.root / "style_moved.safetensors")
        with mock.patch("os.stat", side_effect=stat):
            self.assertTrue(model_import._same_drive(str(self.model), dest))
            model_import.move_into(str(self.model), dest, keep=False)
        self.assertTrue(os.path.isfile(dest))
        self.assertFalse(self.model.exists())


if __name__ == "__main__":
    unittest.main()
