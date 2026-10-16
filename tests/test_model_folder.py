"""POST /anomalous/open_model_folder: a model file shown selected, or a models folder opened."""
import asyncio
import json
import shutil
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import model_folder, path_utils


class _Request:
    def __init__(self, body):
        self.body = body

    async def json(self):
        return self.body


def ask(body, root):
    with mock.patch.object(model_folder, "resolve_folder_subdir",
                           side_effect=lambda kind, idx, sub: (root, path_utils.resolve_within(root, sub.strip("/")))), \
            mock.patch.object(model_folder, "_reveal") as reveal, \
            mock.patch.object(model_folder, "_open_folder") as open_folder:
        response = asyncio.run(model_folder.api_open_model_folder(_Request(body)))
    return response.status, json.loads(response.text), reveal, open_folder


class OpenModelFolderTests(unittest.TestCase):
    def setUp(self):
        self.root = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, True)
        Path(self.root, "Anime").mkdir()
        Path(self.root, "Anime", "a.safetensors").write_bytes(b"x")

    def test_a_file_is_shown_selected(self):
        status, _, reveal, open_folder = ask({"type": "loras", "subfolder": "/Anime", "filename": "a.safetensors"}, self.root)
        self.assertEqual(status, 200)
        reveal.assert_called_once_with(str(Path(self.root, "Anime", "a.safetensors")))
        open_folder.assert_not_called()

    def test_without_a_file_name_the_folder_opens(self):
        status, _, reveal, open_folder = ask({"type": "loras", "subfolder": "/Anime"}, self.root)
        self.assertEqual(status, 200)
        open_folder.assert_called_once_with(str(Path(self.root, "Anime")))
        reveal.assert_not_called()

    def test_missing_and_outside_are_refused(self):
        self.assertEqual(ask({"type": "loras", "subfolder": "/Nope"}, self.root)[0], 404)
        self.assertEqual(ask({"type": "loras", "subfolder": "/Anime", "filename": "b.safetensors"}, self.root)[0], 404)
        self.assertEqual(ask({"type": "loras", "subfolder": "/../.."}, self.root)[0], 400)
        self.assertEqual(ask({"type": "loras", "subfolder": "/", "filename": "../x"}, self.root)[0], 400)
        self.assertEqual(ask({"type": "loras", "subfolder": "/Anime", "filename": ".."}, self.root)[0], 400)


if __name__ == "__main__":
    unittest.main()
