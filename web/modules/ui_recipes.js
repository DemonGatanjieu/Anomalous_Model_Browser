/** Workflow Recipes UI, built on the same modal/card language as Notebooks. */

import { app } from '../../../scripts/app.js';
import { i18n } from './locales.js';
import {
    captureCanvasThumbnail,
    extractRecipeMetadata,
    extractRecipeParameterChoices,
} from './recipe_parser.js';

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

function outputImageUrl(image) {
    if (!image || image.type !== 'output' || typeof image.filename !== 'string') return null;
    const query = new URLSearchParams({ filename: image.filename, type: 'output' });
    if (image.subfolder) query.set('subfolder', image.subfolder);
    return `/view?${query.toString()}`;
}

async function captureOutputThumbnail(image) {
    const url = outputImageUrl(image);
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    try {
        const maxEdge = 720;
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return null;
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.72);
    } finally {
        bitmap.close?.();
    }
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

function displayWidgetValue(value) {
    if (typeof value === 'object' && value !== null) {
        try { return JSON.stringify(value); } catch (error) { return String(value); }
    }
    return String(value);
}

function appendPinnedParams(parent, params) {
    const pinned = Array.isArray(params.pinned) ? params.pinned : [];
    if (!pinned.length) return;
    const section = document.createElement('section');
    section.className = 'anomalous-recipe-pinned';
    appendText(section, 'strong', t('recipePinnedParams'));
    for (const parameter of pinned) {
        const row = document.createElement('div');
        row.className = 'anomalous-recipe-widget-row';
        appendText(
            row,
            'span',
            `${parameter.nodeTitle || parameter.nodeType || t('recipeUnknownNode')} · ${parameter.widgetName}`,
            'anomalous-recipe-widget-name',
        );
        const value = displayWidgetValue(parameter.value);
        appendText(row, 'code', value, 'anomalous-recipe-widget-value');
        const copy = appendText(row, 'button', '⧉', 'anomalous-recipe-copy-param');
        copy.type = 'button';
        copy.title = t('recipeCopyParameter');
        copy.onclick = async () => {
            try { await navigator.clipboard.writeText(value); } catch (error) { console.warn('Could not copy pinned parameter:', error); }
        };
        section.appendChild(row);
    }
    parent.appendChild(section);
}

function appendNodeDetails(parent, params) {
    const nodes = Array.isArray(params.nodes) ? params.nodes : [];
    if (!nodes.length) return;
    const details = document.createElement('details');
    details.className = 'anomalous-recipe-node-details';
    const summary = document.createElement('summary');
    summary.textContent = `${t('recipeNodeParams')} (${summaryValue(params.nodeCount, nodes.length)})`;
    details.appendChild(summary);

    let rendered = false;
    details.ontoggle = () => {
        if (!details.open || rendered) return;
        rendered = true;
        const list = document.createElement('div');
        list.className = 'anomalous-recipe-node-list';
        for (const node of nodes) {
            const nodeBlock = document.createElement('section');
            nodeBlock.className = 'anomalous-recipe-node';
            const nodeHeading = document.createElement('div');
            nodeHeading.className = 'anomalous-recipe-node-heading';
            appendText(nodeHeading, 'strong', node.title || node.type || t('recipeUnknownNode'));
            if (node.title && node.type) nodeHeading.appendChild(createBadge(node.type));
            if (node.module) nodeHeading.appendChild(createBadge(node.module, 'module'));
            nodeBlock.appendChild(nodeHeading);

            for (const widget of node.widgets || []) {
                const row = document.createElement('div');
                row.className = 'anomalous-recipe-widget-row';
                appendText(row, 'span', widget.name, 'anomalous-recipe-widget-name');
                const value = displayWidgetValue(widget.value);
                appendText(row, 'code', value, 'anomalous-recipe-widget-value');
                const copy = appendText(row, 'button', '⧉', 'anomalous-recipe-copy-param');
                copy.type = 'button';
                copy.title = t('recipeCopyParameter');
                copy.onclick = async () => {
                    try { await navigator.clipboard.writeText(value); } catch (error) { console.warn('Could not copy recipe parameter:', error); }
                };
                nodeBlock.appendChild(row);
            }
            if ((node.widgetCount || 0) > (node.widgets?.length || 0)) {
                appendText(nodeBlock, 'small', t('recipeSomeParamsInWorkflow'), 'anomalous-recipe-node-hint');
            }
            list.appendChild(nodeBlock);
        }
        if ((params.nodeCount || 0) > nodes.length) {
            appendText(list, 'small', t('recipeMoreNodesInWorkflow'), 'anomalous-recipe-node-hint');
        }
        details.appendChild(list);
    };
    parent.appendChild(details);
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
    appendPinnedParams(summary, params);
    appendNodeDetails(summary, params);
    parent.appendChild(summary);
}

