/** Workflow Recipe parameter tabs, prompt roles, raw nodes, and preset saving. */

import { escapeHtml } from "./safe_dom.js";
import { showMaterialSaved } from "./material_feedback.js";
import { app } from "../../../scripts/app.js";
import { translate } from "./locales.js";
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from "./ui_dialog.js";
import { applyRecipeParametersToCanvas, assertRecipeSkeleton } from "./recipe_actions.js";
import { applyRecipeWidgetChanges, captureRecipeDraft, isSupportedPromptNodeType } from "./recipe_parser.js";
import { PROMPT_ROLES, appendCopyButton, appendText, appendValueViewer, button, dateText, displayValue } from "./ui_recipe_detail_dom.js";
import { openGalleryImageDetail, outputImageUrl, renderRecipeGallery } from "./ui_recipe_gallery.js";
import { updateRecipeMetadata } from "./ui_recipe_metadata.js";
import { cloneJson, editorValueText, formatRecipeResolution, isVolatileParameter, parameterNodeOrder, parseEditorValue, promptRoleLabel } from "./ui_recipe_parameter_utils.js";

const t = (key, params) => translate(key, params);
const PROMPT_WIDGET_NAME = /^(?:text|prompt|positive|negative|conditioning|clip_text)$/i;

function promptTextForNode(source, node) {
    const values = [];
    for (const widget of node?.widgets || []) {
        if (!PROMPT_WIDGET_NAME.test(String(widget?.name || ''))) continue;
        const value = fullWidgetValue(source, node, widget);
        if (typeof value === 'string' && value.trim() && !values.includes(value.trim())) values.push(value.trim());
    }
    if (!values.length && isSupportedPromptNodeType(node?.type)) {
        const workflowNode = (source?.workflow?.nodes || []).find((candidate) => String(candidate?.id) === String(node?.id));
        const value = workflowNode?.widgets_values?.find((candidate) => typeof candidate === 'string' && candidate.trim());
        if (value) values.push(value.trim());
    }
    return values.join('\n\n');
}

function legacyPromptRole(params, text) {
    if (!text) return null;
    const positive = new Set(Array.isArray(params?.promptPositive) ? params.promptPositive : []);
    const negative = new Set(Array.isArray(params?.promptNegative) ? params.promptNegative : []);
    if (positive.has(text) && !negative.has(text)) return 'positive';
    if (negative.has(text) && !positive.has(text)) return 'negative';
    return null;
}

function promptEntries(source, roleOwner = source) {
    const params = source?.params || {};
    const roleParams = roleOwner?.params || {};
    const overrides = roleParams.promptRoleOverrides || {};
    const entries = [];
    for (const node of params.nodes || []) {
        const text = promptTextForNode(source, node);
        if (!text) continue;
        const isKnown = isSupportedPromptNodeType(node?.type);
        const isTextCandidate = isKnown || (node.widgets || []).some((widget) => PROMPT_WIDGET_NAME.test(String(widget?.name || '')));
        if (!isTextCandidate) continue;
        const override = overrides[String(node.id)]?.role;
        const automaticRole = PROMPT_ROLES.has(node.role)
            ? node.role
            : (isKnown ? legacyPromptRole(params, text) : null);
        entries.push({
            id: node.id,
            type: node.type || 'Unknown',
            title: node.title || node.type || t('recipeDetailUnknownNode'),
            text,
            supported: isKnown,
            automaticRole: automaticRole || 'unknown',
            role: PROMPT_ROLES.has(override) ? override : (automaticRole || 'unknown'),
            manual: PROMPT_ROLES.has(override),
        });
    }
    return entries;
}

export function promptValues(source, roleOwner = source) {
    const positive = [];
    const negative = [];
    const entries = promptEntries(source, roleOwner);
    for (const entry of entries) {
        if ((entry.role === 'positive' || entry.role === 'both') && !positive.includes(entry.text)) positive.push(entry.text);
        if ((entry.role === 'negative' || entry.role === 'both') && !negative.includes(entry.text)) negative.push(entry.text);
    }
    return { positive, negative, entries };
}

function paramsWithPromptRole(recipe, nodeId, selectedRole) {
    const params = JSON.parse(JSON.stringify(recipe?.params || {}));
    const overrides = { ...(params.promptRoleOverrides || {}) };
    const key = String(nodeId);
    if (selectedRole === 'auto') {
        delete overrides[key];
    } else if (PROMPT_ROLES.has(selectedRole)) {
        const workflowNode = (recipe?.workflow?.nodes || []).find((node) => String(node?.id) === key);
        overrides[key] = {
            role: selectedRole,
            nodeType: workflowNode?.type || (params.nodes || []).find((node) => String(node?.id) === key)?.type || 'Unknown',
            source: 'manual',
        };
    }
    if (Object.keys(overrides).length) params.promptRoleOverrides = overrides;
    else delete params.promptRoleOverrides;

    const owner = { ...recipe, params };
    const resolved = promptEntries(owner, owner);
    params.promptPositive = [...new Set(resolved.filter((entry) => entry.role === 'positive' || entry.role === 'both').map((entry) => entry.text))];
    params.promptNegative = [...new Set(resolved.filter((entry) => entry.role === 'negative' || entry.role === 'both').map((entry) => entry.text))];
    return params;
}

function fullWidgetValue(recipe, node, widget) {
    const workflowNode = (recipe?.workflow?.nodes || []).find((candidate) => String(candidate?.id) === String(node?.id));
    const index = Number.isInteger(widget?.index) ? widget.index : -1;
    if (index >= 0 && Array.isArray(workflowNode?.widgets_values) && workflowNode.widgets_values[index] !== undefined) {
        return workflowNode.widgets_values[index];
    }
    return widget?.value;
}

function renderParameterField(parent, label, value, options = {}) {
    if (value === undefined || value === null || value === '') return false;
    const row = document.createElement('div');
    row.className = 'anomalous-recipe-detail-parameter-row';
    const text = displayValue(value);
    if (options.wide || Array.isArray(value) || typeof value === 'object' || text.length > 35) {
        row.classList.add('is-wide');
    }
    appendText(row, 'span', label, 'anomalous-recipe-detail-label');
    appendValueViewer(
        row,
        options.redact ? t('recipeDetailVolatileIgnored') : value,
        '',
        { collapse: options.collapse !== false, copy: options.copy !== false && !options.redact },
    );
    parent.appendChild(row);
    return true;
}

