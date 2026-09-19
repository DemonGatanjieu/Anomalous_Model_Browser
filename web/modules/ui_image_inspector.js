/**
 * Image workbench metadata inspector and its tab content.
 */

import { translate } from './locales.js';
import { text } from './ui_dom.js';
import {
    fileBaseName,
    appendLocalPreview,
    modelCustomNotes,
    resolveLocalModels,
    lookupLocalModel,
    detailedBlocksFromWorkflow,
    materialNodeHeading,
    renderDetailedNodeCards,
    applyPromptRolesToBlocks,
    mergePromptRoleOverrides,
} from './material_inspector.js';

const t = (key, params) => translate(key, params);

/**
 * Build Specs Bento Grid
 */
function buildSpecsGrid(params, blocks, item, suggestedName, context) {
    const grid = document.createElement('div');
    grid.className = 'anomalous-workbench-specs-grid';

    const samplerBlock = (blocks || []).find(block => /^(ksampler|ksampleradvanced)$/i.test(block.type || ''));
    const sizeBlock = (blocks || []).find(block => /^(emptylatentimage|emptylatentimage.*)$/i.test(block.type || ''));

    const addTile = (labelStr, val, options = {}) => {
        if (val == null || val === '') return;
        const card = document.createElement('div');
        card.className = options.wide ? 'anomalous-workbench-spec-card is-wide' : 'anomalous-workbench-spec-card';
        if (options.accent) card.classList.add(`is-${options.accent}`);

        const headerRow = document.createElement('div');
        headerRow.className = 'anomalous-workbench-spec-header';
        text(headerRow, 'span', labelStr, 'anomalous-workbench-spec-label');

        let copyIndicator = null;
        if (options.copyable) {
            card.classList.add('is-copyable');
            card.setAttribute('role', 'button');
            card.tabIndex = 0;
            card.title = t('materialClickToCopy') || '点击复制数值';

            copyIndicator = document.createElement('span');
            copyIndicator.className = 'anomalous-workbench-copy-indicator';
            const renderNormalCopyIcon = () => {
                copyIndicator.innerHTML = `
                    <svg class="anomalous-workbench-spec-copy-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <rect x="5.5" y="5.5" width="8" height="8" rx="1.5"></rect>
                        <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"></path>
                    </svg>
                `;
            };
            renderNormalCopyIcon();
            card.appendChild(copyIndicator);

            const handleCopy = async (e) => {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(String(val));
                    card.classList.remove('is-copy-failed');
                    card.classList.add('is-copied');
                    if (copyIndicator) {
                        copyIndicator.innerHTML = `
                            <svg class="anomalous-workbench-spec-copy-icon is-success" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <polyline points="3.5 8.5 6.5 11.5 12.5 4.5"></polyline>
                            </svg>
                            <span class="anomalous-workbench-copy-badge">${t('materialCopySuccess')}</span>
                        `;
                    }
                    setTimeout(() => {
                        card.classList.remove('is-copied');
                        if (copyIndicator) renderNormalCopyIcon();
                    }, 1500);
                } catch (err) {
                    console.warn('Clipboard copy error:', err);
                    card.classList.remove('is-copied');
                    card.classList.add('is-copy-failed');
                    if (copyIndicator) {
                        copyIndicator.innerHTML = `
                            <svg class="anomalous-workbench-spec-copy-icon is-error" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <circle cx="8" cy="8" r="6"></circle>
                                <line x1="8" y1="5" x2="8" y2="8.5"></line>
                                <line x1="8" y1="11" x2="8.01" y2="11"></line>
                            </svg>
                            <span class="anomalous-workbench-copy-badge is-error">${t('materialCopyFailed')}</span>
                        `;
                    }
                    setTimeout(() => {
                        card.classList.remove('is-copy-failed');
                        if (copyIndicator) renderNormalCopyIcon();
                    }, 2000);
                }
            };

            card.onclick = handleCopy;
            card.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleCopy(e);
                }
            };
        }
        card.appendChild(headerRow);

        const valEl = text(card, 'div', String(val), 'anomalous-workbench-spec-val');
        if (options.mono) valEl.classList.add('is-mono');

        grid.appendChild(card);
    };

    addTile(t('materialParamSeed') || '种子 (Seed)', params.seed, { copyable: true, mono: true, accent: 'seed' });
    addTile(t('recipeCardSpecsSteps') || '采样步数 (Steps)', params.steps != null ? `${params.steps} 步` : null, { });
    addTile('CFG Scale', params.cfg, { });
    addTile(t('materialDenoise') || '重绘降噪 (Denoise)', params.denoise, { });
    addTile(t('recipeCardSpecsSampler') || '采样器 (Sampler)', params.sampler_name, { });
    addTile(t('materialScheduler') || '调度器 (Scheduler)', params.scheduler, { });
    addTile(t('recipeCardSpecsResolution') || '分辨率 (Resolution)', params.resolution, { wide: true, mono: true, accent: 'res' });

    const generationBlocks = [samplerBlock, sizeBlock].filter(Boolean);
    if (generationBlocks.length) {
        const actions = document.createElement('div');
        actions.className = 'anomalous-workbench-generation-save';

        const infoBox = document.createElement('div');
        infoBox.className = 'anomalous-workbench-generation-info';

        const titleEl = document.createElement('div');
        titleEl.className = 'anomalous-workbench-generation-title';
        titleEl.innerHTML = `
            <svg class="anomalous-workbench-generation-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="2" y="2" width="12" height="12" rx="3"></rect>
                <path d="M5 8h6m-3-3v6"></path>
            </svg>
            <span>${t('materialSaveGeneration')}</span>
        `;
        infoBox.appendChild(titleEl);
        text(infoBox, 'div', t('materialGenerationScope'), 'anomalous-workbench-generation-hint');

        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'anomalous-workbench-generation-btn';
        save.textContent = t('materialSaveGenerationAction');
        save.dataset.defaultLabel = save.textContent;
        save.onclick = () => context.saveSelectedBlocks(item, suggestedName, generationBlocks, save);

        actions.appendChild(infoBox);
        actions.appendChild(save);
        grid.appendChild(actions);
    }

    return grid;
}

