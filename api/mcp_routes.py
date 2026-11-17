"""Routes: what to do with the models the user picked, chosen by the user, built by Anomalous. A light
model does not work out that two picked models mean one for the base and one for the enlargement, so
Anomalous prepares the choices (routes.json, those this ComfyUI can build for these models, a saved card
using both first): ask_user(routes=true) shows them, and add_nodes(route=…) builds the one picked on a new
tab from the ways (reference_blocks.py) as a chain (block_chain.py), its LoRAs on each model, so the AI wires nothing. Each picked
model's cards are its examples: get_toolbox lists them with their route (workflow_route.py)."""

import contextvars
import json
import os
import time
import uuid

from . import ai_bases, ai_task_canvas, ai_tasks, ai_toolbox, block_chain, model_advice, reference_blocks, workflow_route
from .mcp_tools import ToolError, _resolve_model
from .recipe_store import _list_recipes, get_recipes_dir

with open(os.path.join(os.path.dirname(__file__), "routes.json"), encoding="utf-8") as source:
    ROUTES = json.load(source)
MAX_CARDS = 3
QUESTION = "How should the two models you picked be used?"
TOOLBOX_NOTE = ("The user picked two main models: ask_user(routes=true) asks them how to use the two, with options Anomalous "
                "prepared, and its answer says what to call. Skip it only when the user already said how.")
NEXT = "run_workflow(prompt=, negative=, base_only=true, batch=3) shows the user bases to pick from; then run_workflow runs the whole route."
ONE_PASS = "run_workflow(prompt=, negative=) draws it; there is no second pass, so no base to pick."


def _main(box):
    return [item for item in (box or {}).get("models") or [] if item.split(":", 1)[0] in model_advice.MAIN_TYPES]


def _loras(box):
    return [item for item in (box or {}).get("models") or [] if item.startswith("loras:")]


def _facts(model_id):
    """(file name without folders, base model) of `model_id`; ToolError when it is gone."""
    _kind, _index, _root, path = _resolve_model(model_id)
    return os.path.splitext(os.path.basename(path))[0], model_advice.base_of(path)


def _can_build(route, base, info, kind=None):
    from . import mcp_canvas_edit

    if kind is not None and not mcp_canvas_edit.draws_picture(kind, base):  # the first step is the picture
        return False
    if route.get("only") and model_advice.family(base) not in route["only"]:
        return False
    if model_advice.family(base) in route.get("not", ()):
        return False
    try:
        reference_blocks.build("picture", info, main_base=lambda: base, model="model")
        if route.get("way"):
            name = reference_blocks.pick(*route["way"], info)
            reference_blocks.build(name, info, main_base=lambda: base, base_of=lambda _name: base)
    except reference_blocks.BlockError:
        return False
    return True


def _cards():
    """(name, stages, line) of each saved workflow."""
    for recipe in _list_recipes(get_recipes_dir(), with_workflow=True):
        data = recipe.get("data") or {}
        workflow = data.get("workflow")
        stages = [stage for stage in workflow_route.route(workflow)[0] if stage["state"] == "run"]
        yield data.get("name") or recipe["filename"], stages, workflow_route.line(workflow)


def cards_of(model_id):
    """The saved workflows drawing with `model_id`, each with its route: the model's examples."""
    name = _facts(model_id)[0]
    return [{"card": card, "route": line} for card, stages, line in _cards() if any(stage["model"] == name for stage in stages)][:MAX_CARDS]


def main_models():
    """The main models a new picture can start from (those use picture draws with), favourites first,
    for the starter sheet: [{model_id, name, family, favourite, cover}]."""
    from . import ai_toolbox_catalog, mcp_canvas_edit

    liked = ai_toolbox.favorites().get("models") or []
    order = {model_id: at for at, model_id in enumerate(liked)}
    out = []
    for item in ai_toolbox_catalog.everything()["models"]:
        model_id = item["id"]
        base = item.get("base") or (item.get("metadata") or {}).get("base_guess") or ""
        if not mcp_canvas_edit.draws_picture(item.get("type"), base):
            continue
        name = item.get("name") or item.get("file") or model_id
        out.append({"model_id": model_id, "name": name, "family": model_advice.family(base),
                    "favourite": model_id in order, "cover": item.get("cover") or ""})
    out.sort(key=lambda item: (0 if item["favourite"] else 1, order.get(item["model_id"], 0),
                               item["name"].lower(), item["model_id"].lower()))
    return out


