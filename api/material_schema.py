"""Validation and record-shaping helpers for curated materials."""

import copy
import hashlib
import json
import os
import re

from .notebooks import MAX_NOTEBOOK_BYTES
from .recipe_schema import _build_model_references
from .workflow_schema import _parameter_signature, _volatile_widget_indexes, _workflow_fingerprint


MAX_MATERIAL_NAME_LENGTH = 120
MODEL_PRIORITY = {"checkpoint": 0, "unet": 1, "lora": 2}
_PROMPT_NODE_TYPES = {"cliptextencode"}
_PROMPT_CONSUMERS = {
    "ksampler": {"positive": "positive", "negative": "negative"},
    "ksampleradvanced": {"positive": "positive", "negative": "negative"},
    "cfgguider": {"positive": "positive", "negative": "negative"},
    "basicguider": {"conditioning": "positive"},
    "dualcfgguider": {"cond1": "positive", "cond2": "positive", "negative": "negative"},
}
_PROMPT_PASSTHROUGH = {
    "conditioningaverage", "conditioningcombine", "conditioningconcat",
    "conditioningmultiply", "conditioningsetarea", "conditioningsetareapercentage",
    "conditioningsetareastrength", "conditioningsetmask", "conditioningsettimesteprange",
    "conditioningzeroout",
}
_PROMPT_ROLES = {"positive", "negative", "both", "ignored", "unknown"}
_MAX_PROMPT_UPSTREAM = 96


def _node_blocks(workflow, include_values=True, selected_ids=None):
    blocks = []
    occurrences = {}
    for node in workflow.get("nodes", []):
        if not isinstance(node, dict):
            continue
        node_type = str(node.get("type") or "").strip()
        if not node_type:
            continue
        occurrences[node_type] = occurrences.get(node_type, 0) + 1
        if selected_ids is not None and str(node.get("id")) not in selected_ids:
            continue
        block = {
            "node_id": node.get("id"),
            "type": node_type,
            "title": str(node.get("title") or node_type),
            "occurrence": occurrences[node_type],
            "widget_count": len(node.get("widgets_values") or []),
            "volatile_widget_indexes": list(_volatile_widget_indexes(node)),
        }
        if include_values:
            block["widgets_values"] = copy.deepcopy(node.get("widgets_values") or [])
            block["properties"] = copy.deepcopy(node.get("properties") or {})
            if node.get("mode") is not None:
                block["mode"] = node.get("mode")
        blocks.append(block)
    return blocks


def _normalise_selected_node_ids(workflow, raw_node_ids):
    """Validate an optional node selection while preserving workflow ID types."""
    if raw_node_ids is None:
        return None
    if not isinstance(raw_node_ids, list) or not raw_node_ids:
        raise ValueError("Selected material nodes are required")

    workflow_nodes = [node for node in workflow.get("nodes", []) if isinstance(node, dict)]
    existing = {str(node.get("id")): node.get("id") for node in workflow_nodes if node.get("id") is not None}
    selected = []
    seen = set()
    for raw_node_id in raw_node_ids:
        key = str(raw_node_id)
        if key not in existing:
            raise ValueError("Selected material node does not exist")
        if key in seen:
            continue
        seen.add(key)
        selected.append(existing[key])
    if not selected:
        raise ValueError("Selected material nodes are required")
    return selected


def _material_node_ids(material):
    selection = material.get("selection") if isinstance(material, dict) else None
    if not isinstance(selection, dict) or selection.get("scope") != "nodes":
        return None
    node_ids = selection.get("node_ids")
    if not isinstance(node_ids, list):
        return None
    return {str(node_id) for node_id in node_ids}


def _material_node_blocks(material, include_values=True):
    if material.get("kind") in ("prompt_note_bundle", "prompt_text", "prompt_plan"):
        return []
    return _node_blocks(material.get("workflow") or {}, include_values=include_values,
                        selected_ids=_material_node_ids(material))


def _prompt_excerpt(workflow):
    for node in workflow.get("nodes", []):
        if not isinstance(node, dict) or "cliptextencode" not in str(node.get("type") or "").lower():
            continue
        for value in node.get("widgets_values") or []:
            if isinstance(value, str) and value.strip():
                compact = re.sub(r"\s+", " ", value).strip()
                return compact[:20]
    return ""


