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
        self.assertIn("base_only=true", got["calls"]["tile_second"])
        self.assertNotIn("base_only=true", got["calls"]["one_pass"], "one pass: nothing to pick a base for")

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
        added = iter([{"block": "picture", "nodes": {"model": "1", "sampler": "5", "save": "7"}},
                      {"block": "upscale_tile", "nodes": {"own_1": "9", "own": "10", "redraw": "12", "save": "14"}}])
        with mock.patch.object(mcp_canvas_edit, "new_workflow", side_effect=lambda ctx, name: calls.append(("new", name))), \
                mock.patch.object(mcp_canvas_edit, "add_nodes", side_effect=lambda ctx, **kw: (calls.append(("add", kw)), next(added))[1]), \
                mock.patch.object(mcp_actions, "add_lora", side_effect=lambda ctx, lora, after_node_id: calls.append(("lora", after_node_id))), \
                mock.patch.object(mcp_actions, "set_model", side_effect=lambda ctx, node, model: calls.append(("model", node, model))), \
                mock.patch.object(mcp_routes.ai_tasks, "get_task", return_value={}), \
                mock.patch.object(mcp_routes.ai_toolbox, "effective", return_value={"models": [A, LORA, B]}):
            got = mcp_routes.build({"task": "t"}, "tile_second")
        self.assertEqual(calls, [("new", "tile_second"), ("add", {"use": "picture", "model": A}), ("lora", 1),
                                 ("add", {"use": "upscale", "want": "tile", "near_node_id": 5, "save_node_id": 7}), ("model", 9, B)],
                         "the LoRA goes on before the way copies the model line; the way goes on from the picture's sampler and output")
        self.assertIn("base_only=true", got["next"])

    def test_a_route_needs_its_models(self):
        with mock.patch.object(mcp_routes.ai_tasks, "get_task", return_value={}), \
                mock.patch.object(mcp_routes.ai_toolbox, "effective", return_value={"models": [A]}):
            with self.assertRaisesRegex(ToolError, "draws with 2 main models"):
                mcp_routes.build({"task": "t"}, "tile_second")
            with self.assertRaisesRegex(ToolError, "No route"):
                mcp_routes.build({"task": "t"}, "nope")


