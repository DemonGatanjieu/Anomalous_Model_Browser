"""The directory of tools by what an AI wants to do (api/mcp_directory.py): built from the catalog,
in begin_task's answer and in get_situation's while there is no task; and the daily set, where
tool_help and use_tool reach the tools not offered directly, which the directory marks."""
import sys
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import action_catalog, ai_gates, ai_tasks, mcp_apps, mcp_directory, mcp_server  # noqa: E402
from test_mcp import rpc  # noqa: E402  (its module keeps tasks and gates in temporary folders)


def call(name, arguments):
    return rpc("tools/call", {"name": name, "arguments": arguments}, name)["result"]


class DirectoryTests(unittest.TestCase):
    def test_every_stage_has_a_heading_and_every_tool_a_line(self):
        stages = {stage for stage, _heading in mcp_directory.SECTIONS}
        self.assertTrue({entry.stage for entry in action_catalog.TOOLS.values()} <= stages, "a new stage needs a heading")
        specs = {name: tool["spec"] for name, tool in mcp_server.TOOLS.items() if name not in mcp_apps.APP_TOOLS}
        text = " ".join(mcp_directory.directory(specs).values())
        self.assertTrue(all(f"{name} (" in text for name in specs), "every tool is in it")
        self.assertIn("set_model (Swap a node's model)", text)

    def test_only_the_tools_offered_in_the_catalogs_order(self):
        specs = {name: mcp_server.TOOLS[name]["spec"] for name in ("run_status", "run_workflow", "zoom_image")}
        found = mcp_directory.directory(specs)
        self.assertEqual(found["Run a workflow"], "run_workflow (Run the workflow), run_status (How the run is going)")
        self.assertEqual(set(found), {"note", "Run a workflow", "Pictures"})

    def test_begin_task_carries_the_directory(self):
        result = call("begin_task", {"title": "目录", "new_task": True})
        found = result["structuredContent"]["directory"]
        self.assertIn("run_workflow", found["Run a workflow"])
        self.assertNotIn("[use_tool]", " ".join(found.values()), "the full set offers every tool")
        self.assertIn('"directory"', result["content"][0]["text"], "the text says it too")
        self.assertLess(len(result["content"][0]["text"]), 4000, "small enough to stay in the chat")

    def test_get_situation_carries_it_only_without_a_task(self):
        with mock.patch.object(mcp_server.ai_tasks, "active_task_id", return_value=None), \
                mock.patch("api.mcp_situation.ask_page", side_effect=mcp_server.mcp_bridge.PageUnavailable("no page")):
            self.assertIn("directory", call("get_situation", {})["structuredContent"])
        call("begin_task", {"title": "有任务", "new_task": True})
        with mock.patch("api.mcp_situation.ask_page", side_effect=mcp_server.mcp_bridge.PageUnavailable("no page")):
            self.assertNotIn("directory", call("get_situation", {})["structuredContent"])


class DailyTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(ai_gates, "tool_set", return_value="daily")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_the_everyday_tools_and_the_way_to_the_rest(self):
        names = {tool["name"] for tool in rpc("tools/list")["result"]["tools"]}
        self.assertEqual(names, action_catalog.DAILY | set(mcp_directory.DIRECTORY_TOOLS) | set(mcp_apps.APP_TOOLS))
        found = call("begin_task", {"title": "日常", "new_task": True})["structuredContent"]["directory"]
        text = " ".join(found.values())
        self.assertIn("set_model (Swap a node's model)", text)
        self.assertNotIn("set_model (Swap a node's model) [use_tool]", text, "offered directly: no mark")
        self.assertIn("download_model (", text)
        self.assertIn("[use_tool]", found["Models"], "the others are marked")
        self.assertIn("use_tool(name, arguments)", found["note"])
        self.assertNotIn("tool_help (", text)

    def test_the_full_set_does_not_offer_the_way_in(self):
        with mock.patch.object(ai_gates, "tool_set", return_value="full"):
            names = {tool["name"] for tool in rpc("tools/list")["result"]["tools"]}
        self.assertFalse(names & set(mcp_directory.DIRECTORY_TOOLS))

    def test_tool_help_tells_what_a_tool_takes(self):
        answer = call("tool_help", {"names": ["set_model", "nope"]})["structuredContent"]
        self.assertEqual(answer["tools"][0]["name"], "set_model")
        self.assertIn("model_id", answer["tools"][0]["arguments"])
        self.assertEqual(answer["not_found"], ["nope"])
        self.assertTrue(call("tool_help", {"names": ["a", "b", "c", "d"]})["isError"], "three at most")

    def test_use_tool_is_the_call_of_the_tool_it_names(self):
        call("begin_task", {"title": "调用", "new_task": True})
        with mock.patch.object(ai_gates, "check", wraps=ai_gates.check) as gate:
            result = call("use_tool", {"name": "report", "arguments": {"text": "看看这张"}})
        self.assertFalse(result["isError"], result)
        self.assertEqual(gate.call_args[0][0], "report", "the user's gates see the tool itself")
        task = next(item for item in ai_tasks.list_tasks() if item["title"] == "调用")
        tools = [step["tool"] for step in ai_tasks.get_task(task["id"])["steps"]]
        self.assertIn("report", tools)
        self.assertNotIn("use_tool", tools, "the timeline shows the tool, never use_tool")

    def test_a_wrong_use_says_where_to_look(self):
        self.assertIn("No tool nope", call("use_tool", {"name": "nope"})["content"][0]["text"])
        self.assertTrue(call("use_tool", {"name": "app_answer", "arguments": {}})["isError"], "never the card's own")
        failed = call("use_tool", {"name": "report", "arguments": {"words": "x"}})
        self.assertTrue(failed["isError"])
        self.assertIn('tool_help(names=["report"])', failed["content"][0]["text"])


if __name__ == "__main__":
    unittest.main()
