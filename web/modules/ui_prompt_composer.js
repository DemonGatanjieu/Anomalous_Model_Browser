import { loadMaterialPrompts } from './material_prompt_data.js';
import { bindMaterialDrag } from './material_drag.js';
import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { text, jsonResponse, materialNodeHeading } from './material_inspector.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { composePromptPlan, joinPromptText, categorizePromptSnippet, smartSortPromptBlocks, assemblePromptBlocks } from './prompt_composition.js';
import { applyNodeMaterialValues, promptWidgetTargets, selectedMaterialNode } from './node_material_actions.js';
import { showMaterialApplication } from './ui_material_application.js';
import { showMaterialSaved } from './material_feedback.js';

const clone = value => JSON.parse(JSON.stringify(value));
const newDraft = () => ({
    name: '',
    tags: [],
    plan: {
        parts: [],
        positive: '',
        negative: '',
    },
});

const CATEGORY_META = {
    base: { zh: '通用底模', en: 'Base Quality', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.4)' },
    style: { zh: '风格氛围', en: 'Art Style', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.15)', border: 'rgba(192, 132, 252, 0.4)' },
    subject: { zh: '主体内容', en: 'Subject', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.15)', border: 'rgba(74, 222, 128, 0.4)' },
    trigger: { zh: 'LoRA/触发', en: 'LoRA / Trigger', color: '#fb923c', bg: 'rgba(251, 146, 60, 0.15)', border: 'rgba(251, 146, 60, 0.4)' },
};

function normalizeBlock(part, index = 0) {
    const id = part.id || `blk_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`;
    const role = part.role || (part.negative && !part.positive ? 'negative' : 'positive');
    const content = String(part.content ?? (role === 'positive' ? part.positive : part.negative) ?? '').trim();
    let category = part.category;
    if (!CATEGORY_META[category]) {
        category = categorizePromptSnippet(content);
    }
    const meta = CATEGORY_META[category] || CATEGORY_META.subject;
    const defaultTitle = (window.anomalous_browser_lang === 'zh' ? meta.zh : meta.en) + (index ? ` #${index + 1}` : '');
    return {
        id,
        title: part.name || part.title || defaultTitle,
        content,
        role,
        category,
        enabled: part.enabled !== false,
    };
}

export function syncDraftSynthesizedText(draft) {
    if (!draft || !draft.plan) return;
    draft.plan.parts ||= [];
    const posParts = draft.plan.parts.filter(p => p.role === 'positive');
    const negParts = draft.plan.parts.filter(p => p.role === 'negative');
    draft.plan.positive = assemblePromptBlocks(posParts, 'positive');
    draft.plan.negative = assemblePromptBlocks(negParts, 'negative');
}

export function addPromptToDraft(owner, name, positive, negative = '') {
    owner.promptPlanDraft ||= newDraft();
    const draft = owner.promptPlanDraft;
    draft.plan.parts ||= [];
    if (name && !draft.name) draft.name = String(name).slice(0, 120);
    if (positive && positive.trim()) {
        draft.plan.parts.push(normalizeBlock({
            title: name || (window.anomalous_browser_lang === 'zh' ? '导入正向词' : 'Imported Positive'),
            content: positive.trim(),
            role: 'positive',
            category: categorizePromptSnippet(positive),
        }, draft.plan.parts.length));
    }
    if (negative && negative.trim()) {
        draft.plan.parts.push(normalizeBlock({
            title: name ? `${name} (负向)` : (window.anomalous_browser_lang === 'zh' ? '导入负向词' : 'Imported Negative'),
            content: negative.trim(),
            role: 'negative',
            category: 'base',
        }, draft.plan.parts.length));
    }
    syncDraftSynthesizedText(draft);
    showPromptComposer(owner);
}

export async function showPromptComposer(owner, material) {
    owner.closePromptImportDrawer?.();
    owner.materialDetailController?.abort();
    if (material) {
        const controller = new AbortController();
        owner.materialDetailController = controller;
        try {
            if (owner.promptPlanDraft && !await anomalousConfirm(t('promptReplaceDraft'))) return;
            if (controller.signal.aborted) return;
            const response = await fetch(`/anomalous/material_full?include_workflow=0&filename=${encodeURIComponent(material.filename)}`, { signal: controller.signal });
            const payload = await jsonResponse(response, 'material load failed');
            if (controller.signal.aborted || owner.materialView.style.display !== 'flex') return;
            if (payload.data?.kind !== 'prompt_plan') throw new Error('invalid plan');
            const planData = clone(payload.data.plan || {});
            const parts = Array.isArray(planData.parts) ? planData.parts.map((p, i) => normalizeBlock(p, i)) : [];
            owner.promptPlanDraft = {
                name: payload.data.name || '',
                tags: payload.data.tags || [],
                plan: {
                    parts,
                    positive: planData.positive || '',
                    negative: planData.negative || '',
                },
            };
        } catch (error) {
            if (error.name !== 'AbortError') await anomalousAlert(t('materialDetailLoadError'));
            return;
        } finally {
            if (owner.materialDetailController === controller) owner.materialDetailController = null;
        }
    }

    owner.promptPlanDraft ||= newDraft();
    clearTimeout(owner.materialSearchTimer);
    owner.materialListController?.abort();
    owner.materialListController = null;
    owner.materialDetailController?.abort();
    owner.materialDetailView?.remove();
    owner.materialDetailView = null;

    for (const panel of [owner.materialTopbar, owner.materialMainArea, owner.materialIntro, owner.materialList, owner.materialToolbar, owner.materialPager, owner.materialContext]) {
        if (panel) panel.style.display = 'none';
    }
    owner.promptComposerView?.remove();

    buildPromptComposer(owner, owner.materialView, { isSideStudio: false });
}

