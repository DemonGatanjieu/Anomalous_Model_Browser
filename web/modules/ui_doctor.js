/**
 * ui_doctor.js
 * Extracted Doctor Panel & Assistant Panel methods.
 */

export function initDoctorPanel() {
        this.doctorPanelInitialized = true;
        this.doctorPanel.innerHTML = '';
        this.doctorPanel.style.padding = '0'; // Use full bleed
        this.doctorPanel.style.boxSizing = 'border-box';
        this.doctorPanel.style.overflow = 'hidden';
        
        // Beautiful dark gradient header
        const header = document.createElement('div');
        header.style.cssText = 'padding: 24px 28px; background: linear-gradient(180deg, rgba(20,20,25,1) 0%, rgba(20,20,25,0) 100%); display:flex; flex-direction:column; gap:16px; flex-shrink:0; border-bottom: 1px solid rgba(255,255,255,0.05);';
        
        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
        
        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'display:flex;align-items:center;gap:12px;';
        titleEl.innerHTML = `<span style="font-size:24px; filter: drop-shadow(0 0 8px rgba(0,255,204,0.3));">🩺</span><span style="font-size:18px;font-weight:600;color:#fff;font-family:Inter, sans-serif; letter-spacing: 0.5px;">${window.anomalous_browser_lang === 'zh' ? '全局体检中心' : 'Global Health Center'}</span>`;
        
        // Header control group on the right side (contains toggle & close button)
        const controlGroup = document.createElement('div');
        controlGroup.style.cssText = 'display:flex;align-items:center;gap:12px;';

        // Auto Scan Toggle inside Doctor Panel
        const autoScanToggle = document.createElement('div');
        autoScanToggle.style.cssText = 'display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.05);padding:6px 12px;border-radius:6px;cursor:pointer;transition:all 0.2s;';
        
        const renderAutoScanToggle = () => {
            let isAutoEnabled = localStorage.getItem('anomalous_auto_scan_enabled') === 'true';
            autoScanToggle.innerHTML = window.anomalous_browser_lang === 'zh'
                ? (isAutoEnabled 
                    ? '<span style="font-size:16px;">🛎️</span><span style="font-size:12px;color:#00ffcc;font-weight:500;">ComfyUI 启动时自动检测并替换缺失模型 [已开启]</span>' 
                    : '<span style="font-size:16px;opacity:0.5;">🔕</span><span style="font-size:12px;color:#aaa;">ComfyUI 启动时自动检测并替换缺失模型 [默认关闭]</span>')
                : (isAutoEnabled 
                    ? '<span style="font-size:16px;">🛎️</span><span style="font-size:12px;color:#00ffcc;font-weight:500;">Auto-Detect on ComfyUI Startup [ON]</span>' 
                    : '<span style="font-size:16px;opacity:0.5;">🔕</span><span style="font-size:12px;color:#aaa;">Auto-Detect on ComfyUI Startup [OFF]</span>');
        };
        renderAutoScanToggle();
        
        autoScanToggle.onmouseover = () => { autoScanToggle.style.background = 'rgba(255,255,255,0.1)'; };
        autoScanToggle.onmouseout = () => { autoScanToggle.style.background = 'rgba(255,255,255,0.05)'; };
        autoScanToggle.onclick = () => {
            let isAutoEnabled = localStorage.getItem('anomalous_auto_scan_enabled') === 'true';
            localStorage.setItem('anomalous_auto_scan_enabled', isAutoEnabled ? 'false' : 'true');
            renderAutoScanToggle();
        };

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✖';
        closeBtn.style.cssText = 'background:transparent;border:none;color:rgba(255,255,255,0.4);font-size:18px;cursor:pointer;padding:4px 8px;border-radius:4px;transition:all 0.2s;';
        closeBtn.onmouseover = () => { closeBtn.style.background = 'rgba(255,255,255,0.1)'; closeBtn.style.color = '#fff'; };
        closeBtn.onmouseout = () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = 'rgba(255,255,255,0.4)'; };
        closeBtn.onclick = () => { this.doctorPanel.style.display = 'none'; if (this.grid) this.grid.style.display = 'grid'; };
        
        controlGroup.appendChild(autoScanToggle);
        controlGroup.appendChild(closeBtn);

        topRow.appendChild(titleEl);
        topRow.appendChild(controlGroup);
        header.appendChild(topRow);

        // Stats row placeholder (populated by renderGlobalDashboard)
        const statsRow = document.createElement('div');
        statsRow.id = 'anomalous-doctor-stats-row';
        statsRow.style.cssText = 'display:flex; gap:12px; align-items:center;';

        header.appendChild(statsRow);
        
        this.doctorPanel.appendChild(header);

        // Node list container (takes up remaining space)
        const nodeListContainer = document.createElement('div');
        nodeListContainer.id = 'anomalous-doctor-node-list';
        nodeListContainer.style.cssText = 'display:flex;flex-direction:column;gap:12px;overflow-y:auto;flex:1; padding: 20px 28px; background: rgba(0,0,0,0.2);';
        this.doctorPanel.appendChild(nodeListContainer);

        // Initial render
        this.renderGlobalDashboard();
    }
