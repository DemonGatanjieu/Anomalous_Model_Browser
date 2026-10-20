"""The AI workbench's routes over ai_tasks.py (the record) and ai_panels.py (panels, answers,
messages): the list and one task (reads, open like the other pages), and the writes the page
makes - start a task, rename or remove one, answer a panel, write to the AI (local_guard.py keeps
the writes to this computer)."""

from aiohttp import web

from . import ai_tasks


async def api_list(request):
    try:
        limit = max(1, min(300, int(request.query.get("limit", 100))))
    except ValueError:
        limit = 100
    return web.json_response({"tasks": ai_tasks.list_tasks(limit)})


async def api_start(request):
    """POST /anomalous/ai_tasks: {title} - the user starts a task for the next AI app that calls."""
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        body = {}
    title = body.get("title") if isinstance(body, dict) else ""
    return web.json_response({"task": ai_tasks.task_summary(ai_tasks.start_task(title if isinstance(title, str) else ""))})


async def api_get(request):
    task = ai_tasks.get_task(request.match_info["task_id"])
    return web.json_response({"task": task}) if task else web.json_response({"error": "not_found"}, status=404)


async def api_change(request):
    """POST /anomalous/ai_tasks/{id}: {"title": "…"} renames it, {"remove": true} takes it off the list."""
    task_id = request.match_info["task_id"]
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        body = None
    if not isinstance(body, dict):
        return web.json_response({"error": "Expected {title} or {remove: true}"}, status=400)
    if body.get("remove") is True:
        return web.json_response({"removed": ai_tasks.remove_task(task_id)})
    if "title" in body:
        task = ai_tasks.rename_task(task_id, body["title"])
        return web.json_response({"task": ai_tasks.task_summary(task)}) if task else web.json_response({"error": "not_found"}, status=404)
    return web.json_response({"error": "Expected {title} or {remove: true}"}, status=400)


async def api_answer(request):
    """POST /anomalous/ai_tasks/{id}/answer: {step, block, choice: [ids] | text} - the user's answer on a panel."""
    from . import ai_panels

    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        body = None
    if not isinstance(body, dict):
        return web.json_response({"error": "Expected {step, block, choice | text}"}, status=400)
    try:
        answers = ai_panels.answer(request.match_info["task_id"], str(body.get("step")), str(body.get("block")),
                                   body.get("choice"), body.get("text"))
    except ai_panels.PanelError as error:
        return web.json_response({"error": str(error)}, status=400)
    return web.json_response({"answers": answers})


async def api_message(request):
    """POST /anomalous/ai_tasks/{id}/message: {text} - the user writes to the AI on that task."""
    from . import ai_panels

    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        body = None
    if not isinstance(body, dict):
        return web.json_response({"error": "Expected {text}"}, status=400)
    try:
        step = ai_panels.leave_message(request.match_info["task_id"], body.get("text"))
    except ai_panels.PanelError as error:
        return web.json_response({"error": str(error)}, status=400)
    return web.json_response({"step": step})


def register_routes(app):
    app.router.add_get("/anomalous/ai_tasks", api_list)
    app.router.add_post("/anomalous/ai_tasks", api_start)
    app.router.add_get("/anomalous/ai_tasks/{task_id}", api_get)
    app.router.add_post("/anomalous/ai_tasks/{task_id}", api_change)
    app.router.add_post("/anomalous/ai_tasks/{task_id}/answer", api_answer)
    app.router.add_post("/anomalous/ai_tasks/{task_id}/message", api_message)
