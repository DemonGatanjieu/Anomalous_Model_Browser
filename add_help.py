import os
import re

path = r"E:\ComfyUI_windows_portable\ComfyUI\custom_nodes\Anomalous_Model_Browser\web\main.js"
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add i18n keys for Help
zh_help = """
        help: '帮助',
        helpTitle: '📖 使用说明',
        helpContent: `
<div style="line-height: 1.6; font-size: 0.95em; color: #eee; padding: 10px;">
    <p><strong>1. 🔑 API Key (Civitai)</strong>: 在顶部输入你的 API Key，可用于扫描时获取限制级 (NSFW) 模型的封面和信息。</p>
    <p><strong>2. 🔄 扫描 (Scan)</strong>: 自动扫描当前选中的文件夹，从 C 站匹配并下载封面图，同时规范化重命名你的本地模型文件。</p>
    <p><strong>3. 🧹 清理 (Clean Info)</strong>: 全局深度清理：自动扫描并删除所有因为模型被删而遗留的无效 .civitai.info 文件。</p>
    <p><strong>4. 🔋 节能 / 🎬 自动播放</strong>: 切换视频封面的播放行为。“节能”模式下，鼠标悬浮在卡片上时才会播放预览视频。</p>
    <p><strong>5. 🗂️ 详情与删除</strong>: 点击任何模型卡片，可查看介绍并<strong>一键复制触发词</strong>。也可以在此处彻底删除模型及关联配置（删除后须重启 ComfyUI 引擎生效）。</p>
    <p><strong>6. 📂 目录折叠</strong>: 点击左侧边栏的“收起/展开全部”快速管理网格视图。</p>
</div>`,
        closeHelp: '关闭说明',
"""

en_help = """
        help: 'Help',
        helpTitle: '📖 User Manual',
        helpContent: `
<div style="line-height: 1.6; font-size: 0.95em; color: #eee; padding: 10px;">
    <p><strong>1. 🔑 API Key (Civitai)</strong>: Enter your key at the top to fetch metadata and previews for NSFW models during scanning.</p>
    <p><strong>2. 🔄 Scan</strong>: Automatically scans the current folder, fetches Civitai metadata, downloads previews, and standardizes model filenames.</p>
    <p><strong>3. 🧹 Clean Info</strong>: Globally scans and deletes orphaned .civitai.info files to free up disk space.</p>
    <p><strong>4. 🔋 Eco / 🎬 AutoPlay</strong>: Toggle video playback modes. Eco mode plays videos only when hovering over a model card.</p>
    <p><strong>5. 🗂️ Details & Delete</strong>: Click a model card to view details and <strong>1-click copy trained words</strong>. You can also permanently delete the model here (requires ComfyUI restart).</p>
    <p><strong>6. 📂 Folder Toggle</strong>: Use the Collapse/Expand All button in the sidebar to manage your view.</p>
</div>`,
        closeHelp: 'Close Manual',
"""

# Insert into zh dictionary
content = content.replace("clickToCopy: '点击复制: '", "clickToCopy: '点击复制: '," + zh_help)
# Insert into en dictionary
content = content.replace("clickToCopy: 'Click to copy: '", "clickToCopy: 'Click to copy: '," + en_help)


# 2. Add Help Modal Method to Class
help_modal_code = """
    showHelp() {
        if (this.helpModal) {
            this.helpModal.remove();
        }
        this.helpModal = document.createElement('div');
        this.helpModal.style.position = 'absolute';
        this.helpModal.style.top = '0';
        this.helpModal.style.left = '0';
        this.helpModal.style.width = '100%';
        this.helpModal.style.height = '100%';
        this.helpModal.style.background = 'rgba(0,0,0,0.85)';
        this.helpModal.style.zIndex = '9999';
        this.helpModal.style.display = 'flex';
        this.helpModal.style.alignItems = 'center';
        this.helpModal.style.justifyContent = 'center';
        
        const box = document.createElement('div');
        box.style.background = 'var(--bg-color, #222)';
        box.style.border = '1px solid var(--border-color, #444)';
        box.style.borderRadius = '8px';
        box.style.width = '550px';
        box.style.maxWidth = '90%';
        box.style.boxShadow = '0 10px 40px rgba(0,0,0,0.8)';
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        
        const header = document.createElement('div');
        header.style.padding = '15px 20px';
        header.style.borderBottom = '1px solid #444';
        header.style.background = '#333';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        
        const title = document.createElement('h2');
        title.innerHTML = t('helpTitle');
        title.style.margin = '0';
        title.style.color = '#fff';
        title.style.fontSize = '1.2em';
        
        const closeX = document.createElement('div');
        closeX.innerHTML = '&times;';
        closeX.style.fontSize = '1.8em';
        closeX.style.cursor = 'pointer';
        closeX.style.color = '#ff4444';
        closeX.onclick = () => this.helpModal.remove();
        
        header.appendChild(title);
        header.appendChild(closeX);
        
        const body = document.createElement('div');
        body.style.padding = '20px';
        body.innerHTML = t('helpContent');
        
        const footer = document.createElement('div');
        footer.style.padding = '15px';
        footer.style.borderTop = '1px solid #444';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = t('closeHelp');
        closeBtn.style.padding = '8px 16px';
        closeBtn.style.background = '#444';
        closeBtn.style.color = '#fff';
        closeBtn.style.border = 'none';
        closeBtn.style.borderRadius = '4px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => this.helpModal.remove();
        
        footer.appendChild(closeBtn);
        
        box.appendChild(header);
        box.appendChild(body);
        box.appendChild(footer);
        this.helpModal.appendChild(box);
        
        document.getElementById('anomalous-container').appendChild(this.helpModal);
    }
"""

content = content.replace("async loadFolders() {", help_modal_code + "\n    async loadFolders() {")


# 3. Add Help Button to Header
help_btn_code = """
        const helpBtn = document.createElement('button');
        helpBtn.id = 'anomalous-help-btn';
        helpBtn.title = t('helpTitle');
        helpBtn.innerHTML = `❓ <span class="anomalous-btn-text">${t('help')}</span>`;
        helpBtn.onclick = () => this.showHelp();
"""

header_append_code = """        header.appendChild(title);
        header.appendChild(helpBtn);
        header.appendChild(apiKeyInput);"""

content = content.replace("const apiKeyInput = document.createElement('input');", help_btn_code + "\n        const apiKeyInput = document.createElement('input');")
content = content.replace("header.appendChild(title);\n        header.appendChild(apiKeyInput);", header_append_code)

# 4. Update language toggler to re-render help texts
lang_refresh = """            cleanBtn.innerHTML = `🧹 <span class="anomalous-btn-text">${t('clean')}</span>`;
            helpBtn.title = t('helpTitle');
            helpBtn.innerHTML = `❓ <span class="anomalous-btn-text">${t('help')}</span>`;"""
content = content.replace("cleanBtn.innerHTML = `🧹 <span class=\"anomalous-btn-text\">${t('clean')}</span>`;", lang_refresh)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Help feature added!")
