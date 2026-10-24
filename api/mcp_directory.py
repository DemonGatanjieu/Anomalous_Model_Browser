"""A directory of the tools by what an AI wants to do, so it goes straight to the right one, as
ARCHITECTURE.md does for the code: each tool offered under its stage of the work
(action_catalog.TOOLS), with its title, in the catalog's order. It is built from the registry,
so a new tool shows up by itself (tests/test_mcp_directory.py checks that every stage has a
heading). mcp_server.py puts it into begin_task's answer, and into get_situation's while there
is no task yet.
"""

from . import action_catalog
from .mcp_tools import retext

SECTIONS = (  # stage -> heading, in the order work usually goes
    ("run", "Run a workflow"), ("canvas", "The workflow on the canvas"), ("model", "Models"), ("prompt", "Prompts"),
    ("combo", "Combos"), ("picture", "Pictures"), ("voice", "Voices"), ("library", "The library"),
    (None, "The task and the user"),
)
NOTE = "The tools by what you want to do: go straight to the one you need instead of looking around first."


def directory(specs):
    """{heading: "tool (title), ..."} for the tools offered, `specs` {name: spec}."""
    sections = {}
    for name, entry in action_catalog.TOOLS.items():
        if name in specs:
            sections.setdefault(entry.stage, []).append(f"{name} ({specs[name].get('title') or name})")
    return {"note": NOTE, **{heading: ", ".join(sections[stage]) for stage, heading in SECTIONS if stage in sections}}


def attach(result, name, specs):
    """Puts the directory into begin_task's answer, and into get_situation's while there is no task."""
    data = result.get("structuredContent") if isinstance(result, dict) and not result.get("isError") else None
    if not isinstance(data, dict) or not (name == "begin_task" or (name == "get_situation" and not data.get("task"))):
        return result
    retext(result, {**data, "directory": directory(specs)})
    return result
