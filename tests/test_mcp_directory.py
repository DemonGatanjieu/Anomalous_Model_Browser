"""The directory of tools by what an AI wants to do (api/mcp_directory.py): built from the catalog,
only the tools offered, in begin_task's answer and in get_situation's while there is no task."""
import sys
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import action_catalog, ai_gates, mcp_apps, mcp_directory, mcp_server  # noqa: E402
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

    def test_begin_task_carries_the_directory_of_the_tools_offered(self):
        with mock.patch.object(ai_gates, "tool_set", return_value="daily"):
            result = call("begin_task", {"title": "目录", "new_task": True})
        found = result["structuredContent"]["directory"]
        self.assertIn("run_workflow", found["Run a workflow"])
        self.assertNotIn("download_model", " ".join(found.values()), "not offered in the daily set")
        self.assertIn('"directory"', result["content"][0]["text"], "the text says it too")
        self.assertLess(len(result["content"][0]["text"]), 4000, "small enough to stay in the chat")

    def test_get_situation_carries_it_only_without_a_task(self):
        with mock.patch.object(mcp_server.ai_tasks, "active_task_id", return_value=None), \
                mock.patch("api.mcp_situation.ask_page", side_effect=mcp_server.mcp_bridge.PageUnavailable("no page")):
            self.assertIn("directory", call("get_situation", {})["structuredContent"])
        call("begin_task", {"title": "有任务", "new_task": True})
        with mock.patch("api.mcp_situation.ask_page", side_effect=mcp_server.mcp_bridge.PageUnavailable("no page")):
            self.assertNotIn("directory", call("get_situation", {})["structuredContent"])


if __name__ == "__main__":
    unittest.main()
