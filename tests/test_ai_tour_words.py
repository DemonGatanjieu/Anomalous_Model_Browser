"""A newcomer's notes on the AI workbench (web/modules/ui_ai_tour.js): every tour step and every first-time
line has its words in both languages, and each first-time line is used where its control is drawn."""
import re
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
MODULES = PLUGIN / "web" / "modules"


class TourWordsTests(unittest.TestCase):
    def test_every_step_and_line_has_both_languages(self):
        tour = (MODULES / "ui_ai_tour.js").read_text(encoding="utf-8")
        words = (MODULES / "locales.js").read_text(encoding="utf-8")
        steps = re.findall(r"step\('(\w+)'", tour)
        self.assertEqual(steps, ["new", "connect", "gates", "list", "menu", "timeline", "message"])
        keys = [f"aiTour_{name}_{part}" for name in steps for part in ("title", "body")] + ["aiFirstHintDone"]
        for key in keys:
            self.assertEqual(words.count(f"        {key}: "), 2, key)

    def test_each_first_time_line_sits_under_its_control(self):
        uses = {"verdict": "ui_ai_verdict.js", "undo": "ui_ai_chain.js", "hide": "ui_ai_message.js"}
        words = (MODULES / "locales.js").read_text(encoding="utf-8")
        for hint, module in uses.items():
            code = (MODULES / module).read_text(encoding="utf-8")
            key = re.search(rf"firstHint\('{hint}', t\('(\w+)'\)\)", code)
            self.assertIsNotNone(key, module)
            self.assertEqual(words.count(f"        {key.group(1)}: "), 2, key.group(1))


if __name__ == "__main__":
    unittest.main()
