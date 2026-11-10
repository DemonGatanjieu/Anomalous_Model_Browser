"""Routes: what to do with the models the user picked, chosen by the user, built by Anomalous. A light
model does not work out that two picked models mean one for the base and one for the enlargement, so
Anomalous prepares the choices (routes.json, those this ComfyUI can build for these models, a saved card
using both first): ask_user(routes=true) shows them, and add_nodes(route=…) builds the one picked on a new
tab from the ways (reference_blocks.py) as a chain (block_chain.py), its LoRAs on each model, so the AI wires nothing. Each picked
model's cards are its examples: get_toolbox lists them with their route (workflow_route.py)."""

import json
import os

from . import ai_bases, ai_tasks, ai_toolbox, block_chain, model_advice, reference_blocks, workflow_route
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


def _can_build(route, base, info):
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
    names = {"a": first, "b": second}
    options, calls = [], {}
    card = next((card for card, stages, _line in _cards() if {first, second} <= {stage["model"] for stage in stages}), None)
    if card:
        options.append({"id": "card", "label": f"Your saved card: {card}"[:80], "label_key": "aiRouteCard", "values": {"name": card},
                        "detail": "A route you saved with these two models.", "detail_key": "aiRouteCardDetail", "recommended": True})
        calls["card"] = f'run_workflow(workflow="{card}", prompt=, negative=, base_only=true, batch=3) shows the user bases to pick from; then run_workflow.'
    for key, route in ROUTES.items():
        if _can_build(route, base, info):
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
