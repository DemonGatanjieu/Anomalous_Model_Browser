"""Where a model's side files are (model_sidecars.py) and Settings → Models → "Side files"
(api/sidecar_layout.py): the hidden .amb folder, reading from either place, moving there and
back, and Civitai's picture kept once instead of twice."""
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

import model_sidecars as sidecars  # noqa: E402
from api import metadata as metadata_module, model_media, sidecar_layout  # noqa: E402
from api.metadata import get_metadata  # noqa: E402


def write(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data), encoding="utf-8")


class SidecarTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)
        self.config = self.dir / "config.json"
        patch = mock.patch.object(sidecars, "CONFIG_PATH", str(self.config))
        patch.start()
        self.addCleanup(patch.stop)
        sidecars._layout["mtime"] = None
        self.addCleanup(sidecars._layout.update, mtime=None, value="beside")
        metadata_module.clear_metadata_cache()
        self.models = self.dir / "loras"
        self.models.mkdir()

    def model(self, name):
        path = self.models / name
        path.write_bytes(b"model")
        return str(path.with_suffix(""))

    def set_layout(self, layout):
        write(self.config, {"SIDECAR_LAYOUT": layout, "OTHER": 1})

    def test_new_files_go_where_the_setting_says_and_are_read_from_either_place(self):
        base = self.model("a.safetensors")
        self.assertEqual(sidecars.target(base, ".info"), base + ".info")  # beside by default
        self.set_layout("hidden")
        info = sidecars.target(base, ".info")
        self.assertEqual(info, os.path.join(str(self.models), ".amb", "a.info"))
        self.assertTrue(os.path.isdir(self.models / ".amb"))
        self.assertEqual(sidecars.target(base, ".preview.png"), base + ".preview.png")  # covers stay beside
        write(base + ".anomalous.json", {"custom_name": "Mine"})  # left beside from before
        self.assertEqual(sidecars.target(base, ".anomalous.json"), base + ".anomalous.json")  # written where it is
        write(info, {"id": 3, "name": "v1", "model": {"name": "A"}})
        found = get_metadata(base + ".safetensors")
        self.assertEqual((found["custom_name"], found["info_source"]), ("Mine", "civitai"))

    def test_a_renamed_model_takes_its_side_files_along_to_the_same_kind_of_place(self):
        self.set_layout("hidden")
        base = self.model("a.safetensors")
        write(sidecars.target(base, ".info"), {"id": 3})
        Path(base + ".preview.png").write_bytes(b"cover")
        renamed = os.path.join(str(self.models), "b")
        moved = {sidecars.follow(path, renamed, suffix) for path, suffix in sidecars.existing(base, (".info", ".preview.png"))}
        self.assertEqual(moved, {os.path.join(str(self.models), ".amb", "b.info"), renamed + ".preview.png"})

    def library(self):
        return [("loras", str(self.models), str(path), path.name) for path in sorted(self.models.glob("*.safetensors"))]

    def test_tidying_moves_them_and_drops_civitais_picture_kept_twice(self):
        self.set_layout("beside")
        a, b = self.model("a.safetensors"), self.model("b.safetensors")
        write(a + ".info", {"id": 3})
        Path(a + ".preview.png").write_bytes(b"civitai a")
        Path(a + ".civitai_bak.png").write_bytes(b"civitai a")  # the same picture twice
        write(b + ".info", {"id": 4})
        write(b + ".anomalous.json", {"custom_notes": "x"})
        Path(b + ".preview.png").write_bytes(b"my own picture")
        Path(b + ".civitai_bak.png").write_bytes(b"civitai b")  # kept aside: the user's cover shows
        trashed = []

        def trash(*paths):
            trashed.extend(paths)
            for path in paths:
                os.remove(path)
            return list(paths)

        with mock.patch.object(sidecar_layout, "_models", side_effect=self.library), \
                mock.patch.object(sidecar_layout, "move_to_trash", side_effect=trash):
            self.assertEqual(sidecar_layout.plan("hidden"), {"layout": "hidden", "moves": 4, "duplicates": 1, "models": 2})
            done = sidecar_layout.apply("hidden")
            self.assertEqual((done["moved"], done["deduped"], done["failed"]), (4, 1, []))
            self.assertEqual(json.loads(self.config.read_text())["OTHER"], 1)  # the rest of the settings stay
            hidden = self.models / ".amb"
            self.assertEqual(sorted(path.name for path in hidden.iterdir()), ["a.info", "b.anomalous.json", "b.civitai_bak.png", "b.info"])
            self.assertEqual(sorted(path.name for path in self.models.iterdir()),
                             [".amb", "a.preview.png", "a.safetensors", "b.preview.png", "b.safetensors"])
            self.assertEqual(trashed, [a + ".civitai_bak.png"])
            self.assertTrue(sidecars.is_civitai_cover(a + ".preview.png", a))  # still known as Civitai's
            self.assertFalse(sidecars.is_civitai_cover(b + ".preview.png", b))

            self.assertEqual(sidecar_layout.apply("beside")["moved"], 4)
            self.assertFalse(hidden.exists())  # nothing left in it
            self.assertTrue(os.path.isfile(b + ".civitai_bak.png"))

    def test_a_file_already_at_the_destination_is_left_and_named(self):
        self.set_layout("beside")
        base = self.model("a.safetensors")
        write(base + ".info", {"id": 3})
        write(self.models / ".amb" / "a.info", {"id": 99})
        with mock.patch.object(sidecar_layout, "_models", side_effect=self.library):
            done = sidecar_layout.apply("hidden")
        self.assertEqual(done["moved"], 0)
        self.assertEqual(len(done["failed"]), 1)
        self.assertEqual(json.loads(Path(base + ".info").read_text())["id"], 3)  # nothing overwritten

    def test_a_new_cover_keeps_civitais_picture_aside_to_bring_back(self):
        self.set_layout("hidden")
        base = self.model("a.safetensors")
        write(sidecars.target(base, ".info"), {"id": 3})
        Path(base + ".preview.png").write_bytes(b"civitai a")
        sidecars.note_cover_hash(base, base + ".preview.png")

        async def save(path):
            Path(path).write_bytes(b"my own picture")

        with mock.patch.object(model_media, "move_to_trash"):
            asyncio.run(model_media._handle_custom_cover(str(self.models), "a.safetensors", save))
        self.assertEqual(Path(base + ".preview.png").read_bytes(), b"my own picture")
        self.assertEqual((self.models / ".amb" / "a.civitai_bak.png").read_bytes(), b"civitai a")
        covers = model_media._model_covers("loras", 0, str(self.models), base + ".safetensors")
        self.assertTrue(covers["custom"])
        self.assertIn("subfolder=.amb", covers["civitai"])


if __name__ == "__main__":
    unittest.main()
