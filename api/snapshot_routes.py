"""POST /anomalous/snapshot_check: ComfyUI's own check of one mark of the snapshot queue
(web/modules/ui_snapshot_bar.js), before anything of the queue is submitted: broken links, a model
no longer there, a value a node does not take. {prompt} in API form; {problems: [lines]}."""

import uuid

from aiohttp import web

MAX_LINES = 12


def _lines(error, node_errors):
    lines = []
    for node in (node_errors or {}).values():
        for item in node.get("errors") or []:
            details = str(item.get("details") or "").split(" not in ")[0]  # not the list of every model there is
            lines.append(f"{node.get('class_type') or ''}: {item.get('message') or ''} {details}".strip()[:300])
    if not lines and error:
        lines.append(str(error.get("message") if isinstance(error, dict) else error)[:300])
    return lines[:MAX_LINES]


async def api_snapshot_check(request):
    import execution  # ComfyUI's, loaded with the server

    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict) or not isinstance(body.get("prompt"), dict):
        return web.json_response({"error": "Expected {prompt}"}, status=400)
    valid = await execution.validate_prompt(uuid.uuid4().hex, body["prompt"], None)
    return web.json_response({"problems": [] if valid[0] else _lines(valid[1], valid[3])})