export function diagnoseNode(node) {
        // This method serves the Node Assistant panel only
export function if (!this.assistantPanelInitialized) {
            this.initAssistantPanel();
        }
        const placeholder = document.getElementById('anomalous-assistant-placeholder');
        const nodeContent = document.getElementById('anomalous-assistant-node-content');
        if (!placeholder || !nodeContent) return;

export function if (!node) {
            placeholder.innerHTML = `<div style="font-size:48px;">🤖</div><div style="text-align:center;">${window.anomalous_browser_lang === 'zh' ? '请在画布中<strong style="color:#aaa">点击选中任意节点</strong>' : 'Please <strong style="color:#aaa">select any node</strong> in the canvas'}</div>`;
            placeholder.style.display = 'flex';
            nodeContent.style.display = 'none';
            nodeContent.innerHTML = '';
            return;
        }

        const modelWidgets = [];
export function if (node.widgets) {
export function for (const w of node.widgets) {
                if (w.type === 'combo' && typeof w.value === 'string') {
                    if (w.value.match(/\.(safetensors|ckpt|pt|bin|pth)$/i)) modelWidgets.push(w);
                }
            }
        }

        if (modelWidgets.length === 0) {
            placeholder.innerHTML = `<div style="font-size:36px;">⚠️</div><div style="text-align:center;">${window.anomalous_browser_lang === 'zh' ? '该节点没有受支持的模型参数' : 'No supported model parameter on this node'}</div><div style="font-size:12px;color:#555;margin-top:4px;">${node.type || ''}</div>`;
            placeholder.style.display = 'flex';
            nodeContent.style.display = 'none';
            nodeContent.innerHTML = '';
            return;
        }

        placeholder.style.display = 'none';
        nodeContent.style.display = 'flex';
        nodeContent.innerHTML = '';

        const titleBar = document.createElement('div');
        titleBar.style.cssText = 'padding:14px 20px 12px;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;align-items:center;gap:10px;flex-shrink:0;';
        titleBar.innerHTML = `<span style="font-size:18px;">🤖</span><span style="font-weight:bold;color:#fff;font-size:14px;">${node.title || node.type || 'Node'}</span><span style="font-size:11px;color:#555;margin-left:auto;">${node.type || ''}</span>`;
        nodeContent.appendChild(titleBar);

export function for (const w of modelWidgets) {
            this.renderAssistantModelCard(node, w, nodeContent);
        }
    }



