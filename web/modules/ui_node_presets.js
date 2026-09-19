/** Node parameter scheme cards, previews, and application. */

import { app } from "../../../scripts/app.js";
import { translate } from "./locales.js";
import { escapeHtml } from "./safe_dom.js";
import { applyNodeMaterialValues } from "./node_material_actions.js";
import { applyMaterialToSelectedNode } from "./ui_material_application.js";

const t = (key, params) => translate(key, params);

export function applyLocalNodeParameters(targetNode, sourceWidgetValues) {
    if (!Array.isArray(sourceWidgetValues)) throw new Error('materialNoCompatibleValues');
    return applyNodeMaterialValues(app, targetNode, sourceWidgetValues.map((value, index) => ({ index, value })));
}


let activePopoverTimer = null;
let activeHideTimer = null;
let currentPopoverEl = null;

function extractNodeParamSummary(node, widgetValues) {
    if (!Array.isArray(widgetValues)) return { isText: false, textPreview: '', fullText: '', pills: [], details: [] };

    const widgetNames = (node?.widgets || []).map(w => w.name || '');

    const stringVal = widgetValues.find(v => typeof v === 'string' && v.trim().length > 15);
    const isText = Boolean(stringVal && (/cliptextencode|prompt/i.test(node?.type || '') || widgetValues.length === 1));

    if (isText && stringVal) {
        return {
            isText: true,
            textPreview: stringVal.length > 60 ? stringVal.slice(0, 60) + '...' : stringVal,
            fullText: stringVal,
            pills: [],
            details: widgetValues.map((val, i) => ({
                name: widgetNames[i] || `Widget #${i}`,
                value: String(val)
            }))
        };
    }

    const pills = [];
    const details = [];

    widgetValues.forEach((val, i) => {
        const name = (widgetNames[i] || `param_${i}`).toLowerCase();
        const strVal = String(val);
        details.push({ name: widgetNames[i] || `Param #${i}`, value: strVal });

        if (pills.length < 5) {
            if (name.includes('step')) {
                pills.push({ label: `${strVal} steps`, type: 'steps' });
            } else if (name.includes('cfg')) {
                pills.push({ label: `CFG ${strVal}`, type: 'cfg' });
            } else if (name.includes('sampler')) {
                pills.push({ label: strVal, type: 'sampler' });
            } else if (name.includes('scheduler')) {
                pills.push({ label: strVal, type: 'scheduler' });
            } else if (name.includes('denoise')) {
                pills.push({ label: `denoise ${strVal}`, type: 'denoise' });
            } else if (name.includes('width') || name.includes('height')) {
                pills.push({ label: `${strVal}px`, type: 'size' });
            } else if (typeof val === 'number') {
                pills.push({ label: `${widgetNames[i] || 'val'}: ${strVal}`, type: 'num' });
            } else if (typeof val === 'string' && val.length > 0 && val.length <= 20 && !val.includes('/')) {
                pills.push({ label: strVal, type: 'str' });
            }
        }
    });

    if (pills.length === 0) {
        details.slice(0, 3).forEach(d => {
            const shortVal = d.value.length > 15 ? d.value.slice(0, 15) + '...' : d.value;
            pills.push({ label: `${d.name}: ${shortVal}`, type: 'generic' });
        });
    }

    return { isText: false, textPreview: '', fullText: '', pills, details };
}

