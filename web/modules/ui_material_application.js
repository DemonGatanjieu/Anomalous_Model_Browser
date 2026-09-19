import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { text, jsonResponse } from './ui_dom.js';
import { anomalousAlert } from './ui_dialog.js';
import { escapeHtml } from './safe_dom.js';
import { applyPromptRolesToBlocks, materialNodeHeading } from './material_inspector.js';
import { applyMaterialBlock, applyNodeMaterialValues, promptWidgetTargets, selectedMaterialNode } from './node_material_actions.js';
import { getMaterialPromptInfo } from './ui_material_detail.js';

export function showMaterialApplication(parent, result, node) {
    parent.querySelector('.anomalous-material-application-result')?.remove();
    const receipt = text(parent, 'div', '', 'anomalous-material-application-result');
    receipt.setAttribute('role', 'status');
    const status = text(receipt, 'span', node ? t('materialAppliedTarget', { name: materialNodeHeading(node), id: node.id }) : t('materialNodeApplied'));
    const undo = text(receipt, 'button', t('materialUndo'), 'anomalous-btn-ghost');
    undo.type = 'button';
    undo.onclick = () => {
        try { result.undo(); status.textContent = t('materialUndone'); undo.remove(); }
        catch (error) { status.textContent = t(error.message); }
    };
}

export function applyMaterialToSelectedNode(node, block, hashes, parent) {
    if (selectedMaterialNode(app) !== node) throw new Error('materialTargetChanged');
    return applyMaterialToNode(node, block, hashes, parent);
}

export function applyMaterialToNode(node, block, hashes, parent) {
    const result = applyMaterialBlock(app, node, block, hashes);
    showMaterialApplication(parent, result, node);
    return result;
}

export async function fetchMaterial(filename, options = {}) {
    const query = new URLSearchParams({ filename, include_workflow: options.includeWorkflow ? '1' : '0' });
    const response = await fetch(`/anomalous/material_full?${query}`, {
        cache: 'no-store',
        signal: options.signal,
    });
    const payload = await jsonResponse(response, 'material load failed');
    if (payload.status !== 'success') throw new Error(payload.message || 'material load failed');
    return payload;
}

export function updateMaterialContext(owner) {
    const node = selectedMaterialNode(app);
    owner.materialTarget = node;
    if (!node) owner.materialApplyMode = false;
    if (!owner.materialContext) return;
    owner.materialContext.replaceChildren();
    text(owner.materialContext, 'strong', node
        ? t(owner.materialApplyMode ? 'materialApplyingTo' : 'materialSelectedTarget', { name: materialNodeHeading(node), id: node.id })
        : t('materialSelectOneNode'));
    if (node) {
        const toggle = text(owner.materialContext, 'button', t(owner.materialApplyMode ? 'materialBrowseAll' : 'materialShowCompatible'), 'anomalous-btn-ghost');
        toggle.onclick = () => {
            owner.materialApplyMode = !owner.materialApplyMode;
            owner.materialKind = '';
            owner.materialKindCategory = 'all';
            if (owner.materialKindPills) {
                for (const p of Object.values(owner.materialKindPills)) p.classList.remove('is-active');
                owner.materialKindPills.all?.classList.add('is-active');
            }
            if (owner.materialKindInput) owner.materialKindInput.value = '';
            owner.refreshMaterials(1);
        };
    }
    text(owner.materialContext, 'small', node
        ? t('materialApplyContextHint')
        : (t('materialDragGlobalHint') || '💡 提示：按住卡片直接拖到画布节点上注入参数，拖到空白处载入工作流'));
}

export function watchMaterialSelection(owner, showMaterialDetail) {
    if (owner.materialSelectionHooked || !app.canvas) return;
    owner.materialSelectionHooked = true;
    window.addEventListener('anomalous-language-change', async () => {
        if (owner.nbPanel?.style.display !== 'flex' || owner.materialView?.style.display !== 'flex') return;
        const detail = owner.materialOpenedDetail;
        await owner.showMaterials();
        if (detail) await showMaterialDetail(owner, detail);
    });
    let scheduled = false;
    for (const key of ['onNodeSelected', 'onNodeDeselected']) {
        const previous = app.canvas[key];
        app.canvas[key] = function (...args) {
            const result = previous?.apply(this, args);
            if (!scheduled) {
                scheduled = true;
                queueMicrotask(() => {
                    scheduled = false;
                    if (owner.nbPanel?.style.display === 'none' || owner.materialView?.style.display !== 'flex') return;
                    const target = selectedMaterialNode(app);
                    if (target !== owner.materialTarget) {
                        owner.materialTarget = target;
                        owner.materialApplyMode = !!target && !(owner.materialKindCategory === 'prompts' || ['prompt_plan', 'prompt_text', 'prompt_note_bundle'].includes(owner.materialKind));
                        updateMaterialContext(owner);
                        if (!owner.materialDetailView) owner.refreshMaterials(1);
                    }
                });
            }
            return result;
        };
    }
}

