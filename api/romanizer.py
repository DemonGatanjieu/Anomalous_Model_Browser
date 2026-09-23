"""Intelligent Romanization Engine for Japanese and Korean text alignment in F5-TTS."""

import re
from aiohttp import web

_kakasi_instance = None
_hangul_transliter = None


def _get_kakasi():
    global _kakasi_instance
    if _kakasi_instance is None:
        try:
            import pykakasi
            _kakasi_instance = pykakasi.kakasi()
        except Exception:
            _kakasi_instance = False
    return _kakasi_instance if _kakasi_instance else None


def _get_hangul_transliter():
    global _hangul_transliter
    if _hangul_transliter is None:
        try:
            from hangul_romanize import Transliter
            from hangul_romanize.rule import academic
            _hangul_transliter = Transliter(academic)
        except Exception:
            _hangul_transliter = False
    return _hangul_transliter if _hangul_transliter else None


def _clean_romanized_spacing(text: str) -> str:
    """Normalize whitespace and punctuation spacing for speech synthesis alignment."""
    # Remove hyphens often generated in academic Korean romanization between syllables
    text = re.sub(r'(\w)-(\w)', r'\1\2', text)
    # Fix spaces preceding punctuation: 'word ,' -> 'word,'
    text = re.sub(r'\s+([,.:;!?~])', r'\1', text)
    # Ensure a space follows punctuation if directly adjacent to a letter: 'word,next' -> 'word, next'
    text = re.sub(r'([,.:;!?])([A-Za-z0-9])', r'\1 \2', text)
    # Collapse multiple whitespaces
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()


def romanize_text(text: str) -> dict:
    """
    Convert Japanese (text containing kana) or Korean (Hangul) into Latin phonetics.
    Chinese and other scripts are returned unchanged: Han characters alone are not
    treated as Japanese, because F5-TTS reads Chinese natively.
    """
    raw = (text or "").strip()
    if not raw:
        return {"success": True, "original": "", "romanized": "", "lang": "empty"}

    has_hangul = bool(re.search(r'[\uac00-\ud7a3]', raw))
    has_kana = bool(re.search(r'[\u3040-\u30ff]', raw))

    if has_hangul:
        ht = _get_hangul_transliter()
        if not ht:
            return {"success": False, "code": "missing_dependency", "error": "hangul-romanize is not installed", "original": raw}
        try:
            romanized = ht.translit(raw)
        except Exception as e:
            return {"success": False, "error": f"Korean transliteration failed: {e}", "original": raw}
        return {"success": True, "original": raw, "romanized": _clean_romanized_spacing(romanized), "lang": "ko"}

    if has_kana:
        kakasi = _get_kakasi()
        if not kakasi:
            return {"success": False, "code": "missing_dependency", "error": "pykakasi is not installed", "original": raw}
        try:
            parts = [item.get("hepburn") or item.get("orig", "") for item in kakasi.convert(raw)]
        except Exception as e:
            return {"success": False, "error": f"Japanese romanization failed: {e}", "original": raw}
        return {"success": True, "original": raw, "romanized": _clean_romanized_spacing(" ".join(parts)), "lang": "ja"}

    return {"success": True, "original": raw, "romanized": raw, "lang": "unchanged"}


async def api_romanize_text(request):
    """POST /anomalous/romanize_text - Convert input text to Romaji / Latin transliteration."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "Invalid JSON body"}, status=400)

    res = romanize_text(str(data.get("text", "")))
    if res.get("success"):
        status_code = 200
    elif res.get("code") == "missing_dependency":
        status_code = 503
    else:
        status_code = 500
    return web.json_response(res, status=status_code)
