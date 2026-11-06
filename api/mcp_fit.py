"""Answers an AI app reads in the chat. Past about 4,000 characters Antigravity (and apps like it) keeps
a tool's answer as a file for the AI to open, and an AI told to use only Anomalous's tools never
opens it: it sees nothing and asks again with smaller limits (the 1.63 exam: search_models eight
times for one LoRA). An answer that is one list and longer than BUDGET keeps the items that fit, in
their order, and says how many it left out, by name when its items have one, and how to reach
them. Tools that fit their answers themselves (get_situation, search_models, list_workflows) are
under it already; this is the net under the rest (list_combos, recent_activity and any list to
come). Nothing is shortened inside an item: a prompt cut in half could be put in as it is.
mcp_server.py runs it after the step is recorded, so the timeline keeps the whole answer."""

from .mcp_tools import retext, tool_text

# UTF-8 bytes. Antigravity's logs show answers filed from 4,099 bytes (3,627 characters, some of them
# Chinese at three bytes each) while longer ones were shown at other times: stay under the lowest.
BUDGET = 3800
NAME = 60  # characters of a left-out item's name


def size(data):
    return len(tool_text(data).encode("utf-8"))
# A canvas cut short would read as a smaller canvas: get_situation gives every node in brief.
WHOLE = {"describe_canvas"}


def _the_list(data):
    """The key of the one list of items in `data`, or None when there is none or more than one."""
    keys = [key for key, value in data.items() if isinstance(value, list) and value and all(isinstance(item, dict) for item in value)]
    return keys[0] if len(keys) == 1 else None


def fit(result, name):
    """`result` (an MCP tools/call result) with its one list cut to BUDGET, when it is longer."""
    data = result.get("structuredContent") if isinstance(result, dict) else None
    if name in WHOLE or result.get("isError") or not isinstance(data, dict) or size(data) <= BUDGET:
        return result
    key = _the_list(data)
    if not key:
        return result
    items = list(data[key])
    kept = {**data, key: items}
    while size(kept) > BUDGET and len(items) > 1:
        items.pop()
        left = data[key][len(items):]
        named = [str(item["name"])[:NAME] for item in left if item.get("name")]
        kept["left_out"] = (f"{len(left)} more {key} left out to keep this answer readable in the chat"
                            + (" (more_names)" if named else "") + ": a narrower query, a smaller limit or the next page lists them")
        if named:
            kept["more_names"] = named  # what there is, to ask for by name
    if len(items) < len(data[key]):
        retext(result, kept)
    return result
