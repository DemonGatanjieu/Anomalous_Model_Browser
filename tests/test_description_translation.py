"""The model details' Translate (api/description_translation.py): paragraphs in pieces a provider takes, smaller
ones when only MyMemory answers, the answer kept for the same text and language, and nothing sent twice. The
providers are stand-ins; kept in a temporary folder."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import ai_tasks, description_translation as dt  # noqa: E402

TMP = tempfile.mkdtemp(prefix="amb_desc_tr_")


class TranslationTests(unittest.TestCase):
    def setUp(self):
        ai_tasks.tasks_dir = lambda: os.path.join(TMP, "ai_tasks")
        folder = os.path.join(TMP, "translations")
        for name in os.listdir(folder) if os.path.isdir(folder) else []:
            os.remove(os.path.join(folder, name))

    def test_pieces_cut_at_sentences(self):
        text = "One two three. " * 30
        parts = dt.pieces(text.strip(), 100)
        self.assertTrue(all(len(part) <= 100 for part in parts))
        self.assertEqual(" ".join(parts), text.strip())
        self.assertEqual(dt.pieces("x" * 250, 100), ["x" * 100, "x" * 100, "x" * 50], "a sentence too long is cut anywhere")

    def test_translated_once_and_kept(self):
        calls = []

        def chain(text, target):
            calls.append(text)
            return f"[{target}] {text}", "google", None

        with mock.patch.object(dt.translation_routes, "translate_chain", side_effect=chain):
            first = dt.translate(["Hello.", "", "World."], "zh-CN")
            again = dt.translate(["Hello.", "", "World."], "zh-CN")
        self.assertEqual(first["paragraphs"], ["[zh-CN] Hello.", "", "[zh-CN] World."])
        self.assertEqual((first["kept"], again["kept"], first["engine"]), (False, True, "google"))
        self.assertEqual(sorted(calls), ["Hello.", "World."], "the same text is not sent again")

    def test_a_long_piece_goes_small_when_only_mymemory_answers(self):
        def chain(text, target):
            if len(text) > dt.SMALL:
                raise RuntimeError("QUERY LENGTH LIMIT EXCEEDED")
            return text.upper(), "mymemory", None

        long = "Short sentence here. " * 40
        with mock.patch.object(dt.translation_routes, "translate_chain", side_effect=chain):
            done = dt.translate([long.strip()], "en")
        self.assertEqual(done["paragraphs"][0], long.strip().upper())

    def test_bad_requests(self):
        for paragraphs, target, words in (([], "zh-CN", "1 to"), (["a"], "fr", "target"), (["x" * 30001], "en", "over")):
            with self.assertRaisesRegex(ValueError, words):
                dt.translate(paragraphs, target)


if __name__ == "__main__":
    unittest.main()
