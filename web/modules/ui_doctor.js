import { app } from "../../../scripts/app.js";
import { escapeHtml } from './safe_dom.js';
import {
    analyzeModelChainInsertion,
    getModelChainInsertionCapabilities,
    spliceModelChainNode,
} from './graph_splice.js';
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

        const refreshBtn = document.createElement('button');
        refreshBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '🔄 刷新缓存' : '🔄 Refresh';
        refreshBtn.style.cssText = 'background:rgba(138,180,248,0.1);border:1px solid rgba(138,180,248,0.3);color:#8AB4F8;font-size:12px;cursor:pointer;padding:6px 12px;border-radius:6px;transition:all 0.2s; font-weight:600;';
        refreshBtn.title = window.anomalous_browser_lang === 'zh' ? '重新读取最新模型列表并清除报错' : 'Reload model list and clear errors';
        refreshBtn.onmouseover = () => { refreshBtn.style.background = 'rgba(138,180,248,0.2)'; };
        refreshBtn.onmouseout = () => { refreshBtn.style.background = 'rgba(138,180,248,0.1)'; };
        refreshBtn.onclick = async () => {
            refreshBtn.disabled = true;
            refreshBtn.style.opacity = '0.5';
            if (app.refreshComboInNodes) await app.refreshComboInNodes();
            if (app.lastNodeErrors) app.lastNodeErrors = null;
            if (typeof app.clearErrors === 'function') app.clearErrors();
            if (app.graph) {
                app.graph.setDirtyCanvas(true, true);
                if (app.graph.change) app.graph.change();
            }
            try { window.dispatchEvent(new CustomEvent("graphChanged")); } catch(e){}
            this.renderGlobalDashboard();
            refreshBtn.disabled = false;
            refreshBtn.style.opacity = '1';
        };

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✖';
        closeBtn.style.cssText = 'background:transparent;border:none;color:rgba(255,255,255,0.4);font-size:18px;cursor:pointer;padding:4px 8px;border-radius:4px;transition:all 0.2s;';
        closeBtn.onmouseover = () => { closeBtn.style.background = 'rgba(255,255,255,0.1)'; closeBtn.style.color = '#fff'; };
        closeBtn.onmouseout = () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = 'rgba(255,255,255,0.4)'; };
        closeBtn.onclick = () => { this.doctorPanel.style.display = 'none'; if (this.grid) this.grid.style.display = 'grid'; };
        
        controlGroup.appendChild(autoScanToggle);
        controlGroup.appendChild(refreshBtn);
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

function getInsertionCapabilityMessage(capability) {
    const zh = window.anomalous_browser_lang === 'zh';
    const messages = {
        missing_graph_or_node: zh ? '当前画布或节点不可用。' : 'The current graph or node is unavailable.',
        missing_chain_inputs: zh ? '节点没有完整的 MODEL/CLIP 输入。' : 'The node does not expose both MODEL and CLIP inputs.',
        unconnected_chain_inputs: zh ? 'MODEL/CLIP 输入尚未全部连接。' : 'Both MODEL and CLIP inputs must already be connected.',
        missing_chain_outputs: zh ? '节点没有完整的 MODEL/CLIP 输出。' : 'The node does not expose both MODEL and CLIP outputs.',
        ambiguous_downstream_branches: zh ? '检测到多个下游分支，请先整理或选择明确链路。' : 'Multiple downstream branches were detected; choose an explicit chain first.',
        invalid_downstream_link: zh ? '现有下游连线无效，无法安全改写。' : 'An existing downstream link is invalid and cannot be safely changed.',
    };
    return messages[capability?.code] || (zh ? '当前节点不支持此插入方式。' : 'This insertion is not available for the selected node.');
}

function getNativeWidgetValues(node, widget) {
    const source = widget?.options?.values;
    let values = source;
    if (typeof source === 'function') {
        try {
            values = source(widget, node);
        } catch (error) {
            console.warn('[Anomalous] Failed to resolve native combo values:', error);
            values = [];
        }
    }
    return Array.isArray(values)
        ? [...new Set(values.filter(value => typeof value === 'string'))]
        : [];
}

function findModelComboWidget(node) {
    return (node?.widgets || []).find(widget => {
        if (widget?.type !== 'combo') return false;
        const values = getNativeWidgetValues(node, widget);
        return values.some(value => /\.(safetensors|ckpt|pt|bin|pth|sft)$/i.test(value));
    }) || null;
}

function setWidgetValue(node, widget, value) {
    widget.value = value;
    const widgetIndex = node?.widgets?.indexOf(widget) ?? -1;
    if (widgetIndex >= 0) {
        node.widgets_values = Array.isArray(node.widgets_values)
            ? node.widgets_values
            : node.widgets.map(item => item?.value);
        node.widgets_values[widgetIndex] = value;
    }
}