function showParamPopover(anchorEl, { node, sourceTitle, schemeTitle, promptRoleTag, summary, onApply }) {
    clearTimeout(activeHideTimer);
    clearTimeout(activePopoverTimer);

    activePopoverTimer = setTimeout(() => {
        if (!anchorEl.isConnected) return;
        if (!currentPopoverEl) {
            currentPopoverEl = document.createElement('div');
            currentPopoverEl.className = 'anomalous-param-popover';
            document.body.appendChild(currentPopoverEl);

            currentPopoverEl.addEventListener('mouseenter', () => {
                clearTimeout(activeHideTimer);
            });
            currentPopoverEl.addEventListener('mouseleave', () => {
                hideParamPopover(true);
            });
        }

        currentPopoverEl.innerHTML = '';

        const popHeader = document.createElement('div');
        popHeader.style.cssText = 'display:flex;flex-direction:column;gap:4px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;margin-bottom:10px;';
        
        const srcTag = document.createElement('div');
        srcTag.style.cssText = 'font-size:10px;color:#9ca3af;display:flex;align-items:center;gap:4px;text-transform:uppercase;letter-spacing:0.5px;';
        srcTag.textContent = `${t('assistantSchemeSource') || '来源'}: ${sourceTitle}`;
        popHeader.appendChild(srcTag);

        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = 'font-size:14px;font-weight:700;color:#f3f4f6;display:flex;align-items:center;gap:6px;';
        titleDiv.innerHTML = `${promptRoleTag || ''}<span>${escapeHtml(schemeTitle)}</span>`;
        popHeader.appendChild(titleDiv);
        currentPopoverEl.appendChild(popHeader);

        if (summary.isText && summary.fullText) {
            const copyRow = document.createElement('div');
            copyRow.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:6px;';
            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.style.cssText = 'background:transparent;border:1px solid rgba(255,255,255,0.15);color:#cbd5e1;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer;';
            copyBtn.textContent = '📋 复制文本';
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(summary.fullText).then(() => {
                    copyBtn.textContent = '✅ 已复制';
                    setTimeout(() => copyBtn.textContent = '📋 复制文本', 1200);
                });
            };
            copyRow.appendChild(copyBtn);
            currentPopoverEl.appendChild(copyRow);

            const textBox = document.createElement('div');
            textBox.style.cssText = 'max-height:240px;overflow-y:auto;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px;font-size:11.5px;line-height:1.6;color:#e2e8f0;white-space:pre-wrap;word-break:break-word;font-family:monospace;';
            textBox.textContent = summary.fullText;
            currentPopoverEl.appendChild(textBox);
        } else if (summary.details.length > 0) {
            const tableWrap = document.createElement('div');
            tableWrap.style.cssText = 'max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;';

            for (const d of summary.details) {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;background:rgba(255,255,255,0.03);padding:6px 10px;border-radius:6px;font-size:11.5px;';
                
                const keySpan = document.createElement('span');
                keySpan.style.cssText = 'color:#94a3b8;font-family:monospace;font-size:11px;';
                keySpan.textContent = d.name;

                const valSpan = document.createElement('span');
                valSpan.style.cssText = 'color:#f1f5f9;font-weight:600;font-family:monospace;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                valSpan.textContent = d.value;
                valSpan.title = d.value;

                row.append(keySpan, valSpan);
                tableWrap.appendChild(row);
            }
            currentPopoverEl.appendChild(tableWrap);
        }

        const popFooter = document.createElement('div');
        popFooter.style.cssText = 'margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:flex-end;';
        
        const popApplyBtn = document.createElement('button');
        popApplyBtn.type = 'button';
        popApplyBtn.className = 'anomalous-scheme-apply-btn';
        popApplyBtn.style.cssText = 'width:100%;padding:8px 14px;font-size:12px;font-weight:700;border-radius:7px;background:rgba(25,118,210,0.9);color:#fff;border:1px solid rgba(255,255,255,0.2);cursor:pointer;';
        popApplyBtn.textContent = t('assistantApplyScheme') || '⚡ 应用方案到当前节点';
        popApplyBtn.onclick = () => onApply();
        popFooter.appendChild(popApplyBtn);
        currentPopoverEl.appendChild(popFooter);

        currentPopoverEl.style.display = 'flex';
        const anchorRect = anchorEl.getBoundingClientRect();
        const popWidth = 340;
        let left = anchorRect.left - popWidth - 14;
        if (left < 10) {
            left = anchorRect.right + 14;
        }
        if (left + popWidth > window.innerWidth - 10) {
            left = window.innerWidth - popWidth - 10;
        }

        let top = anchorRect.top - 8;
        if (top + 420 > window.innerHeight) {
            top = Math.max(16, window.innerHeight - 440);
        }

        currentPopoverEl.style.left = `${Math.max(10, left)}px`;
        currentPopoverEl.style.top = `${Math.max(10, top)}px`;
    }, 120);
}

function hideParamPopover(immediate = false) {
    clearTimeout(activePopoverTimer);
    if (immediate) {
        if (currentPopoverEl) currentPopoverEl.style.display = 'none';
    } else {
        activeHideTimer = setTimeout(() => {
            if (currentPopoverEl) currentPopoverEl.style.display = 'none';
        }, 150);
    }
}