async function saveParameterMaterial(owner, recipe, parameterState, nodeIds, name, actionButton) {
    if (!owner?.recipeDetailFilename || !actionButton || actionButton.disabled) return false;
    const originalLabel = actionButton.textContent;
    actionButton.disabled = true;
    actionButton.textContent = t('materialSaving');
    const body = {
        recipe_filename: owner.recipeDetailFilename,
        ...(parameterState?.selectedFilename ? { parameter_filename: parameterState.selectedFilename } : {}),
        ...(Array.isArray(nodeIds) && nodeIds.length ? { selected_node_ids: nodeIds } : {}),
        name: String(name || '').trim().slice(0, 120),
        tags: Array.isArray(recipe?.tags) ? recipe.tags : [],
    };
    const send = () => fetch('/anomalous/save_parameter_material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    try {
        let response = await send();
        if (response.status === 409) {
            const duplicate = await response.json();
            if (duplicate.status !== 'duplicate') throw new Error('parameter material conflict');
            if (!await anomalousConfirm(t('materialDuplicateConfirm', { name: duplicate.name }))) return false;
            body.allow_duplicate = true;
            response = await send();
        }
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'parameter material save failed');
        actionButton.textContent = t('materialSaved');
        showMaterialSaved(owner, payload.material);
        await owner.refreshMaterials?.();
        window.setTimeout(() => {
            if (!actionButton.isConnected) return;
            actionButton.textContent = originalLabel;
            actionButton.disabled = false;
        }, 1400);
        return true;
    } catch (error) {
        console.error('Could not save recipe parameter material:', error);
        await anomalousAlert(t('materialSaveError'));
        return false;
    } finally {
        if (actionButton.isConnected && actionButton.textContent !== t('materialSaved')) {
            actionButton.textContent = originalLabel;
            actionButton.disabled = false;
        }
    }
}

function renderParameterNotebookEditor(wrapper, owner, recipe, parameterState, source, selectParameterTab) {
    const editorState = parameterState.editor;
    editorState.draft.params = editorState.draft.params || {};
    const editor = document.createElement('section');
    editor.className = 'anomalous-recipe-detail-section anomalous-recipe-parameter-editor';
    const heading = document.createElement('div');
    heading.className = 'anomalous-recipe-detail-section-heading anomalous-recipe-parameter-editor-sticky-header';
    appendText(heading, 'h4', t('recipeParameterNew'));
    const actions = document.createElement('div');
    const cancel = button(actions, t('recipeParameterCancel'), 'anomalous-btn-ghost');
    cancel.onclick = () => {
        parameterState.editor = null;
        selectParameterTab?.();
    };
    const save = button(actions, t('recipeParameterSave'), 'anomalous-btn-primary');
    save.onclick = async () => {
        const name = nameInput.value.trim() || recipe.name || t('recipeParameterUntitled');
        save.disabled = true;
        try {
            const response = await fetch('/anomalous/save_parameter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    tags: recipe.tags || [],
                    notes: recipe.notes || '',
                    params: editorState.draft.params || {},
                    workflow: editorState.draft.workflow,
                    recipe_filename: owner.recipeDetailFilename,
                }),
            });
            if (!response.ok) throw new Error('parameter note save failed');
            parameterState.editor = null;
            parameterState.status = 'idle';
            parameterState.selectedFilename = null;
            await parameterState.refresh?.(true);
            selectParameterTab?.();
        } catch (error) {
            console.error('Could not save the new parameter notebook:', error);
            await anomalousAlert(t('recipeParameterSaveError'));
            save.disabled = false;
        }
    };
    actions.append(cancel, save);
    heading.appendChild(actions);
    editor.appendChild(heading);
    appendText(editor, 'p', t('recipeParameterNewHint'), 'anomalous-recipe-detail-muted');

    const nameRow = document.createElement('label');
    nameRow.className = 'anomalous-recipe-parameter-editor-name';
    appendText(nameRow, 'span', t('recipeParameterName'));
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 200;
    nameInput.value = editorState.name || `${recipe.name || t('recipeUntitled')} · ${t('recipeParameterNew')}`;
    nameRow.appendChild(nameInput);
    editor.appendChild(nameRow);

    const nodeList = document.createElement('div');
    nodeList.className = 'anomalous-recipe-detail-parameter-list anomalous-recipe-parameter-editor-list';
    let rendered = 0;
    for (const { summary: node, workflowNode } of parameterNodeOrder(editorState.draft)) {
        if (!workflowNode || !Array.isArray(workflowNode.widgets_values)) continue;
        const widgets = Array.isArray(node?.widgets) && node.widgets.length
            ? node.widgets
            : workflowNode.widgets_values.map((value, index) => ({ name: `${t('recipeDetailWidget')} ${index + 1}`, index, value }));
        const block = document.createElement('article');
        block.className = 'anomalous-recipe-detail-parameter-node';
        const titleText = [node.title, node.type].filter(Boolean).join(' · ') || t('recipeDetailUnknownNode');
        appendText(block, 'strong', titleText, 'anomalous-recipe-detail-node-title');
        
        const widgetsContainer = document.createElement('div');
        widgetsContainer.className = 'anomalous-recipe-detail-node-widgets';
        
        for (let visibleIndex = 0; visibleIndex < widgets.length && rendered < 1200; visibleIndex += 1) {
            const widget = widgets[visibleIndex] || {};
            const index = Number.isInteger(widget.index) ? widget.index : visibleIndex;
            if (index < 0 || index >= workflowNode.widgets_values.length) continue;
            const value = workflowNode.widgets_values[index];
            const row = document.createElement('label');
            row.className = 'anomalous-recipe-detail-parameter-row anomalous-recipe-parameter-editor-row';
            appendText(row, 'span', widget.name || `${t('recipeDetailWidget')} ${index + 1}`, 'anomalous-recipe-detail-parameter-name');
            const volatile = isVolatileParameter(node, widget, index);
            const sensitive = /(?:api.?key|access.?token|auth|password|passwd|secret|credential)/i.test(String(widget.name || ''));
            if (volatile || sensitive) {
                appendValueViewer(row, t(volatile ? 'recipeDetailVolatileIgnored' : 'recipeParameterSensitiveHidden'), '', { copy: false });
            } else {
                const input = document.createElement(typeof value === 'string' && (value.length > 100 || /text|prompt/i.test(String(widget.name || ''))) ? 'textarea' : 'input');
                input.className = 'anomalous-recipe-parameter-editor-input';
                input.value = editorValueText(value);
                if (input.tagName === 'TEXTAREA') input.rows = Math.min(8, Math.max(3, input.value.split(/\r?\n/).length));
                input.onchange = () => {
                    try {
                        const next = parseEditorValue(input.value, value);
                        applyRecipeWidgetChanges(editorState.draft.params || {}, editorState.draft.workflow, [{
                            nodeId: workflowNode.id,
                            widgetIndex: index,
                            value: next,
                            previousValue: value,
                        }]);
                        workflowNode.widgets_values[index] = next;
                        input.classList.remove('is-invalid');
                    } catch (error) {
                        input.classList.add('is-invalid');
                        console.warn('Parameter input invalid:', error);
                    }
                };
                row.appendChild(input);
            }
            widgetsContainer.appendChild(row);
            rendered += 1;
        }
        if (widgetsContainer.childElementCount) {
            block.appendChild(widgetsContainer);

            nodeList.appendChild(block);
        }
    }
    if (!nodeList.childElementCount) appendText(nodeList, 'p', t('recipeDetailNoSavedParameters'), 'anomalous-recipe-detail-muted');
    editor.appendChild(nodeList);
    wrapper.appendChild(editor);
}

