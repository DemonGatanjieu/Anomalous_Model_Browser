/** Material Library list-card rendering and inline title editing. */

import { app } from '../../../scripts/app.js';
import { bindMaterialDrag } from './material_drag.js';
import { translate } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { text, jsonResponse } from './ui_dom.js';
import { materialNodeHeading } from './material_inspector.js';
import {
    carriesPrompt, clearDropPreview, markTargetBox, outlinePromptBoxes, parameterDropHint, prepareMaterialDrag,
    previewPromptDrop, promptBoxAt, promptDropHint, promptRefusal,
} from './prompt_drop.js';
import { applyLibraryMaterial, fetchMaterial } from './ui_material_application.js';
import { extractMaterialPromptEnvelope } from './node_material_actions.js';
import { recordCanvasStep } from './canvas_history.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import {
    deleteMaterial,
    getMaterialPlaceholderSvg,
    isPromptMaterial,
    materialAssetUrl,
    openMaterialWorkflow,
    promptKindLabel,
    renderSourceRecipeMark,
    showMaterialDetail,
} from './ui_material_detail.js';

const t = (key, params) => translate(key, params);

/** Undo for the prompt nodes a drop created: removed while still there and unconnected. */
function removeMade(graph, nodes) {
    const loose = node => graph.getNodeById(node.id) === node
        && !(node.inputs || []).some(input => input?.link != null) && !(node.outputs || []).some(output => output?.links?.length);
    if (app.graph !== graph || !nodes.every(loose)) { showWorkbenchToast(t('materialUndoChanged')); return; }
    graph.beforeChange?.();
    try { for (const node of nodes) graph.remove(node); } finally { graph.afterChange?.(); }
    graph.setDirtyCanvas?.(true, true);
    recordCanvasStep(app);
}

function startInlineTitleEdit(owner, material, titleRow, cardTitle, editBtn) {
    if (titleRow.querySelector('.anomalous-material-inline-input')) return;
    const originalName = material.name || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'anomalous-material-inline-input';
    input.value = originalName;
    input.maxLength = 120;
    input.placeholder = t('materialName') || '输入短标题…';

    cardTitle.style.display = 'none';
    editBtn.style.display = 'none';
    titleRow.appendChild(input);
    input.focus();
    input.select();

    let isSaving = false;
    const finish = async (shouldSave) => {
        if (isSaving) return;
        const newName = input.value.trim();
        if (shouldSave && newName && newName !== originalName) {
            isSaving = true;
            input.disabled = true;
            try {
                const response = await fetch('/anomalous/update_material', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: material.filename,
                        name: newName,
                        tags: material.tags || [],
                    }),
                });
                const payload = await jsonResponse(response, 'material update failed');
                if (payload.status === 'success' && payload.material) {
                    Object.assign(material, payload.material);
                    cardTitle.textContent = material.name;
                    cardTitle.title = material.name;
                }
            } catch (err) {
                console.warn('Failed to update title:', err);
            }
        }
        input.remove();
        cardTitle.style.display = '';
        editBtn.style.display = '';
    };

    input.onclick = (e) => e.stopPropagation();
    input.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            finish(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
        }
    };
    input.onblur = () => finish(true);
}

