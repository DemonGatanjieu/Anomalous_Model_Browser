import os

# 1. Update scraper.py skip logic
path_scraper = r'E:\ComfyUI_windows_portable\ComfyUI\custom_nodes\Anomalous_Model_Browser\scraper.py'
with open(path_scraper, 'r', encoding='utf-8') as f:
    content_scraper = f.read()

old_skip = '''            # 增量跳过：如果已经存在 .info 文件，说明已经成功扫描过，直接跳过
            if os.path.exists(old_base + ".info"):
                print(f"[*] 已跳过 (已扫描过): {filename}")
                continue'''

new_skip = '''            # 增量跳过：要求模型本体、.info、预览图三个文件全在，才算完整跳过
            info_exists = os.path.exists(old_base + ".info") or os.path.exists(old_base + ".civitai.info")
            preview_exists = False
            for ext in [".png", ".preview.png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm"]:
                if os.path.exists(old_base + ext):
                    preview_exists = True
                    break
                    
            if info_exists and preview_exists:
                print(f"[*] 已跳过 (信息与预览图均完整): {filename}")
                continue'''

if old_skip in content_scraper:
    content_scraper = content_scraper.replace(old_skip, new_skip)
    with open(path_scraper, 'w', encoding='utf-8') as f:
        f.write(content_scraper)
    print('Updated scraper skip logic')

# 2. Update main.js help modal CSS
path_js = r'E:\ComfyUI_windows_portable\ComfyUI\custom_nodes\Anomalous_Model_Browser\web\main.js'
with open(path_js, 'r', encoding='utf-8') as f:
    content_js = f.read()

old_box = '''        box.style.boxShadow = '0 10px 40px rgba(0,0,0,0.8)';
        box.style.display = 'flex';
        box.style.flexDirection = 'column';'''

new_box = '''        box.style.boxShadow = '0 10px 40px rgba(0,0,0,0.8)';
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        box.style.maxHeight = '90vh';'''

old_body = '''        const body = document.createElement('div');
        body.style.padding = '20px';
        body.innerHTML = t('helpContent');'''

new_body = '''        const body = document.createElement('div');
        body.style.padding = '20px';
        body.innerHTML = t('helpContent');
        body.style.overflowY = 'auto';
        body.style.flex = '1';'''

if old_box in content_js and old_body in content_js:
    content_js = content_js.replace(old_box, new_box).replace(old_body, new_body)
    with open(path_js, 'w', encoding='utf-8') as f:
        f.write(content_js)
    print('Updated main.js modal CSS')

