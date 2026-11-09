"""A prompt in a language the canvas's model cannot read (api/prompt_language.py): Chinese, Japanese or Korean on a
family marked "reads": "English" in model_profiles.json is found; English, a few such characters among English
words, a model that reads them or one whose base is not known are let through."""
import sys
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import model_guide, prompt_language  # noqa: E402


class LanguageTests(unittest.TestCase):
    def test_what_counts_as_foreign(self):
        self.assertTrue(prompt_language.foreign("樱花树下的石板小路"))
        self.assertTrue(prompt_language.foreign("1girl, 樱花, 回头"))
        self.assertTrue(prompt_language.foreign("さくらの道"))
        self.assertFalse(prompt_language.foreign("a stone path under cherry trees, spring"))
        self.assertFalse(prompt_language.foreign("a stone path under cherry trees, spring, 樱花"), "a word among English ones")
        self.assertFalse(prompt_language.foreign("猫"), "one character")
        self.assertFalse(prompt_language.foreign(""))

    def test_families_that_read_english_only(self):
        reads = {family["family"] for family in model_guide.FAMILIES if family.get("reads") == "English"}
        self.assertTrue({"SDXL", "SD 1.5", "Pony", "Illustrious / NoobAI", "Flux.1"} <= reads)
        self.assertFalse({"Anima", "Qwen-Image", "Z-Image"} & reads, "these read Chinese")

    def test_check(self):
        bases = {"2D/reed.safetensors": "Illustrious", "anima.safetensors": "Anima", "mystery.safetensors": ""}
        with mock.patch.object(prompt_language, "_family", side_effect=lambda name: model_guide.profile(bases.get(name, ""))):
            self.assertEqual(prompt_language.check(["2D/reed.safetensors"], ["雪地里的红色谷仓"]),
                             {"family": "Illustrious / NoobAI", "model": "reed.safetensors"})
            self.assertEqual(prompt_language.check(["2D/reed.safetensors"], ["a red barn in the snow"]), {})
            self.assertEqual(prompt_language.check(["anima.safetensors"], ["雪地里的红色谷仓"]), {}, "Anima reads Chinese")
            self.assertEqual(prompt_language.check(["mystery.safetensors"], ["雪地里的红色谷仓"]), {}, "an unknown base is not judged")


if __name__ == "__main__":
    unittest.main()
