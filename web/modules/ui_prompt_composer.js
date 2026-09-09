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
    owner.promptPlanDraft.plan = { parts: [], positive: joinPromptText(current.positive, positive, 'after'), negative: joinPromptText(current.negative, negative, 'after') };
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
        } finally { if (owner.materialDetailController === controller) owner.materialDetailController = null; }
    }
    owner.promptPlanDraft ||= newDraft();
    clearTimeout(owner.materialSearchTimer);
    owner.materialListController?.abort();
    owner.materialListController = null;
    owner.materialDetailController?.abort();
    owner.materialDetailView?.remove();
    owner.materialDetailView = null;
    for (const panel of [owner.materialIntro, owner.materialList, owner.materialToolbar, owner.materialPager, owner.materialContext]) if (panel) panel.style.display = 'none';
    owner.promptComposerView?.remove();
    const view = text(owner.materialView, 'section', '', 'anomalous-prompt-composer');
    owner.promptComposerView = view;
    const draft = owner.promptPlanDraft;
    draft.plan = { parts: [], ...composePromptPlan(draft.plan) };
    const header = text(view, 'div', '', 'anomalous-prompt-actions');
    const back = text(header, 'button', t('materialBackToLibrary'), 'anomalous-btn-ghost');
    back.onclick = () => owner.showMaterials();
    text(header, 'h3', t('promptCombinations'));
    const name = text(view, 'input', '', 'anomalous-nb-select');
    name.placeholder = t('promptPlanName'); name.setAttribute('aria-label', t('promptPlanName')); name.maxLength = 120; name.value = draft.name;
    name.oninput = () => { draft.name = name.value; };
    const tags = text(view, 'input', '', 'anomalous-nb-select');
    tags.placeholder = t('materialTagsHint'); tags.setAttribute('aria-label', t('materialTags')); tags.value = draft.tags.join(', '); tags.maxLength = 1200;
    tags.oninput = () => { draft.tags = tags.value.split(/[,，]/).map(value => value.trim()).filter(Boolean); };
    text(view, 'p', t('promptCompositionHint'), 'anomalous-material-muted');
    text(view, 'small', t('promptDraftHint'), 'anomalous-material-muted');
    const field = (parent, label, value, oninput, readOnly = false) => {
        const wrap = text(parent, 'label', label, 'anomalous-prompt-field');
        const input = text(wrap, 'textarea', ''); input.value = value; input.rows = 3; input.readOnly = readOnly;
        input.setAttribute('aria-label', label); input.oninput = () => oninput(input.value);
        return input;
    };
    const placement = text(view, 'label', t('promptInsertPosition'), 'anomalous-prompt-field');
    const position = text(placement, 'select', '');
    position.setAttribute('aria-label', t('promptInsertPosition'));
    for (const value of ['before', 'after']) text(position, 'option', t(`promptInsert_${value}`)).value = value;
    position.value = owner.promptInsertPosition || 'after';
    position.onchange = () => { owner.promptInsertPosition = position.value; };
    for (const role of ['positive', 'negative']) {
        const card = text(view, 'div', '', 'anomalous-prompt-drag-card');
        field(card, t(`promptFinal_${role}`), draft.plan[role], value => { draft.plan[role] = value; });
        const drag = text(card, 'button', t('promptDragText'), 'anomalous-btn-primary');
        drag.type = 'button';
        bindMaterialDrag(drag, owner, {
            payload: () => draft.plan[role].trim() ? { content: draft.plan[role], position: position.value } : null,
            accepts: node => promptWidgetTargets(node).length > 0,
            drop: (node, data, graph) => applyPromptDrop(node, data, graph, targetArea),
        });
        const copy = text(card, 'button', t(`promptCopy_${role}`), 'anomalous-btn-ghost');
        copy.onclick = async () => {
            try { await navigator.clipboard.writeText(draft.plan[role]); copy.textContent = t('materialCopied'); }
            catch (error) { await anomalousAlert(t('materialCopyError')); }
        };
    }
    const targetArea = text(view, 'div', '', 'anomalous-prompt-target');
    const renderTarget = () => {
        if (!view.isConnected) return;
        targetArea.replaceChildren();
        const node = selectedMaterialNode(app);
        const targets = promptWidgetTargets(node);
        if (!node || !targets.length) { text(targetArea, 'p', t('promptSelectTextNode')); return; }
        text(targetArea, 'strong', t('materialApplyingTo', { name: materialNodeHeading(node), id: node.id }));
        const widget = text(targetArea, 'select', ''); widget.setAttribute('aria-label', t('promptTargetWidget'));
        for (const target of targets) text(widget, 'option', target.name).value = String(target.index);
        const role = text(targetArea, 'select', ''); role.setAttribute('aria-label', t('promptTargetRole'));
        for (const value of ['positive', 'negative']) text(role, 'option', t(`promptFinal_${value}`)).value = value;
        for (const placement of ['before', 'after']) {
            const action = text(targetArea, 'button', t(`promptInsert_${placement}`), 'anomalous-btn-primary');
            action.onclick = async () => {
                try {
                    if (selectedMaterialNode(app) !== node) throw new Error('materialTargetChanged');
                    const index = Number(widget.value);
                    if (!promptWidgetTargets(node).some(target => target.index === index)) throw new Error('materialTargetChanged');
                    const content = composePromptPlan(draft.plan)[role.value];
                    if (!content.trim()) return;
                    const value = joinPromptText(node.widgets[index].value, content, placement);
                    showMaterialApplication(targetArea, applyNodeMaterialValues(app, node, [{ index, value }]), node);
                } catch (error) { await anomalousAlert(t(error.message) === error.message ? t('materialApplyFailed') : t(error.message)); }
            };
        }
    };
    owner.refreshPromptTarget = renderTarget;
    const actions = text(view, 'div', '', 'anomalous-prompt-actions');
    const save = text(actions, 'button', t('promptSavePlan'), 'anomalous-btn-primary');
    save.onclick = async () => {
        if (!draft.name.trim()) { name.focus(); return; }
        save.disabled = true;
        const body = clone(draft);
        const send = () => fetch('/anomalous/save_prompt_plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        try {
            let response = await send();
            if (response.status === 409) {
                const duplicate = await response.json();
                if (!await anomalousConfirm(t('materialDuplicateConfirm', { name: duplicate.name }))) return;
                body.allow_duplicate = true; response = await send();
            }
            const payload = await jsonResponse(response, 'prompt save failed');
            if (payload.status !== 'success') throw new Error('prompt save failed');
            showMaterialSaved(owner, payload.material);
        } catch (error) { await anomalousAlert(t('materialSaveError')); }
        finally { save.disabled = false; }
    };
    const exportPlan = text(actions, 'button', t('promptExportPlan'), 'anomalous-btn-ghost');
    exportPlan.onclick = () => {
        if (!draft.name.trim()) { name.focus(); return; }
        const blob = new Blob([JSON.stringify({ format: 'anomalous-prompt-plan-v1', ...draft }, null, 2)], { type: 'application/json' });
        if (blob.size > 2 * 1024 * 1024 || draft.tags.length > 20 || draft.tags.some(tag => tag.length > 60)) {
            return anomalousAlert(t('promptExportError'));
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'prompt-plan.json'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const reset = text(actions, 'button', t('promptNewDraft'), 'anomalous-btn-ghost');
    reset.onclick = async () => { if (await anomalousConfirm(t('promptReplaceDraft'))) { owner.promptPlanDraft = newDraft(); showPromptComposer(owner); } };
    renderTarget();
}


function applyPromptDrop(node, data, graph, parent) {
    const targets = promptWidgetTargets(node);
    const apply = index => {
        if (app.graph !== graph || graph.getNodeById(node.id) !== node || !promptWidgetTargets(node).some(target => target.index === index)) throw new Error('materialTargetChanged');
        const value = joinPromptText(node.widgets[index].value, data.content, data.position);
        showMaterialApplication(parent, applyNodeMaterialValues(app, node, [{ index, value }]), node);
    };
    if (targets.length === 1) { apply(targets[0].index); return; }
    if (!targets.length) throw new Error('materialNoCompatibleValues');
    const dialog = text(document.body, 'dialog', '', 'anomalous-material-choice');
    text(dialog, 'h3', t('promptChooseTarget'));
    const status = text(dialog, 'p', ''); status.setAttribute('role', 'alert');
    for (const target of targets) {
        const choose = text(dialog, 'button', target.name, 'anomalous-btn-primary');
        choose.onclick = () => {
            try { apply(target.index); dialog.close(); }
            catch (error) { status.textContent = t(error.message) === error.message ? t('materialApplyFailed') : t(error.message); }
        };
    }
    const close = text(dialog, 'button', t('close'), 'anomalous-btn-ghost'); close.onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove(); dialog.showModal();
}
