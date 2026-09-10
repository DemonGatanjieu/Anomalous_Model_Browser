/** Workflow Recipes UI, built on the same modal/card language as Notebooks. */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { bindMaterialDrag } from './material_drag.js';
import {
    captureCanvasThumbnail,
    captureRecipeDraft,
} from './recipe_parser.js';
import {
    applyRecipeToCanvas,
    showRecipeDetail,
} from './ui_recipe_detail.js';
import {
    canVerifyRecipeModelReference,
    deriveRecipeModelReferences,
    normaliseIdentity,
} from './recipe_identity.js';

const t = (key, params) => translate(key, params);
const RECIPE_PRESENTATION_DEFAULTS = Object.freeze({
    saveModelPreviewSnapshots: true,
});

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

const DEFAULT_RECIPE_COVERS = [
    new URL('../assets/default_cover_1.webp', import.meta.url).href,
    new URL('../assets/default_cover_2.webp', import.meta.url).href,
    new URL('../assets/default_cover_3.webp', import.meta.url).href,
    new URL('../assets/default_cover_4.webp', import.meta.url).href,
    new URL('../assets/default_cover_5.webp', import.meta.url).href,
    new URL('../assets/default_cover_6.webp', import.meta.url).href,
];

function getDefaultRecipeCover(seed = '') {
    if (!seed) return DEFAULT_RECIPE_COVERS[Math.floor(Math.random() * DEFAULT_RECIPE_COVERS.length)];
    let hash = 0;
    const str = String(seed);
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    const idx = Math.abs(hash) % DEFAULT_RECIPE_COVERS.length;
    return DEFAULT_RECIPE_COVERS[idx];
}