class StartFromRouteTests(unittest.TestCase):
    def _models_patch(self, entries):
        by_id = {mid: (kind, idx, root, path) for mid, kind, idx, root, path, _base in entries}
        bases = {path: base for _mid, _kind, _idx, _root, path, base in entries}
        return (
            mock.patch.object(mcp_routes, "_resolve_model", side_effect=lambda mid: by_id[mid]),
            mock.patch.object(mcp_routes.model_advice, "base_of", side_effect=lambda path: bases[path]),
        )

    def test_main_models_orders_favourites_first_and_maps_families(self):
        from api import ai_toolbox_catalog

        catalog = [
            {"id": LORA, "name": "my_lora", "type": "loras", "base": "SDXL 1.0"},
            {"id": "checkpoints:0:zeta.safetensors", "name": "zeta", "file": "zeta.safetensors", "type": "checkpoints",
             "metadata": {"base_guess": "SD 1.5", "version_name": "v1"}},
            {"id": A, "name": "alpha", "file": "alpha.safetensors", "type": "checkpoints", "base": "SDXL 1.0",
             "metadata": {"model_id": 10, "version_id": 101, "version_name": "v2.0", "baseModel": "SDXL 1.0"},
             "cover": "/anomalous/preview/a.png"},
            {"id": B, "name": "bravo", "file": "bravo.safetensors", "type": "checkpoints", "base": "Illustrious",
             "metadata": {"model_id": 20, "version_id": 201, "version_name": "IL v1", "baseModel": "Illustrious"},
             "cover": "/anomalous/preview/b.png"},
            {"id": "diffusion_models:0:flux.safetensors", "name": "flux_d", "type": "diffusion_models", "base": "Flux.1 D"},
        ]
        with mock.patch.object(mcp_routes.ai_toolbox, "favorites", return_value={"models": [B, A]}), \
                mock.patch.object(ai_toolbox_catalog, "everything", return_value={"models": catalog}):
            got = mcp_routes.main_models()
        self.assertEqual([item["model_id"] for item in got], [B, A, "checkpoints:0:zeta.safetensors"],
                         "a LoRA and a Flux model are no model a new picture starts from")
        self.assertEqual([item["favourite"] for item in got], [True, True, False])
        self.assertEqual([item["cover"] for item in got], ["/anomalous/preview/b.png", "/anomalous/preview/a.png", ""])
        self.assertEqual(got[2]["family"], "SD 1.x")
        self.assertEqual(got[0]["base"], "Illustrious")
        self.assertEqual(got[0]["type"], "checkpoints")
        self.assertEqual(got[0]["file"], "bravo.safetensors")
        self.assertEqual(got[0]["metadata"]["version_name"], "IL v1")

    def test_ways_for_excludes_card_respects_family_loader_and_picture_fit(self):
        ckpt_a = "checkpoints:0:sdxl_a.safetensors"
        ckpt_b = "checkpoints:0:sdxl_b.safetensors"
        entries = [
            (A, "diffusion_models", 0, "C:/dm", "C:/dm/anima_a.safetensors", "Anima"),
            (B, "diffusion_models", 0, "C:/dm", "C:/dm/anima_b.safetensors", "Anima"),
            (ckpt_a, "checkpoints", 0, "C:/ckpt", "C:/ckpt/a.safetensors", "SDXL 1.0"),
            (ckpt_b, "checkpoints", 0, "C:/ckpt", "C:/ckpt/b.safetensors", "Illustrious"),
            ("checkpoints:0:sd15.safetensors", "checkpoints", 0, "C:/ckpt", "C:/ckpt/sd15.safetensors", "SD 1.5"),
            ("diffusion_models:0:sdxl_u.safetensors", "diffusion_models", 0, "C:/dm", "C:/dm/sdxl_u.safetensors", "SDXL 1.0"),
            ("diffusion_models:0:flux.safetensors", "diffusion_models", 0, "C:/dm", "C:/dm/flux.safetensors", "Flux.1 D"),
        ]
        p_res, p_base = self._models_patch(entries)
        with p_res, p_base:
            one = mcp_routes.ways_for(A, "", INFO)
            same = mcp_routes.ways_for(A, A, INFO)
            two_anima = mcp_routes.ways_for(A, B, INFO)
            two_sdxl = mcp_routes.ways_for(ckpt_a, ckpt_b, INFO)
            cross = mcp_routes.ways_for(ckpt_a, "checkpoints:0:sd15.safetensors", INFO)
            no_tile = mcp_routes.ways_for(A, B, {k: v for k, v in INFO.items() if k != "AnimaLLLiteApply_sdscripts"})
            empty_info = mcp_routes.ways_for(A, B, {})
            flux = mcp_routes.ways_for("diffusion_models:0:flux.safetensors", "", INFO)
            sdxl_dm = mcp_routes.ways_for("diffusion_models:0:sdxl_u.safetensors", "", INFO)
        self.assertEqual([w["id"] for w in one], ["one_pass"])
        self.assertEqual([w["id"] for w in same], ["one_pass"])
        self.assertNotIn("card", [w["id"] for w in two_anima])
        self.assertEqual([w["id"] for w in two_anima], ["tile_second", "midway_enlarge", "one_pass"])
        self.assertEqual([w["enlarge"] for w in two_anima], [True, True, False], "a Tile redraw is upscaled first")
        self.assertEqual([w["id"] for w in two_sdxl], ["midway", "one_pass"])
        self.assertEqual([w["id"] for w in cross], ["one_pass"])
        self.assertEqual([w["id"] for w in no_tile], ["midway_enlarge", "one_pass"])
        self.assertEqual(empty_info, [])
        self.assertEqual(flux, [])
        self.assertEqual(sdxl_dm, [])

    def test_apply_picks_models_strips_loras_builds_and_records_user_route(self):
        from test_ai_tasks import isolate
        from api import ai_decisions, ai_panels, ai_task_canvas, ai_tasks

        isolate()
        tid = ai_tasks.begin_task("C", "draw")["id"]
        mcp_routes.ai_toolbox.pick(tid, {"models": [A, LORA, "upscale_models:0:u.pth"], "nodes": ["KSampler"]}, "only")

        entries = [
            (A, "diffusion_models", 0, "C:/dm", "C:/dm/anima_a.safetensors", "Anima"),
            (B, "diffusion_models", 0, "C:/dm", "C:/dm/anima_b.safetensors", "Anima"),
        ]
        seen_call_ctx = []
        calls = []
        added = iter([
            {"block": "picture", "nodes": {"model": "1", "sampler": "5", "save": "7"}},
            {"block": "switch_midway", "nodes": {"second_model": "9", "first": "11", "second": "13", "save": "15"}},
        ])

        def fake_new(ctx, name):
            seen_call_ctx.append(ai_task_canvas._call.get())
            calls.append(("new", name))

        before_call = ai_task_canvas._call.get()
        p_res, p_base = self._models_patch(entries)
        with p_res, p_base, \
                mock.patch.object(mcp_canvas_edit, "new_workflow", side_effect=fake_new), \
                mock.patch.object(mcp_canvas_edit, "add_nodes", side_effect=lambda ctx, **kw: (calls.append(("add", kw)), next(added))[1]), \
                mock.patch.object(mcp_canvas_edit, "add_node", side_effect=lambda ctx, *a, **kw: calls.append(("node", a[0]))), \
                mock.patch.object(mcp_canvas_edit, "set_values", side_effect=lambda ctx, **kw: calls.append(("values", kw))), \
                mock.patch.object(mcp_actions, "add_lora", side_effect=lambda *a, **kw: calls.append(("lora", a))), \
                mock.patch.object(mcp_actions, "set_model", side_effect=lambda ctx, node, model: calls.append(("model", node, model))):
            mcp_routes.apply(tid, "midway_enlarge", [B, A], "http://127.0.0.1:8188")

        self.assertEqual([item["task"] for item in seen_call_ctx], [tid])
        self.assertEqual(ai_task_canvas._call.get(), before_call)
        self.assertFalse(any(c[0] == "lora" for c in calls), "sheet route strips LoRAs")
        self.assertEqual(calls[0], ("new", "midway_enlarge"))
        self.assertIn(("node", "LatentUpscaleBy"), calls)

        eff = mcp_routes.ai_toolbox.effective(ai_tasks.get_task(tid))
        self.assertEqual(eff["models"], [B, A, "upscale_models:0:u.pth"])
        self.assertEqual(eff["nodes"], ["KSampler"])
        self.assertEqual(eff["mode"], "only")

        task = ai_tasks.get_task(tid)
        self.assertFalse(mcp_routes.waiting(task))
        step = task["steps"][-1]
        self.assertEqual((step["tool"], step["routes"], step["delivered"], step["route"], step["models"]),
                         ("user_route", True, False, "midway_enlarge", [B, A]))
        self.assertIn(mcp_routes.NEXT, step["text"])
        self.assertIn("midway_enlarge", step["text"])

        decs = ai_decisions.decisions(task)
        self.assertEqual([d["type"] for d in decs], ["toolbox", "toolbox", "route"])
        self.assertEqual((decs[-1]["route"], decs[-1]["models"]), ("midway_enlarge", [B, A]))
        self.assertIn("midway_enlarge", " ".join(ai_decisions.lines(task)))
        _out, _waiting, messages, _changed = ai_panels._collect("C", None, task_id=tid)
        self.assertEqual([msg.get("kind") for msg in messages], ["toolbox", "toolbox", "route"])

    def test_a_route_chosen_already_is_not_asked_for_again(self):
        from test_ai_tasks import isolate
        from api import ai_tasks, mcp_task_tools

        isolate()
        tid = ai_tasks.begin_task("C", "draw")["id"]
        mcp_routes.ai_toolbox.pick(tid, {"models": [A, B]})
        with mock.patch.object(mcp_task_tools, "_routes", return_value={"options": [{"id": "midway"}, {"id": "one_pass"}]}):
            self.assertTrue(mcp_task_tools._routes_note({}, tid), "two models picked, no route yet: the AI asks")
            with ai_tasks._lock:
                task = ai_tasks._load()[tid]
                ai_tasks._add_step(task, {"id": "r1", "at": 1, "ms": 0, "tool": "user_route", "kind": "user", "ok": True,
                                          "state": "done", "routes": True, "delivered": False, "results": []})
                ai_tasks._save(task)
            self.assertFalse(mcp_task_tools._routes_note({}, tid), "the user chose in the starter sheet: nothing to ask")

    def test_http_routes_task_route_and_local_guard(self):
        import asyncio
        import json
        from aiohttp import web
        from aiohttp.test_utils import make_mocked_request
        from test_ai_tasks import isolate
        from api import ai_tasks, ai_tasks_routes, local_guard, mcp_bridge

        isolate()
        tid = ai_tasks.begin_task("C", "draw")["id"]
        entries = [
            (A, "diffusion_models", 0, "C:/dm", "C:/dm/anima_a.safetensors", "Anima"),
            (B, "diffusion_models", 0, "C:/dm", "C:/dm/anima_b.safetensors", "Anima"),
            ("checkpoints:0:sd15.safetensors", "checkpoints", 0, "C:/ckpt", "C:/ckpt/sd15.safetensors", "SD 1.5"),
        ]
        models_out = [
            {"model_id": A, "name": "a", "family": "anima", "favourite": True},
            {"model_id": B, "name": "b", "family": "anima", "favourite": False},
            {"model_id": "checkpoints:0:sd15.safetensors", "name": "sd15", "family": "SD 1.5", "favourite": False},
        ]
        p_res, p_base = self._models_patch(entries)
        with p_res, p_base, \
                mock.patch.object(mcp_routes, "main_models", return_value=models_out), \
                mock.patch.object(mcp_canvas_edit, "object_info", return_value=INFO):
            req = make_mocked_request("GET", f"/anomalous/ai_routes?first={A}&second=checkpoints:0:sd15.safetensors",
                                      headers={"Host": "127.0.0.1:8188"})
            resp = asyncio.run(ai_tasks_routes.api_routes(req))
        body = json.loads(resp.text)
        self.assertEqual(resp.status, 200)
        self.assertEqual((body["first"], body["second"]), (A, ""), "incompatible second is dropped cleanly")
        self.assertEqual([w["id"] for w in body["ways"]], ["one_pass"])

        def ways(first, second, info):
            return [{"id": "one_pass", "models": 1, "enlarge": False}] if first.startswith("checkpoints") else []

        def routes(query):
            with mock.patch.object(mcp_routes, "main_models", return_value=models_out), \
                    mock.patch.object(mcp_canvas_edit, "object_info", return_value=INFO), \
                    mock.patch.object(mcp_routes, "ways_for", side_effect=ways):
                req = make_mocked_request("GET", f"/anomalous/ai_routes{query}", headers={"Host": "127.0.0.1:8188"})
                return json.loads(asyncio.run(ai_tasks_routes.api_routes(req)).text)

        fresh = routes("")
        self.assertEqual((fresh["first"], [w["id"] for w in fresh["ways"]]), ("checkpoints:0:sd15.safetensors", ["one_pass"]),
                         "nothing asked: the first model this ComfyUI can build from, not one that opens on a warning")
        self.assertEqual((routes(f"?first={A}")["first"], routes(f"?first={A}")["ways"]), (A, []),
                         "a model the user chose stays, buildable or not")

        def post(path_tid, payload):
            req = make_mocked_request("POST", f"/anomalous/ai_tasks/{path_tid}/route",
                                      headers={"Host": "127.0.0.1:8188", "Content-Type": "application/json"},
                                      match_info={"task_id": path_tid})
            req._read_bytes = json.dumps(payload).encode()
            return asyncio.run(ai_tasks_routes.api_task_route(req))

        p_res, p_base = self._models_patch(entries)
        with p_res, p_base:
            bad_route = post(tid, {"route": "nope", "models": [A]})
            missing_task = post("no-such-task", {"route": "one_pass", "models": [A]})
            with mock.patch.object(mcp_canvas_edit, "new_workflow", side_effect=mcp_bridge.PageUnavailable("no ComfyUI page")):
                no_page = post(tid, {"route": "one_pass", "models": [A]})
        self.assertEqual(bad_route.status, 400)
        self.assertEqual(missing_task.status, 404)
        self.assertEqual(no_page.status, 502)
        self.assertIn("no ComfyUI page", json.loads(no_page.text)["error"])
        self.assertIsNotNone(ai_tasks.get_task(tid), "task stays when route build fails")
        self.assertFalse(any(s.get("tool") == "user_route" for s in ai_tasks.get_task(tid)["steps"]))

        p_res, p_base = self._models_patch(entries)
        with p_res, p_base, \
                mock.patch.object(mcp_canvas_edit, "new_workflow"), \
                mock.patch.object(mcp_canvas_edit, "add_nodes", return_value={"block": "picture", "nodes": {"model": "1", "sampler": "5", "save": "7"}}):
            ok_resp = post(tid, {"route": "one_pass", "models": [A]})
        self.assertEqual(ok_resp.status, 200)
        self.assertIn(mcp_routes.ONE_PASS, json.loads(ok_resp.text)["next"])

        class _Transport:
            def __init__(self, peer):
                self._peer = peer

            def get_extra_info(self, name, default=None):
                return self._peer if name == "peername" else default

        remote = make_mocked_request("POST", f"/anomalous/ai_tasks/{tid}/route",
                                     headers={"Host": "127.0.0.1:8188"},
                                     transport=_Transport(("10.0.0.5", 12345)))

        async def ok_handler(_req):
            return web.json_response({"ok": True})

        blocked = asyncio.run(local_guard.local_only_middleware(remote, ok_handler))
        self.assertEqual(blocked.status, 403)


if __name__ == "__main__":
    unittest.main()