def _extract_workflow_params(workflow):
    params = {}
    prompts = []
    if not isinstance(workflow, dict):
        return params, prompts

    for node in workflow.get("nodes", []):
        if not isinstance(node, dict):
            continue
        ntype = str(node.get("type") or "").strip()
        ntype_lower = ntype.lower()
        widgets = node.get("widgets_values") or []

        if ntype_lower in ("ksampler", "ksampleradvanced") and isinstance(widgets, (list, tuple)):
            is_adv = ntype_lower == "ksampleradvanced"
            offset = 1 if is_adv else 0
            if len(widgets) > offset and widgets[offset] is not None:
                params.setdefault("seed", widgets[offset])
            if len(widgets) > 2 + offset and widgets[2 + offset] is not None:
                params.setdefault("steps", widgets[2 + offset])
            if len(widgets) > 3 + offset and widgets[3 + offset] is not None:
                params.setdefault("cfg", widgets[3 + offset])
            if len(widgets) > 4 + offset and widgets[4 + offset] is not None:
                params.setdefault("sampler_name", widgets[4 + offset])
            if len(widgets) > 5 + offset and widgets[5 + offset] is not None:
                params.setdefault("scheduler", widgets[5 + offset])
            if len(widgets) > 6 + offset and widgets[6 + offset] is not None:
                params.setdefault("denoise", widgets[6 + offset])
        elif ntype_lower == "emptylatentimage" and isinstance(widgets, (list, tuple)):
            if len(widgets) >= 2 and widgets[0] and widgets[1]:
                params.setdefault("resolution", f"{widgets[0]}×{widgets[1]}")

        if "cliptextencode" in ntype_lower and isinstance(widgets, (list, tuple)):
            for val in widgets:
                if isinstance(val, str) and val.strip():
                    cleaned = val.strip()
                    if cleaned not in prompts:
                        prompts.append(cleaned)

    return params, prompts


def _norm_node_name(value):
    return str(value or "").strip().lower()


def _is_prompt_node_type(node_type):
    name = _norm_node_name(node_type)
    return name in _PROMPT_NODE_TYPES or "cliptextencode" in name


def _first_prompt_text(node):
    for value in node.get("widgets_values") or []:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _title_prompt_role(node):
    title = str(node.get("title") or "").lower()
    if "neg" in title or "负向" in title or "反向" in title:
        return "negative"
    if "pos" in title or "正向" in title:
        return "positive"
    return None


def _workflow_link_origin(workflow, link_id):
    if link_id is None:
        return None
    links = workflow.get("links")
    if isinstance(links, list):
        for link in links:
            if isinstance(link, (list, tuple)) and len(link) > 1 and link[0] == link_id:
                return link[1]
            if isinstance(link, dict) and link.get("id") == link_id:
                return link.get("origin_id")
    elif isinstance(links, dict):
        link = links.get(link_id)
        if link is None:
            link = links.get(str(link_id))
        if isinstance(link, dict):
            return link.get("origin_id")
        if isinstance(link, (list, tuple)) and len(link) > 1:
            return link[1]
    return None


def _collect_prompt_nodes(workflow, nodes_by_id, start_id):
    queue = [start_id]
    visited = set()
    found = []
    while queue and len(visited) < _MAX_PROMPT_UPSTREAM:
        node_id = queue.pop(0)
        if node_id is None or node_id in visited:
            continue
        visited.add(node_id)
        node = nodes_by_id.get(str(node_id))
        if not isinstance(node, dict):
            continue
        if _is_prompt_node_type(node.get("type")):
            if node not in found:
                found.append(node)
            continue
        if _norm_node_name(node.get("type")) not in _PROMPT_PASSTHROUGH:
            continue
        for inbound in node.get("inputs") or []:
            if not isinstance(inbound, dict):
                continue
            input_type = _norm_node_name(inbound.get("type"))
            input_name = _norm_node_name(inbound.get("name"))
            if input_type != "conditioning" and "conditioning" not in input_name:
                continue
            origin_id = _workflow_link_origin(workflow, inbound.get("link"))
            if origin_id is not None and origin_id not in visited:
                queue.append(origin_id)
    return found


def _normalise_prompt_role_overrides(raw):
    if not isinstance(raw, dict):
        return {}
    result = {}
    for key, value in list(raw.items())[:80]:
        if not isinstance(value, dict):
            continue
        role = value.get("role")
        if role not in _PROMPT_ROLES:
            continue
        node_type = value.get("nodeType")
        if node_type is not None and (not isinstance(node_type, str) or len(node_type) > 200):
            continue
        result[str(key)] = {
            "role": role,
            "nodeType": node_type if isinstance(node_type, str) else None,
            "source": "manual",
        }
    return result


def _override_prompt_role(node, overrides):
    if not isinstance(overrides, dict) or not isinstance(node, dict):
        return None
    entry = overrides.get(str(node.get("id")))
    if not isinstance(entry, dict) or entry.get("role") not in _PROMPT_ROLES:
        return None
    expected = entry.get("nodeType")
    if expected and expected != node.get("type"):
        return None
    return entry["role"]


