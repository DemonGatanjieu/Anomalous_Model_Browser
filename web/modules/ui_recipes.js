/** Workflow Recipes UI, built on the same modal/card language as Notebooks. */

import { app } from '../../../scripts/app.js';
import {  i18n  } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import {
    captureCanvasThumbnail,
    captureRecipeDraft,
    applyRecipeWidgetChanges,
    extractRecipeParameterChoicesFromMetadata,
} from './recipe_parser.js';
import {
    appendRecipeOnCanvas,
    showRecipeDetail,
} from './ui_recipe_detail.js';

const t = (key) => {
    let lang = window.anomalous_browser_lang || 'zh';
    if (lang.startsWith('en')) lang = 'en';
    return i18n[lang]?.[key] || i18n.en?.[key] || key;
};

function formatRecipeText(key, values = {}) {
    return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), t(key));
}

async function runRecipeCardAction(actionButton, action, errorKey) {
    if (!actionButton || actionButton.disabled) return;
    actionButton.disabled = true;
    actionButton.classList.add('is-busy');
    try {
        await action();
    } catch (error) {
        console.error('Workflow Recipe action failed:', error);
        await anomalousAlert(t(errorKey));
    } finally {
        actionButton.disabled = false;
        actionButton.classList.remove('is-busy');
    }
}

function appendText(parent, tagName, text, className = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
}

async function copyCardValueWithFeedback(buttonElement, value) {
    const original = buttonElement.textContent;
    try {
        await navigator.clipboard.writeText(String(value));
        buttonElement.textContent = `✓ ${t('recipeCopied')}`;
        buttonElement.classList.add('copied-success');
    } catch (error) {
        console.warn('Could not copy recipe parameter:', error);
        buttonElement.textContent = `! ${t('recipeCopyFailed')}`;
        buttonElement.classList.add('copied-failure');
    }
    window.setTimeout(() => {
        buttonElement.textContent = original;
        buttonElement.classList.remove('copied-success', 'copied-failure');
    }, 1200);
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

function previewIsVideo(url) {
    return /\.(?:mp4|webm)(?:$|\?|&|#)/i.test(url || '');
}

function appendRecipeCover(parent, url, alt) {
    if (!url) return;
    if (previewIsVideo(url)) {
        const video = document.createElement('video');
        video.className = 'anomalous-recipe-thumbnail';
        video.src = url;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.onpointerenter = () => video.play().catch(() => {});
        video.onpointerleave = () => {
            video.pause();
            video.currentTime = 0;
        };
        parent.appendChild(video);
        return;
    }
    const image = document.createElement('img');
    image.className = 'anomalous-recipe-thumbnail';
    image.src = url;
    image.alt = alt;
    image.loading = 'lazy';
    parent.appendChild(image);
}

async function exportRecipePackage(filename) {
    const choice = { noLabel: t('recipeDialogNo') };
    const includeSnapshots = await anomalousConfirm(t('recipeExportSnapshotsConfirm'), 'Anomalous', choice);
    if (includeSnapshots === null) return;
    const includeHistory = await anomalousConfirm(t('recipeExportHistoryConfirm'), 'Anomalous', choice);
    if (includeHistory === null) return;
    const redactIdentity = await anomalousConfirm(t('recipeExportRedactIdentityConfirm'), 'Anomalous', choice);
    if (redactIdentity === null) return;
    const includeIdentity = !redactIdentity;
    const response = await fetch('/anomalous/export_recipe_package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filename,
            include_snapshots: includeSnapshots,
            include_history: includeHistory,
            include_identity: includeIdentity,
        }),
    });
    if (!response.ok) throw new Error('recipe export failed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename.replace(/\.json$/i, '')}.anomalous-recipe.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function importRecipePackage(owner, file) {
    const inspectResponse = await fetch('/anomalous/import_recipe_package_inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: file,
    });
    const inspectPayload = await inspectResponse.json();
    if (!inspectResponse.ok || inspectPayload.status !== 'success') throw new Error('recipe import inspection failed');
    const recipeName = inspectPayload.recipe?.name || t('recipeUntitled');
    const summary = `${t('recipeImportSummary')}\n\n${recipeName}\n${t('recipeImportAssets')}: ${inspectPayload.asset_count || 0}\n${t('recipeImportHistory')}: ${inspectPayload.history_count || 0}`;
    if (!await anomalousConfirm(summary)) return;
    let name = recipeName;
    if ((inspectPayload.existing_names || []).includes(name)) {
        name = prompt(t('recipeImportRenamePrompt'), `${name} (Imported)`);
        if (!name?.trim()) return;
    }
    const commitResponse = await fetch('/anomalous/import_recipe_package_commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inspectPayload.token, collision: 'rename', name: name.trim() }),
    });
    const commitPayload = await commitResponse.json();
    if (!commitResponse.ok || commitPayload.status !== 'success') throw new Error('recipe import commit failed');
    await owner.refreshRecipes();
}

