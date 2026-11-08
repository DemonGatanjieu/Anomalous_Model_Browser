"""read_guide: Anomalous's own manual for the AI, a topic at a time, so the tool list carries the
names and the details come when they are needed. The topics are what is kept for people already,
in English or Chinese, so the two never drift apart: the README between `<!-- guide:name -->`
marks (both languages carry the same names), Model Check's rules (docs/guides/model-check-rules*.md,
its sections), and the panel blocks' fields for show_panel and update_panel. A topic longer than
one answer (mcp_fit.BUDGET) comes in parts, cut between paragraphs. Read from disk at each call:
the files are small and the AI asks rarely."""

import os
import re

from . import mcp_fit
from .mcp_tools import ToolError, _tool

PLUGIN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
README = os.path.join(PLUGIN, "README.md")
RULES = {"en": os.path.join(PLUGIN, "docs", "guides", "model-check-rules.en.md"),
         "zh": os.path.join(PLUGIN, "docs", "guides", "model-check-rules.md")}
HALVES = {"en": ('<h2 id="english">', '<h2 id="中文">'), "zh": ('<h2 id="中文">', "### 🧪")}
MARK = re.compile(r"^<!-- guide:([a-z_]+) -->$")
ENDS = ("### ", "<h2", "<details", "</details>")  # a marked part of the README ends there, or at the next mark
PART_BYTES = mcp_fit.BUDGET - 600  # room for the answer's other fields
TITLES = {  # the list's words for each topic; a README mark without one is listed by its first line
    "idea": "What Anomalous is for", "ai_workbench": "The AI workbench: how it works with you",
    "names": "Scanning: real names, covers and trigger words", "model_check": "Model Check: missing models put back",
    "workflows": "Workflow cards, their stages and presets", "saves": "Canvas saves (存档)",
    "picture_workflow": "A picture's own workflow, from the gallery", "combos": "Combos: model, LoRAs and prompt together",
    "prompts": "Prompt Studio", "voices": "Character voices (Anomalous_TTS)", "undo": "The activity log and undo",
    "light": "What it takes from the computer", "install": "Installing, and finding it after (the cube button)",
    "pages": "Every page and tool in detail", "connect_ai": "Connecting an AI app", "open": "Opening, shortcuts, updating",
    "network": "Network, cloud servers and backups", "model_check_rules": "Model Check's full rules",
    "panel": "show_panel's blocks and update_panel",
}

PANEL = """show_panel's blocks, top to bottom, each {type, ...}:
- heading {text}; text {text, tone: normal|muted|tip|warning}; divider {}.
- images {items: [{image: 'subfolder/name.png' from search_images, caption, marks: [{x, y, r | w, h, label, color: red|green|blue|yellow|purple}]}], layout: row|grid|compare}. marks are circles or boxes with a label; x/y/w/h/r are fractions 0-1 of the picture, x/y the centre; a click on the label zooms there.
- slider {before: {image}, after: {image}, before_label, after_label}: one picture over the other, a line to drag.
- picks {id, question, items: [{id, image, label, reason, recommended}] (2-12), multiple}: pictures to choose from; the user can also put one's workflow on the canvas.
- slider and picks: zoom {x, y, w, h} shows only that part, enlarged.
- diagram {nodes: [{id, label, detail, node_id, color}], edges: [{from, to, label}], direction: right|down}: boxes and arrows Anomalous lays out; node_id is a canvas node it finds.
- models {items: [{model_id from search_models, note}]}: cards with their covers, a click opens them.
- table {columns: [...], rows: [[...]]}; list {items: [...], ordered}; params {items: [{label, value}]}.
- choices {id, question, options: [{id, label, detail}] (2-8), multiple}: buttons the user presses.
- input {id, question, placeholder}: a line the user types.
- progress {label, value, max}: your own numbers, kept current with update_panel; none for a run, its progress shows already.
Each block may have a stable id; show_panel returns the block ids in display order. Plain text only (no markup, no links); up to 30 blocks, 12 pictures or models a block.

update_panel adds new output at the bottom of a panel and keeps what the user saw, in its order: send only the new blocks (repeated unchanged blocks are kept once). To correct a block or move a progress bar or question in place, send it with its returned id and the same type; blocks left out stay. Never reuse an old block id for a new result: append it, or show_panel for the next phase. Up to 30 blocks a panel; closed=true stops answers, answers given stay."""


