import os
import sys
import json
import urllib.parse
import subprocess
import threading
import asyncio
from aiohttp import web
import folder_paths
import struct

async def api_get_config(request):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.json")
    has_key = False
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                has_key = bool(cfg.get("CIVITAI_API_KEY", "").strip())
        except:
            pass
    return web.json_response({"has_api_key": has_key})

async def api_save_config(request):
    try:
        data = await request.json()
        api_key = data.get("api_key", "").strip()
        script_dir = os.path.dirname(os.path.abspath(__file__))
        config_path = os.path.join(script_dir, "config.json")
        
        cfg = {}
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
            except:
                pass
                
        cfg["CIVITAI_API_KEY"] = api_key
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=4)
            
        return web.json_response({"status": "ok"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})