async function captureOutputThumbnail(image) {
    const url = outputImageUrl(image);
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (previewIsVideo(url) || /^video\//i.test(blob.type)) {
        const objectUrl = URL.createObjectURL(blob);
        const video = document.createElement('video');
        video.src = objectUrl;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        try {
            await new Promise((resolve, reject) => {
                video.onloadeddata = resolve;
                video.onerror = reject;
                video.load();
            });
            if (video.duration > 0.2) {
                await new Promise((resolve) => {
                    video.onseeked = resolve;
                    video.currentTime = 0.1;
                });
            }
            const maxEdge = 720;
            const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            const context = canvas.getContext('2d');
            if (!context) return null;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/webp', 0.72);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }
    const bitmap = await createImageBitmap(blob);
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

function modelDisplayName(value) {
    const path = String(value || '').replace(/\\/g, '/');
    const filename = path.split('/').pop() || '';
    return filename.replace(/\.(?:safetensors|ckpt|pt|bin|sft)$/i, '');
}

function normaliseSearchText(value) {
    const text = String(value || '').trim().toLocaleLowerCase();
    try { return text.normalize('NFKC'); } catch (error) { return text; }
}

function recipeMatchesFilter(data, query, selectedTags) {
    const terms = normaliseSearchText(query).split(/\s+/).filter(Boolean);
    const haystack = normaliseSearchText([
        data?.name || '',
        data?.notes || '',
        ...(Array.isArray(data?.tags) ? data.tags : []),
    ].join(' '));
    if (terms.some((term) => !haystack.includes(term))) return false;
    const tags = new Set((Array.isArray(data?.tags) ? data.tags : []).map(normaliseSearchText));
    for (const tag of selectedTags || []) if (!tags.has(normaliseSearchText(tag))) return false;
    return true;
}

function updateRecipeFilterControls(owner, recipes) {
    if (!owner.recipeTagBar) return;
    owner.recipeTagBar.replaceChildren();
    const tags = [...new Set((recipes || []).flatMap((item) => item?.data?.tags || []))]
        .filter(Boolean)
        .sort((left, right) => String(left).localeCompare(String(right)));
    for (const tag of tags) {
        const chip = appendText(owner.recipeTagBar, 'button', tag, 'anomalous-recipe-filter-tag');
        chip.type = 'button';
        chip.classList.toggle('active', owner.recipeSelectedTags?.has(tag));
        chip.onclick = () => {
            if (!owner.recipeSelectedTags) owner.recipeSelectedTags = new Set();
            if (owner.recipeSelectedTags.has(tag)) owner.recipeSelectedTags.delete(tag);
            else owner.recipeSelectedTags.add(tag);
            owner.renderRecipeList(owner.recipeRecords || []);
        };
    }
    if (!tags.length) appendText(owner.recipeTagBar, 'small', t('recipeNoTags'), 'anomalous-recipe-detail-muted');
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
        copy.onclick = () => { void copyCardValueWithFeedback(copy, value); };
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
                copy.onclick = () => { void copyCardValueWithFeedback(copy, value); };
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
    appendText(summary, 'div', `${t('recipeModel')}: ${summaryValue(modelDisplayName(params.baseModel))}`, 'anomalous-recipe-model');

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
            loraRow.appendChild(createBadge(`${compactText(modelDisplayName(lora.name), 42)}${weight}`, 'lora'));
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

async function fetchRecipeBundle(filename) {
    const [fullResponse, historyResponse] = await Promise.all([
        fetch(`/anomalous/recipe_full?filename=${encodeURIComponent(filename)}`),
        fetch(`/anomalous/recipe_history?filename=${encodeURIComponent(filename)}`),
    ]);
    const payload = await fullResponse.json();
    const historyPayload = historyResponse.ok ? await historyResponse.json() : { versions: [] };
    if (!fullResponse.ok || payload.status !== 'success' || !payload.data?.workflow) throw new Error('recipe missing workflow');
    return { data: JSON.parse(JSON.stringify(payload.data)), history: historyPayload.versions || [] };
}

async function fetchRecipeData(filename) {
    const response = await fetch(`/anomalous/recipe_full?filename=${encodeURIComponent(filename)}`);
    const payload = await response.json();
    if (!response.ok || payload.status !== 'success' || !payload.data?.workflow) throw new Error('recipe missing workflow');
    return JSON.parse(JSON.stringify(payload.data));
}

async function editRecipe(owner, recipe, filename, history = null) {
    try {
        const bundle = history ? { data: JSON.parse(JSON.stringify(recipe)), history } : await fetchRecipeBundle(filename);
        const editable = bundle.data;
        const result = await showRecipeEditDialog(owner, editable, filename, bundle.history);
        if (!result || result.mode === 'restored') return;
        if (result.mode === 'canvas') {
            if (!await anomalousConfirm(t('recipeEditCanvasConfirm'))) return;
            app.loadGraphData(editable.workflow);
            app.canvas?.setDirty?.(true, true);
            owner.recipeEditing = { filename, data: editable };
            const saveButton = owner.recipeView?.querySelector('[data-recipe-save-current]');
            if (saveButton) saveButton.textContent = t('recipeUpdateCurrent');
            return;
        }

        applyRecipeWidgetChanges(editable.params, editable.workflow, result.changes);
        const updatedChoices = extractRecipeParameterChoicesFromMetadata(editable.params, editable.workflow);
        editable.name = result.name;
        editable.tags = result.tags;
        editable.notes = result.notes;
        editable.params.pinned = updatedChoices.filter((choice) => result.pinnedKeys.has(choice.key));
        const response = await fetch('/anomalous/update_recipe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, ...editable }),
        });
        const updatedPayload = await response.json();
        if (!response.ok || updatedPayload.status !== 'success') throw new Error('recipe update failed');
        await owner.refreshRecipes();
    } catch (error) {
        console.error('Could not edit Workflow Recipe:', error);
        await anomalousAlert(t('recipeUpdateError'));
    }
}

function showRecipeSaveDialog(owner, canvasThumbnail, parameterChoices, initial = null) {
    return new Promise((resolve) => {
        const selection = {
            thumbnail: safeThumbnail(initial?.thumbnail) || safeThumbnail(canvasThumbnail),
            sourceImage: initial?.source_image || null,
            pinnedKeys: new Set(),
            saveModelPreviewSnapshots: initial?.presentation?.save_model_preview_snapshots === true,
        };
        const availablePinKeys = new Set(parameterChoices.map((choice) => choice.key));
        const previousPinnedKeys = new Set((initial?.params?.pinned || []).map((pin) => pin?.key).filter(Boolean));
        selection.pinnedKeys = new Set([...previousPinnedKeys].filter((key) => availablePinKeys.has(key)));
        const unavailablePinCount = previousPinnedKeys.size - selection.pinnedKeys.size;
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
        nameInput.value = initial?.name || t('recipeDefaultName');
        nameLabel.appendChild(nameInput);

        const tagsLabel = appendText(dialog, 'label', t('recipeTags'));
        const tagsInput = document.createElement('input');
        tagsInput.className = 'anomalous-nb-select';
        tagsInput.type = 'text';
        tagsInput.maxLength = 300;
        tagsInput.placeholder = t('recipeTagsHint');
        tagsInput.value = Array.isArray(initial?.tags) ? initial.tags.join(', ') : '';
        tagsLabel.appendChild(tagsInput);

        const notesLabel = appendText(dialog, 'label', t('recipeNotes'));
        const notesInput = document.createElement('textarea');
        notesInput.className = 'anomalous-nb-textarea';
        notesInput.maxLength = 3000;
        notesInput.placeholder = t('recipeNotesHint');
        notesInput.value = initial?.notes || '';
        notesLabel.appendChild(notesInput);

        const coverSection = document.createElement('section');
        coverSection.className = 'anomalous-recipe-save-section';
        appendText(coverSection, 'strong', t('recipeBindImage'));
        const coverChoices = document.createElement('div');
        coverChoices.className = 'anomalous-recipe-cover-choices';
        const coverPreview = document.createElement('img');
        coverPreview.className = 'anomalous-recipe-dialog-preview';
        coverPreview.alt = t('recipeThumbnail');
        const initialPreview = selection.thumbnail || outputImageUrl(selection.sourceImage);
        if (initialPreview) coverPreview.src = initialPreview;
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
        if (safeThumbnail(initial?.thumbnail) || initial?.source_image) {
            const existingChoice = appendText(coverChoices, 'button', t('recipeKeepImage'), 'anomalous-recipe-cover-choice selected');
            existingChoice.type = 'button';
            choiceButtons.push(existingChoice);
            existingChoice.onclick = () => selectCover(
                existingChoice,
                initial?.source_image || null,
                safeThumbnail(initial?.thumbnail) || outputImageUrl(initial?.source_image),
                safeThumbnail(initial?.thumbnail),
            );
        }
        if (safeThumbnail(canvasThumbnail)) {
            const canvasChoice = document.createElement('button');
            canvasChoice.type = 'button';
            canvasChoice.className = `anomalous-recipe-cover-choice${initial ? '' : ' selected'}`;
            const canvasImage = document.createElement('img');
            canvasImage.src = canvasThumbnail;
            canvasImage.alt = t('recipeCanvasPreview');
            appendText(canvasChoice, 'span', t('recipeCanvasPreview'));
            canvasChoice.prepend(canvasImage);
            choiceButtons.push(canvasChoice);
            canvasChoice.onclick = () => selectCover(canvasChoice, null, canvasThumbnail, safeThumbnail(canvasThumbnail));
        } else if (!initial) {
            noneChoice.classList.add('selected');
        }

        const recentStatus = appendText(coverSection, 'small', t('recipeLoadingRecentImages'), 'anomalous-recipe-node-hint');
        coverSection.append(coverChoices, coverPreview);
        dialog.appendChild(coverSection);

        const previewSnapshots = document.createElement('label');
        previewSnapshots.className = 'anomalous-recipe-pin-choice';
        const previewSnapshotsCheckbox = document.createElement('input');
        previewSnapshotsCheckbox.type = 'checkbox';
        previewSnapshotsCheckbox.checked = selection.saveModelPreviewSnapshots;
        previewSnapshotsCheckbox.onchange = () => {
            selection.saveModelPreviewSnapshots = previewSnapshotsCheckbox.checked;
        };
        const previewSnapshotCopy = document.createElement('span');
        appendText(previewSnapshotCopy, 'strong', t('recipeSaveModelPreviewSnapshots'));
        appendText(previewSnapshotCopy, 'small', t('recipeSaveModelPreviewSnapshotsHint'), 'anomalous-recipe-node-hint');
        previewSnapshots.append(previewSnapshotsCheckbox, previewSnapshotCopy);
        dialog.appendChild(previewSnapshots);

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
            parameterSummary.textContent = `${t('recipeChoosePinnedParams')} (${selection.pinnedKeys.size})`;
            parameterDetails.appendChild(parameterSummary);
            if (unavailablePinCount) {
                appendText(
                    parameterDetails,
                    'small',
                    formatRecipeText('recipePinnedParamsUnavailable', { count: unavailablePinCount }),
                    'anomalous-recipe-node-hint',
                );
            }
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
                    checkbox.checked = selection.pinnedKeys.has(choice.key);
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
                saveModelPreviewSnapshots: selection.saveModelPreviewSnapshots,
            });
        };
        dialog.appendChild(actions);
        overlay.appendChild(dialog);
        (owner.nbPanel || document.body).appendChild(overlay);
        nameInput.focus();
        nameInput.select();
    });
}

