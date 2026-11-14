"""What the home page's "Let the AI do it" section needs in one read (web/modules/ui_ai_starters.js):
the user's saved workflows with their presets (方案, mcp_tools.plans) for the "Run my preset" card,
whether the gates ask before a download (the card's tag shows only then), and the AI app that came
last with the tool list it holds: a short one (mcp_tool_sets.py) cannot take a task handed over in
Anomalous, which the section says. GET /anomalous/ai_starters, a read. GET /anomalous/ai_callers tells the
Connect guide which app called last since ComfyUI started (ai_callers.latest), so it can say one has come.
"""

from aiohttp import web

from . import ai_callers, ai_gates, ai_tasks, mcp_directory, mcp_tool_sets
from .mcp_tools import plans
from .recipe_store import _list_recipes, get_recipes_dir

MAX_WORKFLOWS = 200


def workflows():
    """[{name, presets: [names]}] of the saved workflows, by name."""
    saved = plans()
    found = [{"name": (recipe.get("data") or {}).get("name") or recipe["filename"],
              "presets": [name for _file, name in saved.get(recipe["filename"], [])]}
             for recipe in _list_recipes(get_recipes_dir())]
    return sorted(found, key=lambda item: item["name"].lower())[:MAX_WORKFLOWS]


def last_app(listing):
    """{client, when, tools: all | core | mine | other | unknown} of the app that worked on a task last, or None.
    `listing(names)` gives the tool list a set offers, to tell which one the app fetched."""
    latest = next((task for task in ai_tasks.list_tasks(50) if task.get("client") and task["client"] != "AI"), None)
    if not latest:
        return None
    with ai_tasks._lock:
        fetched = mcp_directory._known().get(latest["client"])
    kind = "unknown"
    if fetched:
        sets = {"all": None, "core": mcp_tool_sets.chosen("core", _tools(listing)),
                "mine": mcp_tool_sets.chosen("mine", _tools(listing))}
        kind = next((name for name, names in sets.items()
                     if (names is not None or name == "all") and mcp_directory.fingerprint(listing(names)) == fetched), "other")
    return {"client": latest["client"], "when": latest["updated"], "tools": kind}


def _tools(listing):
    return {tool["name"]: tool for tool in listing(None)}


def register_routes(app, listing):
    async def api_starters(_request):
        return web.json_response({"workflows": workflows(), "download_asks": ai_gates.policies().get("download") == "ask",
                                  "app": last_app(listing)})

    async def api_callers(_request):
        return web.json_response({"last": ai_callers.latest()})

    app.router.add_get("/anomalous/ai_starters", api_starters)
    app.router.add_get("/anomalous/ai_callers", api_callers)
