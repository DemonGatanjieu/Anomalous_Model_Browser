"""Training rounds of the training network (web/modules/ui_ai_network.js): the user picks what to
try, a skill (prompts written with its advice, and without it) or the ready-made ways of one use,
on which of their models and how many pictures each, and Anomalous makes it a task for the next AI
that calls, with the plan on it ("training"). The AI does the trials with its usual tools; each
run that ends is matched to a trial by what it used (ai_evidence.py: the model, the ways it still
has, the skills fetched before it in the task), and the AI is told in its answers how far it is
and what is next (tell). Once a model's trials are done it is asked to show them side by side in a
picks panel with its own pick marked recommended, for the user to pick: both picks go into the
record, the user's counted first. The network itself is ai_evidence's record summed up, beside
the main models here by base model (models), the ways and the skills.
"""

import os
import random

from . import ai_skills, ai_tasks, model_advice, reference_blocks
from .metadata import get_metadata
from .mcp_tools import ToolError, _each_model, _model_id, _resolve_model, retext

MAX_MODELS = 4
MAX_EACH = 3  # pictures of one trial set (seeds)
MAX_LISTED = 400  # main models the network lists
MAX_SUBJECT = 300
MAX_ROUNDS = 30  # rounds the network lists
WITHOUT = ""  # a skill's trials without it


class TrainingError(ValueError):
    pass


def models():
    """The main models here (checkpoints, diffusion models), [{model_id, name, file, base}], at most MAX_LISTED."""
    out = []
    for folder_type, path_idx, base_dir, file_path in _each_model():
        if folder_type not in model_advice.MAIN_TYPES:
            continue
        meta = get_metadata(file_path)
        out.append({"model_id": _model_id(folder_type, path_idx, base_dir, file_path), "file": os.path.basename(file_path),
                    "name": meta.get("custom_name") or meta.get("name") or os.path.splitext(os.path.basename(file_path))[0],
                    "base": meta.get("baseModel") or meta.get("base_guess") or ""})
        if len(out) >= MAX_LISTED:
            break
    return out


def rounds(limit=MAX_ROUNDS):
    """The training rounds started here, newest first: [{id, title, started, kind, target, models (names),
    done, total (trials), taken (an AI took it), ended}]."""
    with ai_tasks._lock:
        tasks = sorted((task for task in ai_tasks._load().values() if isinstance(task.get("training"), dict)),
                       key=lambda task: -(task.get("started") or 0))[:limit]
        return [{"id": task["id"], "title": task.get("title") or "", "started": task.get("started") or 0,
                 "kind": task["training"].get("kind") or "", "target": task["training"].get("skill") or task["training"].get("use") or "",
                 "models": [model.get("name") or "" for model in task["training"].get("models") or []],
                 "done": sum(1 for trial in task["training"].get("trials") or [] if trial.get("run")),
                 "total": len(task["training"].get("trials") or []), "taken": not task.get("waiting"), "ended": bool(task.get("ended"))}
                for task in tasks]


def _model(model_id):
    try:
        folder_type, _path_idx, _base_dir, file_path = _resolve_model(model_id)
    except ToolError as error:
        raise TrainingError(str(error))
    if folder_type not in model_advice.MAIN_TYPES:
        raise TrainingError(f"{model_id} is not a main model (a checkpoint or a diffusion model)")
    meta = get_metadata(file_path)
    return {"model_id": model_id, "file": os.path.basename(file_path), "base": meta.get("baseModel") or meta.get("base_guess") or "",
            "name": meta.get("custom_name") or meta.get("name") or os.path.splitext(os.path.basename(file_path))[0]}


def _items(skill, use, info):
    """What a round compares: a skill and its trials without it, or the ways of `use` that run here and are on."""
    if skill:
        found = ai_skills.SKILLS.get(skill)
        if not found or found.get("private_only") or skill in ai_skills.turned_off():
            raise TrainingError(f"No skill {skill!r} to train")
        return "skill", [WITHOUT, skill]  # without it first: a skill counts for every run after it is fetched
    blocks = [block for block in reference_blocks.status(info) if block["job"] == use and block["usable"] and block["on"]]
    if not blocks:
        raise TrainingError(f"No way of {use!r} runs here")
    return "use", [block["name"] for block in blocks]


def start(title, model_ids, skill="", use="", each=2, subject="", picture="", info=None):
    """A training round as a task for the next AI that calls (ai_tasks.start_task, the models as what it
    is about). Returns the task."""
    kind, items = _items(str(skill or ""), str(use or ""), info or {})
    ids = list(dict.fromkeys(model_ids if isinstance(model_ids, list) else []))
    if not 1 <= len(ids) <= MAX_MODELS:
        raise TrainingError(f"Pick 1 to {MAX_MODELS} models")
    if not isinstance(each, int) or isinstance(each, bool) or not 1 <= each <= MAX_EACH:
        raise TrainingError(f"each is 1 to {MAX_EACH}")
    subject = str(subject or "").strip()[:MAX_SUBJECT]
    if kind == "skill" and not subject:
        raise TrainingError("Say what to draw (subject)")
    takes = kind == "use" and any(reference_blocks.BLOCKS[name].get("takes") for name in items)
    if takes and not ai_tasks._output_media(str(picture or "")):
        raise TrainingError("These ways work on a picture: pick one from the gallery")
    chosen = [_model(str(model_id)) for model_id in ids]
    plan = {"kind": kind, "skill": skill if kind == "skill" else "", "use": use if kind == "use" else "", "items": items,
            "models": chosen, "seeds": [random.randint(1, 2 ** 31 - 1) for _ in range(each)], "subject": subject,
            "picture": str(picture or "") if takes else "", "told": 0,
            "trials": [{"model": at, "item": item, "run": None} for item in items for at in range(len(chosen)) for _ in range(each)]}
    task = ai_tasks.start_task(title, about=[{"type": "model", "model_id": model["model_id"], "label": model["name"]} for model in chosen])
    with ai_tasks._lock:
        stored = ai_tasks._load()[task["id"]]
        stored["training"] = plan
        ai_tasks._save(stored)
    ai_tasks._notify(task["id"])
    return stored


