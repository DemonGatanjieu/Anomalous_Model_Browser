import os

path_api = r'E:\ComfyUI_windows_portable\ComfyUI\custom_nodes\Anomalous_Model_Browser\api.py'
with open(path_api, 'r', encoding='utf-8') as f:
    content_api = f.read()

# Fix api.py to support multiple target_types and return size_mb
old_api = '''    try:
        paths = folder_paths.get_folder_paths(target_type)
    except Exception:
        return web.json_response({"models": []})
        
    if not paths:
        return web.json_response({"models": []})
        
    compatible_models = []
    
    for path_idx, base_dir in enumerate(paths):
        if not os.path.exists(base_dir):
            continue
            
        for root, _, files in os.walk(base_dir):
            for f in files:
                if f.endswith('.safetensors') or f.endswith('.ckpt') or f.endswith('.pt'):
                    file_path = os.path.join(root, f)
                    meta = get_metadata(file_path)
                    
                    if meta.get("baseModel") == base_model:
                        rel_subfolder = os.path.relpath(root, base_dir)'''

new_api = '''    target_types = [t.strip() for t in target_type.split(',')]
    compatible_models = []
    
    for t in target_types:
        try:
            paths = folder_paths.get_folder_paths(t)
        except Exception:
            continue
            
        if not paths:
            continue
            
        for path_idx, base_dir in enumerate(paths):
            if not os.path.exists(base_dir):
                continue
                
            for root, _, files in os.walk(base_dir):
                for f in files:
                    if f.endswith('.safetensors') or f.endswith('.ckpt') or f.endswith('.pt'):
                        file_path = os.path.join(root, f)
                        meta = get_metadata(file_path)
                        
                        if meta.get("baseModel") == base_model:
                            rel_subfolder = os.path.relpath(root, base_dir)'''

if old_api in content_api:
    content_api = content_api.replace(old_api, new_api)

# Add size_mb to API
old_api_size = '''                        if preview_file:
                            q_type = urllib.parse.quote(target_type)
                            q_idx = str(path_idx)
                            q_sub = urllib.parse.quote(rel_subfolder.strip('/')) if rel_subfolder != '/' else ""
                            q_file = urllib.parse.quote(preview_file)
                            preview_url = f"/anomalous/image?type={q_type}&path_idx={q_idx}&subfolder={q_sub}&filename={q_file}"
                        
                        compatible_models.append({
                            "type": target_type,
                            "path_idx": path_idx,
                            "subfolder": rel_subfolder,
                            "filename": f,
                            "preview_url": preview_url,
                            "metadata": meta
                        })'''

new_api_size = '''                        if preview_file:
                            q_type = urllib.parse.quote(t)
                            q_idx = str(path_idx)
                            q_sub = urllib.parse.quote(rel_subfolder.strip('/')) if rel_subfolder != '/' else ""
                            q_file = urllib.parse.quote(preview_file)
                            preview_url = f"/anomalous/image?type={q_type}&path_idx={q_idx}&subfolder={q_sub}&filename={q_file}"
                        
                        try:
                            size_mb = round(os.path.getsize(file_path) / (1024 * 1024), 1)
                        except:
                            size_mb = 0
                        
                        compatible_models.append({
                            "type": t,
                            "path_idx": path_idx,
                            "subfolder": rel_subfolder,
                            "filename": f,
                            "size_mb": size_mb,
                            "preview_url": preview_url,
                            "metadata": meta
                        })'''

if old_api_size in content_api:
    content_api = content_api.replace(old_api_size, new_api_size)

with open(path_api, 'w', encoding='utf-8') as f:
    f.write(content_api)
print('Updated api.py')

# Update main.js
path_js = r'E:\ComfyUI_windows_portable\ComfyUI\custom_nodes\Anomalous_Model_Browser\web\main.js'
with open(path_js, 'r', encoding='utf-8') as f:
    content_js = f.read()

# Fix targetType to search multiple folders
content_js = content_js.replace("const targetType = this.currentType === 'loras' ? 'checkpoints' : 'loras';", "const targetType = this.currentType === 'loras' ? 'checkpoints,unet,diffusion_models' : 'loras';")

# Fix help UI overflow
old_help_css = '''        const helpBox = document.createElement('div');
        helpBox.style.background = '#333';
        helpBox.style.padding = '20px';
        helpBox.style.borderRadius = '8px';
        helpBox.style.width = '80%';
        helpBox.style.maxWidth = '600px';'''

new_help_css = '''        const helpBox = document.createElement('div');
        helpBox.style.background = '#333';
        helpBox.style.padding = '20px';
        helpBox.style.borderRadius = '8px';
        helpBox.style.width = '80%';
        helpBox.style.maxWidth = '600px';
        helpBox.style.maxHeight = '90vh';
        helpBox.style.overflowY = 'auto';'''

if old_help_css in content_js:
    content_js = content_js.replace(old_help_css, new_help_css)

with open(path_js, 'w', encoding='utf-8') as f:
    f.write(content_js)
print('Updated main.js')
