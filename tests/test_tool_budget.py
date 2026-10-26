"""The tool budget: what AI apps are handed stays small enough for a light model (Gemini Flash is the
yardstick). On 2026-10-26 Gemini 3.8 Flash ran about 570 calls over the full set in Antigravity with
hardly a wrong one, so the set as it is, is the ceiling: a new tool, or a longer description, has to
make room by merging or cutting. Raise a number here only together with a new Flash run that
shows it still goes well (docs/architecture/tool-exam.md)."""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import ai_gates, mcp_server  # noqa: E402

MAX_TOOLS = 53  # the full set
MAX_CHARS = 44000  # the full list as AI apps get it (about 11k tokens)
MAX_DAILY_CHARS = 29000
MAX_DESCRIPTION = 700  # a tool's own description
LONGER = {"show_panel": 2100}  # its blocks have no schema of their own: the description is their format
MAX_REQUIRED = 2  # what a call needs at least; the rest has a default
INSTRUCTIONS_CHARS = 3400


def listed(tool_set):
    with mock.patch.object(ai_gates, "tool_set", return_value=tool_set):
        return mcp_server._tool_list(True)["tools"]


class BudgetTests(unittest.TestCase):
    def test_the_set_does_not_grow(self):
        tools = listed("full")
        self.assertLessEqual(len(tools), MAX_TOOLS, "a new tool: merge or cut one")
        self.assertLessEqual(len(json.dumps(tools, ensure_ascii=False)), MAX_CHARS)
        self.assertLessEqual(len(json.dumps(listed("daily"), ensure_ascii=False)), MAX_DAILY_CHARS)
        self.assertLessEqual(len(mcp_server.INSTRUCTIONS), INSTRUCTIONS_CHARS)

    def test_each_tool_is_short_and_needs_little(self):
        for tool in listed("full"):
            with self.subTest(tool=tool["name"]):
                self.assertLessEqual(len(tool.get("description") or ""), LONGER.get(tool["name"], MAX_DESCRIPTION))
                self.assertLessEqual(len(tool["inputSchema"].get("required") or []), MAX_REQUIRED)
                self.assertTrue(tool.get("description"), "every tool says what it is for")


if __name__ == "__main__":
    unittest.main()
