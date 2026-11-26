"""Read only attributable drawing text. The schema cache never contains workflow values."""
import re
import sys
import time
import unicodedata
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Lock

from .workflow_route import schema_widget_names

FIELD = re.compile(
    r"(?:positive|negative|text|prompt|string|wildcard|prefix|suffix|description|caption|"
    r"(?:text|prompt|string)[_ ]?(?:[abgl]|\d+|positive|negative|before|after|prefix|suffix)|"
    r"(?:user|image|scene|style|positive|negative|wildcard|prefix|suffix|prepend|append|input|source|clip)[_ ]?(?:text|prompt|string|description)|"
    r"正向提示词|负向提示词|提示词)", re.I)
PRIVATE_NAME = re.compile(r"api.?key|access.?key|token(?!izer)|secret|passw(?:or)?d|credential|bearer|auth|header|cookie|"
                          r"system|developer|instruction|history|messages|endpoint|url|uri|file|path|directory|"
                          r"sampler|scheduler|separator|delimiter|watermark|filename|模型名|路径|密钥|系统指令|密码", re.I)
PRIVATE_TEXT = re.compile(
    r"(?:\b(?:sk[-_]|gh[pousr]_|github_pat_|hf_|xox[baprs]-|AKIA)[\w-]{6,}|"
    r"\bbearer\s+\S+|\beyJ[\w-]+\.[\w-]+\.[\w-]+|-----BEGIN [^-\n]*PRIVATE KEY-----|"
    r"""(?:authorization|x-api-key|api[_ -]?key|password|secret|access[_ -]?token)['"]?\s*[:=]|"""
    r"""['"]role['"]\s*:\s*['"](?:system|developer)['"]|<\|start_header_id\|>(?:system|developer)|"""
    r"(?:https?|file|ftp)://|[a-z]:[\\/]|\\\\[^\\\s]+\\|(?:^|[\s=\"'(:,])/(?![/\s])[\w.~%-]+(?:/|\b)|"
    r"<\|(?:im_start\|>\s*)?(?:system|developer)\b|(?:^|\n)\s*(?:system|developer)(?:\s+(?:prompt|message))?\s*:|"
    r"(?:^|\n)\s*(?:you are (?:an? |the )?(?:helpful |expert )?(?:assistant|language model)|你是一个.{0,12}助手)|"
    r"\[/?(?:inst|system)\]|<<SYS>>|</?(?:system|developer)>|"
    r"\b[A-Za-z0-9_+/=-]{40,}\b)", re.I)
FILE_VALUE = re.compile(r"\.(?:safetensors|ckpt|gguf|pth?|bin|onnx|png|jpe?g|webp|gif|mp4|json|ya?ml|csv|txt)\s*$", re.I)
OPTIONS = {"euler", "euler_a", "euler_ancestral", "dpmpp_2m", "karras", "normal", "simple",
           "sgm_uniform", "ddim", "enable", "disable", "fixed", "randomize"}
MODEL_NODE = re.compile(r"note$|markdownnote|watermark|saveimage|loadimage|setnode$|getnode$", re.I)
LANGUAGE_NODE = re.compile(r"llm|openai|ollama|gemini|claude|chat|gpt|translat", re.I)


def safe_text(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 8192:
        return False
    if len(value.encode("utf-8", errors="surrogatepass")) > 8192:
        return False
    check = unicodedata.normalize("NFKC", value)
    return (not PRIVATE_TEXT.search(check) and not FILE_VALUE.search(check)
            and not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff]", value)
            and check.strip().casefold() not in OPTIONS and any(ch.isalnum() for ch in check))


def safe_label(value):
    return value if isinstance(value, str) and len(value) <= 96 and safe_text(value) and not PRIVATE_NAME.search(value) else ""


def text_field(name):
    return isinstance(name, str) and len(name) <= 96 and bool(FIELD.fullmatch(name)) and not PRIVATE_NAME.search(name)


def _definition(cls):
    spec = cls.INPUT_TYPES()
    fields = {}
    for group in ("required", "optional"):
        for name, item in spec.get(group, {}).items():
            if not isinstance(item, (tuple, list)) or not item:
                continue
            opts = item[1] if len(item) > 1 and isinstance(item[1], dict) else {}
            fields[name] = (item[0] == "STRING", bool(opts.get("multiline")))
    return schema_widget_names(spec), fields