def _read(path):
    try:
        with open(path, encoding="utf-8") as source:
            return source.read()
    except OSError:
        return ""


def _plain(lines):
    """Text people read, without the README's pictures and badges, blank runs folded."""
    kept = [line.rstrip() for line in lines if not line.lstrip().startswith(("<p align", "<br", "<img"))]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


def _title(text):
    first = next((line for line in text.splitlines() if line.strip()), "")
    return re.sub(r"[*#`|]", "", first).strip()[:90]


def _readme(lang):
    """{name: text} of the README's marked parts in that language."""
    start, end = HALVES[lang]
    text = _read(README)
    half = text.split(start, 1)[-1].split(end, 1)[0] if start in text else ""
    parts, name, lines = {}, None, []
    for line in half.splitlines():
        mark = MARK.match(line.strip())
        if mark or (name and line.startswith(ENDS)):
            if name:
                parts[name] = _plain(lines)
            name, lines = (mark.group(1), []) if mark else (None, [])
            continue
        if name:
            lines.append(line)
    if name:
        parts[name] = _plain(lines)
    return parts


def _rules(lang):
    """Model Check's rules as people read them, without the section for those who maintain the code."""
    sections = re.split(r"\n(?=## )", _read(RULES[lang]))
    return _plain("\n".join(section for section in sections if "(for the AI" not in section and "给维护" not in section).splitlines())


def _pieces(text):
    """Paragraphs, a heading kept with the paragraph under it."""
    pieces = []
    for paragraph in text.split("\n\n"):
        if pieces and pieces[-1].startswith("#") and "\n" not in pieces[-1]:
            pieces[-1] += "\n\n" + paragraph
        else:
            pieces.append(paragraph)
    return pieces


def _parts(text):
    """`text` cut between paragraphs (or lines) into parts that fit an answer."""
    size = lambda value: len(value.encode("utf-8"))
    pieces = []
    for piece in _pieces(text):
        pieces.extend(piece.splitlines() if size(piece) > PART_BYTES else [piece])
    parts = [""]
    for piece in pieces:
        joined = f"{parts[-1]}\n\n{piece}" if parts[-1] else piece
        if size(joined) > PART_BYTES and parts[-1]:
            parts.append(piece)
        else:
            parts[-1] = joined
    return parts


def topics(lang):
    """{name: text} of every topic in that language, the README's in its order first."""
    found = _readme(lang)
    found["model_check_rules"] = _rules(lang)
    found["panel"] = PANEL
    return found


def read_guide(topic="", lang="en", part=1):
    lang = "zh" if str(lang or "").lower().startswith("zh") else "en"
    found = topics(lang)
    if not topic:
        return {"topics": [{"topic": name, "title": TITLES.get(name) or _title(text)} for name, text in found.items()],
                "note": "read_guide(topic=...) gives one. With lang='zh' the README's parts are in Chinese, with the "
                        "words the Chinese window shows: use them when you guide a user who writes Chinese."}
    if topic not in found:
        raise ToolError(f"No topic {topic!r}. The topics: {', '.join(found)}.")
    parts = _parts(found[topic])
    try:
        part = min(max(int(part), 1), len(parts))
    except (TypeError, ValueError):
        part = 1
    answer = {"topic": topic, "text": parts[part - 1]}
    if len(parts) > 1:
        answer.update(part=part, parts=len(parts))
        if part < len(parts):
            answer["more"] = f"read_guide(topic={topic!r}, part={part + 1}) goes on."
    return answer


GUIDE_TOOLS = dict([
    _tool("read_guide", "Read Anomalous's guide",
          "Anomalous's own manual, a topic at a time: how its pages and features work, to guide the user with the "
          "words on screen (lang='zh': the Chinese ones), Model Check's rules, and the fields of show_panel's blocks "
          "(topic 'panel'). No topic: the list. A long topic comes in parts.",
          read_guide, {"topic": {"type": "string"}, "lang": {"type": "string", "enum": ["en", "zh"], "default": "en"},
                       "part": {"type": "integer", "minimum": 1, "default": 1}}),
])
