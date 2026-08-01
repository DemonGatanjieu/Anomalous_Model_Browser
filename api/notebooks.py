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
from .utils import require_filename, resolve_within

async def api_get_notebooks(request):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    nb_dir = os.path.join(script_dir, "notebooks")
    if not os.path.exists(nb_dir):
        os.makedirs(nb_dir)
    
    notebooks = []
    for f in os.listdir(nb_dir):
        if f.endswith('.json'):
            try:
                with open(os.path.join(nb_dir, f), 'r', encoding='utf-8') as file:
                    data = json.load(file)
                    notebooks.append({
                        "filename": f,
                        "name": data.get("name", f.replace('.json', '')),
                        "data": data
                    })
            except Exception:
                pass
    return web.json_response({"notebooks": notebooks})

async def api_save_notebook(request):
    try:
        data = await request.json()
        filename = data.get("filename", "")
        if not filename.endswith('.json'):
            filename += '.json'
        try:
            filename = require_filename(filename)
        except ValueError:
            return web.json_response({"status": "error", "message": "Invalid filename"}, status=400)
            
        script_dir = os.path.dirname(os.path.abspath(__file__))
        nb_dir = os.path.join(script_dir, "notebooks")
        if not os.path.exists(nb_dir):
            os.makedirs(nb_dir)
            
        file_path = resolve_within(nb_dir, filename)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data.get("data", {}), f, indent=4, ensure_ascii=False)
            
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})

async def api_delete_notebook(request):
    try:
        data = await request.json()
        filename = data.get("filename", "")
        try:
            filename = require_filename(filename)
        except ValueError:
            return web.json_response({"status": "error", "message": "Invalid filename"}, status=400)
            
        script_dir = os.path.dirname(os.path.abspath(__file__))
        nb_dir = os.path.join(script_dir, "notebooks")
        file_path = resolve_within(nb_dir, filename)
        
        if os.path.exists(file_path):
            os.remove(file_path)
            return web.json_response({"status": "success"})
        return web.json_response({"status": "error", "message": "File not found"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)})

