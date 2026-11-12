"""The bases the user picks from (run_workflow base_only; the cut: web/modules/base_only.js). When
such a run ends its previews, in ComfyUI's temp folder (emptied whenever ComfyUI starts or stops),
become a picks panel. The one the user picks is copied into the output folder, beside where the
canvas saves its base, and its seed is held: the task's next run_workflow puts it on that sampler,
"fixed", kept under every try (web/modules/mcp_bridge.js). Where the rest of the workflow takes the
base's picture, it takes the kept picture and the base is not drawn again: drawn again, even from the
same seed and settings, it came out grainy once on a 6 GB card (2026-11-04). A base handed on as a
latent (the mid-way switch) is drawn again from its seed; when that run saves its base, the picture is
compared with the kept one, so the user and the AI know whether the second pass grew from it. Until newer
bases come or the task moves to another canvas, the user may take another of those previews instead
(change): it is kept and held the same way, and the AI is told; the earlier copy stays in the output folder."""

import os
import shutil

from PIL import Image, ImageChops, ImageStat

from . import ai_outside, ai_panels, ai_pictures, ai_tasks

SAME_BELOW = 1.0  # mean difference per channel (0-255); the same seed and settings drew the same picture
PREFIX = "amb_base/base"  # where a picked base goes when the canvas saves none of its own
TITLE = "挑一张底图 / Pick a base"
QUESTION = ("挑中的那张会存进输出文件夹，下一步用它的种子接着画 / "
            "The one you pick is kept in the output folder; the next pass grows from its seed")


def _step(task, step_id):
    return next((item for item in (task or {}).get("steps") or [] if item.get("id") == step_id), None)


def hold_of(task_id):
    """The base the user picked in task `task_id`, for run_workflow to hold, or None."""
    task = ai_tasks.get_task(task_id) if task_id else None
    return dict((task or {}).get("base_hold") or {}) or None


def forget(task_id):
    """New bases are coming: the earlier pick no longer holds."""
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id) if task_id else None
        if task and task.pop("base_hold", None) is not None:
            ai_tasks._save(task)


def _seed(prompt, base):
    inputs = (prompt.get(str(base["node"])) or {}).get("inputs") or {}
    return next((inputs[name] for name in base.get("names") or [] if isinstance(inputs.get(name), int)), None)


def offer(task_id, step_id, prompts, history):
    """A finished base_only run: its previews on a picks panel, each with the seed that drew it."""
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        step = _step(task, step_id)
        info = (step or {}).get("bases")
        if not info or step.get("state") != "done" or step.get("offered"):
            return None
        step["offered"] = True
        client = task.get("client") or "AI"
        ai_tasks._save(task)
    items, picks = [], {}
    for prompt_id in prompts:
        record = history.get(prompt_id) or {}
        prompt = (record.get("prompt") or [None, None, {}])[2] or {}
        base = next((base for base in info["bases"] if _seed(prompt, base) is not None), info["bases"][0])
        for show in info["shows"]:
            for image in ((record.get("outputs") or {}).get(str(show)) or {}).get("images") or []:
                if image.get("type") != "temp" or len(items) >= ai_panels.MAX_ITEMS:
                    continue
                rel = "/".join(part for part in (image.get("subfolder"), image.get("filename")) if part)
                seed, item_id = _seed(prompt, base), f"b{len(items) + 1}"
                items.append({"id": item_id, "image": rel, "folder": "temp", "label": f"{len(items) + 1} · seed {seed}"})
                picks[item_id] = {"image": rel, "seed": seed, "node": str(base["node"]), "type": base["type"],
                                  "names": base.get("names") or [], "show": str(show) if show in info.get("saved", []) else None}
    if not items:
        return None
    block = {"type": "picks", "id": "base", "question": QUESTION, "question_key": "aiBaseQuestion", "items": items}
    return ai_panels.show(client, TITLE, [block], task_id=task_id, tool="pick_base", title_key="aiBaseTitle",
                          extra={"bases": picks, "prefix": info.get("prefix") or PREFIX})


def prepare(task_id, step_id, choice, skip=False):
    """The user's pick on a bases panel, made before it is recorded: the picture copied into the output
    folder; {} for other panels."""
    step = _step(ai_tasks.get_task(task_id), step_id)
    bases = (step or {}).get("bases")
    if not bases or skip:
        return {}
    picked = bases.get(str((choice if isinstance(choice, list) else [choice])[0] if choice else ""))
    if not picked:
        return {}
    import folder_paths

    source = os.path.join(folder_paths.get_temp_directory(), *picked["image"].split("/"))
    if not os.path.isfile(source):
        raise ValueError(f"这张预览已经没了：ComfyUI 重启时会清空临时文件夹。让 AI 用种子 {picked['seed']} 再画一次 / "
                         f"This preview is gone: ComfyUI empties its temp folder when it restarts. Ask the AI to draw it "
                         f"again with seed {picked['seed']}")
    with Image.open(source) as picture:
        width, height = picture.size
    folder, name, counter, subfolder, _prefix = folder_paths.get_save_image_path(
        step.get("prefix") or PREFIX, folder_paths.get_output_directory(), width, height)
    target = f"{name}_{counter:05}_.png"
    ai_outside.own(target)
    shutil.copyfile(source, os.path.join(folder, target))  # its prompt and workflow come with it
    kept = "/".join(part for part in (subfolder, target) if part)
    picked = {**picked, "kept": kept, "kept_input": ai_pictures.to_input(kept), "picked_on": step_id}  # kept_input: what LoadImage reads
    return {"base": picked, "kept": kept, "seed": picked["seed"],
            "note": f"Anomalous keeps this base as {kept} and holds seed {picked['seed']} on node {picked['node']} "
                    "for your next run_workflow: run the whole workflow now; do not change that seed."}