/**
 * Build Prompts Station
 */
function buildPromptsStation(blocks, fallbackPrompt, item, suggestedName, context) {
    const { workbench: wb, saveSelectedBlocks, copyToClipboard } = context;
    const wrap = document.createElement('div');
    wrap.className = 'anomalous-workbench-prompts-wrap';

    const promptBlocks = (blocks || []).filter(block =>
        /cliptextencode/i.test(block.type || '') &&
        (block.widgets_values || []).some(value => typeof value === 'string' && value.trim())
    );
    if (promptBlocks.length) {
        text(wrap, 'p', t('materialPromptRoleHelp'), 'anomalous-workbench-muted');
        renderDetailedNodeCards(wrap, promptBlocks, {
            onSaveBlock: (block, button) => saveSelectedBlocks(item, suggestedName, [block], button),
            onPromptRoleChange: async (block, selectedRole) => {
                const key = String(block.node_id);
                if (!wb.promptRoleOverrides || typeof wb.promptRoleOverrides !== 'object') wb.promptRoleOverrides = {};
                if (selectedRole === 'auto') {
                    delete wb.promptRoleOverrides[key];
                    block.promptRole = block.promptRoleAutomatic || 'unknown';
                    block.promptRoleManual = false;
                    block.promptRoleSource = 'automatic';
                } else {
                    wb.promptRoleOverrides[key] = { role: selectedRole, nodeType: block.type || null };
                    block.promptRole = selectedRole;
                    block.promptRoleManual = true;
                    block.promptRoleSource = 'manual';
                }
            },
        });
    } else if (fallbackPrompt) {
        const card = document.createElement('div');
        card.className = 'anomalous-workbench-prompt-card';
        const topBar = document.createElement('div');
        topBar.className = 'anomalous-workbench-prompt-bar';
        text(topBar, 'span', t('materialPromptText') || '提示词', 'anomalous-workbench-prompt-title');
        const copyBtn = text(topBar, 'button', t('materialCopyPrompt'), 'anomalous-workbench-mini-action-btn');
        copyBtn.type = 'button';
        copyBtn.onclick = () => copyToClipboard(fallbackPrompt, copyBtn, t('materialCopied'), t('materialCopyPrompt'));
        card.appendChild(topBar);
        text(card, 'div', fallbackPrompt, 'anomalous-workbench-prompt-content is-expanded');
        wrap.appendChild(card);
    } else {
        text(wrap, 'div', t('materialNoPromptData'), 'anomalous-workbench-muted');
    }

    return wrap;
}