export function renderSidePromptComposer(owner, container, onClose) {
    container.replaceChildren();
    owner.promptPlanDraft ||= newDraft();
    const composer = buildPromptComposer(owner, container, {
        isSideStudio: true,
        onClose: () => {
            if (typeof onClose === 'function') onClose();
        },
    });
    owner.sidePromptComposerControl = composer;
    return composer;
}

export function appendPromptToStudio(owner, textSnippet, isPositive = true, noteTitle = '') {
    if (!textSnippet || !textSnippet.trim()) return;
    if (typeof owner.openSideStudio === 'function') {
        owner.openSideStudio();
    }
    const role = isPositive ? 'positive' : 'negative';
    const cat = isPositive ? categorizePromptSnippet(textSnippet) : 'base';
    const block = normalizeBlock({
        title: noteTitle || (window.anomalous_browser_lang === 'zh' ? '素材片段' : 'Material Snippet'),
        content: textSnippet.trim(),
        role,
        category: cat,
    });

    if (owner.sidePromptComposerControl?.addBlock) {
        owner.sidePromptComposerControl.addBlock(block);
    } else {
        owner.promptPlanDraft ||= newDraft();
        owner.promptPlanDraft.plan.parts ||= [];
        owner.promptPlanDraft.plan.parts.push(block);
        syncDraftSynthesizedText(owner.promptPlanDraft);
        if (!owner.promptPlanDraft.name?.trim() && noteTitle) owner.promptPlanDraft.name = noteTitle;
    }
}

export function addBlockToMixer(owner, blockData) {
    if (!blockData || !blockData.content?.trim()) return;
    if (typeof owner.openSideStudio === 'function') {
        owner.openSideStudio();
    }
    const block = normalizeBlock(blockData);
    if (owner.sidePromptComposerControl?.addBlock) {
        owner.sidePromptComposerControl.addBlock(block);
    } else {
        owner.promptPlanDraft ||= newDraft();
        owner.promptPlanDraft.plan.parts ||= [];
        owner.promptPlanDraft.plan.parts.push(block);
        syncDraftSynthesizedText(owner.promptPlanDraft);
    }
}