function showRecipeSaveDialog(owner, canvasThumbnail, parameterChoices) {
    return new Promise((resolve) => {
        const selection = {
            thumbnail: safeThumbnail(canvasThumbnail),
            sourceImage: null,
            pinnedKeys: new Set(),
        };
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

        const coverSection = document.createElement('section');
        coverSection.className = 'anomalous-recipe-save-section';
        appendText(coverSection, 'strong', t('recipeBindImage'));
        const coverChoices = document.createElement('div');
        coverChoices.className = 'anomalous-recipe-cover-choices';
        const coverPreview = document.createElement('img');
        coverPreview.className = 'anomalous-recipe-dialog-preview';
        coverPreview.alt = t('recipeThumbnail');
        if (selection.thumbnail) coverPreview.src = selection.thumbnail;
        else coverPreview.style.display = 'none';

        const choiceButtons = [];
        const selectCover = (button, sourceImage, previewUrl, thumbnailValue) => {
            for (const choice of choiceButtons) choice.classList.toggle('selected', choice === button);
            selection.sourceImage = sourceImage;
            selection.thumbnail = thumbnailValue;
            if (previewUrl) {
                coverPreview.src = previewUrl;
                coverPreview.style.display = 'block';
            } else {
                coverPreview.removeAttribute('src');
                coverPreview.style.display = 'none';
            }
        };

        const noneChoice = appendText(coverChoices, 'button', t('recipeNoImage'), 'anomalous-recipe-cover-choice');
        noneChoice.type = 'button';
        choiceButtons.push(noneChoice);
        noneChoice.onclick = () => selectCover(noneChoice, null, null, null);
        if (selection.thumbnail) {
            const canvasChoice = document.createElement('button');
            canvasChoice.type = 'button';
            canvasChoice.className = 'anomalous-recipe-cover-choice selected';
            const canvasImage = document.createElement('img');
            canvasImage.src = selection.thumbnail;
            canvasImage.alt = t('recipeCanvasPreview');
            appendText(canvasChoice, 'span', t('recipeCanvasPreview'));
            canvasChoice.prepend(canvasImage);
            choiceButtons.push(canvasChoice);
            canvasChoice.onclick = () => selectCover(canvasChoice, null, canvasThumbnail, safeThumbnail(canvasThumbnail));
        } else {
            noneChoice.classList.add('selected');
        }

        const recentStatus = appendText(coverSection, 'small', t('recipeLoadingRecentImages'), 'anomalous-recipe-node-hint');
        coverSection.append(coverChoices, coverPreview);
        dialog.appendChild(coverSection);

        fetch('/anomalous/gallery_images?page=1&limit=12')
            .then((response) => response.ok ? response.json() : Promise.reject(new Error('image list failed')))
            .then((payload) => {
                recentStatus.textContent = t('recipeRecentImages');
                for (const imageData of payload.images || []) {
                    const url = outputImageUrl(imageData);
                    if (!url) continue;
                    const choice = document.createElement('button');
                    choice.type = 'button';
                    choice.className = 'anomalous-recipe-cover-choice anomalous-recipe-output-choice';
                    const image = document.createElement('img');
                    image.src = url;
                    image.loading = 'lazy';
                    image.alt = imageData.filename;
                    choice.appendChild(image);
                    choice.title = imageData.filename;
                    choiceButtons.push(choice);
                    choice.onclick = () => selectCover(choice, {
                        filename: imageData.filename,
                        subfolder: imageData.subfolder || '',
                        type: 'output',
                    }, url, null);
                    coverChoices.appendChild(choice);
                }
            })
            .catch((error) => {
                console.warn('Could not load recent recipe images:', error);
                recentStatus.textContent = t('recipeRecentImagesUnavailable');
            });

        if (parameterChoices.length) {
            const parameterDetails = document.createElement('details');
            parameterDetails.className = 'anomalous-recipe-pin-picker';
            const parameterSummary = document.createElement('summary');
            parameterSummary.textContent = `${t('recipeChoosePinnedParams')} (0)`;
            parameterDetails.appendChild(parameterSummary);
            let parametersRendered = false;
            parameterDetails.ontoggle = () => {
                if (!parameterDetails.open || parametersRendered) return;
                parametersRendered = true;
                const parameterList = document.createElement('div');
                parameterList.className = 'anomalous-recipe-pin-list';
                let previousNode = null;
                for (const choice of parameterChoices) {
                    const nodeLabel = choice.nodeTitle || choice.nodeType || t('recipeUnknownNode');
                    const nodeKey = `${choice.nodeId}:${choice.nodeType}:${nodeLabel}`;
                    if (nodeKey !== previousNode) {
                        appendText(parameterList, 'strong', nodeLabel, 'anomalous-recipe-pin-node');
                        previousNode = nodeKey;
                    }
                    const label = document.createElement('label');
                    label.className = 'anomalous-recipe-pin-choice';
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.onchange = () => {
                        if (checkbox.checked) selection.pinnedKeys.add(choice.key);
                        else selection.pinnedKeys.delete(choice.key);
                        parameterSummary.textContent = `${t('recipeChoosePinnedParams')} (${selection.pinnedKeys.size})`;
                    };
                    const value = compactText(displayWidgetValue(choice.value), 100);
                    appendText(label, 'span', `${choice.widgetName}: ${value}`);
                    label.prepend(checkbox);
                    parameterList.appendChild(label);
                }
                parameterDetails.appendChild(parameterList);
            };
            dialog.appendChild(parameterDetails);
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
            close({
                name,
                tags,
                notes: notesInput.value.trim(),
                thumbnail: selection.thumbnail,
                sourceImage: selection.sourceImage,
                pinned: parameterChoices.filter((choice) => selection.pinnedKeys.has(choice.key)),
            });
        };
        dialog.appendChild(actions);
        overlay.appendChild(dialog);
        (owner.nbPanel || document.body).appendChild(overlay);
        nameInput.focus();
        nameInput.select();
    });
}