export function renderGlobalDashboard() {
        const content = document.getElementById('anomalous-doctor-node-list');
        const statsRow = document.getElementById('anomalous-doctor-stats-row');
        if (!content || !statsRow) return;
        content.innerHTML = '';
        statsRow.innerHTML = '';

        if (this.doctorPanel) this.doctorPanel.currentDiagnosedNode = 'global';

        let nodes = [];
export function if (app.graph && app.graph.computeExecutionOrder) {
            nodes = app.graph.computeExecutionOrder(false, true);
export function } else if (app.graph && app.graph._nodes) {
            nodes = app.graph._nodes;
        }

        let total = 0, healthy = 0, missing = 0;
        let missingNodesData = [];

        // Collect data
export function for (const node of nodes) {
            if (!node.widgets) continue;
export function for (const w of node.widgets) {
                if (w.type === 'combo' && typeof w.value === 'string' && w.value.match(/\.(safetensors|ckpt|pt|bin|pth)$/i)) {
                    total++;
                    const val = w.value;
                    let isHealthy = false;
                    let exactMatch = null;
export function if (w.options && w.options.values && w.options.values.includes(val)) {
                        isHealthy = true;
export function } else if (w.options && w.options.values) {
                        const normVal = val.replace(/\\/g, '/');
                        exactMatch = w.options.values.find(v => typeof v === 'string' && v.replace(/\\/g, '/') === normVal);
                        if (exactMatch) isHealthy = true;
                    }
                    if (isHealthy) healthy++; else missing++;
                    
                    missingNodesData.push({ node, w, val, isHealthy, exactMatch });
                }
            }
        }

        // Render Stats Badges
        const createBadge = (label, count, color, bg) => {
            return `<div style="display:flex;align-items:center;gap:8px;padding:8px 16px;border-radius:20px;background:${bg};border:1px solid ${color}33;">
                <span style="color:${color};font-size:13px;font-weight:600;">${label}</span>
                <span style="color:#fff;font-size:14px;font-weight:bold;">${count}</span>
            </div>`;
        };
        const zh = window.anomalous_browser_lang === 'zh';
        statsRow.innerHTML = `
            ${createBadge(zh?'总模型':'Total', total, '#aaa', 'rgba(255,255,255,0.05)')}
            ${createBadge(zh?'🟢 健康':'🟢 Healthy', healthy, '#28a745', 'rgba(40, 167, 69, 0.1)')}
            ${createBadge(zh?'🔴 缺失':'🔴 Missing', missing, '#ff6b6b', 'rgba(220, 53, 69, 0.1)')}
        `;

        if (total === 0) {
            content.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.3);font-size:14px;">
                <div style="font-size:48px;margin-bottom:16px;">👻</div>
                ${zh ? '当前工作流没有任何模型节点' : 'No models found in this workflow'}
            </div>`;
            return;
        }

        // Render List
export function for (const data of missingNodesData) {
            const { node, w, val, isHealthy, exactMatch } = data;
            
            const item = document.createElement('div');
            item.style.cssText = `display:flex; flex-direction:column; padding:16px 20px; background:rgba(255,255,255,0.02); border-radius:12px; border:1px solid rgba(255,255,255,0.04); transition:all 0.2s; position:relative; overflow:hidden; flex-shrink:0;`;
            item.onmouseover = () => item.style.background = 'rgba(255,255,255,0.04)';
            item.onmouseout = () => item.style.background = 'rgba(255,255,255,0.02)';
            
            // Accent bar
            const accent = document.createElement('div');
            accent.style.cssText = `position:absolute; left:0; top:0; bottom:0; width:4px; background:${isHealthy ? '#28a745' : '#ff6b6b'};`;
            item.appendChild(accent);

            const top = document.createElement('div');
            top.style.cssText = 'display:flex; justify-content:space-between; align-items:flex-start; margin-left:8px;';
            
            const left = document.createElement('div');
            left.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
            
            const nodeTitle = document.createElement('div');
            nodeTitle.innerHTML = `<span style="color:rgba(255,255,255,0.4);font-size:12px;">#${node.id}</span> <span style="color:#aaa;font-size:12px;font-weight:600;">${node.title || node.type}</span>`;
            
            const fileText = document.createElement('div');
            fileText.innerText = val.split(/[\\/]/).pop();
            fileText.style.cssText = 'color:#fff; font-size:15px; font-weight:600; word-break:break-all; font-family:Inter, sans-serif;';
            
            left.appendChild(nodeTitle);
            left.appendChild(fileText);
            
            const right = document.createElement('div');
            right.style.cssText = 'display:flex; align-items:center; gap:12px;';
            
            if (isHealthy && exactMatch && exactMatch !== val) {
                right.innerHTML = `<div style="text-align:right;"><div style="color:#ffc107;font-size:13px;font-weight:bold;">🟡 ${zh?'自动重定向':'Auto-Redirected'}</div><div style="color:rgba(255,255,255,0.4);font-size:11px;margin-top:4px;">${exactMatch.split(/[\/]/).pop()}</div></div>`;
export function } else if (isHealthy) {
                right.innerHTML = `<div style="color:#28a745;font-size:13px;font-weight:bold;padding:6px 12px;background:rgba(40,167,69,0.1);border-radius:20px;">🟢 ${zh?'正常':'Ready'}</div>`;
            } else {
                right.innerHTML = `<div style="color:#ff6b6b;font-size:13px;font-weight:bold;padding:6px 12px;background:rgba(220,53,69,0.1);border-radius:20px;">🔴 ${zh?'丢失':'Missing'}</div>`;
            }

            top.appendChild(left);
            top.appendChild(right);
            item.appendChild(top);

            const actionRow = document.createElement('div');
            actionRow.style.cssText = 'display:flex; gap:10px; margin-top:16px; margin-left:8px;';
            
            const civitaiBtn = document.createElement('button');
            civitaiBtn.innerHTML = zh ? '🌐 C站' : '🌐 Civitai';
            civitaiBtn.style.cssText = 'padding:8px 16px; background:rgba(255,255,255,0.1); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px; transition:background 0.2s;';
            civitaiBtn.onmouseover = () => civitaiBtn.style.background = 'rgba(255,255,255,0.2)';
            civitaiBtn.onmouseout = () => civitaiBtn.style.background = 'rgba(255,255,255,0.1)';
            civitaiBtn.onclick = () => {
                const searchName = val.split(/[/\\]/).pop().replace('.safetensors', '').replace('.ckpt', '').replace('.pt', '');
                const url = `https://civitai.com/search/models?sortBy=models_v9&query=${encodeURIComponent(searchName)}`;
                window.open(url, '_blank');
            };
            
export function if (!isHealthy) {
                const deepScanBtn = document.createElement('button');
                deepScanBtn.innerHTML = zh ? '🔍 深度哈希扫描' : '🔍 Deep Hash Scan';
                deepScanBtn.style.cssText = 'padding:8px 16px; background:#1a73e8; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px; transition:background 0.2s;';
                deepScanBtn.onmouseover = () => deepScanBtn.style.background = '#1557b0';
                deepScanBtn.onmouseout = () => deepScanBtn.style.background = '#1a73e8';
                deepScanBtn.onclick = async () => {
                    deepScanBtn.innerText = zh ? '⏳ 正在启动扫描引擎...' : '⏳ Starting scan engine...';
                    deepScanBtn.disabled = true;
                    deepScanBtn.style.opacity = '0.7';
                    
                    try {
                        const r = await fetch('/anomalous/scan_missing_models', { method: 'POST' });
                        if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
                        const rData = await r.json();
                        if (rData.status === 'error' && rData.message !== 'Scan already in progress') {
                            throw new Error(rData.message);
                        }
                        
                        const checkInterval = setInterval(async () => {
                            try {
                                const statusRes = await fetch('/anomalous/global_scan_status');
                                const statusData = await statusRes.json();
                                
export function if (statusData.scanning) {
                                    let filename = statusData.filename || '';
                                    if (filename.length > 20) filename = filename.substring(0, 10) + '...' + filename.substring(filename.length - 7);
                                    deepScanBtn.innerText = zh 
                                        ? `⏳ 扫描中 (${statusData.current}/${statusData.total}) ${filename}`
                                        : `⏳ Scanning (${statusData.current}/${statusData.total}) ${filename}`;
                                } else {
                                    clearInterval(checkInterval);
export function if (statusData.error) {
                                        alert(zh ? '❌ 扫描过程中发生错误: ' + statusData.error : '❌ Scan error: ' + statusData.error);
                                    }
                                    
                                    deepScanBtn.innerText = zh ? '⏳ 正在匹配并替换飘红节点...' : '⏳ Matching and resolving red nodes...';
                                    
export function if (window.anomalous_reload_hashes) {
                                        await window.anomalous_reload_hashes();
                                    }
                                    
export function if (window.anomalous_resolve_all_missing_nodes) {
                                        await window.anomalous_resolve_all_missing_nodes(true, false);
                                    }
                                    
                                    let stillMissing = false;
                                    for (let i = 0; i < node.widgets.length; i++) {
                                        const wi = node.widgets[i];
                                        if (wi.name === w.name && wi.options && wi.options.values && !wi.options.values.includes(wi.value)) {
                                            stillMissing = true;
                                        }
                                    }
                                    
                                    const scanInfo = zh 
                                        ? `共深度扫描了 ${statusData.total} 个缺失信息的模型。`
                                        : `Deep scanned ${statusData.total} models with missing info.`;
                                        
export function if (stillMissing) {
                                        alert(zh ? `❌ 扫描结束，本地未匹配到模型。\n\n${scanInfo}\n\n这说明模型可能真的不在您的硬盘里，或者您删除了原本记录着哈希的源文件。\n请点击卡片上的【🌐 C站】去云端下载。` : `❌ Scan finished, but no local match found.\n\n${scanInfo}\n\nThis means the model is truly missing from your disk, or the original source file with hash was deleted.\nPlease click [🌐 Civitai] to download it from the cloud.`);
                                    } else {
                                        alert(zh ? `✅ 深度扫描成功！已自动修复该节点！\n\n${scanInfo}` : `✅ Deep Scan successful! Node auto-healed!\n\n${scanInfo}`);
                                    }
                                    
                                    this.renderGlobalDashboard();
                                    deepScanBtn.innerHTML = zh ? '🔍 深度哈希扫描' : '🔍 Deep Hash Scan';
                                    deepScanBtn.disabled = false;
                                    deepScanBtn.style.opacity = '1';
                                }
export function } catch (err) {
                                // Ignore poll errors
                            }
                        }, 500);
                        
export function } catch(e) {
                        alert(zh ? '❌ 扫描出错: ' + e.message : '❌ Scan Error: ' + e.message);
                        deepScanBtn.innerHTML = zh ? '🔍 深度哈希扫描' : '🔍 Deep Hash Scan';
                        deepScanBtn.disabled = false;
                        deepScanBtn.style.opacity = '1';
                    }
                };

                const manualBtn = document.createElement('button');
                manualBtn.innerHTML = zh ? '🔀 手动替换' : '🔀 Manual Replace';
                manualBtn.style.cssText = 'padding:8px 16px; background:rgba(255,255,255,0.1); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px; transition:background 0.2s;';
                manualBtn.onmouseover = () => manualBtn.style.background = 'rgba(255,255,255,0.2)';
                manualBtn.onmouseout = () => manualBtn.style.background = 'rgba(255,255,255,0.1)';
                manualBtn.onclick = () => {
                    this._openGalleryReplacer(node, w);
                };

                actionRow.appendChild(deepScanBtn);
                actionRow.appendChild(manualBtn);
                
                const pathText = document.createElement('div');
                pathText.innerText = `${zh?'原路径':'Original'}: ${val}`;
                pathText.style.cssText = 'margin-top:12px; margin-left:8px; color:rgba(255,255,255,0.3); font-size:11px; font-family:monospace; word-break:break-all;';
                item.appendChild(pathText);
            }
            
            actionRow.appendChild(civitaiBtn);
            item.appendChild(actionRow);

            content.appendChild(item);
        }
    }

