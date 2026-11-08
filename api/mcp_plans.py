"""add_nodes(plan=…): the big steps an AI lays out for a picture (make it, redraw it with another model, fix
faces, enlarge), each a ready-made block (reference_blocks.py), shown to the user on a plan card
(ai_plans.py) and built in one go on a new tab (block_chain.py) when they say build: the AI wires nothing
and the user sees the route before it is built. A step is {use, want} as for add_nodes, or {block}, and
may name a model (the first step's drawing model, else the task's picked one; a later step's for its
block's own loader). With "build without asking" on, the card shows what was built at once. A card
answered after the AI stopped waiting is built by add_nodes(route=<its panel id>)."""

from . import ai_answer_wait, ai_panels, ai_plans, ai_tasks, ai_toolbox, block_chain, model_advice, reference_blocks
from .mcp_routes import NEXT, ONE_PASS
from .mcp_tools import ToolError, _resolve_model, get_metadata, search_models

MAX_STEPS = 6
MAX_CHOICES = 12  # models of the same family offered for a step


def _model(model_id):
    """(name, folder type, base model) of `model_id`; ToolError when it is gone."""
    folder_type, _root, _base, path = _resolve_model(str(model_id))
    meta = get_metadata(path) or {}
    name = meta.get("custom_name") or meta.get("name") or path.replace("\\", "/").rsplit("/", 1)[-1]
    return name, folder_type, model_advice.base_of(path)


def _choices(model_id, folder_type, base):
    """Other models of the folder and family of `model_id`, for the user to swap in."""
    found = search_models("", folder_type, "", "", 50)["models"]
    return [{"model_id": item["model_id"], "name": item["name"]} for item in found if item["model_id"] != model_id
            and model_advice.family(item.get("base_model")) == model_advice.family(base)][:MAX_CHOICES]


def _task_id(ctx):
    return ctx.get("task") or ai_tasks.active_task_id(ctx.get("client") or "AI", ctx.get("session") or "")


def _model_id(value, at):
    """`value` as a model_id: one already, else the one main model whose file or name it is."""
    value = str(value)
    if value.count(":") >= 2:
        return value
    wanted = value.strip().lower()
    found = [item for item in search_models(value, "", "", "", 50)["models"] if item["model_id"].split(":", 1)[0] in model_advice.MAIN_TYPES
             and wanted in (item["name"].lower(), item["model_id"].rsplit("/", 1)[-1].rsplit(".", 1)[0].lower())]
    if len(found) != 1:
        raise ToolError(f"Step {at + 1}: model is a model_id from search_models" + (
            f"; {value!r} is the name of {len(found)}: " + ", ".join(item["model_id"] for item in found[:5]) if found else "."))
    return found[0]["model_id"]


def _box(ctx):
    task_id = _task_id(ctx)
    return ai_toolbox.effective(ai_tasks.get_task(task_id) if task_id else None) or {}


def resolve(ctx, plan):
    """The card's steps for the AI's `plan`: each its block (the best of its use this ComfyUI can run, or the
    way the user picked), title, model and the models to swap in. ToolError for a plan that cannot be built."""
    from .mcp_canvas_edit import object_info

    if not isinstance(plan, list) or not 1 < len(plan) <= MAX_STEPS:
        raise ToolError(f"plan is 2 to {MAX_STEPS} steps, the picture first: [{{use: 'picture', model: …}}, {{use: 'refine', model: …}}, …]; "
                        "the picture alone is add_nodes(use='picture', model=…).")
    info, ways, steps = object_info(ctx), _box(ctx).get("ways") or (), []
    for at, step in enumerate(plan):
        step = step if isinstance(step, dict) else {}
        try:
            name = str(step["block"]) if step.get("block") in reference_blocks.BLOCKS else \
                reference_blocks.pick(str(step.get("use")), None if step.get("want") is None else str(step["want"]), info, False, ways)
        except (reference_blocks.BlockError, KeyError) as error:
            raise ToolError(f"Step {at + 1}: {error}")
        if reference_blocks.BLOCKS[name].get("takes") in ("picture", "reference") and not step.get("image") and step.get("use"):
            # one for a picture the user hands over (fix_hands): in a plan the step before gives the picture
            chained = reference_blocks.pick(str(step["use"]), None, info, False, ways)
            if reference_blocks.BLOCKS[chained].get("takes") in ("picture", "reference"):
                raise ToolError(f"Step {at + 1}: {name} works on a picture the user hands over, not on the step before's.")
            name = chained
        block = reference_blocks.BLOCKS[name]
        if (at == 0) != bool(block.get("standalone")):
            raise ToolError("A plan starts with the picture (use='picture') and has it once.")
        model = _model_id(step["model"], at) if step.get("model") else (next((item for item in _box(ctx).get("models") or []
                                            if item.split(":", 1)[0] in model_advice.MAIN_TYPES), None) if at == 0 else None)
        if at == 0 and not model:
            raise ToolError("Step 1: name the picture's model (model_id from search_models), or the user picks one for the task.")
        if model and at and not block.get("own_model"):
            raise ToolError(f"Step {at + 1} ({name}) has no loader of its own for a second model; leave model out.")
        shown = {"block": name, "title": block["title"], "model": model}
        if model:
            model_name, folder_type, base = _model(model)
            shown.update(model_name=model_name, choices=_choices(model, folder_type, base))
        steps.append(shown)
    return steps


