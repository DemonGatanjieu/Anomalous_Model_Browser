/**
 * The models a recipe uses, on its overview: each one's preview, name, whether this
 * computer has it under the saved name, its size, note and download page. Finding a model
 * that is missing or renamed is Model Check's job once the workflow is open
 * (model_check.js), so nothing here matches or replaces. Also the recipe cover.
 */

import { translate } from "./locales.js";
import { formatIdentitySize, normaliseIdentity, recipeReferenceKey } from "./recipe_identity.js";
import { usableSourceUrl } from "./model_source_data.js";
import { anomalousAlert, anomalousPrompt } from "./ui_dialog.js";
import { appendText, button } from "./ui_recipe_detail_dom.js";
import { outputImageUrl } from "./ui_recipe_gallery.js";
import { updateRecipeMetadata } from "./ui_recipe_metadata.js";

const t = (key, params) => translate(key, params);

function folderTypesForReference(reference) {
    const category = String(reference?.category || '').toLowerCase();
    return {
        checkpoint: ['checkpoints'],
        unet: ['unet', 'diffusion_models'],
        lora: ['loras'],
        vae: ['vae'],
        text_encoder: ['text_encoders', 'clip'],
        clip_vision: ['clip_vision'],
        controlnet: ['controlnet'],
    }[category] || [];
}

export function modelDisplayName(value) {
    const path = String(value || '').replace(/\\/g, '/');
    const filename = path.split('/').pop() || t('recipeDetailUnavailable');
    return filename.replace(/\.(?:safetensors|ckpt|pt|pth|bin|sft|gguf)$/i, '');
}

