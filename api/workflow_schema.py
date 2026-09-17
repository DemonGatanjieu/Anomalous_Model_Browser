"""Pure Workflow Recipe graph validation and fingerprinting."""

import hashlib
import json
import re

from .recipe_constants import *

def _normalise_workflow_key(value):
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")


def _volatile_widget_indexes(node):
    """Known serialized LiteGraph widget positions for native sampler seeds."""
    node_type = _node_type(node).lower()
    if node_type == "ksampler":
        return (0,)
    if node_type == "ksampleradvanced":
        return (1,)
    return ()


def _clean_volatile_params(value):
    """Produce a stable graph view while retaining all generation-defining data."""
    if isinstance(value, list):
        return [_clean_volatile_params(item) for item in value]
    if not isinstance(value, dict):
        return value

    cleaned = {}
    for key, nested_value in value.items():
        if _normalise_workflow_key(key) in VOLATILE_WORKFLOW_KEYS:
            continue
        cleaned[str(key)] = _clean_volatile_params(nested_value)

    widgets = cleaned.get("widgets_values")
    if isinstance(widgets, list):
        for index in _volatile_widget_indexes(value):
            if 0 <= index < len(widgets):
                widgets[index] = "__anomalous_volatile_seed__"
    return cleaned


def _workflow_fingerprint(workflow):
    """Hash the workflow structure after removing known run-volatile values."""
    canonical = json.dumps(
        _clean_volatile_params(workflow),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return {
        "algorithm": "sha256-structural-v1",
        "value": hashlib.sha256(canonical).hexdigest(),
    }


def _parameter_signature(workflow):
    """Hash node types and parameter values for UI workflows or API prompts."""
    if not isinstance(workflow, dict):
        return {"algorithm": "sha256-params-v1", "value": ""}
    
    nodes = workflow.get("nodes")
    is_ui_workflow = isinstance(nodes, list)
    if not is_ui_workflow:
        nodes = list(workflow.values())

    cleaned_nodes = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        
        if is_ui_workflow:
            parameters = {"widgets": _clean_volatile_params(node.get("widgets_values") or [])}
            widgets = parameters["widgets"]
            if isinstance(widgets, list):
                for index in _volatile_widget_indexes(node):
                    if 0 <= index < len(widgets):
                        widgets[index] = "__anomalous_volatile_seed__"
        else:
            parameters = {"inputs": _clean_volatile_params(node.get("inputs") or {})}
                    
        cleaned_nodes.append({
            "type": _node_type(node),
            **parameters,
        })
        
    cleaned_nodes.sort(key=lambda x: (x["type"], json.dumps(x, sort_keys=True, ensure_ascii=False)))
    
    canonical = json.dumps(
        cleaned_nodes,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    
    return {
        "algorithm": "sha256-params-v1",
        "value": hashlib.sha256(canonical).hexdigest(),
    }


def _workflow_node_types(workflow):
    """Extract only node class names from either UI workflow or API prompt data."""
    if not isinstance(workflow, dict):
        return []
    nodes = workflow.get("nodes")
    if isinstance(nodes, list):
        values = nodes
    else:
        values = workflow.values()
    result = []
    for node in values:
        if not isinstance(node, dict):
            continue
        node_type = _node_type(node) or str(node.get("class_type") or "").strip()
        if node_type:
            result.append(node_type)
    return sorted(result, key=lambda value: value.casefold())


def _workflow_node_signature(workflow):
    """Stable node-composition signature used for tolerant result discovery."""
    canonical = json.dumps(
        _workflow_node_types(workflow),
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return {
        "algorithm": "sha256-node-types-v1",
        "value": hashlib.sha256(canonical).hexdigest(),
    }


def _node_type(node):
    return str(node.get("type") or node.get("class_type") or "").strip()


def _node_title(node):
    meta = node.get("_meta") if isinstance(node.get("_meta"), dict) else {}
    return str(meta.get("title") or node.get("title") or _node_type(node) or "Unknown node").strip()


def _widget_values(node):
    values = node.get("widgets_values")
    return values if isinstance(values, list) else []


def _workflow_node_key(value):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError("Invalid workflow node id")
    value = str(value).strip()
    if not value:
        raise ValueError("Invalid workflow node id")
    return value


def _workflow_link_records(workflow):
    links = workflow.get("links", [])
    if links is None:
        return []
    if isinstance(links, list):
        return links
    if isinstance(links, dict):
        return list(links.values())
    raise ValueError("Invalid workflow links")


def _validate_workflow(workflow):
    """Reject malformed graph topology before it reaches user recipe storage."""
    if not isinstance(workflow, dict):
        raise ValueError("Invalid recipe workflow")
    nodes = workflow.get("nodes")
    if not isinstance(nodes, list) or len(nodes) > MAX_WORKFLOW_NODES:
        raise ValueError("Invalid workflow nodes")

    node_ids = set()
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError("Invalid workflow node")
        node_key = _workflow_node_key(node.get("id"))
        if node_key in node_ids:
            raise ValueError("Duplicate workflow node id")
        node_ids.add(node_key)
        values = node.get("widgets_values")
        if values is not None and (not isinstance(values, list) or len(values) > MAX_WIDGET_VALUES_PER_NODE):
            raise ValueError("Invalid workflow widget values")

    groups = workflow.get("groups", [])
    if groups is not None and (not isinstance(groups, list) or len(groups) > MAX_WORKFLOW_GROUPS):
        raise ValueError("Invalid workflow groups")

    links = _workflow_link_records(workflow)
    if len(links) > MAX_WORKFLOW_LINKS:
        raise ValueError("Too many workflow links")
    for link in links:
        if isinstance(link, list) and len(link) >= 5:
            origin_id, target_id = link[1], link[3]
        elif isinstance(link, dict):
            origin_id, target_id = link.get("origin_id"), link.get("target_id")
        else:
            raise ValueError("Invalid workflow link")
        if _workflow_node_key(origin_id) not in node_ids or _workflow_node_key(target_id) not in node_ids:
            raise ValueError("Dangling workflow link")


def _recipe_receipt(recipe, filename):
    """Return a small, user-visible confirmation for the accepted graph."""
    workflow = recipe.get("workflow") if isinstance(recipe, dict) else {}
    params = recipe.get("params") if isinstance(recipe, dict) else {}
    return {
        "filename": filename,
        "node_count": len(workflow.get("nodes", [])) if isinstance(workflow, dict) else 0,
        "link_count": len(_workflow_link_records(workflow)) if isinstance(workflow, dict) else 0,
        "group_count": len(workflow.get("groups", [])) if isinstance(workflow.get("groups", []), list) else 0,
        "parameter_node_count": len(params.get("nodes", [])) if isinstance(params, dict) and isinstance(params.get("nodes", []), list) else 0,
        "pinned_count": len(params.get("pinned", [])) if isinstance(params, dict) and isinstance(params.get("pinned", []), list) else 0,
        "workflow_fingerprint": recipe.get("workflow_fingerprint") if isinstance(recipe, dict) else None,
    }