def _uses(plan, item, used):
    if plan["kind"] == "skill":
        return (plan["skill"] in used["skills"]) == (item != WITHOUT)
    return item in [way["name"] for way in used["ways"]]


def note_run(task_id, step_id):
    """Run `step_id` of task `task_id` ended: the first open trial of its plan the run fits (its model and
    what it used) takes it."""
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        plan = (task or {}).get("training")
        step = next((item for item in (task or {}).get("steps", []) if item["id"] == step_id), None)
        if not plan or not step or step.get("state") != "done" or not step.get("used"):
            return
        if any(trial["run"] == step_id for trial in plan["trials"]):
            return
        for trial in plan["trials"]:
            if not trial["run"] and step["used"]["model"] == plan["models"][trial["model"]]["file"] and _uses(plan, trial["item"], step["used"]):
                trial["run"] = step_id
                ai_tasks._save(task)
                break


def _item_words(plan, item):
    if plan["kind"] == "skill":
        return f"with the skill (get_toolbox(skill={plan['skill']}) first)" if item else "without the skill"
    return f"way {item} (add_nodes(block={item}))"


def _pictures(task, runs):
    """The output pictures of runs `runs` of `task`, as show_panel takes them."""
    out = []
    for step in task.get("steps") or []:
        if step["id"] in runs:
            out += ["/".join(part for part in (item.get("subfolder"), item["filename"]) if part)
                    for item in step.get("results") or [] if item.get("type") == "image"]
    return out


def progress(task):
    """Where the round stands, for the AI: how many trials are done and the next, or the trials of a
    model just done to compare, or that all are done."""
    plan = task["training"]
    trials = plan["trials"]
    parts = [f"Training: {sum(1 for trial in trials if trial['run'])} of {len(trials)} trials done."]
    for at, model in enumerate(plan["models"]):
        own = [trial for trial in trials if trial["model"] == at]
        if all(trial["run"] for trial in own) and at not in plan.get("compared", []):
            parts.append(f"The trials on {model['name']} are done: show_panel one picks block of their pictures "
                         f"{_pictures(task, {trial['run'] for trial in own})}, each labelled with its trial, recommended=true on "
                         "the one you judge best, asking which turned out best. The user picks; their pick and yours both go into the record.")
            break
    following = next((trial for trial in trials if not trial["run"]), None)
    if following:
        model = plan["models"][following["model"]]
        parts.append(f"Next: {model['name']} (set_model {model['model_id']}), {_item_words(plan, following['item'])}, seeds {plan['seeds']}.")
    else:
        parts.append("Then: report what did best on which model (done=true).")
    return " ".join(parts)


def brief(task):
    """The round for begin_task: what to compare, on which models, how, and where it stands."""
    plan = task["training"]
    if plan["kind"] == "skill":
        goal = (f"A training round of the skill {plan['skill']}: draw \"{plan['subject']}\" on each model below, the prompt written "
                f"by you without the skill, then with its advice; one picture for each of the seeds {plan['seeds']}, the same "
                "seeds both ways, so the two compare. Do every trial without it first: a skill counts for every run after it is fetched.")
        how = "A plain text-to-image workflow (the canvas's, or new_workflow); per trial set_model, set_prompt, run_workflow(seed=…)."
    else:
        ways = ", ".join(plan["items"])
        goal = (f"A training round of the ways of {plan['use']} ({ways}): run each on each model below"
                + (f" on the picture {plan['picture']}" if plan["picture"] else "") + f", one picture for each of the seeds {plan['seeds']}.")
        how = ("Per trial set_model, then add_nodes(block=…) on a workflow without another of these ways (open the same base "
               "workflow again, or remove the last way), then run_workflow(seed=…). Ask the user (ask_user) when a way needs an area marked.")
    return {"goal": goal, "how": how, "models": [{key: model[key] for key in ("model_id", "name", "base")} for model in plan["models"]],
            "now": progress(task), "note": "Anomalous matches each run to its trial by what it used and tells you what is next."}


def tell(result, task_id):
    """Puts the round's progress into a tool result once it changed (a trial done, a model to compare)."""
    if not isinstance(result, dict) or result.get("isError") or not task_id or "training" in (result.get("structuredContent") or {}):
        return result  # begin_task's answer has the whole round (brief)
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        plan = (task or {}).get("training")
        if not plan:
            return result
        done = sum(1 for trial in plan["trials"] if trial["run"])
        if done == plan.get("told"):
            return result
        plan["told"] = done
        words = progress(task)
        for at in range(len(plan["models"])):
            own = [trial for trial in plan["trials"] if trial["model"] == at]
            if own and all(trial["run"] for trial in own) and at not in plan.setdefault("compared", []):
                plan["compared"].append(at)  # asked once
                break
        ai_tasks._save(task)
    data = dict(result.get("structuredContent") or {})
    data["training"] = words
    retext(result, data)
    return result