function renderRawNodesLazy(parent, source, options = {}) {
    const ordered = parameterNodeOrder(source);
    if (!ordered.length) return;
    const reusable = ordered.filter(({ workflowNode }) =>
        workflowNode?.id != null && Array.isArray(workflowNode.widgets_values) && workflowNode.widgets_values.length
    );
    const selectedIds = new Set();

    const details = document.createElement('details');
    details.className = 'anomalous-recipe-advanced-info anomalous-recipe-raw-nodes-details';
    details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'anomalous-recipe-raw-nodes-summary';
    const updateSummary = () => {
        const arrow = details.open ? '▾' : '▸';
        summary.textContent = `${arrow} ${t('recipeRawNodesToggle')} (${ordered.length} ${t('recipeRawNodesCount')})`;
    };
    updateSummary();
    details.appendChild(summary);

    let selecting = false;
    let updateSelection = () => {};
    if (typeof options.onSaveNodes === 'function' && reusable.length) {
        const selectionBar = document.createElement('div');
        selectionBar.className = 'anomalous-recipe-material-selection';
        selectionBar.hidden = true;
        const choose = button(details, t('materialChooseParameters'), 'anomalous-btn-ghost');
        choose.setAttribute('aria-expanded', 'false');
        choose.onclick = () => {
            selecting = !selecting;
            selectionBar.hidden = !selecting;
            choose.textContent = t(selecting ? 'materialFinishSelection' : 'materialChooseParameters');
            choose.setAttribute('aria-expanded', String(selecting));
            if (!selecting) selectedIds.clear();
            updateSelection();
        };
        const selectionText = appendText(selectionBar, 'span', '', 'anomalous-workbench-node-selection-count');
        const selectAll = button(selectionBar, t('materialSelectAllNodes'), 'anomalous-btn-ghost');
        const clear = button(selectionBar, t('materialClearNodeSelection'), 'anomalous-btn-ghost');
        const saveSelected = button(selectionBar, t('materialSaveSelectedAction', { count: 0 }), 'anomalous-preset-btn-primary');
        updateSelection = () => {
            const count = selectedIds.size;
            selectionText.textContent = t('materialSelectedNodeCount', { count });
            saveSelected.textContent = t('materialSaveSelectedAction', { count });
            saveSelected.disabled = count === 0;
            details.querySelectorAll('.anomalous-recipe-material-node-select').forEach(input => {
                input.hidden = !selecting;
                input.checked = selectedIds.has(input.dataset.nodeId);
            });
        };
        selectAll.onclick = () => {
            reusable.forEach(({ workflowNode }) => selectedIds.add(String(workflowNode.id)));
            updateSelection();
        };
        clear.onclick = () => {
            selectedIds.clear();
            updateSelection();
        };
        saveSelected.onclick = () => options.onSaveNodes(
            [...selectedIds],
            t('materialSelectedNodesName', { count: selectedIds.size }),
            saveSelected,
        );
        updateSelection();
        details.appendChild(selectionBar);
    }

    const nodeList = document.createElement('div');
    nodeList.className = 'anomalous-recipe-detail-parameter-list';
    nodeList.style.marginTop = '12px';

    let renderedCount = 0;
    const PAGE_SIZE = 15;

    const renderNextBatch = () => {
        const batch = ordered.slice(renderedCount, renderedCount + PAGE_SIZE);
        for (const { summary: node, workflowNode } of batch) {
            const widgets = Array.isArray(node?.widgets) && node.widgets.length
                ? node.widgets
                : (Array.isArray(workflowNode?.widgets_values)
                    ? workflowNode.widgets_values.map((value, index) => ({
                        name: `${t('recipeDetailWidget')} ${index + 1}`,
                        index,
                        value,
                    }))
                    : []);
            if (!widgets.length) continue;
            const block = document.createElement('article');
            block.className = 'anomalous-recipe-detail-parameter-node';
            const title = [node.title, node.type].filter(Boolean).join(' · ') || t('recipeDetailUnknownNode');
            const nodeHeader = document.createElement('div');
            nodeHeader.className = 'anomalous-recipe-material-node-header';
            if (typeof options.onSaveNodes === 'function' && workflowNode?.id != null) {
                const select = document.createElement('input');
                select.type = 'checkbox';
                select.hidden = !selecting;
                select.className = 'anomalous-recipe-material-node-select';
                select.setAttribute('aria-label', t('materialSelectNodeForSaving'));
                select.dataset.nodeId = String(workflowNode.id);
                select.checked = selectedIds.has(select.dataset.nodeId);
                select.title = t('materialSelectNodeForSaving');
                select.onchange = () => {
                    if (select.checked) selectedIds.add(select.dataset.nodeId);
                    else selectedIds.delete(select.dataset.nodeId);
                    updateSelection();
                };
                nodeHeader.appendChild(select);
            }
            appendText(nodeHeader, 'strong', title, 'anomalous-recipe-detail-node-title');
            if (typeof options.onSaveNodes === 'function' && workflowNode?.id != null) {
                const saveNode = button(nodeHeader, t('materialSaveToLibraryShort'), 'anomalous-material-node-save');
                saveNode.onclick = () => options.onSaveNodes([workflowNode.id], title, saveNode);
            }
            block.appendChild(nodeHeader);
            const widgetsContainer = document.createElement('div');
            widgetsContainer.className = 'anomalous-recipe-detail-node-widgets';
            for (let visibleIndex = 0; visibleIndex < widgets.length; visibleIndex += 1) {
                const widget = widgets[visibleIndex] || {};
                const index = Number.isInteger(widget.index) ? widget.index : visibleIndex;
                const value = Array.isArray(workflowNode?.widgets_values) && workflowNode.widgets_values[index] !== undefined
                    ? workflowNode.widgets_values[index]
                    : widget.value;
                const label = widget.name || `${t('recipeDetailWidget')} ${index + 1}`;
                const volatile = isVolatileParameter(node, widget, index);
                renderParameterField(widgetsContainer, label, volatile ? 0 : value, {
                    redact: volatile,
                    collapse: false,
                });
            }
            if (widgetsContainer.childElementCount) {
                block.appendChild(widgetsContainer);
                nodeList.appendChild(block);
            }
        }
        renderedCount += batch.length;
        updateSelection();

        const oldBtn = details.querySelector('.anomalous-recipe-lazy-expand-btn');
        if (oldBtn) oldBtn.remove();

        if (renderedCount < ordered.length) {
            const remaining = ordered.length - renderedCount;
            const expandBtn = document.createElement('button');
            expandBtn.type = 'button';
            expandBtn.className = 'anomalous-recipe-lazy-expand-btn';
            expandBtn.textContent = `${t('recipeRawNodesShowMore')} (${remaining})`;
            expandBtn.onclick = (e) => {
                e.preventDefault();
                renderNextBatch();
            };
            details.appendChild(expandBtn);
        }
    };

    details.ontoggle = () => {
        updateSummary();
        if (details.open && renderedCount === 0) {
            renderNextBatch();
        }
    };

    details.appendChild(nodeList);
    parent.appendChild(details);
    if (details.open && renderedCount === 0) {
        renderNextBatch();
    }
}

