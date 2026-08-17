import { app } from "../../../scripts/app.js";
import { translate } from './locales.js';
import { escapeHtml } from './safe_dom.js';
import {
    analyzeModelChainInsertion,
    getModelChainInsertionCapabilities,
    spliceModelChainNode,
} from './graph_splice.js';
import {
    collectMainModelContextRequests,
    formatModelTypeLabel,
    getBaseModelFamily,
    inferPickerModelType,
} from './model_picker.js';
/**
 * ui_doctor.js
 * Extracted Doctor Panel & Assistant Panel methods.
 */

const t = (key, params) => translate(key, params);

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
        titleEl.innerHTML = `<span style="font-size:24px; filter: drop-shadow(0 0 8px rgba(0,255,204,0.3));">🩺</span><span style="font-size:18px;font-weight:600;color:#fff;font-family:Inter, sans-serif; letter-spacing: 0.5px;">${t('doctorTitle')}</span>`;
        
        // Header control group on the right side (contains toggle & close button)
        const controlGroup = document.createElement('div');
        controlGroup.style.cssText = 'display:flex;align-items:center;gap:12px;';

        // Auto Scan Toggle inside Doctor Panel
        const autoScanToggle = document.createElement('div');
        autoScanToggle.style.cssText = 'display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.05);padding:6px 12px;border-radius:6px;cursor:pointer;transition:all 0.2s;';
        
        const renderAutoScanToggle = () => {
            let isAutoEnabled = localStorage.getItem('anomalous_auto_scan_enabled') === 'true';
            autoScanToggle.innerHTML = isAutoEnabled
                ? `<span style="font-size:16px;">🛎️</span><span style="font-size:12px;color:#00ffcc;font-weight:500;">${t('doctorAutoScanOn')}</span>`
                : `<span style="font-size:16px;opacity:0.5;">🔕</span><span style="font-size:12px;color:#aaa;">${t('doctorAutoScanOff')}</span>`;
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
        refreshBtn.textContent = t('doctorRefresh');
        refreshBtn.style.cssText = 'background:rgba(138,180,248,0.1);border:1px solid rgba(138,180,248,0.3);color:#8AB4F8;font-size:12px;cursor:pointer;padding:6px 12px;border-radius:6px;transition:all 0.2s; font-weight:600;';
        refreshBtn.title = t('doctorRefreshTitle');
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
    const messages = {
        missing_graph_or_node: 'doctorGraphUnavailable',
        missing_chain_inputs: 'doctorMissingChainInputs',
        unconnected_chain_inputs: 'doctorUnconnectedChainInputs',
        missing_chain_outputs: 'doctorMissingChainOutputs',
        ambiguous_downstream_branches: 'doctorAmbiguousBranches',
        invalid_downstream_link: 'doctorInvalidDownstream',
    };
    return t(messages[capability?.code] || 'doctorUnsupportedInsertion');
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
        alert(t('doctorCreateLoraFailed'));
        return;
    }

    const modelWidget = findModelComboWidget(insertedNode);
    if (!modelWidget || getNativeWidgetValues(insertedNode, modelWidget).length === 0) {
        alert(t('doctorLoraNotReady'));
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

export function diagnoseNode(node, forceRefresh = false) {
        // This method serves the Node Assistant panel only
        if (!this.assistantPanelInitialized) {
            this.initAssistantPanel();
        }
        const placeholder = document.getElementById('anomalous-assistant-placeholder');
        const nodeContent = document.getElementById('anomalous-assistant-node-content');
        if (!placeholder || !nodeContent || !app.graph || !app.graph._nodes) return;

if (!node) {
            placeholder.innerHTML = `<div style="font-size:48px;">🤖</div><div style="text-align:center;">${t('assistantSelectNode')}</div>`;
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

        const hasModelOrInsertion = modelWidgets.length > 0 || canInsert;

        placeholder.style.display = 'none';
        nodeContent.style.display = 'flex';
        nodeContent.innerHTML = '';

        const titleBar = document.createElement('div');
        titleBar.style.cssText = 'margin:14px 16px 0;padding:16px;border:1px solid rgba(138,180,248,0.16);border-radius:14px;background:linear-gradient(135deg,rgba(48,58,86,0.72),rgba(20,22,31,0.92));display:flex;align-items:center;gap:12px;flex-shrink:0;box-shadow:0 12px 30px rgba(0,0,0,0.18);';
        titleBar.innerHTML = `<span style="width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:20px;background:linear-gradient(135deg,#8ab4f8,#7c4dff);box-shadow:0 6px 16px rgba(66,133,244,0.3);">🤖</span><span style="display:flex;flex-direction:column;min-width:0;gap:3px;"><span style="font-size:10px;letter-spacing:0.11em;text-transform:uppercase;color:#8ab4f8;">${t('assistantSelectedNode')}</span><span class="ast-title" style="font-weight:750;color:#fff;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></span></span><span class="ast-type" style="font-size:10px;color:#c9d6ff;margin-left:auto;padding:5px 8px;border-radius:999px;border:1px solid rgba(138,180,248,0.24);background:rgba(138,180,248,0.08);max-width:38%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></span>`;
        titleBar.querySelector('.ast-title').textContent = node.title || node.type || 'Node';
        titleBar.querySelector('.ast-type').textContent = node.type || '';

        const refreshBtn = document.createElement('button');
        refreshBtn.title = t('refresh') || 'Refresh';
        refreshBtn.innerHTML = '🔄';
        refreshBtn.style.cssText = 'background:none; border:none; color:#c9d6ff; cursor:pointer; font-size:14px; padding:4px; margin-left:4px; border-radius:4px; transition:background 0.2s, transform 0.3s; display:flex; align-items:center; justify-content:center;';
        refreshBtn.onmouseover = () => refreshBtn.style.background = 'rgba(255,255,255,0.1)';
        refreshBtn.onmouseout = () => refreshBtn.style.background = 'none';
        refreshBtn.onclick = () => {
            refreshBtn.style.transform = 'rotate(180deg)';
            setTimeout(() => this.diagnoseNode(node, true), 150);
        };
        titleBar.appendChild(refreshBtn);

        nodeContent.appendChild(titleBar);

        const quickActions = document.createElement('div');
        quickActions.style.cssText = 'padding:14px 16px 4px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;flex-shrink:0;';
        const actionsLabel = document.createElement('div');
        actionsLabel.textContent = t('assistantQuickActions');
        actionsLabel.style.cssText = 'grid-column:1/-1;color:#8b91a3;font-size:10px;font-weight:750;letter-spacing:0.1em;text-transform:uppercase;padding:0 2px 2px;';
        quickActions.appendChild(actionsLabel);

        const makeActionButton = ({ icon, label, hint, accent, onClick, capability = null, primary = false }) => {
            const button = document.createElement('button');
            const enabled = !capability || capability.supported;
            button.disabled = !enabled;
            const gridPlacement = primary ? 'grid-column:1/-1;' : '';
            button.style.cssText = gridPlacement + (enabled
                ? `min-width:0;padding:${primary ? '13px 14px' : '11px 10px'};background:${accent};color:#fff;border:1px solid rgba(255,255,255,0.14);border-radius:11px;cursor:pointer;text-align:left;display:flex;align-items:center;gap:10px;transition:transform 0.15s,filter 0.15s,box-shadow 0.15s;box-shadow:0 8px 18px rgba(0,0,0,0.14);`
                : 'min-width:0;padding:11px 10px;background:rgba(255,255,255,0.035);color:#656b78;border:1px solid rgba(255,255,255,0.055);border-radius:11px;cursor:not-allowed;text-align:left;display:flex;align-items:center;gap:9px;');
            const iconEl = document.createElement('span');
            iconEl.textContent = icon;
            iconEl.style.cssText = `width:${primary ? '34px' : '28px'};height:${primary ? '34px' : '28px'};border-radius:9px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,${enabled ? '0.14' : '0.04'});font-size:${primary ? '17px' : '14px'};flex-shrink:0;`;
            const copy = document.createElement('span');
            copy.style.cssText = 'min-width:0;display:flex;flex-direction:column;gap:2px;';
            const title = document.createElement('span');
            title.textContent = label;
            title.style.cssText = `font-weight:750;font-size:${primary ? '13px' : '11px'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
            const subtitle = document.createElement('span');
            subtitle.textContent = enabled ? hint : getInsertionCapabilityMessage(capability);
            subtitle.style.cssText = `font-size:9px;color:${enabled ? 'rgba(255,255,255,0.68)' : '#555b66'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
            copy.append(title, subtitle);
            button.append(iconEl, copy);
            if (enabled) {
                button.onmouseover = () => { button.style.filter = 'brightness(1.12)'; button.style.transform = 'translateY(-1px)'; };
                button.onmouseout = () => { button.style.filter = 'brightness(1)'; button.style.transform = 'none'; };
                button.onclick = onClick;
            } else if (capability) {
                button.title = getInsertionCapabilityMessage(capability);
            }
            quickActions.appendChild(button);
        };

        for (const widget of modelWidgets) {
            const widgetLabel = modelWidgets.length > 1 && widget.name
                ? t('assistantChangeWidget', { name: widget.name })
                : t('assistantChangeCurrent');
            const pickerType = inferPickerModelType(node, widget);
            makeActionButton({
                icon: '⇄',
                label: widgetLabel,
                hint: t('assistantVisualPicker', { type: pickerType.label }),
                accent: 'linear-gradient(135deg,rgba(245,124,0,0.96),rgba(255,82,82,0.82))',
                onClick: () => this._openGalleryReplacer(node, widget),
                primary: true,
            });
        }
        makeActionButton({
            icon: '←',
            label: t('assistantInsertBefore'),
            hint: t('assistantConnectInputs'),
            accent: 'linear-gradient(135deg,rgba(25,118,210,0.9),rgba(80,110,230,0.82))',
            onClick: () => this.openLoraInsertionPicker(node, 'before'),
            capability: insertionCapabilities.before,
        });
        makeActionButton({
            icon: '→',
            label: t('assistantInsertAfter'),
            hint: t('assistantConnectOutputs'),
            accent: 'linear-gradient(135deg,rgba(0,137,123,0.92),rgba(67,160,71,0.82))',
            onClick: () => this.openLoraInsertionPicker(node, 'after'),
            capability: insertionCapabilities.after,
        });
        const tabsRow = document.createElement('div');
        tabsRow.style.cssText = 'display:flex; padding: 10px 16px 0; gap: 8px; flex-shrink:0;';
        
        const btnActions = document.createElement('button');
        btnActions.textContent = t('assistantTabActions') || '🛠️ Quick Actions';
        btnActions.style.cssText = 'flex:1; padding: 8px; border-radius: 8px; background: rgba(255,255,255,0.1); color: #fff; cursor: pointer; border: none; font-size: 11px; font-weight: bold; transition: background 0.2s;';
        
        const btnPresets = document.createElement('button');
        btnPresets.textContent = t('assistantTabPresets') || '📚 Parameter Presets';
        btnPresets.style.cssText = 'flex:1; padding: 8px; border-radius: 8px; background: transparent; color: #aaa; cursor: pointer; border: none; font-size: 11px; font-weight: bold; transition: background 0.2s;';
        
        tabsRow.append(btnActions, btnPresets);
        nodeContent.appendChild(tabsRow);

        const actionsContainer = document.createElement('div');
        actionsContainer.style.cssText = 'display:flex; flex-direction:column; flex:1; overflow-y:auto;';

        const presetsContainer = document.createElement('div');
        presetsContainer.style.cssText = 'display:none; flex-direction:column; flex:1; overflow-y:auto;';

        nodeContent.append(actionsContainer, presetsContainer);

        btnActions.onclick = () => {
            btnActions.style.background = 'rgba(255,255,255,0.1)';
            btnActions.style.color = '#fff';
            btnPresets.style.background = 'transparent';
            btnPresets.style.color = '#aaa';
            actionsContainer.style.display = 'flex';
            presetsContainer.style.display = 'none';
        };

        btnPresets.onclick = () => {
            btnPresets.style.background = 'rgba(255,255,255,0.1)';
            btnPresets.style.color = '#fff';
            btnActions.style.background = 'transparent';
            btnActions.style.color = '#aaa';
            presetsContainer.style.display = 'flex';
            actionsContainer.style.display = 'none';
        };

        if (hasModelOrInsertion) {
            actionsContainer.appendChild(quickActions);
            for (const w of modelWidgets) {
                this.renderAssistantModelCard(node, w, actionsContainer);
            }
        } else {
            const noModelWarning = document.createElement('div');
            noModelWarning.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 30px 20px;';
            noModelWarning.innerHTML = `<div style="font-size:36px;margin-bottom:10px;">⚠️</div><div style="text-align:center;color:#aaa;font-size:12px;">${t('assistantNoModelParameter')}</div><div style="font-size:10px;color:#555;margin-top:6px;">${escapeHtml(node.type || '')}</div>`;
            actionsContainer.appendChild(noModelWarning);
            
            btnPresets.onclick(); // switch to presets by default if no model actions
        }

        renderParameterPresets.call(this, node, presetsContainer, forceRefresh);
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
        statsRow.innerHTML = `
            ${createBadge(t('doctorTotal'), total, '#aaa', 'rgba(255,255,255,0.05)')}
            ${createBadge(t('doctorHealthy'), healthy, '#28a745', 'rgba(40, 167, 69, 0.1)')}
            ${createBadge(t('doctorMissing'), missing, '#ff6b6b', 'rgba(220, 53, 69, 0.1)')}
        `;

        if (total === 0) {
            content.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.3);font-size:14px;">
                <div style="font-size:48px;margin-bottom:16px;">👻</div>
                ${t('doctorNoWorkflowModels')}
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
                right.innerHTML = `<div style="text-align:right;"><div style="color:#ffc107;font-size:13px;font-weight:bold;">🟡 ${t('doctorAutoRedirected')}</div><div style="color:rgba(255,255,255,0.4);font-size:11px;margin-top:4px;">${escapeHtml(exactMatch.split(/[\/]/).pop())}</div></div>`;
} else if (isHealthy) {
                right.innerHTML = `<div style="color:#28a745;font-size:13px;font-weight:bold;padding:6px 12px;background:rgba(40,167,69,0.1);border-radius:20px;">🟢 ${t('doctorReady')}</div>`;
            } else {
                right.innerHTML = `<div style="color:#ff6b6b;font-size:13px;font-weight:bold;padding:6px 12px;background:rgba(220,53,69,0.1);border-radius:20px;">🔴 ${t('doctorMissingStatus')}</div>`;
            }

            top.appendChild(left);
            top.appendChild(right);
            item.appendChild(top);

            const actionRow = document.createElement('div');
            actionRow.style.cssText = 'display:flex; gap:10px; margin-top:16px; margin-left:8px;';
            const civitaiBtn = document.createElement('button');
            civitaiBtn.textContent = t('doctorCivitai');
            civitaiBtn.style.cssText = 'padding:8px 16px; background:rgba(255,255,255,0.1); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px; transition:background 0.2s;';
            civitaiBtn.onmouseover = () => civitaiBtn.style.background = 'rgba(255,255,255,0.2)';
            civitaiBtn.onmouseout = () => civitaiBtn.style.background = 'rgba(255,255,255,0.1)';
            civitaiBtn.onclick = async () => {
                let searchHash = null;
                if (app.graph && app.graph.extra && app.graph.extra.anomalous_hashes) {
                    const normVal = val.replace(/\\/g, '/');
                    const winVal = val.replace(/\//g, '\\');
                    const hData = app.graph.extra.anomalous_hashes[`${node.id}_${val}`] ||
                                  app.graph.extra.anomalous_hashes[`${node.id}_${normVal}`] ||
                                  app.graph.extra.anomalous_hashes[`${node.id}_${winVal}`] ||
                                  app.graph.extra.anomalous_hashes[val] ||
                                  app.graph.extra.anomalous_hashes[normVal] ||
                                  app.graph.extra.anomalous_hashes[winVal];
                    if (hData) searchHash = typeof hData === 'string' ? hData : hData.hash;
                }
                if (!searchHash && window.anomalous_hash_cache) {
                    const normVal = val.replace(/\\/g, '/');
                    const basename = val.split(/[/\\]/).pop();
                    const cData = window.anomalous_hash_cache[val] || window.anomalous_hash_cache[normVal] || window.anomalous_hash_cache[basename];
                    if (cData) searchHash = typeof cData === 'string' ? cData : cData.hash;
                }

                if (searchHash) {
                    const prevText = civitaiBtn.textContent;
                    civitaiBtn.textContent = '⏳...';
                    try {
                        const res = await fetch(`https://civitai.com/api/v1/model-versions/by-hash/${encodeURIComponent(searchHash)}`);
                        if (res.ok) {
                            const data = await res.json();
                            if (data && data.modelId) {
                                const nsfwLevel = data.nsfwLevel || 1;
                                const isNsfw = (data.model && data.model.nsfw) || (nsfwLevel > 1);
                                const domain = isNsfw ? 'civitai.red' : 'civitai.com';
                                let targetUrl = `https://${domain}/models/${data.modelId}`;
                                if (data.id) {
                                    targetUrl += `?modelVersionId=${data.id}`;
                                }
                                window.open(targetUrl, '_blank');
                                civitaiBtn.textContent = prevText;
                                return;
                            }
                        }
                    } catch (e) {
                        console.warn("[Anomalous Doctor] Failed to query Civitai by hash, fallback to query search:", e);
                    }
                    civitaiBtn.textContent = prevText;
                }

                const searchStr = val.split(/[/\\]/).pop().replace('.safetensors', '').replace('.ckpt', '').replace('.pt', '').replace('.sft', '');
                const url = `https://civitai.com/search/models?sortBy=models_v9&query=${encodeURIComponent(searchStr)}`;
                window.open(url, '_blank');
            };
            
            if (!isHealthy) {
                const deepScanBtn = document.createElement('button');
                deepScanBtn.textContent = t('doctorDeepHashScan');
                deepScanBtn.style.cssText = 'padding:8px 16px; background:#1a73e8; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px; transition:background 0.2s;';
                deepScanBtn.onmouseover = () => deepScanBtn.style.background = '#1557b0';
                deepScanBtn.onmouseout = () => deepScanBtn.style.background = '#1a73e8';
                deepScanBtn.onclick = async () => {
                    deepScanBtn.textContent = t('doctorScanStarting');
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
                                    deepScanBtn.textContent = t('doctorScanning', { current: statusData.current, total: statusData.total, filename });
                                    setTimeout(pollStatus, 500);
                                } else {
                                    if (statusData.error) {
                                        alert(t('doctorScanError') + statusData.error);
                                        deepScanBtn.textContent = t('doctorDeepHashScan');
                                        deepScanBtn.disabled = false;
                                        deepScanBtn.style.opacity = '1';
                                        return;
                                    }
                                    
                                    deepScanBtn.textContent = t('doctorMatching');
                                    
                                    if (window.anomalous_reload_hashes) {
                                        await window.anomalous_reload_hashes();
                                    }
                                    
                                    if (window.anomalous_resolve_all_missing_nodes) {
                                        await window.anomalous_resolve_all_missing_nodes(true, false);
                                    }
                                    
                                    let stillMissing = false;
                                    const currentVal = w.value;
                                    const currentNorm = typeof currentVal === 'string' ? currentVal.replace(/\\/g, '/') : '';
                                    if (w.options && w.options.values) {
                                        const match = w.options.values.find(v => typeof v === 'string' && v.replace(/\\/g, '/') === currentNorm);
                                        if (!match) stillMissing = true;
                                    }
                                    if (node.has_errors || node.color === "#FF3333" || node.bgcolor === "#FF3333") {
                                        stillMissing = true;
                                    }
                                    
                                    const scanInfo = t('doctorDeepScanSummary', { total: statusData.total });
                                        
                                    if (stillMissing) {
                                        alert(t('doctorNoLocalMatch', { summary: scanInfo }));
                                    } else {
                                        alert(t('doctorScanSuccess', { summary: scanInfo }));
                                    }
                                    
                                    this.renderGlobalDashboard();
                                    deepScanBtn.textContent = t('doctorDeepHashScan');
                                    deepScanBtn.disabled = false;
                                    deepScanBtn.style.opacity = '1';
                                }
} catch (err) {
                                alert(t('doctorPollError') + err.message);
                                deepScanBtn.textContent = t('doctorDeepHashScan');
                                deepScanBtn.disabled = false;
                                deepScanBtn.style.opacity = '1';
                            }
                        };
                        setTimeout(pollStatus, 500);
                        
} catch(e) {
                        alert(t('doctorScanFailed') + e.message);
                        deepScanBtn.textContent = t('doctorDeepHashScan');
                        deepScanBtn.disabled = false;
                        deepScanBtn.style.opacity = '1';
                    }
                };

                const manualBtn = document.createElement('button');
                manualBtn.textContent = t('doctorManualReplace');
                manualBtn.style.cssText = 'padding:8px 16px; background:rgba(255,255,255,0.1); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px; transition:background 0.2s;';
                manualBtn.onmouseover = () => manualBtn.style.background = 'rgba(255,255,255,0.2)';
                manualBtn.onmouseout = () => manualBtn.style.background = 'rgba(255,255,255,0.1)';
                manualBtn.onclick = () => {
                    this._openGalleryReplacer(node, w);
                };

                actionRow.appendChild(deepScanBtn);
                actionRow.appendChild(manualBtn);
                
                const pathText = document.createElement('div');
                pathText.textContent = t('doctorOriginalPath', { path: val });
                pathText.style.cssText = 'margin-top:12px; margin-left:8px; color:rgba(255,255,255,0.3); font-size:11px; font-family:monospace; word-break:break-all;';
                item.appendChild(pathText);
            }
            
            const viewHashBtn = document.createElement('button');
            viewHashBtn.textContent = t('doctorViewHash');
            viewHashBtn.style.cssText = 'padding:8px 16px; background:rgba(255,255,255,0.1); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px; transition:background 0.2s;';
            viewHashBtn.onmouseover = () => viewHashBtn.style.background = 'rgba(255,255,255,0.2)';
            viewHashBtn.onmouseout = () => viewHashBtn.style.background = 'rgba(255,255,255,0.1)';
            viewHashBtn.onclick = () => {
                openHashDetailDialog(node, w, val);
            };

            actionRow.appendChild(viewHashBtn);
            actionRow.appendChild(civitaiBtn);
            item.appendChild(actionRow);

            content.appendChild(item);
        }
    }

