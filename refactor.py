import os

path = r"E:\ComfyUI_windows_portable\ComfyUI\custom_nodes\Anomalous_Model_Browser\web\main.js"
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

i18n_code = """
const i18n = {
    zh: {
        title: '📦 Anomalous 模型浏览器',
        scan: '扫描',
        scanTitle: '扫描目录',
        scanConfirm: '注意:\\n扫描过程将会自动比对 Civitai 并重命名本地模型，同时清理损坏文件。\\n确定要开始扫描吗？',
        scanning: '扫描中...',
        scanBg: '🚀 扫描后台启动！',
        scanDone: '完成',
        scanCompleteMsg: '✅ 扫描完成！\\n\\n⚠️ 提示：由于部分模型已被重命名或去重，请点击 ComfyUI 的 [Refresh] 按钮以同步最新的模型列表。',
        eco: '节能',
        autoPlay: '自动播放',
        togglePlayTitle: '切换播放模式',
        clean: '清理',
        cleanTitle: '清理重复 Info',
        cleanConfirm: '将扫描并删除所有无用的 .civitai.info 残留文件。是否继续？',
        cleaning: '清理中',
        cleanDone: '✅ 清理完毕！删除了',
        files: '个文件。',
        cleanFail: '❌ 清理失败: ',
        cleanErr: '❌ 清理出错: ',
        folders: '📂 文件夹',
        collapseAll: '➖ 收起全部',
        noModels: '此文件夹中没有找到模型。',
        noPreview: '暂无预览图',
        clickScan: '点击扫描',
        back: '⬅️ 返回网格',
        delModel: '🗑️ 删除模型及配置',
        delConfirm: '确定彻底删除',
        delConfirm2: '吗？此操作不可逆！',
        delSuccess: '✅ 删除成功！\\n',
        delNote: '\\n\\n⚠️ 提示：请务必【重启 ComfyUI 服务端】。如果不重启，继续使用可能会报错！',
        delFail: '❌ 删除失败: ',
        copyAll: '📋 复制全部',
        copied: '✅ 已复制!',
        clickToCopy: '点击复制: '
    },
    en: {
        title: '📦 Anomalous Model Browser',
        scan: 'Scan',
        scanTitle: 'Scan Folder',
        scanConfirm: 'Notice:\\nThe scan process will automatically compare with Civitai and rename your local files.\\nStart scan?',
        scanning: 'Scanning...',
        scanBg: '🚀 Scan started in background!',
        scanDone: 'Done',
        scanCompleteMsg: '✅ Scan Complete!\\n\\n⚠️ Note: Please click [Refresh] to sync the model list since files were renamed.',
        eco: 'Eco',
        autoPlay: 'AutoPlay',
        togglePlayTitle: 'Toggle Play Mode',
        clean: 'Clean Info',
        cleanTitle: 'Clean Duplicate Info',
        cleanConfirm: 'This will globally scan and delete all redundant .civitai.info files. Continue?',
        cleaning: 'Cleaning',
        cleanDone: '✅ Clean Complete! Deleted',
        files: 'files.',
        cleanFail: '❌ Failed: ',
        cleanErr: '❌ Error: ',
        folders: '📂 Folders',
        collapseAll: '➖ Collapse All',
        noModels: 'No models found in this folder.',
        noPreview: 'No preview available',
        clickScan: 'Click Scan',
        back: '⬅️ Back to grid',
        delModel: '🗑️ Delete Model & Config',
        delConfirm: 'Are you sure you want to permanently delete',
        delConfirm2: '?',
        delSuccess: '✅ Delete Complete!\\n',
        delNote: '\\n\\n⚠️ Note: Please restart the ComfyUI backend server, otherwise errors may occur!',
        delFail: '❌ Delete Failed: ',
        copyAll: '📋 Copy All',
        copied: '✅ Copied!',
        clickToCopy: 'Click to copy: '
    }
};

let currentLang = localStorage.getItem('anomalous_lang') || 'zh';
const t = (key) => i18n[currentLang][key] || key;
"""

# inject i18n dictionary at top of class
content = content.replace("class AnomalousBrowser {", "class AnomalousBrowser {\n" + i18n_code)