/**
 * Build Models & LoRAs Section
 */
function buildModelsSection(orderedRefs, groups, onOpenModel) {
    const wrap = document.createElement('div');
    wrap.className = 'anomalous-workbench-models-wrap';

    if (!orderedRefs || !orderedRefs.length) {
        const empty = text(wrap, 'div', '（未检测到模型引用）', 'anomalous-workbench-muted');
        empty.style.padding = '12px';
        return wrap;
    }

    const renderGroup = (title, items, tagClass) => {
        if (!items || !items.length) return;
        const groupEl = document.createElement('div');
        groupEl.className = 'anomalous-workbench-model-group';
        text(groupEl, 'div', title, 'anomalous-workbench-model-group-title');

        for (const item of items) {
            const row = document.createElement('div');
            row.className = 'anomalous-workbench-model-card';

            appendLocalPreview(row, item.localModel?.preview_url, 'anomalous-workbench-model-thumb');

            const info = document.createElement('div');
            info.className = 'anomalous-workbench-model-info';

            const rawVal = String(item.saved_value || item.name || 'Unknown');
            const fileName = fileBaseName(rawVal);
            const nameEl = text(info, 'span', fileName, 'anomalous-workbench-model-name');
            nameEl.title = rawVal;

            if (item.loraWeights) {
                const badge = text(info, 'span', `Model: ${item.loraWeights.strengthModel} · CLIP: ${item.loraWeights.strengthClip}`, 'anomalous-workbench-lora-badge');
                badge.title = 'LoRA Weight & CLIP Strength';
            }

            const notes = modelCustomNotes(item.localModel);
            if (notes) text(info, 'span', notes, 'anomalous-workbench-model-notes');

            row.appendChild(info);

            const actions = document.createElement('div');
            actions.className = 'anomalous-workbench-model-actions';
            text(actions, 'span', item.category || 'model', `anomalous-workbench-model-tag ${tagClass}`);

            if (item.localModel) {
                const viewBtn = document.createElement('button');
                viewBtn.type = 'button';
                viewBtn.className = 'anomalous-workbench-mini-action-btn';
                viewBtn.textContent = '🔎 定位模型';
                viewBtn.onclick = (e) => {
                    e.stopPropagation();
                    onOpenModel(item.localModel);
                };
                actions.appendChild(viewBtn);
            }

            row.appendChild(actions);
            groupEl.appendChild(row);
        }

        wrap.appendChild(groupEl);
    };

    renderGroup(t('materialModelBase') || '主模型 / UNet', groups.base, 'is-base');
    renderGroup(t('materialModelLora') || 'LoRA 微调层', groups.lora, 'is-lora');
    renderGroup(t('materialModelClip') || '文本编码器 (CLIP)', groups.clip, 'is-clip');
    renderGroup(t('materialModelVae') || 'VAE 编码器', groups.vae, 'is-vae');
    renderGroup(t('materialModelOther') || '其它模型组件', groups.other, 'is-other');

    return wrap;
}

/**
 * Build Workflow Nodes Section
 */
