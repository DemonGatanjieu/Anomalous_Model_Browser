"""Ready-made blocks (api/reference_blocks.py) and add_nodes(block=…): what the AI is offered, what a
block needs here, and the group the page is asked to build. No ComfyUI, no page."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import ai_pictures, mcp_canvas_edit, mcp_task_tools, reference_blocks  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402

DETECTORS = {"input": {"required": {"model_name": [["bbox/hand_yolov8n.pt", "bbox/hand_yolov8s.pt", "bbox/face_yolov8m.pt", "segm/person_yolov8m-seg.pt"]]}}}
UPSCALERS = {"input": {"required": {"model_name": ["COMBO", {"options": ["2x-Lite.pth", "RealESRGAN_x4plus.pth", "4x-UltraSharp.pth"]}]}}}
CONTROLNETS = {"input": {"required": {"control_net_name": [[
    "SD_1.5/control_v11p_sd15_openpose.safetensors", "anima-lllite-pose-1.safetensors", "SDXL/union-promax.safetensors",
    "NoobAI/noob-openpose.safetensors", "SDXL/xinsir-openpose.safetensors"]]}}}
BASES = {"SD_1.5/control_v11p_sd15_openpose.safetensors": "SD 1.5", "SDXL/union-promax.safetensors": "SDXL 1.0",
         "NoobAI/noob-openpose.safetensors": "NoobAI", "SDXL/xinsir-openpose.safetensors": "SDXL 1.0"}
base = lambda name: BASES.get(name, "")  # noqa: E731
LLLITES = {"input": {"required": {"lllite_name": [["SDXL/union-promax.safetensors", "anima-lllite-depth-1.safetensors",
                                                 "anima-lllite-inpainting-v1.safetensors", "anima-lllite-inpainting-v2.safetensors"]]}}}
EVERYTHING = {kind: {} for block in reference_blocks.BLOCKS.values() for kind in block["packs"]} | {
    "UltralyticsDetectorProvider": DETECTORS, "UpscaleModelLoader": UPSCALERS, "ControlNetLoader": CONTROLNETS,
    "AnimaLLLiteApply_sdscripts": LLLITES}
BUILT_IN = {"LoadImage": {}, "KSampler": {}}


def keep_switches_apart(case):
    """The panel's switches in a temporary file, not the user's."""
    folder = tempfile.TemporaryDirectory()
    case.addCleanup(folder.cleanup)
    patcher = mock.patch.object(reference_blocks, "_off_path", return_value=os.path.join(folder.name, "ai_blocks.json"))
    patcher.start()
    case.addCleanup(patcher.stop)


class BlockTests(unittest.TestCase):
    def setUp(self):
        keep_switches_apart(self)

    def test_the_directory_lists_what_can_run_by_use_and_the_rest_by_what_it_needs(self):
        listed = reference_blocks.directory(BUILT_IN)
        self.assertEqual(listed["repaint"], "Repaint an area", "only what runs here: the built-in one, no want to name")
        self.assertIn("LanPaint: repaint best", listed["Not here yet, needs"], "what to install, by pack")
        self.assertIn("upscaler model: upscale", listed["Not here yet, needs"], "built-in nodes, but no upscale model")
        everything = reference_blocks.directory(EVERYTHING)
        self.assertNotIn("Not here yet, needs", everything)
        self.assertEqual(list(everything), list(reference_blocks.JOBS), "a line a use")
        self.assertEqual(everything["follow"], "Follow a given picture (want: pose, layout, lines, style)")
        self.assertEqual(set(reference_blocks.directory()), set(reference_blocks.JOBS), "node list unknown: all, nothing claimed")
        self.assertLess(len(" ".join(everything.values())), 500, "small: it goes with begin_task")

    def test_a_use_picks_the_best_block_this_comfyui_can_run(self):
        self.assertEqual(reference_blocks.pick("repaint", None, EVERYTHING), "inpaint_crop_stitch")
        self.assertEqual(reference_blocks.pick("repaint", None, BUILT_IN), "inpaint_basic", "the pack missing: the built-in one")
        self.assertEqual(reference_blocks.pick("repaint", "best", BUILT_IN), "inpaint_lanpaint", "asked for: its build says what it needs")
        self.assertEqual(reference_blocks.pick("upscale", "2x", EVERYTHING), "upscale_tiled")
        self.assertEqual(reference_blocks.pick("new_background", None, EVERYTHING, scene=True), "place_in_scene", "a second picture given")
        with self.assertRaisesRegex(reference_blocks.BlockError, "follow takes want: pose, layout, lines, style\."):
            reference_blocks.pick("follow", None, EVERYTHING)
        with self.assertRaisesRegex(reference_blocks.BlockError, "repaint takes want: best, or none"):
            reference_blocks.pick("repaint", "fast", EVERYTHING)
        with self.assertRaisesRegex(reference_blocks.BlockError, "No use 'paint'"):
            reference_blocks.pick("paint")

    def test_a_block_turned_off_is_not_offered_and_cannot_be_built(self):
        reference_blocks.set_on("inpaint_lanpaint", False)
        self.assertNotIn("inpaint_lanpaint", " ".join(reference_blocks.directory(EVERYTHING).values()))
        with self.assertRaisesRegex(reference_blocks.BlockError, "turned block inpaint_lanpaint off"):
            reference_blocks.nodes_of("inpaint_lanpaint", EVERYTHING, "a.png")
        shown = {item["name"]: item for item in reference_blocks.status(BUILT_IN)}
        self.assertEqual((shown["inpaint_lanpaint"]["on"], shown["inpaint_lanpaint"]["usable"]), (False, False))
        self.assertEqual(shown["inpaint_lanpaint"]["packs"], [{"name": "LanPaint", "installed": False}])
        self.assertEqual(shown["upscale"]["models"], [{"kind": "upscaler"}])
        self.assertEqual(shown["control_pose"]["packs"], [{"name": "comfyui_controlnet_aux", "installed": False}])
        self.assertTrue(shown["inpaint_basic"]["usable"])
        self.assertEqual(reference_blocks.set_on("inpaint_lanpaint", True), set())
        with self.assertRaises(reference_blocks.BlockError):
            reference_blocks.set_on("nope", True)

    def test_every_block_has_its_words_in_both_languages(self):
        for name, block in reference_blocks.BLOCKS.items():
            with self.subTest(block=name):
                for field in ("title", "about", "source"):
                    self.assertTrue(block[field]["zh"] and block[field]["en"])
                self.assertIn(block["job"], reference_blocks.JOBS)
                self.assertTrue(block["short"] and block["after"])

    def test_a_repaint_block_is_the_group_with_the_users_picture(self):
        nodes = reference_blocks.nodes_of("inpaint_crop_stitch", EVERYTHING, " anomalous_inpaint_ab.png ")
        self.assertEqual(nodes["picture"]["inputs"]["image"], "anomalous_inpaint_ab.png")
        self.assertEqual(nodes["condition"]["wire_to"], "$sampler", "the page finds the sampler")
        self.assertEqual(nodes["stitch"]["inputs"]["inpainted_image"], ["$decode", 0])
        self.assertEqual(nodes["crop"]["inputs"]["output_target_width"], 1024, "the settings the distilled workflow used")
        self.assertIsNot(nodes["picture"]["inputs"], reference_blocks.BLOCKS["inpaint_crop_stitch"]["nodes"]["picture"]["inputs"])
        with self.assertRaisesRegex(reference_blocks.BlockError, "needs image"):
            reference_blocks.nodes_of("inpaint_basic", BUILT_IN)
        with self.assertRaisesRegex(reference_blocks.BlockError, "needs scene"):
            reference_blocks.build("place_in_scene", EVERYTHING, "a.png")
        placed = reference_blocks.build("place_in_scene", EVERYTHING, "a.png", scene="beach.png")["nodes"]
        self.assertEqual((placed["picture"]["inputs"]["image"], placed["place"]["inputs"]["image"]), ("a.png", "beach.png"))
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

    def test_upscaling_takes_an_upscale_model_and_brings_it_to_a_quarter_larger(self):
        nodes = reference_blocks.nodes_of("upscale", EVERYTHING)
        self.assertEqual((nodes["upscaler"]["inputs"]["model_name"], nodes["fit"]["inputs"]["scale_by"]), ("2x-Lite.pth", 0.625), "a 2× one: enough for 1.25×, less work")
        self.assertEqual((nodes["redraw"]["like"], nodes["redraw"]["inputs"]["denoise"]), ("$sampler", 0.35))
        self.assertEqual(nodes["enlarge"]["inputs"]["image"], ["$save.images", "*"], "the saved picture, stitched or not")
        only_2x = {**EVERYTHING, "UpscaleModelLoader": {"input": {"required": {"model_name": [["2x-Lite.pth"]]}}}}
        self.assertEqual(reference_blocks.nodes_of("upscale", only_2x)["fit"]["inputs"]["scale_by"], 0.625)
        with self.assertRaisesRegex(reference_blocks.BlockError, "No upscale model"):
            reference_blocks.nodes_of("upscale_tiled", {**EVERYTHING, "UpscaleModelLoader": {}})
        self.assertIn("ComfyUI_UltimateSDUpscale: upscale 2x", reference_blocks.directory(BUILT_IN)["Not here yet, needs"])

    def test_a_node_only_making_a_block_better_goes_when_its_pack_is_missing(self):
        nodes = reference_blocks.nodes_of("upscale", {**EVERYTHING, "ColorMatch": {}})
        self.assertEqual((nodes["match"]["inputs"]["image_target"], nodes["save"]["inputs"]["images"]), (["decode", 0], ["match", 0]))
        self.assertNotIn("optional", nodes["match"])
        plain = reference_blocks.nodes_of("upscale", {key: value for key, value in EVERYTHING.items() if key != "ColorMatch"})
        self.assertEqual(("match" in plain, plain["save"]["inputs"]["images"]), (False, ["decode", 0]))
        shown = {item["name"]: item for item in reference_blocks.status(BUILT_IN)}
        self.assertEqual(shown["upscale"]["better_with"], ["ComfyUI-KJNodes"])

    def test_lanpaint_takes_the_samplers_place(self):
        nodes = reference_blocks.nodes_of("inpaint_lanpaint", EVERYTHING, "a.png")
        self.assertEqual((nodes["sampler"]["replaces"], nodes["decode"]["replaces"]), ("$sampler", "$decode"))
        self.assertEqual(nodes["sampler"]["inputs"]["latent_image"], ["encode", 0])
        with self.assertRaisesRegex(reference_blocks.BlockError, "LanPaint, not installed here. Use block inpaint_crop_stitch"):
            reference_blocks.nodes_of("inpaint_lanpaint", BUILT_IN, "a.png")

    def test_a_control_block_takes_a_controlnet_that_fits_the_canvas_model(self):
        def control(name, main):
            return reference_blocks.nodes_of(name, EVERYTHING, "ref.png", lambda: main, base)["controlnet"]["inputs"]["control_net_name"]
        self.assertEqual(control("control_pose", "SDXL 1.0"), "SDXL/xinsir-openpose.safetensors", "its very base first")
        self.assertEqual(control("control_pose", "NoobAI"), "NoobAI/noob-openpose.safetensors")
        self.assertEqual(control("control_pose", "Illustrious"), "NoobAI/noob-openpose.safetensors", "of the SDXL family, in list order")
        self.assertEqual(control("control_pose", "SD 1.5"), "SD_1.5/control_v11p_sd15_openpose.safetensors")
        self.assertEqual(control("control_depth", "SDXL 1.0"), "SDXL/union-promax.safetensors", "no depth one: the union one follows depth too")
        with self.assertRaisesRegex(reference_blocks.BlockError, "No depth ControlNet for SD 1.x models"):
            control("control_depth", "SD 1.5")
        self.assertEqual(control("control_pose", ""), "SD_1.5/control_v11p_sd15_openpose.safetensors", "model unknown: the first of the kind")
        with self.assertRaisesRegex(reference_blocks.BlockError, "needs image: the picture to follow"):
            reference_blocks.nodes_of("control_pose", EVERYTHING)

    def test_on_an_anima_model_a_block_is_built_with_its_lllite(self):
        depth = reference_blocks.build("control_depth", EVERYTHING, "ref.png", lambda: "Anima")
        steer = depth["nodes"]["steer"]
        self.assertEqual((steer["class_type"], steer["inputs"]["lllite_name"], steer["wire_to"]),
                         ("AnimaLLLiteApply_sdscripts", "anima-lllite-depth-1.safetensors", "$sampler"))
        self.assertEqual(set(depth["nodes"]), {"reference", "depth", "steer", "look"}, "no ControlNet loader; the map left to look at")
        self.assertIn("Anima", depth["after"])
        repaint = reference_blocks.build("inpaint_crop_stitch", EVERYTHING, "a.png", lambda: "Anima")["nodes"]
        self.assertEqual((repaint["patch"]["inputs"]["lllite_name"], repaint["patch"]["inputs"]["model"], "wire_to" in repaint["soft"]),
                         ("anima-lllite-inpainting-v2.safetensors", ["soft", 0], False), "the newest, after the soft mask")
        self.assertEqual(reference_blocks.nodes_of("control_depth", EVERYTHING, "ref.png", lambda: "SDXL 1.0", base)["controlnet"]["inputs"]["control_net_name"],
                         "SDXL/union-promax.safetensors", "other models: the ControlNet")
        without = {key: value for key, value in EVERYTHING.items() if key != "AnimaLLLiteApply_sdscripts"}
        with self.assertRaisesRegex(reference_blocks.BlockError, "needs ComfyUI-Anima-LLLite"):
            reference_blocks.build("control_pose", without, "ref.png", lambda: "Anima")

    def test_a_union_controlnet_is_told_what_to_follow_and_new_files_go_by_their_folder(self):
        info = {**EVERYTHING, "SetUnionControlNetType": {}, "ControlNetLoader": {"input": {"required": {"control_net_name": [[
            "NoobAI/noob-sdxl-controlnet-tile.fp16.safetensors", "SDXL_1.0/xinsir-union-promax.safetensors", "animaTileRepair_v20.safetensors"]]}}}}
        held = reference_blocks.nodes_of("upscale_tile", info, None, lambda: "NoobAI")
        self.assertEqual(held["controlnet"]["inputs"]["control_net_name"], "NoobAI/noob-sdxl-controlnet-tile.fp16.safetensors",
                         "not scanned yet: its NoobAI folder says its base")
        self.assertNotIn("union_type", held)
        self.assertEqual((held["redraw"]["inputs"]["positive"], held["redraw"]["inputs"]["denoise"]), (["hold", 0], 0.5))
        lines = reference_blocks.nodes_of("color_lineart", info, "lines.png", lambda: "Illustrious")
        self.assertEqual(lines["controlnet"]["inputs"]["control_net_name"], "SDXL_1.0/xinsir-union-promax.safetensors")
        self.assertEqual((lines["union_type"]["inputs"]["type"], lines["steer"]["inputs"]["control_net"]),
                         ("canny/lineart/anime_lineart/mlsd", ["union_type", 0]), "the union model told it is lineart")
        self.assertEqual(lines["lines"]["class_type"], "ImageInvert", "white lines on black, as the ControlNet reads them")
        anima = reference_blocks.nodes_of("upscale_tile", {**info, "AnimaLLLiteApply_sdscripts": {"input": {"required": {"lllite_name": [[
            "animaTileRepair_v20.safetensors", "anima-lllite-depth-1.safetensors"]]}}}}, None, lambda: "Anima")
        self.assertEqual((anima["hold"]["inputs"]["lllite_name"], anima["redraw"]["inputs"]["model"]), ("animaTileRepair_v20.safetensors", ["hold", 0]))

    def test_the_models_list_says_where_each_comes_from_and_how_to_check_it(self):
        from api.download_sources import allowed_download_url
        for key, model in reference_blocks.MODELS.items():
            with self.subTest(model=key):
                self.assertRegex(model["sha256"], r"^[0-9a-f]{64}$")
                self.assertGreater(model["size"], 0)
                self.assertTrue(model["license"] and model["file"] and model["folder"])
                self.assertTrue(model["sources"] and all(allowed_download_url(source["url"]) for source in model["sources"]),
                                "Anomalous's downloader takes each link")
        for name, block in reference_blocks.BLOCKS.items():
            with self.subTest(block=name):
                self.assertTrue(set(block.get("models") or []) <= set(reference_blocks.MODELS), "recommends only listed models")

    def test_the_panel_and_the_ai_hear_how_a_block_was_tried(self):
        with mock.patch.object(reference_blocks, "_installed", side_effect=lambda model: model["file"].startswith("2x")):
            shown = {item["name"]: item for item in reference_blocks.status(EVERYTHING)}
        upscale = shown["upscale"]
        self.assertEqual([(item["id"], item["installed"]) for item in upscale["recommended"]][:2],
                         [("2x_animesharp_v4", True), ("4x_ultrasharp", False)])
        self.assertEqual(upscale["tested"]["vram_gb"], 6)
        words = reference_blocks.build("upscale_tile", EVERYTHING, None, lambda: "")["tested"]
        self.assertIn("6 GB card", words)
        self.assertIn("about 710 s for Anima", words)
        self.assertEqual(reference_blocks.build("inpaint_basic", EVERYTHING, "a.png")["tested"], "", "not tried: nothing claimed")

    def test_every_link_names_a_node_of_its_block_or_a_role(self):
        for name, block in reference_blocks.BLOCKS.items():
            for key, spec in [item for variant in [block, *(block.get("variants") or {}).values()] for item in variant["nodes"].items()]:
                for value in spec["inputs"].values():
                    if isinstance(value, list):
                        with self.subTest(block=name, node=key):
                            self.assertTrue(all(part in block["nodes"] for part in value[0].split("|"))
                                            or value[0].split(".")[0] in ("$sampler", "$decode", "$save", "$loader"))
                for field in ("wire_to", "like", "replaces"):
                    if field in spec:
                        self.assertIn(spec[field].split(".")[0], ("$sampler", "$decode", "$save", "$loader"))  # like may follow a path


class AddBlockTests(unittest.TestCase):
    def setUp(self):
        keep_switches_apart(self)
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

    def test_a_control_block_asks_the_page_for_the_model_and_copies_the_picture_to_input(self):
        answers = {"block_model": {"model": "noob.safetensors", "loras": []}, "add_nodes": {"nodes": {}, "reaches_output": True}}
        self.page.side_effect = lambda action, payload=None, **_: answers[action]
        with mock.patch.object(ai_pictures, "to_input", return_value="anomalous_reference_x.png") as to_input, \
                mock.patch.object(mcp_canvas_edit, "_base_of", side_effect=base), \
                mock.patch.object(mcp_canvas_edit.model_advice, "_main_base", return_value="Illustrious"):
            mcp_canvas_edit.add_nodes({}, block="control_pose", image="ai_inbox/ref.png")
        to_input.assert_called_once_with("ai_inbox/ref.png")
        self.assertEqual([call[0][0] for call in self.page.call_args_list], ["block_model", "add_nodes"])
        nodes = self.page.call_args[0][1]["nodes"]
        self.assertEqual((nodes["reference"]["inputs"]["image"], nodes["controlnet"]["inputs"]["control_net_name"]),
                         ("anomalous_reference_x.png", "NoobAI/noob-openpose.safetensors"), "Illustrious is of the SDXL family")

    def test_a_model_missing_from_the_lists_is_looked_for_again_after_they_are_read_anew(self):
        stale = {key: value for key, value in EVERYTHING.items() if key != "UpscaleModelLoader"}
        self.object_info.side_effect = [stale, EVERYTHING]
        with mock.patch.object(mcp_canvas_edit.model_download, "forget_file_lists") as forget:
            mcp_canvas_edit.add_nodes({}, block="upscale")
        forget.assert_called_once()
        self.assertEqual(self.page.call_args[0][1]["nodes"]["upscaler"]["inputs"]["model_name"], "2x-Lite.pth")
        self.object_info.side_effect = [stale, stale]
        with mock.patch.object(mcp_canvas_edit.model_download, "forget_file_lists"), self.assertRaisesRegex(ToolError, "No upscale model"):
            mcp_canvas_edit.add_nodes({}, block="upscale")

    def test_nodes_or_block_not_both_and_errors_reach_the_ai(self):
        for arguments in ({}, {"nodes": {"a": {"class_type": "LoadImage"}}, "block": "inpaint_basic"}):
            with self.assertRaisesRegex(ToolError, "Give one of: use .* block .* or nodes"):
                mcp_canvas_edit.add_nodes({}, **arguments)
        self.object_info.return_value = BUILT_IN
        with self.assertRaisesRegex(ToolError, "inpaint_basic instead"):
            mcp_canvas_edit.add_nodes({}, block="inpaint_crop_stitch", image="a.png")
        with self.assertRaisesRegex(ToolError, "follow takes want"):
            mcp_canvas_edit.add_nodes({}, use="follow", image="a.png")
        self.assertFalse(self.page.called)

    def test_begin_task_hands_the_ai_the_directory(self):
        with mock.patch.object(mcp_task_tools.ai_tasks, "begin_task", return_value={"id": "t", "title": "修手"}), \
                mock.patch.object(mcp_task_tools.ai_tasks, "get_task", return_value={"id": "t", "steps": []}):
            blocks = mcp_task_tools.begin_task({"client": "A"}, "修手")["blocks"]
        self.assertIn("add_nodes(use=", blocks["note"])
        self.assertIn("Repaint an area", blocks["repaint"])
        self.object_info.side_effect = ToolError("down")
        self.assertNotIn("needs", " ".join(mcp_task_tools._blocks({}).values()), "no node list: the plain directory")


class ReferencePictureTests(unittest.TestCase):
    def test_a_handed_picture_is_copied_to_input_once_and_an_input_one_stays(self):
        with tempfile.TemporaryDirectory() as output, tempfile.TemporaryDirectory() as input_dir:
            os.makedirs(os.path.join(output, "ai_inbox"))
            Image.new("RGBA", (8, 8), "red").save(os.path.join(output, "ai_inbox", "ref.png"))
            Image.new("RGB", (8, 8), "blue").save(os.path.join(input_dir, "mine.png"))
            folders = ai_pictures.ai_tasks.folder_paths
            with mock.patch.object(folders, "get_output_directory", return_value=output), \
                    mock.patch.object(folders, "get_input_directory", return_value=input_dir):
                name = ai_pictures.to_input("ai_inbox/ref.png")
                self.assertEqual(ai_pictures.to_input("ai_inbox\\ref.png"), name, "the same picture, the same file")
                self.assertEqual(ai_pictures.to_input("ai_inbox/ref.png [output]"), name, "as Load Image names an output picture")
                self.assertEqual(ai_pictures.to_input("mine.png"), "mine.png")
                with self.assertRaises(ToolError):
                    ai_pictures.to_input("ai_inbox/gone.png")
            self.assertTrue(name.startswith("anomalous_reference_"))
            self.assertEqual(sorted(os.listdir(input_dir)), sorted(["mine.png", name]))


if __name__ == "__main__":
    unittest.main()
