"""The darkroom helper, an extension: a model running on this computer reads what a private task
keeps from the AI app (ai_privacy.py), so the task still gets a sealed prompt rewritten and its
pictures looked at. The user points Anomalous at a server that speaks the OpenAI chat API on a
loopback address (Ollama, LM Studio, llama.cpp's server; user/anomalous/ai_darkroom.json {url,
model, vision}). Any other address is refused, no proxy is used and no redirect is followed, so
what the helper is sent stays on this computer.

write(): the AI app says how a prompt should change (set_prompt's rewrite); the helper gets the
prompt's text and answers the new one, which leaves as a token like any prompt (ai_sealed.py).
check_picture(): the helper is shown the picture a private task withholds (zoom_image) and
answers a fixed list of checks, each one of a few allowed words (CHECKS); whatever else it says
is dropped, so the answer cannot carry what the picture shows."""

import json
import os
import re
import urllib.parse
import urllib.request

from . import ai_tasks
from .mcp_tools import ToolError, retext
from .path_utils import atomic_write_json

HOSTS = ("127.0.0.1", "localhost", "::1")
PORTS = (11434, 1234, 8080)  # Ollama, LM Studio, llama.cpp's server
TIMEOUT = 50  # an AI app waits about a minute for a tool
MAX_TEXT = 4000
MAX_ANSWER = 2_000_000
CHECKS = {"sharpness": ("sharp", "soft", "blurry"), "exposure": ("dark", "ok", "bright"),
          "hands": ("ok", "wrong", "not_shown"), "face": ("ok", "wrong", "not_shown"),
          "body": ("ok", "wrong", "not_shown"), "framing": ("ok", "cut_off", "off_centre")}
WRITE = ("You rewrite prompts for an image model. Change the prompt as asked and nothing else; keep its form (tags stay "
         "tags, sentences stay sentences) and its language. Answer with the new prompt only.")
LOOK = ("Check this generated picture. Answer with JSON only, for each key one of its words:\n"
        + "\n".join(f'"{name}": {" | ".join(words)}' for name, words in CHECKS.items()))
THINKING = re.compile(r"<think>.*?</think>", re.DOTALL)  # a reasoning model's notes before its answer


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect)


def _path():
    return os.path.join(os.path.dirname(ai_tasks.tasks_dir()), "ai_darkroom.json")


def _local(url):
    """`url` without its last slash when it is a server on this computer; ValueError for any other."""
    parts = urllib.parse.urlsplit(str(url or "").strip())
    if parts.scheme not in ("http", "https") or parts.hostname not in HOSTS or parts.username or parts.query or parts.fragment:
        raise ValueError("The helper is a server on this computer, like http://127.0.0.1:11434/v1")
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), "", ""))


def settings():
    """{url, model, vision} as the user set them, or None."""
    try:
        with open(_path(), encoding="utf-8") as source:
            kept = json.load(source)
        return {"url": _local(kept["url"]), "model": str(kept["model"]), "vision": kept.get("vision") is True}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def save(url, model, vision=False):
    if not isinstance(model, str) or not model.strip() or len(model) > 200:
        raise ValueError("Pick a model")
    kept = {"url": _local(url), "model": model.strip(), "vision": vision is True}
    atomic_write_json(_path(), kept)
    return kept


def turn_off():
    try:
        os.remove(_path())
    except OSError:
        pass


def _ask(url, body=None, timeout=TIMEOUT):
    request = urllib.request.Request(url, json.dumps(body).encode("utf-8") if body is not None else None, {"Content-Type": "application/json"})
    with _opener.open(request, timeout=timeout) as response:
        return json.loads(response.read(MAX_ANSWER).decode("utf-8"))


def models(url):
    """The models the server at `url` lists."""
    listed = _ask(_local(url) + "/models", timeout=3).get("data") or []
    return [str(item["id"]) for item in listed if isinstance(item, dict) and item.get("id")][:100]


def found():
    """The servers answering on this computer's usual ports: [{url, models}]."""
    servers = []
    for port in PORTS:
        url = f"http://127.0.0.1:{port}/v1"
        try:
            listed = models(url)
        except (OSError, ValueError, AttributeError):
            continue
        if listed:
            servers.append({"url": url, "models": listed})
    return servers


def note():
    """What the AI of a private task is told the helper does for it, or None when there is none."""
    kept = settings()
    if not kept:
        return None
    return ("The user runs a local model that reads what you may not. set_prompt(prompt=\"[P1]\", rewrite=\"what to change\") has it "
            "rewrite a sealed prompt; the new text is on the canvas and comes back as a token."
            + (" zoom_image on a picture answers with its checks (local_check: " + ", ".join(CHECKS) + "), each one of a few fixed words."
               if kept["vision"] else ""))


def _chat(messages, limit):
    kept = settings()
    if not kept:
        raise ToolError("The user has set up no local helper (the Gates window, Darkroom helper); go on without it.")
    try:
        answer = _ask(kept["url"] + "/chat/completions", {"model": kept["model"], "messages": messages, "temperature": 0.2,
                                                           "max_tokens": limit, "stream": False})
        text = answer["choices"][0]["message"]["content"]
    except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
        raise ToolError(f"The user's local helper did not answer ({type(error).__name__}); go on without it, or tell the user.")
    return THINKING.sub("", str(text or "")).strip()


def write(prompt, ask):
    """`prompt` changed the way `ask` says, by the helper."""
    text = _chat([{"role": "system", "content": WRITE},
                  {"role": "user", "content": f"Prompt:\n{prompt}\n\nChange it like this: {ask}"}], 1200).strip("`\"' \n")
    if not text:
        raise ToolError("The user's local helper gave no prompt; go on without it.")
    return text[:MAX_TEXT]


def look(image):
    """The helper's checks of `image` (an MCP image item): {check: one of its words}, only what CHECKS allows."""
    text = _chat([{"role": "user", "content": [
        {"type": "text", "text": LOOK},
        {"type": "image_url", "image_url": {"url": f"data:{image.get('mimeType') or 'image/webp'};base64,{image.get('data') or ''}"}}]}], 300)
    said = re.search(r"\{.*\}", text, re.DOTALL)
    try:
        said = json.loads(said.group(0)) if said else {}
    except ValueError:
        said = {}
    return {name: said[name] for name, words in CHECKS.items() if isinstance(said, dict) and said.get(name) in words}


def check_picture(result):
    """zoom_image's `result` in a private task, before its picture is taken out: the helper's checks with it
    (local_check), when the user's helper sees pictures."""
    kept = settings()
    image = next((item for item in result.get("content") or [] if isinstance(item, dict) and item.get("type") == "image"), None)
    data = result.get("structuredContent")
    if not kept or not kept["vision"] or not image or result.get("isError") or not isinstance(data, dict):
        return result
    try:
        checks = look(image) or "the local helper gave no usable answer"
    except ToolError as error:
        checks = str(error)
    retext(result, {**data, "local_check": checks})
    return result
