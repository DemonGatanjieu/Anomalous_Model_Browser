import os

path = r"E:\ComfyUI_windows_portable\ComfyUI\custom_nodes\Anomalous_Model_Browser\web\main.js"
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Change i18n
content = content.replace("applyToCanvas: '🚀 投放至画布',", "applyToCanvas: '➕ 插入节点',")
content = content.replace("applyToCanvas: '🚀 Apply to Canvas',", "applyToCanvas: '➕ Add Node',")

# Change icons
content = content.replace("applyBtn.innerHTML = '🚀';", "applyBtn.innerHTML = '➕';")
content = content.replace("applyDetailBtn.innerHTML = '🚀 ' + t('applyToCanvas');", "applyDetailBtn.innerHTML = t('applyToCanvas');")

# Change the logic in applyModelToCanvas
stick_logic = """
        this.close();

        // 粘到鼠标上的逻辑
        let isSticking = true;
        const stickHandler = (e) => {
            if (!isSticking || !app.canvas) return;
            const canvas = app.canvas;
            
            const rect = canvas.canvas.getBoundingClientRect();
            const scale = canvas.ds.scale;
            const offsetX = canvas.ds.offset[0];
            const offsetY = canvas.ds.offset[1];
            
            const canvasX = (e.clientX - rect.left - offsetX) / scale;
            const canvasY = (e.clientY - rect.top - offsetY) / scale;
            
            node.pos = [canvasX - node.size[0] / 2, canvasY - 10];
            canvas.setDirty(true, true);
        };
        const dropHandler = (e) => {
            isSticking = false;
            window.removeEventListener('mousemove', stickHandler);
            window.removeEventListener('mousedown', dropHandler);
        };
        window.addEventListener('mousemove', stickHandler);
        setTimeout(() => {
            window.addEventListener('mousedown', dropHandler);
        }, 100);
"""

old_logic = """        this.close();
        if (app.canvas) {
            app.canvas.setDirty(true, true);
        }"""

if old_logic in content:
    content = content.replace(old_logic, stick_logic.strip())
else:
    print('Failed to find old logic for sticking')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Updated stick logic and buttons')