def _built(ctx, plan, name):
    loras = [item for item in _box(ctx).get("models") or [] if item.startswith("loras:")]
    chain = block_chain.build(ctx, [{**step, "loras": loras} for step in plan], name)
    ai_plans.mark(_task_id(ctx), ai_plans.PREVIEWS, len(chain["steps"]) > 1)
    return {"built": [step["block"] for step in chain["steps"]], "nodes": chain["nodes"],
            "next": NEXT if len(chain["steps"]) > 1 else ONE_PASS}


def propose(ctx, plan, wait_seconds=ai_panels.MAX_WAIT):
    """Shows the plan card and waits for the user, building it when they say build (at once with "build without asking")."""
    steps = resolve(ctx, plan)
    client, task = ctx.get("client") or "AI", ctx.get("task")
    try:
        panel = ai_panels.show(client, "Blueprint", [{"type": "plan", "id": "answer", "steps": steps}],
                               session=ctx.get("session") or "", task_id=task, tool="add_nodes", title_key="aiPlanTitle")
        if ai_plans.auto():
            kept = ai_plans.kept(steps, {})
            ai_panels.answer(_task_id(ctx), _step(ctx, panel["id"])["id"], "answer", ["build"], extra={"plan": kept, "auto": True})
            return {"panel": panel["id"], **_built(ctx, kept, "blueprint"), "note": "Built without asking: the user's setting."}
        answer = ai_answer_wait.collect(client, panel["id"], max(30.0, float(wait_seconds or 0)))
    except ai_panels.PanelError as error:
        raise ToolError(str(error))
    given = next((item for item in answer.get("answers") or [] if item["question"] == "answer"), None)
    if not given:
        return {"answered": False, "panel": panel["id"], **answer,
                "note": f"When the user says build, add_nodes(route={panel['id']!r}) builds it as they left it; get_answers waits for them."}
    return _given(ctx, panel["id"], given)


def _given(ctx, panel_id, given):
    if given.get("plan"):
        return {"panel": panel_id, **_built(ctx, given["plan"], "blueprint")}
    return {"answered": True, "panel": panel_id, "text": given.get("text") or "",
            "note": "Nothing was built: the user wants the plan changed. Change it as they say and call add_nodes(plan=…) again."}


def is_card(ctx, panel_id):
    return ai_plans.card_of(_step(ctx, panel_id)) is not None


def _step(ctx, panel_id):
    """The task's panel step showing panel `panel_id`, or None."""
    task_id = _task_id(ctx)
    task = ai_tasks.get_task(task_id) if task_id else None
    return next((item for item in (task or {}).get("steps") or [] if (item.get("panel") or {}).get("id") == str(panel_id)), None)


def build_answered(ctx, panel_id):
    """add_nodes(route=<a plan card's id>): the plan as the user left it, once they said build."""
    given = (_step(ctx, panel_id) or {}).get("answers", {}).get("answer")
    if not given:
        raise ToolError("The user has not answered the plan card yet: get_answers waits for them.")
    return _given(ctx, panel_id, given)