function renderPromptSection(parent, owner, recipe, source, rerender, onSaveNodes) {
    const prompts = promptValues(source, recipe);
    if (!prompts.entries.length) {
        appendText(parent, 'p', t('recipeDetailNoPrompts'), 'anomalous-recipe-detail-muted');
        return;
    }

    const heading = document.createElement('div');
    heading.className = 'anomalous-recipe-detail-section-heading';
    heading.style.display = 'flex';
    heading.style.alignItems = 'center';
    heading.style.justifyContent = 'space-between';
    heading.style.marginBottom = '12px';

    const headingLeft = document.createElement('div');
    headingLeft.style.display = 'flex';
    headingLeft.style.alignItems = 'center';
    headingLeft.style.gap = '8px';
    appendText(headingLeft, 'h5', t('recipeDetailPrompts') || '提示词');

    const noticeTooltip = t('recipePromptSupportNotice') || '当前仅自动识别 ComfyUI 原生 CLIPTextEncode 与已知官方连接；第三方文本节点请手动标注。';
    const infoIcon = document.createElement('span');
    infoIcon.className = 'anomalous-recipe-info-bubble';
    infoIcon.title = noticeTooltip;
    infoIcon.innerHTML = `ⓘ <span style="font-size:0.75rem;font-weight:normal;opacity:0.75;">${window.anomalous_browser_lang === 'zh' ? '支持说明' : 'Notice'}</span>`;
    infoIcon.style.cursor = 'help';
    headingLeft.appendChild(infoIcon);
    heading.appendChild(headingLeft);
    parent.appendChild(heading);

    const promptList = document.createElement('div');
    promptList.className = 'anomalous-recipe-detail-prompt-list';
    for (const entry of prompts.entries) {
        const card = document.createElement('article');
        card.className = `anomalous-recipe-detail-prompt anomalous-recipe-prompt-role-${entry.role}`;

        // Top full-width header bar
        const headerRow = document.createElement('div');
        headerRow.className = 'anomalous-recipe-prompt-card-header';
        headerRow.style.display = 'flex';
        headerRow.style.justifyContent = 'space-between';
        headerRow.style.alignItems = 'center';
        headerRow.style.gap = '10px';
        headerRow.style.marginBottom = '8px';

        // Left info group: Interactive role badge + Node title & type
        const leftGroup = document.createElement('div');
        leftGroup.className = 'anomalous-recipe-prompt-card-header-left';
        leftGroup.style.display = 'flex';
        leftGroup.style.alignItems = 'center';
        leftGroup.style.gap = '8px';
        leftGroup.style.flexWrap = 'wrap';

        const isZh = window.anomalous_browser_lang === 'zh';
        const roleBadge = document.createElement('button');
        roleBadge.type = 'button';
        roleBadge.className = `anomalous-recipe-prompt-role-badge is-${entry.role} is-interactive`;
        const roleDot = entry.role === 'positive' ? '🟢' : entry.role === 'negative' ? '🔴' : '🟣';
        roleBadge.innerHTML = `${roleDot} <span>${promptRoleLabel(entry.role)}</span> <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>`;
        roleBadge.title = isZh ? '点击切换提示词用途 (正向/负向/忽略)' : 'Click to adjust prompt role';

        const roleSelect = document.createElement('select');
        roleSelect.className = 'anomalous-recipe-prompt-role-select';
        roleSelect.setAttribute('aria-label', t('recipePromptRoleChoose'));
        const choices = [
            ['auto', `${t('recipePromptRoleAutomatic')} · ${promptRoleLabel(entry.automaticRole)}`],
            ['positive', t('recipePromptRolePositive')],
            ['negative', t('recipePromptRoleNegative')],
            ['both', t('recipePromptRoleBoth')],
            ['unknown', t('recipePromptRoleUnknown')],
            ['ignored', t('recipePromptRoleIgnored')],
        ];
        for (const [value, label] of choices) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            roleSelect.appendChild(option);
        }
        roleSelect.value = entry.manual ? entry.role : 'auto';
        roleSelect.style.display = 'none';
        roleSelect.onchange = async () => {
            const previous = entry.manual ? entry.role : 'auto';
            roleSelect.disabled = true;
            card.classList.add('is-saving');
            try {
                const params = paramsWithPromptRole(recipe, entry.id, roleSelect.value);
                await updateRecipeMetadata(owner, recipe, { params });
                rerender?.();
            } catch (error) {
                console.error('Could not update prompt role:', error);
                roleSelect.value = previous;
                roleSelect.disabled = false;
                card.classList.remove('is-saving');
                await anomalousAlert(t('recipePromptRoleSaveError'));
            }
        };
        roleBadge.onclick = () => {
            if (roleSelect.style.display === 'none') {
                roleSelect.style.display = 'inline-block';
                roleSelect.focus();
            } else {
                roleSelect.style.display = 'none';
            }
        };

        leftGroup.appendChild(roleBadge);
        leftGroup.appendChild(roleSelect);

        const nodeTitle = document.createElement('span');
        nodeTitle.className = 'anomalous-recipe-prompt-card-node-title';
        nodeTitle.textContent = entry.title || 'CLIPTextEncode';
        nodeTitle.title = entry.type || '';
        leftGroup.appendChild(nodeTitle);

        if (entry.type && entry.type !== entry.title) {
            const nodeTypeEl = document.createElement('span');
            nodeTypeEl.className = 'anomalous-recipe-prompt-card-node-type';
            nodeTypeEl.textContent = `(${entry.type})`;
            leftGroup.appendChild(nodeTypeEl);
        }

        headerRow.appendChild(leftGroup);

        // Right actions tray (Save to Material + Micro Copy)
        const actionTray = document.createElement('div');
        actionTray.className = 'anomalous-recipe-prompt-card-action-tray';
        actionTray.style.display = 'flex';
        actionTray.style.alignItems = 'center';
        actionTray.style.gap = '6px';

        if (typeof onSaveNodes === 'function') {
            const savePromptBtn = document.createElement('button');
            savePromptBtn.type = 'button';
            savePromptBtn.className = 'anomalous-recipe-prompt-micro-copy';
            savePromptBtn.title = t('materialSavePromptAction') || '存入素材库';
            savePromptBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
            savePromptBtn.onclick = (e) => {
                e.stopPropagation();
                onSaveNodes([entry.id], entry.title || t('materialPromptNode'), savePromptBtn);
            };
            actionTray.appendChild(savePromptBtn);
        }

        const copyPromptBtn = document.createElement('button');
        copyPromptBtn.type = 'button';
        copyPromptBtn.className = 'anomalous-recipe-prompt-micro-copy';
        const copyTitle = isZh ? '复制提示词' : 'Copy prompt';
        const copiedTitle = isZh ? '已复制' : 'Copied';
        copyPromptBtn.title = copyTitle;
        copyPromptBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
        copyPromptBtn.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(entry.text || '').then(() => {
                copyPromptBtn.classList.add('is-copied');
                copyPromptBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
                copyPromptBtn.title = copiedTitle;
                setTimeout(() => {
                    copyPromptBtn.classList.remove('is-copied');
                    copyPromptBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
                    copyPromptBtn.title = copyTitle;
                }, 1200);
            });
        };
        actionTray.appendChild(copyPromptBtn);
        headerRow.appendChild(actionTray);
        card.appendChild(headerRow);

        // Full-width prompt body
        const body = document.createElement('div');
        body.className = 'anomalous-recipe-prompt-card-body';
        appendValueViewer(body, entry.text, '', { copy: false });
        card.appendChild(body);

        promptList.appendChild(card);
    }
    parent.appendChild(promptList);
}