function editableValueControl(choice, changes) {
    const value = choice.value;
    const wrapper = document.createElement('label');
    wrapper.className = 'anomalous-recipe-edit-param';
    appendText(wrapper, 'span', choice.widgetName, 'anomalous-recipe-widget-name');
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
        appendText(wrapper, 'code', displayWidgetValue(value), 'anomalous-recipe-widget-value');
        appendText(wrapper, 'small', t('recipeComplexParam'), 'anomalous-recipe-node-hint');
        return wrapper;
    }

    const input = typeof value === 'string' && value.length > 120
        ? document.createElement('textarea')
        : document.createElement('input');
    input.className = typeof input.value === 'string' && input.tagName === 'TEXTAREA'
        ? 'anomalous-nb-textarea'
        : 'anomalous-nb-select';
    if (typeof value === 'boolean') {
        input.type = 'checkbox';
        input.checked = value;
    } else {
        input.type = typeof value === 'number' ? 'number' : 'text';
        input.value = String(value);
        if (typeof value === 'number') input.step = 'any';
    }
    const update = () => {
        let nextValue;
        if (typeof value === 'boolean') nextValue = input.checked;
        else if (typeof value === 'number') {
            nextValue = Number(input.value);
            if (!Number.isFinite(nextValue)) return;
        } else nextValue = input.value;
        changes.set(choice.key, { ...choice, previousValue: value, value: nextValue });
    };
    input.onchange = update;
    input.oninput = typeof value === 'string' ? update : null;
    wrapper.appendChild(input);
    return wrapper;
}