function bindPolymorphicMaterialCardDrag(card, owner, material) {
    const isZh = window.anomalous_browser_lang === 'zh';
    const isWorkflow = (material.capabilities || []).includes('open_workflow') || material.has_workflow;
    const isPrompt = isPromptMaterial(material) || material.kind === 'prompt_plan';

    let cardTitleText = `${material.name || t('materialUntitled')}`;
    let dragHint = '';
    let dragTargetHint = '';

    if (isWorkflow) {
        cardTitleText += ` — ${isZh ? '按住拖至空白画布载入完整工作流' : 'Drag to blank canvas to load workflow'}`;
        dragHint = isZh ? '拖拽至空白画布载入工作流' : 'Drag to blank canvas to load workflow';
        dragTargetHint = isZh ? '松开以载入完整工作流' : 'Release to load workflow';
    } else if (isPrompt) {
        cardTitleText += ` — ${t('promptDragTitle')}`;
        dragHint = t('promptDragHint');
        dragTargetHint = t('promptDragCanvas');
    } else {
        cardTitleText += ` — ${isZh ? '按住拖至节点注入参数，或拖至空白处新建对应节点' : 'Drag to node to apply parameters, or to blank canvas to create node'}`;
        dragHint = t('materialDragParameters') || (isZh ? '拖拽素材参数至目标节点' : 'Drag parameters to target node');
        dragTargetHint = isZh ? '松开以在空白画布创建对应节点' : 'Release to create node on blank canvas';
    }

    card.title = cardTitleText;
    // A prompt goes into the box under the pointer (prompt_drop.js); other values need the same node type.
    const prompt = carriesPrompt(material, isPrompt);

    bindMaterialDrag(card, owner, {
        payload: () => ({
            ...material,
            node_types: Array.isArray(material.node_types) ? [...material.node_types] : [],
            dragHint,
            dragTargetHint,
        }),
        accepts: (node, source, event) => (prompt && !promptRefusal(node, event)) || (source.node_types || []).includes(node.type),
        targetHint: (node, source, event) => {
            const box = prompt ? promptBoxAt(node, event) : null;
            return box ? promptDropHint(source, node, box) : parameterDropHint(source, node);
        },
        rejectHint: (node, source, event) => (prompt ? promptRefusal(node, event) : ''),
        onStart: (source) => {
            prepareMaterialDrag(source);
            if (!prompt) return null;
            const removeOutlines = outlinePromptBoxes(app.graph);
            return () => { clearDropPreview(); removeOutlines(); };
        },
        onMove: (node, source, event) => {
            if (!prompt) return;
            const box = node && promptBoxAt(node, event);
            markTargetBox(box);
            previewPromptDrop(source, node, box);
        },
        drop: (node, source, graph, event) => applyLibraryMaterial(owner, source, node, graph, { box: prompt ? promptBoxAt(node, event) : null }),
        dropOnCanvas: async (event, source, graph, position) => {
            if (isWorkflow) {
                await openMaterialWorkflow(owner, source.filename);
                return;
            }

            const creator = (typeof LiteGraph !== 'undefined' ? LiteGraph?.createNode : null)
                || globalThis.LiteGraph?.createNode
                || window.LiteGraph?.createNode;
            if (!creator) return;

            const pos = position || (app.canvas?.convertEventToCanvasOffset
                ? app.canvas.convertEventToCanvasOffset(event)
                : [100, 100]);

            if (isPrompt) {
                // One prompt node per side the material has; the list summary may not carry the text.
                const payload = await fetchMaterial(source.filename);
                if (app.graph !== graph) throw new Error('materialTargetChanged');
                const envelope = extractMaterialPromptEnvelope(source, payload);
                const sides = [['positive', envelope.positive], ['negative', envelope.negative]].filter(([, value]) => value);
                if (!sides.length && envelope.singleText) sides.push([envelope.primaryRole === 'negative' ? 'negative' : 'positive', envelope.singleText]);
                if (!sides.length) throw new Error('materialNoCompatibleValues');
                const made = [];
                sides.forEach(([role, value], index) => {
                    const isNegative = role === 'negative';
                    const node = creator.call(LiteGraph, 'CLIPTextEncode');
                    if (!node) return;
                    node.title = isNegative
                        ? (isZh ? 'CLIP 文本编码器 (负向)' : 'CLIP Text Encode (Negative)')
                        : (isZh ? 'CLIP 文本编码器 (正向)' : 'CLIP Text Encode (Positive)');
                    node.color = isNegative ? '#532323' : '#235327';
                    node.bgcolor = isNegative ? '#381616' : '#143818';
                    node.pos = [pos[0], pos[1] + index * 260];
                    graph.add(node);
                    made.push(node);
                    const box = node.widgets?.find(widget => widget.name === 'text');
                    if (box) {
                        box.value = value;
                        box.callback?.call(box, value, app.canvas, node);
                        node.onWidgetChanged?.(box.name, value, '', box);
                    }
                });
                if (made.length) app.canvas?.selectNode?.(made[0]);
                app.canvas?.setDirty?.(true, true);
                graph.change?.();
                recordCanvasStep(app);
                if (made.length) showWorkbenchToast(t('promptNodesCreated', { count: made.length }), { label: t('activityUndo'), run: () => removeMade(graph, made) });
                return;
            }

            if (source.node_types?.length) {
                const nodeType = source.node_types[0];
                const node = creator.call(LiteGraph, nodeType);
                if (node) {
                    node.pos = [pos[0], pos[1]];
                    graph.add(node);
                    app.canvas?.selectNode?.(node);
                    app.canvas?.setDirty?.(true, true);
                    graph.change?.();
                    recordCanvasStep(app);
                    try {
                        await applyLibraryMaterial(owner, source, node, graph);
                    } catch (err) {
                        console.warn('[AMB] Error applying parameters to newly created node:', err);
                    }
                }
            }
        },
    });
}