function createSchemeCard({ node, sourceTitle, sourceBadge, schemeTitle, role, widgetValues, onApply }) {
    const summary = extractNodeParamSummary(node, widgetValues);

    const card = document.createElement('div');
    card.className = 'anomalous-assistant-scheme-card';
    card.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;transition:all 0.2s cubic-bezier(0.16, 1, 0.3, 1);position:relative;cursor:default;';

    card.onmouseover = () => {
        card.style.borderColor = 'rgba(255,255,255,0.2)';
        card.style.background = 'rgba(255,255,255,0.06)';
    };
    card.onmouseout = () => {
        card.style.borderColor = 'rgba(255,255,255,0.08)';
        card.style.background = 'rgba(255,255,255,0.04)';
    };

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;';

    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;flex:1;';

    const promptRoleTag = {
        positive: `[🟢 ${t('recipePromptRolePositive') || '正向'}] `,
        negative: `[🔴 ${t('recipePromptRoleNegative') || '负向'}] `,
        both: `[🟣 ${t('recipePromptRoleBoth') || '混合'}] `,
    }[role] || (/cliptextencode/i.test(node?.type || '') ? `[⚪ ${t('recipePromptRoleUnknown') || '提示词'}] ` : '');

    const titleEl = document.createElement('span');
    titleEl.style.cssText = 'font-weight:700;font-size:12px;color:#f3f4f6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    titleEl.innerHTML = `${promptRoleTag}${escapeHtml(schemeTitle)}`;
    titleWrap.appendChild(titleEl);

    const badgeEl = document.createElement('span');
    badgeEl.style.cssText = 'font-size:9px;color:#9ca3af;padding:2px 6px;border-radius:999px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);flex-shrink:0;max-width:35%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    badgeEl.textContent = sourceBadge || sourceTitle;
    badgeEl.title = sourceTitle;

    headerRow.append(titleWrap, badgeEl);
    card.appendChild(headerRow);

    const contentRow = document.createElement('div');
    contentRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;';

    if (summary.isText && summary.textPreview) {
        const textSnippet = document.createElement('div');
        textSnippet.style.cssText = 'font-size:11px;color:#cbd5e1;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:6px 8px;width:100%;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;';
        textSnippet.textContent = summary.textPreview;
        contentRow.appendChild(textSnippet);
    } else if (summary.pills.length > 0) {
        for (const pill of summary.pills) {
            const pillSpan = document.createElement('span');
            let pillBg = 'rgba(255,255,255,0.07)';
            let pillColor = '#e2e8f0';
            let pillBorder = 'rgba(255,255,255,0.1)';
            if (pill.type === 'steps') { pillBg = 'rgba(59,130,246,0.15)'; pillColor = '#93c5fd'; pillBorder = 'rgba(59,130,246,0.3)'; }
            else if (pill.type === 'cfg') { pillBg = 'rgba(245,158,11,0.15)'; pillColor = '#fcd34d'; pillBorder = 'rgba(245,158,11,0.3)'; }
            else if (pill.type === 'sampler' || pill.type === 'scheduler') { pillBg = 'rgba(168,85,247,0.15)'; pillColor = '#d8b4fe'; pillBorder = 'rgba(168,85,247,0.3)'; }
            else if (pill.type === 'denoise') { pillBg = 'rgba(16,185,129,0.15)'; pillColor = '#6ee7b7'; pillBorder = 'rgba(16,185,129,0.3)'; }

            pillSpan.style.cssText = `font-size:10px;font-weight:600;padding:2px 7px;border-radius:5px;background:${pillBg};color:${pillColor};border:1px solid ${pillBorder};white-space:nowrap;`;
            pillSpan.textContent = pill.label;
            contentRow.appendChild(pillSpan);
        }
    }
    card.appendChild(contentRow);

    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px;';

    const hintSpan = document.createElement('span');
    hintSpan.style.cssText = 'font-size:10px;color:#64748b;display:flex;align-items:center;gap:4px;';
    hintSpan.innerHTML = `<span style="font-size:11px;">🔍</span> <span>${t('assistantHoverToInspect') || '悬停预览详情'}</span>`;
    actionRow.appendChild(hintSpan);

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'anomalous-scheme-apply-btn';
    applyBtn.style.cssText = 'padding:5px 12px;font-size:11px;font-weight:700;border-radius:6px;background:rgba(25,118,210,0.85);color:#fff;border:1px solid rgba(255,255,255,0.18);cursor:pointer;transition:all 0.15s;display:flex;align-items:center;gap:4px;box-shadow:0 2px 6px rgba(0,0,0,0.2);';
    applyBtn.innerHTML = t('assistantApplyScheme') || '⚡ 应用方案';

    applyBtn.onmouseover = (e) => { e.stopPropagation(); applyBtn.style.filter = 'brightness(1.15)'; };
    applyBtn.onmouseout = (e) => { e.stopPropagation(); applyBtn.style.filter = 'none'; };

    applyBtn.onclick = async (e) => {
        e.stopPropagation();
        applyBtn.disabled = true;
        applyBtn.innerHTML = t('assistantApplying') || '⏳ 应用中...';
        applyBtn.style.background = 'rgba(255,255,255,0.1)';
        try {
            await onApply();
            applyBtn.innerHTML = t('assistantApplied') || '✅ 已应用';
            applyBtn.style.background = 'rgba(16,185,129,0.7)';
        } catch (err) {
            console.error('[Anomalous] Apply scheme failed:', err);
            applyBtn.innerHTML = '⚠️ 失败';
            applyBtn.style.background = 'rgba(239,68,68,0.7)';
        }
        setTimeout(() => {
            if (!applyBtn.isConnected) return;
            applyBtn.disabled = false;
            applyBtn.innerHTML = t('assistantApplyScheme') || '⚡ 应用方案';
            applyBtn.style.background = 'rgba(25,118,210,0.85)';
        }, 1500);
    };

    actionRow.appendChild(applyBtn);
    card.appendChild(actionRow);

    card.addEventListener('mouseenter', () => {
        showParamPopover(card, {
            node,
            sourceTitle,
            schemeTitle,
            promptRoleTag,
            summary,
            onApply: () => applyBtn.click()
        });
    });

    card.addEventListener('mouseleave', () => {
        hideParamPopover(false);
    });

    return card;
}

