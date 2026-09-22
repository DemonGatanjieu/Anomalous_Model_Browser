"""Intelligent Romanization Engine for Japanese and Korean text alignment in F5-TTS."""

import re
import json
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
    Detect language and convert Japanese or Korean into standard Latin/Romaji phonetics.
    Returns dict with original, romanized, detected language, and success status.
    """
    raw = (text or "").strip()
    if not raw:
        return {"success": True, "original": "", "romanized": "", "lang": "empty"}

    has_hangul = bool(re.search(r'[\uac00-\ud7a3]', raw))
    has_kana = bool(re.search(r'[\u3040-\u30ff]', raw))

    # 1. Process Korean text
    if has_hangul:
        ht = _get_hangul_transliter()
        if ht:
            try:
                romanized = ht.translit(raw)
                return {
                    "success": True,
                    "original": raw,
                    "romanized": _clean_romanized_spacing(romanized),
                    "lang": "ko"
                }
            except Exception as e:
                return {"success": False, "error": f"Korean transliteration failed: {e}", "original": raw}

    # 2. Process Japanese text (Kana or Japanese context)
    if has_kana or (not has_hangul and bool(re.search(r'[\u4e00-\u9fff]', raw))):
        kakasi = _get_kakasi()
        if kakasi:
            try:
                result = kakasi.convert(raw)
                parts = []
                for item in result:
                    hep = item.get("hepburn", "")
                    parts.append(hep if hep else item.get("orig", ""))
                romanized = " ".join(parts)
                return {
                    "success": True,
                    "original": raw,
                    "romanized": _clean_romanized_spacing(romanized),
                    "lang": "ja"
                }
            except Exception as e:
                return {"success": False, "error": f"Japanese romanization failed: {e}", "original": raw}

    # Default: Already Latin or other language, keep as is
    return {
        "success": True,
        "original": raw,
        "romanized": raw,
        "lang": "unchanged"
    }


async def api_romanize_text(request):
    """POST /anomalous/romanize_text - Convert input text to Romaji / Latin transliteration."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "Invalid JSON body"}, status=400)

    text = data.get("text", "")
    res = romanize_text(text)
    status_code = 200 if res.get("success") else 500
    return web.json_response(res, status=status_code)