function openHashDetailDialog(node, widget, val) {
    let workflowHash = null;
    let workflowSize = null;
    if (app.graph && app.graph.extra && app.graph.extra.anomalous_hashes) {
        const normVal = val.replace(/\\/g, '/');
        const winVal = val.replace(/\//g, '\\');
        const hData = app.graph.extra.anomalous_hashes[`${node.id}_${val}`] ||
                      app.graph.extra.anomalous_hashes[`${node.id}_${normVal}`] ||
                      app.graph.extra.anomalous_hashes[`${node.id}_${winVal}`] ||
                      app.graph.extra.anomalous_hashes[val] ||
                      app.graph.extra.anomalous_hashes[normVal] ||
                      app.graph.extra.anomalous_hashes[winVal];
        if (hData) {
            workflowHash = typeof hData === 'string' ? hData : (hData.hash || null);
            workflowSize = typeof hData === 'object' ? (hData.size || null) : null;
        }
    }

    let localHash = null;
    let localSize = null;
    if (window.anomalous_hash_cache) {
        const normVal = val.replace(/\\/g, '/');
        const basename = val.split(/[/\\]/).pop();
        const cData = window.anomalous_hash_cache[val] || window.anomalous_hash_cache[normVal] || window.anomalous_hash_cache[basename];
        if (cData) {
            localHash = typeof cData === 'string' ? cData : (cData.hash || null);
            localSize = typeof cData === 'object' ? (cData.size || null) : null;
        }
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);z-index:9999999;display:flex;align-items:center;justify-content:center;font-family:Inter,-apple-system,sans-serif;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1a1c23;border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:24px;width:540px;max-width:92vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 50px rgba(0,0,0,0.6);display:flex;flex-direction:column;gap:18px;color:#fff;';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:14px;';
    headerRow.innerHTML = `<div style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px;"><span>🔑</span><span>${escapeHtml(t('doctorHashModalTitle'))}</span></div>`;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;padding:4px 8px;border-radius:6px;transition:color 0.2s;';
    closeBtn.onmouseover = () => closeBtn.style.color = '#fff';
    closeBtn.onmouseout = () => closeBtn.style.color = '#aaa';
    closeBtn.onclick = () => overlay.remove();
    headerRow.appendChild(closeBtn);
    modal.appendChild(headerRow);

    const metaSection = document.createElement('div');
    metaSection.style.cssText = 'display:flex;flex-direction:column;gap:6px;background:rgba(255,255,255,0.03);padding:12px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.05);';
    metaSection.innerHTML = `
        <div style="font-size:11px;color:#8ab4f8;font-weight:600;">#${escapeHtml(String(node.id))} · ${escapeHtml(node.title || node.type || 'Node')} · ${escapeHtml(widget?.name || '')}</div>
        <div style="font-size:13px;font-weight:600;word-break:break-all;color:#e8eaed;">${escapeHtml(val)}</div>
    `;
    modal.appendChild(metaSection);

    const formatBytes = (bytes) => {
        if (!bytes || isNaN(bytes)) return '';
        const b = parseInt(bytes);
        if (b > 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        return (b / (1024 * 1024)).toFixed(2) + ' MB';
    };

    const renderHashCard = (title, hash, size, badgeColor, isProvenance) => {
        const card = document.createElement('div');
        card.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;';

        const cardHeader = document.createElement('div');
        cardHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;font-size:12px;';
        cardHeader.innerHTML = `<span style="font-weight:600;color:${badgeColor};">${escapeHtml(title)}</span>${size ? `<span style="color:#aaa;font-size:11px;">${formatBytes(size)} (${size} B)</span>` : ''}`;
        card.appendChild(cardHeader);

        if (hash) {
            const hashBox = document.createElement('div');
            hashBox.style.cssText = 'display:flex;align-items:center;gap:8px;background:#0d0e12;padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);';

            const hashText = document.createElement('code');
            hashText.style.cssText = 'font-size:11px;color:#00ffcc;word-break:break-all;flex:1;font-family:Consolas,monospace;letter-spacing:0.5px;';
            hashText.textContent = hash;

            const copyBtn = document.createElement('button');
            copyBtn.textContent = '📋';
            copyBtn.title = 'Copy';
            copyBtn.style.cssText = 'background:rgba(255,255,255,0.08);border:none;color:#fff;cursor:pointer;padding:4px 8px;border-radius:4px;font-size:12px;transition:background 0.2s;flex-shrink:0;';
            copyBtn.onmouseover = () => copyBtn.style.background = 'rgba(255,255,255,0.18)';
            copyBtn.onmouseout = () => copyBtn.style.background = 'rgba(255,255,255,0.08)';
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(hash);
                copyBtn.textContent = '✅';
                setTimeout(() => copyBtn.textContent = '📋', 1500);
            };

            hashBox.append(hashText, copyBtn);
            card.appendChild(hashBox);
        } else {
            const emptyTip = document.createElement('div');
            emptyTip.style.cssText = 'font-size:12px;color:#888;font-style:italic;padding:4px 0;';
            emptyTip.textContent = isProvenance ? t('doctorNoHashInWorkflow') : t('doctorNoLocalHash');
            card.appendChild(emptyTip);
        }
        return card;
    };

    modal.appendChild(renderHashCard(t('doctorWorkflowHash'), workflowHash, workflowSize, '#8ab4f8', true));
    modal.appendChild(renderHashCard(t('doctorLocalHash'), localHash, localSize, '#81c995', false));

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;margin-top:4px;';
    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.cssText = 'padding:8px 24px;background:#1a73e8;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;';
    okBtn.onclick = () => overlay.remove();
    footer.appendChild(okBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
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
            };
            const originalOnDeselected = app.canvas.onNodeDeselected;
            app.canvas.onNodeDeselected = function (node) {
                if (originalOnDeselected) originalOnDeselected.apply(this, arguments);
                if (self.assistantPanel && self.assistantPanel.style.display !== 'none') {
                    const stillSelected = Object.values(app.canvas.selected_nodes || {});
                    if (stillSelected.length > 0) self.diagnoseNode(stillSelected[0]);
                    else self.diagnoseNode(null);
                }
            };
        }

        const placeholder = document.createElement('div');
        placeholder.id = 'anomalous-assistant-placeholder';
        placeholder.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;color:#666;font-size:15px;gap:12px;padding:40px;text-align:center;';
        placeholder.innerHTML = `<div style="font-size:48px;">🤖</div><div>${t('assistantSelectNode')}</div>`;
        this.assistantPanel.appendChild(placeholder);

        const nodeContent = document.createElement('div');
        nodeContent.id = 'anomalous-assistant-node-content';
        nodeContent.style.cssText = 'display:none;flex-direction:column;flex:1;overflow-y:auto;';
        this.assistantPanel.appendChild(nodeContent);
    }

