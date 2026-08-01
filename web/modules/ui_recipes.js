/** Workflow Recipes UI, built on the same modal/card language as Notebooks. */

import { app } from '../../../scripts/app.js';
import { i18n } from './locales.js';
import { captureCanvasThumbnail, extractRecipeMetadata } from './recipe_parser.js';

const t = (key) => {
    let lang = window.anomalous_browser_lang || 'zh';
    if (lang.startsWith('en')) lang = 'en';
    return i18n[lang]?.[key] || i18n.en?.[key] || key;
};

function appendText(parent, tagName, text, className = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
}

function safeThumbnail(value) {
    return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/i.test(value)
        ? value
        : null;
}

function compactText(value, limit = 110) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function summaryValue(value, fallback = '—') {
    return value === null || value === undefined || value === '' ? fallback : String(value);
}

function createBadge(text, kind = '') {
    const badge = document.createElement('span');
    badge.className = `anomalous-recipe-badge${kind ? ` anomalous-recipe-badge-${kind}` : ''}`;
    badge.textContent = text;
    return badge;
}

function renderParams(parent, params = {}) {
    const summary = document.createElement('div');
    summary.className = 'anomalous-recipe-summary';
    appendText(summary, 'div', `${t('recipeModel')}: ${summaryValue(params.baseModel)}`, 'anomalous-recipe-model');

    const sampling = document.createElement('div');
    sampling.className = 'anomalous-recipe-sampling';
    sampling.appendChild(createBadge(`${t('recipeSteps')} ${summaryValue(params.steps)}`));
    sampling.appendChild(createBadge(`CFG ${summaryValue(params.cfg)}`));
    if (params.sampler_name) sampling.appendChild(createBadge(params.sampler_name, 'accent'));
    if (params.scheduler) sampling.appendChild(createBadge(params.scheduler));
    if (params.resolution?.width && params.resolution?.height) {
        sampling.appendChild(createBadge(`${params.resolution.width}×${params.resolution.height}`));
    }
    summary.appendChild(sampling);

    if (Array.isArray(params.loras) && params.loras.length) {
        const loraRow = document.createElement('div');
        loraRow.className = 'anomalous-recipe-loras';
        appendText(loraRow, 'span', `${t('recipeLoras')}:`, 'anomalous-recipe-label');
        for (const lora of params.loras.slice(0, 4)) {
            const weight = lora.strength_model === null || lora.strength_model === undefined
                ? ''
                : ` × ${lora.strength_model}`;
            loraRow.appendChild(createBadge(`${compactText(lora.name, 42)}${weight}`, 'lora'));
        }
        if (params.loras.length > 4) loraRow.appendChild(createBadge(`+${params.loras.length - 4}`));
        summary.appendChild(loraRow);
    }

    const positive = Array.isArray(params.promptPositive) ? params.promptPositive[0] : params.promptPositive;
    if (positive) appendText(summary, 'p', `${t('recipePrompt')}: ${compactText(positive)}`, 'anomalous-recipe-prompt');
    parent.appendChild(summary);
}

