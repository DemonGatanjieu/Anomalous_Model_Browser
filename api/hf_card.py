"""What a Hugging Face repository says about a model downloaded from it (model_download.py):
the model card's first example image becomes its cover, and its trigger words, example prompts
and base model go into its notes, with the repository as its link. Hugging Face cannot be asked
by fingerprint, so this works only for files downloaded from it (the repository is known then).

Nothing the user or a scan already has is replaced: a cover only when the model has none, notes
and link only when empty (in the user's layer, <model>.anomalous.json).
"""

import json
import os
import urllib.parse
import urllib.request

from .model_constants import MEDIA_EXTENSIONS, PREVIEW_SUFFIXES
from .path_utils import atomic_write_json

try:
    from ..model_identity import USER_INFO_SUFFIX, read_json
    from ..civitai_client import USER_AGENT
except ImportError:  # loaded outside the package (tests)
    from model_identity import USER_INFO_SUFFIX, read_json
    from civitai_client import USER_AGENT

TIMEOUT = 15
MAX_COVER_BYTES = 20 * 1024 * 1024
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}
IMAGE_FILE = (".png", ".jpg", ".jpeg", ".webp")
HF_HOSTS = ("huggingface.co", "hf-mirror.com")
MAX_PROMPTS = 3


def repo_of(url):
    """("org/name", host) of a Hugging Face file link, or None."""
    parsed = urllib.parse.urlsplit(url)
    parts = [part for part in parsed.path.split("/") if part]
    if (parsed.hostname or "") not in HF_HOSTS or "resolve" not in parts or parts.index("resolve") < 2:
        return None
    return "/".join(parts[:2]), parsed.hostname


def _get(url, limit=None):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        data = response.read(limit + 1 if limit else -1)
        return data, str(response.headers.get("Content-Type", "")).split(";")[0].strip().lower()


def _file_url(repo, host, path):
    """A link to a file of the repository, on `host` (the mirror when the download used it)."""
    if path.startswith(("https://", "http://")):
        parsed = urllib.parse.urlsplit(path)
        if parsed.hostname not in HF_HOSTS:
            return ""
        return urllib.parse.urlunsplit(("https", host, parsed.path, parsed.query, ""))
    return f"https://{host}/{repo}/resolve/main/{urllib.parse.quote(path.lstrip('/'))}"


def _as_list(value):
    if isinstance(value, str):
        return [value] if value.strip() else []
    return [str(item) for item in value if str(item).strip()] if isinstance(value, list) else []


def read_card(repo, host):
    """{images, prompts, trigger, base} from the repository's model card (empty when it has none)."""
    data, _type = _get(f"https://{host}/api/models/{repo}?expand[]=cardData&expand[]=siblings")
    info = json.loads(data.decode("utf-8"))
    card = info.get("cardData") or {}
    widgets = [item for item in card.get("widget") or [] if isinstance(item, dict)]
    images = [(item.get("output") or {}).get("url") for item in widgets]
    images = [url for url in (_file_url(repo, host, str(path)) for path in images if path) if url]
    if not images:  # no examples in the card: the repository's own pictures
        files = [item.get("rfilename", "") for item in info.get("siblings") or [] if isinstance(item, dict)]
        images = [_file_url(repo, host, name) for name in files if name.lower().endswith(IMAGE_FILE)][:1]
    prompts = [str(item.get("text")).strip() for item in widgets if isinstance(item.get("text"), str) and item["text"].strip()]
    return {"images": images, "prompts": prompts[:MAX_PROMPTS],
            "trigger": _as_list(card.get("instance_prompt")), "base": _as_list(card.get("base_model"))}


def save_cover(image_url, base_path):
    """The image as the model's cover (<model>.preview.<ext>) when it has none yet; True if saved."""
    if any(os.path.exists(base_path + suffix) for suffix in PREVIEW_SUFFIXES + MEDIA_EXTENSIONS):
        return False
    data, content_type = _get(image_url, MAX_COVER_BYTES)
    extension = IMAGE_TYPES.get(content_type)
    if not extension or len(data) > MAX_COVER_BYTES:
        return False
    target = base_path + ".preview" + extension
    temporary = target + ".part"
    with open(temporary, "wb") as output:
        output.write(data)
    os.replace(temporary, target)
    return True


def notes_text(repo, card):
    lines = [f"Hugging Face: {repo}"]
    if card["base"]:
        lines.append("Base model: " + ", ".join(card["base"]))
    if card["trigger"]:
        lines.append("Trigger words: " + ", ".join(card["trigger"]))
    if card["prompts"]:
        lines.append("Example prompts:")
        lines.extend("- " + prompt[:400] for prompt in card["prompts"])
    return "\n".join(lines)


def save_notes(base_path, repo, card):
    """The card's words as the model's notes and the repository as its link, where both are empty."""
    path = base_path + USER_INFO_SUFFIX
    if os.path.exists(path) and read_json(path) is None:
        return False  # unreadable: leave it to the user
    user = read_json(path) or {"format": 1}
    changed = False
    if not str(user.get("custom_notes") or "").strip():
        user["custom_notes"] = notes_text(repo, card)
        changed = True
    if not str(user.get("source_url") or "").strip():
        user["source_url"] = f"https://huggingface.co/{repo}"
        changed = True
    if changed:
        atomic_write_json(path, user)
    return changed


def enrich(model_path, download_url):
    """Cover and notes for a model just downloaded from Hugging Face: {cover, notes}."""
    located = repo_of(download_url)
    if not located:
        return {"cover": False, "notes": False}
    repo, host = located
    base_path = os.path.splitext(model_path)[0]
    card = read_card(repo, host)
    cover = False
    for image in card["images"][:2]:
        try:
            cover = save_cover(image, base_path)
            break
        except OSError:
            continue
    return {"cover": cover, "notes": save_notes(base_path, repo, card)}