function showRecipeEditDialog(owner, recipeData, filename, history) {
    return new Promise((resolve) => {
        const params = recipeData.params || {};
        const choices = extractRecipeParameterChoicesFromMetadata(params, recipeData.workflow);
        const selectedPins = new Set((params.pinned || []).map((pin) => pin.key));
        const changes = new Map();
        const overlay = document.createElement('div');
        overlay.className = 'anomalous-recipe-dialog-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        const dialog = document.createElement('div');
        dialog.className = 'anomalous-recipe-dialog anomalous-recipe-edit-dialog';
        appendText(dialog, 'h3', t('recipeEditTitle'));

        const nameLabel = appendText(dialog, 'label', t('recipeName'));
        const nameInput = document.createElement('input');
        nameInput.className = 'anomalous-nb-select';
        nameInput.type = 'text';
        nameInput.maxLength = 120;
        nameInput.value = recipeData.name || '';
        nameLabel.appendChild(nameInput);

        const tagsLabel = appendText(dialog, 'label', t('recipeTags'));
        const tagsInput = document.createElement('input');
        tagsInput.className = 'anomalous-nb-select';
        tagsInput.type = 'text';
        tagsInput.maxLength = 300;
        tagsInput.value = Array.isArray(recipeData.tags) ? recipeData.tags.join(', ') : '';
        tagsInput.placeholder = t('recipeTagsHint');
        tagsLabel.appendChild(tagsInput);

        const notesLabel = appendText(dialog, 'label', t('recipeNotes'));
        const notesInput = document.createElement('textarea');
        notesInput.className = 'anomalous-nb-textarea';
        notesInput.maxLength = 3000;
        notesInput.value = recipeData.notes || '';
        notesInput.placeholder = t('recipeNotesHint');
        notesLabel.appendChild(notesInput);

        if (choices.length) {
            const pinDetails = document.createElement('details');
            pinDetails.className = 'anomalous-recipe-pin-picker';
            const pinSummary = document.createElement('summary');
            pinSummary.textContent = `${t('recipeChoosePinnedParams')} (${selectedPins.size})`;
            pinDetails.appendChild(pinSummary);
            const pinList = document.createElement('div');
            pinList.className = 'anomalous-recipe-pin-list';
            for (const choice of choices) {
                const label = document.createElement('label');
                label.className = 'anomalous-recipe-pin-choice';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = selectedPins.has(choice.key);
                checkbox.onchange = () => {
                    if (checkbox.checked) selectedPins.add(choice.key);
                    else selectedPins.delete(choice.key);
                    pinSummary.textContent = `${t('recipeChoosePinnedParams')} (${selectedPins.size})`;
                };
                appendText(label, 'span', `${choice.nodeTitle || choice.nodeType}: ${choice.widgetName}`);
                label.prepend(checkbox);
                pinList.appendChild(label);
            }
            pinDetails.appendChild(pinList);
            dialog.appendChild(pinDetails);
        }

        if (choices.length) {
            const parameterDetails = document.createElement('details');
            parameterDetails.className = 'anomalous-recipe-node-details';
            const parameterSummary = document.createElement('summary');
            parameterSummary.textContent = t('recipeEditNodeParams');
            parameterDetails.appendChild(parameterSummary);
            let rendered = false;
            parameterDetails.ontoggle = () => {
                if (!parameterDetails.open || rendered) return;
                rendered = true;
                const list = document.createElement('div');
                list.className = 'anomalous-recipe-node-list';
                let currentNode = null;
                for (const choice of choices) {
                    const nodeKey = `${choice.nodeId}:${choice.nodeType}:${choice.nodeTitle || ''}`;
                    if (nodeKey !== currentNode) {
                        appendText(list, 'strong', choice.nodeTitle || choice.nodeType || t('recipeUnknownNode'), 'anomalous-recipe-pin-node');
                        currentNode = nodeKey;
                    }
                    list.appendChild(editableValueControl(choice, changes));
                }
                parameterDetails.appendChild(list);
            };
            dialog.appendChild(parameterDetails);
        }

        const historyDetails = document.createElement('details');
        historyDetails.className = 'anomalous-recipe-node-details';
        const historySummary = document.createElement('summary');
        historySummary.textContent = `${t('recipeHistory')} (${history.length})`;
        historyDetails.appendChild(historySummary);
        const historyList = document.createElement('div');
        historyList.className = 'anomalous-recipe-history-list';
        if (!history.length) {
            appendText(historyList, 'small', t('recipeHistoryEmpty'), 'anomalous-recipe-node-hint');
        } else {
            for (const version of history) {
                const row = document.createElement('div');
                row.className = 'anomalous-recipe-history-row';
                const date = Number.isFinite(Number(version.timestamp))
                    ? new Date(Number(version.timestamp)).toLocaleString()
                    : t('recipeUnknownVersion');
                appendText(row, 'span', `${date} · ${version.name || t('recipeUntitled')}`);
                const restore = appendText(row, 'button', t('recipeRestoreVersion'), 'anomalous-btn-danger');
                restore.type = 'button';
                restore.onclick = async () => {
                    if (!await anomalousConfirm(t('recipeRestoreVersionConfirm'))) return;
                    try {
                        const response = await fetch('/anomalous/restore_recipe_version', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filename, version: version.version }),
                        });
                        if (!response.ok) throw new Error('recipe history restore failed');
                        overlay.remove();
                        await owner.refreshRecipes();
                        resolve({ mode: 'restored' });
                    } catch (error) {
                        console.error('Could not restore Workflow Recipe version:', error);
                        await anomalousAlert(t('recipeUpdateError'));
                    }
                };
                row.appendChild(restore);
                historyList.appendChild(row);
            }
        }
        historyDetails.appendChild(historyList);
        dialog.appendChild(historyDetails);

        const error = appendText(dialog, 'div', '', 'anomalous-recipe-dialog-error');
        const actions = document.createElement('div');
        actions.className = 'anomalous-recipe-actions';
        const cancel = appendText(actions, 'button', t('recipeCancel'), 'anomalous-btn-danger');
        const canvas = appendText(actions, 'button', t('recipeEditCanvas'), 'anomalous-btn-primary');
        const save = appendText(actions, 'button', t('recipeUpdate'), 'anomalous-btn-success');
        for (const button of [cancel, canvas, save]) button.type = 'button';
        const close = (value) => { overlay.remove(); resolve(value); };
        cancel.onclick = () => close(null);
        overlay.onclick = (event) => { if (event.target === overlay) close(null); };
        canvas.onclick = () => close({ mode: 'canvas' });
        save.onclick = () => {
            const name = nameInput.value.trim();
            if (!name) {
                error.textContent = t('recipeNameRequired');
                nameInput.focus();
                return;
            }
            close({
                mode: 'save',
                name,
                tags: [...new Set(tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
                notes: notesInput.value.trim(),
                pinnedKeys: selectedPins,
                changes: [...changes.values()],
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
    this.recipeDetailFinish?.('closed');
    this.notebookBody.style.display = 'none';
    this.notebookNotesTab?.classList.remove('active');
    this.notebookRecipesTab?.classList.add('active');
    if (this.recipeDetailView) {
        this.recipeDetailView.remove();
        this.recipeDetailView = null;
        this.recipeListContainer.style.display = '';
        this.recipeView.querySelector('.anomalous-recipe-actionbar').style.display = '';
    }
    if (this.recipeView) this.recipeView.style.display = 'flex';
    if (this.recipesInitialized) {
        await this.refreshRecipes();
        return;
    }
    this.recipesInitialized = true;
    this.recipeSelectedTags = this.recipeSelectedTags || new Set();
    this.recipeSearchQuery = this.recipeSearchQuery || '';

    this.recipeView = document.createElement('div');
    this.recipeView.className = 'anomalous-recipe-body';
    const actionBar = document.createElement('div');
    actionBar.className = 'anomalous-recipe-actionbar';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'anomalous-recipe-search';
    search.placeholder = t('recipeSearchPlaceholder');
    search.value = this.recipeSearchQuery || '';
    search.oninput = () => {
        this.recipeSearchQuery = search.value;
        this.renderRecipeList(this.recipeRecords || []);
    };
    this.recipeSearchInput = search;
    actionBar.appendChild(search);

    const clearFilters = appendText(actionBar, 'button', t('recipeClearFilters'), 'anomalous-btn-danger');
    clearFilters.type = 'button';
    clearFilters.onclick = () => {
        this.recipeSearchQuery = '';
        this.recipeSelectedTags = new Set();
        search.value = '';
        updateRecipeFilterControls(this, this.recipeRecords || []);
        this.renderRecipeList(this.recipeRecords || []);
    };

    this.recipeTagBar = document.createElement('div');
    this.recipeTagBar.className = 'anomalous-recipe-filter-tags';
    actionBar.appendChild(this.recipeTagBar);

    this.recipeFilterSummary = appendText(actionBar, 'small', '0/0', 'anomalous-recipe-filter-summary');

    const save = appendText(actionBar, 'button', t('recipeSaveCurrent'), 'anomalous-btn-primary');
    save.dataset.recipeSaveCurrent = 'true';
    save.type = 'button';
    save.onclick = () => this.handleSaveRecipe();
    this.recipeSaveStatus = appendText(actionBar, 'small', '', 'anomalous-recipe-save-status');
    const importButton = appendText(actionBar, 'button', t('recipeImport'), 'anomalous-btn-primary');
    importButton.type = 'button';
    importButton.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,.anomalous-recipe.zip,application/zip';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                await importRecipePackage(this, file);
            } catch (error) {
                console.error('Could not import Workflow Recipe package:', error);
                await anomalousAlert(t('recipeImportError'));
            }
        };
        input.click();
    };
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
         this.recipeRecords = payload.recipes || [];
         updateRecipeFilterControls(this, this.recipeRecords);
         this.renderRecipeList(this.recipeRecords);
    } catch (error) {
        console.error('Could not load Workflow Recipes:', error);
        this.recipeListContainer.replaceChildren();
        appendText(this.recipeListContainer, 'p', t('recipeLoadError'), 'anomalous-recipe-empty');
    }
}

