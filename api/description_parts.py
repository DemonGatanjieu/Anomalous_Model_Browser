"""A model author's description (Civitai's HTML, or plain text) as plain paragraphs: the pieces the user
picks for an AI to read (ai_model_choice.py), checked again on every read so a picked piece the
description no longer has is not sent."""

import html
import re

MAX_PARTS = 40
MAX_PART = 800
BLOCK = re.compile(r"</?(?:p|div|li|ul|ol|h[1-6]|tr|table|blockquote|pre|hr)\b[^>]*>", re.IGNORECASE)
BREAK = re.compile(r"<br\s*/?>", re.IGNORECASE)


def paragraphs(description):
    """The description's paragraphs as plain text, in order, each once (at most MAX_PARTS, each cut to MAX_PART)."""
    text = BREAK.sub("\n", BLOCK.sub("\n\n", str(description or "")))
    text = html.unescape(re.sub(r"<[^>]+>", "", text))
    out = []
    for part in re.split(r"\n\s*\n", text):
        part = re.sub(r"\s+", " ", part).strip()[:MAX_PART]
        if part and part not in out:
            out.append(part)
            if len(out) == MAX_PARTS:
                break
    return out


def picked(description, chosen):
    """Of `chosen` (the texts the user picked), those `description` still has, in its order."""
    wanted = {text for text in chosen or [] if isinstance(text, str)}
    return [part for part in paragraphs(description) if part in wanted] if wanted else []