function buildWorkflowNodesSection(blocks, clientWorkflow, item, suggestedName, context) {
    const { workbench: wb, saveSelectedBlocks, copyToClipboard } = context;
    const wrap = document.createElement('div');
    wrap.className = 'anomalous-workbench-nodes-wrap';

    if (!blocks || !blocks.length) {
        text(wrap, 'div', '（无底层节点参数数据）', 'anomalous-workbench-muted');
        return wrap;
    }

    // Node count summary chips
    const typeCounts = {};
    for (const b of blocks) {
        const tName = materialNodeHeading(b) || 'Node';
        typeCounts[tName] = (typeCounts[tName] || 0) + 1;
    }

    const chipFlow = document.createElement('div');
    chipFlow.className = 'anomalous-material-chip-flow';
    for (const [nTitle, cnt] of Object.entries(typeCounts)) {
        const chip = document.createElement('span');
        chip.className = 'anomalous-material-chip';
        text(chip, 'span', nTitle);
        if (cnt > 1) text(chip, 'span', `×${cnt}`, 'anomalous-material-chip-count');
        chipFlow.appendChild(chip);
    }
    wrap.appendChild(chipFlow);

    const selectionBar = document.createElement('div');
    selectionBar.className = 'anomalous-workbench-node-selection-bar';
    const selectionText = text(selectionBar, 'span', '', 'anomalous-workbench-node-selection-count');
    const selectAllBtn = text(selectionBar, 'button', t('materialSelectAllNodes'), 'anomalous-workbench-mini-action-btn');
    selectAllBtn.type = 'button';
    const clearBtn = text(selectionBar, 'button', t('materialClearNodeSelection'), 'anomalous-workbench-mini-action-btn');
    clearBtn.type = 'button';
    const saveSelectedBtn = text(selectionBar, 'button', t('materialSaveSelectedAction', { count: 0 }), 'anomalous-workbench-save-selected-btn');
    saveSelectedBtn.type = 'button';
    saveSelectedBtn.disabled = true;
    wrap.appendChild(selectionBar);

    const updateSelection = () => {
        const count = wb?.selectedNodeIds?.size || 0;
        selectionText.textContent = t('materialSelectedNodeCount', { count });
        saveSelectedBtn.textContent = t('materialSaveSelectedAction', { count });
        saveSelectedBtn.disabled = count === 0;
    };

    // Copy full workflow JSON button
    const jsonActionRow = document.createElement('div');
    jsonActionRow.className = 'anomalous-workbench-action-row';

    const copyJsonBtn = document.createElement('button');
    copyJsonBtn.type = 'button';
    copyJsonBtn.className = 'anomalous-workbench-mini-action-btn';
    copyJsonBtn.textContent = `📋 ${t('workbenchCopyWorkflowJson') || '复制完整工作流 JSON'}`;
    copyJsonBtn.onclick = () => {
        if (clientWorkflow) {
            copyToClipboard(JSON.stringify(clientWorkflow, null, 2), copyJsonBtn, '✅ 已复制工作流 JSON', `📋 ${t('workbenchCopyWorkflowJson') || '复制完整工作流 JSON'}`);
        }
    };
    jsonActionRow.appendChild(copyJsonBtn);
    wrap.appendChild(jsonActionRow);

    // Detailed node cards
    const detailedContainer = document.createElement('div');
    detailedContainer.className = 'anomalous-workbench-node-list-box';
    renderDetailedNodeCards(detailedContainer, blocks, {
        selectable: true,
        selectedIds: wb?.selectedNodeIds,
        onSelectionChange: (block, checked) => {
            const key = String(block.node_id);
            if (checked) wb?.selectedNodeIds?.add(key);
            else wb?.selectedNodeIds?.delete(key);
            updateSelection();
        },
        onSaveBlock: (block, button) => saveSelectedBlocks(item, suggestedName, [block], button),
    });
    wrap.appendChild(detailedContainer);

    const setAllSelections = checked => {
        if (!wb?.selectedNodeIds) return;
        wb.selectedNodeIds.clear();
        if (checked) blocks.forEach(block => wb.selectedNodeIds.add(String(block.node_id)));
        detailedContainer.querySelectorAll('.anomalous-material-node-select').forEach(input => {
            input.checked = checked;
            input.closest('.anomalous-material-node-detail')?.classList.toggle('is-selected', checked);
        });
        updateSelection();
    };
    selectAllBtn.onclick = () => setAllSelections(true);
    clearBtn.onclick = () => setAllSelections(false);
    saveSelectedBtn.onclick = () => {
        const selected = blocks.filter(block => wb?.selectedNodeIds?.has(String(block.node_id)));
        return saveSelectedBlocks(item, suggestedName, selected, saveSelectedBtn);
    };
    updateSelection();

    return wrap;
}