def ways_for(first, second, info):
    """Routes from routes.json ComfyUI can build for `first` (and optional `second`); 'card' left out."""
    if not first:
        return []
    try:
        kind, _index, _root, path = _resolve_model(first)
    except ToolError:
        return []
    base = model_advice.base_of(path)
    fam = model_advice.family(base)
    has_second = False
    if second and second != first and fam:
        try:
            other_kind, _oi, _or, other_path = _resolve_model(second)
        except ToolError:
            other_kind, other_path = "", ""
        other_fam = model_advice.family(model_advice.base_of(other_path)) if other_path else ""
        has_second = other_fam == fam and (other_kind == "checkpoints") == (kind == "checkpoints")
    limit = 2 if has_second else 1
    return [{"id": key, "models": route["models"], "enlarge": bool(route.get("enlarge"))}
            for key, route in ROUTES.items()
            if route["models"] <= limit and _can_build(route, base, info, kind)]


def first_buildable(models, info, tries=24):
    """(model_id, ways) for the first of `models` (main_models' order) this ComfyUI can build from, or None."""
    for item in models[:tries]:
        ways = ways_for(item["model_id"], "", info)
        if ways:
            return item["model_id"], ways
    return None


def offer(box, info):
    """{"options": [ask_user's choices], "calls": {option id: what to call}} for the two main models in `box`,
    or None: fewer picked, one gone, or of different families (a switch reuses the first's prompts and VAE)."""
    picked = _main(box)[:2]
    if len(picked) < 2:
        return None
    try:
        (first, base), (second, other) = _facts(picked[0]), _facts(picked[1])
    except ToolError:
        return None
    if not model_advice.family(base) or model_advice.family(base) != model_advice.family(other):
        return None
    kind = picked[0].split(":", 1)[0]
    other_kind = picked[1].split(":", 1)[0]
    if (kind == "checkpoints") != (other_kind == "checkpoints"):
        return None
    names = {"a": first, "b": second}
    options, calls = [], {}
    card = next((card for card, stages, _line in _cards() if {first, second} <= {stage["model"] for stage in stages}), None)
    if card:
        options.append({"id": "card", "label": f"Your saved card: {card}"[:80], "label_key": "aiRouteCard", "values": {"name": card},
                        "detail": "A route you saved with these two models.", "detail_key": "aiRouteCardDetail", "recommended": True})
        calls["card"] = f'run_workflow(workflow="{card}", prompt=, negative=, base_only=true, batch=3) shows the user bases to pick from; then run_workflow.'
    for key, route in ROUTES.items():
        if _can_build(route, base, info, kind):
            options.append({"id": key, "label": route["label"].format(**names)[:80], "label_key": f"aiRoute_{key}", "values": names,
                            "detail": route["detail"], "detail_key": f"aiRouteDetail_{key}", "sample": key})
            calls[key] = f'add_nodes(route="{key}") builds it. Then {NEXT if route.get("way") else ONE_PASS}'
    if not card and options:
        options[0]["recommended"] = True
    return {"options": options, "calls": calls} if len(options) > 1 else None


def waiting(task):
    """Whether the task's picks still wait for the user's route: two main models picked, none asked, nothing run."""
    return len(_main(ai_toolbox.effective(task))) >= 2 and not any(
        step.get("routes") or step.get("tool") == "run_workflow" for step in task.get("steps") or [])


