"""The AI workbench's routes over ai_tasks.py (the record) and ai_panels.py (panels, answers,
messages): the list and one task (reads, open like the other pages), and the writes the page
makes - start a task, rename or remove one, answer a panel, write to the AI, answer a gate and
set the gates' policies (ai_gates.py), stop a run (ai_run_control.py), hand the AI pictures
(ai_pictures.py) - (local_guard.py keeps the writes to this computer)."""

import asyncio

from aiohttp import web

from . import activity_log, ai_decisions, ai_gates, ai_marks, ai_pictures, ai_run_control, ai_task_canvas, ai_task_changes, ai_task_links, ai_tasks, ai_toolbox


async def api_list(request):
    try:
        limit = max(1, min(300, int(request.query.get("limit", 100))))
    except ValueError:
        limit = 100
    return web.json_response({"tasks": ai_tasks.list_tasks(limit)})


async def api_start(request):
    """POST /anomalous/ai_tasks: {title, about?, from?} - the user starts a task for the next AI app that
    calls; `about` names what it is about ([{type: model | image | combo, model_id | image | name}]),
    `from` the task it goes on from."""
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        body = {}
    body = body if isinstance(body, dict) else {}
    title = body.get("title") if isinstance(body.get("title"), str) else ""
    parent = body.get("from") if isinstance(body.get("from"), str) else None
    return web.json_response({"task": ai_tasks.task_summary(ai_tasks.start_task(title, about=body.get("about"), from_task=parent))})


async def api_get(request):
    task = ai_tasks.get_task(request.match_info["task_id"])
    if task:
        task["canvas_mode"] = ai_task_canvas.mode_of(task)  # the task's own choice, else the user's default
        task["decisions"], task["decisions_gap"] = ai_decisions.decisions(task), ai_decisions.gap(task)
        task["links"] = ai_task_links.links(task["id"])  # the task it goes on from, those going on from it
        ai_pictures.mark_gone(task)  # pictures deleted since: the page says so
    return web.json_response({"task": task}) if task else web.json_response({"error": "not_found"}, status=404)


async def api_change(request):
    """POST /anomalous/ai_tasks/{id}: {"title": "…"} renames it, {"remove": true} takes it off the list,
    {"canvas": "new" | "current"} sets whether the AI works in a tab of the task's own, {"from": id | null}
    links it to the task it goes on from (or takes the link off)."""
    task_id = request.match_info["task_id"]
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        body = None
    if not isinstance(body, dict):
        return web.json_response({"error": "Expected {title} or {remove: true}"}, status=400)
    if body.get("remove") is True:
        return web.json_response({"removed": ai_tasks.remove_task(task_id)})
    if "canvas" in body:
        try:
            return web.json_response({"canvas": ai_task_canvas.set_mode(task_id, body["canvas"])})
        except ValueError as error:
            return web.json_response({"error": str(error)}, status=400)
    if "from" in body:
        try:
            return web.json_response({"from": ai_task_links.set_from(task_id, body["from"] if isinstance(body["from"], str) else None)})
        except ai_task_links.LinkError as error:
            return web.json_response({"error": str(error)}, status=400)
    if "title" in body:
        task = ai_tasks.rename_task(task_id, body["title"])
        return web.json_response({"task": ai_tasks.task_summary(task)}) if task else web.json_response({"error": "not_found"}, status=404)
    return web.json_response({"error": "Expected {title} or {remove: true}"}, status=400)


async def api_answer(request):
    """POST /anomalous/ai_tasks/{id}/answer: {step, block, choice: [ids] | text | skip: true} - the user's answer on a panel."""
    from . import ai_panels

    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        body = None
    if not isinstance(body, dict):
        return web.json_response({"error": "Expected {step, block, choice | text}"}, status=400)
    try:
        answers = ai_panels.answer(request.match_info["task_id"], str(body.get("step")), str(body.get("block")),
                                   body.get("choice"), body.get("text"), skip=body.get("skip") is True)
    except ai_panels.PanelError as error:
        return web.json_response({"error": str(error)}, status=400)
    return web.json_response({"answers": answers})


