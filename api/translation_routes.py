"""Prompt translation (POST /anomalous/translate): DeepL when the user saved a key in Settings
-> Translation, else Google's free endpoint, else MyMemory. When DeepL was asked and failed, the
answer says why (`deepl_error`) while another provider still translates."""

import asyncio
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from aiohttp import web


_DEEPL_TARGETS = {
    "zh": "ZH-HANS", "zh-CN": "ZH-HANS", "zh-TW": "ZH-HANT", "en": "EN-US", "ja": "JA", "ko": "KO",
    "fr": "FR", "de": "DE", "es": "ES", "ru": "RU", "pt": "PT-BR",
}


def _translate_with_deepl(text, tl, deepl_key):
    """None for a target DeepL does not take: the other providers are asked instead."""
    d_tl = _DEEPL_TARGETS.get(tl)
    if not d_tl:
        return None
    # A Free account's key ends in ":fx". The key goes in the Authorization header: DeepL no
    # longer takes it as an auth_key parameter (2025).
    url = "https://api-free.deepl.com/v2/translate" if deepl_key.endswith(":fx") else "https://api.deepl.com/v2/translate"
    payload = json.dumps({"text": [text], "target_lang": d_tl}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST", headers={
        "Authorization": f"DeepL-Auth-Key {deepl_key}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=8) as resp:
        result = json.loads(resp.read().decode('utf-8'))
        return result["translations"][0]["text"]


def _deepl_error(error):
    """Why DeepL did not translate, for Settings: bad_key, quota, busy, or the error's own words."""
    if isinstance(error, urllib.error.HTTPError):
        if error.code in (401, 403):
            return "bad_key"
        if error.code == 456:
            return "quota"
        if error.code == 429:
            return "busy"
        return f"HTTP {error.code}"
    return str(error) or type(error).__name__


def _deepl_key():
    """The DeepL key saved in Settings -> Translation (config.json), or ""."""
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            key = json.load(f).get("DEEPL_API_KEY", "")
    except (OSError, ValueError, AttributeError):
        return ""
    return key.strip() if isinstance(key, str) else ""


def _translate_with_google(text, tl):
    clients = ["dict-chrome-ex", "gtx"]
    last_err = None
    target_lang = "zh-CN" if tl in ("zh", "zh-CN") else tl
    for client in clients:
        try:
            url = f"https://translate.googleapis.com/translate_a/single?client={client}&sl=auto&tl={target_lang}&dt=t&q={urllib.parse.quote(text)}"
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            })
            with urllib.request.urlopen(req, timeout=5) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                if result and isinstance(result, list) and len(result) > 0 and isinstance(result[0], list):
                    translated_text = "".join([part[0] for part in result[0] if part and len(part) > 0 and part[0]])
                    if translated_text:
                        return translated_text
        except Exception as e:
            last_err = e
            continue
    if last_err:
        raise last_err
    raise RuntimeError("Google translate returned empty result")


def _translate_with_mymemory(text, tl):
    has_cn = any('\u4e00' <= char <= '\u9fa5' for char in text)
    # Text that is not plain English and not Chinese (kana, hangul, accents...) is left to its detection.
    sl = 'zh-CN' if has_cn else ('en' if text.isascii() else 'Autodetect')
    pair_tl = 'zh-CN' if tl in ('zh', 'zh-CN') else tl
    url = f"https://api.mymemory.translated.net/get?q={urllib.parse.quote(text)}&langpair={sl}|{pair_tl}"
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        res = data.get("responseData", {}).get("translatedText")
        if res and res != text:
            return res
        for m in data.get("matches", []):
            t_match = m.get("translation")
            if t_match and t_match != text:
                return t_match
        if res:
            return res
    raise RuntimeError("MyMemory returned no translation")


async def api_translate(request):
    try:
        data = await request.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        return web.json_response({"status": "error", "message": "Invalid request body"}, status=400)
    text = str(data.get("text", "")).strip()
    try:
        tl = str(data.get("target_lang", "zh-CN")).strip()
        if not text:
            return web.json_response({"translated": "", "status": "success"})
            
        # 1. DeepL, when a key is saved
        deepl_key = _deepl_key()
        deepl_error = None
        if deepl_key:
            try:
                translated = await asyncio.to_thread(_translate_with_deepl, text, tl, deepl_key)
                if translated:
                    return web.json_response({"translated": translated, "status": "success", "engine": "deepl"})
            except Exception as e:
                deepl_error = _deepl_error(e)
                print(f"[Anomalous] DeepL translate failed: {deepl_error}")
        why = {"deepl_error": deepl_error} if deepl_error else {}

        # 2. Try Google Translate (client=dict-chrome-ex)
        try:
            translated = await asyncio.to_thread(_translate_with_google, text, tl)
            if translated:
                return web.json_response({"translated": translated, "status": "success", "engine": "google", **why})
        except Exception as e:
            print(f"[Anomalous] Google translate failed: {e}")

        # 3. Fallback to MyMemory
        try:
            translated = await asyncio.to_thread(_translate_with_mymemory, text, tl)
            if translated:
                return web.json_response({"translated": translated, "status": "success", "engine": "mymemory", **why})
        except Exception as e:
            print(f"[Anomalous] MyMemory translate failed: {e}")
            raise e

    except Exception as e:
        print(f"[Anomalous] All translation providers failed: {e}")
        return web.json_response({"translated": text, "error": str(e), "status": "error"})
