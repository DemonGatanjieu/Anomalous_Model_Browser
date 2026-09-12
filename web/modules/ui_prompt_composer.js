import { loadMaterialPrompts } from './material_prompt_data.js';
import { bindMaterialDrag } from './material_drag.js';
import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { text, jsonResponse, materialNodeHeading } from './material_inspector.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { composePromptPlan, joinPromptText, categorizePromptSnippet, smartSortPromptBlocks, assemblePromptBlocks, planToWorkbenchDraft, workbenchDraftToSavedPlan } from './prompt_composition.js';
import { applyNodeMaterialValues, promptWidgetTargets, selectedMaterialNode } from './node_material_actions.js';
import { showMaterialApplication } from './ui_material_application.js';
import { showMaterialSaved } from './material_feedback.js';

const clone = value => JSON.parse(JSON.stringify(value));
const newDraft = () => ({
    name: '',
    tags: [],
    plan: {
        version: 2,
        parts: [],
        positive: '',
        negative: '',
    },
});

export const CATEGORY_META = {
    base: { zh: '通用底模', en: 'Base Quality', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.4)' },
    style: { zh: '风格氛围', en: 'Art Style', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.15)', border: 'rgba(192, 132, 252, 0.4)' },
    subject: { zh: '主体内容', en: 'Subject', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.15)', border: 'rgba(74, 222, 128, 0.4)' },
    trigger: { zh: 'LoRA/触发', en: 'LoRA / Trigger', color: '#fb923c', bg: 'rgba(251, 146, 60, 0.15)', border: 'rgba(251, 146, 60, 0.4)' },
};

// Built-in starter prompt cards for left source deck
const STARTER_SOURCE_PROMPTS = [
    {
        id: 'preset_base_quality',
        title: '画质底模词 (Quality Base)',
        content: 'masterpiece, best quality, highly detailed, ultra-detailed, 8k, hdr, absurdres',
        role: 'positive',
        category: 'base',
    },
    {
        id: 'preset_real_detail',
        title: '写实与材质增强 (Realistic Detail)',
        content: 'highres, realistic skin texture, sharp focus, subsurface scattering, 35mm photograph',
        role: 'positive',
        category: 'base',
    },
    {
        id: 'preset_cinematic_light',
        title: '电影胶片光影 (Cinematic Lighting)',
        content: 'cinematic lighting, dramatic shadows, soft volumetric glow, ray tracing, atmospheric',
        role: 'positive',
        category: 'style',
    },
    {
        id: 'preset_anime_cyber',
        title: '赛博霓虹风 (Cyberpunk Neon)',
        content: 'anime style, cyberpunk aesthetic, vibrant neon reflections, futuristic metropolis backdrop',
        role: 'positive',
        category: 'style',
    },
    {
        id: 'preset_girl_face',
        title: '美少女面部特写 (Portrait 1girl)',
        content: '1girl, beautiful detailed expressive eyes, smile, delicate face, soft wind-blown hair',
        role: 'positive',
        category: 'subject',
    },
    {
        id: 'preset_neg_filter',
        title: '通用负向过滤词 (Negative Base Filter)',
        content: 'worst quality, low quality, normal quality, lowres, bad anatomy, bad hands, missing fingers, extra digits, cropped, blurry, watermark',
        role: 'negative',
        category: 'base',
    },
];

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

export async function openPromptStudio(owner = this) {
    owner.closePromptImportDrawer?.();
    owner.recipeDetailFinish?.('closed');
    owner.modal?.classList.add('visible');
    if (owner.nbPanel?.style.display !== 'flex' && !owner.workspaceReturnState) {
        owner.workspaceReturnState = Object.fromEntries([
            ['grid', owner.grid], ['detail', owner.detailPanel], ['gallery', owner.galleryPanel],
            ['doctor', owner.doctorPanel], ['assistant', owner.assistantPanel],
        ].filter(([, panel]) => panel).map(([key, panel]) => [key, panel.style.display]));
    }
    if (owner.nbPanel) owner.nbPanel.style.display = 'flex';
    for (const panel of [owner.grid, owner.detailPanel, owner.galleryPanel, owner.doctorPanel, owner.assistantPanel, owner.paramPanel]) {
        if (panel) panel.style.display = 'none';
    }
    if (owner.notebookContainer) owner.notebookContainer.style.display = 'none';
    if (owner.notebookBody) owner.notebookBody.style.display = 'none';
    if (owner.recipeView) owner.recipeView.style.display = 'none';
    if (owner.materialContainer) owner.materialContainer.style.display = 'none';
    if (owner.materialView) owner.materialView.style.display = 'none';

    if (!owner.promptStudioContainer) {
        owner.promptStudioContainer = text(owner.nbPanel, 'div', '', 'anomalous-nb-container anomalous-prompt-studio-container');
    }
    owner.promptStudioContainer.style.display = 'flex';
    owner.promptStudioContainer.replaceChildren();

    owner.promptComposerView?.remove();
    owner.promptComposerView = null;

    buildPromptComposer(owner, owner.promptStudioContainer, {
        isSideStudio: false,
        onClose: () => owner.closeWorkspace?.(),
    });
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
            if (controller.signal.aborted) return;
            if (payload.data?.kind !== 'prompt_plan') throw new Error('invalid plan');
            const draft = planToWorkbenchDraft(payload.data.plan || {}, payload.data.name || '');
            draft.tags = payload.data.tags || [];
            owner.promptPlanDraft = draft;
        } catch (error) {
            if (error.name !== 'AbortError') await anomalousAlert(t('materialDetailLoadError'));
            return;
        } finally {
            if (owner.materialDetailController === controller) owner.materialDetailController = null;
        }
    }

    owner.promptPlanDraft ||= newDraft();
    await openPromptStudio(owner);
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
    } else if (owner.workbenchComposerControl?.addBlock) {
        owner.workbenchComposerControl.addBlock(block);
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
    const block = normalizeBlock(blockData);
    if (owner.sidePromptComposerControl?.addBlock) {
        owner.sidePromptComposerControl.addBlock(block);
    } else if (owner.workbenchComposerControl?.addBlock) {
        owner.workbenchComposerControl.addBlock(block);
    } else {
        owner.promptPlanDraft ||= newDraft();
        owner.promptPlanDraft.plan.parts ||= [];
        owner.promptPlanDraft.plan.parts.push(block);
        syncDraftSynthesizedText(owner.promptPlanDraft);
    }
}

function showWorkbenchToast(message) {
    const toast = document.createElement('div');
    toast.className = 'anomalous-mixer-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('is-show'), 10);
    setTimeout(() => {
        toast.classList.remove('is-show');
        setTimeout(() => toast.remove(), 300);
    }, 2400);
}

