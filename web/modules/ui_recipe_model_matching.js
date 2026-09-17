/** Recipe model preview, matching, replacement, and identity UI. */

import { translate } from "./locales.js";
import { formatIdentitySize, normaliseIdentity, recipeReferenceKey } from "./recipe_identity.js";
import { replaceWorkflowModelHashRecord } from "./recipe_provenance.js";
import { appendText } from "./ui_recipe_detail_dom.js";
import { outputImageUrl } from "./ui_recipe_gallery.js";
import { updateRecipeMetadata } from "./ui_recipe_metadata.js";

const t = (key, params) => translate(key, params);

export function identityBadge(reference) {
    const identity = normaliseIdentity(reference?.identity);
    const wrapper = document.createElement('span');
    wrapper.className = 'anomalous-recipe-identity-badge-wrap';
    const badge = document.createElement('span');
    badge.className = `anomalous-recipe-identity-badge anomalous-recipe-identity-${identity.status}`;
    
    const textSpan = document.createElement('span');
    textSpan.textContent = t(`recipeIdentity${identity.status[0].toUpperCase()}${identity.status.slice(1)}`);
    badge.appendChild(textSpan);
    
    const helpIcon = document.createElement('button');
    helpIcon.type = 'button';
    helpIcon.textContent = '?';
    helpIcon.className = 'anomalous-recipe-identity-help';
    const helpText = t('recipeIdentityHelpDesc') || 'Verification checks physical file consistency, not model quality.';
    helpIcon.setAttribute('aria-expanded', 'false');
    helpIcon.setAttribute('aria-label', helpText);
    badge.appendChild(helpIcon);

    const explanation = document.createElement('span');
    explanation.className = 'anomalous-recipe-identity-explanation';
    explanation.textContent = helpText;
    explanation.setAttribute('role', 'note');
    helpIcon.onclick = (event) => {
        event.stopPropagation();
        const expanded = wrapper.classList.toggle('is-open');
        helpIcon.setAttribute('aria-expanded', String(expanded));
    };

    wrapper.append(badge, explanation);
    return wrapper;
}

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

function resolutionTypesForReference(reference) {
    return folderTypesForReference(reference).filter((type) => [
        'checkpoints', 'unet', 'diffusion_models', 'loras', 'vae', 'vae_approx',
        'controlnet', 'clip', 'text_encoders', 'clip_vision',
    ].includes(type));
}

export function modelDisplayName(value) {
    const path = String(value || '').replace(/\\/g, '/');
    const filename = path.split('/').pop() || t('recipeDetailUnavailable');
    return filename.replace(/\.(?:safetensors|ckpt|pt|bin|sft)$/i, '');
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

export function appendModelPreview(parent, owner, reference, onActivate = null) {
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
        appendText(preview, 'small', t('recipeDetailNoPreview'));
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
        image.alt = reference.saved_value || t(snapshotUrl ? 'recipeDetailSavedSnapshot' : 'recipeDetailCurrentPreview');
        image.loading = 'lazy';
        preview.appendChild(image);
    }
    appendText(preview, 'small', t(snapshotUrl ? 'recipeDetailSavedSnapshot' : 'recipeDetailCurrentPreview'));
    parent.appendChild(preview);
}

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
        if (!model) continue;
        reference.currentPreviewUrl = model.preview_url || '';
        reference.currentAvailability = 'available';
        reference.localModel = model;
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

async function resolveMatchedModelPreview(reference, model) {
    if (!model?.filename || !model?.type) return null;
    const response = await fetch('/anomalous/resolve_paths_to_previews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            paths: [],
            exact_only: true,
            context_requests: [{
                key: 'match',
                path: model.filename,
                folder_types: [model.type],
                exact_only: true,
            }],
        }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error('matched model preview request failed');
    return payload.context_models?.match || null;
}

function sameStoredModelReference(candidate, reference) {
    return String(candidate?.node_id ?? '') === String(reference?.node_id ?? '')
        && Number(candidate?.widget_index) === Number(reference?.widget_index)
        && String(candidate?.category || '') === String(reference?.category || '')
        && candidate?.saved_value === reference?.saved_value;
}

