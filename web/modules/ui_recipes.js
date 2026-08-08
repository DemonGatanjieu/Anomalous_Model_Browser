/** Workflow Recipes UI, built on the same modal/card language as Notebooks. */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import {
    captureCanvasThumbnail,
    captureRecipeDraft,
} from './recipe_parser.js';
import {
    appendRecipeOnCanvas,
    showRecipeDetail,
} from './ui_recipe_detail.js';

const t = (key, params) => translate(key, params);
const RECIPE_PRESENTATION_DEFAULTS = Object.freeze({
    saveModelPreviewSnapshots: true,
});

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

function recipeAssetUrl(filename, assetId) {
    if (!filename || !assetId) return null;
    return `/anomalous/recipe_asset?filename=${encodeURIComponent(filename)}&asset=${encodeURIComponent(assetId)}`;
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

        editable.name = result.name;
        editable.tags = result.tags;
        editable.notes = result.notes;
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

function showRecipeSaveDialog(owner, canvasThumbnail, initial = null) {
    return new Promise((resolve) => {
        const selection = {
            thumbnail: safeThumbnail(initial?.thumbnail) || safeThumbnail(canvasThumbnail),
            sourceImage: initial?.source_image || null,
            // A saved snapshot is what makes the cover portable in an export.
            // Preserve an explicit opt-out, but enable the sharing-oriented
            // behavior for new and legacy recipes without a stored preference.
            saveModelPreviewSnapshots: initial?.presentation?.save_model_preview_snapshots
                ?? RECIPE_PRESENTATION_DEFAULTS.saveModelPreviewSnapshots,
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

function showRecipeEditDialog(owner, recipeData, filename, history) {
    return new Promise((resolve) => {
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
    if (typeof this.recipeModelReturn === 'function') {
        const returnToRecipe = this.recipeModelReturn;
        this.recipeModelReturn = null;
        returnToRecipe();
        return;
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
    if (this.recipeView) {
        this.recipeView.style.display = 'flex';
        if (!this.recipeDetailView) {
            if (this.recipeListContainer) this.recipeListContainer.style.display = '';
            const actionbar = this.recipeView.querySelector('.anomalous-recipe-actionbar');
            if (actionbar) actionbar.style.display = '';
            this.recipeReturnState = null;
            delete this.recipeDetailPayload;
        }
    }
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

    const betaNotice = document.createElement('div');
    betaNotice.className = 'anomalous-beta-notice anomalous-recipe-beta-notice';
    const betaBadge = appendText(betaNotice, 'strong', t('betaFeature'), 'anomalous-beta-badge');
    betaBadge.dataset.anomalousI18nKey = 'betaFeature';
    const betaText = appendText(betaNotice, 'span', t('recipeBetaNotice'));
    betaText.dataset.anomalousI18nKey = 'recipeBetaNotice';
    this.recipeView.appendChild(betaNotice);

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
        const savedCover = recipeAssetUrl(recipe.filename, data.presentation?.cover_asset_id);
        const thumbnail = savedCover || (previewIsVideo(sourceImageUrl)
            ? sourceImageUrl
            : safeThumbnail(data.thumbnail) || sourceImageUrl);
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
    const details = await showRecipeSaveDialog(this, canvasThumbnail, editing?.data || null);
    if (!details) return;

    // Prompt-role labels belong to the recipe skeleton. Preserve labels whose
    // node id and type still match when an existing recipe is refreshed from
    // the live canvas; stale labels are discarded safely.
    const previousPromptRoles = editing?.data?.params?.promptRoleOverrides;
    if (previousPromptRoles && typeof previousPromptRoles === 'object') {
        const workflowNodes = new Map((draft.workflow.nodes || []).map((node) => [String(node?.id), node]));
        const retained = {};
        for (const [nodeId, override] of Object.entries(previousPromptRoles)) {
            const node = workflowNodes.get(String(nodeId));
            if (!node || !override || typeof override !== 'object') continue;
            if (override.nodeType && override.nodeType !== node.type) continue;
            retained[nodeId] = { ...override, nodeType: node.type || override.nodeType || 'Unknown' };
        }
        if (Object.keys(retained).length) draft.metadata.promptRoleOverrides = retained;
    }

    const saveButton = this.recipeView?.querySelector('[data-recipe-save-current]');
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = t('recipeSaving');
    }
    try {
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

        const recipeFilename = payload.filename || editing?.filename;
        if (recipeFilename) {
            try {
                const parameterResponse = await fetch('/anomalous/save_parameter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: details.name,
                        tags: details.tags,
                        notes: details.notes,
                        params: draft.metadata,
                        workflow: draft.workflow,
                        recipe_filename: recipeFilename,
                    }),
                });
                if (!parameterResponse.ok) throw new Error('parameter snapshot request failed');
            } catch (error) {
                // Recipe persistence is already successful; a snapshot failure
                // must not make the user retry and create a duplicate recipe.
                console.warn('Could not save the recipe parameter snapshot:', error);
            }
        }

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