def _prompt_roles_for_workflow(workflow, overrides=None):
    roles = {}
    if not isinstance(workflow, dict):
        return roles
    nodes = [node for node in workflow.get("nodes") or [] if isinstance(node, dict)]
    nodes_by_id = {str(node.get("id")): node for node in nodes if node.get("id") is not None}
    positive_ids = set()
    negative_ids = set()
    for node in nodes:
        mapping = _PROMPT_CONSUMERS.get(_norm_node_name(node.get("type")))
        if not mapping:
            continue
        for input_name, role in mapping.items():
            for inbound in node.get("inputs") or []:
                if not isinstance(inbound, dict) or _norm_node_name(inbound.get("name")) != input_name:
                    continue
                origin_id = _workflow_link_origin(workflow, inbound.get("link"))
                for prompt_node in _collect_prompt_nodes(workflow, nodes_by_id, origin_id):
                    node_id = str(prompt_node.get("id"))
                    if role == "negative":
                        negative_ids.add(node_id)
                    else:
                        positive_ids.add(node_id)
    for node in nodes:
        if not _is_prompt_node_type(node.get("type")):
            continue
        node_id = str(node.get("id"))
        in_positive = node_id in positive_ids
        in_negative = node_id in negative_ids
        if in_positive and in_negative:
            automatic_role, automatic_source = "both", "topology"
        elif in_positive:
            automatic_role, automatic_source = "positive", "topology"
        elif in_negative:
            automatic_role, automatic_source = "negative", "topology"
        else:
            titled = _title_prompt_role(node)
            automatic_role = titled or "unknown"
            automatic_source = "title" if titled else "unresolved"
        override = _override_prompt_role(node, overrides)
        roles[node_id] = {
            "role": override or automatic_role,
            "source": "manual" if override else automatic_source,
            "automatic_role": automatic_role,
        }
    return roles


def _prompt_groups_from_roles(workflow, roles, selected_ids=None):
    positive = []
    negative = []
    if not isinstance(workflow, dict) or not isinstance(roles, dict):
        return {"positive": positive, "negative": negative}
    for node in workflow.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id"))
        if selected_ids is not None and node_id not in selected_ids:
            continue
        info = roles.get(node_id)
        if not isinstance(info, dict):
            continue
        text = _first_prompt_text(node)
        if not text:
            continue
        role = info.get("role")
        if role in ("positive", "both") and text not in positive:
            positive.append(text)
        if role in ("negative", "both") and text not in negative:
            negative.append(text)
    return {"positive": positive, "negative": negative}


def _display_model_name(reference):
    value = str(reference.get("saved_value") or "").replace("\\", "/").split("/")[-1]
    return re.sub(r"\.(?:safetensors|ckpt|pt|bin|sft)$", "", value, flags=re.IGNORECASE)


def _suggested_name(workflow, source_path, references=None):
    stem = os.path.splitext(os.path.basename(source_path))[0] if source_path else ""
    if stem:
        return f"{stem} · 快照"[:MAX_MATERIAL_NAME_LENGTH]
    if references is None:
        references = _build_model_references({"workflow": workflow, "params": {}}, verify_identities=False)
    references.sort(key=lambda item: MODEL_PRIORITY.get(item.get("category"), 99))
    model_name = _display_model_name(references[0]) if references else "工作流快照"
    return f"{model_name} · 快照"[:MAX_MATERIAL_NAME_LENGTH]


