"""Ready-made blocks (api/reference_blocks.py) and add_nodes(block=…): what the AI is offered, what a
block needs here, and the group the page is asked to build. No ComfyUI, no page."""
import sys
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import mcp_canvas_edit, mcp_task_tools, reference_blocks  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402

DETECTORS = {"input": {"required": {"model_name": [["bbox/hand_yolov8n.pt", "bbox/hand_yolov8s.pt", "bbox/face_yolov8m.pt", "segm/person_yolov8m-seg.pt"]]}}}
EVERYTHING = {kind: {} for block in reference_blocks.BLOCKS.values() for kind in block["packs"]} | {"UltralyticsDetectorProvider": DETECTORS}
BUILT_IN = {"LoadImage": {}, "KSampler": {}}


class BlockTests(unittest.TestCase):
    def test_the_directory_says_what_each_is_for_and_what_is_missing(self):
        listed = reference_blocks.directory(BUILT_IN)
        self.assertEqual(set(listed), set(reference_blocks.BLOCKS))
        self.assertIn("Needs ComfyUI-Inpaint-CropAndStitch (not installed: use inpaint_basic)", listed["inpaint_crop_stitch"])
        self.assertNotIn("Needs", listed["inpaint_basic"], "ComfyUI's own nodes only")
        self.assertNotIn("Needs", reference_blocks.directory(EVERYTHING)["inpaint_crop_stitch"])
        self.assertNotIn("Needs", reference_blocks.directory()["inpaint_crop_stitch"], "node list unknown: nothing claimed")

    def test_a_repaint_block_is_the_group_with_the_users_picture(self):
        nodes = reference_blocks.nodes_of("inpaint_crop_stitch", EVERYTHING, " anomalous_inpaint_ab.png ")
        self.assertEqual(nodes["picture"]["inputs"]["image"], "anomalous_inpaint_ab.png")
        self.assertEqual(nodes["condition"]["wire_to"], "$sampler", "the page finds the sampler")
        self.assertEqual(nodes["stitch"]["inputs"]["inpainted_image"], ["$decode", 0])
        self.assertEqual(nodes["crop"]["inputs"]["output_target_width"], 1024, "the settings the distilled workflow used")
        self.assertIsNot(nodes["picture"]["inputs"], reference_blocks.BLOCKS["inpaint_crop_stitch"]["nodes"]["picture"]["inputs"])
        with self.assertRaisesRegex(reference_blocks.BlockError, "needs image"):
            reference_blocks.nodes_of("inpaint_basic", BUILT_IN)
        with self.assertRaisesRegex(reference_blocks.BlockError, "not installed here. Use block inpaint_basic"):
            reference_blocks.nodes_of("inpaint_crop_stitch", BUILT_IN, "a.png")
        with self.assertRaisesRegex(reference_blocks.BlockError, "there are: inpaint_crop_stitch"):
            reference_blocks.nodes_of("nope", EVERYTHING)

    def test_detailing_takes_the_detector_models_this_comfyui_has(self):
        nodes = reference_blocks.nodes_of("detail_face_hands", EVERYTHING)
        self.assertEqual(nodes["face_finder"]["inputs"]["model_name"], "bbox/face_yolov8m.pt")
        self.assertEqual(nodes["hand_finder"]["inputs"]["model_name"], "bbox/hand_yolov8s.pt", "s before n")
        self.assertEqual(nodes["face"]["inputs"]["clip"], ["$sampler.positive.clip", "*"])
        no_faces = {**EVERYTHING, "UltralyticsDetectorProvider": {"input": {"required": {"model_name": [["bbox/hand_yolov8s.pt"]]}}}}
        with self.assertRaisesRegex(reference_blocks.BlockError, "No face detector model"):
            reference_blocks.nodes_of("detail_face_hands", no_faces)

    def test_every_link_names_a_node_of_its_block_or_a_role(self):
        for name, block in reference_blocks.BLOCKS.items():
            for key, spec in block["nodes"].items():
                for value in spec["inputs"].values():
                    if isinstance(value, list):
                        with self.subTest(block=name, node=key):
                            self.assertTrue(value[0] in block["nodes"] or value[0].split(".")[0] in ("$sampler", "$decode", "$save"))
                if "wire_to" in spec:
                    self.assertIn(spec["wire_to"], ("$sampler", "$decode", "$save"))


class AddBlockTests(unittest.TestCase):
    def setUp(self):
        for name, value in (("_page", {"nodes": {}, "reaches_output": True}), ("object_info", EVERYTHING)):
            patcher = mock.patch.object(mcp_canvas_edit, name, return_value=value)
            setattr(self, name.strip("_"), patcher.start())
            self.addCleanup(patcher.stop)

    def test_the_page_gets_the_block_spliced_in_with_replace(self):
        answer = mcp_canvas_edit.add_nodes({}, block="inpaint_crop_stitch", image="a.png", near_node_id=5)
        action, payload = self.page.call_args[0]
        self.assertEqual((action, payload["replace"], payload["near_node_id"]), ("add_nodes", True, 5))
        self.assertEqual(payload["roles"], {"sampler": {"denoise": 0.75}}, "the sampler's strength set with it")
        self.assertEqual(payload["nodes"]["picture"]["inputs"]["image"], "a.png")
        self.assertIn("set_prompt it to what belongs in the area", answer["next"], "what to do next with this block")

    def test_nodes_or_block_not_both_and_errors_reach_the_ai(self):
        for arguments in ({}, {"nodes": {"a": {"class_type": "LoadImage"}}, "block": "inpaint_basic"}):
            with self.assertRaisesRegex(ToolError, "either nodes .* or block .*one of the two"):
                mcp_canvas_edit.add_nodes({}, **arguments)
        self.object_info.return_value = BUILT_IN
        with self.assertRaisesRegex(ToolError, "inpaint_basic instead"):
            mcp_canvas_edit.add_nodes({}, block="inpaint_crop_stitch", image="a.png")
        self.assertFalse(self.page.called)

    def test_begin_task_hands_the_ai_the_directory(self):
        with mock.patch.object(mcp_task_tools.ai_tasks, "begin_task", return_value={"id": "t", "title": "修手"}), \
                mock.patch.object(mcp_task_tools.ai_tasks, "get_task", return_value={"id": "t", "steps": []}):
            blocks = mcp_task_tools.begin_task({"client": "A"}, "修手")["blocks"]
        self.assertIn("add_nodes(block=", blocks["note"])
        self.assertIn("inpaint_crop_stitch", blocks)
        self.object_info.side_effect = ToolError("down")
        self.assertNotIn("Needs", mcp_task_tools._blocks({})["inpaint_crop_stitch"], "no node list: the plain directory")


if __name__ == "__main__":
    unittest.main()
