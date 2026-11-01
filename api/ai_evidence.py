"""What worked here: the record of the ready-made ways (reference_blocks.py), the skills
(ai_skills.py) and the custom node packs the AI's runs used, by the base model of the run's main
model, so any AI sees at a glance what was tried on which model and how it turned out (begin_task,
get_toolbox, add_nodes), the user sees it in the Ways panel, and add_nodes picks the way that did best.

A run's step gets "used" once its prompt is known (ai_task_runs._estimate): the main model and its
base model, the ways added in its task whose nodes it still has, the skills fetched before it in its
task, the packs of its nodes. When it ends it becomes an entry of the record (ai_evidence.json in
the ComfyUI user folder, the last MAX_RUNS), with the AI app that ran it. How it went comes from what
the user does anyway, nothing to note down by hand: a picture of it picked in a picks panel or kept in
the gallery (a recipe, a combo or a prompt made from it, kept_images.py), or their word on the run
(set_verdict, told to the AI too), counts it good; their word "not good" counts it so; its pictures
passed over in a picks panel count it "not chosen". The AI's own pick in that panel (the picture it
marked recommended, ai_training.py asks for one) is kept apart as the AI's judgement, as is a pick
the user left to it (ai_answer_wait takes the recommended one). The record keeps model, way, skill and pack
names, never a prompt; its pictures' names stay on this computer, to match the user's picks.
"""

import json
import os
import threading
import time
import uuid

from . import ai_tasks, kept_images, model_advice, reference_blocks
from .path_utils import atomic_write_json

MAX_RUNS = 2000
MAX_PICTURES = 8
MAX_BASES = 4  # base models in one item's line for the AI
MAX_SHOWN = 6  # pictures of one item on one base model the network shows
MAX_LISTED = 40  # runs of one pair the network lists
OVERVIEW_CHARS = 300
KINDS = ("way", "skill", "pack")
VERDICTS = ("good", "bad")
MODEL_INPUTS = ("ckpt_name", "unet_name")
COUNTS = (("good", "good"), ("bad", "not good"), ("passed", "not chosen"), ("failed", "failed"))
_lock = threading.Lock()
_cache = {"path": "", "runs": {}}


def _path():
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "ai_evidence.json")


def _runs():
    """The record, {run step id: entry}, read once and kept (the user folder can change: tests). Under _lock."""
    path = _path()
    if _cache["path"] != path:
        try:
            with open(path, encoding="utf-8") as source:
                stored = json.load(source).get("runs")
        except (OSError, ValueError, AttributeError):
            stored = None
        _cache.update(path=path, runs=stored if isinstance(stored, dict) else {})
    return _cache["runs"]


def _save(runs):
    for key in sorted(runs, key=lambda key: runs[key].get("at", 0))[:max(0, len(runs) - MAX_RUNS)]:
        del runs[key]
    atomic_write_json(_path(), {"runs": runs})


def _main_model(nodes):
    """The main model file of a run's nodes: followed from its first sampler's model input up to the
    loader (through LoRAs and model patches), or ""."""
    samplers = sorted((key for key, node in nodes.items() if isinstance(node.get("inputs", {}).get("model"), list)
                       and "positive" in node["inputs"]), key=lambda key: (len(key), key))
    node, seen = nodes.get(samplers[0]) if samplers else None, set()
    while node and id(node) not in seen:
        seen.add(id(node))
        inputs = node.get("inputs") or {}
        name = next((inputs[key] for key in MODEL_INPUTS if isinstance(inputs.get(key), str)), None)
        if name:
            return name
        link = inputs.get("model")
        node = nodes.get(str(link[0])) if isinstance(link, list) and link else None
    return ""


def _packs(types):
    """The custom node packs (their folders) node types `types` come from, as ComfyUI loaded them."""
    try:
        import nodes
    except ImportError:  # no ComfyUI (tests)
        return []
    modules = {str(getattr(nodes.NODE_CLASS_MAPPINGS.get(kind), "RELATIVE_PYTHON_MODULE", "") or "") for kind in types}
    return sorted({module.split(".")[1] for module in modules if module.startswith("custom_nodes.")})