# Replace lang button
lang_btn = """        this.settingsArea.appendChild(apiKeyInput);
        
        const langBtn = document.createElement('button');
        langBtn.style.marginTop = '10px';
        langBtn.style.padding = '6px';
        langBtn.style.width = '100%';
        langBtn.style.background = '#444';
        langBtn.style.color = '#fff';
        langBtn.style.border = '1px solid #555';
        langBtn.style.borderRadius = '4px';
        langBtn.style.cursor = 'pointer';
        langBtn.innerHTML = currentLang === 'zh' ? '🌐 Language: EN' : '🌐 语言: 中文';
        langBtn.onclick = () => {
            currentLang = currentLang === 'zh' ? 'en' : 'zh';
            localStorage.setItem('anomalous_lang', currentLang);
            langBtn.innerHTML = currentLang === 'zh' ? '🌐 Language: EN' : '🌐 语言: 中文';
            // re-render UI
            title.innerHTML = t('title');
            scanBtn.title = t('scanTitle');
            scanBtn.innerHTML = `🔄 <span class="anomalous-btn-text">${t('scan')}</span>`;
            cleanBtn.title = t('cleanTitle');
            cleanBtn.innerHTML = `🧹 <span class="anomalous-btn-text">${t('clean')}</span>`;
            renderEnergyBtn();
            this.renderSidebar();
            this.loadModels();
            if (this.detailPanel.style.display !== 'none' && this.currentDetailModel) {
                this.showDetail(this.currentDetailModel);
            }
        };
        this.settingsArea.appendChild(langBtn);"""

content = content.replace("this.settingsArea.appendChild(apiKeyInput);", lang_btn)

# replace instances
content = content.replace("title.innerHTML = '📦 Anomalous Model Browser';", "title.innerHTML = t('title');")
content = content.replace("scanBtn.title = '扫描目录 (Scan Folder)';", "scanBtn.title = t('scanTitle');")
content = content.replace("scanBtn.innerHTML = '🔄 <span class=\"anomalous-btn-text\">扫描 (Scan)</span>';", "scanBtn.innerHTML = `🔄 <span class=\"anomalous-btn-text\">${t('scan')}</span>`;")
content = content.replace("if (!confirm(`注意 (Notice):\\n扫描过程将会自动比对 Civitai 并重命名本地模型，同时清理损坏文件。\\n确定要开始扫描吗？\\n(The scan process will automatically compare with Civitai and rename your local files. Start?)`)) return;", "if (!confirm(t('scanConfirm'))) return;")
content = content.replace("scanBtn.innerHTML = '⏳ 扫描中 (Scanning...)';", "scanBtn.innerHTML = `⏳ <span class=\"anomalous-btn-text\">${t('scanning')}</span>`;")
content = content.replace("alert('🚀 扫描后台启动！(Scan started in background!)');", "alert(t('scanBg'));")
content = content.replace("scanBtn.innerHTML = '✅ <span class=\"anomalous-btn-text\">完成 (Done)</span>';", "scanBtn.innerHTML = `✅ <span class=\"anomalous-btn-text\">${t('scanDone')}</span>`;")
content = content.replace("alert('✅ 扫描完成！(Scan Complete!)\\n\\n⚠️ 提示 (Note)：由于部分模型已被重命名或去重，请点击 ComfyUI 的 [Refresh] 按钮以同步最新的模型列表。(Please click [Refresh] to sync the model list since files were renamed.)');", "alert(t('scanCompleteMsg'));")
content = content.replace("setTimeout(() => { scanBtn.innerHTML = '🔄 <span class=\"anomalous-btn-text\">扫描 (Scan)</span>';", "setTimeout(() => { scanBtn.innerHTML = `🔄 <span class=\"anomalous-btn-text\">${t('scan')}</span>`;")

content = content.replace("energyBtn.title = '切换播放模式 (Toggle Play Mode)';", "energyBtn.title = t('togglePlayTitle');")
content = content.replace("? '🔋 <span class=\"anomalous-btn-text\">节能 (Eco)</span>'", "? `🔋 <span class=\"anomalous-btn-text\">${t('eco')}</span>`")
content = content.replace(": '🎬 <span class=\"anomalous-btn-text\">自动播放 (AutoPlay)</span>';", ": `🎬 <span class=\"anomalous-btn-text\">${t('autoPlay')}</span>`;")

