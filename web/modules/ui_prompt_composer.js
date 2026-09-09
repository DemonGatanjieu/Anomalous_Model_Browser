import { loadMaterialPrompts } from './material_prompt_data.js';
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
    if (owner.sidePromptComposerControl?.appendPrompt) {
        owner.sidePromptComposerControl.appendPrompt(textSnippet, isPositive, noteTitle);
    } else {
        owner.promptPlanDraft ||= newDraft();
        const role = isPositive ? 'positive' : 'negative';
        owner.promptPlanDraft.plan[role] = joinPromptText(owner.promptPlanDraft.plan[role] || '', textSnippet, owner.promptInsertPosition || 'after');
        if (!owner.promptPlanDraft.name?.trim() && noteTitle) owner.promptPlanDraft.name = noteTitle;
    }
}

function buildPromptComposer(owner, container, options = {}) {
    const isSide = !!options.isSideStudio;
    const view = text(container, 'section', '', `anomalous-prompt-composer${isSide ? ' is-side-studio' : ''}`);
    if (isSide) owner.sidePromptComposerView = view;
    else owner.promptComposerView = view;
    let draft = owner.promptPlanDraft ||= newDraft();
    draft.plan = { parts: [], ...composePromptPlan(draft.plan) };

    // 1. Topbar
    const topbar = text(view, 'div', '', 'anomalous-prompt-topbar');
    const topLeft = text(topbar, 'div', '', 'anomalous-prompt-topbar-left');
    if (!isSide) {
        const backBtn = text(topLeft, 'button', `← ${t('materialBackToLibrary')}`, 'anomalous-btn-ghost');
        backBtn.onclick = () => owner.showMaterials();
        text(topLeft, 'h3', t('promptCombinations'));
    } else {
        text(topLeft, 'h3', `✨ ${t('materialPromptStudio') || '提示词工坊'}`);
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
    posSelect.onchange = () => { owner.promptInsertPosition = posSelect.value; renderTargetBar(); };

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
        textarea.rows = isSide ? 6 : 5;

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

        applyRole('positive', `写入正面 (${t(`promptInsert_${posSelect.value}`)})`);
        applyRole('negative', `写入负面 (${t(`promptInsert_${posSelect.value}`)})`);
    };

    if (isSide) owner.refreshSidePromptTarget = renderTargetBar;
    else owner.refreshPromptTarget = renderTargetBar;
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
            owner.closePromptImportDrawer?.();
            owner.promptPlanDraft = draft = newDraft();
            if (!isSide) {
                showPromptComposer(owner);
            } else {
                refreshAllNotes();
            }
        }
    };

    return {
        refreshAllNotes,
        appendPrompt: (textSnippet, isPositive = true, noteTitle = '') => {
            const role = isPositive ? 'positive' : 'negative';
            draft.plan[role] = joinPromptText(draft.plan[role] || '', textSnippet, owner.promptInsertPosition || 'after');
            if (!draft.name?.trim() && noteTitle) draft.name = noteTitle;
            refreshAllNotes();
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
                            const replace = text(card, 'button', t('promptDrawerReplace'), 'anomalous-drawer-item-btn');
                            replace.onclick = () => { draft.plan[role] = prompts[role]; onUpdated(); };
                            const append = text(card, 'button', t('promptDrawerAppend'), 'anomalous-drawer-item-btn');
                            append.onclick = () => { draft.plan[role] = joinPromptText(draft.plan[role], prompts[role], owner.promptInsertPosition || 'after'); onUpdated(); };
                        }
                        const whole = text(card, 'button', t('promptDrawerLoadAll'), 'anomalous-drawer-item-btn');
                        whole.onclick = () => {
                            draft.plan.positive = prompts.positive; draft.plan.negative = prompts.negative;
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