function appendRecipeCover(parent, url, alt, seed = '') {
    const isPlaceholder = !url;
    const finalUrl = url || getDefaultRecipeCover(seed || alt);

    if (!isPlaceholder && previewIsVideo(finalUrl)) {
        const video = document.createElement('video');
        video.className = 'anomalous-recipe-thumbnail';
        video.src = finalUrl;
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
    image.className = 'anomalous-recipe-thumbnail' + (isPlaceholder ? ' is-default-placeholder' : '');
    image.src = finalUrl;
    image.alt = alt || '';
    image.loading = 'lazy';
    parent.appendChild(image);
}

async function exportRecipePackage(filename) {
    const choice = { noLabel: t('recipeDialogNo') };
    const includeSnapshots = await anomalousConfirm(t('recipeExportSnapshotsConfirm'), 'Anomalous', choice);
    if (includeSnapshots === null) return;
    const includeHistory = await anomalousConfirm(t('recipeExportHistoryConfirm'), 'Anomalous', choice);
    if (includeHistory === null) return;
    const includeModelNotes = await anomalousConfirm(t('recipeExportModelNotesConfirm'), 'Anomalous', choice);
    if (includeModelNotes === null) return;
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
            include_model_notes: includeModelNotes,
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

function recipeMatchesFilter(data, query, selectedTags, scope = 'all') {
    if (scope !== 'all' && (data?.workflow_scope || 'complete') !== scope) return false;
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
    if (!owner.recipeTagSelect) return;
    const tags = [...new Set((recipes || []).flatMap(item => item?.data?.tags || []))].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const selected = [...(owner.recipeSelectedTags || [])][0] || '';
    owner.recipeSelectedTags = new Set(selected ? [selected] : []);
    owner.recipeTagSelect.replaceChildren();
    appendText(owner.recipeTagSelect, 'option', t('materialAllTags')).value = '';
    if (selected && !tags.includes(selected)) tags.push(selected);
    for (const tag of tags) appendText(owner.recipeTagSelect, 'option', tag).value = tag;
    owner.recipeTagSelect.value = selected;
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

function buildRecipeStudioTopbar(owner) {
    const topbar = document.createElement('div');
    topbar.className = 'anomalous-recipe-topbar';

    // 1. Left: Scope Pills (All / Complete / Partial)
    const left = document.createElement('div');
    left.className = 'anomalous-recipe-topbar-left';
    const pillsWrap = document.createElement('div');
    pillsWrap.className = 'anomalous-recipe-pills';

    const scopes = [
        { id: 'all', label: t('recipeScopePill_all') },
        { id: 'complete', label: t('recipeScopePill_complete') },
        { id: 'partial', label: t('recipeScopePill_partial') },
    ];
    owner.recipeScopeFilter = owner.recipeScopeFilter || 'all';

    scopes.forEach(({ id, label }) => {
        const btn = appendText(pillsWrap, 'button', label, 'anomalous-recipe-pill');
        btn.type = 'button';
        if (owner.recipeScopeFilter === id) btn.classList.add('is-active');
        btn.onclick = () => {
            if (owner.recipeScopeFilter === id) return;
            owner.recipeScopeFilter = id;
            pillsWrap.querySelectorAll('.anomalous-recipe-pill').forEach((el) => el.classList.remove('is-active'));
            btn.classList.add('is-active');
            owner.renderRecipeList(owner.recipeRecords || []);
        };
    });
    left.appendChild(pillsWrap);
    topbar.appendChild(left);

    // 2. Center: Search input + Tag select dropdown + Filter count summary
    const center = document.createElement('div');
    center.className = 'anomalous-recipe-topbar-center';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'anomalous-recipe-search-wrap';
    appendText(searchWrap, 'span', '🔍', 'anomalous-recipe-search-icon');
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'anomalous-recipe-search-input';
    searchInput.placeholder = t('recipeSearchPlaceholder');
    searchInput.value = owner.recipeSearchQuery || '';
    searchInput.oninput = () => {
        owner.recipeSearchQuery = searchInput.value;
        owner.renderRecipeList(owner.recipeRecords || []);
    };
    owner.recipeSearchInput = searchInput;
    searchWrap.appendChild(searchInput);
    center.appendChild(searchWrap);

    const tagSelect = document.createElement('select');
    tagSelect.className = 'anomalous-recipe-tag-select';
    tagSelect.onchange = () => {
        const val = tagSelect.value;
        if (!val) {
            owner.recipeSelectedTags = new Set();
        } else {
            owner.recipeSelectedTags = new Set([val]);
        }
        owner.renderRecipeList(owner.recipeRecords || []);
    };
    owner.recipeTagSelect = tagSelect;
    center.appendChild(tagSelect);

    owner.recipeFilterSummary = appendText(center, 'small', '0/0', 'anomalous-recipe-filter-summary');
    topbar.appendChild(center);

    // 3. Right: View switcher (Grid / List) + Save button + Import button
    const right = document.createElement('div');
    right.className = 'anomalous-recipe-topbar-right';

    const viewSwitch = document.createElement('div');
    viewSwitch.className = 'anomalous-recipe-view-switch';
    owner.recipeViewMode = owner.recipeViewMode || 'grid';

    const gridBtn = document.createElement('button');
    gridBtn.type = 'button';
    gridBtn.className = 'anomalous-recipe-view-btn' + (owner.recipeViewMode === 'grid' ? ' is-active' : '');
    gridBtn.title = t('recipeViewGrid');
    gridBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h7v7H3V3zm11 0h7v7h-7V3zm-11 11h7v7H3v-7zm11 0h7v7h-7v-7z"/></svg>';

    const listBtn = document.createElement('button');
    listBtn.type = 'button';
    listBtn.className = 'anomalous-recipe-view-btn' + (owner.recipeViewMode === 'list' ? ' is-active' : '');
    listBtn.title = t('recipeViewList');
    listBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4h18v3H3V4zm0 7h18v3H3v-3zm0 7h18v3H3v-3z"/></svg>';

    gridBtn.onclick = () => {
        if (owner.recipeViewMode === 'grid') return;
        owner.recipeViewMode = 'grid';
        gridBtn.classList.add('is-active');
        listBtn.classList.remove('is-active');
        if (owner.recipeListContainer) {
            owner.recipeListContainer.classList.add('is-grid');
            owner.recipeListContainer.classList.remove('is-list');
        }
    };

    listBtn.onclick = () => {
        if (owner.recipeViewMode === 'list') return;
        owner.recipeViewMode = 'list';
        listBtn.classList.add('is-active');
        gridBtn.classList.remove('is-active');
        if (owner.recipeListContainer) {
            owner.recipeListContainer.classList.add('is-list');
            owner.recipeListContainer.classList.remove('is-grid');
        }
    };

    viewSwitch.append(gridBtn, listBtn);
    right.appendChild(viewSwitch);

    const saveBtn = appendText(right, 'button', `💾 ${t('recipeSaveCurrent')}`, 'anomalous-recipe-topbar-btn is-primary');
    saveBtn.dataset.recipeSaveCurrent = 'true';
    saveBtn.type = 'button';
    saveBtn.onclick = () => owner.handleSaveRecipe();

    const importBtn = appendText(right, 'button', `📥 ${t('recipeImport')}`, 'anomalous-recipe-topbar-btn');
    importBtn.type = 'button';
    importBtn.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,.anomalous-recipe.zip,application/zip';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                await importRecipePackage(owner, file);
            } catch (error) {
                console.error('Could not import Workflow Recipe package:', error);
                await anomalousAlert(t('recipeImportError'));
            }
        };
        input.click();
    };

    topbar.appendChild(right);
    return topbar;
}

