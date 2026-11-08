"""The plan card (蓝图) in the AI workbench: the steps an AI laid out for a picture (add_nodes(plan=…),
mcp_plans.py), each a ready-made block (reference_blocks.py) with its model, shown to the user before
anything is built. The card is a panel block only Anomalous makes ("plan", id "answer"): the user drops
steps but the first, swaps a step's model for one of the same family listed with it, and says build, or
writes what to change. prepare() turns a build into the steps kept, which the AI's call then builds. The
user's "build without asking" is kept in ai_plans.json beside the tasks."""

import json
import os

from . import ai_tasks
from .path_utils import atomic_write_json


def _path():
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "ai_plans.json")


def auto():
    """Whether the user said to build plans without asking."""
    try:
        with open(_path(), encoding="utf-8") as source:
            return json.load(source).get("auto") is True
    except (OSError, ValueError, AttributeError):
        return False


def set_auto(on):
    atomic_write_json(_path(), {"auto": bool(on)})


def card_of(step):
    """The plan block of a panel step, or None."""
    return next((block for block in ((step or {}).get("panel") or {}).get("blocks") or [] if block.get("type") == "plan"), None)


def kept(steps, edits):
    """[{block, model}] the user kept of a card's `steps`, with the models they swapped in. `edits`:
    {drop: [step index], models: {step index: model_id}}, indices from 0; ValueError for an edit not theirs."""
    edits = edits if isinstance(edits, dict) else {}
    try:
        drop = {int(at) for at in edits.get("drop") or []}
        models = {int(at): str(model) for at, model in (edits.get("models") or {}).items()}
    except (TypeError, ValueError, AttributeError):
        raise ValueError("Edits are {drop: [step index], models: {step index: model_id}}.")
    if 0 in drop:
        raise ValueError("The first step makes the picture: it stays.")
    out = []
    for at, step in enumerate(steps):
        if at in drop:
            continue
        model = step.get("model")
        if at in models:
            if models[at] not in {choice["model_id"] for choice in step.get("choices") or []} | {model}:
                raise ValueError(f"Step {at + 1}: pick one of the models listed with it.")
            model = models[at]
        out.append({"block": step["block"], "model": model})
    return out


def prepare(task_id, step_id, choice, edits, auto_on):
    """{"plan": the steps kept} when the user says build on a plan card, else None; their "build without
    asking" is saved with it."""
    step = next((item for item in (ai_tasks.get_task(task_id) or {}).get("steps") or [] if item.get("id") == step_id), None)
    card = card_of(step)
    if not card or choice != ["build"]:
        return None
    plan = kept(card["steps"], edits)
    if auto_on is True:
        set_auto(True)
    return {"plan": plan, "note": f"add_nodes(route={step['panel']['id']!r}) builds it as the user left it, if your call stopped waiting."}
