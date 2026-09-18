"""Configured model-folder visibility and scan-scope helpers."""

import json
import os

from aiohttp import web
import folder_paths


DEFAULT_PHYSICAL_FOLDER_NAMES = {
    'checkpoints', 'loras', 'unet', 'diffusion_models', 'controlnet', 'vae'
}


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
                        if bn not in configured and bn in DEFAULT_PHYSICAL_FOLDER_NAMES:
                            active.append(bn)
                    return active
    except:
        pass
        
    return [bn for bn in all_bns if bn in DEFAULT_PHYSICAL_FOLDER_NAMES]


def get_active_model_roots():
    """Return the folder-manager-visible roots with stable model locators.

    This is intentionally separate from the scanner scope.  The source hub only
    needs directory discovery and must preserve ``type``/``path_idx`` so later
    metadata writes resolve back to the exact ComfyUI root.
    """
    mode = get_folder_view_mode()
    active_types = set(get_active_folder_types()) if mode != "physical" else None
    active_basenames = (
        set(get_active_physical_basenames()) if mode == "physical" else None
    )
    roots = []
    seen_realpaths = set()

    for folder_type in folder_paths.folder_names_and_paths.keys():
        if active_types is not None and folder_type not in active_types:
            continue
        try:
            paths = folder_paths.get_folder_paths(folder_type) or []
        except Exception:
            continue
        for path_idx, base_dir in enumerate(paths):
            if active_basenames is not None:
                basename = os.path.basename(os.path.normpath(base_dir))
                if basename not in active_basenames:
                    continue
            if not os.path.isdir(base_dir):
                continue
            real_dir = os.path.realpath(base_dir)
            real_key = os.path.normcase(real_dir)
            if real_key in seen_realpaths:
                continue
            seen_realpaths.add(real_key)
            roots.append({
                "type": folder_type,
                "path_idx": path_idx,
                "base_dir": real_dir,
            })
    return roots


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
            
        for bn in all_bns:
            if bn not in configured:
                result.append({
                    "type": bn,
                    "visible": bn in DEFAULT_PHYSICAL_FOLDER_NAMES
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