function buildPromptComposer(owner, container, options = {}) {
    const isSide = !!options.isSideStudio;
    const view = text(container, 'section', '', `anomalous-prompt-composer anomalous-prompt-workbench${isSide ? ' is-side-studio' : ''}`);
    if (isSide) owner.sidePromptComposerView = view;
    else owner.promptComposerView = view;

    let draft = owner.promptPlanDraft ||= newDraft();
    draft.plan ||= { version: 2, parts: [], positive: '', negative: '' };
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
    }
    syncDraftSynthesizedText(draft);

    let activeTab = 'positive'; // 'positive' | 'negative'
    let sourceFilterCategory = 'all';
    let sourceFilterKeyword = '';
    let draggedBlockId = null;
    let isOutputExpanded = false;

    // Local in-memory source prompt cards (merged starters + materials + user custom)
    let sourceCards = [...STARTER_SOURCE_PROMPTS];
    let isCreatingNewCard = false;

    // 1. Studio Topbar (Streamlined with inline preset name input)
    const topbar = text(view, 'header', '', 'anomalous-prompt-topbar');
    const topLeft = text(topbar, 'div', '', 'anomalous-prompt-topbar-left');
    text(topLeft, 'h3', window.anomalous_browser_lang === 'zh' ? '🎛️ 提示词工坊' : '🎛️ Prompt Studio');

    // Inline Preset Name Input
    const nameInput = text(topLeft, 'input', '', 'anomalous-prompt-name-input');
    nameInput.placeholder = window.anomalous_browser_lang === 'zh' ? '方案名称...' : 'Preset name...';
    nameInput.title = window.anomalous_browser_lang === 'zh' ? '输入组合方案名称' : 'Enter preset name';
    nameInput.maxLength = 120;
    nameInput.value = draft.name || '';
    nameInput.oninput = () => { draft.name = nameInput.value; };

    const topActions = text(topbar, 'div', '', 'anomalous-prompt-topbar-actions');
    const saveBtn = text(topActions, 'button', `💾 ${t('promptSavePlan')}`, 'anomalous-btn-primary anomalous-btn-sm');
    saveBtn.title = t('promptSavePlan') || '保存方案至素材库';

    // "More" Dropdown Menu (holds New Draft, Tags, Export)
    const moreWrap = text(topActions, 'div', '', 'anomalous-prompt-more-wrap');
    moreWrap.style.position = 'relative';
    moreWrap.style.display = 'inline-flex';
    const moreBtn = text(moreWrap, 'button', window.anomalous_browser_lang === 'zh' ? '··· 更多' : '··· More', 'anomalous-btn-ghost anomalous-btn-sm');
    const moreMenu = text(moreWrap, 'div', '', 'anomalous-prompt-more-menu');
    moreMenu.style.display = 'none';
    moreMenu.style.position = 'absolute';
    moreMenu.style.top = 'calc(100% + 4px)';
    moreMenu.style.right = '0';
    moreMenu.style.zIndex = '1000';
    moreMenu.style.minWidth = '150px';
    moreMenu.style.background = 'var(--amb-bg-panel, #1C1E24)';
    moreMenu.style.border = '1px solid var(--amb-border, rgba(255, 255, 255, 0.14))';
    moreMenu.style.borderRadius = 'var(--amb-radius-control, 6px)';
    moreMenu.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.6)';
    moreMenu.style.padding = '4px';

    const newBtn = text(moreMenu, 'button', `✨ ${t('promptNewDraft')}`, 'anomalous-btn-ghost anomalous-btn-sm');
    newBtn.style.width = '100%';
    newBtn.style.justifyContent = 'flex-start';
    newBtn.style.border = 'none';

    const tagsBtn = text(moreMenu, 'button', `🏷️ ${window.anomalous_browser_lang === 'zh' ? '设置标签' : 'Edit Tags'}`, 'anomalous-btn-ghost anomalous-btn-sm');
    tagsBtn.style.width = '100%';
    tagsBtn.style.justifyContent = 'flex-start';
    tagsBtn.style.border = 'none';
    tagsBtn.onclick = () => {
        closeMoreMenu();
        const current = (draft.tags || []).join(', ');
        const val = prompt(window.anomalous_browser_lang === 'zh' ? '输入方案标签（用逗号或空格分隔）：' : 'Enter preset tags (comma separated):', current);
        if (val !== null) {
            draft.tags = val.split(/[\s,，\n\r]+/).map(v => v.trim()).filter(Boolean);
            showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? `已更新标签 (${draft.tags.length})` : `Tags updated (${draft.tags.length})`);
        }
    };

    const exportBtn = text(moreMenu, 'button', `📤 ${t('promptExportPlan')}`, 'anomalous-btn-ghost anomalous-btn-sm');
    exportBtn.style.width = '100%';
    exportBtn.style.justifyContent = 'flex-start';
    exportBtn.style.border = 'none';

    moreBtn.onclick = (e) => {
        e.stopPropagation();
        const isHidden = moreMenu.style.display === 'none';
        moreMenu.style.display = isHidden ? 'block' : 'none';
    };
    const closeMoreMenu = () => { moreMenu.style.display = 'none'; };
    document.addEventListener?.('click', closeMoreMenu);

    const closeBtn = text(topActions, 'button', '✕', 'anomalous-btn-ghost anomalous-btn-sm anomalous-prompt-close-btn');
    closeBtn.title = t('close') || '关闭';
    closeBtn.onclick = () => {
        if (typeof options.onClose === 'function') options.onClose();
        else owner.closeWorkspace?.();
    };

    // Dedicated Insert Position control (placed in sticky Action Dock)
    const posWrap = document.createElement('label');
    posWrap.className = 'anomalous-prompt-insert-pos';
    const posSelect = text(posWrap, 'select', '', 'anomalous-prompt-pos-select');
    for (const value of ['after', 'before']) {
        text(posSelect, 'option', t(`promptInsert_${value}`)).value = value;
    }
    posSelect.value = owner.promptInsertPosition || 'after';
    posSelect.onchange = () => {
        owner.promptInsertPosition = posSelect.value;
        renderTargetBar();
    };

    // Two-Column Split Grid (Adapts to vertical dual-zone in sidebar mode)
    const workbenchGrid = text(view, 'div', '', 'anomalous-prompt-workbench-grid');

    // =========================================================================
    // LEFT COLUMN: Ready-to-use Prompt Cards (词卡库)
    // =========================================================================
    const leftPanel = text(workbenchGrid, 'section', '', 'anomalous-workbench-left-panel');
    const leftHeader = text(leftPanel, 'div', '', 'anomalous-workbench-col-header');
    const leftTitleWrap = text(leftHeader, 'div', '', 'anomalous-workbench-col-title');
    text(leftTitleWrap, 'strong', window.anomalous_browser_lang === 'zh' ? '词卡库' : 'Prompt Library');
    const leftCounter = text(leftTitleWrap, 'span', '', 'anomalous-sub-counter');

    // Action button group in leftHeader
    const leftHeaderActions = text(leftHeader, 'div', '', 'anomalous-workbench-header-actions');

    // Button 1: Extract Prompts from Selected Canvas Node
    const extractNodeBtn = text(leftHeaderActions, 'button', '', 'anomalous-btn-ghost anomalous-btn-sm anomalous-btn-extract-node');
    extractNodeBtn.innerHTML = `<svg style="width:12px;height:12px;margin-right:3px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>${window.anomalous_browser_lang === 'zh' ? '提取' : 'Extract'}`;
    extractNodeBtn.title = window.anomalous_browser_lang === 'zh' ? '从画布当前选中节点提取提示词并生成词卡' : 'Extract prompt text from selected canvas node into cards';

    // Button 2: One-click Sync / Import from Material Library
    const importMaterialsBtn = text(leftHeaderActions, 'button', '', 'anomalous-btn-ghost anomalous-btn-sm');
    importMaterialsBtn.innerHTML = `<svg style="width:12px;height:12px;margin-right:3px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${window.anomalous_browser_lang === 'zh' ? '导入' : 'Import'}`;
    importMaterialsBtn.title = window.anomalous_browser_lang === 'zh' ? '读取素材库，一键把素材库里沉淀的提示词捞入当前工坊词库' : 'Read and import all prompts from Material Library into workbench';

    // Button 3: Create New Custom Card (placed in header right, never wraps)
    const newCardTriggerBtn = text(leftHeaderActions, 'button', '', 'anomalous-btn-ghost anomalous-btn-sm');
    newCardTriggerBtn.innerHTML = `<svg style="width:12px;height:12px;margin-right:3px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>${window.anomalous_browser_lang === 'zh' ? '新建' : 'New'}`;
    newCardTriggerBtn.title = window.anomalous_browser_lang === 'zh' ? '新建并保存一张提示词卡片' : 'Create a new prompt card';

    // Search and category filters bar
    const leftFilterBar = text(leftPanel, 'div', '', 'anomalous-workbench-filter-bar');
    const leftSearch = text(leftFilterBar, 'input', '', 'anomalous-workbench-search-input');
    leftSearch.placeholder = window.anomalous_browser_lang === 'zh' ? '搜索提示词或分类...' : 'Search prompt snippet...';
    leftSearch.oninput = () => {
        sourceFilterKeyword = leftSearch.value.trim().toLowerCase();
        renderSourceCardsList();
    };

    const leftCategoryPills = text(leftPanel, 'div', '', 'anomalous-workbench-category-pills');
    const filterCats = [
        { id: 'all', label: window.anomalous_browser_lang === 'zh' ? '全部' : 'All' },
        { id: 'base', label: window.anomalous_browser_lang === 'zh' ? '通用底模' : 'Base' },
        { id: 'style', label: window.anomalous_browser_lang === 'zh' ? '风格氛围' : 'Style' },
        { id: 'subject', label: window.anomalous_browser_lang === 'zh' ? '主体内容' : 'Subject' },
        { id: 'trigger', label: window.anomalous_browser_lang === 'zh' ? '触发词' : 'Trigger' },
    ];
    filterCats.forEach(cat => {
        const pill = text(leftCategoryPills, 'button', cat.label, `anomalous-workbench-pill${sourceFilterCategory === cat.id ? ' is-active' : ''}`);
        pill.onclick = () => {
            sourceFilterCategory = cat.id;
            leftCategoryPills.querySelectorAll('.anomalous-workbench-pill').forEach(el => el.classList.remove('is-active'));
            pill.classList.add('is-active');
            renderSourceCardsList();
        };
    });

    // Inline New Card Form (Hidden by default, shown on demand)
    const newCardForm = text(leftPanel, 'div', '', 'anomalous-workbench-new-card-form');
    newCardForm.style.display = 'none';

    // Source Cards List
    const sourceCardsList = text(leftPanel, 'div', '', 'anomalous-source-cards-list');

    // =========================================================================
    // RIGHT COLUMN: Assembler & Arranger Stage (顺序拼装调音台)
    // =========================================================================
    const rightPanel = text(workbenchGrid, 'section', '', 'anomalous-workbench-right-panel');
    const rightHeader = text(rightPanel, 'div', '', 'anomalous-workbench-col-header');
    
    // Role switch tabs (Positive / Negative)
    const rightTabs = text(rightHeader, 'div', '', 'anomalous-mixer-tabs');

    const rightActions = text(rightHeader, 'div', '', 'anomalous-mixer-actions');

    // Right quick extract: suck into right mixer directly
    const rightSuckNodeBtn = text(rightActions, 'button', '', 'anomalous-btn-ghost anomalous-btn-sm');
    rightSuckNodeBtn.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>${t('promptReadSelectedNode')}`;
    rightSuckNodeBtn.title = window.anomalous_browser_lang === 'zh' ? '直接将画布选中节点的提示词作为积木吸入当前拼装台' : 'Extract node prompt directly into current mixer track';

    const smartSortBtn = text(rightActions, 'button', '', 'anomalous-mixer-smart-sort-btn');
    smartSortBtn.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${t('promptSortByCategory')}`;
    smartSortBtn.title = window.anomalous_browser_lang === 'zh' ? '按 [通用底模 ➔ 风格氛围 ➔ 主体内容 ➔ LoRA/触发词] 自动排序' : 'Auto sort: [Base ➔ Style ➔ Subject ➔ Trigger]';

    const clearRightBtn = text(rightActions, 'button', '', 'anomalous-btn-ghost');
    clearRightBtn.innerHTML = '<svg style="width:13px;height:13px;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    clearRightBtn.title = window.anomalous_browser_lang === 'zh' ? '清空当前拼装池' : 'Clear current track';

    // Blocks Container & Dropzone
    const blocksContainer = text(rightPanel, 'div', '', 'anomalous-mixer-blocks-container anomalous-assembly-track');

    // Bottom Live Assembled Action Dock (Always visible sticky bar at bottom of assembler)
    const outputDeck = text(rightPanel, 'div', '', 'anomalous-mixer-deck-output anomalous-prompt-action-dock is-collapsed');

    // 1. Slim Dock Summary & Target Injection Bar (Always visible)
    const outputSummary = text(outputDeck, 'div', '', 'anomalous-mixer-output-summary');
    const summaryLeft = text(outputSummary, 'div', '', 'anomalous-mixer-summary-left');
    const outputStats = text(summaryLeft, 'div', '', 'anomalous-mixer-output-stats');

    const expandOutputBtn = text(summaryLeft, 'button', window.anomalous_browser_lang === 'zh' ? '📄 最终文本 ▾' : '📄 View Text ▾', 'anomalous-btn-ghost anomalous-btn-sm anomalous-btn-toggle-output');
    expandOutputBtn.title = window.anomalous_browser_lang === 'zh' ? '展开/收起最终合成提示词文本' : 'Expand/collapse assembled text';

    const copyOutputBtn = text(summaryLeft, 'button', `📋`, 'anomalous-btn-ghost anomalous-btn-sm anomalous-btn-quick-copy');
    copyOutputBtn.title = window.anomalous_browser_lang === 'zh' ? '复制当前合成的提示词' : 'Copy assembled prompt text';

    // Target Node Direct Write Bar placed INSIDE outputSummary on the right side
    const targetBar = text(outputSummary, 'div', '', 'anomalous-prompt-target-bar');
    const targetWidgetIndexByNodeId = {};

    // 2. Expandable Drawer (reveals full textarea and canvas drag dock)
    const outputDrawer = text(outputDeck, 'div', '', 'anomalous-mixer-output-drawer');
    outputDrawer.style.display = 'none';

    const outputBody = text(outputDrawer, 'div', '', 'anomalous-mixer-output-body');
    const outputTextarea = text(outputBody, 'textarea', '', 'anomalous-mixer-output-textarea');
    outputTextarea.readOnly = true;
    outputTextarea.rows = 2;
    outputTextarea.oninput = () => {};

    const outputFooter = text(outputDrawer, 'div', '', 'anomalous-mixer-output-footer');
    const dragHint = text(outputFooter, 'div', '', 'anomalous-mixer-drag-hint');
    dragHint.innerHTML = `🖐️ <strong>${window.anomalous_browser_lang === 'zh' ? '按住此预览坞' : 'Drag this deck'}</strong> ${window.anomalous_browser_lang === 'zh' ? '直接丢入 ComfyUI 画布节点' : 'onto canvas node'}`;

    function updateOutputDeckState() {
        outputDeck.style.display = 'flex';

        if (isOutputExpanded) {
            outputDeck.classList.remove('is-collapsed');
            outputDrawer.style.display = 'flex';
            expandOutputBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '收起预览 ▲' : 'Collapse ▲';
            expandOutputBtn.classList.add('is-active');
        } else {
            outputDeck.classList.add('is-collapsed');
            outputDrawer.style.display = 'none';
            expandOutputBtn.innerHTML = window.anomalous_browser_lang === 'zh' ? '📄 最终文本 ▾' : '📄 View Text ▾';
            expandOutputBtn.classList.remove('is-active');
        }
    }

    expandOutputBtn.onclick = (e) => {
        e.stopPropagation();
        isOutputExpanded = !isOutputExpanded;
        updateOutputDeckState();
    };

    outputSummary.onclick = (e) => {
        if (e.target.closest('button') || e.target.closest('select') || e.target.closest('.anomalous-prompt-target-bar')) return;
        isOutputExpanded = !isOutputExpanded;
        updateOutputDeckState();
    };

    // Bind output deck drag once on mount
    bindMaterialDrag(outputDeck, owner, {
        payload: () => {
            const compiledText = (draft?.plan?.[activeTab] || '').trim();
            return compiledText ? {
                content: compiledText,
                position: posSelect.value,
                dragHint: activeTab === 'positive'
                    ? (window.anomalous_browser_lang === 'zh' ? '✨ 拖拽合成正面词至画布节点' : '✨ Drag Assembled Positive onto Node')
                    : (window.anomalous_browser_lang === 'zh' ? '🚫 拖拽合成负面词至画布节点' : '🚫 Drag Assembled Negative onto Node'),
            } : null;
        },
        accepts: node => promptWidgetTargets(node).length > 0,
        drop: (node, data, graph) => applyPromptDrop(node, data, graph, targetBar),
    });

    // -------------------------------------------------------------------------
    // FEATURE IMPLEMENTATIONS: Node Extraction & Material Sync
    // -------------------------------------------------------------------------

    function detectNodePromptRole(node, widgetName = '') {
        if (/neg|negative|反向|负向/i.test(widgetName)) return 'negative';
        if (/pos|positive|正面|正向/i.test(widgetName)) return 'positive';

        if (app?.graph && Array.isArray(node?.outputs)) {
            for (const output of node.outputs) {
                if (!Array.isArray(output.links)) continue;
                for (const linkId of output.links) {
                    const link = app.graph.links?.[linkId];
                    if (!link) continue;
                    const targetNode = app.graph.getNodeById(link.target_id);
                    if (targetNode?.inputs && targetNode.inputs[link.target_slot]) {
                        const targetInput = targetNode.inputs[link.target_slot];
                        const inputName = String(targetInput.name || '').toLowerCase();
                        if (inputName.includes('neg') || inputName.includes('负')) return 'negative';
                        if (inputName.includes('pos') || inputName.includes('正')) return 'positive';
                    }
                }
            }
        }

        const nodeText = `${node?.title || ''} ${node?.type || ''}`.toLowerCase();
        if (/neg|negative|反向|负向/.test(nodeText)) return 'negative';
        if (/pos|positive|正面|正向/.test(nodeText)) return 'positive';

        return 'positive';
    }

    // Extract prompts from selected canvas node
    function extractPromptsFromSelectedNode(intoRightMixer = false) {
        const node = selectedMaterialNode(app);
        if (!node) {
            anomalousAlert(window.anomalous_browser_lang === 'zh'
                ? '💡 请先在 ComfyUI 画布上点击选中一个提示词节点（例如 CLIPTextEncode 或包含 prompt 文本的节点）！'
                : '💡 Please select a prompt node (e.g. CLIPTextEncode) on the ComfyUI canvas first!');
            return;
        }

        const heading = materialNodeHeading(node) || node.title || node.type || `Node #${node.id}`;
        let targets = promptWidgetTargets(node);

        // Safe fallback: only prompt/caption/text widgets or textarea, exclude settings/file paths
        if (!targets.length && Array.isArray(node.widgets)) {
            targets = node.widgets.flatMap((w, idx) => {
                const name = String(w.name || '').toLowerCase();
                if (/filename|prefix|path|directory|save|load|ckpt|model|vae|seed|steps|cfg|denoise|sampler|scheduler/i.test(name)) {
                    return [];
                }
                if (typeof w.value === 'string' && w.value.trim().length > 0 && !w.options?.values) {
                    if (/prompt|caption|text|description|words|tags/i.test(name) || w.type === 'customtext' || w.type === 'string') {
                        return [{ index: idx, name: w.name || 'text' }];
                    }
                }
                return [];
            });
        }

        if (!targets.length) {
            anomalousAlert(window.anomalous_browser_lang === 'zh'
                ? `⚠️ 选中的节点【${heading}】中未检测到有效的提示词文本输入！`
                : `⚠️ No valid prompt text found in selected node [${heading}]!`);
            return;
        }

        let extractedCount = 0;
        targets.forEach(t => {
            const rawVal = String(node.widgets[t.index]?.value || '').trim();
            if (!rawVal) return;
            const role = detectNodePromptRole(node, t.name);
            const cat = role === 'negative' ? 'base' : categorizePromptSnippet(rawVal);
            const cardTitle = `${heading} · ${t.name}`;

            const newCard = {
                id: `node_${node.id}_${t.index}_${Date.now()}`,
                title: cardTitle,
                content: rawVal,
                role,
                category: cat,
                persisted: false,
            };

            // Add into left source deck
            sourceCards.unshift(newCard);
            extractedCount++;

            // If user clicked right panel, also insert into mixer track directly
            if (intoRightMixer) {
                addSourceCardToMixer(newCard);
            }
        });

        if (extractedCount > 0) {
            renderSourceCardsList();
            showWorkbenchToast(window.anomalous_browser_lang === 'zh'
                ? `已成功从节点【${heading}】提取 ${extractedCount} 段提示词${intoRightMixer ? '并加入组合' : '并加入左侧词库'}！`
                : `Successfully extracted ${extractedCount} prompts from [${heading}]!`);
        } else {
            anomalousAlert(window.anomalous_browser_lang === 'zh'
                ? `选中的节点【${heading}】文本内容为空！`
                : `The text fields in node [${heading}] are empty!`);
        }
    }

    extractNodeBtn.onclick = () => extractPromptsFromSelectedNode(false);
    rightSuckNodeBtn.onclick = () => extractPromptsFromSelectedNode(true);

    let materialSyncController = null;
    async function syncMaterialsIntoSourceDeck() {
        materialSyncController?.abort();
        if (materialSyncController) {
            materialSyncController.abort();
        }
        const controller = new AbortController();
        materialSyncController = controller;

        importMaterialsBtn.disabled = true;
        importMaterialsBtn.textContent = window.anomalous_browser_lang === 'zh' ? '正在同步素材...' : 'Syncing...';

        try {
            const res = await fetch('/anomalous/materials?category=prompts&limit=150', { signal: controller.signal });
            const data = await jsonResponse(res, 'materials list');
            if (controller.signal.aborted) return;
            if (Array.isArray(data.materials)) {
                for (const item of data.materials) {
                    if (controller.signal.aborted) return;
                    try {
                        const prompts = await loadMaterialPrompts(item.filename);
                        if (prompts.positive && !sourceCards.some(c => c.content === prompts.positive.trim())) {
                            sourceCards.push({
                                id: `mat_pos_${item.filename}`,
                                title: item.name ? `${item.name} (Pos)` : '素材正向',
                                content: prompts.positive.trim(),
                                role: 'positive',
                                category: categorizePromptSnippet(prompts.positive),
                                persisted: true,
                                filename: item.filename,
                            });
                        }
                        if (prompts.negative && !sourceCards.some(c => c.content === prompts.negative.trim())) {
                            sourceCards.push({
                                id: `mat_neg_${item.filename}`,
                                title: item.name ? `${item.name} (Neg)` : '素材负向',
                                content: prompts.negative.trim(),
                                role: 'negative',
                                category: 'base',
                                persisted: true,
                                filename: item.filename,
                            });
                        }
                    } catch (err) {}
                }
            }

            if (controller.signal.aborted || !view.isConnected) return;
            renderSourceCardsList();
            showWorkbenchToast(window.anomalous_browser_lang === 'zh'
                ? (addedCount > 0 ? `已从素材库成功同步并导入 ${addedCount} 条提示词卡片！` : '素材库提示词已是最新状态，未发现新词条。')
                : `Synced from Material Library: ${addedCount} new prompts added!`);
        } catch (error) {
            if (error.name !== 'AbortError') {
                await anomalousAlert(t('materialLoadError'));
            }
        } finally {
            if (materialSyncController === controller) {
                materialSyncController = null;
                importMaterialsBtn.disabled = false;
                importMaterialsBtn.innerHTML = `<svg style="width:12px;height:12px;margin-right:3px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${window.anomalous_browser_lang === 'zh' ? '导入' : 'Import'}`;
            }
        }
    }

    importMaterialsBtn.onclick = () => syncMaterialsIntoSourceDeck();

    // Persist a single prompt card into library
    async function saveCardToLibrary(card, btnEl = null) {
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.textContent = '⏳';
        }
        const cardTitle = card.title?.trim() || (card.role === 'negative' ? (window.anomalous_browser_lang === 'zh' ? '负向词卡' : 'Negative Card') : (window.anomalous_browser_lang === 'zh' ? '正向词卡' : 'Positive Card'));
        const body = {
            name: cardTitle,
            tags: ['prompt_card', card.category || 'base', card.role || 'positive'],
            allow_duplicate: true,
            plan: {
                version: 2,
                positive: card.role === 'positive' ? card.content : '',
                negative: card.role === 'negative' ? card.content : '',
                parts: [{
                    id: card.id,
                    name: cardTitle,
                    category: card.category || 'base',
                    role: card.role || 'positive',
                    positive: card.role === 'positive' ? card.content : '',
                    negative: card.role === 'negative' ? card.content : '',
                    enabled: true,
                }],
            },
        };

        try {
            const response = await fetch('/anomalous/save_prompt_plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const payload = await jsonResponse(response, 'save prompt card failed');
            if (payload.status !== 'success') throw new Error('save failed');
            card.persisted = true;
            card.filename = payload.filename;
            showWorkbenchToast(t('promptSaveCardSuccess'));
            renderSourceCardsList();
        } catch (err) {
            showWorkbenchToast(t('promptSaveCardFailed'));
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.textContent = `💾 ${t('promptSaveCard')}`;
            }
        }
    }

    // -------------------------------------------------------------------------
    // RENDER: Left Panel Cards & Form
    // -------------------------------------------------------------------------
    function renderNewCardFormUI() {
        if (!isCreatingNewCard) {
            newCardForm.style.display = 'none';
            newCardForm.replaceChildren();
            return;
        }
        newCardForm.style.display = 'flex';
        newCardForm.replaceChildren();

        text(newCardForm, 'div', window.anomalous_browser_lang === 'zh' ? '✨ 新建提示词卡片' : '✨ New Prompt Card', 'anomalous-form-title');
        
        const titleInput = text(newCardForm, 'input', '', 'anomalous-form-input');
        titleInput.placeholder = window.anomalous_browser_lang === 'zh' ? '卡片名称（如：赛博光影、角色面部）...' : 'Card name...';

        // Role & Category selector row
        const metaRow = text(newCardForm, 'div', '', 'anomalous-form-meta-row');

        // Role radio group
        const roleGroup = text(metaRow, 'div', '', 'anomalous-form-role-group');
        let selectedRole = activeTab || 'positive';

        const posLabel = text(roleGroup, 'label', '', 'anomalous-role-label');
        const posRadio = text(posLabel, 'input', '');
        posRadio.type = 'radio';
        posRadio.name = 'new_card_role';
        posRadio.value = 'positive';
        posRadio.checked = selectedRole === 'positive';
        text(posLabel, 'span', t('promptRolePositive'));

        const negLabel = text(roleGroup, 'label', '', 'anomalous-role-label');
        const negRadio = text(negLabel, 'input', '');
        negRadio.type = 'radio';
        negRadio.name = 'new_card_role';
        negRadio.value = 'negative';
        negRadio.checked = selectedRole === 'negative';
        text(negLabel, 'span', t('promptRoleNegative'));

        posRadio.onchange = () => { if (posRadio.checked) selectedRole = 'positive'; };
        negRadio.onchange = () => { if (negRadio.checked) selectedRole = 'negative'; };

        // Category dropdown
        const catWrap = text(metaRow, 'div', '', 'anomalous-form-cat-wrap');
        text(catWrap, 'span', `${window.anomalous_browser_lang === 'zh' ? '分类' : 'Type'}: `);
        let selectedCat = 'style';
        const catSelect = text(catWrap, 'select', '', 'anomalous-form-select');
        ['base', 'style', 'subject', 'trigger'].forEach(catKey => {
            const meta = CATEGORY_META[catKey];
            const opt = text(catSelect, 'option', window.anomalous_browser_lang === 'zh' ? meta.zh : meta.en);
            opt.value = catKey;
            if (catKey === selectedCat) opt.selected = true;
        });
        catSelect.onchange = () => { selectedCat = catSelect.value; };

        const contentInput = text(newCardForm, 'textarea', '', 'anomalous-form-textarea');
        contentInput.placeholder = window.anomalous_browser_lang === 'zh' ? '输入提示词内容，多个短语用逗号隔开...' : 'Enter prompt text...';
        contentInput.rows = 3;

        const formBtnRow = text(newCardForm, 'div', '', 'anomalous-form-btn-row');
        const submitBtn = text(formBtnRow, 'button', window.anomalous_browser_lang === 'zh' ? '✓ 保存并加入库' : '✓ Save to Library', 'anomalous-btn-primary anomalous-btn-sm');
        const cancelBtn = text(formBtnRow, 'button', t('cancel'), 'anomalous-btn-ghost anomalous-btn-sm');

        submitBtn.onclick = async () => {
            const rawContent = contentInput.value.trim();
            if (!rawContent) {
                contentInput.focus();
                return;
            }
            submitBtn.disabled = true;
            submitBtn.textContent = '⏳ ...';

            const cardTitle = titleInput.value.trim() || (window.anomalous_browser_lang === 'zh' ? CATEGORY_META[selectedCat].zh : CATEGORY_META[selectedCat].en);
            const newCard = {
                id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                title: cardTitle,
                content: rawContent,
                role: selectedRole,
                category: selectedCat,
                persisted: false,
            };

            try {
                const body = {
                    name: cardTitle,
                    tags: ['prompt_card', selectedCat, selectedRole],
                    allow_duplicate: true,
                    plan: {
                        version: 2,
                        positive: selectedRole === 'positive' ? rawContent : '',
                        negative: selectedRole === 'negative' ? rawContent : '',
                        parts: [{
                            id: newCard.id,
                            name: cardTitle,
                            category: selectedCat,
                            role: selectedRole,
                            positive: selectedRole === 'positive' ? rawContent : '',
                            negative: selectedRole === 'negative' ? rawContent : '',
                            enabled: true,
                        }],
                    },
                };
                const res = await fetch('/anomalous/save_prompt_plan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const payload = await jsonResponse(res, 'save prompt card');
                if (payload.status === 'success') {
                    newCard.persisted = true;
                    newCard.filename = payload.filename;
                    showWorkbenchToast(t('promptSaveCardSuccess'));
                }
            } catch (err) {
                showWorkbenchToast(t('promptSaveCardFailed'));
            }

            sourceCards.unshift(newCard);
            isCreatingNewCard = false;
            renderNewCardFormUI();
            renderSourceCardsList();
        };

        cancelBtn.onclick = () => {
            isCreatingNewCard = false;
            renderNewCardFormUI();
        };

        titleInput.focus();
    }

    newCardTriggerBtn.onclick = () => {
        isCreatingNewCard = !isCreatingNewCard;
        renderNewCardFormUI();
    };

    function renderSourceCardsList() {
        sourceCardsList.replaceChildren();
        const filtered = sourceCards.filter(card => {
            if (sourceFilterCategory !== 'all' && card.category !== sourceFilterCategory) return false;
            if (sourceFilterKeyword) {
                const matchTitle = card.title.toLowerCase().includes(sourceFilterKeyword);
                const matchContent = card.content.toLowerCase().includes(sourceFilterKeyword);
                if (!matchTitle && !matchContent) return false;
            }
            return true;
        });

        leftCounter.textContent = `(${filtered.length})`;

        if (!filtered.length) {
            const empty = text(sourceCardsList, 'div', '', 'anomalous-source-empty');
            empty.innerHTML = `
                <div style="font-size: 24px; margin-bottom: 6px;">🔍</div>
                <div>${window.anomalous_browser_lang === 'zh' ? '未找到匹配的提示词卡片' : 'No matching prompt cards found'}</div>
            `;
            return;
        }

        filtered.forEach(card => {
            const cardEl = text(sourceCardsList, 'article', '', `anomalous-source-prompt-card is-cat-${card.category}`);
            cardEl.setAttribute('draggable', 'true');
            cardEl.title = window.anomalous_browser_lang === 'zh' ? '点击直接加入上方拼装台（也可拖拽）' : 'Click to add to mixer above (or drag)';

            // Instant tap to add card to mixer
            cardEl.onclick = (e) => {
                if (e.target.closest('button') || e.target.closest('input')) return;
                addSourceCardToMixer(card);
            };

            // Drag Start -> transfer prompt card payload
            cardEl.ondragstart = (e) => {
                const payload = {
                    title: card.title,
                    content: card.content,
                    role: card.role,
                    category: card.category,
                };
                e.dataTransfer.setData('application/json', JSON.stringify(payload));
                e.dataTransfer.setData('text/plain', card.content);
                e.dataTransfer.effectAllowed = 'copyMove';
                cardEl.classList.add('is-dragging-source');
                workbenchGrid.classList.add('is-source-dragging');
            };

            cardEl.ondragend = () => {
                cardEl.classList.remove('is-dragging-source');
                workbenchGrid.classList.remove('is-source-dragging');
            };

            // Card Header
            const header = text(cardEl, 'div', '', 'anomalous-source-card-header');
            const meta = CATEGORY_META[card.category] || CATEGORY_META.subject;

            const badge = text(header, 'span', window.anomalous_browser_lang === 'zh' ? meta.zh : meta.en, 'anomalous-source-card-badge');
            badge.style.color = meta.color;
            badge.style.backgroundColor = meta.bg;
            badge.style.borderColor = meta.border;

            // Explicit Role Badge (Positive / Negative)
            const isNeg = card.role === 'negative';
            const roleBadge = text(header, 'span', isNeg ? (window.anomalous_browser_lang === 'zh' ? '负向' : 'Neg') : (window.anomalous_browser_lang === 'zh' ? '正向' : 'Pos'), 'anomalous-source-role-badge');
            roleBadge.style.cssText = `font-size:10px;padding:1px 5px;border-radius:3px;font-weight:600;background:${isNeg ? 'rgba(244,63,94,0.15)' : 'rgba(56,189,248,0.15)'};color:${isNeg ? '#fb7185' : '#38bdf8'};border:1px solid ${isNeg ? 'rgba(244,63,94,0.3)' : 'rgba(56,189,248,0.3)'};flex-shrink:0;`;

            if (card.persisted === false || (card.id.startsWith('node_') && !card.persisted)) {
                const unsavedBadge = text(header, 'span', `[${t('promptCardUnsaved')}]`, 'anomalous-unsaved-badge');
                unsavedBadge.title = window.anomalous_browser_lang === 'zh' ? '临时提取词卡，尚未持久化到素材库' : 'Unsaved temporary card';
            }

            const title = text(header, 'strong', card.title, 'anomalous-source-card-title');
            title.title = card.title;

            // Card Body snippet (max 2 lines, legible font size)
            const snippet = text(cardEl, 'div', card.content, 'anomalous-source-card-snippet');
            snippet.title = card.content;

            // Card Footer Actions
            const footer = text(cardEl, 'div', '', 'anomalous-source-card-footer');
            const actions = text(footer, 'div', '', 'anomalous-source-card-actions');
            actions.style.marginLeft = 'auto';

            const copyBtn = text(actions, 'button', '📋', 'anomalous-source-action-btn');
            copyBtn.title = t('copy');
            copyBtn.onclick = async (e) => {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(card.content);
                    copyBtn.textContent = '✅';
                    setTimeout(() => { if (copyBtn.isConnected) copyBtn.textContent = '📋'; }, 1200);
                } catch (err) {
                    await anomalousAlert(t('materialCopyError'));
                }
            };

            if (card.persisted === false || (card.id.startsWith('node_') && !card.persisted)) {
                const saveCardBtn = text(actions, 'button', '', 'anomalous-source-action-btn is-save-lib');
                saveCardBtn.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>${t('promptSaveCard')}`;
                saveCardBtn.title = window.anomalous_browser_lang === 'zh' ? '将此卡片存入素材库' : 'Save this card to Material Library';
                saveCardBtn.onclick = async (e) => {
                    e.stopPropagation();
                    await saveCardToLibrary(card, saveCardBtn);
                };
            }

            const dockBtn = text(actions, 'button', '', 'anomalous-source-action-btn is-dock');
            dockBtn.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>${window.anomalous_browser_lang === 'zh' ? '加入组合' : 'Add to Plan'}`;
            dockBtn.title = window.anomalous_browser_lang === 'zh' ? '加入当前拼装组合' : 'Add into mixer track';
            dockBtn.onclick = (e) => {
                e.stopPropagation();
                addSourceCardToMixer(card);
            };
        });
    }

    // -------------------------------------------------------------------------
    // RENDER: Right Assembler Stage & Lego Blocks
    // -------------------------------------------------------------------------
    function updateRightTabsUI() {
        rightTabs.replaceChildren();
        const posCount = draft.plan.parts.filter(p => p.role === 'positive').length;
        const negCount = draft.plan.parts.filter(p => p.role === 'negative').length;

        const tabs = [
            { key: 'positive', label: `${window.anomalous_browser_lang === 'zh' ? '正向拼装台' : 'Positive'} (${posCount})` },
            { key: 'negative', label: `${window.anomalous_browser_lang === 'zh' ? '负向拼装台' : 'Negative'} (${negCount})` },
        ];

        for (const tab of tabs) {
            const btn = text(rightTabs, 'button', tab.label, `anomalous-mixer-tab-btn${activeTab === tab.key ? ' is-active' : ''}`);
            btn.onclick = () => {
                activeTab = tab.key;
                updateRightTabsUI();
                renderBlocksList();
                updateOutputPreview();
                renderTargetBar();
            };
        }
    }

    function addSourceCardToMixer(cardData, targetIndex = null) {
        const cardRole = cardData.role || 'positive';
        if (activeTab !== cardRole) {
            activeTab = cardRole;
            updateRightTabsUI();
        }

        const newBlock = normalizeBlock({
            title: cardData.title,
            content: cardData.content,
            role: cardRole,
            category: cardData.category,
            enabled: true,
        }, draft.plan.parts.length);
        newBlock._justAdded = true;

        if (targetIndex !== null && targetIndex >= 0) {
            draft.plan.parts.splice(targetIndex, 0, newBlock);
        } else {
            draft.plan.parts.push(newBlock);
        }

        syncDraftSynthesizedText(draft);
        updateRightTabsUI();
        renderBlocksList();
        updateOutputPreview();
        renderTargetBar();

        const count = draft.plan.parts.filter(p => p.role === activeTab).length;
        showWorkbenchToast(window.anomalous_browser_lang === 'zh'
            ? `已加入【${activeTab === 'positive' ? '正向' : '负向'}】拼装台（共 ${count} 块）`
            : `Added to ${activeTab} track (${count} blocks)`);
    }

    function renderBlocksList() {
        blocksContainer.replaceChildren();
        const currentRoleParts = draft.plan.parts.filter(p => p.role === activeTab);

        if (!currentRoleParts.length) {
            const dropzoneNotice = text(blocksContainer, 'div', '', 'anomalous-assembly-dropzone');
            dropzoneNotice.innerHTML = `
                <div style="margin-bottom: 12px; opacity: 0.7;">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                </div>
                <div style="font-size: 0.92rem; font-weight: 600; color: #e2e8f0;">${window.anomalous_browser_lang === 'zh' ? '点击下方词卡或拖拽到这里拼装' : 'Click cards below or drop here to assemble'}</div>
                <div style="font-size: 0.76rem; color: #64748b; margin-top: 4px;">${window.anomalous_browser_lang === 'zh' ? '支持自由调换次序，点击【智能排序】自动理顺' : 'Drag to reorder anytime, or click Smart Sort.'}</div>
            `;
            // Accept drops on empty dropzone
            setupDropzoneListeners(dropzoneNotice);
            return;
        }

        currentRoleParts.forEach((block, index) => {
            const isJustAdded = !!block._justAdded;
            if (isJustAdded) delete block._justAdded;

            const blockEl = text(blocksContainer, 'article', '', `anomalous-mixer-block${!block.enabled ? ' is-bypassed' : ''} is-role-${block.role}${isJustAdded ? ' is-just-added' : ''}`);
            blockEl.setAttribute('draggable', 'true');
            blockEl.dataset ||= {};
            blockEl.dataset.blockId = block.id;

            if (isJustAdded) {
                requestAnimationFrame(() => {
                    blockEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                });
            }

            // Reorder Drag Listeners
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

                // Case 1: Drop from Left Source Card
                const jsonStr = e.dataTransfer.getData('application/json');
                if (jsonStr) {
                    try {
                        const parsed = JSON.parse(jsonStr);
                        const toIndex = draft.plan.parts.findIndex(p => p.id === block.id);
                        const insertAfter = e.clientY >= (blockEl.getBoundingClientRect().top + blockEl.offsetHeight / 2);
                        addSourceCardToMixer(parsed, insertAfter ? toIndex + 1 : toIndex);
                        return;
                    } catch (err) {}
                }

                // Case 2: Reorder inside Right Track
                if (!draggedBlockId || draggedBlockId === block.id) return;
                const fromIndex = draft.plan.parts.findIndex(p => p.id === draggedBlockId);
                if (fromIndex < 0) return;

                const [moved] = draft.plan.parts.splice(fromIndex, 1);
                const currentTargetIndex = draft.plan.parts.findIndex(p => p.id === block.id);
                if (currentTargetIndex < 0) {
                    draft.plan.parts.push(moved);
                } else {
                    const rect = blockEl.getBoundingClientRect();
                    const insertAfter = e.clientY >= (rect.top + rect.height / 2);
                    const finalIndex = insertAfter ? currentTargetIndex + 1 : currentTargetIndex;
                    draft.plan.parts.splice(finalIndex, 0, moved);
                }

                syncDraftSynthesizedText(draft);
                renderBlocksList();
                updateOutputPreview();
            };

            // Header
            const blockHeader = text(blockEl, 'div', '', 'anomalous-mixer-block-header');
            const headerLeft = text(blockHeader, 'div', '', 'anomalous-mixer-block-header-left');

            const dragHandle = text(headerLeft, 'span', '⠿', 'anomalous-mixer-drag-handle');
            dragHandle.title = window.anomalous_browser_lang === 'zh' ? '抓取按住上下拖拽排序' : 'Drag to reorder';

            // A/B Bypass Checkbox
            const toggleWrap = text(headerLeft, 'label', '', 'anomalous-mixer-block-toggle');
            const checkbox = text(toggleWrap, 'input', '');
            checkbox.type = 'checkbox';
            checkbox.checked = !!block.enabled;
            checkbox.title = window.anomalous_browser_lang === 'zh' ? '勾选参与拼装，取消勾选即旁路跳过（做A/B对比）' : 'Include or bypass in assembly';
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
            catBadge.title = window.anomalous_browser_lang === 'zh' ? '点击切换词性分类' : 'Cycle category';
            catBadge.onclick = () => {
                const cats = ['base', 'style', 'subject', 'trigger'];
                const nextIdx = (cats.indexOf(block.category) + 1) % cats.length;
                block.category = cats[nextIdx];
                renderBlocksList();
            };

            // Editable title
            const titleInput = text(headerLeft, 'input', '', 'anomalous-mixer-block-title-input');
            titleInput.value = block.title || '';
            titleInput.oninput = () => { block.title = titleInput.value; };

            // Right Action micro buttons
            const headerRight = text(blockHeader, 'div', '', 'anomalous-mixer-block-header-right');

            const upBtn = text(headerRight, 'button', '▲', 'anomalous-mixer-block-btn');
            upBtn.title = window.anomalous_browser_lang === 'zh' ? '上移' : 'Move up';
            upBtn.disabled = index === 0;
            upBtn.onclick = () => {
                const realIdx = draft.plan.parts.findIndex(p => p.id === block.id);
                if (realIdx < 0) return;
                const myRole = block.role || activeTab;
                let prevIdx = -1;
                for (let i = realIdx - 1; i >= 0; i--) {
                    if ((draft.plan.parts[i].role || 'positive') === myRole) {
                        prevIdx = i;
                        break;
                    }
                }
                if (prevIdx >= 0) {
                    const temp = draft.plan.parts[realIdx];
                    draft.plan.parts[realIdx] = draft.plan.parts[prevIdx];
                    draft.plan.parts[prevIdx] = temp;
                    syncDraftSynthesizedText(draft);
                    renderBlocksList();
                    updateOutputPreview();
                }
            };

            const downBtn = text(headerRight, 'button', '▼', 'anomalous-mixer-block-btn');
            downBtn.title = window.anomalous_browser_lang === 'zh' ? '下移' : 'Move down';
            downBtn.disabled = index === currentRoleParts.length - 1;
            downBtn.onclick = () => {
                const realIdx = draft.plan.parts.findIndex(p => p.id === block.id);
                if (realIdx < 0) return;
                const myRole = block.role || activeTab;
                let nextIdx = -1;
                for (let i = realIdx + 1; i < draft.plan.parts.length; i++) {
                    if ((draft.plan.parts[i].role || 'positive') === myRole) {
                        nextIdx = i;
                        break;
                    }
                }
                if (nextIdx >= 0) {
                    const temp = draft.plan.parts[realIdx];
                    draft.plan.parts[realIdx] = draft.plan.parts[nextIdx];
                    draft.plan.parts[nextIdx] = temp;
                    syncDraftSynthesizedText(draft);
                    renderBlocksList();
                    updateOutputPreview();
                }
            };

            const delBtn = text(headerRight, 'button', '✕', 'anomalous-mixer-block-btn is-delete');
            delBtn.title = window.anomalous_browser_lang === 'zh' ? '移除此块' : 'Remove block';
            delBtn.onclick = () => {
                const realIdx = draft.plan.parts.findIndex(p => p.id === block.id);
                if (realIdx >= 0) {
                    draft.plan.parts.splice(realIdx, 1);
                    syncDraftSynthesizedText(draft);
                    updateRightTabsUI();
                    renderBlocksList();
                    updateOutputPreview();
                }
            };

            // Body
            const blockBody = text(blockEl, 'div', '', 'anomalous-mixer-block-body');
            const textarea = text(blockBody, 'textarea', '', 'anomalous-mixer-block-textarea');
            textarea.value = block.content || '';
            textarea.rows = 1;
            textarea.oninput = () => {
                block.content = textarea.value;
                syncDraftSynthesizedText(draft);
                updateOutputPreview();
            };
        });
    }

    function setupDropzoneListeners(el) {
        el.ondragover = (e) => {
            e.preventDefault();
            el.classList.add('is-drag-over');
        };
        el.ondragleave = () => {
            el.classList.remove('is-drag-over');
        };
        el.ondrop = (e) => {
            e.preventDefault();
            el.classList.remove('is-drag-over');
            const jsonStr = e.dataTransfer.getData('application/json');
            if (jsonStr) {
                try {
                    addSourceCardToMixer(JSON.parse(jsonStr));
                } catch (err) {}
            }
        };
    }

    function updateOutputPreview() {
        syncDraftSynthesizedText(draft);
        const compiledText = draft.plan[activeTab] || '';
        const currentRoleParts = draft.plan.parts.filter(p => p.role === activeTab);

        outputStats.innerHTML = `${activeTab === 'negative' ? '🚫' : '✨'} <strong>${compiledText.length}</strong>${window.anomalous_browser_lang === 'zh' ? '字' : 'c'} · <strong>${currentRoleParts.length}</strong>${window.anomalous_browser_lang === 'zh' ? '块' : 'b'}`;
        outputStats.title = activeTab === 'negative'
            ? `${window.anomalous_browser_lang === 'zh' ? '负向' : 'Negative'}: ${compiledText.length} ${window.anomalous_browser_lang === 'zh' ? '字符' : 'chars'}, ${currentRoleParts.length} ${window.anomalous_browser_lang === 'zh' ? '块积木' : 'blocks'}`
            : `${window.anomalous_browser_lang === 'zh' ? '正向' : 'Positive'}: ${compiledText.length} ${window.anomalous_browser_lang === 'zh' ? '字符' : 'chars'}, ${currentRoleParts.length} ${window.anomalous_browser_lang === 'zh' ? '块积木' : 'blocks'}`;

        outputTextarea.value = compiledText;
        updateOutputDeckState();
    }

    // Smart Sort
    smartSortBtn.onclick = () => {
        if (!draft.plan.parts.length) return;
        const roleParts = draft.plan.parts.filter(p => p.role === activeTab);
        const otherParts = draft.plan.parts.filter(p => p.role !== activeTab);
        const sorted = smartSortPromptBlocks(roleParts, activeTab);
        draft.plan.parts = [...sorted, ...otherParts];

        syncDraftSynthesizedText(draft);
        renderBlocksList();
        updateOutputPreview();

        smartSortBtn.classList.add('is-animating');
        setTimeout(() => smartSortBtn.classList.remove('is-animating'), 500);
    };

    // Clear track
    clearRightBtn.onclick = async () => {
        const msg = window.anomalous_browser_lang === 'zh'
            ? `确定清空当前【${activeTab === 'positive' ? '正向' : '负向'}】拼装池吗？`
            : `Clear ${activeTab} mixer track?`;
        if (await anomalousConfirm(msg)) {
            draft.plan.parts = draft.plan.parts.filter(p => p.role !== activeTab);
            syncDraftSynthesizedText(draft);
            updateRightTabsUI();
            renderBlocksList();
            updateOutputPreview();
        }
    };

    // Copy preview text
    copyOutputBtn.onclick = async (e) => {
        e?.stopPropagation?.();
        const textToCopy = (draft.plan[activeTab] || outputTextarea.value || '').trim();
        if (!textToCopy) return;
        try {
            await navigator.clipboard.writeText(textToCopy);
            copyOutputBtn.textContent = '✅';
            setTimeout(() => { if (copyOutputBtn.isConnected) copyOutputBtn.textContent = `📋`; }, 1500);
        } catch (err) {
            await anomalousAlert(t('materialCopyError'));
        }
    };

    // -------------------------------------------------------------------------
    // Target Node Direct Injection Toolbar (Compact sticky bar integrated into Action Dock)
    // -------------------------------------------------------------------------
    const renderTargetBar = () => {
        if (!view.isConnected) return;
        targetBar.replaceChildren();
        const node = selectedMaterialNode(app);
        const targets = promptWidgetTargets(node);

        const actions = text(targetBar, 'div', '', 'anomalous-prompt-target-actions');

        if (!node || !targets.length) {
            actions.appendChild(posWrap);
            const emptyBtn = text(actions, 'button', `⬇️ ${window.anomalous_browser_lang === 'zh' ? '写入节点' : 'Write Node'}`, 'anomalous-btn-ghost anomalous-btn-sm');
            emptyBtn.title = t('promptSelectTextNode');
            emptyBtn.onclick = () => {
                anomalousAlert(window.anomalous_browser_lang === 'zh'
                    ? '💡 请先在 ComfyUI 画布上点击选中一个提示词节点（例如 CLIPTextEncode）！'
                    : '💡 Please select a prompt node (e.g. CLIPTextEncode) on the ComfyUI canvas first!');
            };
            return;
        }

        // Compact target node tag
        const nodeHeading = materialNodeHeading(node) || node.title || node.type || `Node #${node.id}`;
        const nodeBadge = text(actions, 'span', `#${node.id} ${nodeHeading}`.slice(0, 14), 'anomalous-target-node-badge');
        nodeBadge.title = t('materialApplyingTo', { name: nodeHeading, id: node.id });

        if (targets.length > 1) {
            const widgetSelect = text(actions, 'select', '', 'anomalous-target-widget-select');
            widgetSelect.setAttribute('aria-label', t('promptTargetWidget'));
            for (const target of targets) {
                text(widgetSelect, 'option', target.name).value = String(target.index);
            }
            const savedIndex = targetWidgetIndexByNodeId[node.id];
            if (savedIndex !== undefined && targets.some(t => t.index === savedIndex)) {
                widgetSelect.value = String(savedIndex);
            } else {
                targetWidgetIndexByNodeId[node.id] = Number(widgetSelect.value);
            }
            widgetSelect.onchange = () => {
                targetWidgetIndexByNodeId[node.id] = Number(widgetSelect.value);
            };
        }

        actions.appendChild(posWrap);

        const applyRole = (role, label, isPrimary = false) => {
            const btn = text(actions, 'button', label, isPrimary ? 'anomalous-btn-primary anomalous-btn-sm' : 'anomalous-btn-ghost anomalous-btn-sm');
            btn.type = 'button';
            btn.onclick = async () => {
                try {
                    if (selectedMaterialNode(app) !== node) throw new Error('materialTargetChanged');
                    const widgetSelectEl = actions.querySelector('select:not(.anomalous-prompt-pos-select)');
                    const index = widgetSelectEl ? Number(widgetSelectEl.value) : targets[0].index;
                    if (!promptWidgetTargets(node).some(t => t.index === index)) throw new Error('materialTargetChanged');
                    const content = draft.plan[role];
                    if (!content || !content.trim()) {
                        showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? '当前拼装台暂无内容可写入' : 'No prompt content in current track');
                        return;
                    }
                    const value = joinPromptText(node.widgets[index].value, content, posSelect.value);
                    showMaterialApplication(targetBar, applyNodeMaterialValues(app, node, [{ index, value }]), node);
                    btn.textContent = '✅ ' + (window.anomalous_browser_lang === 'zh' ? '已写入' : 'Written');
                    setTimeout(() => { if (btn.isConnected) btn.textContent = label; }, 1200);
                } catch (error) {
                    await anomalousAlert(t(error.message) === error.message ? t('materialApplyFailed') : t(error.message));
                }
            };
        };

        const activeLabel = activeTab === 'positive'
            ? `⬇️ ${window.anomalous_browser_lang === 'zh' ? '写入正向' : 'Write Pos'}`
            : `⬇️ ${window.anomalous_browser_lang === 'zh' ? '写入负向' : 'Write Neg'}`;
        applyRole(activeTab, activeLabel, true);
    };

    if (isSide) owner.refreshSidePromptTarget = renderTargetBar;
    else owner.refreshPromptTarget = renderTargetBar;

    // Save Plan to Material Library
    saveBtn.onclick = async () => {
        if (!draft.name?.trim()) {
            nameInput.focus();
            nameInput.classList.add('is-invalid');
            setTimeout(() => nameInput.classList.remove('is-invalid'), 1200);
            showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? '请先在顶栏输入方案名称！' : 'Please enter preset name first!');
            return;
        }
        saveBtn.disabled = true;
        syncDraftSynthesizedText(draft);
        const saved = workbenchDraftToSavedPlan(draft);
        const body = {
            name: draft.name.trim(),
            tags: draft.tags || [],
            plan: saved.plan,
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
        if (!draft.name?.trim()) {
            nameInput.focus();
            nameInput.classList.add('is-invalid');
            setTimeout(() => nameInput.classList.remove('is-invalid'), 1200);
            showWorkbenchToast(window.anomalous_browser_lang === 'zh' ? '请先在顶栏输入方案名称！' : 'Please enter preset name first!');
            return;
        }
        syncDraftSynthesizedText(draft);
        const saved = workbenchDraftToSavedPlan(draft);
        const exportData = {
            format: 'anomalous-prompt-plan-v1',
            version: 2,
            name: draft.name,
            tags: draft.tags,
            plan: saved.plan,
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
            owner.promptPlanDraft = draft = newDraft();
            draft.plan.parts.push(normalizeBlock({
                title: window.anomalous_browser_lang === 'zh' ? '正向提示词' : 'Positive Prompt',
                content: '',
                role: 'positive',
                category: 'base',
            }, 0));
            syncDraftSynthesizedText(draft);
            if (!isSide) {
                showPromptComposer(owner);
            } else {
                updateRightTabsUI();
                renderBlocksList();
                updateOutputPreview();
                renderTargetBar();
                nameInput.value = '';
                draft.tags = [];
            }
        }
    };

    // Initial silent sync from Material Library on mount
    (async () => {
        try {
            const res = await fetch('/anomalous/materials?category=prompts&limit=80');
            const data = await jsonResponse(res, 'materials list');
            if (Array.isArray(data.materials)) {
                for (const item of data.materials) {
                    try {
                        const prompts = await loadMaterialPrompts(item.filename);
                        if (prompts.positive && !sourceCards.some(c => c.content === prompts.positive.trim())) {
                            sourceCards.push({
                                id: `mat_pos_${item.filename}`,
                                title: item.name ? `${item.name} (Pos)` : '素材正向',
                                content: prompts.positive.trim(),
                                role: 'positive',
                                category: categorizePromptSnippet(prompts.positive),
                            });
                        }
                        if (prompts.negative && !sourceCards.some(c => c.content === prompts.negative.trim())) {
                            sourceCards.push({
                                id: `mat_neg_${item.filename}`,
                                title: item.name ? `${item.name} (Neg)` : '素材负向',
                                content: prompts.negative.trim(),
                                role: 'negative',
                                category: 'base',
                            });
                        }
                    } catch (e) {}
                }
                if (view.isConnected) {
                    renderSourceCardsList();
                }
            }
        } catch (e) {}
    })();

    // Initial render execution
    renderNewCardFormUI();
    renderSourceCardsList();
    updateRightTabsUI();
    renderBlocksList();
    updateOutputPreview();
    renderTargetBar();

    const control = {
        updateAll: () => {
            updateRightTabsUI();
            renderBlocksList();
            updateOutputPreview();
            renderSourceCardsList();
        },
        addBlock: (blockData) => {
            addSourceCardToMixer(blockData);
        },
    };

    if (!isSide) owner.workbenchComposerControl = control;
    return control;
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