function showRecipeSaveDialog(owner, thumbnail) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'anomalous-recipe-dialog-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        const dialog = document.createElement('div');
        dialog.className = 'anomalous-recipe-dialog';
        appendText(dialog, 'h3', t('recipeSaveTitle'));

        const nameLabel = appendText(dialog, 'label', t('recipeName'));
        const nameInput = document.createElement('input');
        nameInput.className = 'anomalous-nb-select';
        nameInput.type = 'text';
        nameInput.maxLength = 120;
        nameInput.value = t('recipeDefaultName');
        nameLabel.appendChild(nameInput);

        const tagsLabel = appendText(dialog, 'label', t('recipeTags'));
        const tagsInput = document.createElement('input');
        tagsInput.className = 'anomalous-nb-select';
        tagsInput.type = 'text';
        tagsInput.maxLength = 300;
        tagsInput.placeholder = t('recipeTagsHint');
        tagsLabel.appendChild(tagsInput);

        const notesLabel = appendText(dialog, 'label', t('recipeNotes'));
        const notesInput = document.createElement('textarea');
        notesInput.className = 'anomalous-nb-textarea';
        notesInput.maxLength = 3000;
        notesInput.placeholder = t('recipeNotesHint');
        notesLabel.appendChild(notesInput);

        const preview = safeThumbnail(thumbnail);
        if (preview) {
            const image = document.createElement('img');
            image.className = 'anomalous-recipe-dialog-preview';
            image.src = preview;
            image.alt = t('recipeThumbnail');
            dialog.appendChild(image);
        }

        const error = appendText(dialog, 'div', '', 'anomalous-recipe-dialog-error');
        const actions = document.createElement('div');
        actions.className = 'anomalous-recipe-actions';
        const cancel = appendText(actions, 'button', t('recipeCancel'), 'anomalous-btn-danger');
        const save = appendText(actions, 'button', t('recipeSave'), 'anomalous-btn-primary');
        cancel.type = 'button';
        save.type = 'button';

        const close = (value) => {
            overlay.remove();
            resolve(value);
        };
        cancel.onclick = () => close(null);
        overlay.onclick = (event) => {
            if (event.target === overlay) close(null);
        };
        save.onclick = () => {
            const name = nameInput.value.trim();
            if (!name) {
                error.textContent = t('recipeNameRequired');
                nameInput.focus();
                return;
            }
            const tags = [...new Set(tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
            close({ name, tags, notes: notesInput.value.trim() });
        };
        dialog.appendChild(actions);
        overlay.appendChild(dialog);
        (owner.recipePanel || document.body).appendChild(overlay);
        nameInput.focus();
        nameInput.select();
    });
}

export async function showRecipes() {
    if (!this.recipePanel) {
        this.recipePanel = document.createElement('div');
        this.recipePanel.className = 'anomalous-nb-modal anomalous-recipe-modal';
        this.recipePanel.style.display = 'none';
        this.recipePanel.onclick = (event) => {
            if (event.target === this.recipePanel) this.recipePanel.style.display = 'none';
        };
        (this.nbPanel?.parentElement || this.modal).appendChild(this.recipePanel);
    }
    this.recipePanel.style.display = 'flex';
    if (this.recipesInitialized) {
        await this.refreshRecipes();
        return;
    }
    this.recipesInitialized = true;

    const container = document.createElement('div');
    container.className = 'anomalous-nb-container anomalous-recipe-container';
    const header = document.createElement('div');
    header.className = 'anomalous-nb-header';
    appendText(header, 'h2', t('recipeTitle'));
    const close = appendText(header, 'button', '×', 'anomalous-nb-close');
    close.type = 'button';
    close.title = t('recipeClose');
    close.onclick = () => { this.recipePanel.style.display = 'none'; };
    header.appendChild(close);

    const body = document.createElement('div');
    body.className = 'anomalous-recipe-body';
    const actionBar = document.createElement('div');
    actionBar.className = 'anomalous-recipe-actionbar';
    const save = appendText(actionBar, 'button', t('recipeSaveCurrent'), 'anomalous-btn-primary');
    save.type = 'button';
    save.onclick = () => this.handleSaveRecipe();
    body.appendChild(actionBar);

    this.recipeListContainer = document.createElement('div');
    this.recipeListContainer.className = 'anomalous-recipe-list';
    body.appendChild(this.recipeListContainer);
    container.append(header, body);
    this.recipePanel.appendChild(container);
    await this.refreshRecipes();
}

export async function refreshRecipes() {
    if (!this.recipeListContainer) return;
    try {
        const response = await fetch('/anomalous/recipes');
        if (!response.ok) throw new Error('recipe list request failed');
        const payload = await response.json();
        this.renderRecipeList(payload.recipes || []);
    } catch (error) {
        console.error('Could not load Workflow Recipes:', error);
        this.recipeListContainer.replaceChildren();
        appendText(this.recipeListContainer, 'p', t('recipeLoadError'), 'anomalous-recipe-empty');
    }
}