export function initAssistantPanel() {
        this.assistantPanelInitialized = true;
        this.assistantPanel.innerHTML = '';
        this.assistantPanel.style.padding = '0';
        this.assistantPanel.style.overflow = 'hidden';

export function if (!this._assistantPanelHooked) {
            this._assistantPanelHooked = true;
            const self = this;
            const originalOnSelected = app.canvas.onNodeSelected;
            app.canvas.onNodeSelected = function (node) {
                if (originalOnSelected) originalOnSelected.apply(this, arguments);
                if (self.assistantPanel && self.assistantPanel.style.display !== 'none') {
                    self.diagnoseNode(node);
                }
                if (self.doctorPanel && self.doctorPanel.style.display !== 'none') {
                    self.diagnoseNodeForDoctor(node);
                }
            };
            const originalOnDeselected = app.canvas.onNodeDeselected;
            app.canvas.onNodeDeselected = function (node) {
                if (originalOnDeselected) originalOnDeselected.apply(this, arguments);
                if (self.assistantPanel && self.assistantPanel.style.display !== 'none') {
                    const stillSelected = Object.values(app.canvas.selected_nodes || {});
                    if (stillSelected.length > 0) self.diagnoseNode(stillSelected[0]);
                    else self.diagnoseNode(null);
                }
                if (self.doctorPanel && self.doctorPanel.style.display !== 'none') {
                    const stillSelected = Object.values(app.canvas.selected_nodes || {});
                    if (stillSelected.length > 0) self.diagnoseNodeForDoctor(stillSelected[0]);
                    else self.diagnoseNodeForDoctor(null);
                }
            };
        }

        const placeholder = document.createElement('div');
        placeholder.id = 'anomalous-assistant-placeholder';
        placeholder.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;color:#666;font-size:15px;gap:12px;padding:40px;text-align:center;';
        placeholder.innerHTML = `<div style="font-size:48px;">🤖</div><div>${window.anomalous_browser_lang === 'zh' ? '请在画布中<strong style="color:#aaa">点击选中任意节点</strong>' : 'Please <strong style="color:#aaa">select any node</strong> in the canvas'}</div>`;
        this.assistantPanel.appendChild(placeholder);

        const nodeContent = document.createElement('div');
        nodeContent.id = 'anomalous-assistant-node-content';
        nodeContent.style.cssText = 'display:none;flex-direction:column;flex:1;overflow-y:auto;';
        this.assistantPanel.appendChild(nodeContent);
    }