export function renderRecipeParameters(content, owner, recipe, gallery, refreshGallery, parameterState, selectParameterTab) {
    const selectedNotebook = parameterState?.notebooks?.find((item) => item.filename === parameterState.selectedFilename);
    const baseSource = selectedNotebook?.data?.workflow ? selectedNotebook.data : recipe;
    const source = parameterState?.editor?.draft || baseSource;
    const animateSelection = Boolean(parameterState?.switchToken);
    if (animateSelection && !parameterState.switchTokenClearing) {
        parameterState.switchTokenClearing = true;
        Promise.resolve().then(() => {
            parameterState.switchToken = 0;
            parameterState.switchTokenClearing = false;
        });
    }
    const wrapper = document.createElement('div');
    wrapper.className = `anomalous-recipe-detail-parameters${animateSelection ? ' is-switching' : ''}`;

    const layout = document.createElement('div');
    layout.className = 'anomalous-recipe-parameter-notebook-layout';
    const sidebar = document.createElement('aside');
    sidebar.className = 'anomalous-recipe-parameter-notebook-sidebar';
    
    const sidebarHeading = document.createElement('div');
    sidebarHeading.className = 'anomalous-recipe-detail-section-heading';
    sidebarHeading.style.marginBottom = '12px';
    sidebarHeading.style.alignItems = 'center';
    sidebarHeading.style.display = 'flex';
    appendText(sidebarHeading, 'strong', t('recipeParameterSnapshots'));
    
    const refreshSnapshots = document.createElement('button');
    refreshSnapshots.className = 'anomalous-btn-ghost';
    refreshSnapshots.style.padding = '4px 8px';
    refreshSnapshots.title = t('recipeParameterRefresh');
    refreshSnapshots.innerHTML = '↻';
    refreshSnapshots.onclick = () => { void parameterState.refresh?.(true); };
    sidebarHeading.appendChild(refreshSnapshots);
    sidebar.appendChild(sidebarHeading);
    
    const sidebarActions = document.createElement('div');
    sidebarActions.className = 'anomalous-recipe-sidebar-actions';
    sidebarActions.style.display = 'grid';
    sidebarActions.style.gap = '8px';
    sidebarActions.style.marginBottom = '12px';

    const readCurrentHandler = async () => {
        readCurrent.disabled = true;
        readCurrent.classList.add('is-busy');
        const originalLabel = readCurrent.textContent;
        readCurrent.textContent = t('recipeParameterReadCurrentSaving');
        try {
            if (!app.graph?.serialize) throw new Error('recipe_parameter_canvas_unavailable');
            const current = captureRecipeDraft(app.graph);
            assertRecipeSkeleton(recipe.workflow, current.workflow);
            const response = await fetch('/anomalous/save_parameter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `${recipe.name || t('recipeUntitled')} · ${t('recipeParameterReadCurrent')}`,
                    tags: recipe.tags || [],
                    notes: recipe.notes || '',
                    params: current.metadata,
                    workflow: current.workflow,
                    recipe_filename: owner.recipeDetailFilename,
                }),
            });
            if (!response.ok) throw new Error('current parameter note save failed');
            parameterState.editor = null;
            parameterState.status = 'idle';
            parameterState.selectedFilename = null;
            gallery.status = 'idle';
            gallery.images = [];
            gallery.scanned = 0;
            await parameterState.refresh?.(true);
            selectParameterTab?.();
        } catch (error) {
            console.error('Could not read current canvas parameters:', error);
            await anomalousAlert(error.code === 'recipe_parameter_skeleton_mismatch'
                ? t('recipeParameterSkeletonMismatch')
                : t('recipeParameterReadCurrentError'));
        } finally {
            readCurrent.disabled = false;
            readCurrent.classList.remove('is-busy');
            readCurrent.innerHTML = originalLabel;
        }
    };

    const readCurrent = button(sidebarActions, '', 'anomalous-preset-btn-primary');
    readCurrent.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>${t('recipeParameterReadCurrent')}`;
    readCurrent.onclick = readCurrentHandler;

    const newSnapshot = button(sidebarActions, '', 'anomalous-preset-btn-secondary');
    newSnapshot.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>${t('recipeParameterNew')}`;
    newSnapshot.onclick = () => {
        const draft = cloneJson({
            workflow: baseSource.workflow,
            params: baseSource.params || {},
        });
        if (!draft?.workflow) return;
        parameterState.editor = {
            draft,
            name: `${recipe.name || t('recipeUntitled')} · ${t('recipeParameterNew')}`,
        };
        parameterState.selectedFilename = null;
        gallery.status = 'idle';
        gallery.images = [];
        gallery.scanned = 0;
        selectParameterTab?.();
    };

    sidebar.appendChild(sidebarActions);
    appendText(sidebar, 'small', t('recipeParameterSnapshotsHint'), 'anomalous-recipe-detail-muted');
    const snapshotList = document.createElement('div');
    snapshotList.className = 'anomalous-recipe-parameter-notebook-list';
    snapshotList.style.marginTop = '8px';
    if (parameterState?.status === 'loading') {
        appendText(snapshotList, 'p', t('recipeParameterLoading'), 'anomalous-recipe-detail-muted');
    } else if (parameterState?.status === 'error') {
        appendText(snapshotList, 'p', t('recipeParameterLoadError'), 'anomalous-recipe-dialog-error');
    } else if (parameterState?.notebooks?.length) {
        for (const notebook of parameterState.notebooks) {
            const isSelected = notebook.filename === parameterState.selectedFilename;
            const row = document.createElement('div');
            row.className = `anomalous-preset-item-card${isSelected ? ' is-active' : ''}`;
            const notebookName = notebook.name || t('recipeParameterUntitled');

            const main = document.createElement('div');
            main.className = 'anomalous-preset-item-main';
            main.onclick = () => {
                if (parameterState.selectedFilename === notebook.filename) return;
                parameterState.editor = null;
                parameterState.selectedFilename = notebook.filename;
                parameterState.switchToken = (parameterState.switchToken || 0) + 1;
                gallery.status = 'idle';
                gallery.images = [];
                gallery.scanned = 0;
                selectParameterTab?.();
            };

            const titleRow = document.createElement('div');
            titleRow.className = 'anomalous-preset-item-title-row';
            titleRow.style.display = 'flex';
            titleRow.style.alignItems = 'center';
            titleRow.style.gap = '6px';
            titleRow.style.minWidth = '0';

            if (isSelected) {
                const activeDot = document.createElement('span');
                activeDot.className = 'anomalous-preset-active-dot';
                activeDot.title = t('recipeParameterActive') || '当前生效';
                titleRow.appendChild(activeDot);
            }

            const titleEl = appendText(titleRow, 'div', notebookName, 'anomalous-preset-item-title');
            titleEl.title = notebookName;
            main.appendChild(titleRow);

            const meta = document.createElement('div');
            meta.className = 'anomalous-preset-item-meta';
            appendText(meta, 'span', dateText(notebook.timestamp), 'anomalous-preset-item-date');
            main.appendChild(meta);
            row.appendChild(main);

            const actions = document.createElement('div');
            actions.className = 'anomalous-preset-item-actions';

            const saveMaterial = button(actions, '', 'anomalous-preset-item-btn');
            saveMaterial.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
            saveMaterial.title = t('materialSaveNotebookHint');
            saveMaterial.onclick = async (e) => {
                e.stopPropagation();
                await saveParameterMaterial(
                    owner,
                    recipe,
                    { ...parameterState, selectedFilename: notebook.filename },
                    null,
                    `${notebookName} · ${t('materialAllParameters')}`,
                    saveMaterial,
                );
            };

            const rename = button(actions, '', 'anomalous-preset-item-btn');
            rename.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
            rename.title = t('recipeParameterRename');
            rename.onclick = async (e) => {
                e.stopPropagation();
                const newName = await anomalousPrompt(t('recipeParameterRenamePrompt'), notebookName);
                if (newName === null || !newName.trim() || newName.trim() === notebookName) return;
                const trimmedName = newName.trim();
                rename.disabled = true;
                row.classList.add('is-busy');
                try {
                    const response = await fetch('/anomalous/rename_parameter', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename: notebook.filename, name: trimmedName }),
                    });
                    const payload = await response.json();
                    if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'rename failed');
                    notebook.name = trimmedName;
                    await parameterState.refresh?.(true);
                } catch (error) {
                    console.error('Could not rename parameter notebook:', error);
                    rename.disabled = false;
                    row.classList.remove('is-busy');
                    await anomalousAlert(t('recipeParameterRenameError'));
                }
            };

            const remove = button(actions, '', 'anomalous-preset-item-btn is-delete');
            remove.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
            remove.title = t('recipeParameterDelete');
            remove.onclick = async (e) => {
                e.stopPropagation();
                if (!await anomalousConfirm(t('recipeParameterDeleteConfirm', { name: notebookName }))) return;
                remove.disabled = true;
                row.classList.add('is-deleting');
                try {
                    const response = await fetch('/anomalous/delete_parameter', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename: notebook.filename }),
                    });
                    const payload = await response.json();
                    if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'parameter notebook delete failed');
                    if (parameterState.selectedFilename === notebook.filename) parameterState.selectedFilename = null;
                    parameterState.editor = null;
                    parameterState.parameterGalleryRequestId += 1;
                    gallery.status = 'idle';
                    gallery.images = [];
                    gallery.scanned = 0;
                    await parameterState.refresh?.(true);
                } catch (error) {
                    console.error('Could not delete parameter notebook:', error);
                    remove.disabled = false;
                    row.classList.remove('is-deleting');
                    await anomalousAlert(t('recipeParameterDeleteError'));
                }
            };

            row.appendChild(actions);
            snapshotList.appendChild(row);
        }
    } else {
        appendText(snapshotList, 'p', t('recipeParameterNoSnapshots'), 'anomalous-recipe-detail-muted');
    }
    sidebar.appendChild(snapshotList);

    if (parameterState?.editor) {
        renderParameterNotebookEditor(wrapper, owner, recipe, parameterState, source, selectParameterTab);
        layout.append(sidebar, wrapper);
        content.appendChild(layout);
        return;
    }

    const intro = document.createElement('section');
    intro.className = 'anomalous-preset-console-header';

    const consoleInfo = document.createElement('div');
    consoleInfo.className = 'anomalous-preset-console-info';

    const titleRow = document.createElement('div');
    titleRow.className = 'anomalous-preset-console-title-row';

    const currentNotebook = parameterState.notebooks?.find(nb => nb.filename === parameterState.selectedFilename);
    const currentName = currentNotebook?.name || source?.name || t('recipeParameterCurrentRecipe');

    appendText(titleRow, 'h3', currentName, 'anomalous-preset-console-title');
    appendText(titleRow, 'span', t('recipeParameterActive'), 'anomalous-preset-item-badge');
    consoleInfo.appendChild(titleRow);

    appendText(consoleInfo, 'p', t('recipeDetailParametersHint'), 'anomalous-recipe-detail-muted');

    const consoleActions = document.createElement('div');
    consoleActions.className = 'anomalous-preset-console-actions';

    const applyButton = button(consoleActions, '', 'anomalous-preset-btn-primary');
    applyButton.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>${t('recipeParameterApply')}`;
    applyButton.style.padding = '8px 16px';
    applyButton.style.fontSize = '0.88rem';

    const saveAllMaterial = button(consoleActions, t('materialSaveAllParameters'), 'anomalous-preset-btn-secondary');
    saveAllMaterial.onclick = () => saveParameterMaterial(
        owner,
        recipe,
        parameterState,
        null,
        `${currentName} · ${t('materialAllParameters')}`,
        saveAllMaterial,
    );

    if (parameterState?.selectedFilename) {
        const renameHeadingBtn = button(consoleActions, '', 'anomalous-btn-ghost');
        renameHeadingBtn.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>${t('recipeParameterRename')}`;
        renameHeadingBtn.onclick = async () => {
            const newName = await anomalousPrompt(t('recipeParameterRenamePrompt'), currentName);
            if (newName === null || !newName.trim() || newName.trim() === currentName) return;
            const trimmedName = newName.trim();
            renameHeadingBtn.disabled = true;
            try {
                const response = await fetch('/anomalous/rename_parameter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: parameterState.selectedFilename, name: trimmedName }),
                });
                const payload = await response.json();
                if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'rename failed');
                await parameterState.refresh?.(true);
            } catch (error) {
                console.error('Could not rename parameter notebook:', error);
                renameHeadingBtn.disabled = false;
                await anomalousAlert(t('recipeParameterRenameError'));
            }
        };
    }

    const applyStatus = appendText(consoleActions, 'small', '', 'anomalous-recipe-header-status');
    applyButton.onclick = async () => {
        applyButton.disabled = true;
        applyButton.classList.add('is-busy');
        applyStatus.textContent = t('recipeParameterApplying');
        try {
            const result = applyRecipeParametersToCanvas(source);
            applyStatus.textContent = t('recipeParameterApplied').replace('{count}', String(result.widgets));
            setTimeout(() => {
                if (applyStatus.textContent.includes(String(result.widgets))) {
                    applyStatus.textContent = '';
                }
            }, 4000);
        } catch (error) {
            console.error('Could not apply recipe parameter notebook:', error);
            const detailKey = {
                recipe_parameter_skeleton_mismatch: 'recipeParameterSkeletonMismatch',
                recipe_parameter_widget_mismatch: 'recipeParameterWidgetMismatch',
                recipe_parameter_node_unavailable: 'recipeParameterNodeUnavailable',
            }[error.code];
            const errorMessage = error.message || String(error);
            applyStatus.textContent = detailKey
                ? `${t(detailKey)} ${errorMessage}`.trim()
                : `${t('recipeParameterApplyError')} ${errorMessage}`.trim();
            applyStatus.title = errorMessage;
        } finally {
            applyButton.disabled = false;
            applyButton.classList.remove('is-busy');
        }
    };
    consoleInfo.appendChild(consoleActions);
    intro.appendChild(consoleInfo);

    // Compact gallery showcase tile on top right
    if (gallery.status === 'ready' && gallery.images.length) {
        const compactGallery = document.createElement('div');
        compactGallery.className = 'anomalous-preset-compact-gallery';
        compactGallery.title = `${t('recipeParameterGallery')} (${gallery.images.length})`;
        const thumb = document.createElement('img');
        thumb.src = outputImageUrl(gallery.images[0]);
        compactGallery.appendChild(thumb);
        const galleryBadge = appendText(compactGallery, 'span', '', 'anomalous-preset-compact-gallery-badge');
        galleryBadge.innerHTML = `<svg style="width:11px;height:11px;margin-right:3px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>${gallery.images.length}`;
        compactGallery.onclick = () => {
            const dialog = document.createElement('dialog');
            dialog.className = 'anomalous-recipe-gallery-dialog';
            const closeBtn = document.createElement('button');
            closeBtn.className = 'anomalous-dialog-close anomalous-btn-ghost';
            closeBtn.innerHTML = '✕';
            closeBtn.onclick = () => dialog.close();
            dialog.appendChild(closeBtn);
            const heading = document.createElement('h3');
            heading.textContent = `${t('recipeParameterGallery')} (${gallery.images.length})`;
            heading.className = 'anomalous-recipe-gallery-dialog-title';
            dialog.appendChild(heading);
            const grid = document.createElement('div');
            grid.className = 'anomalous-recipe-gallery-grid';
            for (const sourceImage of gallery.images) {
                const card = document.createElement('article');
                card.className = 'anomalous-recipe-gallery-card';
                const url = outputImageUrl(sourceImage);
                const image = document.createElement('img');
                image.src = url;
                image.loading = 'lazy';
                image.onclick = () => owner.showGalleryViewer?.(url);
                card.appendChild(image);
                const actions = document.createElement('div');
                actions.className = 'anomalous-recipe-gallery-card-actions';
                const details = button(actions, '', 'anomalous-btn-primary');
                details.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>${t('materialViewDetails')}`;
                details.onclick = event => {
                    event.stopPropagation();
                    const images = gallery.images;
                    dialog.close();
                    openGalleryImageDetail(owner, images, sourceImage, url);
                };
                card.appendChild(actions);
                grid.appendChild(card);
            }
            dialog.appendChild(grid);
            document.body.appendChild(dialog);
            dialog.addEventListener('close', () => dialog.remove());
            dialog.showModal();
        };
        intro.appendChild(compactGallery);
    }

    const params = source?.params || {};
    const resDisplay = formatRecipeResolution(params.resolution);
    const summary = document.createElement('section');
    summary.className = 'anomalous-recipe-detail-section anomalous-preset-bento-deck';

    const summaryHeader = document.createElement('div');
    summaryHeader.className = 'anomalous-recipe-detail-section-heading';
    summaryHeader.style.display = 'flex';
    summaryHeader.style.justifyContent = 'space-between';
    summaryHeader.style.alignItems = 'center';
    summaryHeader.style.marginBottom = '12px';
    appendText(summaryHeader, 'h5', t('recipeDetailParameterSummary') || '参数概览');
    summary.appendChild(summaryHeader);

    // Bento Grid for core scalar generation parameters
    const bentoGrid = document.createElement('div');
    bentoGrid.className = 'anomalous-recipe-bento-grid';

    const bentoItems = [
        { label: t('recipeDetailSteps') || '步数', val: params.steps, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' },
        { label: t('recipeDetailCFG') || 'CFG Scale', val: params.cfg, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>' },
        { label: t('recipeDetailSampler') || '采样器', val: params.sampler_name || params.samplers, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="8" cy="8" r="1.5"/><circle cx="16" cy="16" r="1.5"/><circle cx="12" cy="12" r="1.5"/></svg>' },
        { label: t('recipeDetailScheduler') || '调度器', val: params.scheduler, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' },
        { label: t('recipeDetailResolution') || '分辨率', val: resDisplay || params.resolution, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>' },
        { label: t('recipeDetailDenoise') || '降噪比', val: params.denoise, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg>' },
        { label: t('recipeDetailSeed') || '随机种子', val: params.seed, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>', isSeed: true },
    ].filter(item => item.val !== undefined && item.val !== null && item.val !== '');

    if (bentoItems.length > 0) {
        for (const item of bentoItems) {
            const tile = document.createElement('div');
            tile.className = 'anomalous-recipe-bento-tile is-interactive';

            const labelRow = document.createElement('div');
            labelRow.className = 'anomalous-recipe-bento-label-row';
            labelRow.style.display = 'flex';
            labelRow.style.justifyContent = 'space-between';
            labelRow.style.alignItems = 'center';

            const bentoLabel = document.createElement('span');
            bentoLabel.className = 'anomalous-recipe-bento-label';
            bentoLabel.innerHTML = `${item.icon}${item.label}`;
            labelRow.appendChild(bentoLabel);

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'anomalous-recipe-prompt-micro-copy';
            copyBtn.title = t('recipeCopyParameter') || '复制参数';
            copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
            
            const doCopy = (e) => {
                if (e) e.stopPropagation();
                navigator.clipboard.writeText(String(item.val)).then(() => {
                    copyBtn.classList.add('is-copied');
                    copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
                    setTimeout(() => {
                        copyBtn.classList.remove('is-copied');
                        copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
                    }, 1200);
                });
            };
            copyBtn.onclick = doCopy;
            labelRow.appendChild(copyBtn);

            tile.appendChild(labelRow);
            const valEl = appendText(tile, 'span', String(item.val), 'anomalous-recipe-bento-val');
            valEl.title = String(item.val);
            tile.onclick = doCopy;
            bentoGrid.appendChild(tile);
        }
        summary.appendChild(bentoGrid);
    }

    // Base Model & LoRA Matrix
    const baseModelVal = params.baseModel || params.baseModels;
    if (baseModelVal || (Array.isArray(params.loras) && params.loras.length > 0)) {
        const modelsDeck = document.createElement('div');
        modelsDeck.className = 'anomalous-recipe-models-bento-deck';
        modelsDeck.style.display = 'grid';
        modelsDeck.style.gap = '8px';
        modelsDeck.style.marginTop = '10px';

        if (baseModelVal) {
            const modelCard = document.createElement('div');
            modelCard.className = 'anomalous-recipe-model-highlight-card';
            modelCard.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><span style="display:inline-flex;align-items:center;color:#dc143c;"><svg style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></span><span style="font-size:0.75rem;color:#94a3b8;text-transform:uppercase;font-weight:600;">${t('recipeDetailBaseModel') || '底模'}</span></div><div style="font-size:0.9rem;font-weight:600;color:#f8fafc;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(String(baseModelVal))}">${escapeHtml(String(baseModelVal))}</div>`;
            modelsDeck.appendChild(modelCard);
        }

        if (Array.isArray(params.loras) && params.loras.length > 0) {
            const loraSection = document.createElement('div');
            loraSection.className = 'anomalous-recipe-lora-stack';
            const loraHeader = appendText(loraSection, 'div', '', 'anomalous-recipe-bento-label');
            loraHeader.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>${t('recipeDetailLoraSummary') || 'LoRA 阵容'} (${params.loras.length})`;

            const loraGrid = document.createElement('div');
            loraGrid.className = 'anomalous-recipe-lora-grid';
            loraGrid.style.display = 'grid';
            loraGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
            loraGrid.style.gap = '8px';
            loraGrid.style.marginTop = '6px';

            for (const lora of params.loras) {
                const loraPill = document.createElement('div');
                loraPill.className = 'anomalous-recipe-lora-pill';
                const loraName = typeof lora === 'object' && lora !== null ? (lora.name || 'Unknown') : String(lora);
                const modelWeight = typeof lora === 'object' && lora !== null && lora.strength_model !== undefined ? lora.strength_model : 1;
                const clipWeight = typeof lora === 'object' && lora !== null && lora.strength_clip !== undefined ? lora.strength_clip : 1;

                const nameEl = document.createElement('div');
                nameEl.className = 'anomalous-recipe-lora-name';
                nameEl.title = String(loraName);
                nameEl.textContent = `🎭 ${loraName}`;

                const weightsEl = document.createElement('div');
                weightsEl.className = 'anomalous-recipe-lora-weights';
                weightsEl.innerHTML = `<span title="Model Strength">M:${escapeHtml(String(modelWeight))}</span><span title="CLIP Strength">C:${escapeHtml(String(clipWeight))}</span>`;

                loraPill.append(nameEl, weightsEl);
                loraPill.title = window.anomalous_browser_lang === 'zh' ? '点击复制 LoRA 名称' : 'Click to copy LoRA name';
                loraPill.style.cursor = 'pointer';
                loraPill.onclick = (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(String(loraName)).then(() => {
                        nameEl.textContent = `✓ ${loraName}`;
                        setTimeout(() => { nameEl.textContent = `🎭 ${loraName}`; }, 1200);
                    });
                };
                loraGrid.appendChild(loraPill);
            }
            loraSection.appendChild(loraGrid);
            modelsDeck.appendChild(loraSection);
        }
        summary.appendChild(modelsDeck);
    }

    if (!bentoItems.length && !baseModelVal && (!Array.isArray(params.loras) || !params.loras.length)) {
        appendText(summary, 'p', t('recipeDetailNoSavedParameters'), 'anomalous-recipe-detail-muted');
    }

    const promptWrap = document.createElement('div');
    promptWrap.style.marginBottom = '14px';
    const saveNamedNodes = (nodeIds, label, actionButton) => saveParameterMaterial(
        owner,
        recipe,
        parameterState,
        nodeIds,
        `${currentName} · ${label}`,
        actionButton,
    );
    renderPromptSection(promptWrap, owner, recipe, source, selectParameterTab, saveNamedNodes);

    const nodesSection = document.createElement('section');
    nodesSection.className = 'anomalous-recipe-detail-section';
    renderRawNodesLazy(nodesSection, source, { onSaveNodes: saveNamedNodes });

    wrapper.append(intro, summary, promptWrap, nodesSection);
    layout.append(sidebar, wrapper);
    content.appendChild(layout);
}


