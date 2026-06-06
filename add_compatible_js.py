import os

path = r"E:\ComfyUI_windows_portable\ComfyUI\custom_nodes\Anomalous_Model_Browser\web\main.js"
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add historyStack to constructor
if "this.historyStack = [];" not in content:
    content = content.replace("this.expandedFolders = new Set();", "this.expandedFolders = new Set();\n        this.historyStack = [];")

# 2. Add i18n keys
if "compatibleModels:" not in content:
    # zh
    content = content.replace("clickToCopy: '点击复制: ',", "clickToCopy: '点击复制: ',\n        compatibleModels: '🔗 兼容模型',\n        loadingCompatible: '加载中...',\n        backToPrev: '🔙 返回上一层',")
    # en
    content = content.replace("clickToCopy: 'Click to copy: ',", "clickToCopy: 'Click to copy: ',\n        compatibleModels: '🔗 Compatible Models',\n        loadingCompatible: 'Loading...',\n        backToPrev: '🔙 Back to prev',")

# 3. Update backBtn logic and name
back_btn_logic = """
        const backBtn = document.createElement('button');
        backBtn.innerHTML = this.historyStack.length > 0 ? t('backToPrev') : t('back');
        backBtn.style.padding = '6px 12px';
        backBtn.style.background = '#444';
        backBtn.style.color = '#fff';
        backBtn.style.border = 'none';
        backBtn.style.borderRadius = '4px';
        backBtn.style.cursor = 'pointer';
        backBtn.onclick = () => {
            if (this.historyStack.length > 0) {
                const prev = this.historyStack.pop();
                this.currentType = prev.type;
                this.currentPathIdx = prev.pathIdx;
                this.currentSubfolder = prev.subfolder;
                this.currentDetailModel = prev.model;
                this.renderSidebar();
                this.showDetail(prev.model);
            } else {
                this.detailPanel.style.display = 'none';
                this.detailPanel.innerHTML = '';
                this.grid.style.display = 'grid';
            }
        };
"""
# Need to replace the old backBtn creation
old_backBtn = """        const backBtn = document.createElement('button');
        backBtn.innerHTML = t('back');
        backBtn.style.padding = '6px 12px';
        backBtn.style.background = '#444';
        backBtn.style.color = '#fff';
        backBtn.style.border = 'none';
        backBtn.style.borderRadius = '4px';
        backBtn.style.cursor = 'pointer';
        backBtn.onclick = () => {
            this.detailPanel.style.display = 'none';
            this.detailPanel.innerHTML = '';
            this.grid.style.display = 'grid';
        };"""

if old_backBtn in content:
    content = content.replace(old_backBtn, back_btn_logic.strip())

# 4. Clear history when a card from grid is clicked
old_card_onclick = "card.onclick = () => { this.currentDetailModel = model; this.showDetail(model); };"
new_card_onclick = "card.onclick = () => { this.historyStack = []; this.currentDetailModel = model; this.showDetail(model); };"
if old_card_onclick in content:
    content = content.replace(old_card_onclick, new_card_onclick)

# 5. Append Compatible Models Section to Right Panel in showDetail
# We need to find where rightPanel is populated. 
# It usually ends with rightPanel.appendChild(...) then splitContainer.appendChild(rightPanel).
compatible_logic = """
        // --- Compatible Models Section ---
        if (model.metadata && model.metadata.baseModel) {
            const compSec = document.createElement('div');
            compSec.className = 'anomalous-compatible-section';
            
            const compTitle = document.createElement('div');
            compTitle.className = 'anomalous-compatible-title';
            compTitle.innerHTML = `${t('compatibleModels')} <span style="font-size:0.8em; opacity:0.6;">(${model.metadata.baseModel})</span>`;
            
            const compList = document.createElement('div');
            compList.className = 'anomalous-compatible-list';
            compList.innerHTML = `<span style="color:#888;">${t('loadingCompatible')}</span>`;
            
            compSec.appendChild(compTitle);
            compSec.appendChild(compList);
            rightPanel.appendChild(compSec);
            
            // Async fetch
            const targetType = this.currentType === 'loras' ? 'checkpoints' : 'loras';
            fetch(`/anomalous/compatible_models?base_model=${encodeURIComponent(model.metadata.baseModel)}&target_type=${encodeURIComponent(targetType)}`)
                .then(r => r.json())
                .then(d => {
                    compList.innerHTML = '';
                    if (!d.models || d.models.length === 0) {
                        compList.innerHTML = `<span style="color:#888;">No compatible ${targetType} found.</span>`;
                        return;
                    }
                    d.models.forEach(m => {
                        const mItem = document.createElement('div');
                        mItem.className = 'anomalous-compatible-item';
                        mItem.title = m.filename;
                        
                        let thumb = '';
                        if (m.preview_url) {
                            const isVid = m.preview_url.toLowerCase().endsWith('.mp4') || m.preview_url.toLowerCase().endsWith('.webm');
                            if (isVid) thumb = `<video src="${m.preview_url}" muted loop playsinline autoplay></video>`;
                            else thumb = `<img src="${m.preview_url}" />`;
                        } else {
                            thumb = `<div style="width:30px; height:30px; background:#222; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#555;">?</div>`;
                        }
                        
                        mItem.innerHTML = `${thumb}<div class="anomalous-compatible-item-name">${m.filename}</div>`;
                        
                        mItem.onclick = () => {
                            // Push current to history
                            this.historyStack.push({
                                type: this.currentType,
                                pathIdx: this.currentPathIdx,
                                subfolder: this.currentSubfolder,
                                model: this.currentDetailModel
                            });
                            
                            // Jump
                            this.currentType = m.type;
                            this.currentPathIdx = m.path_idx;
                            this.currentSubfolder = m.subfolder;
                            this.currentDetailModel = m;
                            
                            this.renderSidebar();
                            this.showDetail(m);
                        };
                        
                        compList.appendChild(mItem);
                    });
                })
                .catch(e => {
                    compList.innerHTML = `<span style="color:#ff4444;">Failed to load.</span>`;
                });
        }
        // ---------------------------------
"""

# I will find "rightPanel.appendChild(infoContainer);" which is usually near the end of showDetail, and insert compatible_logic after it.
if "rightPanel.appendChild(infoContainer);" in content:
    content = content.replace("rightPanel.appendChild(infoContainer);", "rightPanel.appendChild(infoContainer);\n" + compatible_logic)


with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated main.js successfully.")