function buildPromptComposer(owner, container, options = {}) {
    const isSide = !!options.isSideStudio;
    const view = text(container, 'section', '', `anomalous-prompt-composer${isSide ? ' is-side-studio' : ''}`);
    if (isSide) owner.sidePromptComposerView = view;
    else owner.promptComposerView = view;

    let draft = owner.promptPlanDraft ||= newDraft();
    draft.plan ||= { parts: [], positive: '', negative: '' };
    draft.plan.parts ||= [];

    // Migrate existing text if parts are empty
    if (!draft.plan.parts.length) {
        if (draft.plan.positive?.trim()) {
            draft.plan.parts.push(normalizeBlock({
                title: window.anomalous_browser_lang === 'zh' ? '基础正向词' : 'Positive Base',
                content: draft.plan.positive,
                role: 'positive',
                category: categorizePromptSnippet(draft.plan.positive),
            }, 0));
        }
        if (draft.plan.negative?.trim()) {
            draft.plan.parts.push(normalizeBlock({
                title: window.anomalous_browser_lang === 'zh' ? '通用负向过滤' : 'Negative Filter',
                content: draft.plan.negative,
                role: 'negative',
                category: 'base',
            }, 1));
        }
        if (!draft.plan.parts.length) {
            draft.plan.parts.push(normalizeBlock({
                title: window.anomalous_browser_lang === 'zh' ? '画质底模词' : 'Quality Base',
                content: 'masterpiece, best quality, highly detailed, ultra-detailed, 8k, hdr',
                role: 'positive',
                category: 'base',
            }, 0));
        }
    }
    syncDraftSynthesizedText(draft);

    let activeTab = 'positive'; // 'positive' | 'negative' | 'all'
    let draggedBlockId = null;

    // 1. Topbar
    const topbar = text(view, 'div', '', 'anomalous-prompt-topbar');
    const topLeft = text(topbar, 'div', '', 'anomalous-prompt-topbar-left');
    if (!isSide) {
        const backBtn = text(topLeft, 'button', `← ${t('materialBackToLibrary')}`, 'anomalous-btn-ghost');
        backBtn.onclick = () => owner.showMaterials();
        text(topLeft, 'h3', window.anomalous_browser_lang === 'zh' ? '🎛️ 提示词乐高调音台' : '🎛️ Prompt Mixer Deck');
    } else {
        text(topLeft, 'h3', `🎛️ ${window.anomalous_browser_lang === 'zh' ? '提示词调音台' : 'Prompt Mixer'}`);
    }

    const topActions = text(topbar, 'div', '', 'anomalous-prompt-topbar-actions');
    const importBtn = text(topActions, 'button', `📥 ${t('promptImportFromMaterials')}`, 'anomalous-btn-ghost');
    importBtn.title = t('promptDrawerTitle');

    const newBtn = text(topActions, 'button', `✨ ${t('promptNewDraft')}`, 'anomalous-btn-ghost');
    const saveBtn = text(topActions, 'button', `💾 ${t('promptSavePlan')}`, 'anomalous-btn-primary');
    const exportBtn = text(topActions, 'button', `📤 ${t('promptExportPlan')}`, 'anomalous-btn-ghost');

    if (isSide && options.onClose) {
        const closeBtn = text(topActions, 'button', '✕', 'anomalous-btn-ghost');
        closeBtn.title = t('materialCollapseStudio') || '收起工坊';
        closeBtn.onclick = () => options.onClose();
    }

    // 2. Metadata strip (Name, Tags, Insert Position)
    const metaStrip = text(view, 'div', '', 'anomalous-prompt-meta-strip');
    const nameInput = text(metaStrip, 'input', '', 'anomalous-prompt-name-input');
    nameInput.placeholder = window.anomalous_browser_lang === 'zh' ? '方案名称（如：赛博朋克光影组合）...' : 'Mixer preset name...';
    nameInput.maxLength = 120;
    nameInput.value = draft.name || '';
    nameInput.oninput = () => { draft.name = nameInput.value; };

    const tagsInput = text(metaStrip, 'input', '', 'anomalous-prompt-tags-input');
    tagsInput.placeholder = t('materialTagsHint') || '标签，用逗号分隔';
    tagsInput.value = (draft.tags || []).join(', ');
    tagsInput.maxLength = 1200;
    tagsInput.oninput = () => {
        draft.tags = tagsInput.value.split(/[\s,，\n\r]+/).map(val => val.trim()).filter(Boolean);
    };

    const posWrap = text(metaStrip, 'label', '', 'anomalous-prompt-insert-pos');
    text(posWrap, 'span', `${t('promptInsertPosition')}:`);
    const posSelect = text(posWrap, 'select', '');
    for (const value of ['after', 'before']) {
        text(posSelect, 'option', t(`promptInsert_${value}`)).value = value;
    }
    posSelect.value = owner.promptInsertPosition || 'after';
    posSelect.onchange = () => {
        owner.promptInsertPosition = posSelect.value;
        renderTargetBar();
    };

    // 3. Mixer Controls Bar (Tabs & Smart Sort)
    const mixerControls = text(view, 'div', '', 'anomalous-mixer-controls');
    const tabsWrapper = text(mixerControls, 'div', '', 'anomalous-mixer-tabs');

    const actionWrapper = text(mixerControls, 'div', '', 'anomalous-mixer-actions');
    const smartSortBtn = text(actionWrapper, 'button', window.anomalous_browser_lang === 'zh' ? '🪄 智能理顺' : '🪄 Smart Sort', 'anomalous-mixer-smart-sort-btn');
    smartSortBtn.title = window.anomalous_browser_lang === 'zh' ? '根据词性智能理顺：[通用底模 ➔ 风格氛围 ➔ 主体内容 ➔ LoRA/触发词]' : 'Smart sort: [Base Quality ➔ Style ➔ Subject ➔ LoRA/Trigger]';

    const addBlockBtn = text(actionWrapper, 'button', `➕ ${window.anomalous_browser_lang === 'zh' ? '添加词块' : 'Add Block'}`, 'anomalous-btn-ghost');
    const clearBlocksBtn = text(actionWrapper, 'button', '🧹', 'anomalous-btn-ghost');
    clearBlocksBtn.title = window.anomalous_browser_lang === 'zh' ? '清空当前分类词块' : 'Clear current blocks';

    // 4. Blocks Container
    const blocksContainer = text(view, 'div', '', 'anomalous-mixer-blocks-container');

    // 5. Output Preview & Node Target Injection Bar
    const outputDeck = text(view, 'div', '', 'anomalous-mixer-deck-output');
    const outputHeader = text(outputDeck, 'div', '', 'anomalous-mixer-output-header');
    const outputTitle = text(outputHeader, 'div', '', 'anomalous-mixer-output-title');
    const outputStats = text(outputHeader, 'div', '', 'anomalous-mixer-output-stats');

    const outputBody = text(outputDeck, 'div', '', 'anomalous-mixer-output-body');
    const outputTextarea = text(outputBody, 'textarea', '', 'anomalous-mixer-output-textarea');
    outputTextarea.readOnly = true;
    outputTextarea.rows = isSide ? 3 : 4;

    const outputFooter = text(outputDeck, 'div', '', 'anomalous-mixer-output-footer');
    const dragHint = text(outputFooter, 'div', '', 'anomalous-mixer-drag-hint');
    dragHint.innerHTML = `🖐️ <strong>${window.anomalous_browser_lang === 'zh' ? '拖动此调音坞' : 'Drag this deck'}</strong> ${window.anomalous_browser_lang === 'zh' ? '直达 ComfyUI 画布节点' : 'onto canvas node'}`;

    const outputActions = text(outputFooter, 'div', '', 'anomalous-mixer-output-actions');
    const copyOutputBtn = text(outputActions, 'button', `📋 ${t('copy')}`, 'anomalous-btn-ghost');

    // Target node direct injection bar
    const targetBar = text(view, 'div', '', 'anomalous-prompt-target-bar');

    // Render logic functions
    function updateTabsUI() {
        tabsWrapper.replaceChildren();
        const posCount = draft.plan.parts.filter(p => p.role === 'positive').length;
        const negCount = draft.plan.parts.filter(p => p.role === 'negative').length;
        const allCount = draft.plan.parts.length;

        const tabs = [
            { key: 'positive', label: `✨ ${window.anomalous_browser_lang === 'zh' ? '正向调音坞' : 'Positive'} (${posCount})` },
            { key: 'negative', label: `🚫 ${window.anomalous_browser_lang === 'zh' ? '负向调音坞' : 'Negative'} (${negCount})` },
            { key: 'all', label: `👁️ ${window.anomalous_browser_lang === 'zh' ? '全部词块' : 'All'} (${allCount})` },
        ];

        for (const tab of tabs) {
            const btn = text(tabsWrapper, 'button', tab.label, `anomalous-mixer-tab-btn${activeTab === tab.key ? ' is-active' : ''}`);
            btn.onclick = () => {
                activeTab = tab.key;
                updateTabsUI();
                renderBlocksList();
                updateOutputPreview();
            };
        }
    }

    function renderBlocksList() {
        blocksContainer.replaceChildren();
        const parts = draft.plan.parts.filter(p => activeTab === 'all' || p.role === activeTab);

        if (!parts.length) {
            const emptyNotice = text(blocksContainer, 'div', '', 'anomalous-mixer-empty-notice');
            emptyNotice.innerHTML = `
                <div style="font-size: 24px; margin-bottom: 8px;">🧩</div>
                <div style="font-weight: 600; color: #94a3b8;">${window.anomalous_browser_lang === 'zh' ? '当前分类暂无提示词块' : 'No prompt blocks in this category'}</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${window.anomalous_browser_lang === 'zh' ? '点击右上角“添加词块”或在素材库点击“🎛️ 调音台”送入积木' : 'Click "Add Block" or pick from Materials to dock snippets.'}</div>
            `;
            return;
        }

        parts.forEach((block, index) => {
            const blockEl = text(blocksContainer, 'article', '', `anomalous-mixer-block${!block.enabled ? ' is-bypassed' : ''} is-role-${block.role}`);
            blockEl.setAttribute('draggable', 'true');
            blockEl.dataset.blockId = block.id;

            // Drag & Drop Reordering handlers
            blockEl.ondragstart = (e) => {
                draggedBlockId = block.id;
                blockEl.classList.add('is-dragging');
                e.dataTransfer.setData('text/plain', block.content);
                e.dataTransfer.effectAllowed = 'move';
            };

            blockEl.ondragend = () => {
                draggedBlockId = null;
                blockEl.classList.remove('is-dragging');
                blocksContainer.querySelectorAll('.anomalous-mixer-block').forEach(el => {
                    el.classList.remove('is-drag-over-top', 'is-drag-over-bottom');
                });
            };

            blockEl.ondragover = (e) => {
                e.preventDefault();
                if (!draggedBlockId || draggedBlockId === block.id) return;
                const rect = blockEl.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                if (e.clientY < mid) {
                    blockEl.classList.add('is-drag-over-top');
                    blockEl.classList.remove('is-drag-over-bottom');
                } else {
                    blockEl.classList.add('is-drag-over-bottom');
                    blockEl.classList.remove('is-drag-over-top');
                }
            };

            blockEl.ondragleave = () => {
                blockEl.classList.remove('is-drag-over-top', 'is-drag-over-bottom');
            };

            blockEl.ondrop = (e) => {
                e.preventDefault();
                blockEl.classList.remove('is-drag-over-top', 'is-drag-over-bottom');
                if (!draggedBlockId || draggedBlockId === block.id) return;

                const fromIndex = draft.plan.parts.findIndex(p => p.id === draggedBlockId);
                const toIndex = draft.plan.parts.findIndex(p => p.id === block.id);
                if (fromIndex < 0 || toIndex < 0) return;

                const [moved] = draft.plan.parts.splice(fromIndex, 1);
                const rect = blockEl.getBoundingClientRect();
                const insertAfter = e.clientY >= (rect.top + rect.height / 2);
                const finalIndex = insertAfter ? (toIndex > fromIndex ? toIndex : toIndex + 1) : (toIndex > fromIndex ? toIndex - 1 : toIndex);

                draft.plan.parts.splice(finalIndex, 0, moved);
                syncDraftSynthesizedText(draft);
                renderBlocksList();
                updateOutputPreview();
            };

            // Block Header
            const blockHeader = text(blockEl, 'div', '', 'anomalous-mixer-block-header');
            const headerLeft = text(blockHeader, 'div', '', 'anomalous-mixer-block-header-left');

            // Drag handle
            const dragHandle = text(headerLeft, 'span', '⠿', 'anomalous-mixer-drag-handle');
            dragHandle.title = window.anomalous_browser_lang === 'zh' ? '抓取按住上下拖拽排序' : 'Drag to reorder';

            // Toggle Checkbox (A/B testing switch)
            const toggleWrap = text(headerLeft, 'label', '', 'anomalous-mixer-block-toggle');
            const checkbox = text(toggleWrap, 'input', '');
            checkbox.type = 'checkbox';
            checkbox.checked = !!block.enabled;
            checkbox.onchange = () => {
                block.enabled = checkbox.checked;
                blockEl.classList.toggle('is-bypassed', !block.enabled);
                syncDraftSynthesizedText(draft);
                updateOutputPreview();
            };

            // Category Badge
            const catMeta = CATEGORY_META[block.category] || CATEGORY_META.subject;
            const catBadge = text(headerLeft, 'span', window.anomalous_browser_lang === 'zh' ? catMeta.zh : catMeta.en, 'anomalous-mixer-cat-badge');
            catBadge.style.color = catMeta.color;
            catBadge.style.backgroundColor = catMeta.bg;
            catBadge.style.borderColor = catMeta.border;
            catBadge.title = window.anomalous_browser_lang === 'zh' ? '点击切换词块类型（通用底模/风格/主体/LoRA触发词）' : 'Click to cycle category';
            catBadge.onclick = () => {
                const cats = ['base', 'style', 'subject', 'trigger'];
                const nextIdx = (cats.indexOf(block.category) + 1) % cats.length;
                block.category = cats[nextIdx];
                renderBlocksList();
            };

            // Title input
            const titleInput = text(headerLeft, 'input', '', 'anomalous-mixer-block-title-input');
            titleInput.value = block.title || '';
            titleInput.placeholder = window.anomalous_browser_lang === 'zh' ? '词块标题...' : 'Block title...';
            titleInput.oninput = () => { block.title = titleInput.value; };

            // Header Right Actions
            const headerRight = text(blockHeader, 'div', '', 'anomalous-mixer-block-header-right');

            // Move Up/Down Micro-buttons
            const upBtn = text(headerRight, 'button', '▲', 'anomalous-mixer-block-btn');
            upBtn.title = window.anomalous_browser_lang === 'zh' ? '上移' : 'Move up';
            upBtn.disabled = index === 0;
            upBtn.onclick = () => {
                const realIdx = draft.plan.parts.findIndex(p => p.id === block.id);
                if (realIdx > 0) {
                    const temp = draft.plan.parts[realIdx];
                    draft.plan.parts[realIdx] = draft.plan.parts[realIdx - 1];
                    draft.plan.parts[realIdx - 1] = temp;
                    syncDraftSynthesizedText(draft);
                    renderBlocksList();
                    updateOutputPreview();
                }
            };

            const downBtn = text(headerRight, 'button', '▼', 'anomalous-mixer-block-btn');
            downBtn.title = window.anomalous_browser_lang === 'zh' ? '下移' : 'Move down';
            downBtn.disabled = index === parts.length - 1;
            downBtn.onclick = () => {
                const realIdx = draft.plan.parts.findIndex(p => p.id === block.id);
                if (realIdx < draft.plan.parts.length - 1) {
                    const temp = draft.plan.parts[realIdx];
                    draft.plan.parts[realIdx] = draft.plan.parts[realIdx + 1];
                    draft.plan.parts[realIdx + 1] = temp;
                    syncDraftSynthesizedText(draft);
                    renderBlocksList();
                    updateOutputPreview();
                }
            };

            // Copy block content
            const copyBtn = text(headerRight, 'button', '📋', 'anomalous-mixer-block-btn');
            copyBtn.title = window.anomalous_browser_lang === 'zh' ? '复制本块' : 'Copy block';
            copyBtn.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(block.content);
                    copyBtn.textContent = '✅';
                    setTimeout(() => { if (copyBtn.isConnected) copyBtn.textContent = '📋'; }, 1200);
                } catch (e) {
                    await anomalousAlert(t('materialCopyError'));
                }
            };

            // Delete block
            const delBtn = text(headerRight, 'button', '✕', 'anomalous-mixer-block-btn is-delete');
            delBtn.title = window.anomalous_browser_lang === 'zh' ? '删除词块' : 'Delete block';
            delBtn.onclick = () => {
                const realIdx = draft.plan.parts.findIndex(p => p.id === block.id);
                if (realIdx >= 0) {
                    draft.plan.parts.splice(realIdx, 1);
                    syncDraftSynthesizedText(draft);
                    updateTabsUI();
                    renderBlocksList();
                    updateOutputPreview();
                }
            };

            // Block Body (Textarea)
            const blockBody = text(blockEl, 'div', '', 'anomalous-mixer-block-body');
            const textarea = text(blockBody, 'textarea', '', 'anomalous-mixer-block-textarea');
            textarea.value = block.content || '';
            textarea.placeholder = block.role === 'positive'
                ? (window.anomalous_browser_lang === 'zh' ? '输入正面提示词，支持英文短语、权重与 LoRA...' : 'Enter positive prompts, tags, weights...')
                : (window.anomalous_browser_lang === 'zh' ? '输入负面过滤词，如 low quality, bad hands...' : 'Enter negative prompts...');
            textarea.rows = isSide ? 3 : 2;

            textarea.oninput = () => {
                block.content = textarea.value;
                syncDraftSynthesizedText(draft);
                updateOutputPreview();
            };
        });
    }

    function updateOutputPreview() {
        syncDraftSynthesizedText(draft);
        const role = activeTab === 'negative' ? 'negative' : 'positive';
        const compiledText = draft.plan[role] || '';

        outputTitle.innerHTML = activeTab === 'negative'
            ? `🚫 <strong>${window.anomalous_browser_lang === 'zh' ? '合成负向文本' : 'Assembled Negative'}</strong>`
            : `✨ <strong>${window.anomalous_browser_lang === 'zh' ? '合成正向文本' : 'Assembled Positive'}</strong>`;

        const words = compiledText.trim() ? compiledText.split(/[\s,，\n\r]+/).filter(Boolean).length : 0;
        outputStats.textContent = window.anomalous_browser_lang === 'zh'
            ? `${compiledText.length} 字符 · 约 ${words} 个词组`
            : `${compiledText.length} chars · ~${words} tags`;

        outputTextarea.value = compiledText;

        // Bind Whole Deck Drag directly to canvas node
        bindMaterialDrag(outputDeck, owner, {
            payload: () => compiledText.trim() ? {
                content: compiledText,
                position: posSelect.value,
                dragHint: role === 'positive'
                    ? (window.anomalous_browser_lang === 'zh' ? '✨ 拖拽合成正面词至画布节点' : '✨ Drag Assembled Positive onto Node')
                    : (window.anomalous_browser_lang === 'zh' ? '🚫 拖拽合成负面词至画布节点' : '🚫 Drag Assembled Negative onto Node'),
            } : null,
            accepts: node => promptWidgetTargets(node).length > 0,
            drop: (node, data, graph) => applyPromptDrop(node, data, graph, targetBar),
        });

        renderTargetBar();
    }

    // Smart Sort Execution
    smartSortBtn.onclick = () => {
        if (!draft.plan.parts.length) return;
        const targetRole = activeTab === 'all' ? null : activeTab;

        if (targetRole) {
            const roleParts = draft.plan.parts.filter(p => p.role === targetRole);
            const otherParts = draft.plan.parts.filter(p => p.role !== targetRole);
            const sorted = smartSortPromptBlocks(roleParts, targetRole);
            draft.plan.parts = [...sorted, ...otherParts];
        } else {
            const pos = smartSortPromptBlocks(draft.plan.parts.filter(p => p.role === 'positive'), 'positive');
            const neg = smartSortPromptBlocks(draft.plan.parts.filter(p => p.role === 'negative'), 'negative');
            draft.plan.parts = [...pos, ...neg];
        }

        syncDraftSynthesizedText(draft);
        renderBlocksList();
        updateOutputPreview();

        // Visual feedback
        smartSortBtn.classList.add('is-animating');
        setTimeout(() => smartSortBtn.classList.remove('is-animating'), 600);
    };

    // Add new blank block
    addBlockBtn.onclick = () => {
        const role = activeTab === 'negative' ? 'negative' : 'positive';
        const newBlock = normalizeBlock({
            title: window.anomalous_browser_lang === 'zh' ? (role === 'positive' ? '新建词块' : '新建负向块') : 'New Block',
            content: '',
            role,
            category: role === 'positive' ? 'subject' : 'base',
        }, draft.plan.parts.length);
        draft.plan.parts.push(newBlock);
        syncDraftSynthesizedText(draft);
        updateTabsUI();
        renderBlocksList();
        updateOutputPreview();
    };

    // Clear blocks
    clearBlocksBtn.onclick = async () => {
        const msg = activeTab === 'all'
            ? (window.anomalous_browser_lang === 'zh' ? '确定清空调音台内的全部词块吗？' : 'Clear all blocks in mixer?')
            : (window.anomalous_browser_lang === 'zh' ? `确定清空当前【${activeTab === 'positive' ? '正向' : '负向'}】词块吗？` : `Clear ${activeTab} blocks?`);

        if (await anomalousConfirm(msg)) {
            if (activeTab === 'all') {
                draft.plan.parts = [];
            } else {
                draft.plan.parts = draft.plan.parts.filter(p => p.role !== activeTab);
            }
            syncDraftSynthesizedText(draft);
            updateTabsUI();
            renderBlocksList();
            updateOutputPreview();
        }
    };

    // Copy Output
    copyOutputBtn.onclick = async () => {
        const textToCopy = outputTextarea.value;
        if (!textToCopy) return;
        try {
            await navigator.clipboard.writeText(textToCopy);
            copyOutputBtn.textContent = '✅ 已复制';
            setTimeout(() => { if (copyOutputBtn.isConnected) copyOutputBtn.textContent = `📋 ${t('copy')}`; }, 1500);
        } catch (err) {
            await anomalousAlert(t('materialCopyError'));
        }
    };

    // 6. Target Node Bar & Direct Application
    const renderTargetBar = () => {
        if (!view.isConnected) return;
        targetBar.replaceChildren();
        const node = selectedMaterialNode(app);
        const targets = promptWidgetTargets(node);

        if (!node || !targets.length) {
            text(targetBar, 'span', `💡 ${t('promptSelectTextNode')}`, 'anomalous-prompt-target-info');
            return;
        }

        const info = text(targetBar, 'div', '', 'anomalous-prompt-target-info');
        info.textContent = `🎯 ${t('materialApplyingTo', { name: materialNodeHeading(node), id: node.id })}`;

        const actions = text(targetBar, 'div', '', 'anomalous-prompt-target-actions');
        const widgetSelect = text(actions, 'select', '');
        widgetSelect.setAttribute('aria-label', t('promptTargetWidget'));
        for (const target of targets) {
            text(widgetSelect, 'option', target.name).value = String(target.index);
        }

        const applyRole = (role, label) => {
            const btn = text(actions, 'button', label, 'anomalous-btn-primary');
            btn.type = 'button';
            btn.onclick = async () => {
                try {
                    if (selectedMaterialNode(app) !== node) throw new Error('materialTargetChanged');
                    const index = Number(widgetSelect.value);
                    if (!promptWidgetTargets(node).some(t => t.index === index)) throw new Error('materialTargetChanged');
                    const content = draft.plan[role];
                    if (!content || !content.trim()) return;
                    const value = joinPromptText(node.widgets[index].value, content, posSelect.value);
                    showMaterialApplication(targetBar, applyNodeMaterialValues(app, node, [{ index, value }]), node);
                } catch (error) {
                    await anomalousAlert(t(error.message) === error.message ? t('materialApplyFailed') : t(error.message));
                }
            };
        };

        applyRole('positive', `${window.anomalous_browser_lang === 'zh' ? '写入正面' : 'Write Pos'} (${t(`promptInsert_${posSelect.value}`)})`);
        applyRole('negative', `${window.anomalous_browser_lang === 'zh' ? '写入负面' : 'Write Neg'} (${t(`promptInsert_${posSelect.value}`)})`);
    };

    if (isSide) owner.refreshSidePromptTarget = renderTargetBar;
    else owner.refreshPromptTarget = renderTargetBar;

    // Drawer Integration
    importBtn.onclick = () => {
        openMaterialImportDrawer(owner, draft, () => {
            syncDraftSynthesizedText(draft);
            updateTabsUI();
            renderBlocksList();
            updateOutputPreview();
        });
    };

    // Save Plan
    saveBtn.onclick = async () => {
        if (!draft.name.trim()) {
            nameInput.focus();
            return;
        }
        saveBtn.disabled = true;
        syncDraftSynthesizedText(draft);
        const body = {
            name: draft.name.trim(),
            tags: draft.tags || [],
            plan: {
                parts: draft.plan.parts.map(p => ({
                    name: p.title || '',
                    positive: p.role === 'positive' ? p.content : '',
                    negative: p.role === 'negative' ? p.content : '',
                    category: p.category || 'general',
                    enabled: p.enabled !== false,
                })),
                positive: draft.plan.positive || '',
                negative: draft.plan.negative || '',
            },
        };

        const send = () => fetch('/anomalous/save_prompt_plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        try {
            let response = await send();
            if (response.status === 409) {
                const duplicate = await response.json();
                if (!await anomalousConfirm(t('materialDuplicateConfirm', { name: duplicate.name }))) return;
                body.allow_duplicate = true;
                response = await send();
            }
            const payload = await jsonResponse(response, 'prompt save failed');
            if (payload.status !== 'success') throw new Error('prompt save failed');
            showMaterialSaved(owner, payload.material);
        } catch (error) {
            await anomalousAlert(t('materialSaveError'));
        } finally {
            saveBtn.disabled = false;
        }
    };

    // Export Plan JSON
    exportBtn.onclick = () => {
        if (!draft.name.trim()) {
            nameInput.focus();
            return;
        }
        syncDraftSynthesizedText(draft);
        const exportData = {
            format: 'anomalous-prompt-mixer-v2',
            name: draft.name,
            tags: draft.tags,
            plan: draft.plan,
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        if (blob.size > 2 * 1024 * 1024 || draft.tags.length > 20 || draft.tags.some(tag => tag.length > 60)) {
            return anomalousAlert(t('promptExportError'));
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${draft.name || 'prompt-mixer-preset'}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    // New Draft
    newBtn.onclick = async () => {
        if (await anomalousConfirm(t('promptReplaceDraft'))) {
            owner.closePromptImportDrawer?.();
            owner.promptPlanDraft = draft = newDraft();
            if (!isSide) {
                showPromptComposer(owner);
            } else {
                updateTabsUI();
                renderBlocksList();
                updateOutputPreview();
                nameInput.value = '';
                tagsInput.value = '';
            }
        }
    };

    // Initial render
    updateTabsUI();
    renderBlocksList();
    updateOutputPreview();

    return {
        updateAll: () => {
            updateTabsUI();
            renderBlocksList();
            updateOutputPreview();
        },
        addBlock: (blockData) => {
            const block = normalizeBlock(blockData, draft.plan.parts.length);
            draft.plan.parts.push(block);
            syncDraftSynthesizedText(draft);
            if (block.role !== activeTab && activeTab !== 'all') {
                activeTab = block.role;
            }
            updateTabsUI();
            renderBlocksList();
            updateOutputPreview();
        },
    };
}

function applyPromptDrop(node, data, graph, parent) {
    const targets = promptWidgetTargets(node);
    const apply = index => {
        if (app.graph !== graph || graph.getNodeById(node.id) !== node || !promptWidgetTargets(node).some(target => target.index === index)) {
            throw new Error('materialTargetChanged');
        }
        const value = joinPromptText(node.widgets[index].value, data.content, data.position);
        showMaterialApplication(parent, applyNodeMaterialValues(app, node, [{ index, value }]), node);
    };
    if (targets.length === 1) {
        apply(targets[0].index);
        return;
    }
    if (!targets.length) throw new Error('materialNoCompatibleValues');

    const dialog = text(document.body, 'dialog', '', 'anomalous-material-choice');
    text(dialog, 'h3', t('promptChooseTarget'));
    const status = text(dialog, 'p', '');
    status.setAttribute('role', 'alert');
    for (const target of targets) {
        const choose = text(dialog, 'button', target.name, 'anomalous-btn-primary');
        choose.onclick = () => {
            try {
                apply(target.index);
                dialog.close();
            } catch (error) {
                status.textContent = t(error.message) === error.message ? t('materialApplyFailed') : t(error.message);
            }
        };
    }
    const close = text(dialog, 'button', t('close'), 'anomalous-btn-ghost');
    close.onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove();
    dialog.showModal();
}

/**
 * Slide-out Drawer: Quick Prompt Importer from Material Library
 */
async function openMaterialImportDrawer(owner, draft, onUpdated) {
    owner.closePromptImportDrawer?.();
    const drawer = text(document.body, 'div', '', 'anomalous-prompt-import-drawer');
    const header = text(drawer, 'div', '', 'anomalous-drawer-header');
    text(header, 'h4', `📥 ${t('promptDrawerTitle')}`);
    let controller, timer;
    const close = () => {
        controller?.abort(); clearTimeout(timer); drawer.remove();
        window.removeEventListener('keydown', onKeydown);
        if (owner.closePromptImportDrawer === close) owner.closePromptImportDrawer = null;
    };
    const onKeydown = event => { if (event.key === 'Escape') close(); };
    owner.closePromptImportDrawer = close;
    window.addEventListener('keydown', onKeydown);
    text(header, 'button', '✕', 'anomalous-paper-note-btn').onclick = close;
    const search = text(text(drawer, 'div', '', 'anomalous-drawer-search'), 'input', '');
    search.type = 'search'; search.placeholder = t('promptDrawerSearchPlaceholder');
    const list = text(drawer, 'div', '', 'anomalous-drawer-list');
    const pager = text(drawer, 'div', '', 'anomalous-prompt-actions');

    const load = async (page = 1) => {
        controller?.abort(); controller = new AbortController(); const current = controller;
        list.replaceChildren(); pager.replaceChildren(); text(list, 'p', t('loading'));
        try {
            const query = new URLSearchParams({ category: 'prompts', q: search.value, page, limit: 48 });
            const response = await fetch(`/anomalous/materials?${query}`, { signal: current.signal });
            const payload = await jsonResponse(response, 'material list failed');
            if (current.signal.aborted || !drawer.isConnected) return;
            list.replaceChildren();
            if (!payload.materials?.length) text(list, 'p', t('materialNoMatches'));
            for (const item of payload.materials || []) {
                const card = text(list, 'div', '', 'anomalous-drawer-item');
                text(card, 'strong', item.name || t('materialUntitled'));
                text(card, 'small', (item.tags || []).join(' · '));
                const inspect = text(card, 'button', t('materialViewDetails'), 'anomalous-drawer-item-btn');
                inspect.onclick = async () => {
                    inspect.disabled = true;
                    try {
                        const prompts = await loadMaterialPrompts(item.filename, current.signal);
                        if (current.signal.aborted || !card.isConnected) return;
                        if (!prompts.positive && !prompts.negative) {
                            inspect.textContent = t('materialNoPromptContent'); inspect.disabled = false; return;
                        }
                        for (const role of ['positive', 'negative']) {
                            if (!prompts[role]) continue;
                            text(card, 'strong', t(`promptFinal_${role}`));
                            text(card, 'pre', prompts[role], 'anomalous-material-note-text');
                            const append = text(card, 'button', `➕ ${window.anomalous_browser_lang === 'zh' ? '入坞词块' : 'Add Block'}`, 'anomalous-drawer-item-btn');
                            append.onclick = () => {
                                draft.plan.parts.push(normalizeBlock({
                                    title: item.name || (role === 'positive' ? '正向词块' : '负向词块'),
                                    content: prompts[role],
                                    role,
                                    category: role === 'positive' ? categorizePromptSnippet(prompts[role]) : 'base',
                                }, draft.plan.parts.length));
                                onUpdated();
                            };
                        }
                        const whole = text(card, 'button', `🎛️ ${window.anomalous_browser_lang === 'zh' ? '全部入坞' : 'Add Both to Mixer'}`, 'anomalous-drawer-item-btn');
                        whole.onclick = () => {
                            if (prompts.positive) {
                                draft.plan.parts.push(normalizeBlock({
                                    title: `${item.name} (Pos)`,
                                    content: prompts.positive,
                                    role: 'positive',
                                    category: categorizePromptSnippet(prompts.positive),
                                }, draft.plan.parts.length));
                            }
                            if (prompts.negative) {
                                draft.plan.parts.push(normalizeBlock({
                                    title: `${item.name} (Neg)`,
                                    content: prompts.negative,
                                    role: 'negative',
                                    category: 'base',
                                }, draft.plan.parts.length));
                            }
                            if (!draft.name.trim()) draft.name = item.name;
                            draft.tags = [...new Set([...draft.tags, ...(item.tags || [])])].slice(0, 20);
                            onUpdated();
                        };
                        inspect.remove();
                    } catch (error) { if (error.name !== 'AbortError') { inspect.textContent = t('materialDetailLoadError'); inspect.disabled = false; } }
                };
            }
            const previous = text(pager, 'button', t('materialPrevious'), 'anomalous-btn-ghost');
            previous.disabled = payload.page <= 1; previous.onclick = () => load(payload.page - 1);
            text(pager, 'span', t('materialPageSummary', { page: payload.page, pages: payload.pages, count: payload.total }));
            const next = text(pager, 'button', t('materialNext'), 'anomalous-btn-ghost');
            next.disabled = payload.page >= payload.pages; next.onclick = () => load(payload.page + 1);
        } catch (error) { if (!current.signal.aborted) { list.replaceChildren(); text(list, 'p', t('materialLoadError')); } }
    };
    search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => load(), 250); };
    await load(); search.focus();
}
