"""Skills: advice on how to do a kind of job, which an AI fetches when the job comes up, beside the
ready-made blocks (reference_blocks.py), which build nodes. A block is something AMB does; a skill
is something the AI reads (how to write a prompt a model can draw). Each skill is a data file in
api/skills/ (<name>.json): what the AI is told it is for (short) and the advice itself (text, a
line a point), and what the user's Ways panel shows (title, about, in both languages,
web/modules/ui_ai_blocks.js). begin_task lists the skills on (name and short); get_toolbox(skill=…)
gives one. The tools' own descriptions only point at a skill, so the list every app holds stays
small. The user turns a skill off in the panel (user/anomalous/ai_skills.json): the AI is not
offered it and get_toolbox refuses it.
"""

import json
import os
import threading

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
    return [{"name": name, "title": skill["title"], "about": skill["about"], "on": name not in off}
            for name, skill in SKILLS.items()]


def directory():
    """The skills on, "name (short)" each after a note on fetching them, a line for begin_task; "" when none is on."""
    off = turned_off()
    listed = [f"{name} ({skill['short']})" for name, skill in SKILLS.items() if name not in off]
    return NOTE + "; ".join(listed) if listed else ""


def get(name):
    """The advice of skill `name`, for get_toolbox."""
    if name not in SKILLS:
        raise SkillError(f"No skill {name!r}; begin_task lists them: {', '.join(SKILLS)}.")
    if name in turned_off():
        raise SkillError(f"The user turned the skill {name!r} off: do the job your own way.")
    return {"skill": name, "advice": SKILLS[name]["text"]}