export async function showRecipes() {
    if (!this.notebookContainer) {
        this.nbPanel.style.display = 'flex';
        await this.showNotebooks();
    }
    this.notebookBody.style.display = 'none';
    this.notebookNotesTab?.classList.remove('active');
    this.notebookRecipesTab?.classList.add('active');
    if (this.recipeView) this.recipeView.style.display = 'flex';
    if (this.recipesInitialized) {
        await this.refreshRecipes();
        return;
    }
    this.recipesInitialized = true;

    this.recipeView = document.createElement('div');
    this.recipeView.className = 'anomalous-recipe-body';
    const actionBar = document.createElement('div');
    actionBar.className = 'anomalous-recipe-actionbar';
    const save = appendText(actionBar, 'button', t('recipeSaveCurrent'), 'anomalous-btn-primary');
    save.type = 'button';
    save.onclick = () => this.handleSaveRecipe();
    this.recipeView.appendChild(actionBar);

    this.recipeListContainer = document.createElement('div');
    this.recipeListContainer.className = 'anomalous-recipe-list';
    this.recipeView.appendChild(this.recipeListContainer);
    this.notebookContainer.appendChild(this.recipeView);
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

        const thumbnail = safeThumbnail(data.thumbnail) || outputImageUrl(data.source_image);
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
            try {
                const response = await fetch(`/anomalous/recipe_full?filename=${encodeURIComponent(recipe.filename)}`);
                const payload = await response.json();
                if (!response.ok || payload.status !== 'success' || !payload.data?.workflow) throw new Error('recipe missing workflow');
                const registry = globalThis.LiteGraph?.registered_node_types;
                const savedNodes = Array.isArray(payload.data.params?.nodes) ? payload.data.params.nodes : [];
                const missingTypes = registry
                    ? [...new Set(savedNodes.map((node) => node.type).filter((type) => type && !registry[type]))]
                    : [];
                const missingWarning = missingTypes.length
                    ? `\n\n${t('recipeMissingNodes')}:\n${missingTypes.slice(0, 12).join('\n')}`
                    : '';
                if (!confirm(`${t('recipeRestoreConfirm')}${missingWarning}`)) return;
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
    const canvasThumbnail = captureCanvasThumbnail(app.canvas?.canvas);
    const parameterChoices = extractRecipeParameterChoices(app.graph);
    const details = await showRecipeSaveDialog(this, canvasThumbnail, parameterChoices);
    if (!details) return;

    const saveButton = this.recipeView?.querySelector('.anomalous-recipe-actionbar button');
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = t('recipeSaving');
    }
    try {
        metadata.pinned = details.pinned;
        let thumbnail = details.thumbnail;
        if (details.sourceImage) {
            try {
                thumbnail = await captureOutputThumbnail(details.sourceImage);
            } catch (error) {
                console.warn('Could not persist bound recipe image thumbnail:', error);
            }
        }
        const response = await fetch('/anomalous/save_recipe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: details.name,
                tags: details.tags,
                notes: details.notes,
                params: metadata,
                workflow: app.graph.serialize(),
                thumbnail,
                source_image: details.sourceImage,
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
