import { applyNodeMaterialValues } from './node_material_actions.js';
import { applyMaterialToSelectedNode } from './ui_material_application.js';
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
import { requiresHashForModelRecovery } from './model_policies.js';
import { findModelComboWidget, getNativeWidgetValues } from './ui_node_model_picker.js';
import { renderParameterPresets } from './ui_node_presets.js';
/**
 * ui_doctor.js
 * Extracted Doctor Panel & Assistant Panel methods.
 */

const t = (key, params) => translate(key, params);

function workflowHashRecord(nodeId, value) {
    const hashes = app.graph?.extra?.anomalous_hashes;
    if (!hashes || typeof value !== 'string') return null;
    const normalized = value.replace(/\\/g, '/');
    const windowsPath = value.replace(/\//g, '\\');
    return hashes[`${nodeId}_${value}`]
        || hashes[`${nodeId}_${normalized}`]
        || hashes[`${nodeId}_${windowsPath}`]
        || hashes[value]
        || hashes[normalized]
        || hashes[windowsPath]
        || null;
}

function localHashRecord(value) {
    if (!window.anomalous_hash_cache || typeof value !== 'string') return null;
    const normalized = value.replace(/\\/g, '/');
    const basename = normalized.split('/').pop();
    return window.anomalous_hash_cache[value]
        || window.anomalous_hash_cache[normalized]
        || window.anomalous_hash_cache[basename]
        || null;
}

function hashFromRecord(record) {
    const value = typeof record === 'string' ? record : record?.hash;
    return String(value || '').trim().toUpperCase();
}

function hasFoundationIdentityMismatch(node, widget, value) {
    if (!requiresHashForModelRecovery(node, widget)) return false;
    const workflowHash = hashFromRecord(workflowHashRecord(node.id, value));
    const localHash = hashFromRecord(localHashRecord(value));
    return Boolean(workflowHash && localHash && workflowHash !== localHash);
}

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
                ? `<span style="font-size:16px;">🛎️</span><span style="font-size:12px;color:#f59e0b;font-weight:600;">${t('doctorAutoScanOn')}</span>`
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
        refreshBtn.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#e5e7eb;font-size:12px;cursor:pointer;padding:6px 12px;border-radius:6px;transition:all 0.2s; font-weight:600;';
        refreshBtn.title = t('doctorRefreshTitle');
        refreshBtn.onmouseover = () => { refreshBtn.style.background = 'rgba(255,255,255,0.12)'; };
        refreshBtn.onmouseout = () => { refreshBtn.style.background = 'rgba(255,255,255,0.06)'; };
        refreshBtn.onclick = async () => {
            refreshBtn.disabled = true;
            refreshBtn.style.opacity = '0.5';
            if (app.refreshComboInNodes) await app.refreshComboInNodes();
            if (window.anomalous_reload_hashes) await window.anomalous_reload_hashes();
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
        titleBar.style.cssText = 'margin:14px 16px 0;padding:16px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:rgba(255,255,255,0.04);display:flex;align-items:center;gap:12px;flex-shrink:0;box-shadow:0 8px 24px rgba(0,0,0,0.25);';
        titleBar.innerHTML = `<span style="width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);">🤖</span><span style="display:flex;flex-direction:column;min-width:0;gap:3px;"><span style="font-size:10px;letter-spacing:0.11em;text-transform:uppercase;color:#9ca3af;">${t('assistantSelectedNode')}</span><span class="ast-title" style="font-weight:700;color:#f3f4f6;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></span></span><span class="ast-type" style="font-size:10px;color:#d1d5db;margin-left:auto;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);max-width:38%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></span>`;
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
        actionsContainer.style.cssText = 'display:flex; flex-direction:column; flex:1; overflow-y:auto; min-height:0;';

        const presetsContainer = document.createElement('div');
        presetsContainer.style.cssText = 'display:none; flex-direction:column; flex:1; overflow-y:auto; min-height:0;';

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

        let total = 0, healthy = 0, missing = 0, identityWarnings = 0;
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
                    const identityMismatch = isHealthy && hasFoundationIdentityMismatch(node, w, val);
                    if (identityMismatch) identityWarnings++;
                    if (isHealthy) healthy++; else missing++;
                    
                    missingNodesData.push({
                        node,
                        w,
                        val,
                        isHealthy,
                        exactMatch,
                        identityMismatch,
                        resolutionStatus: w.anomalous_resolution_status || '',
                        sizeCandidate: w.anomalous_size_candidate || null,
                    });
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
            ${identityWarnings ? createBadge(t('doctorIdentityWarning'), identityWarnings, '#ffc107', 'rgba(255, 193, 7, 0.1)') : ''}
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
            const {
                node,
                w,
                val,
                isHealthy,
                exactMatch,
                identityMismatch,
                resolutionStatus,
                sizeCandidate,
            } = data;
            const hasIdentityConflict = resolutionStatus === 'identity_conflict';
            const hasSizeCandidate = resolutionStatus === 'size_candidate' && sizeCandidate?.filename;
            
            const item = document.createElement('div');
            item.style.cssText = `display:flex; flex-direction:column; padding:16px 20px; background:rgba(255,255,255,0.02); border-radius:12px; border:1px solid rgba(255,255,255,0.04); transition:all 0.2s; position:relative; overflow:hidden; flex-shrink:0;`;
            item.onmouseover = () => item.style.background = 'rgba(255,255,255,0.04)';
            item.onmouseout = () => item.style.background = 'rgba(255,255,255,0.02)';
            
            // Accent bar
            const accent = document.createElement('div');
            const accentColor = hasSizeCandidate
                ? '#ffc107'
                : (hasIdentityConflict || !isHealthy ? '#ff6b6b' : (identityMismatch ? '#ffc107' : '#28a745'));
            accent.style.cssText = `position:absolute; left:0; top:0; bottom:0; width:4px; background:${accentColor};`;
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
            
            if (hasIdentityConflict) {
                right.innerHTML = `<div style="color:#ff6b6b;font-size:13px;font-weight:bold;padding:6px 12px;background:rgba(220,53,69,0.1);border-radius:20px;">⛔ ${t('doctorIdentityConflict')}</div>`;
            } else if (hasSizeCandidate) {
                right.innerHTML = `<div style="text-align:right;"><div style="color:#ffc107;font-size:13px;font-weight:bold;">🟡 ${t('doctorSizeCandidate')}</div><div style="color:rgba(255,255,255,0.4);font-size:11px;margin-top:4px;">${escapeHtml(sizeCandidate.filename.split(/[\\/]/).pop())}</div></div>`;
            } else if (identityMismatch) {
                right.innerHTML = `<div style="color:#ffc107;font-size:13px;font-weight:bold;padding:6px 12px;background:rgba(255,193,7,0.1);border-radius:20px;">🟡 ${t('doctorIdentityChanged')}</div>`;
            } else if (isHealthy && exactMatch && exactMatch !== val) {
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
                deepScanBtn.style.cssText = 'padding:8px 16px; background:#e5e7eb; color:#111827; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px; transition:background 0.2s;';
                deepScanBtn.onmouseover = () => deepScanBtn.style.background = '#ffffff';
                deepScanBtn.onmouseout = () => deepScanBtn.style.background = '#e5e7eb';
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
        <div style="font-size:11px;color:#e5e7eb;font-weight:600;">#${escapeHtml(String(node.id))} · ${escapeHtml(node.title || node.type || 'Node')} · ${escapeHtml(widget?.name || '')}</div>
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
            hashText.style.cssText = 'font-size:11px;color:#f59e0b;word-break:break-all;flex:1;font-family:Consolas,monospace;letter-spacing:0.5px;';
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

    modal.appendChild(renderHashCard(t('doctorWorkflowHash'), workflowHash, workflowSize, '#e5e7eb', true));
    modal.appendChild(renderHashCard(t('doctorLocalHash'), localHash, localSize, '#81c995', false));

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;margin-top:4px;';
    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.cssText = 'padding:8px 24px;background:#e5e7eb;color:#111827;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;';
    okBtn.onclick = () => overlay.remove();
    footer.appendChild(okBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
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
                            nodeTitle.style.color = '#e5e7eb';
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