def _recipe_link_fingerprint(recipe):
    if not isinstance(recipe, dict):
        return ""
    fingerprint = recipe.get("workflow_fingerprint")
    workflow_hash = fingerprint.get("value") if isinstance(fingerprint, dict) else ""
    if not workflow_hash and isinstance(recipe.get("workflow"), dict):
        workflow_hash = (_workflow_fingerprint(recipe["workflow"]) or {}).get("value") or ""
    params = recipe.get("params") if isinstance(recipe.get("params"), dict) else {}
    overrides = params.get("promptRoleOverrides") if isinstance(params.get("promptRoleOverrides"), dict) else {}
    payload = json.dumps(
        {"workflow": workflow_hash, "promptRoleOverrides": overrides},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _material_summary(filename, material):
    image = material.get("image") or {}
    source = material.get("source") if isinstance(material.get("source"), dict) else {}
    blocks = _material_node_blocks(material, include_values=False)
    summary = {
        "filename": filename,
        "id": material.get("id"),
        "name": material.get("name") or "未命名素材",
        "kind": material.get("kind"),
        "tags": _normalise_material_tags(material.get("tags") or []),
        "source_sha256": image.get("source_sha256", ""),
        "timestamp": material.get("timestamp", 0),
        "node_count": len(blocks),
        "node_types": sorted({block["type"] for block in blocks}),
        "selection": copy.deepcopy(material.get("selection")),
        "image": {
            "preview_asset_id": image.get("preview_asset_id"),
            "source_asset_id": image.get("source_asset_id"),
            "width": image.get("preview_width"),
            "height": image.get("preview_height"),
        },
        "capabilities": list(material.get("capabilities") or []),
        "source": {
            "type": source.get("type"),
            "label": str(source.get("parameter_name") or source.get("recipe_name") or source.get("notebook_name") or "").strip(),
        },
        "source_fingerprint": str(source.get("parameter_signature") or image.get("source_sha256") or ""),
    }
    if source.get("recipe_filename"):
        summary["source_recipe"] = {
            "filename": source.get("recipe_filename"),
            "name": str(source.get("recipe_name") or "").strip(),
            "fingerprint": str(source.get("recipe_fingerprint") or ""),
        }
    return summary


def _workflow_hashes_for_blocks(workflow, blocks):
    hashes = (workflow.get("extra") or {}).get("anomalous_hashes") if isinstance(workflow, dict) else None
    if not isinstance(hashes, dict):
        return {}
    prefixes = tuple(f"{block.get('node_id')}_" for block in blocks)
    return {
        key: copy.deepcopy(value)
        for key, value in hashes.items()
        if isinstance(key, str) and key.startswith(prefixes)
    }


def _normalise_material_tags(tags):
    if not isinstance(tags, list) or len(tags) > 20:
        raise ValueError("Invalid material tags")
    result = []
    seen = set()
    for tag in tags:
        if not isinstance(tag, str) or not tag.strip() or len(tag.strip()) > 60:
            raise ValueError("Invalid material tag")
        tag = tag.strip()
        if tag.casefold() not in seen:
            result.append(tag)
            seen.add(tag.casefold())
    return result


def _normalise_prompt_note(data, prompt_only=False):
    if not isinstance(data, dict):
        raise ValueError("Invalid prompt note")
    if len(json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")) > MAX_NOTEBOOK_BYTES:
        raise ValueError("Prompt note is too large")
    result = {}
    for key in ("promptEn", "promptZh", "targetLang"):
        value = data.get(key, "")
        if not isinstance(value, str):
            raise ValueError("Invalid prompt text")
        result[key] = value
    translations = data.get("translations", {})
    if not isinstance(translations, dict) or any(not isinstance(value, str) for value in translations.values()):
        raise ValueError("Invalid prompt translations")
    result["translations"] = copy.deepcopy(translations)
    if not prompt_only:
        base = data.get("baseModel", "")
        main = data.get("mainModel")
        loras = data.get("loras", [])
        if not isinstance(base, str) or (main is not None and not isinstance(main, dict)):
            raise ValueError("Invalid prompt models")
        if not isinstance(loras, list) or len(loras) > 100 or any(not isinstance(model, dict) for model in loras):
            raise ValueError("Invalid prompt LoRAs")
        for model in ([main] if main is not None else []) + loras:
            if not isinstance(model.get("filename"), str) or not model["filename"]:
                raise ValueError("Invalid prompt model filename")
        result.update(baseModel=base, mainModel=copy.deepcopy(main), loras=copy.deepcopy(loras))
    return result


def _normalise_prompt_plan(plan):
    if not isinstance(plan, dict) or len(json.dumps(plan, ensure_ascii=False, allow_nan=False).encode("utf-8")) > MAX_NOTEBOOK_BYTES:
        raise ValueError("Invalid prompt plan")
    parts = plan.get("parts", [])
    if not isinstance(parts, list) or len(parts) > 100:
        raise ValueError("Invalid prompt parts")
    result = {"parts": []}
    if "version" in plan and isinstance(plan["version"], int):
        result["version"] = plan["version"]
    for key in ("positive", "negative"):
        if not isinstance(plan.get(key, ""), str):
            raise ValueError("Invalid prompt text")
        result[key] = plan.get(key, "")
    for part in parts:
        if not isinstance(part, dict) or part.get("category") not in ("general", "specific", "base", "style", "subject", "trigger") or not isinstance(part.get("enabled", True), bool):
            raise ValueError("Invalid prompt part")
        item = {"category": part["category"], "enabled": part.get("enabled", True)}
        if "role" in part and part["role"] in ("positive", "negative"):
            item["role"] = part["role"]
        if "id" in part and isinstance(part["id"], str) and len(part["id"]) <= 120:
            item["id"] = part["id"]
        for key in ("name", "positive", "negative"):
            if not isinstance(part.get(key, ""), str):
                raise ValueError("Invalid prompt part text")
            item[key] = part.get(key, "")
        if len(item["name"]) > 120:
            raise ValueError("Prompt part name is too long")
        result["parts"].append(item)
    return result


def _material_category(material):
    if material.get("kind") == "image_workflow_snapshot":
        return "workflow"
    if material.get("kind") in ("prompt_text", "prompt_note_bundle", "prompt_plan"):
        return "prompts"
    types = material.get("node_types", [])
    if types and all(_is_prompt_node_type(value) for value in types):
        return "prompts"
    return "params"