def ran(prompt):
    """What API prompt `prompt` runs, before its task is looked at: its main model, that model's base
    model, its packs and node types."""
    nodes = {str(key): node for key, node in (prompt or {}).items() if isinstance(node, dict) and node.get("class_type")}
    types = {node["class_type"] for node in nodes.values()}
    model = _main_model(nodes)
    return {"model": os.path.basename(model.replace("\\", "/")), "base": model_advice._main_base(model) if model else "",
            "packs": _packs(types), "types": sorted(types)}


def _needs(block):
    """The node types a run has when it has way `block`: those of its nodes, or of a variant's."""
    groups = [block["nodes"], *(variant["nodes"] for variant in (block.get("variants") or {}).values() if variant.get("nodes"))]
    return [{spec["class_type"] for spec in group.values() if not spec.get("optional")} for group in groups]


def used(found, steps):
    """A run's "used" from `found` (ran()) and the steps of its task before it: the ways added there that
    it still has (their names and titles), the skills fetched there."""
    types = set(found["types"])
    added = [result.get("name") for step in steps if step.get("tool") == "add_nodes" and step.get("ok")
             for result in step.get("results") or [] if result.get("type") == "way"]
    ways = [name for name in dict.fromkeys(added) if name in reference_blocks.BLOCKS
            and any(need <= types for need in _needs(reference_blocks.BLOCKS[name]))]
    return {"model": found["model"], "base": found["base"], "packs": found["packs"],
            "ways": [{"name": name, "title": reference_blocks.BLOCKS[name]["title"]} for name in ways],
            "skills": list(dict.fromkeys(
                [step["skill"] for step in steps if step.get("tool") == "use_skill" and step.get("skill")]
                + ["external:" + step["external_skill"] for step in steps
                   if step.get("tool") == "log_outside" and step.get("external_skill")]))}


def note_run(task_id, step_id):
    """Run `step_id` of task `task_id` ended: an entry of the record, unless it was stopped or its
    prompt was never seen."""
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        step = next((item for item in (task or {}).get("steps", []) if item["id"] == step_id), None)
        if not step or not step.get("used") or step.get("state") not in ("done", "error"):
            return
        found = step["used"]
        entry = {"at": step["at"], "task": task_id, "client": task.get("client") or "", "model": found["model"],
                 "base": found["base"], "state": step["state"], "ways": [way["name"] for way in found["ways"]],
                 "skills": found["skills"], "packs": found["packs"],
                 "pictures": [[item.get("subfolder") or "", item["filename"]] for item in step.get("results") or []
                              if item.get("type") == "image"][:MAX_PICTURES]}
        if step.get("verdict"):
            entry["verdict"] = step["verdict"]
    if not (entry["ways"] or entry["skills"] or entry["packs"]):
        return  # ComfyUI's own nodes only, no way or skill: nothing of the record's to count
    with _lock:
        runs = _runs()
        runs[step_id] = {**runs.get(step_id, {}), **entry}
        _save(runs)


def note_picks(items, picked, taken=False):
    """A picks panel answered (its pictures `items`, the ids `picked`): a run with a picture the user picked
    counts good, one whose pictures they only passed over "not chosen"; the items the AI marked recommended
    count the same way as its own judgement. `taken`: the user left it to the AI (its pick was taken for them):
    the AI's judgement only."""
    key = lambda item: (str(item.get("subfolder") or ""), str(item.get("filename") or ""))  # noqa: E731
    shown = {key(item) for item in items}
    chosen = set() if taken else {key(item) for item in items if item.get("id") in picked}
    advised = {key(item) for item in items if item.get("recommended")}
    with _lock:
        runs, changed = _runs(), False
        for entry in runs.values():
            pictures = {tuple(picture) for picture in entry.get("pictures") or []}
            if not pictures & shown:
                continue
            marks = {}
            if not taken:
                marks["picked" if pictures & chosen else "passed"] = True
            if advised:
                marks["ai_picked" if pictures & advised else "ai_passed"] = True
            for mark in [mark for mark in marks if not entry.get(mark)]:
                entry[mark], changed = True, True
        if changed:
            _save(runs)