export function renderAssistantModelCard(node, w, container) {
        const val = w.value;
        const filename = val.split(/[\\/]/).pop();

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;flex-direction:column;gap:14px;';

        // Preview image
        const previewBox = document.createElement('div');
        previewBox.style.cssText = 'width:100%;aspect-ratio:1.5;max-height:280px;background:#0c0c0e;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        previewBox.innerHTML = `<span style="color:#444;font-size:13px;">${window.anomalous_browser_lang === 'zh' ? '加载预览...' : 'Loading preview...'}</span>`;
        wrapper.appendChild(previewBox);

        // Name and path
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'color:#fff;font-weight:bold;font-size:14px;word-break:break-all;';
        nameEl.innerText = filename;
        const pathEl = document.createElement('div');
        pathEl.style.cssText = 'color:#555;font-size:11px;word-break:break-all;margin-top:-10px;';
        pathEl.innerText = val;
        wrapper.appendChild(nameEl);
        wrapper.appendChild(pathEl);

        // Metadata zone (populated async)
        const metaZone = document.createElement('div');
        metaZone.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
        wrapper.appendChild(metaZone);

        // Gallery replacer button
        const actionRow = document.createElement('div');
        actionRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
        const browseBtn = document.createElement('button');
        browseBtn.innerText = window.anomalous_browser_lang === 'zh' ? '🔀 更换模型' : '🔀 Change Model';
        browseBtn.style.cssText = 'flex:1;padding:9px 12px;background:rgba(255,193,7,0.85);color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:13px;transition:filter 0.2s;';
        browseBtn.onmouseover = () => browseBtn.style.filter = 'brightness(1.1)';
        browseBtn.onmouseout = () => browseBtn.style.filter = 'brightness(1)';
        browseBtn.onclick = () => this._openGalleryReplacer(node, w);

        const profileBtn = document.createElement('button');
        profileBtn.innerText = window.anomalous_browser_lang === 'zh' ? '📖 查看档案' : '📖 View Profile';
        profileBtn.style.cssText = 'padding:9px 12px;background:rgba(138,180,248,0.1);color:#8AB4F8;border:1px solid rgba(138,180,248,0.3);border-radius:6px;cursor:pointer;font-size:13px;transition:filter 0.2s;';
        profileBtn.onmouseover = () => profileBtn.style.filter = 'brightness(1.2)';
        profileBtn.onmouseout = () => profileBtn.style.filter = 'brightness(1)';

        actionRow.appendChild(browseBtn);
        actionRow.appendChild(profileBtn);
        wrapper.appendChild(actionRow);
        container.appendChild(wrapper);

        // Async: load preview + metadata
        fetch(`/anomalous/find_model?search=${encodeURIComponent(val.replace(/\\/g, '/'))}`)
            .then(r => r.json())
            .then(d => {
                // Preview
                if (d.status === 'success' && d.model && d.model.preview_url) {
                    previewBox.innerHTML = '';
                    const pu = d.model.preview_url;
                    const isVid = /\.mp4(?:&|$)/i.test(pu) || /\.webm(?:&|$)/i.test(pu);
export function if (isVid) {
                        previewBox.innerHTML = `<video src="${pu}" muted loop autoplay playsinline style="width:100%;height:100%;object-fit:contain;"></video>`;
                    } else {
                        previewBox.innerHTML = `<img src="${pu}" style="width:100%;height:100%;object-fit:contain;" />`;
                    }
                } else {
                    previewBox.innerHTML = `<span style="color:#444;font-size:13px;">${window.anomalous_browser_lang === 'zh' ? '暂无预览图' : 'No preview'}</span>`;
                }

                // Profile button links to detail
                if (d.status === 'success' && d.model) {
                    profileBtn.onclick = () => {
                        this.assistantPanel.style.display = 'none';
                        this.currentType = d.type;
                        this.currentPathIdx = d.path_idx;
                        this.currentSubfolder = d.subfolder;
                        this.historyStack = this.historyStack || [];
                        this.historyStack.push({ type: 'assistant' });
                        this.showDetail(d.model);
                        if (this.foldersData) this.renderSidebar();
                    };
                }

                // Metadata
                if (d.status === 'success' && d.model && d.model.metadata) {
                    const meta = d.model.metadata;

                    // Type + base model badges
export function if (d.type || meta.baseModel) {
                        const badgeRow = document.createElement('div');
                        badgeRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
export function if (d.type) {
                            const b = document.createElement('span');
                            b.style.cssText = 'background:rgba(138,180,248,0.15);color:#8AB4F8;padding:3px 8px;border-radius:4px;font-size:11px;';
                            b.innerText = d.type; badgeRow.appendChild(b);
                        }
export function if (meta.baseModel) {
                            const b = document.createElement('span');
                            b.style.cssText = 'background:rgba(0,255,204,0.1);color:#00ffcc;padding:3px 8px;border-radius:4px;font-size:11px;';
                            b.innerText = meta.baseModel; badgeRow.appendChild(b);
                        }
                        metaZone.appendChild(badgeRow);
                    }

                    // Trigger words
                    const triggers = meta.trainedWords || meta.trigger_words || meta.trained_words;
export function if (triggers && triggers.length > 0) {
                        const trigSection = document.createElement('div');
                        trigSection.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:6px;padding:10px 12px;';
                        const trigTitle = document.createElement('div');
                        trigTitle.style.cssText = 'color:#aaa;font-size:11px;margin-bottom:8px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;';
                        trigTitle.innerText = window.anomalous_browser_lang === 'zh' ? '触发词' : 'Trigger Words';
                        const tagList = document.createElement('div');
                        tagList.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;';
                        const words = Array.isArray(triggers) ? triggers : [triggers];
                        words.forEach(word => {
                            const tag = document.createElement('span');
                            tag.style.cssText = 'background:rgba(255,193,7,0.12);color:#ffc107;padding:3px 8px;border-radius:4px;font-size:12px;cursor:pointer;';
                            tag.innerText = word;
                            tag.title = window.anomalous_browser_lang === 'zh' ? '点击复制' : 'Click to copy';
                            tag.onclick = () => {
                                navigator.clipboard.writeText(word).then(() => { const o = tag.innerText; tag.innerText = '✅'; setTimeout(() => tag.innerText = o, 1000); });
                            };
                            tagList.appendChild(tag);
                        });
                        const copyAll = document.createElement('button');
                        copyAll.style.cssText = 'background:transparent;border:1px solid #444;color:#888;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;margin-top:4px;';
                        copyAll.innerText = window.anomalous_browser_lang === 'zh' ? '📋 全部复制' : '📋 Copy All';
                        copyAll.onclick = () => {
                            navigator.clipboard.writeText(words.join(', ')).then(() => { copyAll.innerText = '✅'; setTimeout(() => copyAll.innerText = window.anomalous_browser_lang === 'zh' ? '📋 全部复制' : '📋 Copy All', 1500); });
                        };
                        trigSection.appendChild(trigTitle);
                        trigSection.appendChild(tagList);
                        trigSection.appendChild(copyAll);
                        metaZone.appendChild(trigSection);
                    }

                    // Custom notes (parchment)
                    const textNotes = meta.custom_notes || meta.notes;
export function if (textNotes) {
                        const notesCard = document.createElement('div');
                        notesCard.style.cssText = 'background:linear-gradient(135deg,#262522 0%,#202124 100%);border:1px solid #3c4043;border-left:4px solid #a38d53;border-radius:4px 8px 8px 4px;padding:12px 14px;';
                        const notesTitle = document.createElement('div');
                        notesTitle.style.cssText = 'color:#a38d53;font-size:11px;font-weight:bold;margin-bottom:6px;';
                        notesTitle.innerText = window.anomalous_browser_lang === 'zh' ? '📝 我的备注' : '📝 My Notes';
                        const notesText = document.createElement('div');
                        notesText.style.cssText = 'color:#d4c4a0;font-size:13px;line-height:1.6;white-space:pre-wrap;';
                        notesText.innerText = textNotes;
                        notesCard.appendChild(notesTitle);
                        notesCard.appendChild(notesText);
                        metaZone.appendChild(notesCard);
                    }
                }

                // History gallery — always load if we can resolve the filename
                const resolvedFilename = (d.status === 'success' && d.model) ? (d.model.filename || filename) : filename;
                this._loadAssistantHistory(resolvedFilename, metaZone, d.status === 'success' ? d.model : null);
            }).catch(() => {
                previewBox.innerHTML = `<span style="color:#444;font-size:13px;">${window.anomalous_browser_lang === 'zh' ? '无法加载预览' : 'Failed to load preview'}</span>`;

                // Still try to load history gallery by filename
                this._loadAssistantHistory(filename, metaZone, null);
            });
    }

