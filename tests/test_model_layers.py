"""The user's layer comes first: editor edits, covers and what a scan may touch."""
import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

import scraper
from api import metadata as metadata_module, model_metadata, scan_summary
from api.metadata import get_metadata

CIVITAI = {"id": 7, "modelId": 3, "name": "v2", "model": {"name": "Found"},
           "images": [{"url": "https://example.invalid/cover.png"}]}


def write(path, data):
    Path(path).write_text(json.dumps(data), encoding="utf-8")


class Request(dict):  # aiohttp requests also hold values for the middleware
    def __init__(self, body):
        super().__init__()
        self.body = body

    async def json(self):
        return self.body


class LayerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)
        self.model = self.dir / "m.safetensors"
        self.model.write_bytes(b"model")
        self.base = str(self.dir / "m")
        metadata_module.clear_metadata_cache()

    def tearDown(self):
        self.temp.cleanup()

    def scan(self, *flags, cover=b"new civitai image"):
        """Runs the scraper with Civitai and downloads faked; returns what went to the network."""
        calls = {"fetch": 0, "download": 0}

        def fetch(_hash):
            calls["fetch"] += 1
            return json.loads(json.dumps(CIVITAI))

        def download(_url, base_path):
            calls["download"] += 1
            Path(base_path + ".png").write_bytes(cover)
            return base_path + ".png"

        with mock.patch.object(sys, "argv", ["scraper.py", str(self.dir), *flags]), \
                mock.patch.object(scraper, "fetch_civitai_info", side_effect=fetch), \
                mock.patch.object(scraper, "download_media", side_effect=download), \
                mock.patch.object(scraper, "calculate_sha256", side_effect=lambda p: "b" * 64 if p == str(self.model) else open(p, "rb").read().hex()), \
                mock.patch.object(scraper.urllib.request, "urlopen", side_effect=OSError("no network in tests")):
            scraper.main()
        metadata_module.clear_metadata_cache()
        return calls

    def test_an_edited_but_unscanned_model_still_counts_as_new_and_gets_scanned(self):
        write(self.base + ".civitai.info", {"anomalous_custom_name": "Mine"})  # how older versions saved edits
        with mock.patch.object(scan_summary, "get_active_scan_paths", return_value=[str(self.dir)]):
            self.assertEqual(scan_summary._summarize()["new"], 1)
        self.assertEqual(self.scan("--virtual-rename")["fetch"], 1)
        meta = get_metadata(str(self.model))
        self.assertEqual(meta["info_source"], "civitai")
        self.assertEqual(meta["custom_name"], "Mine")  # the old edit still wins over Civitai's name

    def test_user_layer_wins_and_an_emptied_field_stays_empty(self):
        write(self.base + ".info", {"id": 7, "modelId": 3, "name": "v2", "anomalous_custom_name": "Found_v2"})
        write(self.base + ".anomalous.json", {"format": 1, "custom_name": "Mine", "custom_notes": ""})
        meta = get_metadata(str(self.model))
        self.assertEqual(meta["custom_name"], "Mine")
        self.assertEqual(meta["custom_notes"], "")
        self.assertEqual(sorted(meta["user_fields"]), ["custom_name", "custom_notes"])
        self.assertEqual(meta["info_source"], "civitai")

    def test_info_source_tells_local_inference_and_unscanned_apart(self):
        self.assertEqual(get_metadata(str(self.model))["info_source"], "")
        write(self.base + ".info", {"id": -1, "modelId": -1, "name": "m"})
        metadata_module.clear_metadata_cache()
        self.assertEqual(get_metadata(str(self.model))["info_source"], "local")

    def test_editor_writes_only_the_user_layer(self):
        write(self.base + ".civitai.info", {"id": 7, "modelId": 3, "name": "from another tool"})
        before = Path(self.base + ".civitai.info").read_text(encoding="utf-8")
        with mock.patch.object(model_metadata, "resolve_folder_subdir", return_value=(str(self.dir), str(self.dir))):
            asyncio.run(model_metadata.api_update_metadata(Request({
                "type": "loras", "filename": "m.safetensors", "custom_name": "Mine", "custom_notes": "note"})))
        self.assertEqual(Path(self.base + ".civitai.info").read_text(encoding="utf-8"), before)
        user = json.loads(Path(self.base + ".anomalous.json").read_text(encoding="utf-8"))
        self.assertEqual((user["custom_name"], user["custom_notes"]), ("Mine", "note"))

    def test_a_scan_does_not_refetch_what_is_on_disk(self):
        write(self.base + ".info", {**CIVITAI, "anomalous_custom_name": "Found_v2"})
        Path(self.base + ".civitai_bak.png").write_bytes(b"old civitai image")
        Path(self.base + ".preview.png").write_bytes(b"old civitai image")
        self.assertEqual(self.scan("--virtual-rename"), {"fetch": 0, "download": 0})

    def test_fetching_again_keeps_the_users_cover(self):
        write(self.base + ".info", CIVITAI)
        Path(self.base + ".civitai_bak.png").write_bytes(b"old civitai image")
        Path(self.base + ".preview.png").write_bytes(b"my own picture")
        self.scan("--force-overwrite", "--virtual-rename")
        self.assertEqual(Path(self.base + ".preview.png").read_bytes(), b"my own picture")
        self.assertEqual(Path(self.base + ".civitai_bak.png").read_bytes(), b"new civitai image")

    def test_fetching_again_replaces_an_unchanged_civitai_cover(self):
        write(self.base + ".info", CIVITAI)
        Path(self.base + ".civitai_bak.png").write_bytes(b"old civitai image")
        Path(self.base + ".preview.png").write_bytes(b"old civitai image")
        with mock.patch.object(scraper, "move_to_trash") as trash:
            self.scan("--force-overwrite")
        trash.assert_not_called()  # same file name: overwritten in place, nothing to move
        self.assertEqual(Path(self.base + ".preview.png").read_bytes(), b"new civitai image")


if __name__ == "__main__":
    unittest.main()
