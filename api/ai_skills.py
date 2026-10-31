"""Skills: advice on how to do a kind of job, which an AI fetches when the job comes up, beside the
ready-made blocks (reference_blocks.py), which build nodes. A block is something AMB does; a skill
is something the AI reads (how to write a prompt a model can draw). Each skill is a data file in
api/skills/ (<name>.json): what the AI is told it is for (short) and the advice itself (text, a
line a point), and what the user's Ways panel shows (title, about, in both languages,
web/modules/ui_ai_blocks.js). Advice that depends on the canvas's main model (by_model) comes
in the form for its size: "large" from `large_from` parameters, "small" under it, "unknown" when the
model or its size cannot be told (model_advice.main_params counts them from the file's header).
begin_task lists the skills on (name and short); get_toolbox(skill=…)
gives one. The tools' own descriptions only point at a skill, so the list every app holds stays
small. The user turns a skill off in the panel (user/anomalous/ai_skills.json): the AI is not
offered it and get_toolbox refuses it. A skill marked private_only is for private tasks
(ai_privacy.py): begin_task points at it there instead of listing the others. A by_model skill's
for_user words say the same to the user, on the prompt box of a private task. Each skill fetched is a step of the AI's task (note_use), with
the form its advice came in, so the user sees what the AI went by; the run after it says so too.
"""

import json
import os
import threading
import time
import uuid

FOLDER = os.path.join(os.path.dirname(__file__), "skills")
NOTE = "Advice: get_toolbox(skill=name) when its job comes up: "
_lock = threading.Lock()


class SkillError(ValueError):
    pass


def _load():
    found = {}
    for file in sorted(os.listdir(FOLDER)):
        if file.endswith(".json"):
            with open(os.path.join(FOLDER, file), encoding="utf-8") as source:
                found[file[:-5]] = json.load(source)
    return found


SKILLS = _load()


def _off_path():
    from . import ai_tasks

    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "ai_skills.json")


def turned_off():
    """The skills the user turned off in the panel."""
    try:
        with open(_off_path(), encoding="utf-8") as file:
            return {name for name in json.load(file).get("off", []) if name in SKILLS}
    except (OSError, ValueError, AttributeError):
        return set()


def set_on(name, on):
    """Turns skill `name` on or off for the AI; the skills now off."""
    from .path_utils import atomic_write_json

    if name not in SKILLS:
        raise SkillError(f"No skill {name!r}.")
    with _lock:
        off = turned_off() - {name} if on else turned_off() | {name}
        atomic_write_json(_off_path(), {"off": sorted(off)})
    return off


def status():
    """Every skill as the user's panel shows it."""
    off = turned_off()
    return [{"name": name, "title": skill["title"], "about": skill["about"], "on": name not in off,
             "private_only": skill.get("private_only") is True} for name, skill in SKILLS.items()]


def directory():
    """The skills on, "name (short)" each after a note on fetching them, a line for begin_task; "" when none is on."""
    off = turned_off()
    listed = [f"{name} ({skill['short']})" for name, skill in SKILLS.items() if name not in off and not skill.get("private_only")]
    return NOTE + "; ".join(listed) if listed else ""


def by_model(name):
    """Whether skill `name`'s advice depends on the canvas's main model."""
    return bool(SKILLS.get(name, {}).get("by_model"))


def _form(forms, model):
    """Which form of `forms` (a skill's by_model) is for `model` {name, params}: large, small or unknown."""
    params = (model or {}).get("params") or 0
    return "unknown" if not params else "large" if params >= forms["large_from"] else "small"


def _model_name(model):
    return os.path.splitext(os.path.basename(str((model or {}).get("name") or "").replace("\\", "/")))[0]


def get(name, model=None):
    """The advice of skill `name`, for get_toolbox; `model`: the canvas's main model {name, params},
    for a skill whose advice depends on it."""
    if name not in SKILLS:
        raise SkillError(f"No skill {name!r}; begin_task lists them: {', '.join(SKILLS)}.")
    if name in turned_off():
        raise SkillError(f"The user turned the skill {name!r} off: do the job your own way.")
    skill = SKILLS[name]
    lines = list(skill["text"])
    answer = {"skill": name, "advice": lines}
    forms = skill.get("by_model")
    if forms:
        form = _form(forms, model)
        size = f"{model['params'] / 1e9:.1f} billion" if form != "unknown" else ""
        lines[1:1] = [line.format(model=_model_name(model) or "The model", size=size) for line in forms[form]]
        answer["for_model"] = {"form": form, "model": _model_name(model), "billions": round(model["params"] / 1e9, 1) if size else None}
    return answer


def for_user(model, name="prompt_pose"):
    """Skill `name`'s words for the user on `model` {name, params} (its for_user form, {zh, en}); None when it is off."""
    skill = SKILLS.get(name) or {}
    forms = (skill.get("by_model") or {}).get("for_user")
    if not forms or name in turned_off():
        return None
    form = _form(skill["by_model"], model)
    billions = f"{model['params'] / 1e9:.1f}" if form != "unknown" else ""
    return {lang: text.format(model=_model_name(model), billions=billions) for lang, text in forms[form].items()}


def note_use(client, answer, session="", task_id=None, now=None):
    """Skill `answer` (get's) fetched by the AI, as a step of its task: which skill and, for one that goes
    by the model, the form it came in. The same skill in the same form again before a run adds nothing."""
    from . import ai_tasks

    skill = SKILLS[answer["skill"]]
    now = time.time() if now is None else now
    step = {"id": uuid.uuid4().hex[:10], "at": now, "ms": 0, "tool": "use_skill", "kind": "skill", "ok": True, "state": "done",
            "summary": "use_skill", "skill": answer["skill"], "title": skill["title"], "for_model": answer.get("for_model"), "results": []}
    with ai_tasks._lock:
        task = ai_tasks.current_task(client, now, session=session, task_id=task_id)
        for earlier in reversed(task.get("steps") or []):
            if earlier.get("tool") == "run_workflow":
                break
            if earlier.get("tool") == "use_skill" and earlier.get("skill") == step["skill"] and earlier.get("for_model") == step["for_model"]:
                return earlier
        ai_tasks._add_step(task, step)
        ai_tasks._save(task)
    ai_tasks._notify(task["id"])
    return step