export function renderAssistantModelCard(node, w, container) {
        const val = w.value;
        const filename = val.split(/[\\/]/).pop();
        const pickerType = inferPickerModelType(node, w);

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin:12px 16px 16px;padding:10px;border:1px solid rgba(255,255,255,0.075);border-radius:14px;background:linear-gradient(160deg,rgba(31,33,42,0.96),rgba(20,21,27,0.96));display:flex;flex-direction:column;gap:12px;box-shadow:0 16px 35px rgba(0,0,0,0.2);';

        // Preview image
        const previewBox = document.createElement('div');
        previewBox.style.cssText = 'width:100%;aspect-ratio:1.65;max-height:260px;background:radial-gradient(circle at 50% 20%,#252a3b,#0b0c10 70%);border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid rgba(255,255,255,0.05);';
        previewBox.innerHTML = `<span style="color:#444;font-size:13px;">${t('doctorLoadingPreview')}</span>`;
        wrapper.appendChild(previewBox);

        // Name and path
        const identityRow = document.createElement('div');
        identityRow.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:0 3px;';
        const identityCopy = document.createElement('div');
        identityCopy.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;';
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'color:#fff;font-weight:750;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        nameEl.title = filename;
        nameEl.innerText = filename;
        const pathEl = document.createElement('div');
        pathEl.style.cssText = 'color:#646b7a;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        pathEl.title = val;
        pathEl.innerText = val;
        const modelTypeBadge = document.createElement('span');
        modelTypeBadge.textContent = pickerType.label;
        modelTypeBadge.style.cssText = 'padding:5px 8px;border-radius:999px;background:rgba(138,180,248,0.1);border:1px solid rgba(138,180,248,0.22);color:#a9c7ff;font-size:9px;font-weight:750;white-space:nowrap;';
        identityCopy.append(nameEl, pathEl);
        identityRow.append(identityCopy, modelTypeBadge);
        wrapper.appendChild(identityRow);

        // Metadata zone (populated async)
        const metaZone = document.createElement('div');
        metaZone.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
        wrapper.appendChild(metaZone);

        // Secondary action; model replacement lives in the prominent node toolbar.
        const actionRow = document.createElement('div');
        actionRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
        const profileBtn = document.createElement('button');
        profileBtn.textContent = t('doctorProfile');
        profileBtn.style.cssText = 'flex:1;padding:10px 12px;background:rgba(138,180,248,0.09);color:#a9c7ff;border:1px solid rgba(138,180,248,0.22);border-radius:9px;cursor:pointer;font-size:12px;font-weight:700;transition:filter 0.2s;';
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
                    previewBox.innerHTML = `<span style="color:#444;font-size:13px;">${t('doctorNoPreview')}</span>`;
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
                    if (d.type) modelTypeBadge.textContent = formatModelTypeLabel(d.type, pickerType.label);
                    if (meta.baseModel) {
                        const badgeRow = document.createElement('div');
                        badgeRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
                        const b = document.createElement('span');
                        b.style.cssText = 'background:rgba(0,255,204,0.08);border:1px solid rgba(0,255,204,0.15);color:#77e6cf;padding:4px 8px;border-radius:999px;font-size:10px;';
                        b.textContent = `${t('doctorBase')} · ${meta.baseModel}`;
                        badgeRow.appendChild(b);
                        metaZone.appendChild(badgeRow);
                    }

                    // Trigger words
                    const triggers = meta.trainedWords || meta.trigger_words || meta.trained_words;
if (triggers && triggers.length > 0) {
                        const trigSection = document.createElement('div');
                        trigSection.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:6px;padding:10px 12px;';
                        const trigTitle = document.createElement('div');
                        trigTitle.style.cssText = 'color:#aaa;font-size:11px;margin-bottom:8px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;';
                        trigTitle.textContent = t('doctorTriggerWords');
                        const tagList = document.createElement('div');
                        tagList.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;';
                        const words = Array.isArray(triggers) ? triggers : [triggers];
                        words.forEach(word => {
                            const tag = document.createElement('span');
                            tag.style.cssText = 'background:rgba(255,193,7,0.12);color:#ffc107;padding:3px 8px;border-radius:4px;font-size:12px;cursor:pointer;';
                            tag.innerText = word;
                            tag.title = t('doctorClickCopy');
                            tag.onclick = () => {
                                navigator.clipboard.writeText(word).then(() => { const o = tag.innerText; tag.innerText = '✅'; setTimeout(() => tag.innerText = o, 1000); });
                            };
                            tagList.appendChild(tag);
                        });
                        const copyAll = document.createElement('button');
                        copyAll.style.cssText = 'background:transparent;border:1px solid #444;color:#888;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;margin-top:4px;';
                        copyAll.textContent = t('doctorCopyAll');
                        copyAll.onclick = () => {
                            navigator.clipboard.writeText(words.join(', ')).then(() => { copyAll.textContent = '✅'; setTimeout(() => copyAll.textContent = t('doctorCopyAll'), 1500); });
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
                        notesTitle.textContent = t('doctorNotes');
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
                previewBox.innerHTML = `<span style="color:#444;font-size:13px;">${t('assistantPreviewFailed')}</span>`;

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
                sectionTitle.textContent = t('assistantHistoryTitle', { count: images.length });
                sectionHeader.appendChild(sectionTitle);

                // "View all" button if model is available
if (model) {
                    const viewAllBtn = document.createElement('button');
                    viewAllBtn.textContent = t('assistantViewAll');
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
                        card.title = t('assistantRestoreWorkflow');
                        card.onclick = () => {
                            try {
                                const wf = typeof img.workflow === 'string' ? JSON.parse(img.workflow) : img.workflow;
                                if (app && app.loadGraphData) app.loadGraphData(wf);
                            } catch (e) { }
                        };
} else if (model) {
                        card.title = t('assistantViewGallery');
                        card.onclick = () => this.showGeneratedGallery(model);
                    }
                    grid.appendChild(card);
                });
                section.appendChild(grid);
                container.appendChild(section);
            }).catch(() => { });
    }

