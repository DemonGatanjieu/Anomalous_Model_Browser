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
    toast.innerHTML = message;
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
            draft.plan.parts.push(normalizeBlock(STARTER_SOURCE_PROMPTS[0], 0));
        }
    }
    syncDraftSynthesizedText(draft);

    let activeTab = 'positive'; // 'positive' | 'negative'
    let sourceFilterCategory = 'all';
    let sourceFilterKeyword = '';
    let draggedBlockId = null;

    // Local in-memory source prompt cards (merged starters + materials + user custom)
    let sourceCards = [...STARTER_SOURCE_PROMPTS];
    let isCreatingNewCard = false;

    // 1. Studio Topbar
    const topbar = text(view, 'header', '', 'anomalous-prompt-topbar');
    const topLeft = text(topbar, 'div', '', 'anomalous-prompt-topbar-left');
    if (!isSide) {
        const backBtn = text(topLeft, 'button', `← ${t('materialBackToLibrary')}`, 'anomalous-btn-ghost');
        backBtn.onclick = () => owner.showMaterials();
        text(topLeft, 'h3', window.anomalous_browser_lang === 'zh' ? '🎛️ 提示词双栏调音工作台' : '🎛️ Prompt Studio Workbench');
    } else {
        text(topLeft, 'h3', `🎛️ ${window.anomalous_browser_lang === 'zh' ? '提示词调音台' : 'Prompt Mixer'}`);
    }

    const topActions = text(topbar, 'div', '', 'anomalous-prompt-topbar-actions');
    const newBtn = text(topActions, 'button', `✨ ${t('promptNewDraft')}`, 'anomalous-btn-ghost');
    const saveBtn = text(topActions, 'button', `💾 ${t('promptSavePlan')}`, 'anomalous-btn-primary');
    const exportBtn = text(topActions, 'button', `📤 ${t('promptExportPlan')}`, 'anomalous-btn-ghost');

    if (isSide && options.onClose) {
        const closeBtn = text(topActions, 'button', '✕', 'anomalous-btn-ghost');
        closeBtn.title = t('materialCollapseStudio') || '收起工坊';
        closeBtn.onclick = () => options.onClose();
    }

    // 2. Metadata Strip (Preset Name, Tags, Target Insert Position)
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

    // 3. Two-Column Split Grid
    const workbenchGrid = text(view, 'div', '', 'anomalous-prompt-workbench-grid');

    // =========================================================================
    // LEFT COLUMN: Ready-to-use Prompt Cards (成型提示词库)
    // =========================================================================
    const leftPanel = text(workbenchGrid, 'section', '', 'anomalous-workbench-left-panel');
    const leftHeader = text(leftPanel, 'div', '', 'anomalous-workbench-col-header');
    const leftTitleWrap = text(leftHeader, 'div', '', 'anomalous-workbench-col-title');
    leftTitleWrap.innerHTML = `📚 <strong>${window.anomalous_browser_lang === 'zh' ? '成型提示词库' : 'Prompt Library'}</strong> <span class="anomalous-sub-counter"></span>`;

    // Button: Create New Custom Card (placed in header right, never wraps)
    const newCardTriggerBtn = text(leftHeader, 'button', `➕ ${window.anomalous_browser_lang === 'zh' ? '新建词卡' : 'New Card'}`, 'anomalous-btn-ghost anomalous-btn-sm');
    newCardTriggerBtn.title = window.anomalous_browser_lang === 'zh' ? '新建并保存一张提示词卡片' : 'Create a new prompt card';

    // Sub-action bar: Node extract and Material Library import (full-width, balanced)
    const leftSubActions = text(leftPanel, 'div', '', 'anomalous-workbench-sub-actions');

    // Button 1: Extract Prompts from Selected Canvas Node
    const extractNodeBtn = text(leftSubActions, 'button', `🎯 ${window.anomalous_browser_lang === 'zh' ? '从节点提取' : 'From Node'}`, 'anomalous-btn-primary anomalous-btn-sm anomalous-btn-extract-node');
    extractNodeBtn.title = window.anomalous_browser_lang === 'zh' ? '读取 ComfyUI 画布当前选中节点的提示词文本并生成词卡' : 'Extract prompt text from selected canvas node into cards';

    // Button 2: One-click Sync / Import from Material Library
    const importMaterialsBtn = text(leftSubActions, 'button', `📥 ${window.anomalous_browser_lang === 'zh' ? '从素材库导入' : 'Import from Library'}`, 'anomalous-btn-ghost anomalous-btn-sm');
    importMaterialsBtn.title = window.anomalous_browser_lang === 'zh' ? '读取素材库，一键把素材库里沉淀的提示词捞入当前工坊词库' : 'Read and import all prompts from Material Library into workbench';

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
        { id: 'base', label: window.anomalous_browser_lang === 'zh' ? '💎 通用' : '💎 Base' },
        { id: 'style', label: window.anomalous_browser_lang === 'zh' ? '🎨 风格' : '🎨 Style' },
        { id: 'subject', label: window.anomalous_browser_lang === 'zh' ? '🧍 主体' : '🧍 Subject' },
        { id: 'trigger', label: window.anomalous_browser_lang === 'zh' ? '⚡ 触发' : '⚡ LoRA' },
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
    const rightSuckNodeBtn = text(rightActions, 'button', `🎯 ${window.anomalous_browser_lang === 'zh' ? '从节点吸入' : 'Pull from Node'}`, 'anomalous-btn-ghost anomalous-btn-sm');
    rightSuckNodeBtn.title = window.anomalous_browser_lang === 'zh' ? '直接将画布选中节点的提示词作为积木吸入当前拼装台' : 'Extract node prompt directly into current mixer track';

    const smartSortBtn = text(rightActions, 'button', window.anomalous_browser_lang === 'zh' ? '🪄 智能理顺' : '🪄 Smart Sort', 'anomalous-mixer-smart-sort-btn');
    smartSortBtn.title = window.anomalous_browser_lang === 'zh' ? '按 [通用底模 ➔ 风格氛围 ➔ 主体内容 ➔ LoRA/触发词] 自动排序' : 'Auto sort: [Base ➔ Style ➔ Subject ➔ Trigger]';

    const clearRightBtn = text(rightActions, 'button', '🧹', 'anomalous-btn-ghost');
    clearRightBtn.title = window.anomalous_browser_lang === 'zh' ? '清空当前拼装池' : 'Clear current track';

    // Blocks Container & Dropzone
    const blocksContainer = text(rightPanel, 'div', '', 'anomalous-mixer-blocks-container anomalous-assembly-track');

    // Bottom Live Assembled Output Deck
    const outputDeck = text(rightPanel, 'div', '', 'anomalous-mixer-deck-output');
    const outputHeader = text(outputDeck, 'div', '', 'anomalous-mixer-output-header');
    const outputTitle = text(outputHeader, 'div', '', 'anomalous-mixer-output-title');
    const outputStats = text(outputHeader, 'div', '', 'anomalous-mixer-output-stats');

    const outputBody = text(outputDeck, 'div', '', 'anomalous-mixer-output-body');
    const outputTextarea = text(outputBody, 'textarea', '', 'anomalous-mixer-output-textarea');
    outputTextarea.readOnly = true;
    outputTextarea.rows = 2;

    const outputFooter = text(outputDeck, 'div', '', 'anomalous-mixer-output-footer');
    const dragHint = text(outputFooter, 'div', '', 'anomalous-mixer-drag-hint');
    dragHint.innerHTML = `🖐️ <strong>${window.anomalous_browser_lang === 'zh' ? '按住此预览坞' : 'Drag this deck'}</strong> ${window.anomalous_browser_lang === 'zh' ? '直接丢入 ComfyUI 画布节点' : 'onto canvas node'}`;

    const outputActions = text(outputFooter, 'div', '', 'anomalous-mixer-output-actions');
    const copyOutputBtn = text(outputActions, 'button', `📋 ${t('copy')}`, 'anomalous-btn-ghost');

    // Target Node Direct Write Bar
    const targetBar = text(rightPanel, 'div', '', 'anomalous-prompt-target-bar');

    // -------------------------------------------------------------------------
    // FEATURE IMPLEMENTATIONS: Node Extraction & Material Sync
    // -------------------------------------------------------------------------

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

        // Fallback: scan any widget containing string prompt
        if (!targets.length && Array.isArray(node.widgets)) {
            targets = node.widgets.flatMap((w, idx) => {
                if (typeof w.value === 'string' && w.value.trim().length > 0 && !w.options?.values) {
                    return [{ index: idx, name: w.name || 'text' }];
                }
                return [];
            });
        }

        if (!targets.length) {
            anomalousAlert(window.anomalous_browser_lang === 'zh'
                ? `⚠️ 选中的节点【${heading}】中未检测到有效的文本输入或提示词内容！`
                : `⚠️ No valid text prompt found in selected node [${heading}]!`);
            return;
        }

        let extractedCount = 0;
        targets.forEach(t => {
            const rawVal = String(node.widgets[t.index]?.value || '').trim();
            if (!rawVal) return;
            const isNeg = /neg/i.test(t.name);
            const role = isNeg ? 'negative' : 'positive';
            const cat = isNeg ? 'base' : categorizePromptSnippet(rawVal);
            const cardTitle = `${heading} · ${t.name}`;

            const newCard = {
                id: `node_${node.id}_${t.index}_${Date.now()}`,
                title: cardTitle,
                content: rawVal,
                role,
                category: cat,
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
            showWorkbenchToast(`🎯 ${window.anomalous_browser_lang === 'zh'
                ? `已成功从节点【${heading}】提取 ${extractedCount} 段提示词${intoRightMixer ? '并直接入坞' : '并加入左侧词库'}！`
                : `Successfully extracted ${extractedCount} prompts from [${heading}]!`}`);
        } else {
            anomalousAlert(window.anomalous_browser_lang === 'zh'
                ? `⚠️ 选中的节点【${heading}】文本内容为空！`
                : `⚠️ The text fields in node [${heading}] are empty!`);
        }
    }

    extractNodeBtn.onclick = () => extractPromptsFromSelectedNode(false);
    rightSuckNodeBtn.onclick = () => extractPromptsFromSelectedNode(true);

    // One-click Sync / Import from Material Library
    async function syncMaterialsIntoSourceDeck() {
        importMaterialsBtn.disabled = true;
        importMaterialsBtn.textContent = `⏳ ${window.anomalous_browser_lang === 'zh' ? '同步中...' : 'Syncing...'}`;
        let addedCount = 0;

        try {
            const res = await fetch('/anomalous/materials?limit=150');
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
                            addedCount++;
                        }
                        if (prompts.negative && !sourceCards.some(c => c.content === prompts.negative.trim())) {
                            sourceCards.push({
                                id: `mat_neg_${item.filename}`,
                                title: item.name ? `${item.name} (Neg)` : '素材负向',
                                content: prompts.negative.trim(),
                                role: 'negative',
                                category: 'base',
                            });
                            addedCount++;
                        }
                    } catch (err) {}
                }
            }

            renderSourceCardsList();
            showWorkbenchToast(`📥 ${window.anomalous_browser_lang === 'zh'
                ? (addedCount > 0 ? `已从素材库成功同步并导入 ${addedCount} 条提示词卡片！` : '素材库提示词已是最新状态，未发现新词条。')
                : `Synced from Material Library: ${addedCount} new prompts added!`}`);
        } catch (error) {
            await anomalousAlert(t('materialLoadError'));
        } finally {
            importMaterialsBtn.disabled = false;
            importMaterialsBtn.textContent = `📥 ${window.anomalous_browser_lang === 'zh' ? '从素材库导入' : 'Import from Library'}`;
        }
    }

    importMaterialsBtn.onclick = () => syncMaterialsIntoSourceDeck();

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

        const formTitle = text(newCardForm, 'div', window.anomalous_browser_lang === 'zh' ? '✨ 新建提示词卡片' : '✨ New Prompt Card', 'anomalous-form-title');
        
        const titleInput = text(newCardForm, 'input', '', 'anomalous-form-input');
        titleInput.placeholder = window.anomalous_browser_lang === 'zh' ? '卡片名称（如：赛博光影、角色面部）...' : 'Card name...';

        const catRow = text(newCardForm, 'div', '', 'anomalous-form-cat-row');
        text(catRow, 'span', `${window.anomalous_browser_lang === 'zh' ? '词性' : 'Type'}: `);
        let selectedCat = 'style';
        const catSelect = text(catRow, 'select', '', 'anomalous-form-select');
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

        submitBtn.onclick = () => {
            const rawContent = contentInput.value.trim();
            if (!rawContent) {
                contentInput.focus();
                return;
            }
            const newCard = {
                id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                title: titleInput.value.trim() || (window.anomalous_browser_lang === 'zh' ? CATEGORY_META[selectedCat].zh : CATEGORY_META[selectedCat].en),
                content: rawContent,
                role: selectedCat === 'base' && /worst|low quality|bad anatomy/i.test(rawContent) ? 'negative' : 'positive',
                category: selectedCat,
            };
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

        leftTitleWrap.querySelector('.anomalous-sub-counter').textContent = `(${filtered.length})`;

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
            };

            cardEl.ondragend = () => {
                cardEl.classList.remove('is-dragging-source');
            };

            // Card Header
            const header = text(cardEl, 'div', '', 'anomalous-source-card-header');
            const meta = CATEGORY_META[card.category] || CATEGORY_META.subject;

            const badge = text(header, 'span', window.anomalous_browser_lang === 'zh' ? meta.zh : meta.en, 'anomalous-source-card-badge');
            badge.style.color = meta.color;
            badge.style.backgroundColor = meta.bg;
            badge.style.borderColor = meta.border;

            const title = text(header, 'strong', card.title, 'anomalous-source-card-title');
            title.title = card.title;

            // Card Body snippet
            const snippet = text(cardEl, 'div', card.content, 'anomalous-source-card-snippet');
            snippet.title = card.content;

            // Card Footer Actions
            const footer = text(cardEl, 'div', '', 'anomalous-source-card-footer');
            const dragHint = text(footer, 'span', '🖐️ 抓取拖入右侧', 'anomalous-source-card-drag-hint');

            const actions = text(footer, 'div', '', 'anomalous-source-card-actions');
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

            const dockBtn = text(actions, 'button', `➕ ${window.anomalous_browser_lang === 'zh' ? '入坞' : 'Dock'}`, 'anomalous-source-action-btn is-dock');
            dockBtn.title = window.anomalous_browser_lang === 'zh' ? '直接放入右侧当前拼装台' : 'Add into mixer track';
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
            { key: 'positive', label: `✨ ${window.anomalous_browser_lang === 'zh' ? '正向拼装台' : 'Positive'} (${posCount})` },
            { key: 'negative', label: `🚫 ${window.anomalous_browser_lang === 'zh' ? '负向拼装台' : 'Negative'} (${negCount})` },
        ];

        for (const tab of tabs) {
            const btn = text(rightTabs, 'button', tab.label, `anomalous-mixer-tab-btn${activeTab === tab.key ? ' is-active' : ''}`);
            btn.onclick = () => {
                activeTab = tab.key;
                updateRightTabsUI();
                renderBlocksList();
                updateOutputPreview();
            };
        }
    }

    function addSourceCardToMixer(cardData, targetIndex = null) {
        const targetRole = activeTab;
        const newBlock = normalizeBlock({
            title: cardData.title,
            content: cardData.content,
            role: targetRole,
            category: cardData.category,
            enabled: true,
        }, draft.plan.parts.length);

        if (targetIndex !== null && targetIndex >= 0) {
            draft.plan.parts.splice(targetIndex, 0, newBlock);
        } else {
            draft.plan.parts.push(newBlock);
        }

        syncDraftSynthesizedText(draft);
        updateRightTabsUI();
        renderBlocksList();
        updateOutputPreview();
    }

    function renderBlocksList() {
        blocksContainer.replaceChildren();
        const currentRoleParts = draft.plan.parts.filter(p => p.role === activeTab);

        if (!currentRoleParts.length) {
            const dropzoneNotice = text(blocksContainer, 'div', '', 'anomalous-assembly-dropzone');
            dropzoneNotice.innerHTML = `
                <div style="font-size: 30px; margin-bottom: 8px;">📥</div>
                <div style="font-size: 0.92rem; font-weight: 600; color: #e2e8f0;">${window.anomalous_browser_lang === 'zh' ? '将左侧的成型提示词拖放到这里摆放与拼装' : 'Drop prompt cards from the left panel here'}</div>
                <div style="font-size: 0.76rem; color: #64748b; margin-top: 4px;">${window.anomalous_browser_lang === 'zh' ? '支持自由调换次序，点击【智能理顺】自动按画质底模➔风格➔主体➔LoRA排序' : 'Drag to reorder anytime, or click Smart Sort to auto-align.'}</div>
            `;
            // Accept drops on empty dropzone
            setupDropzoneListeners(dropzoneNotice);
            return;
        }

        currentRoleParts.forEach((block, index) => {
            const blockEl = text(blocksContainer, 'article', '', `anomalous-mixer-block${!block.enabled ? ' is-bypassed' : ''} is-role-${block.role}`);
            blockEl.setAttribute('draggable', 'true');
            blockEl.dataset.blockId = block.id;

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
            downBtn.disabled = index === currentRoleParts.length - 1;
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

        outputTitle.innerHTML = activeTab === 'negative'
            ? `🚫 <strong>${window.anomalous_browser_lang === 'zh' ? '实时合成负向文本' : 'Assembled Negative'}</strong>`
            : `✨ <strong>${window.anomalous_browser_lang === 'zh' ? '实时合成正向文本' : 'Assembled Positive'}</strong>`;

        const words = compiledText.trim() ? compiledText.split(/[\s,，\n\r]+/).filter(Boolean).length : 0;
        outputStats.textContent = window.anomalous_browser_lang === 'zh'
            ? `${compiledText.length} 字符 · 约 ${words} 个词组`
            : `${compiledText.length} chars · ~${words} tags`;

        outputTextarea.value = compiledText;

        // Whole deck drag to ComfyUI canvas node
        bindMaterialDrag(outputDeck, owner, {
            payload: () => compiledText.trim() ? {
                content: compiledText,
                position: posSelect.value,
                dragHint: activeTab === 'positive'
                    ? (window.anomalous_browser_lang === 'zh' ? '✨ 拖拽合成正面词至画布节点' : '✨ Drag Assembled Positive onto Node')
                    : (window.anomalous_browser_lang === 'zh' ? '🚫 拖拽合成负面词至画布节点' : '🚫 Drag Assembled Negative onto Node'),
            } : null,
            accepts: node => promptWidgetTargets(node).length > 0,
            drop: (node, data, graph) => applyPromptDrop(node, data, graph, targetBar),
        });

        renderTargetBar();
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

    // -------------------------------------------------------------------------
    // Target Node Direct Injection Toolbar
    // -------------------------------------------------------------------------
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

    // Save Plan to Material Library
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
            owner.promptPlanDraft = draft = newDraft();
            if (!isSide) {
                showPromptComposer(owner);
            } else {
                updateRightTabsUI();
                renderBlocksList();
                updateOutputPreview();
                nameInput.value = '';
                tagsInput.value = '';
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
