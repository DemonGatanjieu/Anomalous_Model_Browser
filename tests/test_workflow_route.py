"""A saved workflow's route in one line for the AI (api/workflow_route.py), read from the serialized graph
with stand-in widget names, and its place in list_workflows."""
import sys
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import workflow_route  # noqa: E402

NAMES = {
    "UNETLoader": ["unet_name", "weight_dtype"],
    "LoraLoader": ["lora_name", "strength_model", "strength_clip"],
    "KSampler": ["seed", "control_after_generate", "steps", "cfg", "sampler_name", "scheduler", "denoise"],
    "KSamplerAdvanced": ["add_noise", "noise_seed", "control_after_generate", "steps", "cfg", "sampler_name", "scheduler",
                         "start_at_step", "end_at_step", "return_with_leftover_noise"],
    "LatentUpscaleBy": ["upscale_method", "scale_by"],
}


def node(id_, type_, inputs=(), values=(), mode=0):
    return {"id": id_, "type": type_, "mode": mode, "inputs": [{"name": name, "link": link} for name, link in inputs],
            "widgets_values": list(values)}


def two_passes(second="Anima\\miaomiaoRealskin_anima13.safetensors"):
    """The two-pass card: a base, then enlarged and redrawn on a second model under a Tile LLLite, then a colour match."""
    nodes = [
        node(1, "UNETLoader", values=["Anima\\MiaoMiao Harem_Anima_1.5.safetensors", "default"]),
        node(16, "LoraLoader", [("model", 1)], ["style.safetensors", 1, 1]),
        node(30, "UNETLoader", values=[second, "default"]),
        node(2, "CLIPTextEncode", values=["a lake"]),
        node(6, "EmptyLatentImage", values=[832, 1216, 1]),
        node(32, "KSamplerAdvanced", [("model", 2), ("positive", 3), ("negative", 3), ("latent_image", 4)],
             ["enable", 7, "fixed", 35, 4.4, "dpmpp_2m_sde_gpu", "beta", 0, 35, "disable"]),
        node(7, "VAEDecode", [("samples", 5)]),
        node(9, "SaveImage", [("images", 6)], ["base"]),
        node(10, "VAEEncode", [("pixels", 7)]),
        node(11, "LatentUpscaleBy", [("samples", 8)], ["bislerp", 1.22]),
        node(18, "AnimaLLLiteApply_sdscripts", [("model", 9), ("image", 10)], ["animaTileRepair_v20.safetensors", 0.7]),
        node(19, "KSampler", [("model", 11), ("positive", 3), ("negative", 3), ("latent_image", 12)],
             [3, "increment", 30, 4.4, "euler", "normal", 0.85]),
        node(20, "VAEDecode", [("samples", 13)]),
        node(21, "ColorMatch", [("image_ref", 14), ("image_target", 15)]),
        node(22, "SaveImage", [("images", 16)], ["upscaled"]),
    ]
    links = [[1, 1, 0], [2, 16, 0], [3, 2, 0], [4, 6, 0], [5, 32, 0], [6, 7, 0], [7, 7, 0], [8, 10, 0], [9, 30, 0], [10, 7, 0],
             [11, 18, 0], [12, 11, 0], [13, 19, 0], [14, 7, 0], [15, 20, 0], [16, 21, 0]]
    return {"nodes": nodes, "links": [[link_id, origin, slot, 0, 0, "*"] for link_id, origin, slot in links]}


class RouteTests(unittest.TestCase):
    def line(self, workflow):
        return workflow_route.line(workflow, lambda kind: NAMES.get(kind, []))

    def test_a_two_pass_card_says_its_passes_models_and_control(self):
        self.assertEqual(self.line(two_passes()),
                         "2 passes: base steps 0-35 on MiaoMiao Harem_Anima_1.5 + LoRA style -> enlarge 1.22x, redraw 30 steps "
                         "denoise 0.85 on miaomiaoRealskin_anima13 with animaTileRepair_v20 -> then ColorMatch")

    def test_a_bypassed_redraw_leaves_one_pass(self):
        workflow = two_passes()
        next(item for item in workflow["nodes"] if item["id"] == 19)["mode"] = 4
        self.assertTrue(self.line(workflow).startswith("1 pass: base steps 0-35 on MiaoMiao Harem_Anima_1.5"))

    def test_no_sampler_no_route_and_unknown_types_stay_unnamed(self):
        self.assertEqual(self.line({"nodes": [node(1, "UNETLoader", values=["a.safetensors"])], "links": []}), "")
        self.assertIn("on MiaoMiao Harem_Anima_1.5", workflow_route.line(two_passes(), lambda kind: []))


if __name__ == "__main__":
    unittest.main()