export function _openGalleryReplacer(node, w, options = {}) {
        const mode = options.mode === 'insert' ? 'insert' : 'replace';
        const pickerType = inferPickerModelType(node, w, options);
        const validPaths = getNativeWidgetValues(node, w);
        if (!validPaths.length) {
            alert(t('pickerNoCompatible'));
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
        const contextRequests = pickerType.isLora
            ? collectMainModelContextRequests(app.graph, options.anchorNode || node)
            : [];
        let selectedPath = currentPath;
        let selectedFolder = '';
        let previews = {};
        let modelInfo = {};
        let contextModels = {};
        let selectedBaseFamily = '';
        let renderGeneration = 0;
        let applying = false;

        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:radial-gradient(circle at 15% 0%,rgba(53,73,118,0.34),transparent 35%),rgba(7,8,12,0.965);z-index:999999;display:flex;flex-direction:column;padding:22px 24px;box-sizing:border-box;color:#fff;font-family:Inter,Arial,sans-serif;';
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
        header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-shrink:0;';
        const headerIcon = document.createElement('span');
        headerIcon.textContent = mode === 'insert' ? '＋' : '⇄';
        headerIcon.style.cssText = 'width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:linear-gradient(135deg,#4776e6,#8e54e9);font-size:21px;font-weight:800;box-shadow:0 8px 22px rgba(78,91,220,0.35);';
        const headerCopy = document.createElement('div');
        headerCopy.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
        const eyebrow = document.createElement('div');
        eyebrow.textContent = t('pickerEyebrow');
        eyebrow.style.cssText = 'font-size:10px;color:#8fa8da;letter-spacing:0.12em;text-transform:uppercase;font-weight:750;';
        const title = document.createElement('h2');
        title.style.cssText = 'margin:0;font-size:19px;line-height:1.15;';
        title.textContent = mode === 'insert'
            ? (options.direction === 'before' ? t('pickerInsertBeforeTitle') : t('pickerInsertAfterTitle'))
            : t('pickerChangeTitle');
        const typeBadge = document.createElement('span');
        typeBadge.textContent = pickerType.label;
        typeBadge.style.cssText = 'padding:5px 10px;border-radius:20px;background:rgba(138,180,248,0.1);border:1px solid rgba(138,180,248,0.25);color:#a9c7ff;font-size:10px;font-weight:750;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'margin-left:auto;width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);color:#aaa;font-size:20px;cursor:pointer;';
        closeBtn.onclick = closeModal;
        headerCopy.append(eyebrow, title);
        header.append(headerIcon, headerCopy, typeBadge, closeBtn);
        modal.appendChild(header);

        const compatibilityHint = document.createElement('div');
        compatibilityHint.style.cssText = 'display:none;align-items:center;gap:8px;margin:0 0 12px;padding:9px 12px;border-radius:10px;background:rgba(0,200,160,0.075);border:1px solid rgba(0,220,180,0.13);color:#8edfd0;font-size:11px;flex-shrink:0;';
        modal.appendChild(compatibilityHint);

        const body = document.createElement('div');
        body.style.cssText = 'display:grid;grid-template-columns:minmax(190px,250px) minmax(0,1fr);gap:14px;min-height:0;flex:1;';
        const folderPanel = document.createElement('aside');
        folderPanel.style.cssText = 'background:rgba(20,22,29,0.92);border:1px solid rgba(255,255,255,0.075);border-radius:13px;overflow:auto;padding:10px;box-shadow:0 14px 35px rgba(0,0,0,0.18);';
        const folderTitle = document.createElement('div');
        folderTitle.textContent = t('pickerFolders');
        folderTitle.style.cssText = 'font-size:13px;font-weight:700;color:#ddd;padding:8px 10px 10px;';
        const folderList = document.createElement('div');
        folderList.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
        folderPanel.append(folderTitle, folderList);

        const content = document.createElement('section');
        content.style.cssText = 'display:flex;flex-direction:column;min-width:0;min-height:0;background:rgba(18,20,27,0.92);border:1px solid rgba(255,255,255,0.075);border-radius:13px;overflow:hidden;box-shadow:0 14px 35px rgba(0,0,0,0.18);';
        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'display:flex;gap:10px;padding:12px;border-bottom:1px solid #333;flex-wrap:wrap;align-items:center;';
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = t('pickerSearch');
        searchInput.style.cssText = 'flex:1;min-width:220px;padding:10px 12px;border-radius:9px;border:1px solid rgba(255,255,255,0.1);background:#222631;color:#fff;font-size:13px;outline:none;';
        const baseFilterSelect = document.createElement('select');
        baseFilterSelect.style.cssText = `display:${pickerType.isLora ? 'block' : 'none'};padding:10px 12px;border-radius:9px;border:1px solid rgba(0,220,180,0.2);background:#1d292b;color:#9be8d9;font-size:12px;max-width:230px;`;
        const allBaseOption = document.createElement('option');
        allBaseOption.value = '';
        allBaseOption.textContent = t('pickerMainAll');
        baseFilterSelect.appendChild(allBaseOption);
        const sortSelect = document.createElement('select');
        sortSelect.style.cssText = 'padding:10px 12px;border-radius:9px;border:1px solid rgba(255,255,255,0.1);background:#222631;color:#fff;font-size:12px;';
        [
            ['name-asc', t('pickerNameAsc')],
            ['name-desc', t('pickerNameDesc')],
            ['folder-asc', t('pickerByFolder')],
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            sortSelect.appendChild(option);
        });
        const resultCount = document.createElement('span');
        resultCount.style.cssText = 'color:#888;font-size:12px;white-space:nowrap;';
        toolbar.append(searchInput, baseFilterSelect, sortSelect, resultCount);
        content.appendChild(toolbar);

        const loadingText = document.createElement('div');
        loadingText.textContent = t('pickerLoadingCovers');
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
        cancelBtn.textContent = t('pickerCancel');
        cancelBtn.style.cssText = 'padding:10px 18px;background:#333;color:#ddd;border:1px solid #555;border-radius:7px;cursor:pointer;';
        cancelBtn.onclick = closeModal;
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = mode === 'insert'
            ? t('pickerInsertConfirm')
            : t('pickerReplaceConfirm');
        confirmBtn.style.cssText = 'padding:10px 20px;background:#1976d2;color:#fff;border:none;border-radius:7px;cursor:pointer;font-weight:700;';
        footer.append(selectionText, cancelBtn, confirmBtn);
        modal.appendChild(footer);
        document.body.appendChild(modal);

        let folderCounts = new Map();
        const pathMatchesBaseFilter = path => {
            if (!selectedBaseFamily) return true;
            const baseModel = modelInfo[path]?.metadata?.baseModel;
            return getBaseModelFamily(baseModel) === selectedBaseFamily;
        };
        const rebuildFolderCounts = () => {
            const visibleByBase = validPaths.filter(pathMatchesBaseFilter);
            folderCounts = new Map([['', visibleByBase.length]]);
            visibleByBase.forEach(path => {
                const parts = getFolder(path).split('/').filter(Boolean);
                let accumulated = '';
                parts.forEach(part => {
                    accumulated = accumulated ? `${accumulated}/${part}` : part;
                    folderCounts.set(accumulated, (folderCounts.get(accumulated) || 0) + 1);
                });
            });
        };
        rebuildFolderCounts();

        const updateSelection = () => {
            selectionText.textContent = selectedPath
                ? t('pickerSelected', { path: normalizePath(selectedPath) })
                : t('pickerChooseModel');
            confirmBtn.disabled = !selectedPath || applying;
            confirmBtn.style.opacity = confirmBtn.disabled ? '0.45' : '1';
            confirmBtn.style.cursor = confirmBtn.disabled ? 'not-allowed' : 'pointer';
        };

        let renderCards = () => {};
        const configureBaseFilter = () => {
            if (!pickerType.isLora) return;
            const groups = new Map();
            validPaths.forEach(path => {
                const baseModel = modelInfo[path]?.metadata?.baseModel;
                const family = getBaseModelFamily(baseModel);
                if (!family) return;
                const existing = groups.get(family) || { label: baseModel, count: 0 };
                existing.count += 1;
                if (String(baseModel).length < String(existing.label).length) existing.label = baseModel;
                groups.set(family, existing);
            });

            baseFilterSelect.replaceChildren(allBaseOption);
            [...groups.entries()]
                .sort((a, b) => String(a[1].label).localeCompare(String(b[1].label), undefined, { numeric: true }))
                .forEach(([family, group]) => {
                    const option = document.createElement('option');
                    option.value = family;
                    option.textContent = `${group.label} (${group.count})`;
                    baseFilterSelect.appendChild(option);
                });

            const mainBaseModel = Object.values(contextModels)
                .map(item => item?.metadata?.baseModel)
                .find(Boolean) || '';
            const currentBaseModel = currentPath ? modelInfo[currentPath]?.metadata?.baseModel || '' : '';
            const preferredBaseModel = mainBaseModel || currentBaseModel;
            const preferredFamily = getBaseModelFamily(preferredBaseModel);
            selectedBaseFamily = preferredFamily && groups.has(preferredFamily) ? preferredFamily : '';
            baseFilterSelect.value = selectedBaseFamily;
            if (selectedBaseFamily && selectedPath && !pathMatchesBaseFilter(selectedPath)) selectedPath = null;
            rebuildFolderCounts();

            compatibilityHint.style.display = 'flex';
            if (mainBaseModel && selectedBaseFamily) {
                compatibilityHint.textContent = t('pickerCompatibleMain', { name: mainBaseModel });
            } else if (preferredBaseModel && selectedBaseFamily) {
                compatibilityHint.textContent = t('pickerCompatibleTag', { name: preferredBaseModel });
            } else if (mainBaseModel) {
                compatibilityHint.textContent = t('pickerCompatibleNoTags', { name: mainBaseModel });
            } else {
                compatibilityHint.textContent = t('pickerCompatibleUnknown');
            }
        };

        const renderFolders = () => {
            folderList.replaceChildren();
            const folders = ['', ...[...folderCounts.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))];
            folders.forEach(folderPath => {
                const button = document.createElement('button');
                const depth = folderPath ? folderPath.split('/').length - 1 : 0;
            const label = folderPath ? folderPath.split('/').pop() : t('pickerAllModels');
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
                return pathMatchesBaseFilter(path) && inFolder && (!term || normalized.toLowerCase().includes(term));
            });
            if (sortSelect.value === 'name-desc') paths.sort((a, b) => collator.compare(getName(b), getName(a)));
            else if (sortSelect.value === 'folder-asc') paths.sort((a, b) => collator.compare(normalizePath(a), normalizePath(b)));
            else paths.sort((a, b) => collator.compare(getName(a), getName(b)));

            resultCount.textContent = t('pickerResults', { count: paths.length });
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
                    const info = modelInfo[path] || {};
                    const baseModel = info.metadata?.baseModel || '';
                    const card = document.createElement('div');
                    card.tabIndex = 0;
                    card.setAttribute('role', 'button');
                    card.style.cssText = `position:relative;background:linear-gradient(160deg,#252935,#1b1d24);border-radius:11px;overflow:hidden;cursor:pointer;display:flex;flex-direction:column;border:1px solid ${isSelected ? '#6ea8ff' : isCurrent ? '#e9b949' : 'rgba(255,255,255,0.09)'};box-shadow:${isSelected ? '0 0 0 2px rgba(88,151,255,0.22),0 14px 28px rgba(0,0,0,0.28)' : '0 8px 20px rgba(0,0,0,0.16)'};transition:transform 0.12s,box-shadow 0.12s;min-width:0;`;
                    const previewBox = document.createElement('div');
                    previewBox.style.cssText = 'height:150px;background:radial-gradient(circle at 50% 15%,#2b3041,#0d0e13 72%);display:flex;align-items:center;justify-content:center;font-size:30px;position:relative;overflow:hidden;';
                    const previewUrl = info.preview_url || previews[path];
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
                        badge.textContent = t('pickerCurrent');
                        badge.style.cssText = 'position:absolute;top:6px;left:6px;background:rgba(255,193,7,0.92);color:#111;padding:3px 6px;border-radius:4px;font-size:10px;font-weight:800;';
                        previewBox.appendChild(badge);
                    }
                    const badgeStack = document.createElement('div');
                    badgeStack.style.cssText = 'position:absolute;top:6px;right:6px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;max-width:76%;';
                    const categoryBadge = document.createElement('span');
                    categoryBadge.textContent = formatModelTypeLabel(info.type, pickerType.label);
                    categoryBadge.style.cssText = 'padding:3px 6px;border-radius:5px;background:rgba(25,34,54,0.9);border:1px solid rgba(138,180,248,0.28);color:#b8d0ff;font-size:9px;font-weight:800;box-shadow:0 3px 8px rgba(0,0,0,0.22);';
                    badgeStack.appendChild(categoryBadge);
                    if (baseModel) {
                        const baseBadge = document.createElement('span');
                        baseBadge.textContent = baseModel;
                        baseBadge.title = `${t('pickerBaseModel')}: ${baseModel}`;
                        baseBadge.style.cssText = 'max-width:100%;padding:3px 6px;border-radius:5px;background:rgba(7,50,43,0.9);border:1px solid rgba(70,220,185,0.25);color:#8ce1cf;font-size:9px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 3px 8px rgba(0,0,0,0.22);';
                        badgeStack.appendChild(baseBadge);
                    }
                    previewBox.appendChild(badgeStack);
                    const name = document.createElement('div');
                    name.textContent = getName(path);
                    name.title = normalizePath(path);
                    name.style.cssText = 'padding:9px 9px 3px;font-size:12px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700;';
                    const folder = document.createElement('div');
                    folder.textContent = getFolder(path) || t('pickerRoot');
                    folder.title = getFolder(path);
                    folder.style.cssText = 'padding:0 9px 9px;font-size:9px;color:#747b8b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
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
                empty.textContent = t('pickerNoMatches');
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
            alert(t('pickerOperationFailed') + error.message);
            }
        };

        searchInput.oninput = renderCards;
        baseFilterSelect.onchange = () => {
            selectedBaseFamily = baseFilterSelect.value;
            selectedFolder = '';
            if (selectedPath && !pathMatchesBaseFilter(selectedPath)) selectedPath = null;
            rebuildFolderCounts();
            renderFolders();
            updateSelection();
            renderCards();
        };
        sortSelect.onchange = renderCards;
        modal.onkeydown = event => { if (event.key === 'Escape') closeModal(); };
        renderFolders();
        updateSelection();
        renderCards();
        setTimeout(() => searchInput.focus(), 0);

        const requestPayload = {
            paths: validPaths,
            context_requests: contextRequests,
        };
        if (pickerType.folderTypes.length) requestPayload.folder_types = pickerType.folderTypes;
        fetch('/anomalous/resolve_paths_to_previews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload),
        }).then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        }).then(data => {
            if (!modal.isConnected) return;
            previews = data.previews || {};
            modelInfo = data.models || {};
            contextModels = data.context_models || {};
            loadingText.style.display = 'none';
            configureBaseFilter();
            renderFolders();
            updateSelection();
            renderCards();
        }).catch(error => {
            if (!modal.isConnected) return;
            console.error('[Anomalous] Failed to load model previews:', error);
            loadingText.textContent = t('pickerCoversFailed');
            configureBaseFilter();
            renderFolders();
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
                            nodeTitle.textContent = `${t('doctorNodeLabel')}: ${node.title || node.type}`;
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
            const healthyMessage = document.createElement('div');
            healthyMessage.style.color = '#28a745';
            healthyMessage.style.textAlign = 'center';
            healthyMessage.style.padding = '20px';
            healthyMessage.style.fontSize = '16px';
            healthyMessage.textContent = t('doctorAllHealthy');
            content.appendChild(healthyMessage);
        }
    }

