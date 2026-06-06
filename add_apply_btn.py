import os

path = r"E:\ComfyUI_windows_portable\ComfyUI\custom_nodes\Anomalous_Model_Browser\web\main.js"
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. i18n
if "applyToCanvas:" not in content:
    content = content.replace("backToPrev: '🔙 返回上一层',", "backToPrev: '🔙 返回上一层',\n        applyToCanvas: '🚀 投放至画布',\n        applySuccess: '✅ 已添加至工作流',")
    content = content.replace("backToPrev: '🔙 Back to prev',", "backToPrev: '🔙 Back to prev',\n        applyToCanvas: '🚀 Apply to Canvas',\n        applySuccess: '✅ Added to workflow',")

# 2. applyModelToCanvas function
func_logic = """
    applyModelToCanvas(type, subfolder, model) {
        const nodeTypeMap = {
            'checkpoints': 'CheckpointLoaderSimple',
            'loras': 'LoraLoader',
            'unet': 'UNETLoader',
            'diffusion_models': 'UNETLoader'
        };
        const nodeType = nodeTypeMap[type];
        if (!nodeType) {
            alert('Unsupported model type for auto-apply.');
            return;
        }

        const node = LiteGraph.createNode(nodeType);
        if (!node) {
            alert('Failed to create node: ' + nodeType);
            return;
        }

        if (app.canvas && app.canvas.graph_mouse) {
            node.pos = [
                app.canvas.graph_mouse[0] || (window.innerWidth / 2),
                app.canvas.graph_mouse[1] || (window.innerHeight / 2)
            ];
        } else {
            node.pos = [ window.innerWidth / 2, window.innerHeight / 2 ];
        }
        
        app.graph.add(node);

        const sub = subfolder.replace(/^\\/+/, '').replace(/\\/+$/, '');
        const relPath = sub ? `${sub}/${model.filename}` : model.filename;

        if (node.widgets) {
            // First try to find a combo widget (dropdown)
            const combo = node.widgets.find(w => w.type === 'combo');
            if (combo) {
                combo.value = relPath;
            } else if (node.widgets.length > 0) {
                // fallback to first widget
                node.widgets[0].value = relPath;
            }
        }

        this.close();
        if (app.canvas) {
            app.canvas.setDirty(true, true);
        }
    }
"""

if "applyModelToCanvas" not in content:
    content = content.replace("showDetail(model) {", func_logic + "\n    showDetail(model) {")

# 3. Add to grid cards (inside loadModels loop)
grid_btn_logic = """
                const applyBtn = document.createElement('button');
                applyBtn.innerHTML = '🚀';
                applyBtn.title = t('applyToCanvas');
                applyBtn.style.position = 'absolute';
                applyBtn.style.top = '6px';
                applyBtn.style.right = '6px';
                applyBtn.style.background = 'rgba(0,0,0,0.7)';
                applyBtn.style.color = '#fff';
                applyBtn.style.border = '1px solid rgba(255,255,255,0.2)';
                applyBtn.style.borderRadius = '4px';
                applyBtn.style.cursor = 'pointer';
                applyBtn.style.padding = '4px 6px';
                applyBtn.style.zIndex = '20';
                applyBtn.style.fontSize = '1em';
                applyBtn.style.display = 'none';
                
                card.addEventListener('mouseenter', () => applyBtn.style.display = 'block');
                card.addEventListener('mouseleave', () => applyBtn.style.display = 'none');
                
                applyBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.applyModelToCanvas(this.currentType, this.currentSubfolder, model);
                };
                card.appendChild(applyBtn);
"""

if "applyBtn.innerHTML = '🚀';" not in content:
    content = content.replace("card.onclick = () => { this.historyStack = []; this.currentDetailModel = model; this.showDetail(model); };", "card.onclick = () => { this.historyStack = []; this.currentDetailModel = model; this.showDetail(model); };\n" + grid_btn_logic)


# 4. Add to detail page header
detail_btn_logic = """
        const applyDetailBtn = document.createElement('button');
        applyDetailBtn.innerHTML = '🚀 ' + t('applyToCanvas');
        applyDetailBtn.style.padding = '6px 12px';
        applyDetailBtn.style.background = '#28a745';
        applyDetailBtn.style.color = '#fff';
        applyDetailBtn.style.border = 'none';
        applyDetailBtn.style.borderRadius = '4px';
        applyDetailBtn.style.cursor = 'pointer';
        applyDetailBtn.style.marginLeft = '10px';
        applyDetailBtn.style.fontWeight = 'bold';
        applyDetailBtn.onclick = () => {
            this.applyModelToCanvas(this.currentType, this.currentSubfolder, model);
        };
        header.appendChild(applyDetailBtn);
"""

if "applyDetailBtn.innerHTML" not in content:
    content = content.replace("header.appendChild(jumpBtn);", "header.appendChild(jumpBtn);\n" + detail_btn_logic)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated main.js successfully.")
