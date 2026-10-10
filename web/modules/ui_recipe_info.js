/**
 * A workflow's own information in its details: the name in the bar, the models' state as a
 * dot and a word, and the cover, notes and tags atop its default values (ui_recipe_set_view.js).
 * Name, notes and tags are edited in place (Enter or leaving the box saves, Esc keeps them).
 */

import { translate } from "./locales.js";
import { appendCopyButton, appendText, button, dateText } from "./ui_recipe_detail_dom.js";
import { appendRecipeCover } from "./ui_recipe_models.js";
import { updateRecipeMetadata } from "./ui_recipe_metadata.js";

const t = (key, params) => translate(key, params);

export function recipeCanvasActionLabel(recipe) {
    return t(recipe?.workflow_scope === 'partial' ? 'recipeAppendCanvas' : 'recipeOpenCanvas');
}
function beginInlineEdit(owner, recipe, container, field, renderValue, options = {}) {
    const editor = document.createElement('div');
    editor.className = `anomalous-recipe-inline-editor${options.multiline ? ' is-multiline' : ''}`;
    const input = document.createElement(options.multiline ? 'textarea' : 'input');
    input.className = 'anomalous-recipe-inline-input';
    input.value = Array.isArray(recipe[field]) ? recipe[field].join(', ') : String(recipe[field] || '');
    if (!options.multiline) input.type = 'text';
    if (options.maxLength) input.maxLength = options.maxLength;
    if (options.multiline) input.rows = Math.max(3, Math.min(10, input.value.split('\n').length));
    
    let finished = false;
    
    const restore = () => {
        if (finished) return;
        finished = true;
        renderValue(container);
    };
    
    const commit = async () => {
        if (finished) return;
        const raw = input.value.trim();
        const value = options.parse ? options.parse(raw) : raw;
        if (options.required && !value) {
            input.focus();
            return;
        }
        finished = true;
        input.disabled = true;
        
        // Simple visual feedback during save
        input.style.opacity = '0.5';
        try {
            await updateRecipeMetadata(owner, recipe, { [field]: value });
            renderValue(container);
        } catch (error) {
            console.error('Could not update inline recipe metadata:', error);
            finished = false;
            input.disabled = false;
            input.style.opacity = '1';
            input.focus();
        }
    };
    
    input.addEventListener('blur', () => void commit());
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            restore();
        } else if (event.key === 'Enter' && (!options.multiline || event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void commit();
        }
    });
    
    editor.appendChild(input);
    container.replaceChildren(editor);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
}

function missingNodeTypes(recipe) {
    const registry = globalThis.LiteGraph?.registered_node_types;
    if (!registry) return [];
    return [...new Set((recipe?.workflow?.nodes || [])
        .map((node) => node?.type || node?.class_type)
        .filter((type) => type && !registry[type]))];
}


export function renderInlineTitle(parent, owner, recipe) {
    parent.replaceChildren();
    const title = button(parent, recipe.name || t('recipeUntitled'), 'anomalous-recipe-inline-title');
    title.title = t('recipeInlineEditName');
    title.onclick = () => beginInlineEdit(
        owner,
        recipe,
        parent,
        'name',
        (target) => renderInlineTitle(target, owner, recipe),
        { maxLength: 120, required: true },
    );
}

function renderInlineNotes(parent, owner, recipe) {
    parent.replaceChildren();
    const notes = appendText(
        parent,
        'p',
        recipe.notes || t('recipeDetailNoNotes'),
        'anomalous-recipe-detail-muted anomalous-recipe-inline-editable',
    );
    notes.title = t('recipeInlineEditNotes');
    notes.onclick = () => beginInlineEdit(
        owner,
        recipe,
        parent,
        'notes',
        (target) => renderInlineNotes(target, owner, recipe),
        { multiline: true, maxLength: 5000 },
    );
    if (recipe.notes) appendCopyButton(parent, recipe.notes);
}

function renderInlineTags(parent, owner, recipe) {
    parent.replaceChildren();
    for (const tag of recipe.tags || []) appendText(parent, 'span', tag, 'anomalous-recipe-badge anomalous-recipe-badge-tag');
    const edit = button(parent, t('recipeInlineEditTags'), 'anomalous-recipe-inline-edit-button');
    edit.onclick = () => beginInlineEdit(
        owner,
        recipe,
        parent,
        'tags',
        (target) => renderInlineTags(target, owner, recipe),
        {
            maxLength: 300,
            parse: (value) => [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
        },
    );
}

/** The models' state: a dot and a word; what is missing, and why it matters, in its tooltip. */
export function renderReadiness(parent, recipe, references) {
    const checked = references.some((ref) => ref.currentAvailability);
    const missing = references.filter((ref) => ref.currentAvailability === 'missing').length;
    const missingNodes = missingNodeTypes(recipe);
    const state = !references.length ? 'ready' : !checked ? 'checking' : missing ? 'missing' : 'ready';
    const key = !references.length ? 'recipeStatusNoModels' : { checking: 'recipeStatusChecking', missing: 'recipeStatusMissing', ready: 'recipeStatusReady' }[state];
    const line = document.createElement('span');
    line.className = `anomalous-wfd-status is-${missingNodes.length && state === 'ready' ? 'missing' : state}`;
    appendText(line, 'span', '', 'anomalous-wfd-status-dot');
    const label = missingNodes.length && state === 'ready' ? t('recipeMissingNodes') : t(key, { count: missing });
    appendText(line, 'span', label, 'anomalous-wfd-status-text');
    const notes = [missing ? t('recipeMissingHint') : '', missingNodes.length ? `${t('recipeMissingNodes')}: ${missingNodes.join(', ')}` : ''];
    line.title = notes.filter(Boolean).join('\n') || label;
    parent.appendChild(line);
    return line;
}

/** Cover, notes and tags (each edited in place) and when it was last saved. */
export function renderRecipeInfo(parent, owner, recipe) {
    const info = document.createElement('div');
    info.className = 'anomalous-wfd-info';
    const cover = document.createElement('div');
    cover.className = 'anomalous-wfd-cover';
    appendRecipeCover(cover, owner, recipe);
    const text = document.createElement('div');
    text.className = 'anomalous-wfd-info-text';
    const notes = document.createElement('div');
    notes.className = 'anomalous-recipe-detail-notes';
    renderInlineNotes(notes, owner, recipe);
    const tags = document.createElement('div');
    tags.className = 'anomalous-recipe-tags anomalous-recipe-detail-tags';
    renderInlineTags(tags, owner, recipe);
    text.append(notes, tags);
    appendText(text, 'small', `${t('recipeDetailUpdated')}: ${dateText(recipe.updated_timestamp || recipe.timestamp)}`, 'anomalous-wfd-muted');
    info.append(cover, text);
    parent.appendChild(info);
}