export function _loadAssistantHistory(filename, container, model) {
        fetch('/anomalous/model_images?model_name=' + encodeURIComponent(filename) + '&t=' + Date.now())
            .then(r => r.json())
            .then(data => {
                const images = data.images || [];
                if (images.length === 0) return;

                const section = document.createElement('div');
                section.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

                // Section header with count + full gallery button
                const sectionHeader = document.createElement('div');
                sectionHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
                const sectionTitle = document.createElement('div');
                sectionTitle.style.cssText = 'color:#aaa;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;';
                sectionTitle.innerText = window.anomalous_browser_lang === 'zh' ? `🖼️ 历史生成图 (${images.length})` : `🖼️ History (${images.length})`;
                sectionHeader.appendChild(sectionTitle);

                // "View all" button if model is available
export function if (model) {
                    const viewAllBtn = document.createElement('button');
                    viewAllBtn.innerText = window.anomalous_browser_lang === 'zh' ? '查看全部 →' : 'View All →';
                    viewAllBtn.style.cssText = 'background:transparent;border:1px solid rgba(138,180,248,0.3);color:#8AB4F8;font-size:11px;padding:3px 8px;border-radius:4px;cursor:pointer;transition:all 0.2s;';
                    viewAllBtn.onmouseover = () => { viewAllBtn.style.background = 'rgba(138,180,248,0.1)'; };
                    viewAllBtn.onmouseout = () => { viewAllBtn.style.background = 'transparent'; };
                    viewAllBtn.onclick = () => this.showGeneratedGallery(model);
                    sectionHeader.appendChild(viewAllBtn);
                }
                section.appendChild(sectionHeader);

                const grid = document.createElement('div');
                grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:6px;';
                images.slice(0, 16).forEach(img => {
                    const card = document.createElement('div');
                    card.style.cssText = 'border-radius:6px;overflow:hidden;aspect-ratio:1;background:#111;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;';
                    card.onmouseover = () => { card.style.transform = 'scale(1.05)'; card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)'; };
                    card.onmouseout = () => { card.style.transform = 'scale(1)'; card.style.boxShadow = 'none'; };
                    const imgEl = document.createElement('img');
                    imgEl.src = img.url || img;
                    imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                    imgEl.loading = 'lazy';
                    card.appendChild(imgEl);
export function if (img.workflow) {
                        card.title = window.anomalous_browser_lang === 'zh' ? '点击恢复此工作流' : 'Click to restore workflow';
                        card.onclick = () => {
                            try {
                                const wf = typeof img.workflow === 'string' ? JSON.parse(img.workflow) : img.workflow;
                                if (app && app.loadGraphData) app.loadGraphData(wf);
                            } catch (e) { }
                        };
export function } else if (model) {
                        card.title = window.anomalous_browser_lang === 'zh' ? '点击查看完整图库' : 'Click to view full gallery';
                        card.onclick = () => this.showGeneratedGallery(model);
                    }
                    grid.appendChild(card);
                });
                section.appendChild(grid);
                container.appendChild(section);
            }).catch(() => { });
    }