export function renderRecipeList(recipes) {
    this.recipeListContainer.replaceChildren();
    const records = Array.isArray(recipes) ? recipes : [];
    const selectedTags = this.recipeSelectedTags || new Set();
    const filtered = records.filter((recipe) => recipeMatchesFilter(
        recipe?.data || {},
        this.recipeSearchQuery || '',
        selectedTags,
    ));
    if (this.recipeFilterSummary) this.recipeFilterSummary.textContent = `${filtered.length}/${records.length}`;
    if (!records.length) {
        appendText(this.recipeListContainer, 'p', t('recipeEmpty'), 'anomalous-recipe-empty');
        return;
    }
    if (!filtered.length) {
        appendText(this.recipeListContainer, 'p', t('recipeNoMatches'), 'anomalous-recipe-empty');
        return;
    }
    for (const recipe of filtered) {
        const data = recipe?.data || {};
        const card = document.createElement('article');
        card.className = 'anomalous-recipe-card';
        appendText(card, 'h3', data.name || t('recipeUntitled'));

        const sourceImageUrl = outputImageUrl(data.source_image);
        const thumbnail = previewIsVideo(sourceImageUrl)
            ? sourceImageUrl
            : safeThumbnail(data.thumbnail) || sourceImageUrl;
        appendRecipeCover(card, thumbnail, data.name || t('recipeThumbnail'));
        if (Array.isArray(data.tags) && data.tags.length) {
            const tags = document.createElement('div');
            tags.className = 'anomalous-recipe-tags';
            for (const tag of data.tags.slice(0, 8)) {
                const tagButton = appendText(tags, 'button', compactText(tag, 32), 'anomalous-recipe-badge anomalous-recipe-badge-tag');
                tagButton.type = 'button';
                tagButton.title = t('recipeFilterByTag');
                tagButton.onclick = (event) => {
                    event.stopPropagation();
                    if (!this.recipeSelectedTags) this.recipeSelectedTags = new Set();
                    this.recipeSelectedTags.add(tag);
                    this.renderRecipeList(this.recipeRecords || []);
                    updateRecipeFilterControls(this, this.recipeRecords || []);
                };
            }
            card.appendChild(tags);
        }
        if (data.notes) appendText(card, 'p', compactText(data.notes, 180), 'anomalous-recipe-notes');
        
        const actions = document.createElement('div');
        actions.className = 'anomalous-recipe-actions';
        
        // Make card clickable for details
        card.style.cursor = 'pointer';
        card.onclick = () => runRecipeCardAction(card, async () => {
                const bundle = await fetchRecipeBundle(recipe.filename);
                const result = await showRecipeDetail(this, {
                    recipe: bundle.data,
                    filename: recipe.filename,
                    history: bundle.history,
                });
                if (result?.mode === 'edit') await editRecipe(this, bundle.data, recipe.filename, bundle.history);
        }, 'recipeLoadError');

        // Secondary actions (Icon buttons)
        const secondaryActions = document.createElement('div');
        secondaryActions.className = 'anomalous-recipe-actions-secondary';
        
        const edit = appendText(secondaryActions, 'button', '✏️', 'anomalous-btn-icon anomalous-btn-edit');
        edit.type = 'button';
        edit.title = t('recipeEdit');
        edit.onclick = (e) => { e.stopPropagation(); runRecipeCardAction(edit, () => editRecipe(this, recipe?.data || {}, recipe.filename), 'recipeUpdateError'); };
        
        const exportButton = appendText(secondaryActions, 'button', '📥', 'anomalous-btn-icon anomalous-btn-export');
        exportButton.type = 'button';
        exportButton.title = t('recipeExport');
        exportButton.onclick = (e) => { e.stopPropagation(); runRecipeCardAction(exportButton, () => exportRecipePackage(recipe.filename), 'recipeExportError'); };
        
        const remove = appendText(secondaryActions, 'button', '🗑️', 'anomalous-btn-icon anomalous-btn-delete');
        remove.type = 'button';
        remove.title = t('recipeDelete');
        remove.onclick = (e) => {
            e.stopPropagation();
            runRecipeCardAction(remove, async () => {
                if (!await anomalousConfirm(t('recipeDeleteConfirm'))) return;
                const response = await fetch('/anomalous/delete_recipe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: recipe.filename }),
                });
                if (!response.ok) throw new Error('recipe deletion failed');
                await this.refreshRecipes();
            }, 'recipeDeleteError');
        };

        // Primary actions (Main buttons)
        const primaryActions = document.createElement('div');
        primaryActions.className = 'anomalous-recipe-actions-primary';
        
        const append = appendText(primaryActions, 'button', t('recipeAppendCanvas'), 'anomalous-btn-ghost');
        append.type = 'button';
        append.onclick = (e) => { e.stopPropagation(); runRecipeCardAction(append, async () => {
            const data = await fetchRecipeData(recipe.filename);
            if (!await appendRecipeOnCanvas(this, data)) throw new Error('recipe append failed');
        }, 'recipeAppendError'); };

        secondaryActions.append(edit, exportButton, remove);
        primaryActions.append(append);
        actions.append(secondaryActions, primaryActions);
        
        card.appendChild(actions);
        this.recipeListContainer.appendChild(card);
    }
}