_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="amb-prompt-schema")
_lock = Lock()
_cache = OrderedDict()
_pending = {}


def _cached(key, definition):
    _cache[key] = definition
    if len(_cache) > 256:
        _cache.popitem(last=False)


def _load(key):
    try:
        definition = _definition(key[1])
    except Exception:  # An installed pack may have unavailable dependencies.
        definition = None
    with _lock:
        _cached(key, definition)
        _pending.pop(key, None)
    return definition


def cached_schema(kind, deadline):
    registry = getattr(sys.modules.get("nodes"), "NODE_CLASS_MAPPINGS", {})
    cls = registry.get(kind)
    key = (kind, cls)
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
        if cls is None:
            _cached(key, None)
            return None
        job = _pending.get(key)
        if job is None:
            if len(_pending) >= 2 or time.monotonic() >= deadline:
                return None
            job = _pending[key] = _pool.submit(_load, key)
    try:
        return job.result(timeout=max(0, deadline - time.monotonic()))
    except TimeoutError:
        return None


def field_values(kind, ui, inputs, connected, deadline):
    """Yield (identity, source, literal, stable). Never guess the order of several unnamed boxes."""
    if MODEL_NODE.search(kind):
        return
    language = LANGUAGE_NODE.search(kind)

    def allowed(name):
        if not isinstance(name, str) or not safe_label(name):
            return False
        return not language or name.casefold() in {"user_prompt", "user_text", "image_prompt", "input_text", "source_text"}

    raw_ports = ui.get("inputs")
    ports = {p["name"]: p for p in (raw_ports if isinstance(raw_ports, list) else [])
             if isinstance(p, dict) and isinstance(p.get("name"), str)}
    literals = {name: val for name, val in inputs.items() if isinstance(val, str) and allowed(name)}
    values = ui.get("widgets_values") or []
    if not isinstance(values, list):
        values = []
    # Only map UI positions when they can add an original that the API chunk did not keep.
    saved_literals = {value for value in inputs.values() if isinstance(value, str)}
    need_widgets = any(isinstance(value, str) and value not in saved_literals and safe_text(value) for value in values)
    need_schema = need_widgets or any(
        not text_field(name) or ports.get(name, {}).get("type") not in ("STRING", "COMBO")
        for name in literals
    )
    schema = cached_schema(kind, deadline) if need_schema else None
    names, specs = schema or ([], {})

    def qualifies(name):
        port_type = ports.get(name, {}).get("type")
        if port_type not in (None, "*", "STRING"):
            return False
        if need_schema and schema is None and port_type != "STRING" and kind in getattr(
                sys.modules.get("nodes"), "NODE_CLASS_MAPPINGS", {}):
            return False  # An installed but unavailable definition could describe a dropdown.
        known = specs.get(name)
        return allowed(name) and (text_field(name) if known is None else known[0] and (text_field(name) or known[1]))

    for name, value in literals.items():
        if qualifies(name) and safe_text(value):
            yield name, "api", value, True
    # If a named execution graph exists, its connected inputs must never fall back to stale widgets.
    if not need_widgets:
        return
    connected = connected.union(name for name, value in inputs.items() if isinstance(value, list))
    declared = [p["name"] if p["name"] == p["widget"].get("name") else None
                for p in ports.values() if isinstance(p.get("widget"), dict)]
    if not schema and len(declared) == len(values) == 1 and isinstance(declared[0], str):
        name = declared[0]
        if name in ports and name not in connected and qualifies(name) and safe_text(values[0]):
            yield name, "widget", values[0], True
    elif len(names) == len(values) == 1:
        name = names[0]
        if name not in connected and qualifies(name) and safe_text(values[0]):
            yield name, "widget", values[0], True
    elif len(names) == len(values) and len(names) > 1:
        # Positional data alone is ambiguous with frontend-added widgets. Require explicit widget
        # descriptors for the entire sequence before assigning any value to a named input.
        if declared == names:
            for name, value in zip(names, values):
                if name not in connected and qualifies(name) and safe_text(value):
                    yield name, "widget", value, True
    elif not inputs and not schema and len(values) == 1 and not connected and not ports and not language and safe_text(values[0]):
        if re.fullmatch(r"Primitive(?:Node|String(?:Multiline)?)|.*(?:Wildcard|MultilineText)(?:Processor)?", kind, re.I):
            yield "", "widget", values[0], False