def build(ctx, key, model=None):
    """Route `key` on a new tab: the picture on the first model, the picked LoRAs on it, the way after it with
    its own loader on the second model and the LoRAs there too. What was built, and what to do now."""
    from . import mcp_canvas_edit

    route = ROUTES.get(key)
    if not route:
        raise ToolError(f"No route {key!r}; there are: {', '.join(ROUTES)}.")
    box = ai_toolbox.effective(ai_tasks.get_task(ctx["task"]) if ctx.get("task") else None)
    picked = ([model] if model else []) + [item for item in _main(box) if item != model]
    if len(picked) < route["models"]:
        raise ToolError(f"Route {key} draws with {route['models']} main models the user picks for the task. With models of your "
                        "own choosing lay it out instead: add_nodes(plan=[{use: 'picture', model: <first>}, {use: 'upscale', "
                        "want: 'tile', model: <second>}, …]).")
    ai_bases.forget(ctx.get("task"))  # a base picked on another canvas: its sampler is not this route's
    loras = _loras(box)
    steps = [{"use": "picture", "model": picked[0], "loras": loras}]
    if route.get("way"):
        use, want = route["way"]
        steps.append({"use": use, "want": want, "model": picked[1], "loras": loras})
    chain = block_chain.build(ctx, steps, key)
    answer = {"route": key, "built": chain["nodes"], "next": NEXT if route.get("way") else ONE_PASS}
    if route.get("way"):
        added = chain["steps"][1]
        if route.get("enlarge"):
            before, after = int(added["nodes"]["first"]), int(added["nodes"]["second"])
            mcp_canvas_edit.add_node(ctx, "LatentUpscaleBy", {"upscale_method": "nearest-exact", "scale_by": 1.5}, insert_after=before)
            mcp_canvas_edit.set_values(ctx, values={str(before): {"return_with_leftover_noise": "disable"}, str(after): {"add_noise": "enable"}})
    return answer


def apply(task_id, route_key, models, base_url):
    """Picks `models` on task `task_id` (other non-LoRA kinds kept), builds `route_key` on its tab in a
    worker thread (ai_task_canvas.begin_call set for mcp_bridge), and records a user_route step."""
    route = ROUTES.get(str(route_key or ""))
    if not route:
        raise ValueError(f"No route {route_key!r}; there are: {', '.join(ROUTES)}.")
    if not isinstance(models, list) or not models or len(models) > 2 or any(not isinstance(m, str) or not m.strip() for m in models):
        raise ValueError("models must be [first] or [first, second].")
    picked = [m.strip() for m in models]
    if len(picked) < route["models"] or (len(picked) == 2 and picked[0] == picked[1]):
        raise ValueError(f"Route {route_key} needs {route['models']} distinct main models.")
    task = ai_tasks.get_task(task_id)
    if not task:
        raise LookupError("No such task")
    resolved = [_resolve_model(item) for item in picked]
    for item, (kind, _idx, _root, _path) in zip(picked, resolved):
        if kind not in model_advice.MAIN_TYPES:
            raise ValueError(f"{item} is not a main model.")
    if route["models"] == 2:
        fam_a = model_advice.family(model_advice.base_of(resolved[0][3]))
        fam_b = model_advice.family(model_advice.base_of(resolved[1][3]))
        if not fam_a or fam_a != fam_b or (resolved[0][0] == "checkpoints") != (resolved[1][0] == "checkpoints"):
            raise ValueError("The two models must be of the same family.")
    current = ai_toolbox.effective(task) or {}
    picks = {kind: list(current.get(kind) or []) for kind in ai_toolbox.KINDS}
    other = [item for item in picks.get("models") or []
             if not item.startswith("loras:") and item.split(":", 1)[0] not in model_advice.MAIN_TYPES]
    picks["models"] = picked + other
    ai_toolbox.pick(task_id, picks, current.get("mode", "prefer"))

    def on_tab():
        ai_task_canvas.begin_call(task_id)  # the page builds on the task's tab (mcp_bridge.ask_page reads it)
        return build({"task": task_id, "base_url": base_url}, str(route_key))

    answer = contextvars.copy_context().run(on_tab)  # a context of its own: the mark ends with the build
    step = {"id": uuid.uuid4().hex[:10], "at": time.time(), "ms": 0, "tool": "user_route", "kind": "user", "ok": True,
            "state": "done", "summary": "user_route", "route": str(route_key), "models": picked, "routes": True,
            "text": (f"The user chose route {route_key} in Anomalous (models: {', '.join(picked)}). "
                     f"Anomalous already built it on the task's tab. Next: {answer['next']}"),
            "delivered": False, "results": []}
    with ai_tasks._lock:
        fresh = ai_tasks._load().get(task_id)
        if not fresh:
            raise LookupError("No such task")
        ai_tasks._add_step(fresh, step)
        ai_tasks._save(fresh)
    ai_tasks._notify(task_id)
    return {"route": str(route_key), "built": answer["built"], "next": answer["next"], "step": step}
