"""Covers of the voice characters (api/voice_covers.py): one per character's name (its versions share it), made
again as a small square PNG, listed with a stamp that changes with the picture, taken away to the Recycle Bin
(a stand-in here), and anything that is no picture refused. Kept in a temporary folder."""
import base64
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import ai_tasks, voice_covers  # noqa: E402

TMP = tempfile.mkdtemp(prefix="amb_voice_covers_")


def data_url(width, height, color=(200, 40, 40)):
    out = io.BytesIO()
    Image.new("RGB", (width, height), color).save(out, "PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


class CoverTests(unittest.TestCase):
    def setUp(self):
        ai_tasks.tasks_dir = lambda: os.path.join(TMP, "ai_tasks")
        folder = os.path.join(TMP, "voice_covers")
        for name in os.listdir(folder) if os.path.isdir(folder) else []:
            os.remove(os.path.join(folder, name))

    def test_one_cover_a_name_its_versions_share(self):
        self.assertEqual(voice_covers.base_name("阿罗娜/日配"), "阿罗娜")
        made = voice_covers.set_cover("阿罗娜/日配", data_url(300, 500))
        self.assertEqual(made["name"], "阿罗娜")
        self.assertEqual(list(voice_covers.covers()), ["阿罗娜"])
        with Image.open(voice_covers._file("阿罗娜")) as kept:
            self.assertEqual((kept.size, kept.format), ((voice_covers.SIZE, voice_covers.SIZE), "PNG"))
        again = voice_covers.set_cover("阿罗娜/中配", data_url(64, 64, (10, 200, 10)))
        self.assertNotEqual(again["stamp"], made["stamp"], "a new picture, a new stamp")

    def test_removed_to_the_bin(self):
        voice_covers.set_cover("Aris", data_url(80, 80))
        with mock.patch("api.trash.move_to_trash", side_effect=os.remove) as moved:
            voice_covers.remove_cover("Aris")
        moved.assert_called_once()
        self.assertEqual(voice_covers.covers(), {})

    def test_what_is_refused(self):
        for name, image, words in (("", data_url(8, 8), "character's name"), ("Aris", "hello", "data URL"),
                                   ("Aris", "data:image/png;base64,bm90IGEgcGljdHVyZQ==", "could not be read")):
            with self.assertRaisesRegex(voice_covers.CoverError, words):
                voice_covers.set_cover(name, image)


if __name__ == "__main__":
    unittest.main()
