import { app } from "../../scripts/app.js";

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

        // Sidebar
        this.sidebar = document.createElement('div');
        this.sidebar.id = 'anomalous-sidebar';

        // Content Area
        const content = document.createElement('div');
        content.id = 'anomalous-content';

        const header = document.createElement('div');
        header.id = 'anomalous-header';
        
        const title = document.createElement('div');
        title.id = 'anomalous-title';
        title.innerHTML = '📦 Anomalous Model Browser';
        
        const scanBtn = document.createElement('button');
        scanBtn.id = 'anomalous-scan-btn';
        scanBtn.innerHTML = '🔄 Scan Folder';
        scanBtn.onclick = async () => {
            if (!confirm(`Notice:\nThe scan process will automatically compare with Civitai and rename your local model files, and it will clean up damaged files.\nAre you sure you want to start the scan?`)) return;
            scanBtn.innerHTML = '⏳ Scanning...';
            scanBtn.disabled = true;
            try {
                const params = new URLSearchParams({ type: this.currentType, path_idx: this.currentPathIdx, subfolder: this.currentSubfolder });
                const res = await fetch('/anomalous/scan?' + params.toString(), {method: 'POST'});
                const data = await res.json();
                if (data.status === 'ok') {
                    alert('🚀 Scan started in background!');
                    const poll = setInterval(async () => {
                        try {
                            const sr = await fetch('/anomalous/scan_status?' + params.toString());
                            const sd = await sr.json();
                            if (!sd.scanning) {
                                clearInterval(poll);
                                scanBtn.innerHTML = '✅ Complete!';
                                alert('✅ Scan Complete! Refreshing grid.');
                                this.loadModels();
                                setTimeout(() => { scanBtn.innerHTML = '🔄 Scan Folder'; scanBtn.disabled = false; }, 2000);
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
        energyBtn.innerHTML = this.energySaving ? '🔋 节能模式' : '🎬 自动播放';
        energyBtn.onclick = () => {
            this.energySaving = !this.energySaving;
            localStorage.setItem('anomalous_energy_saving', this.energySaving);
            energyBtn.innerHTML = this.energySaving ? '🔋 节能模式' : '🎬 自动播放';
            this.loadModels();
        };

        const closeBtn = document.createElement('div');
        closeBtn.id = 'anomalous-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => this.close();

        header.appendChild(title);
        const apiKeyInput = document.createElement('input');
        apiKeyInput.id = 'anomalous-api-key';
        apiKeyInput.placeholder = '输入 Civitai API Key (下载.red模型)';
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
            if (d.has_api_key) apiKeyInput.placeholder = '已保存 Civitai API Key (••••)';
        }).catch(()=>{});

        header.appendChild(apiKeyInput);
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

        container.appendChild(this.sidebar);
        container.appendChild(content);

        this.modal.appendChild(container);
        document.body.appendChild(this.modal);
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
        title.innerHTML = '📂 Folders';
        title.style.color = '#fff';
        title.style.margin = '0';
        
        const collapseAllBtn = document.createElement('button');
        collapseAllBtn.innerHTML = '➖ 收起全部';
        collapseAllBtn.style.padding = '4px 8px';
        collapseAllBtn.style.background = '#444';
        collapseAllBtn.style.color = '#fff';
        collapseAllBtn.style.border = 'none';
        collapseAllBtn.style.borderRadius = '4px';
        collapseAllBtn.style.cursor = 'pointer';
        collapseAllBtn.onclick = () => {
            this.expandedFolders.clear();
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
                this.grid.innerHTML = '<div style="color:white; padding:20px;">No models found in this folder.</div>';
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
                    ph.innerHTML = '<div style="text-align:center;color:#666;margin-top:80px;">No Preview</div><div style="font-size:0.8em;text-align:center;opacity:0.5;margin-top:5px">Click Scan</div>';
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
                
                card.onclick = () => this.showDetail(model);
                
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
        header.style.padding = '15px';
        header.style.background = 'var(--comfy-menu-bg, #333)';
        header.style.borderBottom = '1px solid var(--border-color, #444)';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        
        const backBtn = document.createElement('button');
        backBtn.innerHTML = '⬅️ 返回网格 (Back)';
        backBtn.style.padding = '8px 16px';
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
        
        const delBtn = document.createElement('button');
        delBtn.innerHTML = '🗑️ 删除模型及配置';
        delBtn.style.padding = '8px 16px';
        delBtn.style.background = '#ff4444';
        delBtn.style.color = '#fff';
        delBtn.style.border = 'none';
        delBtn.style.borderRadius = '4px';
        delBtn.style.cursor = 'pointer';
        delBtn.style.marginLeft = 'auto'; // push to the right
        delBtn.onclick = async () => {
            if (!confirm(`确定要彻底删除 ${model.filename} 及相关的缩略图、配置文件吗？此操作不可逆！`)) return;
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
                    alert('✅ 删除成功！\n' + data.deleted.join('\n'));
                    this.detailPanel.style.display = 'none';
                    this.detailPanel.innerHTML = '';
                    this.grid.style.display = 'grid';
                    this.loadModels(); // refresh grid
                } else {
                    alert('❌ 删除失败: ' + data.message);
                }
            } catch (e) {
                alert('❌ 删除失败: ' + e.message);
            }
        };
        
        header.appendChild(backBtn);
        header.appendChild(title);
        header.appendChild(delBtn);
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
            leftPanel.innerHTML = '<div style="color:#aaa; text-align:center; margin-top:50px;">No preview available</div>';
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
            copyAll.innerText = '📋 复制全部';
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
                    copyAll.innerText = '✅ 已复制!';
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
                tag.title = '点击复制: ' + w;
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
