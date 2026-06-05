import { app } from "../../scripts/app.js";

const i18n = {
    zh: {
        title: '📦 Anomalous 模型浏览器',
        scan: '扫描',
        scanTitle: '扫描目录',
        scanConfirm: '注意:\n扫描过程将会自动比对 Civitai 并重命名本地模型，同时清理损坏文件。\n确定要开始扫描吗？',
        scanning: '扫描中...',
        scanBg: '🚀 扫描后台启动！',
        scanDone: '完成',
        scanCompleteMsg: '✅ 扫描完成！\n\n⚠️ 提示：由于部分模型已被重命名或去重，请点击 ComfyUI 的 [Refresh] 按钮以同步最新的模型列表。',
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
        expandAll: '➕ 展开全部',
        noModels: '此文件夹中没有找到模型。',
        noPreview: '暂无预览图',
        clickScan: '点击扫描',
        back: '⬅️ 返回网格',
        delModel: '🗑️ 删除模型及配置',
        delConfirm: '确定彻底删除',
        delConfirm2: '吗？此操作不可逆！',
        delSuccess: '✅ 删除成功！\n',
        delNote: '\n\n⚠️ 提示：请务必【重启 ComfyUI 服务端】。如果不重启，继续使用可能会报错！',
        delFail: '❌ 删除失败: ',
        copyAll: '📋 复制全部',
        copied: '✅ 已复制!',
        clickToCopy: '点击复制: ',
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

    },
    en: {
        title: '📦 Anomalous Model Browser',
        scan: 'Scan',
        scanTitle: 'Scan Folder',
        scanConfirm: 'Notice:\nThe scan process will automatically compare with Civitai and rename your local files.\nStart scan?',
        scanning: 'Scanning...',
        scanBg: '🚀 Scan started in background!',
        scanDone: 'Done',
        scanCompleteMsg: '✅ Scan Complete!\n\n⚠️ Note: Please click [Refresh] to sync the model list since files were renamed.',
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
        expandAll: '➕ Expand All',
        noModels: 'No models found in this folder.',
        noPreview: 'No preview available',
        clickScan: 'Click Scan',
        back: '⬅️ Back to grid',
        delModel: '🗑️ Delete Model & Config',
        delConfirm: 'Are you sure you want to permanently delete',
        delConfirm2: '?',
        delSuccess: '✅ Delete Complete!\n',
        delNote: '\n\n⚠️ Note: Please restart the ComfyUI backend server, otherwise errors may occur!',
        delFail: '❌ Delete Failed: ',
        copyAll: '📋 Copy All',
        copied: '✅ Copied!',
        clickToCopy: 'Click to copy: ',
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

    }
};

let currentLang = localStorage.getItem('anomalous_lang') || 'zh';
const t = (key) => i18n[currentLang][key] || key;

class AnomalousBrowser {
    constructor() {
        this.modal = null;
        this.sidebar = null;
        this.grid = null;
        this.detailPanel = null;
        this.currentType = 'loras';
        this.currentPathIdx = 0;
        this.currentSubfolder = '/';
        this.foldersData = null;
        this.expandedFolders = new Set(['/', 'checkpoints', 'loras', 'unet', 'diffusion_models']);
        this.energySaving = localStorage.getItem('anomalous_energy_saving') === 'true';
        this.createDOM();
    }

    createDOM() {
        this.modal = document.createElement('div');
        this.modal.id = 'anomalous-modal';
        this.modal.onclick = (e) => { if (e.target === this.modal) this.close(); };

        const container = document.createElement('div');
        container.id = 'anomalous-container';
        
        const updateLangClass = () => {
            if (currentLang === 'en') container.classList.add('anomalous-lang-en');
            else container.classList.remove('anomalous-lang-en');
        };
        updateLangClass();

        // Sidebar
        this.sidebarWrapper = document.createElement('div');
        this.sidebarWrapper.id = 'anomalous-sidebar-wrapper';

        this.sidebar = document.createElement('div');
        this.sidebar.id = 'anomalous-sidebar';
        
        this.settingsArea = document.createElement('div');
        this.settingsArea.id = 'anomalous-settings';
        
        // API key moved to header
        
        const langBtn = document.createElement('button');
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
            updateLangClass();
            title.innerHTML = t('title');
            scanBtn.title = t('scanTitle');
            scanBtn.innerHTML = `🔄 <span class="anomalous-btn-text">${t('scan')}</span>`;
            cleanBtn.title = t('cleanTitle');
                        cleanBtn.innerHTML = `🧹 <span class="anomalous-btn-text">${t('clean')}</span>`;
            helpBtn.title = t('helpTitle');
            helpBtn.innerHTML = `❓ <span class="anomalous-btn-text">${t('help')}</span>`;
            renderEnergyBtn();
            this.renderSidebar();
            this.loadModels();
            if (this.detailPanel.style.display !== 'none' && this.currentDetailModel) {
                this.showDetail(this.currentDetailModel);
            }
        };
        this.settingsArea.appendChild(langBtn);
        this.sidebarWrapper.appendChild(this.sidebar);
        this.sidebarWrapper.appendChild(this.settingsArea);

