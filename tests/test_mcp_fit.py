"""An answer read in the chat (api/mcp_fit.py): a list answer past the budget keeps what fits and says
what it left out; the canvas, answers of other shapes, small ones and failures stay as they are."""
import sys
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import mcp_fit  # noqa: E402
from api.mcp_tools import tool_text  # noqa: E402


def answer(data, *extra):
    return {"content": [{"type": "text", "text": tool_text(data)}, *extra], "structuredContent": data, "isError": False}


COMBOS = {"total_matches": 30, "combos": [{"name": f"combo {at}", "prompt": "x" * 400} for at in range(30)]}


class FitTests(unittest.TestCase):
    def test_a_long_list_keeps_what_fits_and_says_the_rest(self):
        picture = {"type": "image", "data": "...", "mimeType": "image/png"}
        result = mcp_fit.fit(answer(COMBOS, picture), "list_combos")
        data = result["structuredContent"]
        self.assertLessEqual(mcp_fit.size(data), mcp_fit.BUDGET)
        self.assertEqual(result["content"][0]["text"], tool_text(data), "the text says what the structured answer says")
        self.assertEqual([item["name"] for item in data["combos"]], [f"combo {at}" for at in range(len(data["combos"]))], "in order")
        self.assertIn(f"{30 - len(data['combos'])} more combos", data["left_out"])
        self.assertEqual(data["more_names"], [f"combo {at}" for at in range(len(data["combos"]), 30)], "the rest by name")
        self.assertEqual(data["total_matches"], 30)
        self.assertEqual(result["content"][1], picture, "pictures sent with it stay")
        self.assertEqual(len(COMBOS["combos"]), 30, "the answer the timeline recorded is not changed")

    def test_what_stays_whole(self):
        nodes = {"node_count": 40, "nodes": [{"id": at, "type": "KSampler", "settings": {"x": "y" * 200}} for at in range(40)]}
        two = {"a": COMBOS["combos"], "b": COMBOS["combos"]}
        for data, name in ((nodes, "describe_canvas"), (two, "something"), ({"combos": COMBOS["combos"][:2]}, "list_combos")):
            with self.subTest(name=name):
                result = answer(data)
                self.assertNotIn("left_out", mcp_fit.fit(result, name)["structuredContent"])
        failed = {"content": [{"type": "text", "text": "x" * 9000}], "isError": True}
        self.assertEqual(mcp_fit.fit(failed, "list_combos"), failed)


if __name__ == "__main__":
    unittest.main()