function cloneAssistantValue(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return value; }
}

function isVolatileAssistantWidget(node, widget, index) {
    const name = String(widget?.name || '').toLowerCase();
    if (/(^|[_\s-])(seed|noise_seed|random_seed|variation_seed|last_seed)([_\s-]|$)/i.test(name)) return true;
    const type = String(node?.type || '').toLowerCase();
    if (type === 'ksampler') return index === 0;
    if (type === 'ksampleradvanced') return index === 1;
    return false;
}

export function applyLocalNodeParameters(targetNode, sourceWidgetValues) {
    if (!targetNode || !Array.isArray(targetNode.widgets) || !Array.isArray(sourceWidgetValues)) {
        throw new Error('assistant_parameter_target_unavailable');
    }
    if (sourceWidgetValues.length > targetNode.widgets.length) {
        throw new Error('assistant_parameter_widget_mismatch');
    }
    if (!app.graph) throw new Error('assistant_parameter_graph_unavailable');
    const previousValues = [];
    
    // Save previous values in case of error
    for (let i = 0; i < targetNode.widgets.length; i++) {
        previousValues.push(cloneAssistantValue(targetNode.widgets[i].value));
    }
    
    try {
        app.graph.beforeChange?.();
        for (let i = 0; i < sourceWidgetValues.length; i++) {
            if (!targetNode.widgets[i]) continue;
            
            if (isVolatileAssistantWidget(targetNode, targetNode.widgets[i], i)) continue;
            const val = cloneAssistantValue(sourceWidgetValues[i]);
            const prevVal = previousValues[i];
            
            targetNode.widgets[i].value = val;
            if (Array.isArray(targetNode.widgets_values)) {
                targetNode.widgets_values[i] = val;
            }
            
            if (typeof targetNode.widgets[i].callback === 'function') {
                targetNode.widgets[i].callback.call(targetNode.widgets[i], val, app.canvas, targetNode);
            }
            if (typeof targetNode.onWidgetChanged === 'function') {
                targetNode.onWidgetChanged(i, val, prevVal, targetNode.widgets[i]);
            }
        }
        app.graph.change?.();
        app.graph.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        try { window.dispatchEvent(new CustomEvent('graphChanged')); } catch (error) {}
        return { widgets: sourceWidgetValues.length };
    } catch (e) {
        console.error("Error applying local node parameters:", e);
        // Rollback
        for (let i = 0; i < previousValues.length; i++) {
            if (targetNode.widgets[i]) targetNode.widgets[i].value = cloneAssistantValue(previousValues[i]);
            if (Array.isArray(targetNode.widgets_values)) targetNode.widgets_values[i] = cloneAssistantValue(previousValues[i]);
        }
        throw e;
    } finally {
        app.graph.afterChange?.();
    }
}

