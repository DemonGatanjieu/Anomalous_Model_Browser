"""The home page's AI cards (api/ai_starters.py, web/modules/ui_ai_starter_sheet.js): the saved workflows with
their presets, which tool list the AI app that came last holds, and every card's words in both languages."""
import json
import os
import re
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import ai_starters, ai_tasks, mcp_directory, mcp_server, mcp_tool_sets  # noqa: E402

_ROOT = tempfile.mkdtemp(prefix="amb_starters_")
ai_tasks.tasks_dir = lambda: os.path.join(_ROOT, "anomalous", "ai_tasks")
os.makedirs(ai_tasks.tasks_dir(), exist_ok=True)
ai_tasks._tasks = None


class StarterTests(unittest.TestCase):
    def test_workflows_come_by_name_with_their_presets(self):
        recipes = [{"filename": "b.json", "data": {"name": "Beta"}}, {"filename": "a.json", "data": {}}]
        with mock.patch.object(ai_starters, "_list_recipes", return_value=recipes), \
                mock.patch.object(ai_starters, "plans", return_value={"b.json": [("p1.json", "Night"), ("p2.json", "Snow")]}):
            self.assertEqual(ai_starters.workflows(), [{"name": "a.json", "presets": []}, {"name": "Beta", "presets": ["Night", "Snow"]}])

    def test_the_app_that_came_last_is_told_with_the_tool_list_it_holds(self):
        self.addCleanup(setattr, mcp_directory, "_lists", None)  # the cache filled here must not reach other tests
        with mock.patch.object(ai_tasks, "list_tasks", return_value=[{"client": "AI", "updated": 1.0}]):
            self.assertIsNone(ai_starters.last_app(mcp_server._tools), "no app named itself")
        mcp_directory._lists = {}
        latest = [{"client": "", "updated": 3.0}, {"client": "antigravity-client", "updated": time.time()}]
        with mock.patch.object(mcp_directory, "_path", return_value=os.path.join(_ROOT, "lists.json")),                 mock.patch.object(ai_tasks, "list_tasks", return_value=latest):
            self.assertEqual(ai_starters.last_app(mcp_server._tools)["tools"], "unknown", "never seen fetching a list")
            core = mcp_tool_sets.chosen("core", mcp_server.TOOLS)
            mcp_directory.listed("antigravity-client", mcp_server._tools(core))
            app = ai_starters.last_app(mcp_server._tools)
            self.assertEqual((app["client"], app["tools"]), ("antigravity-client", "core"))
            mcp_directory.listed("antigravity-client", mcp_server._tools())
            self.assertEqual(ai_starters.last_app(mcp_server._tools)["tools"], "all")
            mcp_directory.listed("antigravity-client", mcp_server._tools()[:3])
            self.assertEqual(ai_starters.last_app(mcp_server._tools)["tools"], "other", "an older Anomalous's list")

    def test_every_card_has_its_words_in_both_languages(self):
        sheet = (PLUGIN / "web" / "modules" / "ui_ai_starter_sheet.js").read_text(encoding="utf-8")
        words = (PLUGIN / "web" / "modules" / "locales.js").read_text(encoding="utf-8")
        cards = re.findall(r"\{ id: '(\w+)', icon: '\w+', tags: \[([^\]]*)\](?:, lines: \[(.*?)\])? \}", sheet)
        self.assertEqual([card[0] for card in cards], ["try", "preset", "say", "picture", "private", "canvas"])
        keys = set()
        for card, tags, lines in cards:
            keys |= {f"aiStart_{card}_title", f"aiStart_{card}_body"}
            keys |= {f"aiStart_{card}_{kind}" for kind in re.findall(r"\['(\w+)'\]", lines)}
            keys |= {f"aiStartTag_{tag}" for tag in re.findall(r"'(\w+)'", tags)} | {f"aiStartTagHint_{tag}" for tag in re.findall(r"'(\w+)'", tags)}
            keys |= {f"aiStartSheet_{kind}" for kind in re.findall(r"\['(\w+)'\]", lines)}
        keys |= set(re.findall(r"t\('(aiStart\w+)'", sheet))
        for key in sorted(keys):
            self.assertEqual(words.count(f"        {key}: "), 2, key)


if __name__ == "__main__":
    unittest.main()