def set_verdict(task_id, step_id, verdict):
    """The user's word on finished run `step_id`: "good", "bad" or None (taken back); kept on the step and
    in the record, and a word to the AI. Returns it."""
    if verdict not in (*VERDICTS, None):
        raise ValueError("verdict is good, bad or null")
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        steps = (task or {}).get("steps", [])
        step = next((item for item in steps if item["id"] == step_id), None)
        if not step or step.get("tool") != "run_workflow" or step.get("state") != "done":
            raise ValueError("No such finished run")
        if step.get("verdict") == verdict:
            return verdict
        if verdict:
            step["verdict"] = verdict
            number = sum(1 for item in steps[:steps.index(step) + 1] if item.get("tool") == "run_workflow")
            ai_tasks._add_step(task, {"id": uuid.uuid4().hex[:10], "at": time.time(), "ms": 0, "tool": "user_verdict", "kind": "user",
                                      "ok": True, "state": "done", "summary": "user_verdict", "verdict": verdict, "run": step_id,
                                      "delivered": False, "results": [], "text": (
                                          f"The user says run {number} of this task (step {step_id}) turned out well."
                                          if verdict == "good" else
                                          f"The user says run {number} of this task (step {step_id}) did not turn out well: "
                                          "change the way, a setting or the prompt before running again, or ask them what is off.")})
        else:
            step.pop("verdict", None)
        ai_tasks._save(task)
    with _lock:
        runs = _runs()
        if step_id in runs:
            runs[step_id]["verdict"] = verdict
            _save(runs)
    ai_tasks._notify(task_id)
    return verdict


def _kept():
    try:
        return kept_images.kept_keys()
    except (OSError, ValueError):  # a store unreadable: the gallery's keeps are left out of the count
        return set()


def _judge(entry, kept):
    """How a run turned out for the user, and by what: ("good" | "bad" | "passed" | "", "word" | "pick" |
    "keep" | ""): their word first, then a pick in a picks panel or a keep in the gallery, then passed over."""
    if entry.get("verdict") in VERDICTS:
        return entry["verdict"], "word"
    if entry.get("picked"):
        return "good", "pick"
    if {tuple(picture) for picture in entry.get("pictures") or []} & kept:
        return "good", "keep"
    return ("passed", "pick") if entry.get("passed") else ("", "")


def _ai(entry):
    return "picked" if entry.get("ai_picked") else "passed" if entry.get("ai_passed") else ""


def tally():
    """The record summed up: {kind: {name: {base: {runs, good, bad, passed, failed, ai_good, ai_passed, clients,
    pictures (the last few, [subfolder, filename])}}}}."""
    out = {kind: {} for kind in KINDS}
    with _lock:
        entries = list(_runs().values())
    if not entries:
        return out
    kept = _kept()
    for entry in entries:
        judged = _judge(entry, kept)[0]
        for kind in KINDS:
            for name in entry.get(f"{kind}s") or []:
                count = out[kind].setdefault(name, {}).setdefault(entry.get("base") or "", {
                    "runs": 0, "good": 0, "bad": 0, "passed": 0, "failed": 0, "ai_good": 0, "ai_passed": 0, "clients": [], "pictures": []})
                count["runs"] += 1
                count["good"] += judged == "good"
                count["bad"] += judged == "bad"
                count["passed"] += judged == "passed"
                count["failed"] += entry.get("state") == "error"
                count["ai_good"] += _ai(entry) == "picked"
                count["ai_passed"] += _ai(entry) == "passed"
                count["pictures"] = (count["pictures"] + [list(picture) for picture in entry.get("pictures") or []])[-MAX_SHOWN:]
                if entry.get("client") and entry["client"] not in count["clients"]:
                    count["clients"].append(entry["client"])
    return out


