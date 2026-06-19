import { app } from "../../scripts/app.js";

const i18n = {
    zh: {
        title: '📦 Anomalous 模型浏览器',
        scan: '🔄 扫描目录并同步 C 站数据',
        scanTitle: '扫描目录',
        scanConfirm: '注意:\n扫描过程将会自动比对 Civitai 并重命名本地模型，同时清理损坏文件。\n确定要开始扫描吗？',
        scanning: '扫描中...',
        scanBg: '🚀 扫描后台启动！',
        scanDone: '完成',
        scanCompleteMsg: '✅ 扫描完成！\n\n⚠️ 提示：由于部分模型已被重命名或去重，请点击 ComfyUI 的 [Refresh] 按钮以同步最新的模型列表。',
        eco: '🔋 视频悬浮播放 (节能模式)',
        autoPlay: '🎬 自动播放视频封面 (高能耗)',
        togglePlayTitle: '切换播放模式',
        clean: '🧹 清理无效的 .info 残留文件',
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
        delModel: '🗑️ 删除',
        delConfirm: '确定彻底删除',
        delConfirm2: '及其所有关联配置、预览图和缓存文件吗？此操作不可逆！',
        delSuccess: '✅ 删除成功！\n',
        delNote: '\n\n⚠️ 提示：请重启 ComfyUI，否则由于缓存继续使用会报错',
        delFail: '❌ 删除失败: ',
        copyAll: '📋 复制全部',
        copied: '✅ 已复制!',
        clickToCopy: '点击复制: ',
        compatibleModels: '🔗 兼容模型',
        loadingCompatible: '加载中...',
        backToPrev: '🔙 返回上一层',
        applyToCanvas: '➕ 插入节点',
        applySuccess: '✅ 已添加至工作流',
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
    <p><strong>7. 🔗 兼容模型匹配</strong>: 点开大模型或 Lora 详细页，系统将自动基于 Base Model 架构，双向匹配并展示关联模型。</p>
    <p><strong>8. ➕ 一键投放节点</strong>: 在网格卡片右上角或详细页顶部，点击【➕】按钮，可将当前模型节点直接贴在鼠标上，并无缝插入工作流画布！</p>
    <p><strong>9. 📑 笔记本 (Notebook)</strong>: 提供强大的工作流草稿本功能。你可以创建不同的笔记本，选择基础架构 (Base Model)，系统会自动为你筛选出对应的纯净主模型和 Lora 画廊供你点选。同时内置了极具高级感的双语提示词对照编辑器，支持标签化悬停高亮与快捷复制，并且支持将整个配置一键发送到画布！</p>
    <p><strong>10. 🖼️ 图库 (Gallery)</strong>: 同步浏览 ComfyUI output 文件夹的所有生成历史。支持无限懒加载，点击全屏预览，设有极度安全的防误触删除遮罩。更可以直接将任意图片拖拽到画布上瞬间还原内嵌的工作流！</p>
    <p><strong>11. 🪄 自动修复飘红节点 (Auto-Fix)</strong>: 设置面板中的“一键修复工作流飘红”功能或缺模型弹窗中的一键按钮，可以帮您瞬间自动替换画布上所有的报错模型。<strong>⚠️ 必须知晓：</strong>系统依赖模型哈希(Hash)进行精准匹配，因此只有在使用本插件之后生成/保存的工作流或图片，才能实现 100% 精准全自动修复。对于历史遗留的旧工作流，由于缺失哈希信息，无法自动修复，敬请手动重选。</p>
</div>`,
        notebooks: '笔记本',
        notebookTitle: '笔记本管理',
        createNotebook: '新建',
        saveNotebook: '💾 保存',
        deleteNotebook: '🗑️ 删除',
        renameNotebook: '✏️ 重命名',
        baseModel: 'Base Model (基础模型)',
        mainModel: 'Main Model (主模型)',
        sendToCanvas: '🚀 发送到画布',
        translate: '翻译',
        newNotebookName: '新笔记本名称',
        noBaseModel: '请先选择 Base Model',
        closeHelp: '关闭说明',
        delSure: '⚠️ 确定吗？',
        dockTitle: '侧边停靠',
        replaceAll: '全部替换',
        editRaw: '📝 纯文本/粘贴',
        findPlaceholder: '查找...',
        replacePlaceholder: '替换为...',
        models: '模型',
        gallery: '图库',
        apiKeyConfig: '🔑 Civitai API 密钥配置 (用于下载封面)',
        apiKeyPrompt: '请输入你的 Civitai API Key：',
        settingsBtn: '设置',
        closeSettings: '✖ 关闭设置面板',
    },
    en: {
        title: '📦 Anomalous Model Browser',
        scan: '🔄 Scan folder and sync Civitai data',
        scanTitle: 'Scan Folder',
        scanConfirm: 'Notice:\nThe scan process will automatically compare with Civitai and rename your local files.\nStart scan?',
        scanning: 'Scanning...',
        scanBg: '🚀 Scan started in background!',
        scanDone: 'Done',
        scanCompleteMsg: '✅ Scan Complete!\n\n⚠️ Note: Please click [Refresh] to sync the model list since files were renamed.',
        eco: '🔋 Eco Mode (Play video on hover)',
        autoPlay: '🎬 AutoPlay Videos (High perf cost)',
        togglePlayTitle: 'Toggle Play Mode',
        clean: '🧹 Clean orphaned .info files',
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
        delModel: '🗑️ Delete',
        delConfirm: 'Are you sure you want to permanently delete',
        delConfirm2: ' and all its associated configs, previews, and cache files? This action is irreversible!',
        delSuccess: '✅ Delete Complete!\n',
        delNote: '\n\n⚠️ Note: Please restart ComfyUI, otherwise continuing to use it due to cache will cause errors.',
        delFail: '❌ Delete Failed: ',
        copyAll: '📋 Copy All',
        copied: '✅ Copied!',
        clickToCopy: 'Click to copy: ',
        compatibleModels: '🔗 Compatible Models',
        loadingCompatible: 'Loading...',
        backToPrev: '🔙 Back to prev',
        applyToCanvas: '➕ Add Node',
        applySuccess: '✅ Added to workflow',
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
    <p><strong>7. 🔗 Compatible Model Matching</strong>: Open a Checkpoint or Lora detail page, and the system will automatically bi-directionally match and display compatible models based on the Base Model architecture.</p>
    <p><strong>8. ➕ One-Click Add Node</strong>: Click the 【➕】 button on a grid card or detail page to instantly attach the model node to your cursor and drop it seamlessly onto your workflow canvas!</p>
    <p><strong>9. 📑 Notebook System</strong>: A powerful drafting workspace. Create notebooks, select a Base Model, and precisely match compatible Main Models and Loras. Includes a premium dual-pane bilingual prompt editor with hover-sync, tag splitting, and 1-click deployment to canvas.</p>
    <p><strong>10. 🖼️ Gallery System</strong>: Natively browse your ComfyUI output history. Features infinite lazy loading, fullscreen immersive previews, and a foolproof overlay for safe deletion. You can even drag and drop any image directly onto your canvas to instantly import its workflow!</p>
    <p><strong>11. 🪄 Auto-Fix Missing Models</strong>: The "Fix Models" button in Settings or the One-Click button in the missing-models popup will instantly repair all red/missing model nodes on your canvas. <strong>⚠️ Important:</strong> The system relies on model hashes for 100% accurate matching. Therefore, ONLY workflows or images generated/saved AFTER installing this plugin can be fully auto-repaired. For older historical workflows lacking hash data, auto-fix is not possible and you must manually re-select the models.</p>
</div>`,
        notebooks: 'Notebooks',
        notebookTitle: 'Notebook Manager',
        createNotebook: 'New',
        saveNotebook: '💾 Save',
        deleteNotebook: '🗑️ Delete',
        renameNotebook: '✏️ Rename',
        baseModel: 'Base Model',
        mainModel: 'Main Model',
        sendToCanvas: '🚀 Send to Canvas',
        translate: 'Translate',
        newNotebookName: 'New Notebook Name',
        noBaseModel: 'Select a Base Model first',
        closeHelp: 'Close Manual',
        delSure: '⚠️ Sure?',
        dockTitle: 'Dock to Left',
        replaceAll: 'Replace All',
        editRaw: '📝 Edit Raw / Paste',
        findPlaceholder: 'Find...',
        replacePlaceholder: 'Replace with...',
        models: 'Models',
        gallery: 'Gallery',
        apiKeyConfig: '🔑 Civitai API Key Config (For downloading previews)',
        apiKeyPrompt: 'Enter your Civitai API Key:',
        settingsBtn: 'Settings',
        closeSettings: '✖ Close Settings',
    }
};

