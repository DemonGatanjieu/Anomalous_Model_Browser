/** Workflow Recipes UI, built on the same modal/card language as Notebooks. */

import { app } from '../../../scripts/app.js';
import {
    showRecipes as showRecipeCatalog,
    refreshRecipes as refreshRecipeCatalog,
    renderRecipeList as renderRecipeCatalog,
} from './ui_recipe_catalog.js';
import { outputImageUrl, previewIsVideo, safeThumbnail } from './ui_recipe_media.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import {
    captureCanvasThumbnail,
    captureRecipeDraft,
} from './recipe_parser.js';
import {
    canVerifyRecipeModelReference,
    deriveRecipeModelReferences,
    normaliseIdentity,
} from './recipe_identity.js';

const t = (key, params) => translate(key, params);
const RECIPE_PRESENTATION_DEFAULTS = Object.freeze({
    saveModelPreviewSnapshots: true,
});

export async function showRecipes() {
    return showRecipeCatalog.call(this);
}

export async function refreshRecipes() {
    return refreshRecipeCatalog.call(this);
}

export function renderRecipeList(recipes) {
    return renderRecipeCatalog.call(this, recipes, {
        editRecipe,
        fetchRecipeBundle,
        fetchRecipeData,
    });
}

function recipeAuditKey(reference) {
    return `${reference?.node_id ?? ''}\u001f${reference?.widget_index ?? ''}\u001f${reference?.saved_value ?? ''}`;
}

async function inspectRecipeModelIdentities(draft) {
    const references = deriveRecipeModelReferences({
        workflow: draft?.workflow,
        params: draft?.metadata,
    });
    if (!references.length) return { verifiableMissing: [] };

    try {
        const response = await fetch('/anomalous/refresh_recipe_identity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ references }),
        });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error('recipe identity inspection failed');
        const results = new Map((payload.results || []).map((result) => [recipeAuditKey(result), result]));
        for (const reference of references) {
            const result = results.get(recipeAuditKey(reference));
            if (!result) continue;
            reference.currentAvailability = result.availability;
            const current = normaliseIdentity(reference.identity);
            const inspected = normaliseIdentity(result.identity);
            if (current.status !== 'verified' && inspected.status === 'verified') {
                reference.identity = inspected;
            }
        }
    } catch (error) {
        // The audit is advisory. A temporary inspection failure must never
        // prevent the workflow snapshot itself from being saved.
        console.warn('Could not inspect recipe model identities:', error);
    }

    return {
        verifiableMissing: references.filter((reference) => (
            canVerifyRecipeModelReference(reference)
            && normaliseIdentity(reference.identity).status !== 'verified'
            && reference.currentAvailability !== 'missing'
        )),
    };
}

function formatRecipeText(key, values = {}) {
    return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), t(key));
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

function showRecipeSaveDialog(owner, canvasThumbnail, workflowScope, modelAudit, initial = null) {
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
        appendText(
            dialog,
            'p',
            t(workflowScope === 'partial' ? 'recipeScopePartialSaveHint' : 'recipeScopeCompleteSaveHint'),
            'anomalous-recipe-detail-muted',
        );

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

        const verifiableMissing = modelAudit?.verifiableMissing || [];
        let verifyModelIdentitiesInput = null;
        if (verifiableMissing.length) {
            const verificationSection = document.createElement('section');
            verificationSection.className = 'anomalous-recipe-save-section';
            appendText(
                verificationSection,
                'strong',
                formatRecipeText('recipeVerificationMissing', { count: verifiableMissing.length }),
            );
            appendText(
                verificationSection,
                'small',
                verifiableMissing.map((reference) => reference.saved_value).join('、'),
                'anomalous-recipe-node-hint',
            );
            const verificationChoice = document.createElement('label');
            verificationChoice.className = 'anomalous-recipe-checkbox';
            verifyModelIdentitiesInput = document.createElement('input');
            verifyModelIdentitiesInput.type = 'checkbox';
            verifyModelIdentitiesInput.checked = false;
            verificationChoice.append(
                verifyModelIdentitiesInput,
                document.createTextNode(t('recipeVerifyOnSave')),
            );
            verificationSection.appendChild(verificationChoice);
            appendText(
                verificationSection,
                'small',
                t('recipeVerifyOnSaveHint'),
                'anomalous-recipe-node-hint',
            );
            dialog.appendChild(verificationSection);
        }

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
                verifyModelIdentities: Boolean(verifyModelIdentitiesInput?.checked),
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
    const modelAudit = await inspectRecipeModelIdentities(draft);
    const details = await showRecipeSaveDialog(
        this,
        canvasThumbnail,
        draft.workflowScope,
        modelAudit,
        editing?.data || null,
    );
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
                workflow_scope: draft.workflowScope,
                thumbnail,
                source_image: details.sourceImage,
                presentation: { save_model_preview_snapshots: details.saveModelPreviewSnapshots },
                verify_model_identities: details.verifyModelIdentities,
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