async def api_message(request):
    """POST /anomalous/ai_tasks/{id}/message: {text, refs?} - the user writes to the AI on that task (refs: its "@")."""
    from . import ai_panels

    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        body = None
    if not isinstance(body, dict):
        return web.json_response({"error": "Expected {text}"}, status=400)
    try:
        step = ai_panels.leave_message(request.match_info["task_id"], body.get("text"), body.get("refs"))
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
    """GET /anomalous/ai_gates: {policies: {gate: policy}, canvas_tab}; POST {gate, policy} changes one,
    POST {canvas_tab: new | current} whether new tasks work in a tab of their own (ai_task_canvas.py)."""
    if request.method == "GET":
        return web.json_response({"policies": ai_gates.policies(), "canvas_tab": ai_task_canvas.default_mode()})
    body = await _body(request)
    try:
        if "canvas_tab" in (body or {}):
            ai_task_canvas.set_default(body["canvas_tab"])
        else:
            ai_gates.set_policy((body or {}).get("gate"), (body or {}).get("policy"))
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)
    return web.json_response({"policies": ai_gates.policies(), "canvas_tab": ai_task_canvas.default_mode()})


async def api_marks(request):
    """POST /anomalous/ai_tasks/{id}/marks: {image, png, marks, text} - the user's marks on a picture for the AI."""
    from . import ai_panels

    body = await _body(request)
    if body is None:
        return web.json_response({"error": "Expected {image, png, marks}"}, status=400)
    try:
        step = await asyncio.to_thread(ai_marks.save, request.match_info["task_id"], body.get("image"),
                                       body.get("png"), body.get("marks"), body.get("text"), None, body.get("mask"))
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


async def api_toolbox_pick(request):
    """POST /anomalous/ai_tasks/{id}/toolbox: {mode, nodes, combos, workflows, prompts, models} - what the user hands the AI."""
    from . import ai_panels

    body = await _body(request)
    try:
        step = ai_toolbox.pick(request.match_info["task_id"], body if body is not None else None, (body or {}).get("mode", "prefer"))
    except ai_toolbox.ToolboxError as error:
        return web.json_response({"error": str(error)}, status=400)
    ai_panels.wake()
    return web.json_response({"step": step})


async def api_pictures(request):
    """POST /anomalous/ai_tasks/{id}/pictures: {images: ["subfolder/name.png"], text?} - the user hands the AI pictures."""
    from . import ai_panels, ai_pictures

    body = await _body(request)
    try:
        step = await asyncio.to_thread(ai_pictures.hand, request.match_info["task_id"], (body or {}).get("images"), (body or {}).get("text") or "")
    except ai_pictures.PicturesError as error:
        return web.json_response({"error": str(error)}, status=400)
    ai_panels.wake()
    return web.json_response({"step": step})


async def api_stop(request):
    """POST /anomalous/ai_tasks/{id}/runs/{step}/stop - the user stops a run the AI started."""
    from . import ai_panels

    try:
        answer = await asyncio.to_thread(ai_run_control.stop, request.match_info["step_id"], "user", request.match_info["task_id"])
    except ai_run_control.RunControlError as error:
        return web.json_response({"error": str(error)}, status=400)
    ai_panels.wake()
    return web.json_response(answer)


async def api_toolbox(request):
    """GET /anomalous/ai_toolbox?kind=all: what the picker lists; GET/POST /anomalous/ai_toolbox/favorites."""
    if request.path.endswith("/favorites"):
        if request.method == "GET":
            return web.json_response({"favorites": ai_toolbox.favorites()})
        body = await _body(request)
        try:
            return web.json_response({"favorites": ai_toolbox.set_favorites(body if body is not None else None)})
        except ai_toolbox.ToolboxError as error:
            return web.json_response({"error": str(error)}, status=400)
    try:
        return web.json_response(await asyncio.to_thread(ai_toolbox.catalog, request.query.get("kind", "")))
    except ai_toolbox.ToolboxError as error:
        return web.json_response({"error": str(error)}, status=400)
    except Exception as error:  # noqa: BLE001 - ComfyUI's node list or a store unreadable: say so to the page
        return web.json_response({"error": str(error)}, status=502)


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
    app.router.add_post("/anomalous/ai_tasks/{task_id}/toolbox", api_toolbox_pick)
    app.router.add_post("/anomalous/ai_tasks/{task_id}/runs/{step_id}/stop", api_stop)
    app.router.add_post("/anomalous/ai_tasks/{task_id}/pictures", api_pictures)
    app.router.add_get("/anomalous/ai_toolbox", api_toolbox)
    app.router.add_get("/anomalous/ai_toolbox/favorites", api_toolbox)
    app.router.add_post("/anomalous/ai_toolbox/favorites", api_toolbox)
    app.router.add_get("/anomalous/ai_gates", api_gates)
    app.router.add_post("/anomalous/ai_gates", api_gates)