        // Content Area
        const content = document.createElement('div');
        content.id = 'anomalous-content';

        const header = document.createElement('div');
        header.id = 'anomalous-header';
        
        const title = document.createElement('div');
        title.id = 'anomalous-title';
        title.innerHTML = t('title');
        
        
        const helpBtn = document.createElement('button');
        helpBtn.id = 'anomalous-help-btn';
        helpBtn.title = t('helpTitle');
        helpBtn.innerHTML = `❓ <span class="anomalous-btn-text">${t('help')}</span>`;
        helpBtn.onclick = () => this.showHelp();

        const apiKeyInput = document.createElement('input');
        apiKeyInput.id = 'anomalous-api-key';
        apiKeyInput.placeholder = '🔑 API Key';
        apiKeyInput.title = '输入 Civitai API Key / Enter Civitai API Key';
        apiKeyInput.type = 'password';
        apiKeyInput.value = localStorage.getItem('anomalous_api_key') || '';
        apiKeyInput.onchange = async () => {
            localStorage.setItem('anomalous_api_key', apiKeyInput.value);
            try {
                await fetch('/anomalous/save_config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: apiKeyInput.value })
                });
            } catch(e) {}
        };
        fetch('/anomalous/config').then(r=>r.json()).then(d=>{
            if (d.has_api_key) apiKeyInput.placeholder = 'API Key Saved';
        }).catch(()=>{});
        
        const scanBtn = document.createElement('button');
        scanBtn.id = 'anomalous-scan-btn';
        scanBtn.title = t('scanTitle');
        scanBtn.innerHTML = `🔄 <span class="anomalous-btn-text">${t('scan')}</span>`;
        scanBtn.onclick = async () => {
            if (!confirm(t('scanConfirm'))) return;
            scanBtn.innerHTML = `⏳ <span class="anomalous-btn-text">${t('scanning')}</span>`;
            scanBtn.disabled = true;
            try {
                const params = new URLSearchParams({ type: this.currentType, path_idx: this.currentPathIdx, subfolder: this.currentSubfolder });
                const res = await fetch('/anomalous/scan?' + params.toString(), {method: 'POST'});
                const data = await res.json();
                if (data.status === 'ok') {
                    alert(t('scanBg'));
                    const poll = setInterval(async () => {
                        try {
                            const sr = await fetch('/anomalous/scan_status?' + params.toString());
                            const sd = await sr.json();
                            if (!sd.scanning) {
                                clearInterval(poll);
                                scanBtn.innerHTML = `✅ <span class="anomalous-btn-text">${t('scanDone')}</span>`;
                                alert(t('scanCompleteMsg'));
                                this.loadModels();
                                setTimeout(() => { scanBtn.innerHTML = `🔄 <span class="anomalous-btn-text">${t('scan')}</span>`; scanBtn.disabled = false; }, 2000);
                            }
                        } catch(e) { clearInterval(poll); scanBtn.disabled = false; }
                    }, 3000);
                } else {
                    scanBtn.disabled = false;
                }
            } catch (e) { scanBtn.disabled = false; }
        };

        const energyBtn = document.createElement('button');
        energyBtn.id = 'anomalous-energy-btn';
        energyBtn.title = t('togglePlayTitle');
        const renderEnergyBtn = () => {
            energyBtn.innerHTML = this.energySaving 
                ? `🔋 <span class="anomalous-btn-text">${t('eco')}</span>` 
                : `🎬 <span class="anomalous-btn-text">${t('autoPlay')}</span>`;
        };
        renderEnergyBtn();
        energyBtn.onclick = () => {
            this.energySaving = !this.energySaving;
            localStorage.setItem('anomalous_energy_saving', this.energySaving);
            renderEnergyBtn();
            this.loadModels();
        };

        const closeBtn = document.createElement('div');
        closeBtn.id = 'anomalous-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => this.close();

        const cleanBtn = document.createElement('button');
        cleanBtn.id = 'anomalous-clean-btn';
        cleanBtn.title = t('cleanTitle');
                    cleanBtn.innerHTML = `🧹 <span class="anomalous-btn-text">${t('clean')}</span>`;
            helpBtn.title = t('helpTitle');
            helpBtn.innerHTML = `❓ <span class="anomalous-btn-text">${t('help')}</span>`;
        cleanBtn.onclick = async () => {
            if (!confirm(t('cleanConfirm'))) return;
            cleanBtn.innerHTML = `⏳ <span class="anomalous-btn-text">${t('cleaning')}</span>`;
            cleanBtn.disabled = true;
            try {
                const res = await fetch('/anomalous/clean_civitai_info', {method: 'POST'});
                const data = await res.json();
                if (data.status === 'success') {
                    alert(`${t('cleanDone')} ${data.count} ${t('files')}`);
                } else {
                    alert(t('cleanFail') + data.message);
                }
            } catch (e) { alert(t('cleanErr') + e.message); }
                        cleanBtn.innerHTML = `🧹 <span class="anomalous-btn-text">${t('clean')}</span>`;
            helpBtn.title = t('helpTitle');
            helpBtn.innerHTML = `❓ <span class="anomalous-btn-text">${t('help')}</span>`;
            cleanBtn.disabled = false;
        };

                header.appendChild(title);
        header.appendChild(helpBtn);
        header.appendChild(apiKeyInput);
        header.appendChild(cleanBtn);
        header.appendChild(scanBtn);
        header.appendChild(energyBtn);
        header.appendChild(closeBtn);

        this.grid = document.createElement('div');
        this.grid.id = 'anomalous-grid';
        
        this.detailPanel = document.createElement('div');
        this.detailPanel.id = 'anomalous-detail';
        this.detailPanel.style.display = 'none';

        content.appendChild(header);
        content.appendChild(this.grid);
        content.appendChild(this.detailPanel);

        container.appendChild(this.sidebarWrapper);
        container.appendChild(content);

        this.modal.appendChild(container);
        document.body.appendChild(this.modal);
    }

    
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

    async loadFolders() {
        try {
            const res = await fetch('/anomalous/folders');
            const data = await res.json();
            this.foldersData = data.folders || {};
            
            // Auto expand all
            (this.foldersData || []).forEach(typeGroup => {
                this.expandedFolders.add(typeGroup.type);
                Object.keys(typeGroup.folders).forEach(path => {
                    this.expandedFolders.add(typeGroup.type + path);
                });
            });
            
            this.renderSidebar();
            this.loadModels();
        } catch(e) {}
    }

    renderSidebar() {
        this.sidebar.innerHTML = '';
        
        const topBar = document.createElement('div');
        topBar.style.display = 'flex';
        topBar.style.justifyContent = 'space-between';
        topBar.style.alignItems = 'center';
        topBar.style.padding = '15px';
        
        const title = document.createElement('h3');
        title.innerHTML = t('folders');
        title.style.color = '#fff';
        title.style.margin = '0';
        
        const isAllCollapsed = this.expandedFolders.size === 0;
        const collapseAllBtn = document.createElement('button');
        collapseAllBtn.innerHTML = isAllCollapsed ? t('expandAll') : t('collapseAll');
        collapseAllBtn.style.padding = '4px 8px';
        collapseAllBtn.style.background = '#444';
        collapseAllBtn.style.color = '#fff';
        collapseAllBtn.style.border = 'none';
        collapseAllBtn.style.borderRadius = '4px';
        collapseAllBtn.style.cursor = 'pointer';
        collapseAllBtn.onclick = () => {
            if (isAllCollapsed) {
                (this.foldersData || []).forEach(typeGroup => {
                    this.expandedFolders.add(typeGroup.type);
                    Object.keys(typeGroup.folders).forEach(path => {
                        this.expandedFolders.add(typeGroup.type + path);
                    });
                });
            } else {
                this.expandedFolders.clear();
            }
            this.renderSidebar();
        };
        
        topBar.appendChild(title);
        topBar.appendChild(collapseAllBtn);
        this.sidebar.appendChild(topBar);

        (this.foldersData || []).forEach(typeGroup => {
            const header = document.createElement('div');
            header.className = 'anomalous-type-header';
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.cursor = 'pointer';
            
            const isTypeExpanded = this.expandedFolders.has(typeGroup.type);
            header.innerHTML = `<span>${typeGroup.label}</span> <span>${isTypeExpanded ? '▼' : '▶'}</span>`;
            
            header.onclick = () => {
                if (isTypeExpanded) this.expandedFolders.delete(typeGroup.type);
                else this.expandedFolders.add(typeGroup.type);
                this.renderSidebar();
            };
            this.sidebar.appendChild(header);

            if (!isTypeExpanded) return;

            const sortedPaths = Object.keys(typeGroup.folders).sort();

            sortedPaths.forEach(path => {
                const info = typeGroup.folders[path];
                const parts = path.split('/').filter(p => p);
                const parentPath = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : '/';
                
                if (path !== '/' && parentPath !== '/') {
                    let parentId = typeGroup.type + parentPath;
                    if (!this.expandedFolders.has(parentId)) return; 
                }

                const hasChildren = sortedPaths.some(p => p !== path && p.startsWith(path === '/' ? '/' : path + '/'));

                const item = document.createElement('div');
                item.className = 'anomalous-folder-item';
                
                const depth = path === '/' ? 0 : parts.length;
                item.style.paddingLeft = (15 + depth * 15) + 'px';
                
                const myId = typeGroup.type + path;
                const isExpanded = this.expandedFolders.has(myId);
                
                let toggleIcon = '';
                if (hasChildren) {
                    toggleIcon = `<span class="anomalous-folder-toggle" style="margin-right: 5px; width: 15px; display: inline-block;">${isExpanded ? '▼' : '▶'}</span>`;
                } else {
                    toggleIcon = `<span style="margin-right: 5px; width: 15px; display: inline-block;"></span>`;
                }
                
                item.innerHTML = `${toggleIcon}📁 ${info.name} <span style="opacity:0.5; font-size:0.9em;">(${info.model_count})</span>`;
                
                if (this.currentType === typeGroup.type && this.currentPathIdx === typeGroup.path_idx && this.currentSubfolder === path) {
                    item.classList.add('active');
                }
                
                item.onclick = (e) => {
                    if (e.target.classList.contains('anomalous-folder-toggle')) {
                        if (isExpanded) this.expandedFolders.delete(myId);
                        else this.expandedFolders.add(myId);
                        this.renderSidebar();
                        return;
                    }
                    this.currentType = typeGroup.type;
                    this.currentPathIdx = typeGroup.path_idx;
                    this.currentSubfolder = path;
                    
                    this.detailPanel.style.display = 'none';
                    this.grid.style.display = 'grid';
                    
                    this.renderSidebar();
                    this.loadModels();
                };
                
                this.sidebar.appendChild(item);
            });
        });
    }

    async loadModels() {
        try {
            const params = new URLSearchParams({ type: this.currentType, path_idx: this.currentPathIdx, subfolder: this.currentSubfolder });
            const res = await fetch('/anomalous/models?' + params.toString());
            const data = await res.json();
            this.grid.innerHTML = '';
            
            if (!data.models || data.models.length === 0) {
                this.grid.innerHTML = `<div style="color:white; padding:20px;">${t('noModels')}</div>`;
                return;
            }

            data.models.forEach(model => {
                const card = document.createElement('div');
                card.className = 'anomalous-card';
                if (model.preview_url) {
                    const isVideo = model.preview_url.toLowerCase().endsWith('.mp4') || model.preview_url.toLowerCase().endsWith('.webm');
                    if (isVideo) {
                        const video = document.createElement('video');
                        video.src = model.preview_url;
                        video.muted = true; video.loop = true; video.playsInline = true;
                        if (this.energySaving) {
                            video.pause();
                            card.addEventListener('mouseenter', () => video.play().catch(e=>{}));
                            card.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
                        } else {
                            video.autoplay = true;
                        }
                        card.appendChild(video);
                    } else {
                        const img = document.createElement('img');
                        img.src = model.preview_url;
                        card.appendChild(img);
                    }
                } else {
                    const ph = document.createElement('div');
                    ph.className = 'anomalous-card-placeholder';
                    ph.innerHTML = `<div style="text-align:center;color:#666;margin-top:80px;">${t('noPreview')}</div><div style="font-size:0.8em;text-align:center;opacity:0.5;margin-top:5px">${t('clickScan')}</div>`;
                    card.appendChild(ph);
                }
            const title = document.createElement('div');
                if (model.metadata && model.metadata.baseModel) {
                    const badge = document.createElement('div');
                    badge.innerText = model.metadata.baseModel;
                    badge.style.position = 'absolute';
                    badge.style.top = '6px';
                    badge.style.left = '6px';
                    badge.style.background = 'rgba(0,0,0,0.85)';
                    badge.style.color = '#00ffcc';
                    badge.style.padding = '3px 6px';
                    badge.style.borderRadius = '4px';
                    badge.style.fontSize = '0.75em';
                    badge.style.fontWeight = 'bold';
                    badge.style.border = '1px solid rgba(0,255,204,0.3)';
                    badge.style.pointerEvents = 'none';
                    badge.style.zIndex = '10';
                    card.appendChild(badge);
                }
                title.className = 'anomalous-card-title';
                title.innerText = model.filename;
                card.appendChild(title);
                
                card.onclick = () => { this.currentDetailModel = model; this.showDetail(model); };
                
                this.grid.appendChild(card);
            });
        } catch(e) {}
    }

    showDetail(model) {
        this.grid.style.display = 'none';
        this.detailPanel.style.display = 'flex';
        this.detailPanel.innerHTML = '';
        
        const header = document.createElement('div');
        header.style.width = '100%';
        header.style.padding = '8px 15px';
        header.style.background = 'var(--comfy-menu-bg, #333)';
        header.style.borderBottom = '1px solid var(--border-color, #444)';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.boxSizing = 'border-box';
        
        const backBtn = document.createElement('button');
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
        };
        
        const title = document.createElement('h2');
        title.innerHTML = model.filename;
        title.style.margin = '0 0 0 20px';
        title.style.color = '#fff';
        title.style.fontSize = '1.2em';
        
        const delBtn = document.createElement('button');
        delBtn.innerHTML = t('delModel');
        delBtn.style.padding = '6px 12px';
        delBtn.style.background = '#ff4444';
        delBtn.style.color = '#fff';
        delBtn.style.border = 'none';
        delBtn.style.borderRadius = '4px';
        delBtn.style.cursor = 'pointer';
        delBtn.style.marginLeft = 'auto'; // push to the right
        delBtn.style.whiteSpace = 'nowrap';
        delBtn.onclick = async () => {
            if (!confirm(`${t('delConfirm')} ${model.filename} ${t('delConfirm2')}`)) return;
            try {
                const res = await fetch('/anomalous/delete_model', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: this.currentType,
                        path_idx: this.currentPathIdx,
                        subfolder: this.currentSubfolder,
                        filename: model.filename
                    })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    alert(t('delSuccess') + data.deleted.join('\n') + t('delNote'));
                    this.detailPanel.style.display = 'none';
                    this.detailPanel.innerHTML = '';
                    this.grid.style.display = 'grid';
                    this.loadModels(); // refresh grid
                } else {
                    alert(t('delFail') + data.message);
                }
            } catch (e) {
                alert(t('delFail') + e.message);
            }
        };
        
        header.appendChild(backBtn);
        header.appendChild(title);
        header.appendChild(delBtn);
        
        const splitContainer = document.createElement('div');
        splitContainer.className = 'anomalous-split-container';
        
        const leftPanel = document.createElement('div');
        leftPanel.className = 'anomalous-split-left';
        
        if (model.preview_url) {
            const isVideo = model.preview_url.toLowerCase().endsWith('.mp4') || model.preview_url.toLowerCase().endsWith('.webm');
            if (isVideo) {
                const video = document.createElement('video');
                video.src = model.preview_url;
                video.controls = true;
                video.autoplay = true;
                video.loop = true;
                video.style.width = '100%';
                video.style.height = '100%';
                video.style.objectFit = 'contain';
                leftPanel.appendChild(video);
            } else {
                const img = document.createElement('img');
                img.src = model.preview_url;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'contain';
                leftPanel.appendChild(img);
            }
        } else {
            leftPanel.innerHTML = `<div style="color:#aaa; text-align:center; margin-top:50px;">${t('noPreview')}</div>`;
        }
        
        const resizer = document.createElement('div');
        resizer.className = 'anomalous-resizer';
        
        let isResizing = false;
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });
        
        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const containerRect = splitContainer.getBoundingClientRect();
            let newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
            if (newWidth < 20) newWidth = 20;
            if (newWidth > 80) newWidth = 80;
            leftPanel.style.width = newWidth + '%';
            rightPanel.style.width = (100 - newWidth) + '%';
        });
        
        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
            }
        });
        
        const rightPanel = document.createElement('div');
        rightPanel.className = 'anomalous-split-right';
        rightPanel.style.display = 'flex';
        rightPanel.style.flexDirection = 'column';
        rightPanel.style.height = '100%';
        rightPanel.style.boxSizing = 'border-box';
        rightPanel.style.overflow = 'auto';
        rightPanel.style.padding = '15px';
        rightPanel.style.color = '#eee';
        
        const m = model.metadata || {};
        
        // 1. Top Bar (Title + Size + Model + Button) in a single compact row if possible
        const topRow = document.createElement('div');
        topRow.style.flexShrink = '0';
        topRow.style.display = 'flex';
        topRow.style.flexWrap = 'wrap';
        topRow.style.alignItems = 'center';
        topRow.style.gap = '10px';
        topRow.style.paddingBottom = '10px';
        topRow.style.marginBottom = '10px';
        topRow.style.borderBottom = '1px solid #444';
        
        const titleEl = document.createElement('h3');
        titleEl.style.margin = '0';
        titleEl.style.fontSize = '1.3em';
        titleEl.style.marginRight = '10px';
        titleEl.innerText = m.name || model.filename;
        topRow.appendChild(titleEl);
        
        const metaSpan = document.createElement('span');
        metaSpan.style.fontSize = '0.9em';
        metaSpan.style.color = '#aaa';
        metaSpan.innerHTML = `<strong>Size:</strong> ${model.size_mb} MB` + (m.baseModel ? ` <strong style="margin-left:10px;">Base:</strong> ${m.baseModel}` : '');
        topRow.appendChild(metaSpan);
        
        if (m.civitai_url) {
            const cBtn = document.createElement('a');
            cBtn.href = m.civitai_url;
            cBtn.target = '_blank';
            cBtn.innerHTML = '🌐 Civitai';
            cBtn.style.marginLeft = 'auto';
            cBtn.style.padding = '4px 8px';
            cBtn.style.background = '#1a73e8';
            cBtn.style.color = '#fff';
            cBtn.style.textDecoration = 'none';
            cBtn.style.borderRadius = '4px';
            cBtn.style.fontSize = '0.85em';
            cBtn.style.fontWeight = 'bold';
            topRow.appendChild(cBtn);
        }
        
        rightPanel.appendChild(topRow);
        
        // 2. Trained Words Section
        if (m.trainedWords && m.trainedWords.length > 0) {
            const twCont = document.createElement('div');
            twCont.style.flexShrink = '0';
            twCont.style.marginBottom = '10px';
            
            const twHeader = document.createElement('div');
            twHeader.style.display = 'flex';
            twHeader.style.alignItems = 'center';
            twHeader.style.marginBottom = '5px';
            
            const twLabel = document.createElement('strong');
            twLabel.innerText = 'Trained Words:';
            twHeader.appendChild(twLabel);
            
            const copyAll = document.createElement('button');
            copyAll.innerText = t('copyAll');
            copyAll.style.marginLeft = '10px';
            copyAll.style.padding = '2px 6px';
            copyAll.style.background = '#444';
            copyAll.style.color = '#fff';
            copyAll.style.border = 'none';
            copyAll.style.borderRadius = '3px';
            copyAll.style.cursor = 'pointer';
            copyAll.style.fontSize = '0.8em';
            copyAll.onclick = () => {
                const allWords = m.trainedWords.join(', ');
                navigator.clipboard.writeText(allWords).then(() => {
                    const old = copyAll.innerText;
                    copyAll.innerText = t('copied');
                    setTimeout(() => { copyAll.innerText = old; }, 1500);
                });
            };
            twHeader.appendChild(copyAll);
            twCont.appendChild(twHeader);
            
            const tagsCont = document.createElement('div');
            tagsCont.style.display = 'flex';
            tagsCont.style.flexWrap = 'wrap';
            tagsCont.style.gap = '4px';
            
            m.trainedWords.forEach(w => {
                const tag = document.createElement('span');
                tag.innerText = w;
                tag.style.background = '#333';
                tag.style.padding = '2px 6px';
                tag.style.borderRadius = '4px';
                tag.style.fontSize = '0.85em';
                tag.style.cursor = 'pointer';
                tag.style.border = '1px solid #555';
                tag.title = t('clickToCopy') + w;
                tag.onclick = () => {
                    navigator.clipboard.writeText(w).then(() => {
                        tag.style.background = '#28a745';
                        setTimeout(() => { tag.style.background = '#333'; }, 500);
                    });
                };
                tagsCont.appendChild(tag);
            });
            twCont.appendChild(tagsCont);
            rightPanel.appendChild(twCont);
        }
        
        // 3. Description Section (Expands to fill remaining height)
        if (m.description) {
            const descCont = document.createElement('div');
            descCont.style.flex = 'none';
            descCont.style.display = 'flex';
            descCont.style.flexDirection = 'column';
             // important for flex scroll
            
            const descLabel = document.createElement('strong');
            descLabel.innerText = 'Description:';
            descLabel.style.marginBottom = '5px';
            descCont.appendChild(descLabel);
            
            const descText = document.createElement('div');
            descText.style.flex = 'none';
            
            descText.style.background = '#222';
            descText.style.padding = '10px';
            descText.style.borderRadius = '6px';
            descText.style.border = '1px solid #333';
            descText.style.fontSize = '0.95em';
            descText.style.lineHeight = '1.4';
            descText.innerHTML = m.description;
            descCont.appendChild(descText);
            
            rightPanel.appendChild(descCont);
        }
        
        // 4. Notes Section
        if (m.notes) {
            const notesCont = document.createElement('div');
            notesCont.style.flexShrink = '0';
            notesCont.style.marginTop = '10px';
            
            const notesLabel = document.createElement('strong');
            notesLabel.innerText = 'Notes:';
            notesCont.appendChild(notesLabel);
            
            const notesText = document.createElement('div');
            notesText.style.background = '#332b00';
            notesText.style.padding = '8px';
            notesText.style.borderRadius = '6px';
            notesText.style.marginTop = '5px';
            notesText.style.border = '1px solid #554400';
            notesText.style.fontSize = '0.9em';
            notesText.innerHTML = m.notes;
            notesCont.appendChild(notesText);
            
            rightPanel.appendChild(notesCont);
        }
        
        splitContainer.appendChild(leftPanel);
        splitContainer.appendChild(resizer);
        splitContainer.appendChild(rightPanel);
        
        this.detailPanel.appendChild(header);
        this.detailPanel.appendChild(splitContainer);
    }

    show() {
        this.modal.classList.add('visible');
        if (!this.foldersData) {
            this.loadFolders();
        } else {
            this.loadModels();
        }
    }
    close() { this.modal.classList.remove('visible'); }
}