async function openMaterialImportDrawer(owner, draft, onUpdated) {
    owner.closePromptImportDrawer?.();
    const drawer = text(document.body, 'aside', '', 'anomalous-prompt-import-drawer');
    owner.promptImportDrawer = drawer;

    const onKeydown = e => {
        if (e.key === 'Escape') {
            owner.closePromptImportDrawer?.();
        }
    };
    window.addEventListener('keydown', onKeydown);
    owner.closePromptImportDrawer = () => {
        window.removeEventListener('keydown', onKeydown);
        drawer.remove();
        owner.promptImportDrawer = null;
    };

    const res = await fetch('/anomalous/materials?category=prompts&limit=48');
    const data = await jsonResponse(res, 'drawer materials');
    const list = text(drawer, 'div', '', 'anomalous-drawer-list');

    for (const item of data.materials || []) {
        const card = text(list, 'div', '', 'anomalous-drawer-item');
        text(card, 'div', item.name || 'Prompt Item', 'anomalous-drawer-item-title');
        const inspect = text(card, 'button', t('materialViewDetails'), 'anomalous-btn-ghost');
        inspect.onclick = async () => {
            const prompts = await loadMaterialPrompts(item.filename);
            const loadAll = text(card, 'button', t('promptDrawerLoadAll'), 'anomalous-btn-primary');
            loadAll.onclick = () => {
                if (prompts.positive) draft.plan.positive = prompts.positive;
                if (prompts.negative) draft.plan.negative = prompts.negative;
                onUpdated?.();
            };
        };
    }
}

