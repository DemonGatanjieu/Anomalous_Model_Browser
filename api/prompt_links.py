"""Read static text feeding a workflow's CLIP text encoder."""

import re


_MAX_HOPS = 8
_REROUTES = {"reroute", "reroute (rgthree)", "rerouteprimitive"}
_NON_STATIC_TYPE = re.compile(
    r"wildcard|random|dynamic|concat|combine|join|merge|replace|regex|format|template|"
    r"llm|gpt|ollama|gemini|claude|openai|translate|load|file|csv|list|switch|select|"
    r"index|batch|split|tagger|wd14|florence|joycaption|clip|ksampler|lora|checkpoint|vae"
)


def _is_prompt_node_type(node_type):
    return "cliptextencode" in str(node_type or "").lower()


def _ports(node, key):
    ports = node.get(key)
    return ports if isinstance(ports, (list, tuple)) else ()


def _text_link(node):
    inputs = [port for port in _ports(node, "inputs") if isinstance(port, dict)]
    for port in inputs:
        if str(port.get("name") or "").strip().lower() == "text":
            return port.get("link")
    strings = [port for port in inputs if str(port.get("type") or "").strip().upper() == "STRING"]
    return strings[0].get("link") if len(strings) == 1 else None


def has_linked_prompt_text(node):
    return _text_link(node) is not None


def _as_text(value):
    return value.strip() if isinstance(value, str) else ""


def embedded_prompt_text(node, api_prompt):
    entry = api_prompt.get(str(node.get("id"))) if isinstance(api_prompt, dict) else None
    inputs = entry.get("inputs") if isinstance(entry, dict) else None
    return _as_text(inputs.get("text")) if isinstance(inputs, dict) else ""


def workflow_node_index(workflow):
    return {
        str(node["id"]): node for node in workflow.get("nodes") or []
        if isinstance(node, dict) and node.get("id") is not None
    }


def _link_source(links, link_id):
    if isinstance(links, (list, tuple)):
        link = next((link for link in links if (
            isinstance(link, (list, tuple)) and link and str(link[0]) == str(link_id)
            or isinstance(link, dict) and str(link.get("id")) == str(link_id)
        )), None)
    elif isinstance(links, dict):
        link = links.get(link_id, links.get(str(link_id)))
    else:
        link = None
    if isinstance(link, (list, tuple)) and len(link) >= 3:
        return link[1], link[2]
    if isinstance(link, dict):
        return link.get("origin_id"), link.get("origin_slot")
    return None, None


def _resolve_linked_text(workflow, node, link_id, nodes_by_id):
    if nodes_by_id is None:
        nodes_by_id = workflow_node_index(workflow)
    visited = {str(node.get("id"))}
    for _ in range(_MAX_HOPS):
        if type(link_id) not in (str, int):
            return ""
        origin_id, origin_slot = _link_source(workflow.get("links"), link_id)
        if origin_id is None or type(origin_slot) is not int or origin_slot < 0:
            return ""
        key = str(origin_id)
        source = nodes_by_id.get(key)
        if not source or key in visited or source.get("mode") in (2, 4):
            return ""
        visited.add(key)
        inbound = [port["link"] for port in _ports(source, "inputs")
                   if isinstance(port, dict) and port.get("link") is not None]
        source_type = str(source.get("type") or "").strip().lower()
        if source_type in _REROUTES:
            if len(inbound) != 1:
                return ""
            link_id = inbound[0]
            continue
        if not source_type or inbound or _NON_STATIC_TYPE.search(source_type):
            return ""
        outputs = _ports(source, "outputs")
        output = outputs[origin_slot] if origin_slot < len(outputs) else None
        output_type = output.get("type") if isinstance(output, dict) else None
        if output_type is not None and str(output_type).strip().upper() not in ("STRING", "*"):
            return ""
        widgets = source.get("widgets_values")
        return _as_text(widgets[0]) if isinstance(widgets, list) and len(widgets) == 1 else ""
    return ""


def resolve_clip_prompt_text(workflow, node, nodes_by_id=None, api_prompt=None) -> str:
    inline = embedded_prompt_text(node, api_prompt)
    if inline:
        return inline
    link_id = _text_link(node)
    if link_id is not None:
        return _resolve_linked_text(workflow, node, link_id, nodes_by_id)
    return next((text for value in _ports(node, "widgets_values") if (text := _as_text(value))), "")


def resolved_prompt_texts(workflow, api_prompt=None) -> dict[str, str]:
    nodes_by_id = workflow_node_index(workflow)
    return {
        node_id: text for node_id, node in nodes_by_id.items()
        if _is_prompt_node_type(node.get("type"))
        and (text := resolve_clip_prompt_text(workflow, node, nodes_by_id, api_prompt))
    }
