"""run_workflow's blanks: a daily run in one call, so a small model need not read and edit the canvas.

With `workflow` (a saved workflow's name) the run opens it in the task's tab the first time and
reuses that tab after (the page marks a tab open_workflow opened with the workflow's file); what
the AI fills in goes into it first (web/modules/mcp_canvas_edit.js fill_slots): the positive and
negative prompt boxes, the seed of every sampler, the empty latent's width and height, the
picture its LoadImage reads (from the input or the output folder, found here, never copied;
image_node says which LoadImage when there are several), and `values`: any other setting by its
name, a third-party node's as well, for the one node that has it ({node id: {...}} when several
do; set_values takes the same). No fixed list of blanks grows here. The rest stays as saved. Without
`workflow` the blanks go into the canvas the run would run. All of it is checked before anything
changes, and it is one Ctrl+Z step logged as the AI's.
"""

from . import ai_task_canvas, ai_tasks
from .mcp_bridge import PageRefused, PageUnavailable, ask_page
from .mcp_tools import ToolError, _resolve_folder_image, list_workflows

SLOTS = ("prompt", "negative", "seed", "width", "height", "image", "image_node", "values")
MAX_VALUES = 60
MAX_TEXT = 20000


def flat_values(values):
    """{setting name: value}, checked for shape and size; the page checks what each setting takes."""
    if values is None:
        return {}
    if not isinstance(values, dict) or len(values) > MAX_VALUES:
        raise ToolError(f"values is an object {{setting name: value}} of up to {MAX_VALUES} settings.")
    for name, value in values.items():
        if len(name) > 100 or not (isinstance(value, (bool, int, float)) or (isinstance(value, str) and len(value) <= MAX_TEXT)):
            raise ToolError(f"The value of {name[:100]} is a number, true/false or text of up to {MAX_TEXT} characters.")
    return values


def node_values(values):
    """Settings by name ({setting name: value}) or for one node ({node id: {setting name: value}})."""
    if not isinstance(values, dict) or not values:
        raise ToolError('values is {setting name: value}, or {"<node id>": {setting name: value}} for one node.')
    nested = {key: value for key, value in values.items() if isinstance(value, dict)}
    for key, settings in nested.items():
        if not str(key).isdigit():
            raise ToolError(f"values.{str(key)[:40]}: only a node id takes an object of settings.")
        flat_values(settings)
    flat_values({key: value for key, value in values.items() if key not in nested})
    if len(values) - len(nested) + sum(len(settings) for settings in nested.values()) > MAX_VALUES:
        raise ToolError(f"values sets up to {MAX_VALUES} settings at once.")
    return values


def saved_workflow(name):
    """(file name, name) of the user's saved workflow called `name`."""
    from .recipe_store import _list_recipes, get_recipes_dir

    name = str(name or "").strip()
    if not name or not any(item["name"] == name for item in list_workflows(name, 50)["workflows"]):
        raise ToolError(f"No saved workflow called {name}; list_workflows names them.")
    filename = next((recipe["filename"] for recipe in _list_recipes(get_recipes_dir())
                     if (recipe["data"].get("name") or recipe["filename"]) == name), None)
    return filename, name


def _picture(image):
    """The value a LoadImage takes for picture `image`: in the input folder as it is, from the
    output folder with ComfyUI's "[output]" mark (it reads it from there)."""
    for folder in ("input", "output"):
        try:
            rel, _path = _resolve_folder_image(image, folder)
        except ToolError:
            continue
        return rel if folder == "input" else f"{rel} [output]"
    raise ToolError(f"{image} is in neither ComfyUI's input nor its output folder; search_images lists the pictures in the output.")


def _page(action, args, timeout=30):
    try:
        return ask_page(action, args, timeout)
    except (PageUnavailable, PageRefused) as error:
        raise ToolError(str(error))


def fill(ctx, workflow=None, **slots):
    """Opens `workflow` for the task (once) and fills `slots` in; what was set, or None when nothing was asked."""
    slots = {key: value for key, value in slots.items() if key in SLOTS and value not in (None, "")}
    if not workflow and not slots:
        return None
    if "image" in slots:
        slots["image"] = _picture(slots["image"])
    if "values" in slots:
        node_values(slots["values"])
    filename = name = None
    if workflow:
        filename, name = saved_workflow(workflow)
    task = ai_tasks.get_task(ctx.get("task")) if ctx.get("task") else None
    no_tab_yet = bool(task) and ai_task_canvas.mode_of(task) == "new" and not (task.get("canvas") or {}).get("tab")
    filled = None if workflow and no_tab_yet else _page("fill_slots", {"filename": filename, **slots})
    if workflow and (filled is None or filled.get("needs_open")):
        _page("open_workflow", {"filename": filename, "name": name}, timeout=60)
        filled = _page("fill_slots", {"filename": filename, **slots})
        if filled.get("needs_open"):
            raise ToolError(f"The saved workflow {name} did not open; nothing was run.")
    return {**({"workflow": name} if name else {}), **(filled.get("set") or {})}