function identityForLocalMatch(reference, model, result) {
    const sourceIdentity = normaliseIdentity(reference?.identity);
    const metadataHash = String(model?.metadata?.hash || '').trim();
    const sha256 = result?.matched_by_hash && sourceIdentity.sha256
        ? sourceIdentity.sha256
        : (/^[0-9a-f]{64}$/i.test(metadataHash) ? metadataHash.toLowerCase() : '');
    const modelSize = Number(model?.size_bytes);
    const resultSize = Number(result?.size);
    const size = Number.isFinite(modelSize) && modelSize > 0 ? modelSize : resultSize;
    const identity = {
        status: sha256 ? 'verified' : 'unverified',
        provenance: result?.matched_by_hash
            ? 'local hash match'
            : (sha256 ? 'confirmed local candidate metadata' : 'manual size confirmation'),
    };
    if (sha256) identity.sha256 = sha256;
    if (Number.isFinite(size) && size > 0) identity.size = size;
    return identity;
}

export async function matchLocalModel(owner, recipe, reference, status, rerender) {
    const identity = normaliseIdentity(reference.identity);
    const query = new URLSearchParams({
        hash: identity.sha256 || 'unknown',
        size: identity.size || '',
        filename: reference.saved_value || '',
    });
    const types = resolutionTypesForReference(reference);
    if (types.length) query.set('type', types.join(','));
    status.textContent = t('recipeMatchingLocalModel');
    try {
        const response = await fetch(`/anomalous/resolve_hash?${query.toString()}`);
        const result = await response.json();
        if (!response.ok) throw new Error('local model matching failed');
        if (!result.found && !result.confirmation_required) {
            status.textContent = result.identity_conflict
                ? t('recipeLocalModelIdentityConflict')
                : result.ambiguous
                    ? t('recipeLocalModelAmbiguous')
                    : t('recipeLocalModelNotFound');
            return;
        }
        const model = await resolveMatchedModelPreview(reference, result);
        if (!model) throw new Error('matched local model metadata unavailable');
        reference.localModel = model;
        reference.currentPreviewUrl = model.preview_url || '';
        reference.currentAvailability = 'available';
        reference.localMatch = {
            filename: result.filename,
            type: model.type,
            matched_by_hash: result.matched_by_hash === true,
            matched_by_size: result.matched_by_size === true,
            confirmation_required: result.confirmation_required === true,
            identity: identityForLocalMatch(reference, model, result),
        };
        rerender();
    } catch (error) {
        console.error('Could not match imported recipe model locally:', error);
        status.textContent = t('recipeLocalModelMatchError');
    }
}

export async function matchRecipeModels(owner, references, status, rerender) {
    const candidates = references.filter((reference) => !reference.localModel);
    const items = candidates.map((reference, index) => {
        const identity = normaliseIdentity(reference.identity);
        return {
            key: String(index),
            hash: identity.sha256 || 'unknown',
            size: identity.size ?? null,
            type: resolutionTypesForReference(reference).join(','),
        };
    });
    if (!items.length) {
        status.textContent = t('recipeAllModelsMatched');
        return { found: 0, total: 0 };
    }

    status.textContent = t('recipeMatchingRecipeModels');
    const response = await fetch('/anomalous/resolve_hash_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
    });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.results)) throw new Error('recipe model matching failed');

    let found = 0;
    for (const item of payload.results) {
        const reference = candidates[Number(item.key)];
        const result = item.result;
        if (!reference || (!result?.found && !result?.confirmation_required)) continue;
        let model;
        try {
            model = await resolveMatchedModelPreview(reference, result);
        } catch (error) {
            console.warn('Could not load preview for matched recipe model:', error);
            continue;
        }
        if (!model) continue;
        reference.localModel = model;
        reference.currentPreviewUrl = model.preview_url || '';
        reference.currentAvailability = 'available';
        reference.localMatch = {
            filename: result.filename,
            type: model.type,
            matched_by_hash: result.matched_by_hash === true,
            matched_by_size: result.matched_by_size === true,
            confirmation_required: result.confirmation_required === true,
            identity: identityForLocalMatch(reference, model, result),
        };
        found += 1;
    }
    rerender();
    return { found, total: candidates.length };
}