export function openLoraInsertionPicker(anchorNode, direction) {
    const analysis = analyzeModelChainInsertion(app.graph, anchorNode, direction);
    if (!analysis.supported) {
        alert(getInsertionCapabilityMessage(analysis));
        return;
    }

    const insertedNode = typeof LiteGraph !== 'undefined' ? LiteGraph.createNode('LoraLoader') : null;
    if (!insertedNode) {
        alert(window.anomalous_browser_lang === 'zh' ? '无法创建标准 LoRA Loader 节点。' : 'Unable to create a standard LoRA Loader node.');
        return;
    }

    const modelWidget = findModelComboWidget(insertedNode);
    if (!modelWidget || getNativeWidgetValues(insertedNode, modelWidget).length === 0) {
        alert(window.anomalous_browser_lang === 'zh' ? 'LoRA 列表尚未就绪，请刷新 ComfyUI 模型列表后重试。' : 'The LoRA list is not ready. Refresh ComfyUI model lists and try again.');
        return;
    }

    this._openGalleryReplacer(insertedNode, modelWidget, {
        mode: 'insert',
        direction,
        anchorNode,
        analysis,
        modelTypeLabel: 'LoRA',
    });
}

export function diagnoseNode(node) {
        // This method serves the Node Assistant panel only
if (!this.assistantPanelInitialized) {
            this.initAssistantPanel();
        }
        const placeholder = document.getElementById('anomalous-assistant-placeholder');
        const nodeContent = document.getElementById('anomalous-assistant-node-content');
        if (!placeholder || !nodeContent || !app.graph || !app.graph._nodes) return;

if (!node) {
            placeholder.innerHTML = `<div style="font-size:48px;">🤖</div><div style="text-align:center;">${window.anomalous_browser_lang === 'zh' ? '请在画布中<strong style="color:#aaa">点击选中任意节点</strong>' : 'Please <strong style="color:#aaa">select any node</strong> in the canvas'}</div>`;
            placeholder.style.display = 'flex';
            nodeContent.style.display = 'none';
            nodeContent.innerHTML = '';
            return;
        }

        const modelWidgets = [];
if (node.widgets) {
for (const w of node.widgets) {
                if (w.type === 'combo' && typeof w.value === 'string') {
                    if (w.value.match(/\.(safetensors|ckpt|pt|bin|pth|sft)$/i)) modelWidgets.push(w);
                }
            }
        }

        const insertionCapabilities = getModelChainInsertionCapabilities(app.graph, node);
        const canInsert = insertionCapabilities.before.supported || insertionCapabilities.after.supported;

        if (modelWidgets.length === 0 && !canInsert) {
            placeholder.innerHTML = `<div style="font-size:36px;">⚠️</div><div style="text-align:center;">${window.anomalous_browser_lang === 'zh' ? '该节点没有受支持的模型参数' : 'No supported model parameter on this node'}</div><div style="font-size:12px;color:#555;margin-top:4px;">${escapeHtml(node.type || '')}</div>`;
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
        titleBar.innerHTML = `<span style="font-size:18px;">🤖</span><span class="ast-title" style="font-weight:bold;color:#fff;font-size:14px;"></span><span class="ast-type" style="font-size:11px;color:#555;margin-left:auto;"></span>`;
        titleBar.querySelector('.ast-title').textContent = node.title || node.type || 'Node';
        titleBar.querySelector('.ast-type').textContent = node.type || '';
        nodeContent.appendChild(titleBar);

        const quickActions = document.createElement('div');
        quickActions.style.cssText = 'padding:12px 20px;background:rgba(255,255,255,0.025);border-bottom:1px solid rgba(255,255,255,0.07);display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0;';

        const makeActionButton = (label, accent, onClick, capability = null) => {
            const button = document.createElement('button');
            const enabled = !capability || capability.supported;
            button.textContent = label;
            button.disabled = !enabled;
            button.style.cssText = enabled
                ? `flex:1;min-width:145px;padding:10px 12px;background:${accent};color:#fff;border:1px solid rgba(255,255,255,0.12);border-radius:7px;cursor:pointer;font-weight:700;font-size:12px;transition:filter 0.15s;`
                : 'flex:1;min-width:145px;padding:10px 12px;background:rgba(255,255,255,0.04);color:#666;border:1px solid rgba(255,255,255,0.06);border-radius:7px;cursor:not-allowed;font-weight:600;font-size:12px;';
            if (enabled) {
                button.onmouseover = () => { button.style.filter = 'brightness(1.15)'; };
                button.onmouseout = () => { button.style.filter = 'brightness(1)'; };
                button.onclick = onClick;
            } else if (capability) {
                button.title = getInsertionCapabilityMessage(capability);
            }
            quickActions.appendChild(button);
        };

        for (const widget of modelWidgets) {
            const widgetLabel = modelWidgets.length > 1 && widget.name
                ? (window.anomalous_browser_lang === 'zh' ? `🔀 更换 ${widget.name}` : `🔀 Change ${widget.name}`)
                : (window.anomalous_browser_lang === 'zh' ? '🔀 更换当前模型' : '🔀 Change Current Model');
            makeActionButton(widgetLabel, 'rgba(255,152,0,0.75)', () => this._openGalleryReplacer(node, widget));
        }
        makeActionButton(
            window.anomalous_browser_lang === 'zh' ? '⬅ 在前方插入 LoRA' : '⬅ Insert LoRA Before',
            'rgba(33,150,243,0.65)',
            () => this.openLoraInsertionPicker(node, 'before'),
            insertionCapabilities.before,
        );
        makeActionButton(
            window.anomalous_browser_lang === 'zh' ? '在后方插入 LoRA ➡' : 'Insert LoRA After ➡',
            'rgba(76,175,80,0.65)',
            () => this.openLoraInsertionPicker(node, 'after'),
            insertionCapabilities.after,
        );
        nodeContent.appendChild(quickActions);

for (const w of modelWidgets) {
            this.renderAssistantModelCard(node, w, nodeContent);
        }
    }



export function renderGlobalDashboard() {
        const content = document.getElementById('anomalous-doctor-node-list');
        const statsRow = document.getElementById('anomalous-doctor-stats-row');
        if (!content || !statsRow || !app.graph || !app.graph._nodes) return;
        content.innerHTML = '';
        statsRow.innerHTML = '';

        if (this.doctorPanel) this.doctorPanel.currentDiagnosedNode = 'global';

        let nodes = [];
        if (app.graph && app.graph.computeExecutionOrder) {
            nodes = app.graph.computeExecutionOrder(false, true);
        } else if (app.graph && app.graph._nodes) {
            nodes = app.graph._nodes;
        }

        let total = 0, healthy = 0, missing = 0;
        let missingNodesData = [];
        let has_native_fixes = false;

        // Collect data
        for (const node of nodes) {
            if (!node.widgets) continue;
            for (const w of node.widgets) {
                if (w.type === 'combo' && typeof w.value === 'string' && w.value.match(/\.(safetensors|ckpt|pt|bin|pth|sft)$/i)) {
                    total++;
                    const val = w.value;
                    let isHealthy = false;
                    let exactMatch = null;
                    if (w.options && w.options.values && w.options.values.includes(val)) {
                        isHealthy = true;
                    } else if (w.options && w.options.values) {
                        const normVal = val.replace(/\\/g, '/');
                        exactMatch = w.options.values.find(v => typeof v === 'string' && v.replace(/\\/g, '/') === normVal);
                        if (exactMatch) {
                            isHealthy = true;
                            has_native_fixes = true;
                            if (w.value !== exactMatch) {
                                w.value = exactMatch;
                                const wIdx = node.widgets.indexOf(w);
                                if (wIdx !== -1 && node.widgets_values) node.widgets_values[wIdx] = exactMatch;
                                if (w.callback) w.callback(w.value, app.canvas, node, app.canvas.graph_mouse, null);
                                app.graph.setDirtyCanvas(true, true);
                            }
                            delete node.color;
                            delete node.bgcolor;
                            node.has_errors = false;
                            
                            if (app.lastNodeErrors && app.lastNodeErrors[node.id]) {
                                delete app.lastNodeErrors[node.id];
                            }
                        }
                    }
                    if (isHealthy) healthy++; else missing++;
                    
                    missingNodesData.push({ node, w, val, isHealthy, exactMatch });
                }
            }
        }
        
        if (has_native_fixes) {
            if (app.graph && app.graph.change) app.graph.change();
            try { window.dispatchEvent(new CustomEvent("graphChanged")); } catch(e){}
            if (typeof app.clearErrors === 'function') app.clearErrors();
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
for (const data of missingNodesData) {
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
            nodeTitle.innerHTML = `<span style="color:rgba(255,255,255,0.4);font-size:12px;"></span> <span style="color:#aaa;font-size:12px;font-weight:600;"></span>`;
            nodeTitle.children[0].textContent = `#${node.id}`;
            nodeTitle.children[1].textContent = node.title || node.type;
            
            const fileText = document.createElement('div');
            fileText.innerText = val.split(/[\\/]/).pop();
            fileText.style.cssText = 'color:#fff; font-size:15px; font-weight:600; word-break:break-all; font-family:Inter, sans-serif;';
            
            left.appendChild(nodeTitle);
            left.appendChild(fileText);
            
            const right = document.createElement('div');
            right.style.cssText = 'display:flex; align-items:center; gap:12px;';
            
            if (isHealthy && exactMatch && exactMatch !== val) {
                right.innerHTML = `<div style="text-align:right;"><div style="color:#ffc107;font-size:13px;font-weight:bold;">🟡 ${zh?'自动重定向':'Auto-Redirected'}</div><div style="color:rgba(255,255,255,0.4);font-size:11px;margin-top:4px;">${escapeHtml(exactMatch.split(/[\/]/).pop())}</div></div>`;
} else if (isHealthy) {
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
                let searchHash = null;
                if (app.graph && app.graph.extra && app.graph.extra.anomalous_hashes) {
                    const hData = app.graph.extra.anomalous_hashes[`${node.id}_${val}`];
                    if (hData) searchHash = typeof hData === 'string' ? hData : hData.hash;
                }
                if (!searchHash && window.anomalous_hash_cache) {
                    const basename = val.split(/[/\\]/).pop();
                    const cData = window.anomalous_hash_cache[basename] || window.anomalous_hash_cache[val];
                    if (cData) searchHash = typeof cData === 'string' ? cData : cData.hash;
                }
                const searchStr = searchHash || val.split(/[/\\]/).pop().replace('.safetensors', '').replace('.ckpt', '').replace('.pt', '').replace('.sft', '');
                const url = `https://civitai.com/search/models?sortBy=models_v9&query=${encodeURIComponent(searchStr)}`;
                window.open(url, '_blank');
            };
            
if (!isHealthy) {
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
                        
                        let pollActive = true;
                        
                        const pollStatus = async () => {
                            if (!pollActive) return;
                            try {
                                const statusRes = await fetch('/anomalous/scan_missing_models_status');
                                if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);
                                const statusData = await statusRes.json();
                                
if (statusData.scanning) {
                                    let filename = statusData.filename || '';
                                    if (filename.length > 20) filename = filename.substring(0, 10) + '...' + filename.substring(filename.length - 7);
                                    deepScanBtn.innerText = zh 
                                        ? `⏳ 扫描中 (${statusData.current}/${statusData.total}) ${filename}`
                                        : `⏳ Scanning (${statusData.current}/${statusData.total}) ${filename}`;
                                    setTimeout(pollStatus, 500);
                                } else {
if (statusData.error) {
                                        alert(zh ? '❌ 扫描过程中发生错误: ' + statusData.error : '❌ Scan error: ' + statusData.error);
                                        deepScanBtn.innerHTML = zh ? '🔍 深度哈希扫描' : '🔍 Deep Hash Scan';
                                        deepScanBtn.disabled = false;
                                        deepScanBtn.style.opacity = '1';
                                        return;
                                    }
                                    
                                    deepScanBtn.innerText = zh ? '⏳ 正在匹配并替换飘红节点...' : '⏳ Matching and resolving red nodes...';
                                    
if (window.anomalous_reload_hashes) {
                                        await window.anomalous_reload_hashes();
                                    }
                                    
if (window.anomalous_resolve_all_missing_nodes) {
                                        await window.anomalous_resolve_all_missing_nodes(true, false);
                                    }
                                    
                                    let stillMissing = false;
                                    const normVal = w.value.replace(/\\/g, '/');
                                    for (let i = 0; i < node.widgets.length; i++) {
                                        const wi = node.widgets[i];
                                        if (wi.name === w.name && wi.options && wi.options.values) {
                                            const match = wi.options.values.find(v => typeof v === 'string' && v.replace(/\\/g, '/') === normVal);
                                            if (!match) stillMissing = true;
                                        }
                                    }
                                    
                                    const scanInfo = zh 
                                        ? `共深度扫描了 ${statusData.total} 个缺失信息的模型。`
                                        : `Deep scanned ${statusData.total} models with missing info.`;
                                        
if (stillMissing) {
                                        alert(zh ? `❌ 扫描结束，本地未匹配到模型。\n\n${scanInfo}\n\n这说明模型可能真的不在您的硬盘里，或者您删除了原本记录着哈希的源文件。\n请点击卡片上的【🌐 C站】去云端下载。` : `❌ Scan finished, but no local match found.\n\n${scanInfo}\n\nThis means the model is truly missing from your disk, or the original source file with hash was deleted.\nPlease click [🌐 Civitai] to download it from the cloud.`);
                                    } else {
                                        alert(zh ? `✅ 深度扫描成功！已自动修复该节点！\n\n${scanInfo}` : `✅ Deep Scan successful! Node auto-healed!\n\n${scanInfo}`);
                                    }
                                    
                                    this.renderGlobalDashboard();
                                    deepScanBtn.innerHTML = zh ? '🔍 深度哈希扫描' : '🔍 Deep Hash Scan';
                                    deepScanBtn.disabled = false;
                                    deepScanBtn.style.opacity = '1';
                                }
} catch (err) {
                                alert(zh ? '❌ 状态轮询出错: ' + err.message : '❌ Poll Error: ' + err.message);
                                deepScanBtn.innerHTML = zh ? '🔍 深度哈希扫描' : '🔍 Deep Hash Scan';
                                deepScanBtn.disabled = false;
                                deepScanBtn.style.opacity = '1';
                            }
                        };
                        setTimeout(pollStatus, 500);
                        
} catch(e) {
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

if (!this._assistantPanelHooked) {
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

        // Secondary action; model replacement lives in the prominent node toolbar.
        const actionRow = document.createElement('div');
        actionRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
        const profileBtn = document.createElement('button');
        profileBtn.innerText = window.anomalous_browser_lang === 'zh' ? '📖 查看档案' : '📖 View Profile';
        profileBtn.style.cssText = 'flex:1;padding:9px 12px;background:rgba(138,180,248,0.1);color:#8AB4F8;border:1px solid rgba(138,180,248,0.3);border-radius:6px;cursor:pointer;font-size:13px;transition:filter 0.2s;';
        profileBtn.onmouseover = () => profileBtn.style.filter = 'brightness(1.2)';
        profileBtn.onmouseout = () => profileBtn.style.filter = 'brightness(1)';

        actionRow.appendChild(profileBtn);
        wrapper.appendChild(actionRow);
        container.appendChild(wrapper);

        // Async: load preview + metadata
        fetch(`/anomalous/find_model?search=${encodeURIComponent(val.replace(/\\/g, '/'))}`)
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(d => {
                // Preview
                if (d.status === 'success' && d.model && d.model.preview_url) {
                    previewBox.innerHTML = '';
                    const pu = d.model.preview_url;
                    const isVid = /\.(mp4|webm)(?:$|\?|&|#)/i.test(pu);
if (isVid) {
                        const vid = document.createElement('video');
                        vid.src = pu; vid.muted = true; vid.loop = true; vid.autoplay = true; vid.playsInline = true;
                        vid.style.cssText = 'width:100%;height:100%;object-fit:contain;';
                        previewBox.appendChild(vid);
                    } else {
                        const img = document.createElement('img');
                        img.src = pu;
                        img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
                        previewBox.appendChild(img);
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
if (d.type || meta.baseModel) {
                        const badgeRow = document.createElement('div');
                        badgeRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
if (d.type) {
                            const b = document.createElement('span');
                            b.style.cssText = 'background:rgba(138,180,248,0.15);color:#8AB4F8;padding:3px 8px;border-radius:4px;font-size:11px;';
                            b.innerText = d.type; badgeRow.appendChild(b);
                        }
if (meta.baseModel) {
                            const b = document.createElement('span');
                            b.style.cssText = 'background:rgba(0,255,204,0.1);color:#00ffcc;padding:3px 8px;border-radius:4px;font-size:11px;';
                            b.innerText = meta.baseModel; badgeRow.appendChild(b);
                        }
                        metaZone.appendChild(badgeRow);
                    }

                    // Trigger words
                    const triggers = meta.trainedWords || meta.trigger_words || meta.trained_words;
if (triggers && triggers.length > 0) {
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
if (textNotes) {
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
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
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
if (model) {
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
                    card.onmouseover = () => { 
                        card.style.transform = 'scale(1.05)'; card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)'; 
                        const v = card.querySelector('video'); if (v) v.play().catch(()=>{}); 
                    };
                    card.onmouseout = () => { 
                        card.style.transform = 'scale(1)'; card.style.boxShadow = 'none'; 
                        const v = card.querySelector('video'); if (v) v.pause(); 
                    };
                    const imgUrl = img.url || img;
                    const isVid = /\.(mp4|webm)(?:$|\?|&|#)/i.test(imgUrl);
                    if (isVid) {
                        const vidEl = document.createElement('video');
                        vidEl.src = imgUrl; vidEl.muted = true; vidEl.loop = true; vidEl.autoplay = false; vidEl.playsInline = true; vidEl.preload = 'metadata';
                        vidEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                        card.appendChild(vidEl);
                    } else {
                        const imgEl = document.createElement('img');
                        imgEl.src = imgUrl;
                        imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                        imgEl.loading = 'lazy';
                        card.appendChild(imgEl);
                    }
if (img.workflow) {
                        card.title = window.anomalous_browser_lang === 'zh' ? '点击恢复此工作流' : 'Click to restore workflow';
                        card.onclick = () => {
                            try {
                                const wf = typeof img.workflow === 'string' ? JSON.parse(img.workflow) : img.workflow;
                                if (app && app.loadGraphData) app.loadGraphData(wf);
                            } catch (e) { }
                        };
} else if (model) {
                        card.title = window.anomalous_browser_lang === 'zh' ? '点击查看完整图库' : 'Click to view full gallery';
                        card.onclick = () => this.showGeneratedGallery(model);
                    }
                    grid.appendChild(card);
                });
                section.appendChild(grid);
                container.appendChild(section);
            }).catch(() => { });
    }

export function _openGalleryReplacer(node, w, options = {}) {
        const zh = window.anomalous_browser_lang === 'zh';
        const mode = options.mode === 'insert' ? 'insert' : 'replace';
        const validPaths = getNativeWidgetValues(node, w);
        if (!validPaths.length) {
            alert(zh ? '没有可供选择的兼容模型。' : 'No compatible models are available.');
            return;
        }

        const normalizePath = value => String(value || '').replace(/\\/g, '/');
        const getName = value => normalizePath(value).split('/').pop() || normalizePath(value);
        const getFolder = value => {
            const normalized = normalizePath(value);
            const splitAt = normalized.lastIndexOf('/');
            return splitAt >= 0 ? normalized.slice(0, splitAt) : '';
        };
        const currentPath = mode === 'replace'
            ? validPaths.find(path => normalizePath(path) === normalizePath(w.value)) || null
            : null;
        let selectedPath = currentPath;
        let selectedFolder = '';
        let previews = {};
        let renderGeneration = 0;
        let applying = false;

        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:999999;display:flex;flex-direction:column;padding:24px;box-sizing:border-box;color:#fff;font-family:Inter,Arial,sans-serif;';
        const stopMedia = container => container?.querySelectorAll?.('video,audio').forEach(media => {
            media.pause();
            media.removeAttribute('src');
            media.load?.();
        });
        const closeModal = () => {
            renderGeneration += 1;
            stopMedia(modal);
            modal.remove();
        };

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-shrink:0;';
        const title = document.createElement('h2');
        title.style.cssText = 'margin:0;font-size:20px;';
        title.textContent = mode === 'insert'
            ? (options.direction === 'before'
                ? (zh ? '⬅ 在节点前方插入 LoRA' : '⬅ Insert LoRA Before Node')
                : (zh ? '在节点后方插入 LoRA ➡' : 'Insert LoRA After Node ➡'))
            : (zh ? '🔀 更换当前模型' : '🔀 Change Current Model');
        const typeBadge = document.createElement('span');
        typeBadge.textContent = options.modelTypeLabel || node?.type || w?.name || (zh ? '兼容模型' : 'Compatible');
        typeBadge.style.cssText = 'padding:4px 9px;border-radius:20px;background:rgba(33,150,243,0.16);border:1px solid rgba(33,150,243,0.35);color:#8ab4f8;font-size:11px;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'margin-left:auto;background:transparent;border:none;color:#aaa;font-size:24px;cursor:pointer;padding:4px 8px;';
        closeBtn.onclick = closeModal;
        header.append(title, typeBadge, closeBtn);
        modal.appendChild(header);

        const body = document.createElement('div');
        body.style.cssText = 'display:grid;grid-template-columns:minmax(190px,260px) minmax(0,1fr);gap:16px;min-height:0;flex:1;';
        const folderPanel = document.createElement('aside');
        folderPanel.style.cssText = 'background:#171719;border:1px solid #333;border-radius:10px;overflow:auto;padding:10px;';
        const folderTitle = document.createElement('div');
        folderTitle.textContent = zh ? '📁 文件夹' : '📁 Folders';
        folderTitle.style.cssText = 'font-size:13px;font-weight:700;color:#ddd;padding:8px 10px 10px;';
        const folderList = document.createElement('div');
        folderList.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
        folderPanel.append(folderTitle, folderList);

        const content = document.createElement('section');
        content.style.cssText = 'display:flex;flex-direction:column;min-width:0;min-height:0;background:#151517;border:1px solid #333;border-radius:10px;overflow:hidden;';
        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'display:flex;gap:10px;padding:12px;border-bottom:1px solid #333;flex-wrap:wrap;align-items:center;';
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = zh ? '🔍 搜索名称或完整路径…' : '🔍 Search name or full path…';
        searchInput.style.cssText = 'flex:1;min-width:220px;padding:10px 12px;border-radius:7px;border:1px solid #444;background:#222;color:#fff;font-size:14px;outline:none;';
        const sortSelect = document.createElement('select');
        sortSelect.style.cssText = 'padding:10px 12px;border-radius:7px;border:1px solid #444;background:#222;color:#fff;font-size:13px;';
        [
            ['name-asc', zh ? '名称 A–Z' : 'Name A–Z'],
            ['name-desc', zh ? '名称 Z–A' : 'Name Z–A'],
            ['folder-asc', zh ? '按文件夹' : 'By Folder'],
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            sortSelect.appendChild(option);
        });
        const resultCount = document.createElement('span');
        resultCount.style.cssText = 'color:#888;font-size:12px;white-space:nowrap;';
        toolbar.append(searchInput, sortSelect, resultCount);
        content.appendChild(toolbar);

        const loadingText = document.createElement('div');
        loadingText.textContent = zh ? '⏳ 正在加载模型封面…' : '⏳ Loading model covers…';
        loadingText.style.cssText = 'color:#888;font-size:13px;padding:10px 14px 0;';
        const gridScroll = document.createElement('div');
        gridScroll.style.cssText = 'overflow:auto;min-height:0;flex:1;padding:14px;';
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;align-content:start;';
        gridScroll.appendChild(grid);
        content.append(loadingText, gridScroll);
        body.append(folderPanel, content);
        modal.appendChild(body);

        const footer = document.createElement('div');
        footer.style.cssText = 'display:flex;align-items:center;gap:12px;margin-top:14px;flex-shrink:0;';
        const selectionText = document.createElement('div');
        selectionText.style.cssText = 'min-width:0;flex:1;color:#aaa;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = zh ? '取消' : 'Cancel';
        cancelBtn.style.cssText = 'padding:10px 18px;background:#333;color:#ddd;border:1px solid #555;border-radius:7px;cursor:pointer;';
        cancelBtn.onclick = closeModal;
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = mode === 'insert'
            ? (zh ? '插入并自动连线' : 'Insert & Auto-Connect')
            : (zh ? '确认替换' : 'Confirm Replacement');
        confirmBtn.style.cssText = 'padding:10px 20px;background:#1976d2;color:#fff;border:none;border-radius:7px;cursor:pointer;font-weight:700;';
        footer.append(selectionText, cancelBtn, confirmBtn);
        modal.appendChild(footer);
        document.body.appendChild(modal);

        const folderCounts = new Map([['', validPaths.length]]);
        validPaths.forEach(path => {
            const parts = getFolder(path).split('/').filter(Boolean);
            let accumulated = '';
            parts.forEach(part => {
                accumulated = accumulated ? `${accumulated}/${part}` : part;
                folderCounts.set(accumulated, (folderCounts.get(accumulated) || 0) + 1);
            });
        });

        const updateSelection = () => {
            selectionText.textContent = selectedPath
                ? `${zh ? '已选择' : 'Selected'}: ${normalizePath(selectedPath)}`
                : (zh ? '请选择一个模型。节点连接和强度不会被改动。' : 'Choose a model. Existing connections and strengths will be preserved.');
            confirmBtn.disabled = !selectedPath || applying;
            confirmBtn.style.opacity = confirmBtn.disabled ? '0.45' : '1';
            confirmBtn.style.cursor = confirmBtn.disabled ? 'not-allowed' : 'pointer';
        };

        let renderCards = () => {};
        const renderFolders = () => {
            folderList.replaceChildren();
            const folders = ['', ...[...folderCounts.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))];
            folders.forEach(folderPath => {
                const button = document.createElement('button');
                const depth = folderPath ? folderPath.split('/').length - 1 : 0;
                const label = folderPath ? folderPath.split('/').pop() : (zh ? '全部模型' : 'All Models');
                button.textContent = `${folderPath ? '📂' : '📦'} ${label} (${folderCounts.get(folderPath) || 0})`;
                button.title = folderPath || label;
                button.style.cssText = `text-align:left;padding:7px 8px 7px ${8 + depth * 14}px;border-radius:6px;border:none;cursor:pointer;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${selectedFolder === folderPath ? '#fff' : '#aaa'};background:${selectedFolder === folderPath ? 'rgba(25,118,210,0.45)' : 'transparent'};`;
                button.onclick = () => {
                    selectedFolder = folderPath;
                    renderFolders();
                    renderCards();
                };
                folderList.appendChild(button);
            });
        };

        renderCards = () => {
            const term = searchInput.value.trim().toLowerCase();
            const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
            const paths = validPaths.filter(path => {
                const normalized = normalizePath(path);
                const folderPath = getFolder(normalized);
                const inFolder = !selectedFolder || folderPath === selectedFolder || folderPath.startsWith(`${selectedFolder}/`);
                return inFolder && (!term || normalized.toLowerCase().includes(term));
            });
            if (sortSelect.value === 'name-desc') paths.sort((a, b) => collator.compare(getName(b), getName(a)));
            else if (sortSelect.value === 'folder-asc') paths.sort((a, b) => collator.compare(normalizePath(a), normalizePath(b)));
            else paths.sort((a, b) => collator.compare(getName(a), getName(b)));

            resultCount.textContent = zh ? `${paths.length} 个结果` : `${paths.length} results`;
            stopMedia(grid);
            grid.replaceChildren();
            const generation = ++renderGeneration;
            let index = 0;
            const renderChunk = () => {
                if (generation !== renderGeneration || !modal.isConnected) return;
                const fragment = document.createDocumentFragment();
                const end = Math.min(index + 40, paths.length);
                for (; index < end; index += 1) {
                    const path = paths[index];
                    const isSelected = selectedPath === path;
                    const isCurrent = currentPath === path;
                    const card = document.createElement('div');
                    card.tabIndex = 0;
                    card.setAttribute('role', 'button');
                    card.style.cssText = `position:relative;background:#222;border-radius:8px;overflow:hidden;cursor:pointer;display:flex;flex-direction:column;border:2px solid ${isSelected ? '#42a5f5' : isCurrent ? '#ffc107' : '#3b3b3b'};box-shadow:${isSelected ? '0 0 0 2px rgba(66,165,245,0.2)' : 'none'};transition:transform 0.12s;min-width:0;`;
                    const previewBox = document.createElement('div');
                    previewBox.style.cssText = 'height:150px;background:#101012;display:flex;align-items:center;justify-content:center;font-size:30px;position:relative;overflow:hidden;';
                    const previewUrl = previews[path];
                    if (/\.(mp4|webm)(?:$|\?|&|#)/i.test(previewUrl || '')) {
                        const video = document.createElement('video');
                        video.src = previewUrl;
                        video.muted = true;
                        video.loop = true;
                        video.playsInline = true;
                        video.preload = 'metadata';
                        video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                        previewBox.appendChild(video);
                    } else if (previewUrl) {
                        const image = document.createElement('img');
                        image.src = previewUrl;
                        image.alt = '';
                        image.loading = 'lazy';
                        image.decoding = 'async';
                        image.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                        previewBox.appendChild(image);
                    } else {
                        previewBox.textContent = '🖼️';
                    }
                    if (isCurrent) {
                        const badge = document.createElement('span');
                        badge.textContent = zh ? '当前' : 'Current';
                        badge.style.cssText = 'position:absolute;top:6px;left:6px;background:rgba(255,193,7,0.92);color:#111;padding:3px 6px;border-radius:4px;font-size:10px;font-weight:800;';
                        previewBox.appendChild(badge);
                    }
                    const name = document.createElement('div');
                    name.textContent = getName(path);
                    name.title = normalizePath(path);
                    name.style.cssText = 'padding:8px 8px 3px;font-size:12px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;';
                    const folder = document.createElement('div');
                    folder.textContent = getFolder(path) || (zh ? '根目录' : 'Root');
                    folder.title = getFolder(path);
                    folder.style.cssText = 'padding:0 8px 8px;font-size:10px;color:#777;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                    card.append(previewBox, name, folder);
                    const choose = () => {
                        selectedPath = path;
                        updateSelection();
                        renderCards();
                    };
                    card.onclick = choose;
                    card.onkeydown = event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            choose();
                        }
                    };
                    card.onmouseenter = () => {
                        card.style.transform = 'translateY(-2px)';
                        card.querySelector('video')?.play?.().catch(() => {});
                    };
                    card.onmouseleave = () => {
                        card.style.transform = 'none';
                        card.querySelector('video')?.pause?.();
                    };
                    fragment.appendChild(card);
                }
                grid.appendChild(fragment);
                if (index < paths.length) requestAnimationFrame(renderChunk);
            };
            if (paths.length) requestAnimationFrame(renderChunk);
            else {
                const empty = document.createElement('div');
                empty.textContent = zh ? '没有符合条件的模型。' : 'No models match the current filters.';
                empty.style.cssText = 'color:#777;padding:30px;text-align:center;grid-column:1/-1;';
                grid.appendChild(empty);
            }
        };

        confirmBtn.onclick = () => {
            if (!selectedPath || applying) return;
            applying = true;
            updateSelection();
            const oldValue = w.value;
            try {
                if (mode === 'insert') {
                    setWidgetValue(node, w, selectedPath);
                    spliceModelChainNode({ graph: app.graph, anchorNode: options.anchorNode, insertedNode: node, direction: options.direction });
                    try {
                        if (typeof w.callback === 'function') w.callback(w.value, app.canvas, node, app.canvas?.graph_mouse, null);
                    } catch (error) {
                        console.warn('[Anomalous] LoRA widget callback failed:', error);
                    }
                } else {
                    app.graph?.beforeChange?.(node);
                    try {
                        setWidgetValue(node, w, selectedPath);
                        if (typeof w.callback === 'function') w.callback(w.value, app.canvas, node, app.canvas?.graph_mouse, null);
                        app.graph?.afterChange?.(node);
                    } catch (error) {
                        setWidgetValue(node, w, oldValue);
                        app.graph?.afterChange?.(node);
                        throw error;
                    }
                    app.graph?.change?.();
                    app.graph?.setDirtyCanvas?.(true, true);
                }
                delete node.color;
                delete node.bgcolor;
                node.has_errors = false;
                if (app.lastNodeErrors?.[node.id]) delete app.lastNodeErrors[node.id];
                if (typeof app.clearErrors === 'function') app.clearErrors();
                try { window.dispatchEvent(new CustomEvent('graphChanged')); } catch (error) {}
                closeModal();
                if (mode === 'insert' && app.canvas?.selectNode) app.canvas.selectNode(node);
                else this.diagnoseNode(node);
            } catch (error) {
                setWidgetValue(node, w, oldValue);
                applying = false;
                updateSelection();
                console.error('[Anomalous] Failed to apply model choice:', error);
                alert(zh ? `操作失败：${error.message}` : `Operation failed: ${error.message}`);
            }
        };

        searchInput.oninput = renderCards;
        sortSelect.onchange = renderCards;
        modal.onkeydown = event => { if (event.key === 'Escape') closeModal(); };
        renderFolders();
        updateSelection();
        renderCards();
        setTimeout(() => searchInput.focus(), 0);

        fetch('/anomalous/resolve_paths_to_previews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: validPaths }),
        }).then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        }).then(data => {
            if (!modal.isConnected) return;
            previews = data.previews || {};
            loadingText.style.display = 'none';
            renderCards();
        }).catch(error => {
            if (!modal.isConnected) return;
            console.error('[Anomalous] Failed to load model previews:', error);
            loadingText.textContent = zh ? '⚠️ 封面加载失败，仍可按名称选择模型。' : '⚠️ Covers failed to load; models remain selectable by name.';
        });
    }

export function runGlobalDoctorScan() {
        const content = document.getElementById('anomalous-doctor-node-list');
        const inst = document.getElementById('anomalous-doctor-instructions');
        if (inst) inst.style.display = 'none';
        if (content) content.innerHTML = '';
        if (!content || !app.graph || !Array.isArray(app.graph._nodes)) return;

        let totalNodes = 0;
        let missingNodes = 0;

for (const node of app.graph._nodes) {
if (node.widgets) {
for (let w of node.widgets) {
                    const val = w.value;
                    if (typeof val === 'string' && val.match(/\.(safetensors|ckpt|pt|bin|pth|sft)$/i)) {
                        totalNodes++;
                        let isHealthy = false;
                        if (w.options && w.options.values && w.options.values.includes(val)) isHealthy = true;
if (!isHealthy) {
                            missingNodes++;
                            const nodeTitle = document.createElement('div');
                            nodeTitle.textContent = `${window.anomalous_browser_lang === 'zh' ? '节点' : 'Node'}: ${node.title || node.type}`;
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