export function renderMaterialCard(owner, material) {
    const card = document.createElement('article');
    card.className = 'anomalous-material-card';
    const activate = () => showMaterialDetail(owner, material);
    card.onclick = activate;
    bindPolymorphicMaterialCardDrag(card, owner, material);
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${material.name} — ${t('materialViewDetails')}`);
    card.onkeydown = event => {
        if (event.target === card && ['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            activate();
        }
    };

    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'anomalous-material-card-actions-wrapper';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'anomalous-material-card-action-btn anomalous-material-card-delete';
    remove.innerHTML = '<svg style="width:13px;height:13px;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
    remove.title = t('materialDelete');
    remove.onclick = (e) => {
        e.stopPropagation();
        deleteMaterial(owner, material);
    };
    card.appendChild(remove);
    const removeClone = typeof remove.cloneNode === 'function' ? remove.cloneNode(true) : document.createElement('button');
    actionsWrapper.appendChild(removeClone);
    removeClone.onclick = remove.onclick;

    if (!owner.materialApplyMode && (material.capabilities || []).includes('open_workflow')) {
        const quickOpen = document.createElement('button');
        quickOpen.type = 'button';
        quickOpen.className = 'anomalous-material-card-action-btn anomalous-material-card-quick-load';
        quickOpen.innerHTML = '<svg style="width:13px;height:13px;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        quickOpen.title = t('materialOpenWorkflow');
        quickOpen.onclick = async (e) => {
            e.stopPropagation();
            try {
                await openMaterialWorkflow(owner, material.filename);
            } catch (error) {
                await anomalousAlert(t('materialOpenError'));
            }
        };
        card.appendChild(quickOpen);
        const quickOpenClone = typeof quickOpen.cloneNode === 'function' ? quickOpen.cloneNode(true) : document.createElement('button');
        actionsWrapper.appendChild(quickOpenClone);
        quickOpenClone.onclick = quickOpen.onclick;
    }

    const preview = document.createElement('div');
    preview.className = 'anomalous-material-card-preview';
    const previewUrl = materialAssetUrl(material.filename, material.image?.preview_asset_id || material.image?.source_asset_id);
    if (previewUrl) {
        const image = document.createElement('img');
        image.src = previewUrl;
        image.alt = material.name || t('materialUntitled');
        image.loading = 'lazy';
        image.draggable = false;
        preview.appendChild(image);
    } else {
        if (isPromptMaterial(material) || material.kind === 'prompt_plan') {
            preview.classList.add('is-prompt-fallback');
            preview.innerHTML = getMaterialPlaceholderSvg(material, 28);
            const snippet = document.createElement('div');
            snippet.className = 'anomalous-material-preview-snippet';
            snippet.textContent = material.summary || material.name || 'Prompt Note';
            preview.appendChild(snippet);
        } else if (material.kind === 'recipe_parameter_selection') {
            preview.classList.add('is-params-fallback');
            preview.innerHTML = getMaterialPlaceholderSvg(material, 28);
            const snippet = document.createElement('div');
            snippet.className = 'anomalous-material-preview-snippet';
            snippet.textContent = material.name || 'Parameters Scheme';
            preview.appendChild(snippet);
        } else {
            preview.classList.add('is-workflow-fallback');
            preview.innerHTML = getMaterialPlaceholderSvg(material, 28);
        }
    }
    card.appendChild(preview);

    const body = document.createElement('div');
    body.className = 'anomalous-material-card-body';

    const titleRow = document.createElement('div');
    titleRow.className = 'anomalous-material-card-title-row';

    const cardTitle = document.createElement('h3');
    cardTitle.className = 'anomalous-material-card-title-text';
    cardTitle.textContent = material.name || t('materialUntitled');
    cardTitle.title = material.name || t('materialUntitled');
    titleRow.appendChild(cardTitle);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'anomalous-material-card-edit-btn';
    editBtn.title = t('materialQuickEditTitle') || '修改短标题';
    editBtn.innerHTML = `
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z"></path>
        </svg>
    `;
    editBtn.onclick = (e) => {
        e.stopPropagation();
        startInlineTitleEdit(owner, material, titleRow, cardTitle, editBtn);
    };
    titleRow.appendChild(editBtn);
    body.appendChild(titleRow);

    const metadata = document.createElement('div');
    metadata.className = 'anomalous-material-card-meta';
    if (material.kind === 'prompt_plan') {
        text(metadata, 'span', t('promptPlan'), 'anomalous-material-scope-badge');
    } else if (isPromptMaterial(material)) {
        text(metadata, 'span', promptKindLabel(material), 'anomalous-material-scope-badge is-prompt');
    } else if (material.kind === 'recipe_parameter_selection') {
        text(metadata, 'span', t('materialRecipeParameterMaterial'), 'anomalous-material-scope-badge is-nodes');
    } else if (material.selection?.scope === 'nodes') {
        const isPromptOnly = Array.isArray(material.node_types) &&
            material.node_types.length > 0 &&
            material.node_types.every(tp => /cliptextencode/i.test(tp));
        const badgeText = isPromptOnly
            ? `💬 ${t('materialPromptNode') || '提示词'}`
            : t('materialSelectedNodeMaterial');
        text(metadata, 'span', badgeText, 'anomalous-material-scope-badge is-nodes');
    } else {
        text(metadata, 'span', t('materialFullWorkflowMaterial'), 'anomalous-material-scope-badge is-workflow');
    }
    if (!isPromptMaterial(material) && material.kind !== 'prompt_plan') text(metadata, 'span', t('materialNodeSummary', { count: material.node_count || 0 }), 'anomalous-material-meta-pill');
    body.appendChild(metadata);

    const secondaryRow = document.createElement('div');
    secondaryRow.className = 'anomalous-material-card-subinfo';
    if (material.timestamp) {
        const dateStr = new Date(material.timestamp).toLocaleDateString();
        text(secondaryRow, 'span', dateStr, 'anomalous-material-card-date');
    }
    renderSourceRecipeMark(secondaryRow, material.source_recipe);
    if (secondaryRow.hasChildNodes()) {
        body.appendChild(secondaryRow);
    }

    if (Array.isArray(material.node_types) && material.node_types.length) {
        const displayLimit = 2;
        const shownTypes = material.node_types.slice(0, displayLimit);
        const labels = shownTypes.map(type => materialNodeHeading({ type }));
        const remaining = material.node_types.length - shownTypes.length;
        let summaryText = labels.join(' · ');
        if (remaining > 0) {
            summaryText += t('materialOtherNodeTypes', { count: remaining });
        }
        const types = text(body, 'small', summaryText, 'anomalous-material-types');
        types.title = material.node_types.map(type => materialNodeHeading({ type })).join(' · ');
    }
    if (material.tags?.length) {
        const tags = text(body, 'div', '', 'anomalous-material-tags');
        material.tags.forEach(tag => text(tags, 'span', tag, 'anomalous-material-tag'));
    }
    if (owner.materialApplyMode) {
        // One apply button per card, in both grid and list layouts. The locale text already carries its icon.
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'anomalous-material-card-apply-btn';
        applyBtn.textContent = t('assistantApplyScheme');
        applyBtn.title = t('materialApplyCard');
        applyBtn.onclick = async (e) => {
            e.stopPropagation();
            applyBtn.disabled = true;
            applyBtn.textContent = t('assistantApplying');
            try {
                await applyLibraryMaterial(owner, material);
                applyBtn.textContent = t('assistantApplied');
                setTimeout(() => {
                    applyBtn.disabled = false;
                    applyBtn.textContent = t('assistantApplyScheme');
                }, 2000);
            } catch (err) {
                console.error(err);
                applyBtn.disabled = false;
                applyBtn.textContent = t('assistantApplyScheme');
            }
        };
        body.appendChild(applyBtn);
    }
    card.appendChild(body);
    card.appendChild(actionsWrapper);

    return card;
}