/**
 * Render the Inspector Panel Content
 */
export async function renderImageInspectorContent(context, data, item) {
    const {
        workbench: wb,
        loadWorkflowToComfyCanvas,
        openMaterialLocalModel,
        renderSaveSnapshotFooter,
    } = context;
    if (!wb || !wb.sideBodyEl) return;

    const { inspectPayload, clientWorkflow, clientDetails, params } = data;
    wb.sideBodyEl.replaceChildren();

    // Group models
    const allModelRefs = Array.isArray(inspectPayload.model_references) ? [...inspectPayload.model_references] : [];
    const addIfNotExists = (refItem) => {
        const clean = (val) => String(val || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
        const target = clean(refItem.saved_value || refItem.name);
        if (!target) return;
        if (!allModelRefs.some(m => clean(m.saved_value || m.name) === target)) {
            allModelRefs.push(refItem);
        }
    };

    if (clientDetails.discoveredModels) {
        for (const c of clientDetails.discoveredModels.checkpoints) addIfNotExists({ saved_value: c.name, category: c.category });
        for (const l of clientDetails.discoveredModels.loras) addIfNotExists({ saved_value: l.name, category: 'lora' });
        for (const tModel of clientDetails.discoveredModels.textEncoders) addIfNotExists({ saved_value: tModel.name, category: 'text_encoder' });
        for (const v of clientDetails.discoveredModels.vaes) addIfNotExists({ saved_value: v.name, category: 'vae' });
    }

    const groups = { base: [], lora: [], clip: [], vae: [], other: [] };
    for (const ref of allModelRefs) {
        const cat = String(ref.category || '').toLowerCase();
        const val = String(ref.saved_value || ref.name || '').toLowerCase();
        const rawVal = String(ref.saved_value || ref.name || '');
        const fileName = fileBaseName(rawVal);
        ref.loraWeights = clientDetails.loraDetailsMap?.get(rawVal) || clientDetails.loraDetailsMap?.get(fileName);

        if (cat === 'checkpoint' || cat === 'unet' || val.includes('checkpoint') || val.includes('unet')) {
            groups.base.push(ref);
        } else if (cat === 'lora' || val.includes('lora')) {
            groups.lora.push(ref);
        } else if (cat === 'text_encoder' || cat === 'clip' || val.includes('clip') || val.includes('t5')) {
            groups.clip.push(ref);
        } else if (cat === 'vae' || val.includes('vae')) {
            groups.vae.push(ref);
        } else {
            groups.other.push(ref);
        }
    }

    const orderedRefs = [...groups.base, ...groups.lora, ...groups.clip, ...groups.vae, ...groups.other];

    const applyResolvedModels = localModels => {
        for (const reference of orderedRefs) {
            reference.localModel = lookupLocalModel(localModels, reference.saved_value || reference.name);
        }
    };
    if (data._localModels) applyResolvedModels(data._localModels);

    const recipe = wb?.owner?.recipeDetailPayload?.recipe;
    const recipeOverrides = recipe?.params?.promptRoleOverrides || recipe?.data?.params?.promptRoleOverrides || {};
    const promptSourceKey = `${item.subfolder || ''}/${item.filename || item.url || ''}`;
    if (wb.promptRoleSourceKey !== promptSourceKey) {
        wb.promptRoleSourceKey = promptSourceKey;
        wb.promptRoleOverrides = JSON.parse(JSON.stringify(recipeOverrides));
    }
    const promptRoles = mergePromptRoleOverrides(
        inspectPayload.prompt_roles,
        wb.promptRoleOverrides,
    );
    const blocks = applyPromptRolesToBlocks(
        detailedBlocksFromWorkflow(clientWorkflow, inspectPayload.node_blocks),
        promptRoles,
    );
    const fallbackPrompt = (Array.isArray(inspectPayload.prompts) && inspectPayload.prompts.length)
        ? inspectPayload.prompts.join('\n\n')
        : (inspectPayload.prompt_excerpt || '');

    // Top Inspector Toolbar: One-click actions
    const toolbar = document.createElement('div');
    toolbar.className = 'anomalous-workbench-inspector-toolbar';

    const loadCanvasBtn = document.createElement('button');
    loadCanvasBtn.type = 'button';
    loadCanvasBtn.className = 'anomalous-workbench-action-btn is-primary';
    loadCanvasBtn.innerHTML = `
        <svg class="anomalous-workbench-action-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="4" height="4" rx="1"></rect>
            <rect x="10" y="3" width="4" height="4" rx="1"></rect>
            <rect x="6" y="9.5" width="4" height="4" rx="1"></rect>
            <path d="M4 7v2a1 1 0 0 0 1 1h1m6-3v2a1 1 0 0 1-1 1H8"></path>
        </svg>
        <span>${t('materialOpenWorkflow')}</span>
    `;
    loadCanvasBtn.title = window.anomalous_browser_lang === 'zh'
        ? '将这张图片中包含的完整工作流直接还原到 ComfyUI 画布'
        : 'Restore the full workflow from this image directly to ComfyUI canvas';
    loadCanvasBtn.onclick = () => loadWorkflowToComfyCanvas(clientWorkflow || inspectPayload.workflow);
    toolbar.appendChild(loadCanvasBtn);

    const saveMaterialBtn = document.createElement('button');
    saveMaterialBtn.type = 'button';
    saveMaterialBtn.className = 'anomalous-workbench-action-btn is-save';
    const cleanSaveLabel = (t('materialSaveSnapshotShort') || '保存到素材库').replace(/^[^\w\u4e00-\u9fa5]+/, '').trim();
    saveMaterialBtn.innerHTML = `
        <svg class="anomalous-workbench-action-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3.5 2.5h9a1 1 0 0 1 1 1v10.5l-5.5-3-5.5 3V3.5a1 1 0 0 1 1-1z"></path>
        </svg>
        <span>${cleanSaveLabel}</span>
    `;
    saveMaterialBtn.title = t('materialSaveSnapshotFocusHint');
    saveMaterialBtn.setAttribute('aria-expanded', 'false');
    saveMaterialBtn.onclick = () => {
        const footer = wb?.sideFooterEl;
        if (!footer) return;
        footer.hidden = !footer.hidden;
        saveMaterialBtn.classList.toggle('is-active', !footer.hidden);
        saveMaterialBtn.setAttribute('aria-expanded', String(!footer.hidden));
        if (footer.hidden) return;
        const nameInput = wb?.sideFooterEl?.querySelector('input[type="text"]');
        wb?.sideFooterEl?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
        nameInput?.focus();
        nameInput?.select();
    };
    toolbar.appendChild(saveMaterialBtn);

    wb.sideBodyEl.appendChild(toolbar);

    // Segmented Tabs
    const tabsBar = document.createElement('div');
    tabsBar.className = 'anomalous-workbench-tabs-bar';

    const tabs = [
        { id: 'specs', label: t('workbenchTabOverview') || '核心参数', icon: '<svg style="width:13px;height:13px;margin-right:5px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>' },
        { id: 'prompts', label: t('workbenchTabPrompts') || '提示词', icon: '<svg style="width:13px;height:13px;margin-right:5px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },
        { id: 'models', label: t('workbenchTabModels') || '模型与LoRA', icon: '<svg style="width:13px;height:13px;margin-right:5px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>' },
        { id: 'nodes', label: t('workbenchTabNodes') || '工作流节点', icon: '<svg style="width:13px;height:13px;margin-right:5px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>' },
    ];

    const tabPanels = {};
    let ensureModelsResolved = () => {};

    tabs.forEach(tDef => {
        const tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.className = (wb.activeTab === tDef.id)
            ? 'anomalous-workbench-tab-btn is-active'
            : 'anomalous-workbench-tab-btn';
        tabBtn.innerHTML = `${tDef.icon}<span>${tDef.label}</span>`;

        tabBtn.onclick = () => {
            wb.activeTab = tDef.id;
            tabsBar.querySelectorAll('.anomalous-workbench-tab-btn').forEach(b => b.classList.remove('is-active'));
            tabBtn.classList.add('is-active');
            Object.values(tabPanels).forEach(p => p.style.display = 'none');
            if (tabPanels[tDef.id]) tabPanels[tDef.id].style.display = 'flex';
            if (tDef.id === 'models') ensureModelsResolved();
        };

        tabsBar.appendChild(tabBtn);
    });

    wb.sideBodyEl.appendChild(tabsBar);

    // Panel 1: Specs Grid
    const specsPanel = document.createElement('div');
    specsPanel.className = 'anomalous-workbench-tab-panel';
    specsPanel.style.display = wb.activeTab === 'specs' ? 'flex' : 'none';
    specsPanel.appendChild(buildSpecsGrid(params, blocks, item, inspectPayload.suggested_name, context));
    tabPanels.specs = specsPanel;
    wb.sideBodyEl.appendChild(specsPanel);

    // Panel 2: Prompts Station
    const promptsPanel = document.createElement('div');
    promptsPanel.className = 'anomalous-workbench-tab-panel';
    promptsPanel.style.display = wb.activeTab === 'prompts' ? 'flex' : 'none';
    promptsPanel.appendChild(buildPromptsStation(blocks, fallbackPrompt, item, inspectPayload.suggested_name, context));
    tabPanels.prompts = promptsPanel;
    wb.sideBodyEl.appendChild(promptsPanel);

    // Panel 3: Models & LoRAs
    const modelsPanel = document.createElement('div');
    modelsPanel.className = 'anomalous-workbench-tab-panel';
    modelsPanel.style.display = wb.activeTab === 'models' ? 'flex' : 'none';
    modelsPanel.appendChild(buildModelsSection(orderedRefs, groups, (m) => openMaterialLocalModel(m)));
    tabPanels.models = modelsPanel;
    wb.sideBodyEl.appendChild(modelsPanel);
    ensureModelsResolved = () => {
        if (data._localModels) return;
        if (!data._localModelsPromise) {
            data._localModelsPromise = resolveLocalModels(orderedRefs.map(reference => reference.saved_value || reference.name))
                .then(localModels => {
                    data._localModels = localModels;
                    return localModels;
                })
                .catch(() => ({}));
        }
        data._localModelsPromise.then(localModels => {
            if (!modelsPanel.isConnected) return;
            applyResolvedModels(localModels);
            modelsPanel.replaceChildren(buildModelsSection(orderedRefs, groups, model => openMaterialLocalModel(model)));
        });
    };
    if (wb.activeTab === 'models') ensureModelsResolved();

    // Panel 4: Nodes Section
    const nodesPanel = document.createElement('div');
    nodesPanel.className = 'anomalous-workbench-tab-panel';
    nodesPanel.style.display = wb.activeTab === 'nodes' ? 'flex' : 'none';
    nodesPanel.appendChild(buildWorkflowNodesSection(blocks, clientWorkflow, item, inspectPayload.suggested_name, context));
    tabPanels.nodes = nodesPanel;
    wb.sideBodyEl.appendChild(nodesPanel);

    // Bottom Snapshot Drawer in Footer
    renderSaveSnapshotFooter(inspectPayload, item);
}
