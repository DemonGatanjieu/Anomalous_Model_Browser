"""Bounded translation-provider HTTP route."""

import asyncio
import json
import os
import urllib.parse
import urllib.request

from aiohttp import web


def _translate_with_deepl(text, tl, deepl_key):
    deepl_map = { "zh-CN": "ZH", "en": "EN", "ja": "JA", "ko": "KO", "fr": "FR", "de": "DE", "es": "ES", "ru": "RU" }
    d_tl = deepl_map.get(tl, "EN")
    url = "https://api-free.deepl.com/v2/translate" if ":fx" in deepl_key else "https://api.deepl.com/v2/translate"
    payload = urllib.parse.urlencode({
        "auth_key": deepl_key,
        "text": text,
        "target_lang": d_tl
    }).encode('utf-8')
    req = urllib.request.Request(url, data=payload)
    with urllib.request.urlopen(req, timeout=5) as resp:
        result = json.loads(resp.read().decode('utf-8'))
        return result["translations"][0]["text"]


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
    sl = 'zh-CN' if has_cn else 'en'
    pair_tl = 'en' if has_cn else ('zh-CN' if tl in ('zh', 'zh-CN') else tl)
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
        text = str(data.get("text", "")).strip()
        tl = str(data.get("target_lang", "zh-CN")).strip()
        if not text:
            return web.json_response({"translated": "", "status": "success"})
            
        # 1. Try DeepL if configured
        script_dir = os.path.dirname(os.path.abspath(__file__))
        config_path = os.path.join(script_dir, "config.json")
        deepl_key = ""
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    deepl_key = cfg.get("DEEPL_API_KEY", "").strip()
            except Exception:
                pass
                
        if deepl_key:
            try:
                translated = await asyncio.to_thread(_translate_with_deepl, text, tl, deepl_key)
                if translated:
                    return web.json_response({"translated": translated, "status": "success", "engine": "deepl"})
            except Exception as e:
                print(f"[Anomalous] DeepL translate failed: {e}")

        # 2. Try Google Translate (client=dict-chrome-ex)
        try:
            translated = await asyncio.to_thread(_translate_with_google, text, tl)
            if translated:
                return web.json_response({"translated": translated, "status": "success", "engine": "google"})
        except Exception as e:
            print(f"[Anomalous] Google translate failed: {e}")

        # 3. Fallback to MyMemory
        try:
            translated = await asyncio.to_thread(_translate_with_mymemory, text, tl)
            if translated:
                return web.json_response({"translated": translated, "status": "success", "engine": "mymemory"})
        except Exception as e:
            print(f"[Anomalous] MyMemory translate failed: {e}")
            raise e

    except Exception as e:
        print(f"[Anomalous] All translation providers failed: {e}")
        return web.json_response({"translated": text, "error": str(e), "status": "error"})