export async function applyLibraryMaterial(owner, material, droppedNode = null, graph = app.graph) {
    const node = droppedNode || selectedMaterialNode(app);
    if (!node) { await anomalousAlert(t('materialTargetChanged')); return; }
    if (owner.materialApplying) return;
    owner.materialApplying = true;
    try {
        const payload = await fetchMaterial(material.filename);
        if (app.graph !== graph || graph.getNodeById(node.id) !== node || (!droppedNode && selectedMaterialNode(app) !== node)) throw new Error('materialTargetChanged');
        if (owner.nbPanel?.style.display !== 'flex' || owner.materialView?.style.display !== 'flex'
            || (owner.modal && !owner.modal.classList.contains('visible'))) return;
        let blocks = applyPromptRolesToBlocks(payload.node_blocks || [], payload.prompt_roles)
            .filter(block => block.type === node.type && block.widgets_values?.length);
        const promptTargets = promptWidgetTargets(node);
        if (!blocks.length && promptTargets.length > 0) {
            const allBlocks = applyPromptRolesToBlocks(payload.node_blocks || [], payload.prompt_roles);
            blocks = allBlocks.filter(b => Array.isArray(b.widgets_values) && b.widgets_values.some(v => typeof v === 'string' && v.trim()));
            if (!blocks.length) {
                const info = getMaterialPromptInfo(payload.data || material);
                if (info.text) {
                    blocks = [{
                        node_id: 1,
                        type: node.type,
                        title: info.role === 'negative'
                            ? (window.anomalous_browser_lang === 'zh' ? '负向提示词' : 'Negative Prompt')
                            : (window.anomalous_browser_lang === 'zh' ? '正向提示词' : 'Positive Prompt'),
                        promptRole: info.role,
                        widgets_values: [info.text],
                    }];
                }
            }
        }
        if (!blocks.length) throw new Error('materialNoCompatibleValues');

        const applyTarget = (targetBlock) => {
            if (targetBlock.type === node.type) {
                const apply = droppedNode ? applyMaterialToNode : applyMaterialToSelectedNode;
                return apply(node, targetBlock, payload.workflow_hashes, owner.materialContext);
            }
            if (selectedMaterialNode(app) !== node && !droppedNode) throw new Error('materialTargetChanged');
            const targetWidget = promptWidgetTargets(node)[0];
            if (!targetWidget) throw new Error('materialNoCompatibleValues');
            let textVal = '';
            if (Array.isArray(targetBlock.widgets_values)) {
                for (const v of targetBlock.widgets_values) {
                    if (typeof v === 'string' && v.trim()) {
                        textVal = v;
                        break;
                    }
                }
            }
            if (!textVal) throw new Error('materialNoCompatibleValues');
            const result = applyNodeMaterialValues(app, node, [{ index: targetWidget.index, value: textVal }], {
                sourceNodeId: targetBlock.node_id,
                workflowHashes: payload.workflow_hashes,
            });
            showMaterialApplication(owner.materialContext, result, node);
            return result;
        };

        if (blocks.length === 1) {
            applyTarget(blocks[0]);
        } else {
            owner.materialBlockDialog?.close();
            const dialog = document.createElement('dialog'); dialog.className = 'anomalous-material-choice';
            owner.materialBlockDialog = dialog;
            text(dialog, 'h3', t('materialChooseBlock'));
            const status = text(dialog, 'p', ''); status.setAttribute('role', 'alert');

            const list = document.createElement('div');
            list.className = 'anomalous-material-choice-list';
            list.style.cssText = 'display:flex;flex-direction:column;gap:12px;margin:14px 0;max-height:60vh;overflow-y:auto;padding-right:4px;';
            dialog.appendChild(list);

            for (const block of blocks) {
                const itemCard = document.createElement('div');
                itemCard.className = 'anomalous-material-choice-card';
                itemCard.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:8px;transition:border-color 0.2s;';

                const headerRow = document.createElement('div');
                headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';

                const roleBadge = {
                    positive: `[🟢 ${t('recipePromptRolePositive') || '正向'}] `,
                    negative: `[🔴 ${t('recipePromptRoleNegative') || '负向'}] `,
                    both: `[🟣 ${t('recipePromptRoleBoth') || '混合'}] `,
                }[block.promptRole] || '';

                const heading = document.createElement('div');
                heading.style.cssText = 'font-weight:700;font-size:13px;color:#f3f4f6;display:flex;align-items:center;gap:6px;';
                heading.innerHTML = `${roleBadge}<span>${escapeHtml(materialNodeHeading(block))} <small style="color:#9ca3af;font-size:11px;">#${block.node_id}</small></span>`;
                headerRow.appendChild(heading);
                itemCard.appendChild(headerRow);

                // Find text snippet or parameter summary
                let textContent = '';
                if (Array.isArray(block.widgets_values)) {
                    for (const val of block.widgets_values) {
                        if (typeof val === 'string' && val.trim().length > 0) {
                            textContent = val.trim();
                            break;
                        }
                    }
                }

                if (textContent) {
                    const previewBox = document.createElement('div');
                    previewBox.className = 'anomalous-material-snippet-box';
                    previewBox.style.cssText = 'background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:8px 10px;font-size:11px;color:#d1d5db;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:80px;overflow:hidden;position:relative;transition:max-height 0.25s ease;';

                    const textSpan = document.createElement('span');
                    textSpan.textContent = textContent;
                    previewBox.appendChild(textSpan);
                    itemCard.appendChild(previewBox);

                    if (textContent.length > 80 || textContent.includes('\n')) {
                        const toggleBtn = document.createElement('button');
                        toggleBtn.type = 'button';
                        toggleBtn.style.cssText = 'background:none;border:none;color:#60a5fa;cursor:pointer;font-size:11px;padding:2px 0;align-self:flex-start;text-decoration:underline;';
                        toggleBtn.textContent = t('expandText') || '展开全部 ▾';
                        let expanded = false;
                        toggleBtn.onclick = (e) => {
                            e.stopPropagation();
                            expanded = !expanded;
                            if (expanded) {
                                previewBox.style.maxHeight = '240px';
                                previewBox.style.overflowY = 'auto';
                                toggleBtn.textContent = t('collapseText') || '收起 ▴';
                            } else {
                                previewBox.style.maxHeight = '80px';
                                previewBox.style.overflow = 'hidden';
                                toggleBtn.textContent = t('expandText') || '展开全部 ▾';
                            }
                        };
                        itemCard.appendChild(toggleBtn);
                    }
                } else if (Array.isArray(block.widgets_values) && block.widgets_values.length > 0) {
                    const paramsSummary = document.createElement('div');
                    paramsSummary.style.cssText = 'font-size:11px;color:#9ca3af;background:rgba(0,0,0,0.2);padding:6px 8px;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                    paramsSummary.textContent = block.widgets_values.slice(0, 5).join(' · ');
                    itemCard.appendChild(paramsSummary);
                }

                const choose = document.createElement('button');
                choose.className = 'anomalous-btn-primary';
                choose.style.cssText = 'align-self:flex-end;padding:7px 14px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer;border-radius:6px;';
                choose.textContent = t('materialUseBlock') || (textContent ? '选用此段文本 ➔' : '应用此组参数 ➔');
                choose.onclick = async () => {
                    try {
                        if (app.graph !== graph) throw new Error('materialTargetChanged');
                        applyTarget(block);
                        dialog.close();
                    } catch (error) {
                        status.textContent = t(error.message) === error.message ? t('materialApplyFailed') : t(error.message);
                    }
                };
                itemCard.appendChild(choose);
                list.appendChild(itemCard);
            }

            const close = text(dialog, 'button', t('close'), 'anomalous-btn-ghost');
            close.style.cssText = 'margin-top:10px;align-self:flex-end;';
            close.onclick = () => dialog.close();
            dialog.onclose = () => { dialog.remove(); if (owner.materialBlockDialog === dialog) owner.materialBlockDialog = null; };
            document.body.appendChild(dialog);
            dialog.showModal();
        }
    } catch (error) { await anomalousAlert(t(error.message) === error.message ? t('materialApplyFailed') : t(error.message)); }
    finally { owner.materialApplying = false; }
}