export function renderRecipeList(recipes) {
    this.recipeListContainer.replaceChildren();
    if (!recipes.length) {
        appendText(this.recipeListContainer, 'p', t('recipeEmpty'), 'anomalous-recipe-empty');
        return;
    }

    for (const recipe of recipes) {
        const data = recipe?.data || {};
        const card = document.createElement('article');
        card.className = 'anomalous-recipe-card';
        appendText(card, 'h3', data.name || t('recipeUntitled'));

        const thumbnail = safeThumbnail(data.thumbnail);
        if (thumbnail) {
            const image = document.createElement('img');
            image.className = 'anomalous-recipe-thumbnail';
            image.src = thumbnail;
            image.alt = data.name || t('recipeThumbnail');
            card.appendChild(image);
        }

        renderParams(card, data.params || {});
        if (Array.isArray(data.tags) && data.tags.length) {
            const tags = document.createElement('div');
            tags.className = 'anomalous-recipe-tags';
            for (const tag of data.tags.slice(0, 8)) tags.appendChild(createBadge(compactText(tag, 32), 'tag'));
            card.appendChild(tags);
        }
        if (data.notes) appendText(card, 'p', compactText(data.notes, 180), 'anomalous-recipe-notes');

        const actions = document.createElement('div');
        actions.className = 'anomalous-recipe-actions';
        const restore = appendText(actions, 'button', t('recipeRestore'), 'anomalous-btn-primary');
        restore.type = 'button';
        restore.onclick = async () => {
            if (!confirm(t('recipeRestoreConfirm'))) return;
            try {
                const response = await fetch(`/anomalous/recipe_full?filename=${encodeURIComponent(recipe.filename)}`);
                const payload = await response.json();
                if (!response.ok || payload.status !== 'success' || !payload.data?.workflow) throw new Error('recipe missing workflow');
                app.loadGraphData(payload.data.workflow);
                app.canvas?.setDirty?.(true, true);
            } catch (error) {
                console.error('Could not restore Workflow Recipe:', error);
                alert(t('recipeRestoreError'));
            }
        };
        const remove = appendText(actions, 'button', t('recipeDelete'), 'anomalous-btn-danger');
        remove.type = 'button';
        remove.onclick = async () => {
            if (!confirm(t('recipeDeleteConfirm'))) return;
            try {
                const response = await fetch('/anomalous/delete_recipe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: recipe.filename }),
                });
                if (!response.ok) throw new Error('recipe deletion failed');
                await this.refreshRecipes();
            } catch (error) {
                console.error('Could not delete Workflow Recipe:', error);
                alert(t('recipeDeleteError'));
            }
        };
        card.appendChild(actions);
        this.recipeListContainer.appendChild(card);
    }
}

export async function handleSaveRecipe() {
    if (!app.graph?.serialize) {
        alert(t('recipeSaveError'));
        return;
    }
    const metadata = extractRecipeMetadata(app.graph);
    const thumbnail = captureCanvasThumbnail(app.canvas?.canvas);
    const details = await showRecipeSaveDialog(this, thumbnail);
    if (!details) return;

    const saveButton = this.recipePanel?.querySelector('.anomalous-recipe-actionbar button');
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = t('recipeSaving');
    }
    try {
        const response = await fetch('/anomalous/save_recipe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...details,
                params: metadata,
                workflow: app.graph.serialize(),
                thumbnail,
            }),
        });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error('recipe save request failed');
        await this.refreshRecipes();
    } catch (error) {
        console.error('Could not save Workflow Recipe:', error);
        alert(t('recipeSaveError'));
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = t('recipeSaveCurrent');
        }
    }
}
