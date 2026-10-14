"""The proxy the plugin's own web requests go through, and why a request failed.

Settings -> Network keeps a proxy address in api/config.json (NETWORK_PROXY). When it is set,
every request of the plugin (Civitai, Hugging Face, GitHub, the translators) goes through it,
and the scan process gets it as HTTP(S)_PROXY. When it is empty, urllib finds the proxy itself:
HTTPS_PROXY, else the Windows proxy (not a PAC script, not a browser extension). ComfyUI's own
requests and other node packs are not touched.

`failure()` names why a request failed in a few fixed words the pages explain. No imports from
ComfyUI or the api package, so the scan process (scraper.py) uses it too.
"""

import json
import os
import re
import socket
import ssl
import urllib.error
import urllib.request

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "api", "config.json")
CONFIG_KEY = "NETWORK_PROXY"
_ADDRESS = re.compile(r"^(?:(https?)://)?([A-Za-z0-9.\-]+|\[[0-9A-Fa-f:]+\]):(\d{1,5})/?$", re.IGNORECASE)


def normalize(text) -> str:
    """'' or 'http://host:port'. ValueError('socks') for a SOCKS address (urllib cannot use
    one; proxy apps also offer an HTTP port), ValueError('format') for anything else."""
    value = str(text or "").strip()
    if not value:
        return ""
    if value.lower().startswith("socks"):
        raise ValueError("socks")
    match = _ADDRESS.match(value)
    if not match or not 0 < int(match.group(3)) < 65536:
        raise ValueError("format")
    return f"{(match.group(1) or 'http').lower()}://{match.group(2)}:{int(match.group(3))}"


def configured() -> str:
    """The saved proxy address, or '' (none saved, or the file unreadable)."""
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return normalize(json.load(f).get(CONFIG_KEY, ""))
    except (OSError, ValueError, AttributeError):
        return ""


def urlopen(request, timeout, context=None):
    """urllib.request.urlopen through the saved proxy, when there is one."""
    proxy = configured()
    if not proxy:
        if context is None:
            return urllib.request.urlopen(request, timeout=timeout)
        return urllib.request.urlopen(request, timeout=timeout, context=context)
    handlers = [urllib.request.ProxyHandler({"http": proxy, "https": proxy})]
    if context is not None:
        handlers.append(urllib.request.HTTPSHandler(context=context))
    return urllib.request.build_opener(*handlers).open(request, timeout=timeout)


def child_env() -> dict:
    """The environment for a process of ours (the scan) that should use the same proxy."""
    env = dict(os.environ)
    proxy = configured()
    if proxy:
        env.update(HTTP_PROXY=proxy, HTTPS_PROXY=proxy, http_proxy=proxy, https_proxy=proxy)
    return env


def failure(error) -> str:
    """'timeout' | 'refused' | 'dns' | 'ssl' | 'reset' | 'proxy' | 'http:<code>' | 'other'."""
    if isinstance(error, urllib.error.HTTPError):
        return f"http:{error.code}"
    reason = error.reason if isinstance(error, urllib.error.URLError) else error
    if isinstance(reason, (socket.timeout, TimeoutError)):
        return "timeout"
    if isinstance(reason, ConnectionRefusedError):
        return "refused"
    if isinstance(reason, socket.gaierror):
        return "dns"
    if isinstance(reason, (ssl.SSLError, ssl.CertificateError)):
        return "ssl"
    if isinstance(reason, (ConnectionResetError, ConnectionAbortedError)):
        return "reset"
    if "tunnel connection failed" in str(reason).lower():
        return "proxy"
    if "timed out" in str(reason).lower():
        return "timeout"
    return "other"