function renderMaterialPresets(node, container, forceRefresh) {
    const section = document.createElement('div');
    section.className = 'anomalous-assistant-parameter-presets anomalous-assistant-material-presets';
    section.style.cssText = 'margin:14px 16px; display:flex; flex-direction:column; gap:8px;';
    const header = document.createElement('div');
    header.style.cssText = 'color:#68cdb9;font-size:10px;font-weight:750;letter-spacing:0.1em;text-transform:uppercase;';
    header.textContent = t('materialLibrary');
    const browse = document.createElement('button');
    browse.textContent = t('materialShowCompatible');
    browse.className = 'anomalous-btn-ghost';
    browse.onclick = () => window.anomalousBrowserInstance?.openMaterialLibrary();
    header.appendChild(browse);
    const loader = document.createElement('div');
    loader.style.cssText = 'font-size:12px;color:#555;text-align:center;padding:10px;';
    loader.textContent = t('loading');
    section.append(header, loader);
    container.appendChild(section);

    const url = `/anomalous/materials/by_node_type?type=${encodeURIComponent(node.type)}${forceRefresh ? '&refresh=1' : ''}`;
    fetch(url, { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('material preset request failed');
        return response.json();
    }).then(payload => {
        loader.remove();
        const materials = Array.isArray(payload.materials) ? payload.materials : [];
        if (!materials.length) {
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:11px;color:#666;text-align:center;padding:10px;background:rgba(0,0,0,.2);border-radius:8px;border:1px dashed rgba(255,255,255,.1);';
            empty.textContent = t('materialNoNodePresets');
            section.appendChild(empty);
            return;
        }
        for (const material of materials) {
            const group = document.createElement('div');
            group.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid rgba(92,202,180,.2);border-radius:10px;background:rgba(92,202,180,.04);';
            const name = document.createElement('strong');
            name.innerHTML = `<svg style="width:13px;height:13px;margin-right:5px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>${escapeHtml(material.name || t('materialUntitled'))}`;
            name.style.cssText = 'font-size:12px;color:#bcebe1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            group.appendChild(name);
            for (const block of (Array.isArray(material.blocks) ? material.blocks : [])) {
                const suffix = material.blocks.length > 1 ? ` #${block.occurrence}` : '';
                const schemeTitle = `${block.title || block.type}${suffix}`;

                const card = createSchemeCard({
                    node,
                    sourceTitle: material.name || t('materialLibrary'),
                    sourceBadge: t('materialLibrary'),
                    schemeTitle,
                    role: block.role,
                    widgetValues: block.widgets_values,
                    onApply: () => applyMaterialToSelectedNode(node, block, material.workflow_hashes, group)
                });
                group.appendChild(card);
            }
            section.appendChild(group);
        }
    }).catch(error => {
        console.error('Failed to load material presets:', error);
        loader.textContent = t('materialLoadError');
        loader.style.color = '#ff7070';
    });
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

    renderMaterialPresets(node, container, forceRefresh);

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

                        let summaryTitle = nb.name || t('recipeParameterUntitled') || 'Untitled';
                        if (nb.nodes.length > 1) {
                            summaryTitle += ` - ${n.title}`;
                        }

                        const card = createSchemeCard({
                            node,
                            sourceTitle: displayName,
                            sourceBadge: t('recipeParameterNotebooks') || '配方',
                            schemeTitle: summaryTitle,
                            role: n.role,
                            widgetValues: n.widgets_values,
                            onApply: () => applyLocalNodeParameters(node, n.widgets_values)
                        });
                        notebookList.appendChild(card);
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