app.registerExtension({
    name: 'Anomalous.ModelBrowser',
    async setup() {
        const cssUrl = '/extensions/Anomalous_Model_Browser/styles.css?v=' + Date.now();
        if (!document.querySelector(`link[href^="/extensions/Anomalous_Model_Browser/styles.css"]`)) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.type = "text/css";
            link.href = cssUrl;
            document.head.appendChild(link);
        }

        const browser = new AnomalousBrowser();
        const btn = document.createElement('button');
        btn.id = 'anomalous-trigger-btn';
        btn.innerHTML = '📦';
        btn.title = 'Open Anomalous Model Browser';
        
        let isDragging = false;
        let startX, startY, initialX, initialY;

        btn.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = btn.getBoundingClientRect();
            initialX = rect.left; initialY = rect.top;
            btn.style.transition = 'none';
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            btn.style.left = initialX + (e.clientX - startX) + 'px';
            btn.style.top = initialY + (e.clientY - startY) + 'px';
            btn.style.right = 'auto'; btn.style.bottom = 'auto';
        });
        window.addEventListener('mouseup', (e) => {
            if (isDragging) {
                isDragging = false;
                btn.style.transition = 'transform 0.15s, box-shadow 0.15s';
                localStorage.setItem('anomalous_btn_x', btn.style.left);
                localStorage.setItem('anomalous_btn_y', btn.style.top);
                if (Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5) browser.show();
            }
        });
        
        const savedX = localStorage.getItem('anomalous_btn_x');
        const savedY = localStorage.getItem('anomalous_btn_y');
        if (savedX && savedY) {
            btn.style.left = savedX;
            btn.style.top = savedY;
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
        }
        document.body.appendChild(btn);
    }
});
