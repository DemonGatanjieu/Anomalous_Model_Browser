"""The AI workbench's routes over ai_tasks.py (the record) and ai_panels.py (panels, answers,
messages): the list and one task (reads, open like the other pages), and the writes the page
makes - start a task, rename or remove one, answer a panel, write to the AI, answer a gate and
set the gates' policies (ai_gates.py) - (local_guard.py keeps the writes to this computer)."""

import asyncio

from aiohttp import web

from . import activity_log, ai_gates, ai_marks, ai_task_changes, ai_tasks


async def api_list(request):
    try:
        limit = max(1, min(300, int(request.query.get("limit", 100))))
    except ValueError:
        limit = 100
    return web.json_response({"tasks": ai_tasks.list_tasks(limit)})


async def api_start(request):
    """POST /anomalous/ai_tasks: {title, about?} - the user starts a task for the next AI app that
    calls; `about` names what it is about ([{type: model | image | combo, model_id | image | name}])."""
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        body = {}
    body = body if isinstance(body, dict) else {}
    title = body.get("title") if isinstance(body.get("title"), str) else ""
    return web.json_response({"task": ai_tasks.task_summary(ai_tasks.start_task(title, about=body.get("about")))})


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


async def _body(request):
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        return None
    return body if isinstance(body, dict) else None


async def api_gate(request):
    """POST /anomalous/ai_tasks/{id}/gate: {step, decision: allow | deny, text?, remember?}."""
    body = await _body(request)
    if body is None:
        return web.json_response({"error": "Expected {step, decision}"}, status=400)
    try:
        step = ai_gates.decide(request.match_info["task_id"], str(body.get("step")), body.get("decision"),
                               body.get("text") or "", bool(body.get("remember")))
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)
    return web.json_response({"step": step})


async def api_gates(request):
    """GET /anomalous/ai_gates: {gate: policy}; POST {gate, policy} changes one."""
    if request.method == "GET":
        return web.json_response({"policies": ai_gates.policies()})
    body = await _body(request)
    try:
        policies = ai_gates.set_policy((body or {}).get("gate"), (body or {}).get("policy"))
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)
    return web.json_response({"policies": policies})


async def api_marks(request):
    """POST /anomalous/ai_tasks/{id}/marks: {image, png, marks, text} - the user's marks on a picture for the AI."""
    from . import ai_panels

    body = await _body(request)
    if body is None:
        return web.json_response({"error": "Expected {image, png, marks}"}, status=400)
    try:
        step = await asyncio.to_thread(ai_marks.save, request.match_info["task_id"], body.get("image"),
                                       body.get("png"), body.get("marks"), body.get("text"))
    except ai_marks.MarksError as error:
        return web.json_response({"error": str(error)}, status=400)
    ai_panels.wake()
    return web.json_response({"step": step})


async def api_marked(request):
    """GET /anomalous/ai_tasks/{id}/marks/{name}: a marked picture the user sent."""
    path = ai_marks.path_of(request.match_info["task_id"], request.match_info["name"])
    if not path:
        return web.json_response({"error": "Not found"}, status=404)
    return web.FileResponse(path, headers={"Cache-Control": "private, max-age=86400"})


def register_routes(app):
    activity_log.add_listener(ai_task_changes.note_activity)  # the user's changes while an AI works
    app.router.add_get("/anomalous/ai_tasks", api_list)
    app.router.add_post("/anomalous/ai_tasks", api_start)
    app.router.add_get("/anomalous/ai_tasks/{task_id}", api_get)
    app.router.add_post("/anomalous/ai_tasks/{task_id}", api_change)
    app.router.add_post("/anomalous/ai_tasks/{task_id}/answer", api_answer)
    app.router.add_post("/anomalous/ai_tasks/{task_id}/message", api_message)
    app.router.add_post("/anomalous/ai_tasks/{task_id}/gate", api_gate)
    app.router.add_post("/anomalous/ai_tasks/{task_id}/marks", api_marks)
    app.router.add_get("/anomalous/ai_tasks/{task_id}/marks/{name}", api_marked)
    app.router.add_get("/anomalous/ai_gates", api_gates)
    app.router.add_post("/anomalous/ai_gates", api_gates)