export function renderParameterPresets(node, container, forceRefresh = false) {
    if (!node || !node.type) return;

    const betaNotice = document.createElement('div');
    betaNotice.className = 'anomalous-beta-notice anomalous-assistant-beta-notice';
    const betaBadge = document.createElement('strong');
    betaBadge.className = 'anomalous-beta-badge';
    betaBadge.dataset.anomalousI18nKey = 'betaFeature';
    betaBadge.textContent = t('betaFeature');
    const betaText = document.createElement('span');
    betaText.dataset.anomalousI18nKey = 'assistantBetaNotice';
    betaText.textContent = t('assistantBetaNotice');
    betaNotice.append(betaBadge, betaText);
    container.appendChild(betaNotice);

    const presetSection = document.createElement('div');
    presetSection.className = 'anomalous-assistant-parameter-presets';
    presetSection.style.cssText = 'margin:14px 16px; display:flex; flex-direction:column; gap:8px;';
    
    const header = document.createElement('div');
    header.style.cssText = 'color:#8b91a3;font-size:10px;font-weight:750;letter-spacing:0.1em;text-transform:uppercase;';
    header.textContent = t('recipeParameterNotebooks') || 'Parameter Notebooks';
    presetSection.appendChild(header);

    const loader = document.createElement('div');
    loader.style.cssText = 'font-size:12px; color:#555; text-align:center; padding:10px;';
    loader.textContent = t('loading') || 'Loading...';
    presetSection.appendChild(loader);

    container.appendChild(presetSection);

    // Debounce fetching
    if (this._presetFetchTimer) clearTimeout(this._presetFetchTimer);
    this._presetFetchTimer = setTimeout(async () => {
        try {
            const fetchUrl = `/anomalous/parameters/by_node_type?type=${encodeURIComponent(node.type)}${forceRefresh ? '&refresh=1' : ''}`;
            const res = await fetch(fetchUrl);
            if (!res.ok) throw new Error('Network error');
            const data = await res.json();
            
            loader.style.display = 'none';
            
            if (!Array.isArray(data.groups) || data.groups.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'font-size:11px; color:#666; text-align:center; padding:10px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px dashed rgba(255,255,255,0.1);';
                empty.textContent = t('assistantNoPresets') || 'No presets found for this node type.';
                presetSection.appendChild(empty);
                return;
            }

            const flatContainer = document.createElement('div');
            flatContainer.style.cssText = 'display:flex; flex-direction:column; gap:6px; margin-top:8px;';
            let presetCount = 0;

            let renderedGroups = 0;
            for (const group of data.groups) {
                const displayName = String(group.recipe_name || group.recipe_filename || t('recipeUntitled'));
                // Hide unbound and deleted recipes as per user request
                if (group.recipe_filename === 'unbound' || displayName.endsWith('.json')) {
                    continue;
                }
                
                const recipeBox = document.createElement('div');
                recipeBox.style.cssText = 'background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:10px; overflow:hidden;';
                
                const recipeHeader = document.createElement('div');
                recipeHeader.style.cssText = 'padding:10px 12px; font-size:12px; font-weight:bold; color:#c9d6ff; cursor:pointer; display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.2);';
                recipeHeader.innerHTML = `<span style="font-size:14px;">🍱</span> <span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(displayName)}</span> <span>▼</span>`;
                
                const notebookList = document.createElement('div');
                notebookList.style.cssText = 'display:flex; flex-direction:column; gap:6px; padding:8px;';
                
                let hasNodes = false;
                
                for (const nb of (Array.isArray(group.notebooks) ? group.notebooks : [])) {
                    for (const n of (Array.isArray(nb?.nodes) ? nb.nodes : [])) {
                        hasNodes = true;
                        presetCount++;
                        const applyBtn = document.createElement('button');
                        applyBtn.style.cssText = 'background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:6px; padding:8px 12px; font-size:12px; cursor:pointer; text-align:left; transition:background 0.2s; display:flex; align-items:center; gap:8px;';
                        
                        let summary = nb.name || t('recipeParameterUntitled') || 'Untitled';
                        if (nb.nodes.length > 1) {
                            let valStr = '';
                            if (n.widgets_values && n.widgets_values.length > 0) {
                                const val = String(n.widgets_values[0]);
                                valStr = ` (${val.length > 15 ? val.substring(0,15)+'...' : val})`;
                            }
                            summary += ` - ${n.title}${valStr}`;
                        }
                        
                        const promptRoleTag = {
                            positive: `[🟢 ${t('recipePromptRolePositive')}] `,
                            negative: `[🔴 ${t('recipePromptRoleNegative')}] `,
                            both: `[🟣 ${t('recipePromptRoleBoth')}] `,
                            ignored: `[⚪ ${t('recipePromptRoleIgnored')}] `,
                            unknown: `[⚪ ${t('recipePromptRoleUnknown')}] `,
                        }[n.role];
                        const roleTag = promptRoleTag
                            || (/cliptextencode/i.test(n.type || '') ? `[⚪ ${t('recipePromptRoleUnknown')}] ` : '');
                        
                        const displayHtml = `<span style="font-size:14px;">✨</span> <span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${roleTag}${escapeHtml(summary)}</span>`;
                        applyBtn.innerHTML = displayHtml;
                        applyBtn.onmouseover = () => { applyBtn.style.background = 'rgba(25,118,210,0.4)'; };
                        applyBtn.onmouseout = () => { applyBtn.style.background = 'rgba(255,255,255,0.05)'; };
                        applyBtn.onclick = () => {
                            applyBtn.disabled = true;
                            applyBtn.innerHTML = `⏳...`;
                            try {
                                applyLocalNodeParameters(node, n.widgets_values);
                                applyBtn.innerHTML = `✅ ${t('recipeParameterApplied').replace('{count}', '')}`.trim();
                                applyBtn.style.background = 'rgba(46,139,87,0.6)';
                            } catch (error) {
                                console.error('[Anomalous] Failed to apply assistant parameters:', error);
                                applyBtn.innerHTML = `⚠️ ${t('recipeParameterApplyError') || 'Apply failed'}`;
                                applyBtn.style.background = 'rgba(180,60,60,0.55)';
                            }
                            setTimeout(() => {
                                applyBtn.disabled = false;
                                applyBtn.innerHTML = displayHtml;
                                applyBtn.style.background = 'rgba(255,255,255,0.05)';
                            }, 1500);
                        };
                        notebookList.appendChild(applyBtn);
                    }
                }
                
                if (hasNodes) {
                    recipeBox.appendChild(recipeHeader);
                    recipeBox.appendChild(notebookList);
                    flatContainer.appendChild(recipeBox);
                    
                    if (renderedGroups > 0) {
                        notebookList.style.display = 'none';
                        recipeHeader.querySelector('span:last-child').textContent = '▶';
                    }
                    renderedGroups++;
                    
                    recipeHeader.onclick = () => {
                        if (notebookList.style.display === 'none') {
                            notebookList.style.display = 'flex';
                            recipeHeader.querySelector('span:last-child').textContent = '▼';
                        } else {
                            notebookList.style.display = 'none';
                            recipeHeader.querySelector('span:last-child').textContent = '▶';
                        }
                    };
                }
            }

            if (presetCount === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'color:#aaa; font-style:italic; font-size:12px; padding:10px; text-align:center;';
                empty.textContent = t('assistantNoPresets') || 'No presets found for this node type.';
                presetSection.appendChild(empty);
            } else {
                presetSection.appendChild(flatContainer);
            }
        } catch (e) {
            console.error("Failed to load parameter presets", e);
            loader.textContent = 'Error loading presets.';
            loader.style.color = '#ff5252';
        }
    }, 300);
}
