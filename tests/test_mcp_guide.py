"""read_guide (api/mcp_guide.py): Anomalous's manual for the AI, taken from the README's marked parts
in both languages, Model Check's rules and the panel blocks' fields, a topic at a time and in parts
that fit an answer; show_panel's own description only names the blocks."""
import json
import re
import sys
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import ai_panels, mcp_fit, mcp_guide, mcp_server, mcp_task_tools  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402

BLOCKS = ("heading", "text", "images", "slider", "picks", "diagram", "models", "table", "list", "params", "choices",
          "input", "progress", "divider")


class GuideTests(unittest.TestCase):
    def test_both_languages_mark_the_same_parts_of_the_readme(self):
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        english, chinese = readme.split('<h2 id="中文">', 1)
        marks = lambda text: re.findall(r"<!-- guide:([a-z_]+) -->", text)
        self.assertEqual(marks(english), marks(chinese), "the same names, in the same order")
        self.assertEqual(len(set(marks(english))), len(marks(english)), "each name once a language")
        self.assertEqual(list(mcp_guide.topics("en")), list(mcp_guide.topics("zh")))
        for lang in ("en", "zh"):
            for name, text in mcp_guide.topics(lang).items():
                with self.subTest(lang=lang, topic=name):
                    self.assertGreater(len(text), 80, "a marked part with its text under the mark")
                    self.assertNotIn("<img", text)
                    self.assertIn(name, mcp_guide.TITLES, "the list names every topic in words")

    def test_every_part_fits_an_answer(self):
        for lang in ("en", "zh"):
            for name in mcp_guide.topics(lang):
                first = mcp_guide.read_guide(name, lang)
                for part in range(1, first.get("parts", 1) + 1):
                    with self.subTest(lang=lang, topic=name, part=part):
                        self.assertLessEqual(mcp_fit.size(mcp_guide.read_guide(name, lang, part)), mcp_fit.BUDGET)
        rules = mcp_guide.read_guide("model_check_rules")
        self.assertGreater(rules["parts"], 1)
        self.assertIn("part=2", rules["more"])
        self.assertNotIn("Where the code is", "".join(mcp_guide.read_guide("model_check_rules", "en", part)["text"]
                                                       for part in range(1, rules["parts"] + 1)), "not the maintainers' section")

    def test_the_list_a_topic_and_the_chinese_words(self):
        listed = mcp_guide.read_guide()
        self.assertEqual([item["topic"] for item in listed["topics"]][-2:], ["model_check_rules", "panel"])
        self.assertLessEqual(mcp_fit.size(listed), mcp_fit.BUDGET)
        self.assertIn("Shift + B", mcp_guide.read_guide("install")["text"])
        self.assertIn("重置悬浮入口位置", mcp_guide.read_guide("install", "zh")["text"], "the words the Chinese window shows")
        self.assertEqual(mcp_guide.read_guide("saves", "zh-CN")["topic"], "saves")
        self.assertEqual(mcp_guide.read_guide("model_check_rules", part=99)["part"], mcp_guide.read_guide("model_check_rules")["parts"])
        with self.assertRaisesRegex(ToolError, "read_guide\\(\\) lists them"):
            mcp_guide.read_guide("nothing")

    def test_show_panel_names_the_blocks_and_the_guide_gives_their_fields(self):
        tools = {tool["name"]: tool for tool in mcp_server._tool_list(True)["tools"]}
        for kind in BLOCKS:
            with self.subTest(block=kind):
                self.assertIn(kind, tools["show_panel"]["description"])
                self.assertIn(f"{kind} {{", mcp_guide.PANEL)
        with self.assertRaisesRegex(ToolError, "read_guide\\(topic='panel'\\)"):
            mcp_task_tools.show_panel({}, "Bad", [{"type": "html"}])
        self.assertIn("read_guide", json.dumps(tools["update_panel"]))
        self.assertEqual(ai_panels.MAX_BLOCKS, 30, "the guide says up to 30 blocks")


if __name__ == "__main__":
    unittest.main()