function previewIsVideo(url) {
    return /\.(?:mp4|webm)(?:$|\?|&|#)/i.test(url || '');
}

export function appendRecipeCover(parent, owner, recipe) {
    const sourceUrl = outputImageUrl(recipe?.source_image);
    const savedCover = recipeAssetUrl(owner, recipe?.presentation?.cover_asset_id);
    const url = savedCover || (previewIsVideo(sourceUrl) ? sourceUrl : recipe?.thumbnail || sourceUrl);
    if (!url) return false;
    if (previewIsVideo(url)) {
        const video = document.createElement('video');
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
    } else {
        const image = document.createElement('img');
        image.src = url;
        image.alt = recipe.name || t('recipeThumbnail');
        image.loading = 'lazy';
        parent.appendChild(image);
    }
    return true;
}

function recipeAssetUrl(owner, assetId) {
    if (!owner?.recipeDetailFilename || !assetId) return '';
    return `/anomalous/recipe_asset?filename=${encodeURIComponent(owner.recipeDetailFilename)}&asset=${encodeURIComponent(assetId)}`;
}

function appendModelPreview(parent, owner, reference, onActivate = null) {
    const preview = document.createElement('div');
    preview.className = 'anomalous-recipe-model-preview';
    if (onActivate) {
        preview.classList.add('is-clickable');
        preview.title = t('recipeOpenLocalModel');
        preview.onclick = onActivate;
    }
    const snapshotUrl = recipeAssetUrl(owner, reference?.preview?.snapshot_asset_id);
    const url = snapshotUrl || reference?.currentPreviewUrl;
    if (!url) {
        preview.classList.add('empty');
        appendText(preview, 'span', String(reference?.category || t('recipeDetailModel')).slice(0, 3).toUpperCase());
        parent.appendChild(preview);
        return;
    }
    if (previewIsVideo(url)) {
        const video = document.createElement('video');
        video.src = url;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.onpointerenter = () => video.play().catch(() => {});
        video.onpointerleave = () => video.pause();
        preview.appendChild(video);
    } else {
        const image = document.createElement('img');
        image.src = url;
        image.alt = modelDisplayName(reference.saved_value);
        image.loading = 'lazy';
        preview.appendChild(image);
    }
    parent.appendChild(preview);
}

/** Looks each model up here by its saved name and folder type; what is not found is missing. */
export async function loadCurrentPreviews(owner, references) {
    const contextRequests = references
        .filter((reference) => typeof reference?.saved_value === 'string' && reference.saved_value)
        .map((reference) => ({
            key: recipeReferenceKey(reference),
            path: reference.saved_value,
            folder_types: folderTypesForReference(reference),
            exact_only: true,
        }));
    if (!contextRequests.length) return;

    const response = await fetch('/anomalous/resolve_paths_to_previews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [], exact_only: true, context_requests: contextRequests }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error('recipe preview request failed');
    const models = payload.context_models || {};
    for (const reference of references) {
        const model = models[recipeReferenceKey(reference)];
        reference.currentAvailability = model ? 'available' : 'missing';
        reference.localModel = model || null;
        reference.currentPreviewUrl = model?.preview_url || '';
    }
}

export function openLocalModel(owner, model) {
    if (!model || typeof owner?.showDetail !== 'function') return false;
    owner.historyStack = [];
    owner.currentType = model.type || owner.currentType;
    owner.currentPathIdx = model.path_idx ?? model.path_index ?? 0;
    owner.currentSubfolder = model.subfolder || '/';
    owner.currentDetailModel = model;
    // The recipe workspace is a child overlay of the main browser modal. Closing
    // the browser here also hides the detail panel we are navigating to.
    owner.modal?.classList.add('visible');
    for (const panel of [
        owner.grid,
        owner.galleryPanel,
        owner.doctorPanel,
        owner.assistantPanel,
        owner.paramPanel,
        owner.nbPanel,
    ]) {
        if (panel) panel.style.display = 'none';
    }
    owner.showDetail(model);
    return true;
}

function sameStoredModelReference(candidate, reference) {
    return String(candidate?.node_id ?? '') === String(reference?.node_id ?? '')
        && Number(candidate?.widget_index) === Number(reference?.widget_index)
        && String(candidate?.category || '') === String(reference?.category || '')
        && candidate?.saved_value === reference?.saved_value;
}

async function updateRecipeModelNote(owner, recipe, reference, note) {
    const params = JSON.parse(JSON.stringify(recipe.params || {}));
    if (!Array.isArray(params.model_references)) params.model_references = [];
    let stored = params.model_references.find((candidate) => sameStoredModelReference(candidate, reference));
    if (!stored) {
        stored = {
            node_id: reference.node_id,
            node_type: reference.node_type,
            node_title: reference.node_title,
            widget_index: reference.widget_index,
            widget_name: reference.widget_name,
            saved_value: reference.saved_value,
            category: reference.category,
            base_model: reference.base_model,
            identity: normaliseIdentity(reference.identity),
        };
        params.model_references.push(stored);
    }
    const cleanNote = String(note || '').trim();
    if (cleanNote) stored.user_note = cleanNote;
    else delete stored.user_note;
    await updateRecipeMetadata(owner, recipe, { params });
    recipe.params = params;
    reference.user_note = cleanNote;
}

const isBaseReference = (reference) => ['checkpoint', 'unet'].includes(String(reference?.category || '').toLowerCase());

const AVAILABILITY = { available: 'recipeDetailAvailable', missing: 'recipeDetailMissing' };

function modelRow(owner, recipe, reference, openModel, rerender) {
    const local = Boolean(reference.localModel);
    const card = document.createElement('article');
    card.className = `anomalous-recipe-model-reference ${local ? 'is-local' : 'is-unresolved'}`;
    const body = document.createElement('div');
    body.className = 'anomalous-recipe-model-reference-body';
    const open = local ? () => openModel(reference) : null;
    appendModelPreview(body, owner, reference, open);

    const details = document.createElement('div');
    details.className = 'anomalous-recipe-model-reference-details';
    const top = document.createElement('div');
    top.className = 'anomalous-recipe-model-reference-top';
    const name = reference.origin?.model_name || modelDisplayName(reference.saved_value);
    if (local) button(top, name, 'anomalous-recipe-model-name is-resolved').onclick = open;
    else appendText(top, 'strong', name, 'anomalous-recipe-model-name is-unresolved');
    appendText(top, 'span', reference.node_title || reference.node_type || t('recipeDetailModel'), 'anomalous-recipe-detail-muted');
    details.appendChild(top);
    appendText(details, 'small', reference.saved_value || '', 'anomalous-recipe-model-subtitle').title = reference.saved_value || '';

    const meta = document.createElement('div');
    meta.className = 'anomalous-recipe-model-reference-meta';
    const state = reference.currentAvailability;
    appendText(meta, 'span', t(AVAILABILITY[state] || 'recipeDetailAvailabilityNotChecked'), `anomalous-recipe-model-state is-${state || 'unknown'}`);
    const size = formatIdentitySize(normaliseIdentity(reference.identity).size);
    if (size) appendText(meta, 'span', size);
    const url = usableSourceUrl(reference.origin?.model_url);
    if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'anomalous-recipe-civitai-btn';
        link.textContent = t('recipeModelDownloadPage');
        meta.appendChild(link);
    }
    const noteText = appendText(meta, 'small', reference.user_note || t('recipeModelNoteEmpty'), 'anomalous-recipe-model-note anomalous-recipe-detail-muted');
    noteText.title = reference.user_note || t('recipeModelNoteEmpty');
    const noteButton = button(meta, t(reference.user_note ? 'recipeModelNoteEdit' : 'recipeModelNoteAdd'), 'anomalous-btn-ghost anomalous-recipe-model-note-btn');
    noteButton.onclick = async () => {
        const note = await anomalousPrompt(t('recipeModelNotePrompt'), reference.user_note || '', t('recipeModelNoteTitle'),
            { multiline: true, maxLength: 1000, rows: 6 });
        if (note === null) return;
        noteButton.disabled = true;
        try {
            await updateRecipeModelNote(owner, recipe, reference, note);
            rerender();
        } catch (error) {
            console.error('Could not update recipe model note:', error);
            noteButton.disabled = false;
            await anomalousAlert(t('recipeModelNoteError'));
        }
    };
    details.appendChild(meta);
    body.appendChild(details);
    card.appendChild(body);
    return card;
}

/** The model list, base models first; `openModel(reference)` opens a model this computer has. */
export function renderRecipeModels(container, owner, recipe, references, openModel) {
    container.replaceChildren();
    if (!references.length) {
        appendText(container, 'p', t('recipeDetailNoModelReferences'), 'anomalous-recipe-detail-muted');
        return;
    }
    const rerender = () => renderRecipeModels(container, owner, recipe, references, openModel);
    const list = document.createElement('div');
    list.className = 'anomalous-recipe-model-reference-list';
    const ordered = [...references].sort((a, b) => isBaseReference(b) - isBaseReference(a));
    for (const reference of ordered) list.appendChild(modelRow(owner, recipe, reference, openModel, rerender));
    container.appendChild(list);
}