def by_model():
    """Each main model's runs: {model file: {runs, good, bad, passed, ai (the AI judged it)}}."""
    with _lock:
        entries = list(_runs().values())
    kept = _kept() if entries else set()
    out = {}
    for entry in entries:
        if entry.get("model"):
            count = out.setdefault(entry["model"], {"runs": 0, "good": 0, "bad": 0, "passed": 0, "ai": 0})
            judged = _judge(entry, kept)[0]
            count["runs"] += 1
            count["ai"] += bool(_ai(entry))
            if judged:
                count[judged] += 1
    return out


def runs_of(kind, name, base=None, limit=MAX_LISTED):
    """The runs with item `name` (a way, skill or pack), on base model `base` when it is given, newest first:
    [{id, at, task, client, model, base, state, judged, by, ai, pictures}] (judged, by: _judge; ai: the AI's pick)."""
    if kind not in KINDS:
        raise ValueError("kind is way, skill or pack")
    with _lock:
        found = [(key, dict(entry)) for key, entry in _runs().items() if name in (entry.get(f"{kind}s") or [])
                 and (base is None or (entry.get("base") or "") == base)]
    found.sort(key=lambda item: -item[1].get("at", 0))
    kept = _kept() if found else set()
    out = []
    for key, entry in found[:limit]:
        judged, by = _judge(entry, kept)
        out.append({"id": key, "at": entry.get("at", 0), "task": entry.get("task") or "", "client": entry.get("client") or "",
                    "model": entry.get("model") or "", "base": entry.get("base") or "", "state": entry.get("state") or "",
                    "judged": judged, "by": by, "ai": _ai(entry), "pictures": entry.get("pictures") or []})
    return out


def _line(base, count):
    parts = [f"{count[key]} {label}" for key, label in COUNTS if count[key]]
    ai = [f"{count[key]} {label}" for key, label in (("ai_good", "picked"), ("ai_passed", "passed over")) if count[key]]
    return (f"{base or 'other models'} {count['runs']} runs: {', '.join(parts) or 'none judged by the user yet'}"
            + (f" (the AI's own judgement: {', '.join(ai)})" if ai else ""))


def words(kind, name, found=None):
    """The record of item `name` (a way, skill or pack) in a line for the AI, most run base models
    first, with the AI apps that ran it; "" when it never ran here."""
    bases = (found or tally())[kind].get(name)
    if not bases:
        return ""
    shown = sorted(bases, key=lambda base: -bases[base]["runs"])[:MAX_BASES]
    clients = list(dict.fromkeys(client for base in shown for client in bases[base]["clients"]))
    return "; ".join(_line(base, bases[base]) for base in shown) + (f" (run by {', '.join(clients[:3])})" if clients else "")


def overview(limit=OVERVIEW_CHARS):
    """The ways' and skills' record in a few words for begin_task and get_toolbox, most runs first; ""
    when nothing ran yet."""
    found = tally()
    items = sorted(((name, kind, base, count) for kind in ("way", "skill") for name, bases in found[kind].items()
                    for base, count in bases.items()), key=lambda item: -item[3]["runs"])
    text = ""
    for name, kind, base, count in items:
        part = f"{name} ({kind}) {base or 'other models'}: {count['good']} good of {count['runs']}" + (
            f", {count['bad']} not good" if count["bad"] else "")
        if len(text) + len(part) + 2 > limit:
            break
        text += ("; " if text else "") + part
    return (f"Runs here (the user's picks and words; a way or skill not named is untried here): {text}." if text else "")


def order(kind, names, base_of):
    """`names` best first by their record on the canvas's base model (`base_of()`, asked only when one of
    them has a record): good runs up, the user's "not good" and "not chosen" down; untried ones and ties
    keep their order."""
    found = tally()[kind]
    if not any(name in found for name in names):
        return names
    base = base_of()

    def score(name):
        count = found.get(name, {}).get(base)
        return count["good"] - count["bad"] - count["passed"] / 2 if count else 0
    return sorted(names, key=lambda name: -score(name))