export function _openGalleryReplacer(node, w) {
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.88);z-index:999999;display:flex;flex-direction:column;padding:40px;box-sizing:border-box;overflow-y:auto;';
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✖';
        closeBtn.style.cssText = 'position:absolute;top:20px;right:20px;background:transparent;border:none;color:#fff;font-size:24px;cursor:pointer;';
        closeBtn.onclick = () => modal.remove();
        modal.appendChild(closeBtn);
        const title = document.createElement('h2');
        title.style.cssText = 'color:#fff;margin:0 0 20px 0;font-size:20px;';
        title.innerText = window.anomalous_browser_lang === 'zh' ? '🖼️ 选择要替换的模型' : '🖼️ Select Replacement Model';
        modal.appendChild(title);
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:15px;';
        modal.appendChild(grid);
        document.body.appendChild(modal);

        const validPaths = (w.options && w.options.values) ? w.options.values.filter(v => typeof v === 'string') : [];
        if (!validPaths.length) { modal.remove(); return; }

export function fetch('/anomalous/resolve_paths_to_previews', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: validPaths })
        }).then(r => r.json()).then(data => {
            const previews = data.previews || {};
export function for (const path of validPaths) {
                const card = document.createElement('div');
                card.style.cssText = 'background:#222;border-radius:8px;overflow:hidden;cursor:pointer;display:flex;flex-direction:column;border:1px solid #444;transition:transform 0.2s,box-shadow 0.2s;';
                card.onmouseover = () => { card.style.transform = 'scale(1.05)'; card.style.boxShadow = '0 6px 20px rgba(0,0,0,0.5)'; };
                card.onmouseout = () => { card.style.transform = 'scale(1)'; card.style.boxShadow = 'none'; };
                const imgBox = document.createElement('div');
                imgBox.style.cssText = 'height:150px;background:#111;background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;font-size:30px;';
                if (previews[path]) { imgBox.style.backgroundImage = `url("${previews[path]}")`; imgBox.innerText = ''; } else { imgBox.innerText = '🖼️'; }
                const nameDiv = document.createElement('div');
                nameDiv.style.cssText = 'padding:8px;font-size:12px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                nameDiv.innerText = path.split(/[\\/]/).pop();
                nameDiv.title = path;
                card.appendChild(imgBox);
                card.appendChild(nameDiv);
                grid.appendChild(card);
                card.onclick = () => {
                    w.value = path;
                    const wIdx = node.widgets.indexOf(w);
                    if (wIdx !== -1 && node.widgets_values) {
                        node.widgets_values[wIdx] = path;
                    }
export function if (w.options && w.options.values && !w.options.values.includes(path)) {
                        const newVals = [...w.options.values];
                        newVals.push(path);
                        w.options.values = newVals;
                    }
                    delete node.color; delete node.bgcolor; node.has_errors = false;
                    if (w.callback) w.callback(w.value, app.canvas, node, app.canvas.graph_mouse, null);
export function if (app.graph) {
                        app.graph.setDirtyCanvas(true, true);
                        if (app.graph.change) app.graph.change();
                    }
                    this.diagnoseNode(node);
                    modal.remove();
                };
            }
        }).catch(e => console.error('Gallery replacer failed', e));
    }

