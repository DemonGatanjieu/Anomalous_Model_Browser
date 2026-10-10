/**
 * A recipe's values, for its details (ui_recipe_set_view.js): which text is a prompt and its
 * role (automatic or set by hand, saved with the recipe), the prompts' boxes, every node's
 * values (unnamed ones labelled by their node type's widgets), and the editor of a new set.
 */

import { translate } from "./locales.js";
import { anomalousAlert } from "./ui_dialog.js";
import { applyRecipeWidgetChanges, isSupportedPromptNodeType } from "./recipe_parser.js";
import { PROMPT_ROLES, appendCopyButton, appendText, appendValueViewer, button, displayValue } from "./ui_recipe_detail_dom.js";
import { updateRecipeMetadata } from "./ui_recipe_metadata.js";
import { nextSetName } from "./ui_param_set_keys.js";
import { comfyWidgetLabels } from "./material_inspector.js";
import { editorValueText, isVolatileParameter, parameterNodeOrder, parseEditorValue, promptRoleLabel } from "./ui_recipe_parameter_utils.js";

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

/** The editor of a new set (parameterState.editor: its draft and name); Save or Cancel, then rerender(). */
export function renderParameterNotebookEditor(wrapper, owner, recipe, parameterState, rerender) {
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
        rerender?.();
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
            const { filename } = await response.json();
            parameterState.editor = null;
            parameterState.status = 'idle';
            parameterState.selectedFilename = filename || null;
            await parameterState.refresh?.(true);
            rerender?.();
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
    nameInput.value = editorState.name || nextSetName(recipe, parameterState.notebooks);
    nameRow.appendChild(nameInput);
    editor.appendChild(nameRow);

    const nodeList = document.createElement('div');
    nodeList.className = 'anomalous-recipe-detail-parameter-list anomalous-recipe-parameter-editor-list';
    let rendered = 0;
    for (const { summary: node, workflowNode } of parameterNodeOrder(editorState.draft)) {
        if (!workflowNode || !Array.isArray(workflowNode.widgets_values)) continue;
        const widgets = Array.isArray(node?.widgets) && node.widgets.length
            ? node.widgets
            : workflowNode.widgets_values.map((value, index) => ({ name: comfyWidgetLabels(workflowNode.type)[index] || `${t('recipeDetailWidget')} ${index + 1}`, index, value }));
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

/** Every node's values of `source`, drawn 15 nodes at a time (Show more for the rest). */
export function renderRawNodesLazy(parent, source) {
    const ordered = parameterNodeOrder(source);
    if (!ordered.length) {
        appendText(parent, 'p', t('recipeDetailNoSavedParameters'), 'anomalous-wfd-muted');
        return;
    }
    const nodeList = document.createElement('div');
    nodeList.className = 'anomalous-recipe-detail-parameter-list';

    let renderedCount = 0;
    const PAGE_SIZE = 15;

    const renderNextBatch = () => {
        const batch = ordered.slice(renderedCount, renderedCount + PAGE_SIZE);
        for (const { summary: node, workflowNode } of batch) {
            const widgets = Array.isArray(node?.widgets) && node.widgets.length
                ? node.widgets
                : (Array.isArray(workflowNode?.widgets_values)
                    ? workflowNode.widgets_values.map((value, index) => ({
                        name: comfyWidgetLabels(node?.type)[index] || `${t('recipeDetailWidget')} ${index + 1}`,
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
            appendText(nodeHeader, 'strong', title, 'anomalous-recipe-detail-node-title');
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

        const oldBtn = parent.querySelector('.anomalous-recipe-lazy-expand-btn');
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
            parent.appendChild(expandBtn);
        }
    };
    parent.appendChild(nodeList);
    renderNextBatch();
}

const LONG_PROMPT = 320; // longer prompts open folded to a few lines

/** A prompt's role menu: automatic (what the wiring says) or set by hand, saved with the recipe. */
function promptRoleMenu(owner, recipe, entry, box, rerender) {
    const menu = document.createElement('select');
    menu.className = 'anomalous-wfd-prompt-role';
    menu.title = `${t('recipePromptRoleChoose')} — ${t('recipePromptSupportNotice')}`;
    for (const [value, label] of [
        ['auto', `${t('recipePromptRoleAutomatic')} · ${promptRoleLabel(entry.automaticRole)}`],
        ['positive', t('recipePromptRolePositive')],
        ['negative', t('recipePromptRoleNegative')],
        ['both', t('recipePromptRoleBoth')],
        ['unknown', t('recipePromptRoleUnknown')],
        ['ignored', t('recipePromptRoleIgnored')],
    ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        menu.appendChild(option);
    }
    menu.value = entry.manual ? entry.role : 'auto';
    menu.onchange = async () => {
        const previous = entry.manual ? entry.role : 'auto';
        menu.disabled = true;
        box.classList.add('is-saving');
        try {
            await updateRecipeMetadata(owner, recipe, { params: paramsWithPromptRole(recipe, entry.id, menu.value) });
            rerender?.();
        } catch (error) {
            console.error('Could not update prompt role:', error);
            menu.value = previous;
            menu.disabled = false;
            box.classList.remove('is-saving');
            await anomalousAlert(t('recipePromptRoleSaveError'));
        }
    };
    return menu;
}

/** The prompts of `source` (a recipe or one of its sets): role, node, Copy, and Show all when long. */
export function renderPromptSection(parent, owner, recipe, source, rerender) {
    const prompts = promptValues(source, recipe);
    if (!prompts.entries.length) {
        appendText(parent, 'p', t('recipeDetailNoPrompts'), 'anomalous-wfd-muted');
        return;
    }
    const list = document.createElement('div');
    list.className = 'anomalous-wfd-prompts';
    for (const entry of prompts.entries) {
        const box = document.createElement('section');
        box.className = `anomalous-wfd-prompt is-${entry.role}`;
        const head = document.createElement('div');
        head.className = 'anomalous-wfd-prompt-head';
        head.appendChild(promptRoleMenu(owner, recipe, entry, box, rerender));
        const node = appendText(head, 'span', entry.title || entry.type, 'anomalous-wfd-prompt-node');
        node.title = entry.type || '';
        appendCopyButton(head, entry.text);
        box.appendChild(head);
        const text = appendText(box, 'div', entry.text, 'anomalous-wfd-prompt-text');
        if (entry.text.length > LONG_PROMPT) {
            text.classList.add('is-folded');
            const toggle = button(box, t('recipePromptShowAll'), 'anomalous-wfd-prompt-toggle');
            toggle.onclick = () => {
                const folded = text.classList.toggle('is-folded');
                toggle.textContent = t(folded ? 'recipePromptShowAll' : 'recipePromptFold');
            };
        }
        list.appendChild(box);
    }
    parent.appendChild(list);
}