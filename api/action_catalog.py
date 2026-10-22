"""What each thing an AI app can do through Anomalous's MCP endpoint is, in one place.

Every tool (mcp_tools.py reads, mcp_actions.py acts, mcp_task_tools.py the AI's own) has an
entry here: its kind (the AI workbench's colour, words and counts; None = not a step of its
own), the stage of the work it belongs to (the flow over a task: models, combo, prompt,
canvas, run, pictures, voice, library) and its gate (what it touches or costs, for the user's
rules on what needs their OK: canvas, gpu, download, network; None = nothing to guard).
tests/test_action_catalog.py keeps this catalog and the tools in step.

The user's own changes in Anomalous (activity log actions) get stages too, so the ones made
while an AI works sit in the same flow as its steps (ai_tasks.note_activity).
"""

from collections import namedtuple

Entry = namedtuple("Entry", "kind stage gate")

STAGES = ("model", "combo", "prompt", "canvas", "run", "picture", "voice", "library")
GATES = ("canvas", "gpu", "download", "network")

TOOLS = {
    # reading
    "library_overview": Entry("look", "library", None),
    "search_models": Entry("look", "model", None),
    "get_model": Entry("look", "model", None),
    "scan_report": Entry("look", "library", None),
    "search_images": Entry("look", "picture", None),
    "get_image_info": Entry("look", "picture", None),
    "list_combos": Entry("look", "combo", None),
    "list_workflows": Entry("look", "canvas", None),
    "list_saved_prompts": Entry("look", "prompt", None),
    "search_audio": Entry("look", "voice", None),
    "recent_activity": Entry("look", "library", None),
    "describe_canvas": Entry("look", "canvas", None),
    "check_workflow_models": Entry("look", "model", None),
    "download_status": Entry("look", "model", None),
    "list_voices": Entry("look", "voice", None),
    # acting
    "set_prompt": Entry("canvas", "prompt", "canvas"),
    "set_model": Entry("canvas", "model", "canvas"),
    "add_lora": Entry("canvas", "model", "canvas"),
    "place_combo": Entry("canvas", "combo", "canvas"),
    "fix_workflow_models": Entry("canvas", "model", "canvas"),
    "find_nodes": Entry("look", "canvas", None),
    "add_node": Entry("canvas", "canvas", "canvas"),
    "connect_nodes": Entry("canvas", "canvas", "canvas"),
    "set_values": Entry("canvas", "canvas", "canvas"),
    "remove_nodes": Entry("canvas", "canvas", "canvas"),
    "new_workflow": Entry("canvas", "canvas", "canvas"),
    "open_workflow": Entry("canvas", "canvas", "canvas"),
    "run_workflow": Entry("run", "run", "gpu"),
    "download_missing_models": Entry("download", "model", "download"),
    "download_model": Entry("download", "model", "download"),
    "scan_models": Entry("scan", "library", "network"),
    "speak": Entry("speech", "voice", "gpu"),
    "open_in_anomalous": Entry("show", "model", None),
    # the AI's own: notes and panels are steps; the rest only steer the task
    "report": Entry("note", None, None),
    "show_panel": Entry("panel", None, None),
    "begin_task": Entry(None, None, None),
    "update_panel": Entry(None, None, None),
    "get_answers": Entry(None, None, None),
    "run_status": Entry("look", "run", None),
    "get_toolbox": Entry(None, None, None),
    # Anomalous's card in the conversation (mcp_apps.py): its own calls, not the AI's steps
    "app_task_view": Entry(None, None, None),
    "app_answer": Entry(None, None, None),
}

# Activity log actions (activity_log.py ROUTE_ACTIONS, and "canvas") the user makes in Anomalous
# that belong in the task an AI is working on, with their stage. Downloads, imports, moves, scans
# and backups are left out: an AI's own calls can cause those too.
USER_ACTIONS = {
    "canvas": "canvas",
    "model_edit": "library", "model_cover": "library", "model_delete": "library",
    "recipe_save": "canvas", "recipe_edit": "canvas", "recipe_delete": "canvas", "recipe_restore": "canvas",
    "material_save": "prompt", "material_edit": "prompt", "material_delete": "prompt",
    "preset_save": "run", "preset_rename": "run", "preset_delete": "run",
    "image_delete": "picture", "audio_delete": "voice", "audio_save": "voice", "voice_settings": "voice",
    "note_save": "library", "note_delete": "library",
}


def entry(tool, read_only=True):
    """The catalog entry of `tool`; one not listed is a read, or an act when it is not read-only."""
    found = TOOLS.get(tool)
    if found:
        return found
    return Entry("look" if read_only else "act", None, None)


def is_step(tool):
    """Whether a call of `tool` is a step of its own in a task."""
    return entry(tool).kind is not None
