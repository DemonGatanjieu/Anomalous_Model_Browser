"""A shorter tool list chosen by the address (?tools=core | mine, api/mcp_tool_sets.py): only the list
shrinks, the instructions name only listed tools, the user's pick is kept, every tool has a label."""
import asyncio
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from aiohttp.test_utils import make_mocked_request

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import ai_tasks, mcp_apps, mcp_server, mcp_situation, mcp_tool_sets  # noqa: E402

_AI_TASKS = tempfile.mkdtemp(prefix="amb_tool_sets_")
ai_tasks.tasks_dir = lambda: os.path.join(_AI_TASKS, "anomalous", "ai_tasks")
os.makedirs(ai_tasks.tasks_dir(), exist_ok=True)
ai_tasks._tasks = None


def post(path, body):
    transport = mock.Mock()
    transport.get_extra_info.side_effect = lambda key, default=None: ("127.0.0.1", 5555) if key == "peername" else default
    request = make_mocked_request("POST", path, transport=transport,
                                  headers={"Host": "127.0.0.1:8188", "Content-Type": "application/json", "MCP-Protocol-Version": "2025-06-18"})
    request.json = lambda: asyncio.sleep(0, body)
    response = asyncio.run(mcp_server.api_mcp(request))
    return json.loads(response.text)


def listed(path):
    return [tool["name"] for tool in post(path, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})["result"]["tools"]]


def instructions(path):
    body = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "sets", "version": "1"}}}
    return post(path, body)["result"]["instructions"]


def named(text):
    return set(re.findall(r"(?<![\w/])(" + "|".join(sorted(mcp_server.TOOLS, key=len, reverse=True)) + r")(?!\w)", text))


class ToolSetTests(unittest.TestCase):
    def setUp(self):
        mcp_tool_sets._mine = None
        try:
            os.remove(mcp_tool_sets._path())
        except FileNotFoundError:
            pass

    def test_the_address_as_it_is_offers_every_tool_and_the_whole_instructions(self):
        self.assertEqual(listed("/anomalous/mcp"), list(mcp_server.TOOLS))
        self.assertEqual(instructions("/anomalous/mcp"), mcp_server.INSTRUCTIONS)
        for unknown in ("/anomalous/mcp?tools=nope", "/anomalous/mcp?tools=mine"):  # "mine" never picked: all
            self.assertEqual(listed(unknown), list(mcp_server.TOOLS))

    def test_core_is_short_and_its_instructions_name_only_its_tools(self):
        names = listed("/anomalous/mcp?tools=core")
        self.assertEqual(set(names), set(mcp_tool_sets.CORE) | set(mcp_apps.APP_TOOLS))  # run_workflow shows the card
        self.assertFalse(set(mcp_tool_sets.NEEDED) & set(names))
        size = len(json.dumps(mcp_server._tool_list(False, set(names))["tools"], ensure_ascii=False))
        self.assertLess(size, 0.7 * len(json.dumps(mcp_server._tool_list(False)["tools"], ensure_ascii=False)))
        text = instructions("/anomalous/mcp?tools=core")
        self.assertLessEqual(named(text.replace(mcp_tool_sets.CHAT_NOTE, "")), set(names))
        self.assertTrue(text.endswith(mcp_tool_sets.CHAT_NOTE))
        self.assertLess(len(text), len(mcp_server.INSTRUCTIONS) * 0.6)

    def test_every_core_tool_exists(self):
        self.assertLessEqual(set(mcp_tool_sets.CORE), set(mcp_server.TOOLS))
        self.assertLessEqual(set(mcp_tool_sets.NEEDED), set(mcp_server.TOOLS))

    def test_the_users_pick_is_kept_in_the_registrys_order_and_offered(self):
        kept = mcp_tool_sets.save_mine(["search_models", "begin_task", "nope", "app_answer", "get_model"], mcp_server.TOOLS)
        self.assertEqual(kept, tuple(name for name in mcp_server.TOOLS if name in ("search_models", "begin_task", "get_model")))
        mcp_tool_sets._mine = None  # read back from the file
        self.assertEqual(listed("/anomalous/mcp?tools=mine"), [name for name in mcp_server.TOOLS if name in kept + tuple(mcp_apps.APP_TOOLS)])
        with self.assertRaises(ValueError):
            mcp_tool_sets.save_mine(["nope"], mcp_server.TOOLS)
        with self.assertRaises(ValueError):
            mcp_tool_sets.save_mine("search_models", mcp_server.TOOLS)

    def test_a_pick_without_a_card_tool_leaves_the_cards_tools_out(self):
        mcp_tool_sets.save_mine(["search_models"], mcp_server.TOOLS)
        self.assertEqual(listed("/anomalous/mcp?tools=mine"), ["search_models"])

    def test_a_tool_left_out_can_still_be_called(self):
        body = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "begin_task", "arguments": {"title": "set test"}}}
        self.assertNotIn("error", post("/anomalous/mcp?tools=core", body))

    def test_without_begin_task_a_look_at_where_things_stand_names_the_ways_and_skills(self):
        call = lambda path: post(path, {"jsonrpc": "2.0", "id": 3, "method": "tools/call",  # noqa: E731
                                        "params": {"name": "get_situation", "arguments": {}, "_meta": {"io.modelcontextprotocol/clientInfo": {"name": path, "version": "1"}}}})
        with mock.patch.object(mcp_situation, "ask_page", return_value={"nodes": 0}),                 mock.patch.object(mcp_tool_sets, "object_info", side_effect=mcp_tool_sets.ToolError("no server")):
            first = call("/anomalous/mcp?tools=core")["result"]["structuredContent"]
            whole = call("/anomalous/mcp")["result"]["structuredContent"]
        self.assertEqual(first["blocks"]["note"], mcp_tool_sets.WAYS_NOTE)
        self.assertGreater(len(first["blocks"]), 1)
        self.assertIn("skills", first)
        self.assertNotIn("blocks", whole, "begin_task says it there")

    def test_every_offered_tool_has_a_label_in_both_languages(self):
        words = (PLUGIN / "web" / "modules" / "locales.js").read_text(encoding="utf-8")
        for name in mcp_server.TOOLS:
            if name not in mcp_apps.APP_TOOLS:
                self.assertEqual(words.count(f"        aiToolSetTool_{name}: "), 2, name)


if __name__ == "__main__":
    unittest.main()