let currentLang = localStorage.getItem('anomalous_lang') || 'zh';
window.anomalous_browser_lang = currentLang;
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

        const container = document.createElement('div');
        container.id = 'anomalous-container';

        const updateLangClass = () => {
            if (currentLang === 'en') container.classList.add('anomalous-lang-en');
            else container.classList.remove('anomalous-lang-en');
        };
        updateLangClass();

        const savedScale = localStorage.getItem('anomalous_ui_scale') || 1;
        container.style.setProperty('--anomalous-scale', savedScale);

        // Sidebar
        this.sidebarWrapper = document.createElement('div');
        this.sidebarWrapper.id = 'anomalous-sidebar-wrapper';
        this.sidebarWrapper.style.position = 'relative';

        const brandBar = document.createElement('div');
        brandBar.style.padding = '15px 15px 10px 15px';
        brandBar.style.display = 'flex';
        brandBar.style.alignItems = 'center';
        brandBar.style.justifyContent = 'space-between';
        brandBar.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

        const badge = document.createElement('div');
        badge.style.background = 'linear-gradient(135deg, #444, #222)';
        badge.style.color = '#ccc';
        badge.style.fontSize = '0.7em';
        badge.style.padding = '4px 8px';
        badge.style.borderRadius = '6px';
        badge.style.letterSpacing = '1px';
        badge.style.border = '1px solid #555';
        badge.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
        badge.style.textTransform = 'uppercase';
        badge.style.fontWeight = 'bold';
        badge.innerHTML = 'Anomalous Browser';

        const menuBtn = document.createElement('button');
        menuBtn.innerHTML = '☰';
        menuBtn.title = 'Toggle Sidebar';
        menuBtn.style.background = 'transparent';
        menuBtn.style.border = 'none';
        menuBtn.style.color = '#ccc';
        menuBtn.style.fontSize = '1.2em';
        menuBtn.style.cursor = 'pointer';
        menuBtn.onclick = () => {
            if (container.classList.contains('anomalous-sidebar-closed')) {
                container.classList.remove('anomalous-sidebar-closed');
                localStorage.setItem('anomalous_user_sidebar_closed', 'false');
            } else {
                container.classList.add('anomalous-sidebar-closed');
                localStorage.setItem('anomalous_user_sidebar_closed', 'true');
            }
        };

        brandBar.appendChild(badge);
        brandBar.appendChild(menuBtn);

        this.sidebar = document.createElement('div');
        this.sidebar.id = 'anomalous-sidebar';

        this.sidebarActions = document.createElement('div');
        this.sidebarActions.id = 'anomalous-sidebar-actions';
        this.sidebarActions.style.padding = '10px 15px';
        this.sidebarActions.style.display = 'flex';
        this.sidebarActions.style.flexDirection = 'row';
        this.sidebarActions.style.justifyContent = 'flex-start';
        this.sidebarActions.style.alignItems = 'center';
        this.sidebarActions.style.gap = '10px';
        this.sidebarActions.style.borderTop = '1px solid rgba(255,255,255,0.05)';
        this.sidebarActions.style.background = 'transparent';
        this.sidebarActions.style.borderRadius = '0';
        this.sidebarActions.style.width = '100%';
        this.sidebarActions.style.boxSizing = 'border-box';
        this.sidebarActions.style.margin = '0';

        this.sidebarWrapper.appendChild(brandBar);
        this.sidebarWrapper.appendChild(this.sidebar);
        this.sidebarWrapper.appendChild(this.sidebarActions);

        // Content Area
        const content = document.createElement('div');
        content.id = 'anomalous-content';

        const header = document.createElement('div');
        header.id = 'anomalous-header';

        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        const enforceBounds = (x, y) => {
            let newX = x;
            let newY = y;
            if (newX + container.offsetWidth > window.innerWidth) newX = window.innerWidth - container.offsetWidth;
            if (newY + container.offsetHeight > window.innerHeight) newY = window.innerHeight - container.offsetHeight;
            if (newX < 0) newX = 0;
            if (newY < 0) newY = 0;
            return { x: newX, y: newY };
        };

        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.id === 'anomalous-close') return;
            isDragging = true;
            const rect = container.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const pos = enforceBounds(e.clientX - dragOffsetX, e.clientY - dragOffsetY);
            container.style.left = pos.x + 'px';
            container.style.top = pos.y + 'px';
            container.style.transform = 'none';
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                localStorage.setItem('anomalous_pos_x', container.style.left);
                localStorage.setItem('anomalous_pos_y', container.style.top);
            }
        });

        const savedX = localStorage.getItem('anomalous_pos_x');
        const savedY = localStorage.getItem('anomalous_pos_y');
        if (savedX && savedY) {
            container.style.left = savedX;
            container.style.top = savedY;
        }

        // Periodically enforce bounds to catch resize/zoom changes
        setInterval(() => {
            if (!isDragging && container.style.display !== 'none' && !container.classList.contains('anomalous-docked')) {
                const rect = container.getBoundingClientRect();
                const pos = enforceBounds(rect.left, rect.top);
                if (pos.x !== rect.left || pos.y !== rect.top) {
                    if (container.style.left.endsWith('px') && container.style.top.endsWith('px')) {
                        container.style.left = pos.x + 'px';
                        container.style.top = pos.y + 'px';
                    }
                }
            }
        }, 1000);

        const spacer = document.createElement('div');
        spacer.style.flex = '1 1 auto';

        const leftGroup = document.createElement('div');
        leftGroup.className = 'anomalous-header-group';

        const rightGroup = document.createElement('div');
        rightGroup.className = 'anomalous-header-group';

        const hideAllPanels = () => {
            this.grid.style.display = 'none';
            this.detailPanel.style.display = 'none';
            if (this.galleryPanel) this.galleryPanel.style.display = 'none';
            if (this.currentDetailObserver) {
                this.currentDetailObserver.disconnect();
                this.currentDetailObserver = null;
            }
        };

        const showSidebar = () => {
            container.classList.remove('anomalous-sidebar-closed');
        };

        const modelsBtn = document.createElement('button');
        modelsBtn.id = 'anomalous-models-btn';
        modelsBtn.innerHTML = `🏠 <span class="anomalous-btn-text">${t('models')}</span>`;
        modelsBtn.onclick = () => {
            hideAllPanels();
            if (localStorage.getItem('anomalous_user_sidebar_closed') === 'true') {
                container.classList.add('anomalous-sidebar-closed');
            } else {
                showSidebar();
            }
            menuBtn.disabled = false;
            menuBtn.style.opacity = '1';
            menuBtn.style.cursor = 'pointer';
            this.grid.style.display = 'grid';
            if (this.detailPanel.innerHTML !== '') {
                this.detailPanel.innerHTML = '';
                this.currentDetailModel = null;
                this.historyStack = [];
            }
        };

        const galleryBtn = document.createElement('button');
        galleryBtn.innerHTML = `🖼️ <span class="anomalous-btn-text">${t('gallery') || '图库'}</span>`;
        galleryBtn.onclick = () => {
            hideAllPanels();
            container.classList.add('anomalous-sidebar-closed');
            menuBtn.disabled = true;
            menuBtn.style.opacity = '0.3';
            menuBtn.style.cursor = 'not-allowed';
            this.galleryPanel.style.display = 'flex';
            if (!this.galleryLoaded) {
                this.loadGalleryImages(1, true);
            }
        };

        const dockBtn = document.createElement('button');
        dockBtn.innerHTML = '◧';
        dockBtn.title = t('dockTitle');
        dockBtn.onclick = () => {
            container.classList.toggle('anomalous-docked');
            if (container.classList.contains('anomalous-docked')) {
                localStorage.setItem('anomalous_docked', 'true');
            } else {
                localStorage.setItem('anomalous_docked', 'false');
            }
        };

        if (localStorage.getItem('anomalous_docked') === 'true') {
            container.classList.add('anomalous-docked');
        }

        const helpBtn = document.createElement('button');
        helpBtn.id = 'anomalous-help-btn';
        helpBtn.title = t('helpTitle');
        helpBtn.innerHTML = `❓ <span class="anomalous-btn-text">${t('help')}</span>`;
        helpBtn.onclick = () => this.showHelp();

        const nbBtn = document.createElement('button');
        nbBtn.id = 'anomalous-notebook-btn';
        nbBtn.title = t('notebookTitle');
        nbBtn.innerHTML = `📑 <span class="anomalous-btn-text">${t('notebooks')}</span>`;
        nbBtn.onclick = () => {
            this.nbPanel.style.display = 'flex';
            this.showNotebooks();
        };

        rightGroup.appendChild(modelsBtn);
        rightGroup.appendChild(galleryBtn);
        rightGroup.appendChild(nbBtn);

        const apiKeyBtn = document.createElement('button');
        apiKeyBtn.id = 'anomalous-api-btn';
        apiKeyBtn.innerHTML = `<span class="anomalous-btn-text">${t('apiKeyConfig')}</span>`;
        apiKeyBtn.onclick = async () => {
            const current = localStorage.getItem('anomalous_api_key') || '';
            const val = prompt(t('apiKeyPrompt'), current);
            if (val !== null) {
                localStorage.setItem('anomalous_api_key', val.trim());
                try {
                    await fetch('/anomalous/save_config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ api_key: val.trim() })
                    });
                } catch (e) { }
            }
        };

        const scanBtn = document.createElement('button');
        scanBtn.id = 'anomalous-scan-btn';
        scanBtn.title = t('scanTitle');
        scanBtn.innerHTML = `🔄`;
        scanBtn.onclick = async () => {
            if (!confirm(t('scanConfirm'))) return;
            scanBtn.innerHTML = `⏳`;
            scanBtn.disabled = true;
            try {
                const params = new URLSearchParams({ type: this.currentType, path_idx: this.currentPathIdx, subfolder: this.currentSubfolder });
                const res = await fetch('/anomalous/scan?' + params.toString(), { method: 'POST' });
                const data = await res.json();
                if (data.status === 'ok') {
                    alert(t('scanBg'));
                    const poll = setInterval(async () => {
                        try {
                            const sr = await fetch('/anomalous/scan_status?' + params.toString());
                            const sd = await sr.json();
                            if (!sd.scanning) {
                                clearInterval(poll);
                                scanBtn.innerHTML = `✅`;

                                let msg = '';
                                if (sd.result) {
                                    if (currentLang === 'zh') {
                                        msg = `✅ 扫描完成！\n成功：${sd.result.success} | 失败：${sd.result.fail}\n正在点亮画布飘红节点...`;
                                    } else {
                                        msg = `✅ Scan Complete!\nSuccess: ${sd.result.success} | Failed: ${sd.result.fail}\nAuto-fixing red nodes...`;
                                    }
                                } else {
                                    if (currentLang === 'zh') {
                                        msg = `✅ 扫描完成！正在点亮画布节点...`;
                                    } else {
                                        msg = `✅ Scan Complete! Auto-fixing nodes...`;
                                    }
                                }
                                alert(msg);
                                window.anomalous_is_empty_state = false;
                                if (window.anomalous_resolve_all_missing_nodes) {
                                    await window.anomalous_resolve_all_missing_nodes(true);
                                }

                                this.loadModels();
                                setTimeout(() => { scanBtn.innerHTML = `🔄`; scanBtn.disabled = false; }, 2000);
                            }
                        } catch (e) { clearInterval(poll); scanBtn.disabled = false; }
                    }, 3000);
                } else {
                    scanBtn.disabled = false;
                }
            } catch (e) { scanBtn.disabled = false; }
        };

        scanBtn.innerHTML = `🔄`;
        scanBtn.style.background = 'transparent';
        scanBtn.style.color = '#ccc';
        scanBtn.style.border = 'none';
        scanBtn.style.borderRadius = '6px';
        scanBtn.style.padding = '6px';
        scanBtn.style.fontSize = '1.1em';
        scanBtn.style.cursor = 'pointer';
        scanBtn.style.transition = 'all 0.2s ease';
        scanBtn.onmouseover = () => { if (!scanBtn.disabled) { scanBtn.style.background = 'rgba(255,255,255,0.1)'; scanBtn.style.color = '#fff'; scanBtn.style.transform = 'translateY(-1px)'; } };
        scanBtn.onmouseout = () => { if (!scanBtn.disabled) { scanBtn.style.background = 'transparent'; scanBtn.style.color = '#ccc'; scanBtn.style.transform = 'none'; } };

        this.sidebarActions.appendChild(scanBtn);

        const energyBtn = document.createElement('button');
        energyBtn.id = 'anomalous-energy-btn';
        energyBtn.title = t('togglePlayTitle');
        const renderEnergyBtn = () => {
            energyBtn.innerHTML = this.energySaving
                ? `<span class="anomalous-btn-text">${t('eco')}</span>`
                : `<span class="anomalous-btn-text">${t('autoPlay')}</span>`;
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
        cleanBtn.innerHTML = `<span class="anomalous-btn-text">${t('clean')}</span>`;

        cleanBtn.onclick = async () => {
            if (!confirm(t('cleanConfirm'))) return;
            cleanBtn.innerHTML = `⏳ <span class="anomalous-btn-text">${t('cleaning')}</span>`;
            cleanBtn.disabled = true;
            try {
                const res = await fetch('/anomalous/clean_civitai_info', { method: 'POST' });
                const data = await res.json();
                if (data.status === 'success') {
                    alert(`${t('cleanDone')} ${data.count} ${t('files')}`);
                } else {
                    alert(t('cleanFail') + data.message);
                }
            } catch (e) { alert(t('cleanErr') + e.message); }
            cleanBtn.innerHTML = `<span class="anomalous-btn-text">${t('clean')}</span>`;
            cleanBtn.disabled = false;
        };

        const fixBtn = document.createElement('button');
        fixBtn.id = 'anomalous-fix-models-btn';
        fixBtn.title = '一键修复工作流飘红 (Fix Models)';
        fixBtn.innerHTML = `🪄`;
        fixBtn.style.background = 'transparent';
        fixBtn.style.color = '#ccc';
        fixBtn.style.border = 'none';
        fixBtn.style.borderRadius = '6px';
        fixBtn.style.padding = '6px';
        fixBtn.style.fontSize = '1.1em';
        fixBtn.style.cursor = 'pointer';
        fixBtn.style.transition = 'all 0.2s ease';
        fixBtn.onmouseover = () => { fixBtn.style.background = 'rgba(255,255,255,0.1)'; fixBtn.style.color = '#fff'; fixBtn.style.transform = 'translateY(-1px)'; };
        fixBtn.onmouseout = () => { fixBtn.style.background = 'transparent'; fixBtn.style.color = '#ccc'; fixBtn.style.transform = 'none'; };
        fixBtn.onclick = async () => {
            if (window.anomalous_resolve_all_missing_nodes) {
                await window.anomalous_resolve_all_missing_nodes(true);
                settingsHubModal.style.display = 'none';
            } else {
                alert(currentLang === 'zh' ? "修复模块尚未加载！" : "Fix module not loaded yet!");
            }
        };

        rightGroup.appendChild(dockBtn);
        rightGroup.appendChild(closeBtn);

        header.appendChild(leftGroup);
        header.appendChild(spacer);
        header.appendChild(rightGroup);

        const settingsHubModal = document.createElement('div');
        settingsHubModal.style.position = 'absolute';
        settingsHubModal.style.bottom = '15px';
        settingsHubModal.style.left = '100%';
        settingsHubModal.style.marginLeft = '10px';
        settingsHubModal.style.width = '260px';
        settingsHubModal.style.background = 'var(--comfy-menu-bg, #2a2a2a)';
        settingsHubModal.style.border = '1px solid rgba(255,255,255,0.1)';
        settingsHubModal.style.borderRadius = '12px';
        settingsHubModal.style.padding = '10px';
        settingsHubModal.style.display = 'none';
        settingsHubModal.style.flexDirection = 'column';
        settingsHubModal.style.gap = '4px';
        settingsHubModal.style.boxShadow = '0 10px 40px rgba(0,0,0,0.5)';
        settingsHubModal.style.zIndex = '1000';

        const langBtn = document.createElement('button');
        langBtn.className = 'anomalous-lang-btn';
        langBtn.innerHTML = currentLang === 'zh' ? '🌐 Language: EN' : '🌐 语言: 中文';
        langBtn.onclick = () => {
            currentLang = currentLang === 'zh' ? 'en' : 'zh';
            localStorage.setItem('anomalous_lang', currentLang);
            window.anomalous_browser_lang = currentLang;
            langBtn.innerHTML = currentLang === 'zh' ? '🌐 Language: EN' : '🌐 语言: 中文';
            updateLangClass();
            modelsBtn.innerHTML = `🏠 <span class="anomalous-btn-text">${t('models')}</span>`;
            galleryBtn.innerHTML = `🖼️ <span class="anomalous-btn-text">${t('gallery')}</span>`;
            scanBtn.title = t('scanTitle');
            scanBtn.innerHTML = `🔄`;
            cleanBtn.title = t('cleanTitle');
            cleanBtn.innerHTML = `<span class="anomalous-btn-text">${t('clean')}</span>`;
            helpBtn.innerHTML = `❓ <span class="anomalous-btn-text">${t('help')}</span>`;
            nbBtn.title = t('notebookTitle');
            nbBtn.innerHTML = `📑 <span class="anomalous-btn-text">${t('notebooks')}</span>`;
            apiKeyBtn.innerHTML = `<span class="anomalous-btn-text">${t('apiKeyConfig')}</span>`;
            const globalScanBtnRef = document.getElementById('anomalous-global-scan-btn');
            if (globalScanBtnRef) globalScanBtnRef.innerHTML = currentLang === 'zh' ? '🌍 一键全盘极速扫描 (不下载封面/不改名)' : '🌍 Global Quick Scan (No rename/No media)';
            const missingBtnRef = document.getElementById('anomalous-missing-btn');
            if (missingBtnRef) missingBtnRef.innerHTML = currentLang === 'zh' ? '🚨 查找缺失模型' : '🚨 Find Missing Models';
            const checkUnscannedBtnRef = document.getElementById('anomalous-check-unscanned-btn');
            if (checkUnscannedBtnRef) checkUnscannedBtnRef.innerHTML = currentLang === 'zh' ? '🔍 检查并极速录入缺失模型信息' : '🔍 Check & Auto-Scan Missing Info';
            const resetBtnRef = document.getElementById('anomalous-reset-btn');
            if (resetBtnRef) resetBtnRef.innerHTML = currentLang === 'zh' ? '🔄 重置界面布局' : '🔄 Reset Layout';
            const scaleLabelRef = document.getElementById('anomalous-scale-label');
            if (scaleLabelRef) scaleLabelRef.innerText = currentLang === 'zh' ? 'UI 缩放' : 'UI Scale';

            renderEnergyBtn();
            this.renderSidebar();
            this.loadModels();
            if (this.detailPanel.style.display !== 'none' && this.currentDetailModel) {
                this.showDetail(this.currentDetailModel);
            }
            if (this.nbEditor && this.nbEditor.innerHTML !== '') {
                this.renderNotebookEditor();
                this.refreshNotebooks();
            }
        };

        const styleHubBtn = (btn) => {
            btn.style.background = 'transparent';
            btn.style.border = '1px solid rgba(255,255,255,0.05)';
            btn.style.color = '#ccc';
            btn.style.textAlign = 'left';
            btn.style.padding = '8px 10px';
            btn.style.borderRadius = '8px';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '0.85em';
            btn.style.transition = 'all 0.2s';
            btn.onmouseover = () => { btn.style.background = 'rgba(255,255,255,0.08)'; btn.style.color = '#fff'; };
            btn.onmouseout = () => { btn.style.background = 'transparent'; btn.style.color = '#ccc'; };
        };

        styleHubBtn(cleanBtn);
        styleHubBtn(energyBtn);
        styleHubBtn(apiKeyBtn);
        styleHubBtn(langBtn);
        styleHubBtn(helpBtn);

        const globalScanBtn = document.createElement('button');
        globalScanBtn.id = 'anomalous-global-scan-btn';
        globalScanBtn.innerHTML = currentLang === 'zh' ? '🌍 一键全盘极速扫描 (不下载封面/不改名)' : '🌍 Global Quick Scan (No rename/No media)';
        styleHubBtn(globalScanBtn);

        globalScanBtn.onclick = async () => {
            if (!confirm(currentLang === 'zh' ? '即将执行极速全盘扫描并同步Hash，此操作不改名也不下载封面，是否继续？' : 'Start global quick scan to sync all hashes?')) return;
            globalScanBtn.innerHTML = currentLang === 'zh' ? '⏳ 扫描中...' : '⏳ Scanning...';
            globalScanBtn.disabled = true;
            try {
                const res = await fetch('/anomalous/scan_all', { method: 'POST' });
                const data = await res.json();
                if (data.status === 'ok') {
                    alert(currentLang === 'zh' ? '🚀 全局扫描已后台启动！' : '🚀 Global Scan started in background!');
                    const pollTimer = setInterval(async () => {
                        try {
                            const statusRes = await fetch('/anomalous/global_scan_status');
                            const statusData = await statusRes.json();
                            if (!statusData.scanning) {
                                clearInterval(pollTimer);
                                globalScanBtn.innerHTML = currentLang === 'zh' ? '✅ 扫描完成' : '✅ Scan Complete';
                                setTimeout(() => {
                                    globalScanBtn.innerHTML = currentLang === 'zh' ? '🌍 一键全盘扫描 (不下载封面/不改名)' : '🌍 Global Quick Scan (No rename/No media)';
                                    globalScanBtn.disabled = false;
                                }, 3000);
                            }
                        } catch (e) { }
                    }, 3000);
                } else {
                    alert((currentLang === 'zh' ? '错误: ' : 'Error: ') + data.message);
                    globalScanBtn.disabled = false;
                }
            } catch (e) {
                globalScanBtn.disabled = false;
            }
        };

        const missingBtn = document.createElement('button');
        missingBtn.id = 'anomalous-missing-btn';
        missingBtn.innerHTML = currentLang === 'zh' ? '🚨 查找缺失模型' : '🚨 Find Missing Models';
        styleHubBtn(missingBtn);
        missingBtn.onclick = () => {
            if (window.anomalous_resolve_all_missing_nodes) {
                window.anomalous_resolve_all_missing_nodes(true, true);
            }
        };

        const checkUnscannedBtn = document.createElement('button');
        checkUnscannedBtn.id = 'anomalous-check-unscanned-btn';
        checkUnscannedBtn.innerHTML = currentLang === 'zh' ? '🔍 检查并极速录入缺失模型信息' : '🔍 Check & Auto-Scan Missing Info';
        styleHubBtn(checkUnscannedBtn);
        checkUnscannedBtn.onclick = async () => {
            checkUnscannedBtn.innerHTML = currentLang === 'zh' ? '⏳ 检查中...' : '⏳ Checking...';
            checkUnscannedBtn.disabled = true;
            try {
                const res = await fetch('/anomalous/all_hashes');
                const data = await res.json();
                const hashesObj = data.hashes ? data.hashes : data;
                let hasUnscanned = false;
                for (const key in hashesObj) {
                    if (hashesObj[key].hash === "") {
                        hasUnscanned = true;
                        break;
                    }
                }

                if (hasUnscanned) {
                    checkUnscannedBtn.innerHTML = currentLang === 'zh' ? '⚠️ 发现缺失，正在自动极速扫描...' : '⚠️ Missing info found, Auto-Scanning...';
                    const scanRes = await fetch('/anomalous/scan_all', { method: 'POST' });
                    const scanData = await scanRes.json();
                    if (scanData.status === 'ok') {
                        const pollTimer = setInterval(async () => {
                            try {
                                const statusRes = await fetch('/anomalous/global_scan_status');
                                const statusData = await statusRes.json();
                                if (!statusData.scanning) {
                                    clearInterval(pollTimer);
                                    checkUnscannedBtn.innerHTML = currentLang === 'zh' ? '✅ 补全完成' : '✅ Info Complete';
                                    setTimeout(() => {
                                        checkUnscannedBtn.innerHTML = currentLang === 'zh' ? '🔍 检查并极速录入缺失模型信息' : '🔍 Check & Auto-Scan Missing Info';
                                        checkUnscannedBtn.disabled = false;
                                    }, 3000);
                                }
                            } catch (e) { }
                        }, 3000);
                    } else {
                        alert((currentLang === 'zh' ? '错误: ' : 'Error: ') + scanData.message);
                        checkUnscannedBtn.disabled = false;
                        checkUnscannedBtn.innerHTML = currentLang === 'zh' ? '🔍 检查并极速录入缺失模型信息' : '🔍 Check & Auto-Scan Missing Info';
                    }
                } else {
                    checkUnscannedBtn.innerHTML = currentLang === 'zh' ? '✨ 所有模型信息已完整' : '✨ All Model Info is Complete';
                    setTimeout(() => {
                        checkUnscannedBtn.innerHTML = currentLang === 'zh' ? '🔍 检查并极速录入缺失模型信息' : '🔍 Check & Auto-Scan Missing Info';
                        checkUnscannedBtn.disabled = false;
                    }, 3000);
                }
            } catch (e) {
                checkUnscannedBtn.disabled = false;
                checkUnscannedBtn.innerHTML = currentLang === 'zh' ? '🔍 检查并极速录入缺失模型信息' : '🔍 Check & Auto-Scan Missing Info';
            }
        };

        const scaleContainer = document.createElement('div');
        scaleContainer.style.display = 'flex';
        scaleContainer.style.alignItems = 'center';
        scaleContainer.style.justifyContent = 'space-between';
        scaleContainer.style.background = '#1a1a1a';
        scaleContainer.style.padding = '8px 12px';
        scaleContainer.style.borderRadius = '4px';
        scaleContainer.style.border = '2px solid #555';
        scaleContainer.style.marginBottom = '4px';

        const scaleLabel = document.createElement('span');
        scaleLabel.id = 'anomalous-scale-label';
        scaleLabel.innerText = currentLang === 'zh' ? 'UI 缩放' : 'UI Scale';
        scaleLabel.style.color = '#ccc';
        scaleLabel.style.fontSize = '0.9em';

        let currentScale = parseFloat(savedScale);

        const controlsWrapper = document.createElement('div');
        controlsWrapper.style.display = 'flex';
        controlsWrapper.style.alignItems = 'center';
        controlsWrapper.style.gap = '8px';

        const scaleVal = document.createElement('span');
        scaleVal.innerText = `${Math.round(currentScale * 100)}%`;
        scaleVal.style.color = '#fff';
        scaleVal.style.fontSize = '0.9em';
        scaleVal.style.minWidth = '45px';
        scaleVal.style.textAlign = 'center';

        const createScaleBtn = (text, delta) => {
            const btn = document.createElement('button');
            btn.innerText = text;
            btn.style.background = '#333';
            btn.style.color = '#fff';
            btn.style.border = '1px solid #555';
            btn.style.borderRadius = '4px';
            btn.style.width = '24px';
            btn.style.height = '24px';
            btn.style.cursor = 'pointer';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.onmouseover = () => btn.style.background = '#444';
            btn.onmouseout = () => btn.style.background = '#333';
            btn.onclick = () => {
                currentScale = Math.max(0.5, Math.min(1.5, currentScale + delta));
                scaleVal.innerText = `${Math.round(currentScale * 100)}%`;
                container.style.setProperty('--anomalous-scale', currentScale);
                localStorage.setItem('anomalous_ui_scale', currentScale);
            };
            return btn;
        };

        const minusBtn = createScaleBtn('-', -0.1);
        const plusBtn = createScaleBtn('+', 0.1);

        controlsWrapper.appendChild(minusBtn);
        controlsWrapper.appendChild(scaleVal);
        controlsWrapper.appendChild(plusBtn);

        scaleContainer.appendChild(scaleLabel);
        scaleContainer.appendChild(controlsWrapper);

        const resetBtn = document.createElement('button');
        resetBtn.id = 'anomalous-reset-btn';
        resetBtn.innerHTML = currentLang === 'zh' ? '🔄 重置界面布局' : '🔄 Reset Layout';
        styleHubBtn(resetBtn);
        resetBtn.onclick = () => {
            if (confirm(currentLang === 'zh' ? '确认重置窗口位置、缩放和停靠状态吗？' : 'Reset window position, scale and dock state?')) {
                localStorage.removeItem('anomalous_pos_x');
                localStorage.removeItem('anomalous_pos_y');
                localStorage.removeItem('anomalous_width');
                localStorage.removeItem('anomalous_height');
                localStorage.removeItem('anomalous_docked');
                localStorage.removeItem('anomalous_ui_scale');
                container.style.left = '5%';
                container.style.top = '5%';
                container.style.width = '90%';
                container.style.height = '90%';
                container.style.setProperty('--anomalous-scale', '1');
                currentScale = 1;
                scaleVal.innerText = '100%';
                if (container.classList.contains('anomalous-docked')) {
                    container.classList.remove('anomalous-docked');
                }
            }
        };

        settingsHubModal.appendChild(missingBtn);
        settingsHubModal.appendChild(checkUnscannedBtn);
        settingsHubModal.appendChild(globalScanBtn);
        settingsHubModal.appendChild(cleanBtn);
        settingsHubModal.appendChild(energyBtn);
        settingsHubModal.appendChild(apiKeyBtn);
        settingsHubModal.appendChild(scaleContainer);
        settingsHubModal.appendChild(langBtn);
        settingsHubModal.appendChild(helpBtn);
        settingsHubModal.appendChild(resetBtn);

        this.sidebarWrapper.appendChild(settingsHubModal);

        const settingsBtn = document.createElement('button');
        settingsBtn.innerHTML = `⚙️`;
        settingsBtn.title = 'Settings Hub';
        settingsBtn.style.background = 'transparent';
        settingsBtn.style.color = '#ccc';
        settingsBtn.style.border = 'none';
        settingsBtn.style.borderRadius = '6px';
        settingsBtn.style.padding = '6px';
        settingsBtn.style.fontSize = '1.1em';
        settingsBtn.style.marginLeft = 'auto';
        settingsBtn.style.cursor = 'pointer';
        settingsBtn.style.transition = 'all 0.2s ease';
        settingsBtn.onmouseover = () => { settingsBtn.style.background = 'rgba(255,255,255,0.1)'; settingsBtn.style.color = '#fff'; };
        settingsBtn.onmouseout = () => { settingsBtn.style.background = 'transparent'; settingsBtn.style.color = '#ccc'; };
        const closeSettingsHub = (e) => {
            if (settingsHubModal.style.display !== 'none' && !settingsHubModal.contains(e.target) && !settingsBtn.contains(e.target)) {
                settingsHubModal.style.display = 'none';
                settingsBtn.style.color = '#ccc';
                document.removeEventListener('mousedown', closeSettingsHub);
            }
        };

        settingsBtn.onclick = () => {
            if (settingsHubModal.style.display === 'none') {
                settingsHubModal.style.display = 'flex';
                settingsBtn.style.color = '#fff';
                // Delay adding the listener slightly to avoid triggering it on the same click
                setTimeout(() => document.addEventListener('mousedown', closeSettingsHub), 10);
            } else {
                settingsHubModal.style.display = 'none';
                settingsBtn.style.color = '#ccc';
                document.removeEventListener('mousedown', closeSettingsHub);
            }
        };

        this.sidebarActions.appendChild(fixBtn);
        this.sidebarActions.appendChild(settingsBtn);

        this.grid = document.createElement('div');
        this.grid.id = 'anomalous-grid';

        this.detailPanel = document.createElement('div');
        this.detailPanel.id = 'anomalous-detail';
        this.detailPanel.style.display = 'none';

        this.galleryPanel = document.createElement('div');
        this.galleryPanel.id = 'anomalous-gallery-panel';

        this.galleryGrid = document.createElement('div');
        this.galleryGrid.className = 'anomalous-gallery-grid';
        this.galleryPanel.appendChild(this.galleryGrid);

        this.gallerySentinel = document.createElement('div');
        this.gallerySentinel.className = 'anomalous-gallery-sentinel';
        this.galleryGrid.appendChild(this.gallerySentinel);

        this.galleryCurrentPage = 1;
        this.galleryLoaded = false;
        this.galleryLoading = false;
        this.galleryHasMore = true;

        this.galleryObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !this.galleryLoading && this.galleryHasMore) {
                this.loadGalleryImages(this.galleryCurrentPage + 1);
            }
        }, { root: this.galleryGrid, rootMargin: '100px' });
        this.galleryObserver.observe(this.gallerySentinel);

        this.nbPanel = document.createElement('div');
        this.nbPanel.className = 'anomalous-nb-modal';
        this.nbPanel.style.display = 'none';
        this.nbPanel.onclick = (e) => {
            if (e.target === this.nbPanel) this.nbPanel.style.display = 'none';
        };

        content.appendChild(header);
        content.appendChild(this.grid);
        content.appendChild(this.detailPanel);
        content.appendChild(this.galleryPanel);

        container.appendChild(this.sidebarWrapper);
        container.appendChild(content);
        container.appendChild(this.nbPanel);

        this.modal.appendChild(container);

        // Resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'anomalous-resize-handle';
        let isResizing = false;
        resizeHandle.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            isResizing = true;
        };
        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const rect = container.getBoundingClientRect();
            let newWidth = e.clientX - rect.left;
            let newHeight = e.clientY - rect.top;
            if (newWidth < 600) newWidth = 600;
            if (newHeight < 400) newHeight = 400;
            container.style.width = newWidth + 'px';
            container.style.height = newHeight + 'px';
        });
        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                localStorage.setItem('anomalous_width', container.style.width);
                localStorage.setItem('anomalous_height', container.style.height);
            }
        });
        const savedW = localStorage.getItem('anomalous_width');
        const savedH = localStorage.getItem('anomalous_height');
        if (savedW) container.style.width = savedW;
        if (savedH) container.style.height = savedH;

        container.appendChild(resizeHandle);
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
        box.style.maxHeight = '90vh';

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
        closeX.style.position = 'absolute';
        closeX.style.top = '10px';
        closeX.style.right = '15px';
        closeX.style.fontSize = '1.8em';
        closeX.style.cursor = 'pointer';
        closeX.style.color = '#ff4444';
        closeX.onclick = () => this.helpModal.remove();

        header.appendChild(title);
        header.appendChild(closeX);

        const body = document.createElement('div');
        body.style.padding = '20px';
        body.innerHTML = t('helpContent');
        body.style.overflowY = 'auto';
        body.style.flex = '1';

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
            this.foldersData = data.folders || [];

            if (!this.firstLoadDone && this.foldersData.length > 0) {
                this.firstLoadDone = true;
                let found = false;
                for (const typeGroup of this.foldersData) {
                    const sortedPaths = Object.keys(typeGroup.folders).sort();
                    for (const path of sortedPaths) {
                        if (typeGroup.folders[path].model_count > 0) {
                            this.currentType = typeGroup.type;
                            this.currentPathIdx = typeGroup.path_idx;
                            this.currentSubfolder = path;
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }
            }

            // Auto expand all
            (this.foldersData || []).forEach(typeGroup => {
                this.expandedFolders.add(typeGroup.type);
                Object.keys(typeGroup.folders).forEach(path => {
                    this.expandedFolders.add(typeGroup.type + path);
                });
            });

            this.renderSidebar();
            this.loadModels();
        } catch (e) { }
    }

    renderSidebar() {
        this.sidebar.innerHTML = '';

        const topBar = document.createElement('div');
        topBar.style.display = 'flex';
        topBar.style.justifyContent = 'space-between';
        topBar.style.alignItems = 'center';
        topBar.style.padding = '10px 15px 15px 15px';

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

        const searchBox = document.createElement('div');
        searchBox.style.padding = '0 15px 15px 15px';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = '🔍 搜索模型 (Search)...';
        searchInput.style.width = '100%';
        searchInput.style.padding = '8px 12px';
        searchInput.style.borderRadius = '8px';
        searchInput.style.border = '1px solid rgba(255,255,255,0.1)';
        searchInput.style.background = 'rgba(0,0,0,0.2)';
        searchInput.style.color = '#fff';
        searchInput.style.boxSizing = 'border-box';
        searchInput.style.outline = 'none';
        searchInput.style.transition = 'border-color 0.2s';
        searchInput.onfocus = () => searchInput.style.border = '1px solid #007aff';
        searchInput.onblur = () => searchInput.style.border = '1px solid rgba(255,255,255,0.1)';

        searchInput.oninput = (e) => {
            const val = e.target.value.toLowerCase();
            const cards = this.grid.querySelectorAll('.anomalous-card');
            cards.forEach(card => {
                const titleEl = card.querySelector('.anomalous-card-title');
                if (!titleEl) return;
                const titleText = titleEl.innerText.toLowerCase();
                if (titleText.includes(val)) {
                    card.style.display = 'flex';
                } else {
                    card.style.display = 'none';
                }
            });
        };

        searchBox.appendChild(searchInput);
        this.sidebar.appendChild(searchBox);

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
                    toggleIcon = `<span class="anomalous-folder-toggle" style="margin-right: 8px; width: 12px; display: inline-block; font-size: 0.8em; color: #888;">${isExpanded ? '▼' : '▶'}</span>`;
                } else {
                    toggleIcon = `<span style="margin-right: 8px; width: 12px; display: inline-block;"></span>`;
                }

                item.innerHTML = `${toggleIcon}<span class="anomalous-folder-name" style="color: #ddd;">${info.name}</span> <span style="opacity:0.4; font-size:0.8em; margin-left: 5px;">${info.model_count}</span>`;

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

            if (window.anomalous_update_hash_cache && data.models) {
                window.anomalous_update_hash_cache(data.models);
            }

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
                            card.addEventListener('mouseenter', () => video.play().catch(e => { }));
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

                card.onclick = () => { this.historyStack = []; this.currentDetailModel = model; this.showDetail(model); };

                const applyBtn = document.createElement('button');
                applyBtn.innerHTML = '➕';
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


                this.grid.appendChild(card);
            });
        } catch (e) { }
    }


    applyModelToCanvas(type, subfolder, model) {
        const nodeTypeMap = {
            'checkpoints': 'CheckpointLoaderSimple',
            'loras': 'LoraLoader',
            'unet': 'UNETLoader',
            'diffusion_models': 'UNETLoader'
        };
        const nodeType = nodeTypeMap[type];
        if (!nodeType) {
            alert(currentLang === 'zh' ? '不支持该类型模型的自动应用。' : 'Unsupported model type for auto-apply.');
            return;
        }

        const node = LiteGraph.createNode(nodeType);
        if (!node) {
            alert((currentLang === 'zh' ? '创建节点失败: ' : 'Failed to create node: ') + nodeType);
            return;
        }

        if (app.canvas && app.canvas.graph_mouse) {
            node.pos = [
                app.canvas.graph_mouse[0] || (window.innerWidth / 2),
                app.canvas.graph_mouse[1] || (window.innerHeight / 2)
            ];
        } else {
            node.pos = [window.innerWidth / 2, window.innerHeight / 2];
        }

        app.graph.add(node);

        const sub = subfolder.replace(/^\/+/, '').replace(/\/+$/, '');
        const relPath = sub ? `${sub}/${model.filename}` : model.filename;

        this.setWidgetValuePath(node, relPath);

        this.close();

        // 粘到鼠标上的逻辑
        let isSticking = true;
        const stickHandler = (e) => {
            if (!isSticking || !app.canvas) return;
            const canvas = app.canvas;

            // LiteGraph内置了坐标转换，它会完美处理缩放和偏移带来的坐标偏移问题
            let canvasX, canvasY;
            if (canvas.convertEventToCanvasOffset) {
                const pos = canvas.convertEventToCanvasOffset(e);
                canvasX = pos[0];
                canvasY = pos[1];
            } else {
                // 如果API不可用，使用标准降级计算
                const rect = canvas.canvas.getBoundingClientRect();
                canvasX = (e.clientX - rect.left - canvas.ds.offset[0]) / canvas.ds.scale;
                canvasY = (e.clientY - rect.top - canvas.ds.offset[1]) / canvas.ds.scale;
            }

            const w = (node.size && node.size[0]) ? node.size[0] : 200;
            node.pos = [canvasX - w / 2, canvasY - 20];
            canvas.setDirty(true, true);
        };
        const dropHandler = (e) => {
            if (!isSticking) return;
            isSticking = false;
            window.removeEventListener('mousemove', stickHandler, true);
            window.removeEventListener('pointerdown', dropHandler, true);
            window.removeEventListener('mousedown', dropHandler, true);
            window.removeEventListener('click', dropHandler, true);
            e.preventDefault();
            e.stopPropagation();
        };
        window.addEventListener('mousemove', stickHandler, true);
        setTimeout(() => {
            window.addEventListener('pointerdown', dropHandler, true);
            window.addEventListener('mousedown', dropHandler, true);
            window.addEventListener('click', dropHandler, true);
        }, 100);
    }

    showDetail(model) {
        if (this.currentDetailObserver) {
            this.currentDetailObserver.disconnect();
            this.currentDetailObserver = null;
        }
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
        backBtn.innerHTML = this.historyStack.length > 0 ? t('backToPrev') : t('back');
        backBtn.style.padding = '6px 12px';
        backBtn.style.background = '#444';
        backBtn.style.color = '#fff';
        backBtn.style.border = 'none';
        backBtn.style.borderRadius = '4px';
        backBtn.style.cursor = 'pointer';
        backBtn.onclick = () => {
            if (this.currentDetailObserver) {
                this.currentDetailObserver.disconnect();
                this.currentDetailObserver = null;
            }
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

        const title = document.createElement('h2');
        title.innerHTML = model.filename;
        title.style.margin = '0 20px 0 20px';
        title.style.color = '#fff';
        title.style.fontSize = '1.2em';
        // 强制单行并溢出显示省略号
        title.style.whiteSpace = 'nowrap';
        title.style.overflow = 'hidden';
        title.style.textOverflow = 'ellipsis';
        title.style.flex = '1'; // 撑开剩余空间，把右侧按钮挤到最右边

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
                    if (this.currentDetailObserver) {
                        this.currentDetailObserver.disconnect();
                        this.currentDetailObserver = null;
                    }
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

        const jumpBtn = document.createElement('button');
        jumpBtn.innerHTML = '⬇️';
        jumpBtn.title = t('jumpToBottom') || 'Jump to bottom';
        jumpBtn.style.padding = '6px 12px';
        jumpBtn.style.background = '#444';
        jumpBtn.style.color = '#fff';
        jumpBtn.style.border = 'none';
        jumpBtn.style.borderRadius = '4px';
        jumpBtn.style.cursor = 'pointer';
        jumpBtn.style.marginLeft = '10px';
        jumpBtn.onclick = () => {
            // Find rightPanel which is created later, so we bind it dynamically
            const rp = this.detailPanel.querySelector('.anomalous-split-right');
            if (rp) rp.scrollTo({ top: rp.scrollHeight, behavior: 'smooth' });
        };

        header.appendChild(backBtn);
        header.appendChild(title);
        header.appendChild(delBtn);
        header.appendChild(jumpBtn);

        const applyDetailBtn = document.createElement('button');
        applyDetailBtn.innerHTML = t('applyToCanvas') || 'Apply to Canvas';
        applyDetailBtn.style.padding = '6px 12px';
        applyDetailBtn.style.background = '#007bff';
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


        const splitContainer = document.createElement('div');
        splitContainer.className = 'anomalous-split-container';

        const leftPanel = document.createElement('div');
        leftPanel.className = 'anomalous-split-left';

        let isMediaRendered = null;
        const renderMedia = (shouldRender) => {
            if (shouldRender === isMediaRendered) return;
            isMediaRendered = shouldRender;
            leftPanel.innerHTML = '';
            if (!shouldRender) return;

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
        };

        const containerEl = document.getElementById('anomalous-container');
        this.currentDetailObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                renderMedia(entry.contentRect.width >= 750);
            }
        });
        this.currentDetailObserver.observe(containerEl);

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

        // --- Compatible Models Section ---
        if (m.baseModel) {
            const compSec = document.createElement('div');
            compSec.className = 'anomalous-compatible-section';

            const compTitle = document.createElement('div');
            compTitle.className = 'anomalous-compatible-title';
            compTitle.innerHTML = `${t('compatibleModels') || '🔗 Compatible'} <span style="font-size:0.8em; opacity:0.6;">(${m.baseModel})</span>`;

            const compList = document.createElement('div');
            compList.className = 'anomalous-compatible-list';
            compList.innerHTML = `<span style="color:#888;">${t('loadingCompatible') || 'Loading...'}</span>`;

            compSec.appendChild(compTitle);
            compSec.appendChild(compList);
            rightPanel.appendChild(compSec);

            const targetType = this.currentType === 'loras' ? 'checkpoints,unet,diffusion_models' : 'loras';
            fetch(`/anomalous/compatible_models?base_model=${encodeURIComponent(m.baseModel)}&target_type=${encodeURIComponent(targetType)}`)
                .then(r => r.json())
                .then(d => {
                    compList.innerHTML = '';
                    if (window.anomalous_update_hash_cache && d.models) {
                        window.anomalous_update_hash_cache(d.models);
                    }
                    if (!d.models || d.models.length === 0) {
                        compList.innerHTML = `<span style="color:#888;">No compatible models found.</span>`;
                        return;
                    }
                    d.models.forEach(m_comp => {
                        const mItem = document.createElement('div');
                        mItem.className = 'anomalous-compatible-item';
                        mItem.title = m_comp.filename;

                        let thumb = '';
                        if (m_comp.preview_url) {
                            const isVid = m_comp.preview_url.toLowerCase().endsWith('.mp4') || m_comp.preview_url.toLowerCase().endsWith('.webm');
                            if (isVid) thumb = `<video src="${m_comp.preview_url}" muted loop playsinline></video>`;
                            else thumb = `<img src="${m_comp.preview_url}" />`;
                        } else {
                            thumb = `<div style="width:30px; height:30px; background:#222; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#555;">?</div>`;
                        }

                        mItem.innerHTML = `${thumb}<div class="anomalous-compatible-item-name">${m_comp.filename}</div>`;

                        if (m_comp.preview_url && (m_comp.preview_url.toLowerCase().endsWith('.mp4') || m_comp.preview_url.toLowerCase().endsWith('.webm'))) {
                            mItem.onmouseenter = () => { const v = mItem.querySelector('video'); if (v) v.play().catch(e => { }); };
                            mItem.onmouseleave = () => { const v = mItem.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } };
                        }

                        mItem.onclick = () => {
                            this.historyStack.push({
                                type: this.currentType,
                                pathIdx: this.currentPathIdx,
                                subfolder: this.currentSubfolder,
                                model: this.currentDetailModel
                            });

                            this.currentType = m_comp.type;
                            this.currentPathIdx = m_comp.path_idx;
                            this.currentSubfolder = m_comp.subfolder;
                            this.currentDetailModel = m_comp;

                            this.renderSidebar();
                            this.showDetail(m_comp);
                        };

                        compList.appendChild(mItem);
                    });
                })
                .catch(e => {
                    compList.innerHTML = `<span style="color:#ff4444;">Failed to load.</span>`;
                });
        }
        // ---------------------------------

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

    async showNotebooks() {
        if (this.nbInitialized) {
            this.refreshNotebooks(true);
            return;
        }
        this.nbInitialized = true;

        this.nbPanel.innerHTML = '';

        const nbContainer = document.createElement('div');
        nbContainer.className = 'anomalous-nb-container';

        const nbHeader = document.createElement('div');
        nbHeader.className = 'anomalous-nb-header';
        nbHeader.innerHTML = `<h2>${t('notebookTitle')}</h2>`;
        const closeNb = document.createElement('span');
        closeNb.className = 'anomalous-nb-close';
        closeNb.innerHTML = '&times;';
        closeNb.onclick = () => { this.nbPanel.style.display = 'none'; };
        nbHeader.appendChild(closeNb);

        const body = document.createElement('div');
        body.className = 'anomalous-nb-body';

        // Sidebar for notebooks list
        const sidebar = document.createElement('div');
        sidebar.className = 'anomalous-nb-sidebar';

        const nbList = document.createElement('div');
        nbList.className = 'anomalous-nb-list';

        const btnRow = document.createElement('div');
        btnRow.style.padding = '10px';
        btnRow.style.display = 'flex';
        btnRow.style.gap = '5px';

        const createBtn = document.createElement('button');
        createBtn.innerHTML = `➕ <span class="anomalous-nb-create-text">${t('createNotebook')}</span>`;
        createBtn.className = 'anomalous-btn-primary';

        const createInput = document.createElement('input');
        createInput.type = 'text';
        createInput.placeholder = t('newNotebookName');
        createInput.style.display = 'none';
        createInput.style.flex = '1';
        createInput.style.padding = '4px';
        createInput.style.background = '#222';
        createInput.style.color = '#fff';
        createInput.style.border = '1px solid #555';
        createInput.style.borderRadius = '4px';

        createBtn.onclick = () => {
            if (createInput.style.display === 'none') {
                createInput.style.display = 'block';
                createBtn.innerHTML = '✓';
                createInput.focus();
            } else {
                const name = createInput.value.trim();
                if (name) {
                    this.currentNotebook = { filename: name + '.json', name: name, data: { baseModel: '', mainModel: null, loras: [], promptEn: '', promptZh: '' } };
                    this.saveCurrentNotebook();
                    this.renderNotebookEditor();
                    createInput.value = '';
                }
                createInput.style.display = 'none';
                createBtn.innerHTML = `➕ <span class="anomalous-nb-create-text">${t('createNotebook')}</span>`;
            }
        };

        btnRow.appendChild(createInput);
        btnRow.appendChild(createBtn);
        sidebar.appendChild(btnRow);
        sidebar.appendChild(nbList);

        // Editor area
        this.nbEditor = document.createElement('div');
        this.nbEditor.className = 'anomalous-nb-editor';

        body.appendChild(sidebar);
        body.appendChild(this.nbEditor);

        nbContainer.appendChild(nbHeader);
        nbContainer.appendChild(body);

        this.nbPanel.appendChild(nbContainer);

        this.nbListEl = nbList;
        this.refreshNotebooks(true);
    }

    async translateText(text) {
        if (!text || !text.trim()) return "";
        try {
            const res = await fetch('/anomalous/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, target_lang: currentLang === 'zh' ? 'zh-CN' : 'en' })
            });
            const data = await res.json();
            return data.translated || text;
        } catch (e) { return text; }
    }

    async loadGalleryImages(page = 1, reset = false) {
        if (this.galleryLoading) return;
        this.galleryLoading = true;
        this.gallerySentinel.innerHTML = '加载中... / Loading...';

        try {
            const res = await fetch(`/anomalous/gallery_images?page=${page}&limit=50`);
            const data = await res.json();

            if (reset) {
                // Clear existing cards
                const cards = this.galleryGrid.querySelectorAll('.anomalous-gallery-card');
                cards.forEach(c => c.remove());
                this.galleryLoaded = true;
            }

            if (data.images && data.images.length > 0) {
                data.images.forEach(imgData => {
                    const card = document.createElement('div');
                    card.className = 'anomalous-gallery-card';

                    const q_sub = encodeURIComponent(imgData.subfolder);
                    const q_file = encodeURIComponent(imgData.filename);
                    const imgUrl = `/view?filename=${q_file}&subfolder=${q_sub}&type=output`;

                    const img = document.createElement('img');
                    img.src = imgUrl;
                    img.loading = 'lazy';
                    img.draggable = true;

                    // Drag and drop support for ComfyUI
                    img.addEventListener('dragstart', (e) => {
                        const fullUrl = new URL(imgUrl, window.location.href).href;
                        e.dataTransfer.setData('text/uri-list', fullUrl);
                        e.dataTransfer.setData('text/plain', fullUrl);
                        
                        // Fix for Chromium failing to initiate drag for extremely large (Hires Fix) images
                        if (window.anomalousDragGhostImg) {
                            e.dataTransfer.setDragImage(window.anomalousDragGhostImg, 40, 40);
                        }
                    });

                    // Click to view
                    img.onclick = () => this.showGalleryViewer(imgUrl);

                    const delBtn = document.createElement('button');
                    delBtn.className = 'anomalous-gallery-delete';
                    delBtn.innerHTML = '🗑️';
                    delBtn.title = 'Delete';

                    delBtn.onclick = (e) => {
                        e.stopPropagation();

                        const overlay = document.createElement('div');
                        overlay.style.position = 'absolute';
                        overlay.style.top = '0';
                        overlay.style.left = '0';
                        overlay.style.width = '100%';
                        overlay.style.height = '100%';
                        overlay.style.background = 'rgba(0,0,0,0.85)';
                        overlay.style.display = 'flex';
                        overlay.style.flexDirection = 'column';
                        overlay.style.alignItems = 'center';
                        overlay.style.justifyContent = 'center';
                        overlay.style.gap = '15px';
                        overlay.style.zIndex = '10';

                        const msg = document.createElement('div');
                        msg.innerHTML = '彻底删除这张图片？<br><span style="font-size:0.8em;color:#aaa">Delete permanently?</span>';
                        msg.style.color = '#fff';
                        msg.style.fontWeight = 'bold';
                        msg.style.textAlign = 'center';

                        const btnRow = document.createElement('div');
                        btnRow.style.display = 'flex';
                        btnRow.style.gap = '12px';

                        const confirmBtn = document.createElement('button');
                        confirmBtn.innerHTML = currentLang === 'zh' ? '🗑️ 删除' : '🗑️ Delete';
                        confirmBtn.style.background = '#dc3545';
                        confirmBtn.style.color = '#fff';
                        confirmBtn.style.border = 'none';
                        confirmBtn.style.padding = '10px 16px';
                        confirmBtn.style.borderRadius = '6px';
                        confirmBtn.style.cursor = 'pointer';
                        confirmBtn.style.fontWeight = 'bold';
                        confirmBtn.style.transition = 'background 0.2s';
                        confirmBtn.onmouseover = () => confirmBtn.style.background = '#ff0000';
                        confirmBtn.onmouseout = () => confirmBtn.style.background = '#dc3545';

                        const cancelBtn = document.createElement('button');
                        cancelBtn.innerHTML = '取消 (Cancel)';
                        cancelBtn.style.background = '#444';
                        cancelBtn.style.color = '#fff';
                        cancelBtn.style.border = 'none';
                        cancelBtn.style.padding = '10px 16px';
                        cancelBtn.style.borderRadius = '6px';
                        cancelBtn.style.cursor = 'pointer';
                        cancelBtn.style.transition = 'background 0.2s';
                        cancelBtn.onmouseover = () => cancelBtn.style.background = '#666';
                        cancelBtn.onmouseout = () => cancelBtn.style.background = '#444';

                        cancelBtn.onclick = (ce) => {
                            ce.stopPropagation();
                            overlay.remove();
                        };

                        confirmBtn.onclick = async (ce) => {
                            ce.stopPropagation();
                            confirmBtn.innerHTML = currentLang === 'zh' ? '删除中...' : 'Deleting...';
                            confirmBtn.disabled = true;
                            try {
                                const dr = await fetch('/anomalous/delete_gallery_image', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ filename: imgData.filename, subfolder: imgData.subfolder })
                                });
                                const dd = await dr.json();
                                if (dd.status === 'success') {
                                    card.remove();
                                } else {
                                    alert((currentLang === 'zh' ? '删除失败: ' : 'Delete failed: ') + dd.message);
                                    overlay.remove();
                                }
                            } catch (err) {
                                alert((currentLang === 'zh' ? '错误: ' : 'Error: ') + err);
                                overlay.remove();
                            }
                        };

                        btnRow.appendChild(cancelBtn);
                        btnRow.appendChild(confirmBtn);
                        overlay.appendChild(msg);
                        overlay.appendChild(btnRow);

                        card.appendChild(overlay);
                    };

                    card.appendChild(img);
                    card.appendChild(delBtn);
                    this.galleryGrid.insertBefore(card, this.gallerySentinel);
                });

                this.galleryCurrentPage = page;
                this.galleryHasMore = page < data.pages;

                if (!this.galleryHasMore) {
                    this.gallerySentinel.innerHTML = '没有更多图片了 / No more images';
                } else {
                    this.gallerySentinel.innerHTML = '向下滚动加载更多 / Scroll for more';
                }
            } else {
                this.galleryHasMore = false;
                this.gallerySentinel.innerHTML = reset ? '图库为空 / Gallery is empty' : '没有更多图片了 / No more images';
            }
        } catch (e) {
            console.error('Failed to load gallery images', e);
            this.gallerySentinel.innerHTML = '加载失败 / Load failed';
        }

        this.galleryLoading = false;
    }

    showGalleryViewer(src) {
        let viewer = document.getElementById('anomalous-gallery-viewer');
        if (!viewer) {
            viewer = document.createElement('div');
            viewer.id = 'anomalous-gallery-viewer';
            viewer.className = 'anomalous-gallery-viewer';

            const closeBtn = document.createElement('div');
            closeBtn.className = 'anomalous-gallery-viewer-close';
            closeBtn.innerHTML = '&times;';
            closeBtn.onclick = () => { viewer.style.display = 'none'; };

            const img = document.createElement('img');
            img.id = 'anomalous-gallery-viewer-img';

            viewer.appendChild(img);
            viewer.appendChild(closeBtn);

            viewer.onclick = (e) => {
                if (e.target === viewer) viewer.style.display = 'none';
            };

            document.body.appendChild(viewer);
        }

        const img = document.getElementById('anomalous-gallery-viewer-img');
        img.src = src;
        viewer.style.display = 'flex';
    }

    async refreshNotebooks(autoOpenFirst = false) {
        try {
            const res = await fetch('/anomalous/notebooks');
            const data = await res.json();
            this.nbListEl.innerHTML = '';

            if (data.notebooks && data.notebooks.length > 0) {
                if (autoOpenFirst) {
                    if (!this.currentNotebook) {
                        this.currentNotebook = data.notebooks[0];
                    }
                    if (this.currentNotebook) {
                        this.renderNotebookEditor();
                    }
                }

                data.notebooks.forEach(nb => {
                    const item = document.createElement('div');
                    item.className = 'anomalous-nb-item';
                    if (this.currentNotebook && this.currentNotebook.filename === nb.filename) {
                        item.classList.add('active');
                    }
                    item.innerHTML = `<span class="anomalous-nb-item-icon">📄&nbsp;</span><span class="anomalous-nb-item-text">${nb.name}</span>`;
                    item.onclick = () => {
                        this.currentNotebook = nb;
                        this.renderNotebookEditor();
                        this.refreshNotebooks();
                    };
                    this.nbListEl.appendChild(item);
                });
            }
        } catch (e) { }
    }

    async saveCurrentNotebook() {
        if (!this.currentNotebook) return;
        try {
            await fetch('/anomalous/save_notebook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.currentNotebook)
            });
            this.refreshNotebooks();
        } catch (e) { }
    }

    async deleteCurrentNotebook(skipConfirm = false) {
        if (!this.currentNotebook) return;
        if (!skipConfirm && !confirm(t('deleteNotebook') + ' ?')) return;
        try {
            await fetch('/anomalous/delete_notebook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: this.currentNotebook.filename })
            });
            this.currentNotebook = null;
            this.nbEditor.innerHTML = '';
            this.refreshNotebooks();
        } catch (e) { }
    }

    renderNotebookEditor() {
        this.nbEditor.innerHTML = '';
        if (!this.currentNotebook) return;

        const data = this.currentNotebook.data || {};
        if (!data.loras) data.loras = [];

        // Toolbar
        const tb = document.createElement('div');
        tb.className = 'anomalous-nb-toolbar';

        const titleArea = document.createElement('h3');
        titleArea.innerHTML = this.currentNotebook.name;
        titleArea.style.margin = '0';

        const rightBtns = document.createElement('div');

        const saveBtn = document.createElement('button');
        saveBtn.innerHTML = t('saveNotebook');
        saveBtn.className = 'anomalous-btn-primary';
        saveBtn.onclick = async () => {
            const orig = saveBtn.innerHTML;
            saveBtn.innerHTML = '⏳...';
            await this.saveCurrentNotebook();
            saveBtn.innerHTML = '✅';
            saveBtn.style.background = '#2e8b57';
            setTimeout(() => {
                saveBtn.innerHTML = orig;
                saveBtn.style.background = '';
            }, 1500);
        };

        let delTimer = null;
        const delContainer = document.createElement('span');
        delContainer.style.display = 'inline-flex';
        delContainer.style.alignItems = 'center';

        const delBtn = document.createElement('button');
        delBtn.innerHTML = t('deleteNotebook');
        delBtn.className = 'anomalous-btn-danger';

        const cancelDelBtn = document.createElement('button');
        cancelDelBtn.innerHTML = '✕';
        cancelDelBtn.className = 'anomalous-btn-danger';
        cancelDelBtn.style.display = 'none';
        cancelDelBtn.style.background = '#555';
        cancelDelBtn.style.marginLeft = '2px';
        cancelDelBtn.style.padding = '6px 8px';

        delContainer.appendChild(delBtn);
        delContainer.appendChild(cancelDelBtn);

        const resetDel = () => {
            clearTimeout(delTimer);
            delBtn.innerHTML = t('deleteNotebook');
            delBtn.style.background = '';
            cancelDelBtn.style.display = 'none';
        };

        delBtn.onclick = () => {
            if (delBtn.innerHTML === t('deleteNotebook')) {
                delBtn.innerHTML = t('delSure');
                delBtn.style.background = '#800';
                cancelDelBtn.style.display = 'block';
                delTimer = setTimeout(resetDel, 4000);
            } else {
                resetDel();
                this.deleteCurrentNotebook(true);
            }
        };

        cancelDelBtn.onclick = resetDel;

        const sendBtn = document.createElement('button');
        sendBtn.innerHTML = t('sendToCanvas');
        sendBtn.className = 'anomalous-btn-success';
        sendBtn.onclick = () => this.sendNotebookToCanvas();

        rightBtns.appendChild(saveBtn);
        rightBtns.appendChild(sendBtn);
        rightBtns.appendChild(delContainer);

        tb.appendChild(titleArea);
        tb.appendChild(rightBtns);

        // Settings / Models
        const modelSection = document.createElement('div');
        modelSection.className = 'anomalous-nb-section';

        // Base Model
        const baseRow = document.createElement('div');
        baseRow.className = 'anomalous-nb-row';
        baseRow.innerHTML = `<strong>${t('baseModel')}</strong>`;
        const baseSelect = document.createElement('select');
        baseSelect.className = 'anomalous-nb-select';
        const buildSelect = (bases) => {
            baseSelect.innerHTML = '';
            bases.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b; opt.text = b;
                if (data.baseModel === b) opt.selected = true;
                baseSelect.appendChild(opt);
            });
            if (!data.baseModel && bases.length > 0) data.baseModel = bases[0];
        };

        if (this.baseModelsCache) {
            buildSelect(this.baseModelsCache);
        } else {
            const tempBases = ['SD 1.5', 'SD 2.1', 'SDXL', 'SD 3.0', 'SD 3.5', 'Flux.1', 'Pony', 'HunyuanVideo', 'LTX-Video', 'OmniGen'];
            buildSelect(tempBases);
            fetch('/anomalous/base_models').then(r => r.json()).then(d => {
                if (d.base_models && d.base_models.length > 0) {
                    this.baseModelsCache = d.base_models;
                    buildSelect(this.baseModelsCache);
                }
            }).catch(e => { });
        }
        if (!data.baseModel) data.baseModel = 'SDXL';
        baseSelect.onchange = () => {
            data.baseModel = baseSelect.value;
            data.mainModel = null;
            data.loras = [];
            this.saveCurrentNotebook();
            this.renderNotebookEditor();
        };
        baseRow.appendChild(baseSelect);

        // Main Model (Card Selection)
        const mainBox = document.createElement('div');
        mainBox.className = 'anomalous-nb-gallery-box';
        const mainRow = document.createElement('div');
        mainRow.className = 'anomalous-nb-row';
        mainRow.innerHTML = `<strong>${t('mainModel')}</strong>`;

        const mainGallery = document.createElement('div');
        mainGallery.className = 'anomalous-nb-gallery-wrap';

        mainBox.appendChild(mainRow);
        mainBox.appendChild(mainGallery);

        // Loras (Card Selection)
        const loraBox = document.createElement('div');
        loraBox.className = 'anomalous-nb-gallery-box';
        const loraRow = document.createElement('div');
        loraRow.className = 'anomalous-nb-row';
        loraRow.innerHTML = `<strong>Loras</strong>`;

        const loraGallery = document.createElement('div');
        loraGallery.className = 'anomalous-nb-gallery-wrap';

        loraBox.appendChild(loraRow);
        loraBox.appendChild(loraGallery);

        modelSection.appendChild(baseRow);
        modelSection.appendChild(mainBox);
        modelSection.appendChild(loraBox);

        // Prompt Section
        const promptSec = document.createElement('div');
        promptSec.className = 'anomalous-nb-section';

        // Toolbar
        const pToolbar = document.createElement('div');
        pToolbar.className = 'anomalous-nb-prompt-toolbar';

        const langSelect = document.createElement('select');
        langSelect.className = 'anomalous-nb-select';
        const langs = [
            { v: 'zh-CN', l: '🇨🇳 中文 (zh-CN)' }, { v: 'en', l: '🇬🇧 English (en)' },
            { v: 'ja', l: '🇯🇵 日本语 (ja)' }, { v: 'ko', l: '🇰🇷 한국어 (ko)' },
            { v: 'fr', l: '🇫🇷 Français (fr)' }, { v: 'de', l: '🇩🇪 Deutsch (de)' },
            { v: 'es', l: '🇪🇸 Español (es)' }, { v: 'ru', l: '🇷🇺 Русский (ru)' }
        ];
        langs.forEach(lg => {
            const opt = document.createElement('option');
            opt.value = lg.v; opt.text = lg.l;
            if ((data.targetLang || 'zh-CN') === lg.v) opt.selected = true;
            langSelect.appendChild(opt);
        });
        langSelect.onchange = () => {
            data.targetLang = langSelect.value;
            data.translations = {}; // Clear translation cache on lang change
            this.saveCurrentNotebook();
            updateVisualTags();
        };

        const findInput = document.createElement('input');
        findInput.className = 'anomalous-nb-select';
        findInput.placeholder = t('findPlaceholder');
        findInput.style.flex = '1';

        const replaceInput = document.createElement('input');
        replaceInput.className = 'anomalous-nb-select';
        replaceInput.placeholder = t('replacePlaceholder');
        replaceInput.style.flex = '1';

        const replaceBtn = document.createElement('button');
        replaceBtn.className = 'anomalous-btn-primary';
        replaceBtn.innerHTML = t('replaceAll');

        pToolbar.appendChild(langSelect);
        pToolbar.appendChild(findInput);
        pToolbar.appendChild(replaceInput);
        pToolbar.appendChild(replaceBtn);

        // Raw Input Toggle
        const toggleRow = document.createElement('div');
        toggleRow.style.display = 'flex';
        toggleRow.style.justifyContent = 'space-between';
        toggleRow.style.marginBottom = '5px';
        toggleRow.innerHTML = `<strong>Prompt Editor</strong>`;
        const rawBtn = document.createElement('button');
        rawBtn.className = 'anomalous-btn-primary';
        rawBtn.innerHTML = t('editRaw');
        toggleRow.appendChild(rawBtn);

        // Raw Textarea
        const rawArea = document.createElement('textarea');
        rawArea.className = 'anomalous-nb-textarea';
        rawArea.value = data.promptEn || '';
        rawArea.style.display = 'none';
        rawArea.style.height = '150px';

        // Visual Dual Pane
        const dualPane = document.createElement('div');
        dualPane.className = 'anomalous-nb-dual-pane';

        if (!data.translations) data.translations = {};

        const updateVisualTags = () => {
            dualPane.innerHTML = '';
            const txt = rawArea.value;
            data.promptEn = txt;
            this.saveCurrentNotebook();
            if (!txt.trim()) return;

            const tags = txt.split(',').map(s => s.trim()).filter(s => s);
            tags.forEach((tag, idx) => {
                const tagRow = document.createElement('div');
                tagRow.className = 'anomalous-nb-tag-row';

                const tagL = document.createElement('div');
                tagL.className = 'anomalous-nb-visual-tag';
                tagL.style.flex = '1';
                tagL.style.justifyContent = 'space-between';
                const txtL = document.createElement('span');
                txtL.innerText = tag;
                const copyL = document.createElement('span');
                copyL.className = 'anomalous-nb-copy-btn';
                copyL.innerHTML = '📋';
                copyL.onclick = (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(tag).then(() => { copyL.innerHTML = '✅'; setTimeout(() => copyL.innerHTML = '📋', 1000); });
                };
                tagL.appendChild(txtL);
                tagL.appendChild(copyL);

                const tagR = document.createElement('div');
                tagR.className = 'anomalous-nb-visual-tag';
                tagR.style.flex = '1';
                tagR.style.justifyContent = 'space-between';
                const transTxt = data.translations[tag] ? data.translations[tag] : '...';
                const txtR = document.createElement('span');
                txtR.innerText = transTxt;
                const copyR = document.createElement('span');
                copyR.className = 'anomalous-nb-copy-btn';
                copyR.innerHTML = '📋';
                copyR.onclick = (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(txtR.innerText).then(() => { copyR.innerHTML = '✅'; setTimeout(() => copyR.innerHTML = '📋', 1000); });
                };
                tagR.appendChild(txtR);
                tagR.appendChild(copyR);

                tagL.onmouseenter = () => { tagL.classList.add('hover'); tagR.classList.add('hover'); };
                tagL.onmouseleave = () => { tagL.classList.remove('hover'); tagR.classList.remove('hover'); };
                tagR.onmouseenter = () => { tagL.classList.add('hover'); tagR.classList.add('hover'); };
                tagR.onmouseleave = () => { tagL.classList.remove('hover'); tagR.classList.remove('hover'); };

                tagL.onclick = () => {
                    const inp = document.createElement('input');
                    inp.value = tag; inp.className = 'anomalous-nb-tag-edit';
                    tagL.innerHTML = ''; tagL.appendChild(inp); inp.focus();
                    const finish = () => {
                        tags[idx] = inp.value.trim();
                        rawArea.value = tags.join(', ');
                        updateVisualTags();
                    };
                    inp.onblur = finish;
                    inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
                };

                tagR.onclick = () => {
                    const inp = document.createElement('input');
                    inp.value = data.translations[tag] || ''; inp.className = 'anomalous-nb-tag-edit';
                    tagR.innerHTML = ''; tagR.appendChild(inp); inp.focus();
                    const finish = () => {
                        data.translations[tag] = inp.value.trim();
                        this.saveCurrentNotebook();
                        updateVisualTags();
                    };
                    inp.onblur = finish;
                    inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
                };

                tagRow.appendChild(tagL);
                tagRow.appendChild(tagR);
                dualPane.appendChild(tagRow);

                if (!data.translations[tag]) {
                    fetch('/anomalous/translate', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: tag, target_lang: data.targetLang || 'zh-CN' })
                    }).then(r => r.json()).then(d => {
                        if (d.translated) {
                            data.translations[tag] = d.translated;
                            txtR.innerText = d.translated;
                            this.saveCurrentNotebook();
                        }
                    }).catch(() => { });
                }
            });
        };

        rawBtn.onclick = () => {
            if (rawArea.style.display === 'none') {
                rawArea.style.display = 'block';
                dualPane.style.display = 'none';
                rawBtn.innerHTML = '👁️ Done Editing';
                pToolbar.style.display = 'none';
            } else {
                rawArea.style.display = 'none';
                dualPane.style.display = 'flex';
                rawBtn.innerHTML = '📝 Edit Raw / Paste';
                pToolbar.style.display = 'flex';
                updateVisualTags();
            }
        };

        replaceBtn.onclick = () => {
            const findStr = findInput.value;
            const repStr = replaceInput.value;
            if (!findStr) return;
            const newTxt = rawArea.value.split(findStr).join(repStr);
            rawArea.value = newTxt;
            updateVisualTags();
        };

        rawArea.oninput = () => {
            clearTimeout(this.pTimeout);
            this.pTimeout = setTimeout(() => { data.promptEn = rawArea.value; this.saveCurrentNotebook(); }, 500);
        };

        updateVisualTags();

        promptSec.appendChild(pToolbar);
        promptSec.appendChild(toggleRow);
        promptSec.appendChild(rawArea);
        promptSec.appendChild(dualPane);

        this.nbEditor.appendChild(tb);
        this.nbEditor.appendChild(modelSection);
        this.nbEditor.appendChild(promptSec);

        // Fetch compatible models and fill galleries
        this.fillNotebookGalleries(data.baseModel, mainGallery, loraGallery, data);
    }

    fillNotebookGalleries(baseModel, mainGallery, loraGallery, data) {
        if (!baseModel) return;

        const buildThumbHtml = (m) => {
            let thumb = '';
            if (m.preview_url) {
                const isVid = m.preview_url.toLowerCase().endsWith('.mp4') || m.preview_url.toLowerCase().endsWith('.webm');
                if (isVid) thumb = `<video src="${m.preview_url}" muted loop playsinline></video>`;
                else thumb = `<img src="${m.preview_url}" />`;
            } else {
                thumb = `<div style="width:30px; height:30px; background:#222; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#555;">?</div>`;
            }
            return thumb;
        };

        fetch(`/anomalous/compatible_models?base_model=${encodeURIComponent(baseModel)}&target_type=checkpoints,unet,diffusion_models`)
            .then(r => r.json()).then(d => {
                const buildMainDOM = (models) => {
                    mainGallery.innerHTML = '';
                    if (!models || !models.length) {
                        mainGallery.innerHTML = '<span style="color:#666;">No compatible main models found.</span>';
                    } else {
                        models.forEach(m => {
                            const isSelected = (data.mainModel && data.mainModel.filename === m.filename);
                            const card = document.createElement('div');
                            card.className = 'anomalous-nb-minicheck ' + (isSelected ? 'selected' : '');
                            card.innerHTML = `${buildThumbHtml(m)}<div class="anomalous-nb-minicheck-name" title="${m.filename}">${m.filename}</div>`;

                            if (m.preview_url && (m.preview_url.toLowerCase().endsWith('.mp4') || m.preview_url.toLowerCase().endsWith('.webm'))) {
                                card.onmouseenter = () => { const v = card.querySelector('video'); if (v) v.play().catch(e => { }); };
                                card.onmouseleave = () => { const v = card.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } };
                            }

                            card.onclick = () => {
                                data.mainModel = m;
                                this.saveCurrentNotebook();
                                buildMainDOM(models); // re-render just the main gallery
                            };
                            mainGallery.appendChild(card);
                        });
                    }
                };
                buildMainDOM(d.models || []);
            });

        fetch(`/anomalous/compatible_models?base_model=${encodeURIComponent(baseModel)}&target_type=loras`)
            .then(r => r.json()).then(d => {
                const buildLoraDOM = (models) => {
                    loraGallery.innerHTML = '';
                    if (!models || !models.length) {
                        loraGallery.innerHTML = '<span style="color:#666;">No compatible Loras found.</span>';
                    } else {
                        models.forEach(m => {
                            const loraIndex = data.loras.findIndex(l => l.filename === m.filename);
                            const isSelected = loraIndex !== -1;
                            const card = document.createElement('div');
                            card.className = 'anomalous-nb-minilora ' + (isSelected ? 'selected' : '');
                            card.style.position = 'relative'; // for badge positioning

                            let badgeHtml = '';
                            if (isSelected) {
                                badgeHtml = `<div style="position:absolute; top:-5px; right:-5px; background:#00ffcc; color:#000; border-radius:50%; width:20px; height:20px; font-size:12px; display:flex; align-items:center; justify-content:center; font-weight:bold; z-index:10; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">${loraIndex + 1}</div>`;
                            }

                            card.innerHTML = `${badgeHtml}${buildThumbHtml(m)}<div class="anomalous-nb-minilora-name" title="${m.filename}">${m.filename}</div>`;

                            if (m.preview_url && (m.preview_url.toLowerCase().endsWith('.mp4') || m.preview_url.toLowerCase().endsWith('.webm'))) {
                                card.onmouseenter = () => { const v = card.querySelector('video'); if (v) v.play().catch(e => { }); };
                                card.onmouseleave = () => { const v = card.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } };
                            }

                            card.onclick = () => {
                                if (isSelected) {
                                    data.loras = data.loras.filter(l => l.filename !== m.filename);
                                } else {
                                    data.loras.push(m);
                                }
                                this.saveCurrentNotebook();
                                buildLoraDOM(models); // re-render just the lora gallery
                            };
                            loraGallery.appendChild(card);
                        });
                    }
                };
                buildLoraDOM(d.models || []);
            });
    }

    sendNotebookToCanvas() {
        if (!this.currentNotebook) return;
        const data = this.currentNotebook.data || {};
        if (!data.mainModel) {
            alert(currentLang === 'zh' ? "请先选择一个主模型。" : "Please select a Main Model first.");
            return;
        }

        const groupNodes = [];
        const isUnet = data.mainModel.type === 'unet' || data.mainModel.type === 'diffusion_models';

        const ckptNode = LiteGraph.createNode(isUnet ? "UNETLoader" : "CheckpointLoaderSimple");
        app.graph.add(ckptNode);
        groupNodes.push({ node: ckptNode, relX: 0, relY: 0 });

        const sub = data.mainModel.subfolder.replace(/^\/+/, '').replace(/\/+$/, '');
        const relPath = sub ? `${sub}/${data.mainModel.filename}` : data.mainModel.filename;
        this.setWidgetValuePath(ckptNode, relPath);

        let lastNode = ckptNode;
        let lastModelSlot = isUnet ? 0 : 0;
        let lastClipSlot = isUnet ? null : 1;

        let relX = 350;
        let relY = 0;

        data.loras.forEach((lora, idx) => {
            const loraNode = LiteGraph.createNode("LoraLoader");
            app.graph.add(loraNode);
            groupNodes.push({ node: loraNode, relX: relX, relY: relY });

            const lsub = lora.subfolder.replace(/^\/+/, '').replace(/\/+$/, '');
            const lrelPath = lsub ? `${lsub}/${lora.filename}` : lora.filename;
            this.setWidgetValuePath(loraNode, lrelPath);

            lastNode.connect(lastModelSlot, loraNode, 0);
            if (lastClipSlot !== null) lastNode.connect(lastClipSlot, loraNode, 1);

            lastNode = loraNode;
            lastModelSlot = 0;
            lastClipSlot = 1;
            relX += 350;
        });

        if (data.promptEn) {
            const posNode = LiteGraph.createNode("CLIPTextEncode");
            posNode.title = "CLIP Text Encode (Positive)";
            app.graph.add(posNode);
            groupNodes.push({ node: posNode, relX: relX, relY: 0 });

            if (posNode.widgets && posNode.widgets.length > 0) {
                const tw = posNode.widgets.find(w => w.name === 'text' || w.type === 'customtext');
                if (tw) tw.value = data.promptEn;
            }
            if (lastClipSlot !== null) {
                lastNode.connect(lastClipSlot, posNode, 0);
            }

            const negNode = LiteGraph.createNode("CLIPTextEncode");
            negNode.title = "CLIP Text Encode (Negative)";
            app.graph.add(negNode);
            groupNodes.push({ node: negNode, relX: relX, relY: 250 });

            if (negNode.widgets && negNode.widgets.length > 0) {
                const tw = negNode.widgets.find(w => w.name === 'text' || w.type === 'customtext');
                if (tw) tw.value = "text, watermark, ugly, bad anatomy";
            }
            if (lastClipSlot !== null) {
                lastNode.connect(lastClipSlot, negNode, 0);
            }
        }

        this.nbPanel.style.display = 'none';
        this.close();

        // Magnetic Sticking Logic
        let isSticking = true;
        const stickHandler = (e) => {
            if (!isSticking || !app.canvas) return;
            const canvas = app.canvas;

            let canvasX, canvasY;
            if (canvas.convertEventToCanvasOffset) {
                const pos = canvas.convertEventToCanvasOffset(e);
                canvasX = pos[0];
                canvasY = pos[1];
            } else {
                const rect = canvas.canvas.getBoundingClientRect();
                canvasX = (e.clientX - rect.left - canvas.ds.offset[0]) / canvas.ds.scale;
                canvasY = (e.clientY - rect.top - canvas.ds.offset[1]) / canvas.ds.scale;
            }

            groupNodes.forEach(item => {
                const w = (item.node.size && item.node.size[0]) ? item.node.size[0] : 200;
                item.node.pos = [canvasX - (w / 2) + item.relX, canvasY - 20 + item.relY];
            });
            canvas.setDirty(true, true);
        };

        const dropHandler = (e) => {
            if (!isSticking) return;
            isSticking = false;
            window.removeEventListener('mousemove', stickHandler, true);
            window.removeEventListener('pointerdown', dropHandler, true);
            window.removeEventListener('mousedown', dropHandler, true);
            window.removeEventListener('click', dropHandler, true);
            e.preventDefault();
            e.stopPropagation();
        };

        window.addEventListener('mousemove', stickHandler, true);
        setTimeout(() => {
            window.addEventListener('pointerdown', dropHandler, true);
            window.addEventListener('mousedown', dropHandler, true);
            window.addEventListener('click', dropHandler, true);
        }, 100);
    }
    setWidgetValuePath(node, relPath) {
        if (!node.widgets || node.widgets.length === 0) return;
        const w = node.widgets.find(wg => wg.type === 'combo');
        const targetWidget = w || node.widgets[0];
        if (!targetWidget) return;

        if (targetWidget.options && targetWidget.options.values) {
            const normalizedTarget = relPath.replace(/\\/g, '/');
            const match = targetWidget.options.values.find(v => {
                return String(v).replace(/\\/g, '/') === normalizedTarget;
            });
            if (match) {
                targetWidget.value = match;
                return;
            }
        }
        targetWidget.value = relPath;
    }
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
        window.anomalousBrowserInstance = browser;
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
            let newX = initialX + (e.clientX - startX);
            let newY = initialY + (e.clientY - startY);
            if (newX < 0) newX = 0;
            if (newY < 0) newY = 0;
            if (newX > window.innerWidth - 60) newX = window.innerWidth - 60;
            if (newY > window.innerHeight - 60) newY = window.innerHeight - 60;
            btn.style.left = newX + 'px';
            btn.style.top = newY + 'px';
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

        const updateBtnBounds = () => {
            let numX = parseInt(btn.style.left || savedX);
            let numY = parseInt(btn.style.top || savedY);
            if (isNaN(numX)) numX = window.innerWidth - 90;
            if (isNaN(numY)) numY = window.innerHeight - 90;

            if (numX < 0) numX = 0;
            if (numY < 0) numY = 0;
            if (numX > window.innerWidth - 60) numX = window.innerWidth - 60;
            if (numY > window.innerHeight - 60) numY = window.innerHeight - 60;
            btn.style.left = numX + 'px';
            btn.style.top = numY + 'px';
        };

        if (savedX && savedY && savedX !== 'NaN' && savedY !== 'NaN') {
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
            btn.style.left = savedX;
            btn.style.top = savedY;
        }

        // Always trigger an update slightly after load to ensure it's in bounds
        setTimeout(updateBtnBounds, 200);

        window.addEventListener('resize', () => {
            if (btn.style.left) updateBtnBounds();
        });

        document.body.appendChild(btn);

        // Pre-create a lightweight, translucent, and aesthetic drag ghost image for huge Hires Fix images
        window.anomalousDragGhostImg = new Image();
        window.anomalousDragGhostImg.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='76' height='76' x='2' y='2' fill='%231a1a1a' fill-opacity='0.6' rx='16' stroke='%2300ffcc' stroke-width='2'/><text x='40' y='50' font-family='sans-serif' font-size='32' font-weight='bold' fill='%2300ffcc' text-anchor='middle'>W</text></svg>";
    }
});
