"""Civitai over the network, for the scanner: a model version by file hash, a model page's
description, and preview media. The API key comes from the plugin's config.json.

fetch_civitai_info tells the two failures apart: None means Civitai answered that it does not
know the file; CivitaiUnreachable means it could not be asked (no connection, timeouts, errors).
"""

import json
import os
import time
import urllib.error
import urllib.request
from typing import Dict, Optional

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


class CivitaiUnreachable(Exception):
    """Civitai did not answer (network, timeout or server error) after the retries."""


def _load_api_key():
    plugin_dir = os.path.dirname(os.path.abspath(__file__))
    for config_path in (os.path.join(plugin_dir, "api", "config.json"), os.path.join(plugin_dir, "config.json")):
        if not os.path.exists(config_path):
            continue
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                key = json.load(f).get("CIVITAI_API_KEY", "")
            if isinstance(key, str) and key.strip():
                return key.strip()
        except Exception as e:
            print(f"[-] 读取 config.json 失败: {e}")
    return None


CIVITAI_API_KEY = _load_api_key()


def _headers():
    headers = {"User-Agent": USER_AGENT}
    if CIVITAI_API_KEY:
        headers["Authorization"] = f"Bearer {CIVITAI_API_KEY}"
    return headers


def fetch_civitai_info(file_hash: str, max_retries: int = 3) -> Optional[Dict]:
    """Civitai's record of the model version with this file hash; None when Civitai does not
    know the file (404). Raises CivitaiUnreachable when it could not be asked."""
    url = f"https://civitai.com/api/v1/model-versions/by-hash/{file_hash}"
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=_headers()), timeout=15) as response:
                return json.loads(response.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                print(f"\033[93m[Skip] 模型 Hash {file_hash} 未在 Civitai 找到 (404)。\033[0m")
                return None
            print(f"[-] 请求异常，状态码: {e.code} (尝试 {attempt+1}/{max_retries})")
        except urllib.error.URLError as e:
            print(f"[-] 网络请求超时或异常: {e.reason} (尝试 {attempt+1}/{max_retries})")
        except Exception as e:
            print(f"[-] 未知异常: {e} (尝试 {attempt+1}/{max_retries})")
        if attempt < max_retries - 1:
            time.sleep(2)
    print(f"\033[93m[Skip] 模型 Hash {file_hash} 网络重试失败。\033[0m")
    raise CivitaiUnreachable(file_hash)


def fetch_model_description(model_id) -> str:
    """The model page's description (the version record only has the version's); '' when unavailable."""
    try:
        request = urllib.request.Request(f"https://civitai.com/api/v1/models/{model_id}", headers=_headers())
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode('utf-8')).get("description") or ""
    except Exception as e:
        print(f"[-] 获取模型主页详细说明失败: {e}")
        return ""


def download_media(url: str, base_path: str, max_retries: int = 3):
    """Downloads an image or video to base_path + the extension its type calls for; the path, or None."""
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=_headers()), timeout=15) as response:
                content_type = response.headers.get("Content-Type", "").lower()
                ext = ".png"
                if "video/mp4" in content_type: ext = ".mp4"
                elif "video/webm" in content_type: ext = ".webm"
                elif "image/jpeg" in content_type: ext = ".jpg"
                elif "image/webp" in content_type: ext = ".webp"
                elif url.endswith(".mp4"): ext = ".mp4"
                final_path = base_path + ext
                with open(final_path, 'wb') as f:
                    while True:
                        chunk = response.read(8192)
                        if not chunk:
                            break
                        f.write(chunk)
                return final_path
        except urllib.error.HTTPError as e:
            print(f"[-] 媒体下载失败，状态码: {e.code} (尝试 {attempt+1}/{max_retries})")
        except urllib.error.URLError as e:
            print(f"[-] 媒体下载网络异常: {e.reason} (尝试 {attempt+1}/{max_retries})")
        except Exception:
            pass
    return None
