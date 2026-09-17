"""Configured model-folder visibility and scan-scope helpers."""

import json
import os

from aiohttp import web
import folder_paths


def get_folder_view_mode():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.json")
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                return cfg.get("folder_view_mode", "abstract")
    except:
        pass
    return "abstract"


def get_all_physical_basenames():
    basenames = set()
    for t in folder_paths.folder_names_and_paths.keys():
        try:
            paths = folder_paths.get_folder_paths(t)
            if not paths: continue
            for p in paths:
                bn = os.path.basename(os.path.normpath(p))
                if bn: basenames.add(bn)
        except:
            pass
    return list(basenames)


def get_active_physical_basenames():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.json")
    
    all_bns = get_all_physical_basenames()
    active = []
    configured = set()
    
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                pfc = cfg.get("physical_folders_config")
                if pfc and isinstance(pfc, list):
                    for item in pfc:
                        bn = item.get("type")
                        if bn in all_bns:
                            configured.add(bn)
                            if item.get("visible", True):
                                active.append(bn)
                    
                    for bn in all_bns:
                        if bn not in configured:
                            active.append(bn)
                    return active
    except:
        pass
        
    return all_bns


def get_active_scan_paths():
    mode = get_folder_view_mode()
    paths = set()
    
    if mode == "physical":
        active_bns = set(get_active_physical_basenames())
        for t in folder_paths.folder_names_and_paths.keys():
            try:
                ps = folder_paths.get_folder_paths(t)
                if not ps: continue
                for p in ps:
                    if not os.path.exists(p): continue
                    bn = os.path.basename(os.path.normpath(p))
                    if bn in active_bns:
                        paths.add(os.path.realpath(p))
            except:
                pass
    else:
        active_types = get_active_folder_types()
        for t in active_types:
            try:
                ps = folder_paths.get_folder_paths(t)
                if not ps: continue
                for p in ps:
                    if not os.path.exists(p): continue
                    paths.add(os.path.realpath(p))
            except:
                pass
                
    return list(paths)


def get_active_folder_types():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.json")
    
    all_types = list(folder_paths.folder_names_and_paths.keys())
    default_types = ['checkpoints', 'loras', 'diffusion_models', 'unet', 'controlnet', 'vae']
    
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                ftc = cfg.get("folder_types_config")
                if ftc and isinstance(ftc, list):
                    active = []
                    configured_types = set()
                    for item in ftc:
                        t = item.get("type")
                        if t in all_types:
                            configured_types.add(t)
                            if item.get("visible", True):
                                active.append(t)
                    # For any newly registered types not in config, do not show them by default 
                    # unless they are in default_types
                    for t in all_types:
                        if t not in configured_types and t in default_types:
                            active.append(t)
                    return active
    except Exception:
        pass
    
    # Fallback if no config exists
    active = [t for t in default_types if t in all_types]
    return active


async def api_get_all_folder_types(request):
    mode = get_folder_view_mode()
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, "config.json")
    
    result = []
    
    if mode == "physical":
        all_bns = get_all_physical_basenames()
        configured = set()
        try:
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    pfc = cfg.get("physical_folders_config")
                    if pfc and isinstance(pfc, list):
                        for item in pfc:
                            bn = item.get("type")
                            if bn in all_bns:
                                configured.add(bn)
                                result.append({
                                    "type": bn,
                                    "visible": item.get("visible", True)
                                })
        except:
            pass
            
        default_physical_types = ['checkpoints', 'loras', 'unet', 'diffusion_models', 'controlnet', 'vae']
        for bn in all_bns:
            if bn not in configured:
                result.append({
                    "type": bn,
                    "visible": bn in default_physical_types
                })
    else:
        # Abstract mode
        all_types = list(folder_paths.folder_names_and_paths.keys())
        default_types = ['checkpoints', 'loras', 'diffusion_models', 'controlnet', 'vae']
        configured_types = set()
        try:
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    ftc = cfg.get("folder_types_config")
                    if ftc and isinstance(ftc, list):
                        for item in ftc:
                            t = item.get("type")
                            if t in all_types:
                                configured_types.add(t)
                                result.append({
                                    "type": t,
                                    "visible": item.get("visible", True)
                                })
        except:
            pass
            
        for t in all_types:
            if t not in configured_types:
                result.append({
                    "type": t,
                    "visible": t in default_types
                })
                
    return web.json_response({"folder_types": result, "folder_view_mode": mode})