export async function showRecipes() {
    this.closePromptImportDrawer?.();
    if (!this.notebookContainer) {
        this.nbPanel.style.display = 'flex';
        await this.showNotebooks();
    }
    if (this.materialContainer) this.materialContainer.style.display = 'none';
    this.notebookContainer.style.display = 'flex';
    if (typeof this.recipeModelReturn === 'function') {
        const returnToRecipe = this.recipeModelReturn;
        this.recipeModelReturn = null;
        returnToRecipe();
        return;
    }
    this.recipeDetailFinish?.('closed');
    this.notebookBody.style.display = 'none';
    if (this.materialView) this.materialView.style.display = 'none';
    this.notebookNotesTab?.classList.remove('active');
    this.notebookRecipesTab?.classList.add('active');
    if (this.recipeDetailView) {
        this.recipeDetailView.remove();
        this.recipeDetailView = null;
        if (this.recipeListContainer) this.recipeListContainer.style.display = '';
        const topbar = this.recipeView?.querySelector('.anomalous-recipe-topbar');
        if (topbar) topbar.style.display = '';
    }
    if (this.recipeView) {
        this.recipeView.style.display = 'flex';
        if (!this.recipeDetailView) {
            if (this.recipeListContainer) this.recipeListContainer.style.display = '';
            const topbar = this.recipeView?.querySelector('.anomalous-recipe-topbar');
            if (topbar) topbar.style.display = '';
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
    this.recipeScopeFilter = this.recipeScopeFilter || 'all';
    this.recipeViewMode = this.recipeViewMode || 'grid';

    this.recipeView = document.createElement('div');
    this.recipeView.className = 'anomalous-recipe-body';

    const topbar = buildRecipeStudioTopbar(this);
    this.recipeView.appendChild(topbar);

    this.recipeListContainer = document.createElement('div');
    this.recipeListContainer.className = `anomalous-recipe-list ${this.recipeViewMode === 'list' ? 'is-list' : 'is-grid'}`;
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
    } catch (error) {
        console.error('Could not load Workflow Recipes from server:', error);
        this.recipeListContainer.replaceChildren();
        appendText(this.recipeListContainer, 'p', t('recipeLoadError'), 'anomalous-recipe-empty');
        return;
    }
    this.renderRecipeList(this.recipeRecords);
}

function formatRecipeResolution(res) {
    if (!res) return '';
    if (typeof res === 'string' || typeof res === 'number') return String(res);
    if (Array.isArray(res) && res.length >= 2) return `${res[0]}x${res[1]}`;
    if (typeof res === 'object') {
        const w = res.width ?? res.w ?? res.x;
        const h = res.height ?? res.h ?? res.y;
        if (w && h) return `${w}x${h}`;
    }
    return '';
}

function createRecipeQuickSpecs(params) {
    if (!params || typeof params !== 'object') return null;
    const strip = document.createElement('div');
    strip.className = 'anomalous-recipe-specs-strip';

    const loras = Array.isArray(params.loras) ? params.loras : [];
    if (loras.length > 0) {
        const loraTag = appendText(strip, 'span', `🧩 ${loras.length} ${t('recipeCardSpecsLoras')}`, 'anomalous-recipe-spec-tag is-lora');
        loraTag.title = loras.map((l) => (typeof l === 'object' && l?.name ? l.name : String(l))).join(', ');
    }

    if (params.steps) {
        const samplerName = params.sampler_name ? ` · ${params.sampler_name}` : '';
        const stepTag = appendText(strip, 'span', `⏱️ ${params.steps} ${t('recipeCardSpecsSteps')}${samplerName}`, 'anomalous-recipe-spec-tag is-step');
        stepTag.title = `${params.steps} ${t('recipeCardSpecsSteps')}${samplerName}`;
    }

    const formattedRes = formatRecipeResolution(params.resolution);
    if (formattedRes) {
        const resTag = appendText(strip, 'span', `📐 ${formattedRes}`, 'anomalous-recipe-spec-tag');
        resTag.title = `${t('recipeCardSpecsResolution')}: ${formattedRes}`;
    }

    return strip.childElementCount ? strip : null;
}

function getRecipeReadiness(recipeData) {
    const refs = recipeData?.params?.model_references;
    if (!Array.isArray(refs) || !refs.length) {
        return { status: 'ready', label: t('recipeStatusReady') };
    }
    let missing = 0;
    let unverified = 0;
    for (const ref of refs) {
        const status = ref?.currentAvailability;
        if (status === 'unavailable' || status === 'missing') missing++;
        else if (status !== 'available') unverified++;
    }
    if (missing > 0) return { status: 'missing', label: `${missing} ${t('recipeStatusMissing')}` };
    if (unverified > 0) return { status: 'warning', label: `${unverified} ${t('recipeStatusUnverified')}` };
    return { status: 'ready', label: t('recipeStatusReady') };
}

function createRecipeCard(owner, recipe) {
    const data = recipe?.data || {};
    const card = document.createElement('article');
    card.className = 'anomalous-recipe-card';
    card.style.cursor = 'pointer';

    // 1. Bento Media Wrap: Cover on TOP (136px)
    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'anomalous-recipe-card-media-wrap';
    const sourceImageUrl = outputImageUrl(data.source_image);
    const savedCover = recipeAssetUrl(recipe.filename, data.presentation?.cover_asset_id);
    const thumbnail = savedCover || (previewIsVideo(sourceImageUrl)
        ? sourceImageUrl
        : safeThumbnail(data.thumbnail) || sourceImageUrl);
    appendRecipeCover(mediaWrap, thumbnail, data.name || t('recipeThumbnail'), recipe?.filename || data.name);

    // Frosted Glass Chips at bottom-left of cover (Readiness Pill + Base Model)
    const bottomChips = document.createElement('div');
    bottomChips.className = 'anomalous-recipe-cover-bottom-chips';

    const readiness = getRecipeReadiness(data);
    const readinessPill = document.createElement('span');
    readinessPill.className = `anomalous-recipe-readiness-pill is-${readiness.status}`;
    readinessPill.title = readiness.label;
    const dot = document.createElement('span');
    dot.className = `anomalous-recipe-readiness-dot is-${readiness.status}`;
    const rText = document.createElement('span');
    rText.className = 'anomalous-recipe-readiness-text';
    rText.textContent = readiness.label;
    readinessPill.append(dot, rText);
    bottomChips.appendChild(readinessPill);

    const baseModelStr = data.params?.baseModel || data.params?.baseModels;
    if (baseModelStr) {
        const pill = appendText(bottomChips, 'span', `📦 ${modelDisplayName(baseModelStr)}`, 'anomalous-recipe-cover-pill');
        pill.title = String(baseModelStr);
    }
    mediaWrap.appendChild(bottomChips);

    // Scope Pill (Top-right of cover)
    const isPartial = data.workflow_scope === 'partial';
    appendText(
        mediaWrap,
        'span',
        isPartial ? '🧩 ' + t('recipeScopePill_partial') : '⚡ ' + t('recipeScopePill_complete'),
        `anomalous-recipe-scope-pill ${isPartial ? 'is-partial' : 'is-complete'}`,
    );
    card.appendChild(mediaWrap);

    // 2. Card Body
    const body = document.createElement('div');
    body.className = 'anomalous-recipe-card-body';

    // Header: Clean Title (Readiness relocated to cover pill)
    const header = document.createElement('div');
    header.className = 'anomalous-recipe-card-header';
    const title = appendText(header, 'h3', data.name || t('recipeUntitled'), 'anomalous-recipe-card-title');
    title.title = data.name || t('recipeUntitled');
    body.appendChild(header);

    // Quick Specs Strip
    const specs = createRecipeQuickSpecs(data.params);
    if (specs) body.appendChild(specs);

    // Compact Tags (first 3)
    if (Array.isArray(data.tags) && data.tags.length) {
        const tags = document.createElement('div');
        tags.className = 'anomalous-recipe-tags';
        for (const tag of data.tags.slice(0, 3)) {
            const tagButton = appendText(tags, 'button', compactText(tag, 18), 'anomalous-recipe-badge anomalous-recipe-badge-tag');
            tagButton.type = 'button';
            tagButton.title = t('recipeFilterByTag');
            tagButton.onclick = (event) => {
                event.stopPropagation();
                if (!owner.recipeSelectedTags) owner.recipeSelectedTags = new Set();
                owner.recipeSelectedTags = new Set([tag]);
                if (owner.recipeTagSelect) owner.recipeTagSelect.value = tag;
                owner.renderRecipeList(owner.recipeRecords || []);
            };
        }
        body.appendChild(tags);
    }

    // Footer: Primary Action Button ("🚀 载入画布" / "🧩 追加画布") + Mini Actions
    const footer = document.createElement('div');
    footer.className = 'anomalous-recipe-card-footer';

    const appendBtn = appendText(
        footer,
        'button',
        `${isPartial ? '🧩' : '🚀'} ${t(isPartial ? 'recipeAppendCanvas' : 'recipeOpenCanvas')}`,
        'anomalous-recipe-btn-primary-action anomalous-tooltip-target',
    );
    appendBtn.type = 'button';
    appendBtn.removeAttribute('title');
    appendBtn.setAttribute('data-tooltip', isPartial ? t('recipeAppendCanvas') : t('recipeOpenCanvas'));
    appendBtn.setAttribute('data-tooltip-pos', 'top');
    appendBtn.onclick = (e) => {
        e.stopPropagation();
        runRecipeCardAction(appendBtn, async () => {
            const fullRecipe = await fetchRecipeData(dragData.filename);
            if (app.graph !== graph) throw new Error('materialTargetChanged');
            await applyRecipeToCanvas(owner, fullRecipe);
        }, isPartial ? 'recipeAppendError' : 'recipeOpenError');
    };

    const miniActions = document.createElement('div');
    miniActions.className = 'anomalous-recipe-card-mini-actions';

    const editBtn = appendText(miniActions, 'button', '✏️', 'anomalous-recipe-card-mini-btn anomalous-tooltip-target');
    editBtn.type = 'button';
    editBtn.removeAttribute('title');
    editBtn.setAttribute('data-tooltip', t('recipeEdit'));
    editBtn.setAttribute('data-tooltip-pos', 'top');
    editBtn.onclick = (e) => {
        e.stopPropagation();
        runRecipeCardAction(editBtn, () => editRecipe(owner, recipe?.data || {}, recipe.filename), 'recipeUpdateError');
    };

    const exportBtn = appendText(miniActions, 'button', '📥', 'anomalous-recipe-card-mini-btn anomalous-tooltip-target');
    exportBtn.type = 'button';
    exportBtn.removeAttribute('title');
    exportBtn.setAttribute('data-tooltip', t('recipeExport'));
    exportBtn.setAttribute('data-tooltip-pos', 'top');
    exportBtn.onclick = (e) => {
        e.stopPropagation();
        runRecipeCardAction(exportBtn, () => exportRecipePackage(recipe.filename), 'recipeExportError');
    };

    const removeBtn = appendText(miniActions, 'button', '🗑️', 'anomalous-recipe-card-mini-btn is-delete anomalous-tooltip-target');
    removeBtn.type = 'button';
    removeBtn.removeAttribute('title');
    removeBtn.setAttribute('data-tooltip', t('recipeDelete'));
    removeBtn.setAttribute('data-tooltip-pos', 'top');
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        runRecipeCardAction(removeBtn, async () => {
            if (!await anomalousConfirm(t('recipeDeleteConfirm'))) return;
            const response = await fetch('/anomalous/delete_recipe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: recipe.filename }),
            });
            if (!response.ok) throw new Error('recipe deletion failed');
            await owner.refreshRecipes();
        }, 'recipeDeleteError');
    };

    miniActions.append(editBtn, exportBtn, removeBtn);
    footer.appendChild(miniActions);
    body.appendChild(footer);
    card.appendChild(body);

    // Card click for Detail Modal
    card.onclick = () => runRecipeCardAction(card, async () => {
        const bundle = await fetchRecipeBundle(recipe.filename);
        const result = await showRecipeDetail(owner, {
            recipe: bundle.data,
            filename: recipe.filename,
            history: bundle.history,
        });
        if (result?.mode === 'edit') await editRecipe(owner, bundle.data, recipe.filename, bundle.history);
    }, 'recipeLoadError');

    // 3. 一拖直达画布: "拖入画布后直接打开一个新的画布，就像拖入一个ComfyUI的图片一样"
    bindMaterialDrag(card, owner, {
        payload: () => ({
            type: 'recipe',
            filename: recipe.filename,
            scope: data.workflow_scope || 'complete',
            dragHint: t('recipeDragHint'),
            dragTargetHint: t('recipeDragTargetCanvas'),
        }),
        accepts: () => false,
        dropOnCanvas: async (event, dragData, graph) => {
            const fullRecipe = await fetchRecipeData(dragData.filename);
            if (app.graph !== graph) throw new Error('materialTargetChanged');
            await applyRecipeToCanvas(owner, fullRecipe);
        },
    });

    return card;
}

export function renderRecipeList(recipes) {
    this.recipeListContainer.replaceChildren();
    const records = Array.isArray(recipes) ? recipes : [];
    const selectedTags = this.recipeSelectedTags || new Set();
    const scopeFilter = this.recipeScopeFilter || 'all';

    const filtered = records.filter((recipe) => {
        const data = recipe?.data || {};
        return recipeMatchesFilter(
            data,
            this.recipeSearchQuery || '',
            selectedTags,
            scopeFilter,
        );
    });

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
        try {
            this.recipeListContainer.appendChild(createRecipeCard(this, recipe));
        } catch (cardError) {
            console.error('Could not render Workflow Recipe card:', recipe?.filename, cardError);
        }
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
