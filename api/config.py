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
    folder_types = []
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                has_key = bool(cfg.get("CIVITAI_API_KEY", "").strip())
                folder_types = cfg.get("folder_types_config", [])
        except:
            pass
    if not has_key:
        legacy_config_path = os.path.join(os.path.dirname(script_dir), "config.json")
        if os.path.exists(legacy_config_path):
            try:
                with open(legacy_config_path, 'r', encoding='utf-8') as f:
                    legacy_cfg = json.load(f)
                has_key = bool(legacy_cfg.get("CIVITAI_API_KEY", "").strip())
            except Exception:
                pass
    return web.json_response({"has_api_key": has_key, "folder_types_config": folder_types})

async def api_save_config(request):
    try:
        data = await request.json()
        api_key = data.get("api_key")
        folder_types_config = data.get("folder_types_config")
        
        script_dir = os.path.dirname(os.path.abspath(__file__))
        config_path = os.path.join(script_dir, "config.json")
        
        cfg = {}
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
            except:
                pass
                
        if api_key is not None and not isinstance(api_key, str):
            return web.json_response({"status": "error", "message": "Invalid API key"}, status=400)
        if folder_types_config is not None and not isinstance(folder_types_config, list):
            return web.json_response({"status": "error", "message": "Invalid folder configuration"}, status=400)
        if "physical_folders_config" in data and not isinstance(data.get("physical_folders_config"), list):
            return web.json_response({"status": "error", "message": "Invalid physical folder configuration"}, status=400)
        if "folder_view_mode" in data and data.get("folder_view_mode") not in {"abstract", "physical"}:
            return web.json_response({"status": "error", "message": "Invalid folder view mode"}, status=400)

        if api_key is not None:
            cfg["CIVITAI_API_KEY"] = api_key.strip()
            
        if folder_types_config is not None:
            cfg["folder_types_config"] = folder_types_config
            
        if "physical_folders_config" in data:
            cfg["physical_folders_config"] = data.get("physical_folders_config")
            
        if "folder_view_mode" in data:
            cfg["folder_view_mode"] = data.get("folder_view_mode")
            
        temp_path = config_path + ".tmp"
        with open(temp_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=4)
        os.replace(temp_path, config_path)
            
        return web.json_response({"status": "ok"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})