export async function applyLocalModelMatch(owner, recipe, reference, status, rerender) {
    const filename = reference.localMatch?.filename || '';
    const node = (recipe?.workflow?.nodes || []).find(
        (candidate) => String(candidate?.id ?? '') === String(reference?.node_id ?? ''),
    );
    const index = Number(reference?.widget_index);
    if (!filename || !node || !Number.isInteger(index) || !Array.isArray(node.widgets_values) || index < 0 || index >= node.widgets_values.length) {
        status.textContent = t('recipeApplyLocalMatchError');
        return false;
    }

    const workflow = JSON.parse(JSON.stringify(recipe.workflow));
    const target = workflow.nodes.find((candidate) => String(candidate?.id ?? '') === String(reference.node_id ?? ''));
    if (!target || !Array.isArray(target.widgets_values)) {
        status.textContent = t('recipeApplyLocalMatchError');
        return false;
    }
    target.widgets_values[index] = filename;
    const previousValue = reference.saved_value;
    const localIdentity = normaliseIdentity(reference.localMatch?.identity);
    replaceWorkflowModelHashRecord(workflow, reference.node_id, previousValue, filename, localIdentity);

    const params = JSON.parse(JSON.stringify(recipe.params || {}));
    if (Array.isArray(params.model_references)) {
        const stored = params.model_references.find((candidate) => sameStoredModelReference(candidate, reference));
        if (stored) {
            stored.saved_value = filename;
            stored.identity = localIdentity;
        }
    }
    if (params.baseModel === previousValue) params.baseModel = filename;

    status.textContent = t('recipeApplyingLocalMatch');
    try {
        await updateRecipeMetadata(owner, recipe, { workflow, params });
        reference.saved_value = filename;
        reference.identity = localIdentity;
        reference.localMatch = null;
        reference.currentAvailability = 'available';
        rerender();
        status.textContent = t('recipeApplyLocalMatchSuccess');
        return true;
    } catch (error) {
        console.error('Could not apply local recipe model match:', error);
        status.textContent = t('recipeApplyLocalMatchError');
        return false;
    }
}

export async function applyAllLocalModelMatches(owner, recipe, references, status, rerender) {
    const candidates = (references || []).filter((ref) => ref?.localMatch?.filename);
    if (!candidates.length) return false;

    const workflow = JSON.parse(JSON.stringify(recipe.workflow));
    const params = JSON.parse(JSON.stringify(recipe.params || {}));
    if (!Array.isArray(params.model_references)) params.model_references = [];

    let appliedCount = 0;
    for (const reference of candidates) {
        const filename = reference.localMatch.filename;
        const target = workflow.nodes?.find((c) => String(c?.id ?? '') === String(reference.node_id ?? ''));
        const index = Number(reference.widget_index);
        if (!target || !Array.isArray(target.widgets_values) || index < 0 || index >= target.widgets_values.length) continue;

        target.widgets_values[index] = filename;
        const previousValue = reference.saved_value;
        const localIdentity = normaliseIdentity(reference.localMatch.identity);
        replaceWorkflowModelHashRecord(workflow, reference.node_id, previousValue, filename, localIdentity);

        const stored = params.model_references.find((c) => sameStoredModelReference(c, reference));
        if (stored) {
            stored.saved_value = filename;
            stored.identity = localIdentity;
        }
        if (params.baseModel === previousValue) params.baseModel = filename;

        reference.saved_value = filename;
        reference.identity = localIdentity;
        reference.localMatch = null;
        reference.currentAvailability = 'available';
        appliedCount += 1;
    }

    if (appliedCount === 0) return false;

    if (status) status.textContent = t('recipeApplyingAllMatches');
    try {
        await updateRecipeMetadata(owner, recipe, { workflow, params });
        if (typeof rerender === 'function') rerender();
        if (status) status.textContent = t('recipeApplyAllMatchesSuccess');
        return true;
    } catch (error) {
        console.error('Could not apply all local model matches:', error);
        if (status) status.textContent = t('recipeApplyLocalMatchError');
        return false;
    }
}

export async function updateRecipeModelNote(owner, recipe, reference, note, rerender) {
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
    rerender();
}

