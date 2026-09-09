import { bindMaterialDrag } from './material_drag.js';
import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { text, jsonResponse, materialNodeHeading } from './material_inspector.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { composePromptPlan, joinPromptText } from './prompt_composition.js';
import { applyNodeMaterialValues, promptWidgetTargets, selectedMaterialNode } from './node_material_actions.js';
import { showMaterialApplication } from './ui_material_application.js';
import { showMaterialSaved } from './material_feedback.js';

const clone = value => JSON.parse(JSON.stringify(value));
const newDraft = () => ({ name: '', tags: [], plan: { parts: [], positive: '', negative: '' } });

export function addPromptToDraft(owner, name, positive, negative = '') {
    owner.promptPlanDraft ||= newDraft();
    const current = composePromptPlan(owner.promptPlanDraft.plan);
    owner.promptPlanDraft.name ||= String(name).slice(0, 120);
    owner.promptPlanDraft.plan = {
        parts: [],
        positive: joinPromptText(current.positive, positive, 'after'),
        negative: joinPromptText(current.negative, negative, 'after'),
    };
    showPromptComposer(owner);
}

export async function showPromptComposer(owner, material) {
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
            if (payload.data?.kind !== 'prompt_plan' || !Array.isArray(payload.data.plan?.parts)) throw new Error('invalid plan');
            owner.promptPlanDraft = { name: payload.data.name, tags: payload.data.tags || [], plan: clone(payload.data.plan) };
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

    for (const panel of [owner.materialIntro, owner.materialList, owner.materialToolbar, owner.materialPager, owner.materialContext]) {
        if (panel) panel.style.display = 'none';
    }
    owner.promptComposerView?.remove();

    const view = text(owner.materialView, 'section', '', 'anomalous-prompt-composer');
    owner.promptComposerView = view;
    const draft = owner.promptPlanDraft;
    draft.plan = { parts: [], ...composePromptPlan(draft.plan) };

    // 1. Topbar
    const topbar = text(view, 'div', '', 'anomalous-prompt-topbar');
    const topLeft = text(topbar, 'div', '', 'anomalous-prompt-topbar-left');
    const backBtn = text(topLeft, 'button', `← ${t('materialBackToLibrary')}`, 'anomalous-btn-ghost');
    backBtn.onclick = () => owner.showMaterials();
    text(topLeft, 'h3', t('promptCombinations'));

    const topActions = text(topbar, 'div', '', 'anomalous-prompt-topbar-actions');
    const importBtn = text(topActions, 'button', `📥 ${t('promptImportFromMaterials')}`, 'anomalous-btn-ghost');
    importBtn.title = t('promptDrawerTitle');

    const saveBtn = text(topActions, 'button', `💾 ${t('promptSavePlan')}`, 'anomalous-btn-primary');
    const exportBtn = text(topActions, 'button', `📤 ${t('promptExportPlan')}`, 'anomalous-btn-ghost');
    const newBtn = text(topActions, 'button', `✨ ${t('promptNewDraft')}`, 'anomalous-btn-ghost');

    // 2. Metadata strip (Name, Tags, Position)
    const metaStrip = text(view, 'div', '', 'anomalous-prompt-meta-strip');
    const nameInput = text(metaStrip, 'input', '', 'anomalous-prompt-name-input');
    nameInput.placeholder = t('promptPlanName');
    nameInput.maxLength = 120;
    nameInput.value = draft.name;
    nameInput.oninput = () => { draft.name = nameInput.value; };

    const tagsInput = text(metaStrip, 'input', '', 'anomalous-prompt-tags-input');
    tagsInput.placeholder = t('materialTagsHint');
    tagsInput.value = draft.tags.join(', ');
    tagsInput.maxLength = 1200;
    tagsInput.oninput = () => {
        draft.tags = tagsInput.value.split(/[,，]/).map(val => val.trim()).filter(Boolean);
    };

    const posWrap = text(metaStrip, 'label', '', 'anomalous-prompt-insert-pos');
    text(posWrap, 'span', `${t('promptInsertPosition')}:`);
    const posSelect = text(posWrap, 'select', '');
    for (const value of ['before', 'after']) {
        text(posSelect, 'option', t(`promptInsert_${value}`)).value = value;
    }
    posSelect.value = owner.promptInsertPosition || 'after';
    posSelect.onchange = () => { owner.promptInsertPosition = posSelect.value; };

    // 3. Paper-like Note Cards Grid
    const notesGrid = text(view, 'div', '', 'anomalous-paper-notes-grid');

    const renderNoteCard = (role, isPositive) => {
        const card = text(notesGrid, 'article', '', `anomalous-paper-note ${isPositive ? 'is-positive' : 'is-negative'}`);
        card.setAttribute('draggable', 'true');
        card.setAttribute('aria-label', t(isPositive ? 'promptPositiveNote' : 'promptNegativeNote'));

        // Tape effect on top
        text(card, 'div', '', 'anomalous-paper-note-tape');

        // Header
        const noteHeader = text(card, 'div', '', 'anomalous-paper-note-header');
        const noteTitle = text(noteHeader, 'div', '', 'anomalous-paper-note-title');
        noteTitle.innerHTML = isPositive ? `✨ ${t('promptPositiveNote')}` : `🚫 ${t('promptNegativeNote')}`;

        const noteActions = text(noteHeader, 'div', '', 'anomalous-paper-note-actions');
        const charCount = text(noteActions, 'span', t('promptWordCount', { count: draft.plan[role].length }), 'anomalous-paper-note-count');

        const copyBtn = text(noteActions, 'button', `📋 ${t('copy')}`, 'anomalous-paper-note-btn');
        copyBtn.title = t(`promptCopy_${role}`);
        copyBtn.onclick = async event => {
            event.stopPropagation();
            try {
                await navigator.clipboard.writeText(draft.plan[role]);
                copyBtn.textContent = '✅ 已复制';
                setTimeout(() => { if (copyBtn.isConnected) copyBtn.textContent = `📋 ${t('copy')}`; }, 1500);
            } catch (err) {
                await anomalousAlert(t('materialCopyError'));
            }
        };

        const clearBtn = text(noteActions, 'button', `🧹`, 'anomalous-paper-note-btn');
        clearBtn.title = t('promptClearText');
        clearBtn.onclick = async event => {
            event.stopPropagation();
            if (draft.plan[role].trim() && await anomalousConfirm(t('promptClearConfirm'))) {
                draft.plan[role] = '';
                textarea.value = '';
                charCount.textContent = t('promptWordCount', { count: 0 });
            }
        };

        // Textarea body
        const noteBody = text(card, 'div', '', 'anomalous-paper-note-body');
        const textarea = text(noteBody, 'textarea', '', 'anomalous-paper-note-textarea');
        textarea.value = draft.plan[role] || '';
        textarea.placeholder = isPositive ? '输入或导入正面提示词...' : '输入或导入负面提示词...';
        textarea.rows = 5;

        textarea.oninput = () => {
            draft.plan[role] = textarea.value;
            charCount.textContent = t('promptWordCount', { count: textarea.value.length });
        };

        // Footer with drag hint
        const noteFooter = text(card, 'div', '', 'anomalous-paper-note-footer');
        const dragPrompt = text(noteFooter, 'span', '', 'anomalous-paper-note-drag-prompt');
        dragPrompt.innerHTML = `🖐️ ${t('promptDragNoteHint')}`;

        // Bind Whole Card Drag
        bindMaterialDrag(card, owner, {
            payload: () => draft.plan[role].trim() ? {
                content: draft.plan[role],
                position: posSelect.value,
                dragHint: isPositive ? `✨ 拖拽正面提示词便签至目标节点` : `🚫 拖拽负面提示词便签至目标节点`,
            } : null,
            accepts: node => promptWidgetTargets(node).length > 0,
            drop: (node, data, graph) => applyPromptDrop(node, data, graph, targetBar),
        });

        return {
            update: () => {
                textarea.value = draft.plan[role] || '';
                charCount.textContent = t('promptWordCount', { count: textarea.value.length });
            },
        };
    };

    const posCardControl = renderNoteCard('positive', true);
    const negCardControl = renderNoteCard('negative', false);

    const refreshAllNotes = () => {
        posCardControl.update();
        negCardControl.update();
        nameInput.value = draft.name || '';
        tagsInput.value = (draft.tags || []).join(', ');
    };

    // 4. Target Node Bar & Direct Application
    const targetBar = text(view, 'div', '', 'anomalous-prompt-target-bar');
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
        info.innerHTML = `🎯 ${t('materialApplyingTo', { name: materialNodeHeading(node), id: node.id })}`;

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

        applyRole('positive', `写入正面 (${t(`promptInsert_${posSelect.value}`)})`);
        applyRole('negative', `写入负面 (${t(`promptInsert_${posSelect.value}`)})`);
    };

    owner.refreshPromptTarget = renderTargetBar;
    renderTargetBar();

    // 5. Drawer Integration: Import Prompts from Material Library
    importBtn.onclick = () => {
        openMaterialImportDrawer(owner, draft, refreshAllNotes);
    };

    // 6. Action Handlers (Save, Export, Reset)
    saveBtn.onclick = async () => {
        if (!draft.name.trim()) {
            nameInput.focus();
            return;
        }
        saveBtn.disabled = true;
        const body = clone(draft);
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

    exportBtn.onclick = () => {
        if (!draft.name.trim()) {
            nameInput.focus();
            return;
        }
        const blob = new Blob([JSON.stringify({ format: 'anomalous-prompt-plan-v1', ...draft }, null, 2)], { type: 'application/json' });
        if (blob.size > 2 * 1024 * 1024 || draft.tags.length > 20 || draft.tags.some(tag => tag.length > 60)) {
            return anomalousAlert(t('promptExportError'));
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${draft.name || 'prompt-plan'}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    newBtn.onclick = async () => {
        if (await anomalousConfirm(t('promptReplaceDraft'))) {
            owner.promptPlanDraft = newDraft();
            showPromptComposer(owner);
        }
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
    document.querySelector('.anomalous-prompt-import-drawer')?.remove();

    const drawer = document.createElement('div');
    drawer.className = 'anomalous-prompt-import-drawer';

    // Header
    const header = text(drawer, 'div', '', 'anomalous-drawer-header');
    text(header, 'h4', `📥 ${t('promptDrawerTitle')}`);
    const closeBtn = text(header, 'button', '✕', 'anomalous-paper-note-btn');
    closeBtn.onclick = () => drawer.remove();

    // Search bar
    const searchWrap = text(drawer, 'div', '', 'anomalous-drawer-search');
    const searchInput = text(searchWrap, 'input', '');
    searchInput.placeholder = t('promptDrawerSearchPlaceholder');
    searchInput.type = 'search';

    // List container
    const listContainer = text(drawer, 'div', '', 'anomalous-drawer-list');
    text(listContainer, 'div', '⏳ 正在加载素材库提示词...', 'anomalous-material-muted');

    document.body.appendChild(drawer);

    const onKeydown = e => {
        if (e.key === 'Escape') {
            drawer.remove();
            window.removeEventListener('keydown', onKeydown);
        }
    };
    window.addEventListener('keydown', onKeydown);

    try {
        const response = await fetch('/anomalous/materials?limit=100');
        const payload = await jsonResponse(response, 'load materials failed');
        const items = payload.data?.items || [];

        // Extract and shape prompt data
        const promptMaterials = [];
        for (const item of items) {
            let pos = '';
            let neg = '';

            if (item.kind === 'prompt_plan' && item.plan) {
                pos = item.plan.positive || '';
                neg = item.plan.negative || '';
            } else if (item.kind === 'prompt_text') {
                pos = item.content || item.summary || '';
            } else if (Array.isArray(item.node_blocks)) {
                for (const block of item.node_blocks) {
                    const textVal = Array.isArray(block.widgets_values) && typeof block.widgets_values[0] === 'string'
                        ? block.widgets_values[0]
                        : '';
                    if (!textVal) continue;
                    if (block.promptRole === 'positive') pos = pos ? `${pos}, ${textVal}` : textVal;
                    else if (block.promptRole === 'negative') neg = neg ? `${neg}, ${textVal}` : textVal;
                    else if (/cliptextencode/i.test(block.type || '')) pos = pos ? `${pos}, ${textVal}` : textVal;
                }
            }

            if (pos || neg || item.kind === 'prompt_plan') {
                promptMaterials.push({
                    raw: item,
                    name: item.name || '未命名素材',
                    positive: pos,
                    negative: neg,
                    tags: item.tags || [],
                });
            }
        }

        const renderList = (filter = '') => {
            listContainer.replaceChildren();
            const lower = filter.toLowerCase().trim();
            const filtered = promptMaterials.filter(m =>
                !lower ||
                m.name.toLowerCase().includes(lower) ||
                m.positive.toLowerCase().includes(lower) ||
                m.negative.toLowerCase().includes(lower) ||
                m.tags.some(tag => tag.toLowerCase().includes(lower))
            );

            if (!filtered.length) {
                text(listContainer, 'div', t('promptDrawerEmpty'), 'anomalous-material-empty');
                return;
            }

            for (const item of filtered) {
                const card = text(listContainer, 'div', '', 'anomalous-drawer-item');
                text(card, 'div', item.name, 'anomalous-drawer-item-title');

                if (item.positive) {
                    const prev = text(card, 'div', `✨ 正面: ${item.positive}`, 'anomalous-drawer-item-preview');
                    prev.title = item.positive;
                }
                if (item.negative) {
                    const prev = text(card, 'div', `🚫 负面: ${item.negative}`, 'anomalous-drawer-item-preview');
                    prev.title = item.negative;
                }

                const actions = text(card, 'div', '', 'anomalous-drawer-item-actions');

                if (item.positive) {
                    const overwritePos = text(actions, 'button', `覆盖正面`, 'anomalous-drawer-item-btn');
                    overwritePos.onclick = () => {
                        draft.plan.positive = item.positive;
                        onUpdated();
                    };

                    const appendPos = text(actions, 'button', `追加正面`, 'anomalous-drawer-item-btn');
                    appendPos.onclick = () => {
                        draft.plan.positive = joinPromptText(draft.plan.positive, item.positive, owner.promptInsertPosition || 'after');
                        onUpdated();
                    };
                }

                if (item.negative) {
                    const overwriteNeg = text(actions, 'button', `覆盖负面`, 'anomalous-drawer-item-btn');
                    overwriteNeg.onclick = () => {
                        draft.plan.negative = item.negative;
                        onUpdated();
                    };

                    const appendNeg = text(actions, 'button', `追加负面`, 'anomalous-drawer-item-btn');
                    appendNeg.onclick = () => {
                        draft.plan.negative = joinPromptText(draft.plan.negative, item.negative, owner.promptInsertPosition || 'after');
                        onUpdated();
                    };
                }

                const loadAll = text(actions, 'button', `整套导入`, 'anomalous-drawer-item-btn');
                loadAll.onclick = () => {
                    if (item.positive) draft.plan.positive = item.positive;
                    if (item.negative) draft.plan.negative = item.negative;
                    if (!draft.name.trim() && item.name) draft.name = item.name;
                    if (item.tags?.length) draft.tags = [...new Set([...draft.tags, ...item.tags])];
                    onUpdated();
                };
            }
        };

        renderList();
        searchInput.oninput = () => renderList(searchInput.value);
        searchInput.focus();

    } catch (err) {
        listContainer.replaceChildren();
        text(listContainer, 'div', `加载素材库失败: ${err.message}`, 'anomalous-material-empty');
    }
}
