/** A Workflow Recipe's overview: cover, name, models' state, Open and ⋯, its numbers, notes and tags (edited in place), prompts, models. */

import { translate } from "./locales.js";
import { appendCopyButton, appendText, button, dateText } from "./ui_recipe_detail_dom.js";
import { appendRecipeCover } from "./ui_recipe_models.js";
import { formatRecipeResolution } from "./ui_recipe_parameter_utils.js";
import { updateRecipeMetadata } from "./ui_recipe_metadata.js";
import { exportRecipePackage } from "./ui_recipe_package.js";
import { openPopupMenu } from "./ui_popup_menu.js";

const t = (key, params) => translate(key, params);

async function runRecipeAction(actionButton, action) {
    if (!actionButton || actionButton.disabled) return false;
    actionButton.disabled = true;
    actionButton.classList.add('is-busy');
    try {
        return await action();
    } finally {
        actionButton.disabled = false;
        actionButton.classList.remove('is-busy');
    }
}

function recipeCanvasActionLabel(recipe) {
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


function renderInlineTitle(parent, owner, recipe) {
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

/** Whether every model is here under its saved name, as one line; finding the rest is Model Check's job. */
function renderReadiness(parent, recipe, references) {
    const checked = references.some((ref) => ref.currentAvailability);
    const missing = references.filter((ref) => ref.currentAvailability === 'missing').length;
    const missingNodes = missingNodeTypes(recipe);
    const state = !references.length ? 'ready' : !checked ? 'checking' : missing ? 'missing' : 'ready';
    const line = document.createElement('div');
    line.className = `anomalous-wfd-status is-${state}`;
    appendText(line, 'span', '', 'anomalous-wfd-status-dot');
    const key = !references.length ? 'recipeStatusNoModels' : { checking: 'recipeStatusChecking', missing: 'recipeStatusMissing', ready: 'recipeStatusReady' }[state];
    appendText(line, 'strong', t(key, { count: missing }));
    if (missing) appendText(line, 'span', t('recipeMissingHint'), 'anomalous-wfd-status-hint');
    parent.appendChild(line);
    if (missingNodes.length) {
        const nodes = `${missingNodes.slice(0, 3).join(', ')}${missingNodes.length > 3 ? '…' : ''}`;
        appendText(parent, 'div', `${t('recipeMissingNodes')}: ${nodes}`, 'anomalous-wfd-status is-missing-nodes');
    }
}

const LONG_PROMPT = 320; // longer prompts open folded to a few lines

/** The prompts, one box each with its role, Copy, and Show all when long. */
function renderPromptOverviewSection(parent, recipe, services) {
    const prompts = services.promptValues(recipe, recipe);
    const wrap = document.createElement('div');
    wrap.className = 'anomalous-wfd-prompts';
    for (const entry of prompts?.entries || []) {
        const promptText = entry?.text || entry?.value;
        if (!promptText || typeof promptText !== 'string' || !promptText.trim()) continue;
        const role = entry.role === 'negative' ? 'negative' : 'positive';
        const box = document.createElement('section');
        box.className = `anomalous-wfd-prompt is-${role}`;
        const head = document.createElement('div');
        head.className = 'anomalous-wfd-prompt-head';
        appendText(head, 'span', t(role === 'negative' ? 'recipePromptRoleNegative' : 'recipePromptRolePositive'), 'anomalous-wfd-prompt-role');
        appendCopyButton(head, promptText);
        box.appendChild(head);
        const text = appendText(box, 'div', promptText, 'anomalous-wfd-prompt-text');
        if (promptText.length > LONG_PROMPT) {
            text.classList.add('is-folded');
            const toggle = button(box, t('recipePromptShowAll'), 'anomalous-wfd-prompt-toggle');
            toggle.onclick = () => {
                const folded = text.classList.toggle('is-folded');
                toggle.textContent = t(folded ? 'recipePromptShowAll' : 'recipePromptFold');
            };
        }
        wrap.appendChild(box);
    }
    if (wrap.childElementCount) parent.appendChild(wrap);
}

/** Open (or append) on the canvas, and ⋯ with Edit and Export. */
function createRecipeOverviewActionBar(recipe, owner, finish, services) {
    const actions = document.createElement('div');
    actions.className = 'anomalous-wfd-actions';
    const open = button(actions, `▶ ${recipeCanvasActionLabel(recipe)}`, 'anomalous-wfd-primary');
    open.onclick = () => {
        void runRecipeAction(open, async () => {
            if (await services.applyRecipeToCanvas(owner, recipe)) finish('canvas');
        });
    };
    const more = button(actions, '⋯', 'anomalous-wf-icon-btn');
    more.title = t('notebookMore');
    more.setAttribute('aria-label', more.title);
    more.onclick = () => openPopupMenu(more, [
        { label: t('recipeEdit'), run: () => finish('edit') },
        { label: t('recipeExport'), run: () => exportRecipePackage({ filename: owner.recipeDetailFilename, data: recipe }) },
    ]);
    return actions;
}

/** The numbers it draws with, as small tiles. */
function renderStats(parent, params) {
    const resolution = formatRecipeResolution(params.resolution);
    const stats = document.createElement('div');
    stats.className = 'anomalous-wfd-stats';
    for (const [key, value] of [
        ['recipeDetailSteps', params.steps],
        ['recipeDetailCFG', params.cfg],
        ['recipeDetailSampler', params.sampler_name || params.samplers],
        ['recipeDetailResolution', resolution],
    ]) {
        const shown = Array.isArray(value) ? value.join(', ') : value;
        if (shown === undefined || shown === null || shown === '') continue;
        const tile = document.createElement('div');
        tile.className = 'anomalous-wfd-stat';
        appendText(tile, 'span', t(key), 'anomalous-wfd-stat-label');
        appendText(tile, 'strong', String(shown), 'anomalous-wfd-stat-value');
        stats.appendChild(tile);
    }
    if (stats.childElementCount) parent.appendChild(stats);
}

export function renderOverview(content, owner, recipe, references, finish, services) {
    const overview = document.createElement('div');
    overview.className = 'anomalous-wfd-overview';
    const hero = document.createElement('div');
    hero.className = 'anomalous-wfd-hero';
    const media = document.createElement('div');
    media.className = 'anomalous-wfd-cover';
    appendRecipeCover(media, owner, recipe);
    hero.appendChild(media);

    const copy = document.createElement('div');
    copy.className = 'anomalous-wfd-hero-copy';
    const titleRow = document.createElement('div');
    titleRow.className = 'anomalous-wfd-title-row';
    renderInlineTitle(titleRow, owner, recipe);
    if (recipe.workflow_scope === 'partial') appendText(titleRow, 'span', t('recipeScopePill_partial'), 'anomalous-wfd-kind');
    copy.appendChild(titleRow);
    renderReadiness(copy, recipe, references);
    copy.appendChild(createRecipeOverviewActionBar(recipe, owner, finish, services));
    renderStats(copy, recipe?.params || {});

    const meta = document.createElement('div');
    meta.className = 'anomalous-wfd-meta';
    const notes = document.createElement('div');
    notes.className = 'anomalous-recipe-detail-notes';
    renderInlineNotes(notes, owner, recipe);
    const tags = document.createElement('div');
    tags.className = 'anomalous-recipe-tags anomalous-recipe-detail-tags';
    renderInlineTags(tags, owner, recipe);
    appendText(meta, 'small', `${t('recipeDetailUpdated')}: ${dateText(recipe.updated_timestamp || recipe.timestamp)}`, 'anomalous-wfd-updated');
    meta.prepend(notes, tags);
    copy.appendChild(meta);
    hero.appendChild(copy);
    overview.appendChild(hero);

    renderPromptOverviewSection(overview, recipe, services);

    // The models it uses
    const summary = document.createElement('section');
    summary.className = 'anomalous-recipe-detail-section';
    appendText(summary, 'h4', t('recipeDetailModelComposition'));
    const modelComposition = document.createElement('div');
    modelComposition.className = 'anomalous-recipe-model-composition';
    summary.appendChild(modelComposition);
    services.renderModelComposition(modelComposition, owner, recipe, references, finish);
    overview.appendChild(summary);

    content.appendChild(overview);
}