export function runGlobalDoctorScan() {
        const content = document.getElementById('anomalous-doctor-node-list');
        const inst = document.getElementById('anomalous-doctor-instructions');
        if (inst) inst.style.display = 'none';
        if (content) content.innerHTML = '';

        let totalNodes = 0;
        let missingNodes = 0;

export function for (const node of app.graph._nodes) {
export function if (node.widgets) {
export function for (let w of node.widgets) {
                    const val = w.value;
                    if (typeof val === 'string' && (val.endsWith('.safetensors') || val.endsWith('.ckpt') || val.endsWith('.pt') || val.endsWith('.sft') || val.endsWith('.bin'))) {
                        totalNodes++;
                        let isHealthy = false;
                        if (w.options && w.options.values && w.options.values.includes(val)) isHealthy = true;
export function if (!isHealthy) {
                            missingNodes++;
                            const nodeTitle = document.createElement('div');
                            nodeTitle.innerText = `${window.anomalous_browser_lang === 'zh' ? '节点' : 'Node'}: ${node.title || node.type}`;
                            nodeTitle.style.color = '#8AB4F8';
                            nodeTitle.style.fontWeight = 'bold';
                            nodeTitle.style.marginTop = '10px';
                            content.appendChild(nodeTitle);
                            content.appendChild(this.renderDoctorState(node, w));
                        }
                    }
                }
            }
        }

        if (missingNodes === 0) {
            content.innerHTML = `<div style="color:#28a745; text-align:center; padding:20px; font-size:16px;">${window.anomalous_browser_lang === 'zh' ? '🎉 太棒了！当前工作流中所有模型均在本地就绪。' : '🎉 Awesome! All models in this workflow are healthy.'}</div>`;
        }
    }
