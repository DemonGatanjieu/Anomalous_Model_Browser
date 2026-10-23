"""zoom_image (api/mcp_look.py): part of a picture shown larger, the same part of a second one to
compare, in the output, input or temp folder, and nothing outside them. Pictures go to temporary folders."""
import base64
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import mcp_look, mcp_tools  # noqa: E402


def shown(item):
    return Image.open(io.BytesIO(base64.b64decode(item["data"])))


class ZoomTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.dirs = {name: Path(os.path.realpath(temp.name)) / name for name in ("output", "input", "temp")}
        for path in self.dirs.values():
            path.mkdir()
        for name in self.dirs:
            patcher = mock.patch.object(mcp_tools.folder_paths, f"get_{name}_directory", return_value=str(self.dirs[name]))
            patcher.start()
            self.addCleanup(patcher.stop)
        before = Image.new("RGB", (400, 200), "white")
        before.paste((255, 0, 0), (100, 50, 200, 150))  # a red square in the region looked at
        before.save(self.dirs["output"] / "before.png")
        Image.new("RGB", (400, 200), "blue").save(self.dirs["temp"] / "pose_00001_.png")

    def call(self, **arguments):
        return mcp_tools.call_tool(mcp_look.LOOK_TOOLS, "zoom_image", arguments)

    def test_a_region_larger_and_compared(self):
        result = self.call(image="before.png", region={"x": 0.25, "y": 0.25, "width": 0.25, "height": 0.5},
                           compare_with="pose_00001_.png", compare_folder="temp", size=400)
        data = result["structuredContent"]
        self.assertEqual((data["picture"], data["region"], data["shown"]), ("400x200", "x 100-200, y 50-150 px", "400x400"))
        self.assertEqual(data["compare_with"]["folder"], "temp")
        first, second = [item for item in result["content"] if item["type"] == "image"]
        red, green, _ = shown(first).getpixel((200, 200))
        self.assertTrue(red > 240 and green < 20, (red, green))  # the red square, enlarged (JPEG: near enough)
        self.assertGreater(shown(second).getpixel((10, 10))[2], 240)

    def test_whole_picture_and_refusals(self):
        self.assertEqual(self.call(image="before.png")["structuredContent"]["region"], "x 0-400, y 0-200 px")
        for arguments in ({"image": "../before.png"}, {"image": "missing.png"}, {"image": "before.png", "folder": "input"},
                          {"image": "before.png", "region": {"width": 0.001}}, {"image": "before.png", "folder": "models"}):
            self.assertTrue(self.call(**arguments)["isError"], arguments)


if __name__ == "__main__":
    unittest.main()
