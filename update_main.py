import os

path = r'E:\ComfyUI_windows_portable\ComfyUI\custom_nodes\Anomalous_Model_Browser\web\main.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update delConfirm2
content = content.replace("delConfirm2: '吗？此操作不可逆！',", "delConfirm2: '及其所有关联配置、预览图和缓存文件吗？此操作不可逆！',")
content = content.replace("delConfirm2: '?',", "delConfirm2: ' and all its associated configs, previews, and cache files? This action is irreversible!',")

# 2. Update helpContent (zh)
zh_help_old = '''    <p><strong>6. 📂 目录折叠</strong>: 点击左侧边栏的“收起/展开全部”快速管理网格视图。</p>
</div>'''
zh_help_new = '''    <p><strong>6. 📂 目录折叠</strong>: 点击左侧边栏的“收起/展开全部”快速管理网格视图。</p>
    <p><strong>7. 🔗 兼容模型匹配</strong>: 点开大模型或 Lora 详细页，系统将自动基于 Base Model 架构，双向匹配并展示关联模型。</p>
    <p><strong>8. ➕ 一键投放节点</strong>: 在网格卡片右上角或详细页顶部，点击【➕】按钮，可将当前模型节点直接贴在鼠标上，并无缝插入工作流画布！</p>
</div>'''
content = content.replace(zh_help_old, zh_help_new)

# Update helpContent (en)
en_help_old = '''    <p><strong>6. 📂 Folders</strong>: Click collapse/expand all on sidebar.</p>
</div>'''
en_help_new = '''    <p><strong>6. 📂 Folders</strong>: Click collapse/expand all on sidebar.</p>
    <p><strong>7. 🔗 Compatible Models</strong>: Open model details to automatically see matching models based on Base Model architecture.</p>
    <p><strong>8. ➕ One-click Apply</strong>: Click the 【➕】 button on grid cards or details to stick the model node to your mouse and apply it seamlessly to the canvas!</p>
</div>'''
content = content.replace(en_help_old, en_help_new)

# 3. Update scan polling logic
old_scan_logic = '''                if (!data.scanning) {
                    clearInterval(this.scanInterval);
                    this.scanInterval = null;
                    alert(t('scanCompleteMsg'));
                    this.loadModels();
                }'''
new_scan_logic = '''                if (!data.scanning) {
                    clearInterval(this.scanInterval);
                    this.scanInterval = null;
                    let msg = t('scanCompleteMsg');
                    if (data.result) {
                        msg = `✅ 扫描结束！\\n成功处理：${data.result.success} 个\\n处理失败：${data.result.fail} 个\\n\\n⚠️ 提示：请点击 ComfyUI 的 [Refresh] 按钮以同步，若有模型未生效，请【重启 ComfyUI 服务端】。`;
                        if (document.documentElement.lang !== 'zh') {
                            msg = `✅ Scan Complete!\\nSuccess: ${data.result.success}\\nFailed: ${data.result.fail}\\n\\n⚠️ Tip: Click [Refresh] in ComfyUI, or RESTART the ComfyUI backend if models don't appear.`;
                        }
                    } else {
                        // fallback message with restart reminder
                        msg = msg.replace('[Refresh] 按钮以同步最新的模型列表。', '[Refresh] 按钮以同步，若有模型未生效，请【重启 ComfyUI 服务端】。');
                    }
                    alert(msg);
                    this.loadModels();
                }'''

if old_scan_logic in content:
    content = content.replace(old_scan_logic, new_scan_logic)
else:
    print('Failed to find scan polling logic')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Updated main.js')
