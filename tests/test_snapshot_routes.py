"""ComfyUI's check of a snapshot mark, in lines the bar can show (api/snapshot_routes.py)."""
import sys
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import snapshot_routes  # noqa: E402


class LineTests(unittest.TestCase):
    def test_a_node_error_names_the_node_not_every_model_there_is(self):
        errors = {"1": {"class_type": "UNETLoader", "errors": [{"message": "Value not in list", "details": "unet_name: 'gone' not in ['a', 'b']"}]}}
        self.assertEqual(snapshot_routes._lines({}, errors), ["UNETLoader: Value not in list unet_name: 'gone'"])

    def test_without_node_errors_the_error_itself(self):
        self.assertEqual(snapshot_routes._lines({"message": "Prompt has no outputs"}, {}), ["Prompt has no outputs"])


if __name__ == "__main__":
    unittest.main()
