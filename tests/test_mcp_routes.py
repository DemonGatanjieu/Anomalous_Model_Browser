"""Routes for the two models a user picked (api/mcp_routes.py): the choices Anomalous prepares, a saved card
first, and the route built from the ways. Stand-in models, cards and page; no ComfyUI."""
import sys
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1]), str(PLUGIN / "tests")]

from api import ai_panels, ai_tasks, mcp_actions, mcp_canvas_edit, mcp_routes, mcp_task_tools  # noqa: E402
from api.mcp_tools import ToolError  # noqa: E402
from test_ai_tasks import isolate  # noqa: E402

A, B = "diffusion_models:0:Anima/harem.safetensors", "diffusion_models:0:Anima/realskin.safetensors"
LORA = "loras:0:style.safetensors"
FILES = {"Anima/harem.safetensors": "Anima", "Anima/realskin.safetensors": "Anima", "SDXL/nova.safetensors": "Illustrious"}
INFO = {"AnimaLLLiteApply_sdscripts": {"input": {"required": {"lllite_name": [["animaTileRepair_v20.safetensors"]]}}},
        "CLIPLoader": {"input": {"required": {"clip_name": [["Anima/qwen_3_06b_base.safetensors"]]}}},
        "VAELoader": {"input": {"required": {"vae_name": [["Anima/qwenImageGGUF_vae.safetensors"]]}}}}


def resolved(model_id):
    return model_id.split(":")[0], 0, "/models", "/models/" + model_id.split(":", 2)[2]


class RouteTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.cards = []
        for patcher in (mock.patch.object(mcp_routes, "_resolve_model", side_effect=resolved),
                        mock.patch.object(mcp_routes.model_advice, "base_of",
                                          side_effect=lambda path: FILES.get(path.split("/models/")[-1], "")),
                        mock.patch.object(mcp_routes, "_cards", side_effect=lambda: iter(self.cards))):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_two_models_of_a_family_get_the_routes_this_comfyui_can_build(self):
        got = mcp_routes.offer({"models": [A, LORA, B]}, INFO)
        self.assertEqual([option["id"] for option in got["options"]], ["tile_second", "midway_enlarge", "one_pass"])
        self.assertEqual(got["options"][0]["label"], "harem draws the base, realskin redraws it enlarged under Tile")
        self.assertEqual(got["options"][0]["values"], {"a": "harem", "b": "realskin"})
        self.assertTrue(got["options"][0]["recommended"])
        self.assertIn('add_nodes(route="tile_second")', got["calls"]["tile_second"])

    def test_nothing_to_ask_with_one_model_or_two_families(self):
        self.assertIsNone(mcp_routes.offer({"models": [A, LORA]}, INFO))
        self.assertIsNone(mcp_routes.offer({"models": [A, "checkpoints:0:SDXL/nova.safetensors"]}, INFO))
        self.assertIsNone(mcp_routes.offer(None, INFO))

    def test_a_route_this_comfyui_cannot_build_is_left_out(self):
        without_tile = {**INFO, "AnimaLLLiteApply_sdscripts": {"input": {"required": {"lllite_name": [["other.safetensors"]]}}}}
        self.assertEqual([option["id"] for option in mcp_routes.offer({"models": [A, B]}, without_tile)["options"]], ["midway_enlarge", "one_pass"])

    def test_a_saved_card_with_both_models_comes_first(self):
        self.cards = [("Two passes", [{"model": "harem"}, {"model": "realskin"}], "2 passes: ...")]
        got = mcp_routes.offer({"models": [A, B]}, INFO)
        self.assertEqual((got["options"][0]["id"], got["options"][0]["recommended"]), ("card", True))
        self.assertEqual(sum(1 for option in got["options"] if option.get("recommended")), 1)
        self.assertIn('run_workflow(workflow="Two passes"', got["calls"]["card"])
        self.assertEqual(mcp_routes.cards_of(A), [{"card": "Two passes", "route": "2 passes: ..."}], "the model's examples")

    def test_the_answer_says_what_to_call(self):
        ai_tasks.begin_task("Claude", "a picture")
        task = ai_tasks.list_tasks()[0]["id"]
        with ai_tasks._lock:
            ai_tasks._load()[task]["toolbox"] = {"mode": "prefer", "models": [A, B]}
        with mock.patch("api.mcp_canvas_edit.object_info", return_value=INFO):
            offered = mcp_task_tools._routes({"client": "Claude", "task": task}, task)
        panel = ai_panels.show("Claude", mcp_routes.QUESTION, [{"type": "choices", "id": "answer", "options": offered["options"], "other": True}],
                               task_id=task, tool="ask_user", extra={"routes": offered["calls"]}, title_key="aiRouteTitle")
        self.assertEqual(panel["title_key"], "aiRouteTitle")
        step = next(item for item in ai_tasks.get_task(task)["steps"] if item.get("routes"))
        answers = ai_panels.answer(task, step["id"], "answer", ["tile_second"])
        self.assertIn('add_nodes(route="tile_second")', answers["answer"]["note"])
        self.assertFalse(mcp_routes.waiting(ai_tasks.get_task(task)), "asked once")

    def test_the_tile_route_is_built_on_a_new_tab_with_the_second_model(self):
        calls = []
        added = iter([{"nodes": {"model": "1"}}, {"nodes": {"own_1": "9", "own": "10"}}])
        with mock.patch.object(mcp_canvas_edit, "new_workflow", side_effect=lambda ctx, name: calls.append(("new", name))), \
                mock.patch.object(mcp_canvas_edit, "add_nodes", side_effect=lambda ctx, **kw: (calls.append(("add", kw)), next(added))[1]), \
                mock.patch.object(mcp_actions, "add_lora", side_effect=lambda ctx, lora, after_node_id: calls.append(("lora", after_node_id))), \
                mock.patch.object(mcp_actions, "set_model", side_effect=lambda ctx, node, model: calls.append(("model", node, model))), \
                mock.patch.object(mcp_routes.ai_tasks, "get_task", return_value={}), \
                mock.patch.object(mcp_routes.ai_toolbox, "effective", return_value={"models": [A, LORA, B]}):
            got = mcp_routes.build({"task": "t"}, "tile_second")
        self.assertEqual(calls, [("new", "tile_second"), ("add", {"use": "picture", "model": A}), ("lora", 1),
                                 ("add", {"use": "upscale", "want": "detail"}), ("model", 9, B)],
                         "the LoRA goes on before the way copies the model line")
        self.assertIn("base_only=true", got["next"])

    def test_a_route_needs_its_models(self):
        with mock.patch.object(mcp_routes.ai_tasks, "get_task", return_value={}), \
                mock.patch.object(mcp_routes.ai_toolbox, "effective", return_value={"models": [A]}):
            with self.assertRaisesRegex(ToolError, "draws with 2 main models"):
                mcp_routes.build({"task": "t"}, "tile_second")
            with self.assertRaisesRegex(ToolError, "No route"):
                mcp_routes.build({"task": "t"}, "nope")


if __name__ == "__main__":
    unittest.main()