def discard(prepared):
    """The copy `prepare` made, when the pick was refused after all (answered already)."""
    if (prepared or {}).get("base"):
        import folder_paths

        try:
            os.remove(os.path.join(folder_paths.get_output_directory(), *prepared["kept"].split("/")))
        except OSError:
            pass


def hold(task_id, extra):
    """Holds the base the user just picked (prepare's answer) for the task's next runs."""
    base = (extra or {}).get("base")
    if not base:
        return
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        if task:
            task["base_hold"] = {key: base[key] for key in ("node", "type", "names", "seed", "kept", "kept_input", "show", "picked_on")}
            ai_tasks._save(task)


def change(task_id, step_id, choice):
    """Another base taken instead on bases panel `step_id` while the task still holds that panel's pick: kept
    and held as the first one was, and the AI told. Returns the step's answers."""
    task = ai_tasks.get_task(task_id)
    if ((task or {}).get("base_hold") or {}).get("picked_on") != step_id:
        raise ValueError("这次挑的底图已经换不了了：之后又出了新底图，或任务换了画布 / "
                         "This pick can no longer change: newer bases came since, or the task moved to another canvas")
    answers = dict(_step(task, step_id).get("answers") or {})
    if answers.get("base", {}).get("choice") == (choice if isinstance(choice, list) else [choice]):
        return answers  # that one already (a second click)
    extra = prepare(task_id, step_id, choice)
    if not extra:
        raise ValueError("Pick one of the bases")
    extra["note"] = (f"The user took another base instead: Anomalous now keeps {extra['kept']} and holds seed {extra['seed']} "
                     f"on node {extra['base']['node']} for your next run_workflow. A run started before this still draws from "
                     "the earlier base: run the whole workflow again; do not change that seed.")
    try:
        answers = ai_panels.answer(task_id, step_id, "base", choice, extra=extra, again=True)
    except ai_panels.PanelError:
        discard(extra)
        raise
    hold(task_id, extra)
    return answers


def same(first, second):
    """The mean difference of two pictures per channel (0-255), or None when they differ in size."""
    with Image.open(first) as a, Image.open(second) as b:
        if a.size != b.size:
            return None
        return sum(ImageStat.Stat(ImageChops.difference(a.convert("RGB"), b.convert("RGB"))).mean) / 3


def check(task_id, step_id, prompts, history):
    """A run that held a picked base and saved its base again: is it the picked picture?"""
    import folder_paths

    with ai_tasks._lock:
        step = _step(ai_tasks._load().get(task_id), step_id)
        asked = dict((step or {}).get("base_check") or {})
    if not asked or "same" in asked:
        return
    output = folder_paths.get_output_directory()
    record = next((history.get(prompt_id) for prompt_id in prompts if history.get(prompt_id)), None) or {}
    image = next((item for item in ((record.get("outputs") or {}).get(asked["show"]) or {}).get("images") or []
                  if item.get("type") == "output"), None)
    if not image:
        return
    try:
        diff = same(os.path.join(output, *asked["kept"].split("/")),
                    os.path.join(output, image.get("subfolder") or "", image["filename"]))
    except OSError:
        return
    with ai_tasks._lock:
        task = ai_tasks._load().get(task_id)
        step = _step(task, step_id)
        if step is None:
            return
        step["base_check"] = {**asked, "same": diff is not None and diff < SAME_BELOW, "diff": None if diff is None else round(diff, 2)}
        ai_tasks._save(task)
    ai_tasks._notify(task_id)


def words(run):
    """What the AI is told of a run's base: the bases offered, or whether the picked one held."""
    if run.get("bases") and run.get("state") == "done":
        return ("Anomalous showed the user these bases to pick from (a panel); get_answers waits for their pick, "
                "then run the whole workflow: the picked base is kept and its seed held.")
    check_ = run.get("base_check") or {}
    if check_.get("same") is True:
        return f"Its base is the one the user picked ({check_['kept']})."
    if check_.get("same") is False:
        return (f"Its base is NOT the one the user picked ({check_['kept']}): something before the second pass changed "
                "(prompt, model, LoRA, size or a setting). Tell the user (report) before going on.")
    return ""