content = content.replace("cleanBtn.title = '清理重复 Info (Clean Duplicate Info)';", "cleanBtn.title = t('cleanTitle');")
content = content.replace("cleanBtn.innerHTML = '🧹 <span class=\"anomalous-btn-text\">清理 (Clean Info)</span>';", "cleanBtn.innerHTML = `🧹 <span class=\"anomalous-btn-text\">${t('clean')}</span>`;")
content = content.replace("if (!confirm(`将扫描并删除所有无用的 .civitai.info 残留文件。是否继续？\\n(This will globally scan and delete all redundant .civitai.info files. Continue?)`)) return;", "if (!confirm(t('cleanConfirm'))) return;")
content = content.replace("cleanBtn.innerHTML = '⏳ <span class=\"anomalous-btn-text\">(Cleaning)</span>';", "cleanBtn.innerHTML = `⏳ <span class=\"anomalous-btn-text\">${t('cleaning')}</span>`;")
content = content.replace("alert(`✅ 清理完毕 (Clean Complete)！删除了 (Deleted) ${data.count} 个文件 (files).`);", "alert(`${t('cleanDone')} ${data.count} ${t('files')}`);")
content = content.replace("alert('❌ 清理失败 (Failed): ' + data.message);", "alert(t('cleanFail') + data.message);")
content = content.replace("alert('❌ 清理出错 (Error): ' + e.message);", "alert(t('cleanErr') + e.message);")

content = content.replace("title.innerHTML = '📂 文件夹 (Folders)';", "title.innerHTML = t('folders');")
content = content.replace("collapseAllBtn.innerHTML = '➖ 收起全部 (Collapse All)';", "collapseAllBtn.innerHTML = t('collapseAll');")

content = content.replace("'<div style=\"color:white; padding:20px;\">此文件夹中没有找到模型。(No models found in this folder.)</div>'", "`<div style=\"color:white; padding:20px;\">${t('noModels')}</div>`")
content = content.replace("'<div style=\"text-align:center;color:#666;margin-top:80px;\">无预览 (No Preview)</div><div style=\"font-size:0.8em;text-align:center;opacity:0.5;margin-top:5px\">点击扫描 (Click Scan)</div>'", "`<div style=\"text-align:center;color:#666;margin-top:80px;\">${t('noPreview')}</div><div style=\"font-size:0.8em;text-align:center;opacity:0.5;margin-top:5px\">${t('clickScan')}</div>`")

content = content.replace("card.onclick = () => this.showDetail(model);", "card.onclick = () => { this.currentDetailModel = model; this.showDetail(model); };")

content = content.replace("backBtn.innerHTML = '⬅️ 返回网格 (Back)';", "backBtn.innerHTML = t('back');")
content = content.replace("delBtn.innerHTML = '🗑️ 删除模型及配置 (Delete Model & Config)';", "delBtn.innerHTML = t('delModel');")

content = content.replace("if (!confirm(`确定彻底删除 ${model.filename} 吗？此操作不可逆！\\n(Are you sure you want to permanently delete this model?)`)) return;", "if (!confirm(`${t('delConfirm')} ${model.filename} ${t('delConfirm2')}`)) return;")
content = content.replace("alert('✅ 删除成功 (Delete Complete)！\\n' + data.deleted.join('\\n') + '\\n\\n⚠️ 提示 (Note)：请务必【重启 ComfyUI 服务端】。如果不重启，继续使用可能会报错！\\n(Please restart the ComfyUI backend server, otherwise errors may occur!)');", "alert(t('delSuccess') + data.deleted.join('\\n') + t('delNote'));")
content = content.replace("alert('❌ 删除失败 (Delete Failed): ' + data.message);", "alert(t('delFail') + data.message);")
content = content.replace("alert('❌ 删除失败 (Delete Failed): ' + e.message);", "alert(t('delFail') + e.message);")

content = content.replace("leftPanel.innerHTML = '<div style=\"color:#aaa; text-align:center; margin-top:50px;\">暂无预览图 (No preview available)</div>';", "leftPanel.innerHTML = `<div style=\"color:#aaa; text-align:center; margin-top:50px;\">${t('noPreview')}</div>`;")

content = content.replace("copyAll.innerText = '📋 复制全部 (Copy All)';", "copyAll.innerText = t('copyAll');")
content = content.replace("copyAll.innerText = '✅ 已复制! (Copied!)';", "copyAll.innerText = t('copied');")

content = content.replace("tag.title = '点击复制 (Click to copy): ' + w;", "tag.title = t('clickToCopy') + w;")


with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Done!")