export async function handleSaveRecipe() {
    if (!app.graph?.serialize) {
        await anomalousAlert(t('recipeSaveError'));
        return;
    }
    const draft = captureRecipeDraft(app.graph);
    if (!draft.workflow || !Array.isArray(draft.workflow.nodes)) {
        await anomalousAlert(t('recipeSaveError'));
        return;
    }
    const canvasThumbnail = captureCanvasThumbnail(app.canvas?.canvas);
    const editing = this.recipeEditing || null;
    const details = await showRecipeSaveDialog(this, canvasThumbnail, draft.parameterChoices, editing?.data || null);
    if (!details) return;

    const saveButton = this.recipeView?.querySelector('[data-recipe-save-current]');
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = t('recipeSaving');
    }
    try {
        draft.metadata.pinned = details.pinned;
        let thumbnail = details.thumbnail;
        if (details.sourceImage) {
            try {
                thumbnail = await captureOutputThumbnail(details.sourceImage);
            } catch (error) {
                console.warn('Could not persist bound recipe image thumbnail:', error);
            }
        }
        const response = await fetch(editing ? '/anomalous/update_recipe' : '/anomalous/save_recipe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...(editing ? { filename: editing.filename } : {}),
                name: details.name,
                tags: details.tags,
                notes: details.notes,
                params: draft.metadata,
                workflow: draft.workflow,
                thumbnail,
                source_image: details.sourceImage,
                presentation: { save_model_preview_snapshots: details.saveModelPreviewSnapshots },
            }),
        });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error('recipe save request failed');
        const receipt = payload.receipt || {};
        const receiptMatchesDraft = receipt.node_count === draft.stats.nodeCount
            && receipt.link_count === draft.stats.linkCount
            && receipt.group_count === draft.stats.groupCount;
        if (this.recipeSaveStatus) {
            this.recipeSaveStatus.textContent = receiptMatchesDraft
                ? formatRecipeText('recipeSaveReceipt', {
                    nodes: receipt.node_count,
                    links: receipt.link_count,
                    groups: receipt.group_count,
                })
                : t('recipeSaveReceiptMismatch');
            this.recipeSaveStatus.classList.toggle('is-warning', !receiptMatchesDraft);
        }
        this.recipeEditing = null;
        await this.refreshRecipes();
    } catch (error) {
        console.error('Could not save Workflow Recipe:', error);
        await anomalousAlert(t('recipeSaveError'));
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = this.recipeEditing ? t('recipeUpdateCurrent') : t('recipeSaveCurrent');
        }
    }
}
