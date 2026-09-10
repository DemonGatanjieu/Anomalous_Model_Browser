import { escapeHtml } from './safe_dom.js';
import { showMaterialSaved } from './material_feedback.js';
import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import {
    deriveRecipeModelReferences,
    formatIdentitySize,
    normaliseIdentity,
    recipeReferenceKey,
    shortHash,
} from './recipe_identity.js';
import { buildRecipeDiff, diffIsEmpty } from './recipe_diff.js';
import {
    appendRecipeToCanvas,
    applyRecipeParametersToCanvas,
    assertRecipeSkeleton,
} from './recipe_actions.js';
import {
    applyRecipeWidgetChanges,
    captureRecipeDraft,
    isSupportedPromptNodeType,
} from './recipe_parser.js';
import { replaceWorkflowModelHashRecord } from './recipe_provenance.js';
import { showImageMaterialDetail } from './ui_materials.js';

const t = (key, params) => translate(key, params);

function appendText(parent, tagName, text, className = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text == null ? '' : String(text);
    parent.appendChild(element);
    return element;
}

function button(parent, label, className = '') {
    const element = appendText(parent, 'button', label, className);
    element.type = 'button';
    return element;
}

function closeRecipeWorkspace(owner) {
    if (!owner) return;
    owner.nbPanel && (owner.nbPanel.style.display = 'none');
    owner.notebookBody && (owner.notebookBody.style.display = 'none');
    owner.recipeView && (owner.recipeView.style.display = 'none');
    owner.modal?.classList.remove('visible');
    owner?.close?.();
}

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

export async function applyRecipeToCanvas(owner, recipe) {
    try {
        if (recipe?.workflow_scope === 'partial') {
            appendRecipeToCanvas(recipe);
        } else {
            if (!recipe?.workflow || typeof app.loadGraphData !== 'function') throw new Error('recipe_open_unavailable');
            await app.loadGraphData(JSON.parse(JSON.stringify(recipe.workflow)));
            app.canvas?.setDirty?.(true, true);
        }
        closeRecipeWorkspace(owner);
        return true;
    } catch (error) {
        const partial = recipe?.workflow_scope === 'partial';
        console.error(`Could not ${partial ? 'append' : 'open'} Workflow Recipe:`, error);
        await anomalousAlert(partial && error.code === 'recipe_append_missing_node'
            ? `${t('recipeAppendError')}\n${error.message}`
            : t(partial ? 'recipeAppendError' : 'recipeOpenError'));
        return false;
    }
}

function recipeCanvasActionLabel(recipe) {
    return t(recipe?.workflow_scope === 'partial' ? 'recipeAppendCanvas' : 'recipeOpenCanvas');
}

function displayValue(value) {
    if (value === undefined) return '';
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value) ?? String(value); } catch (error) { return String(value); }
}

function compact(value, limit = 180) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function dateText(value) {
    if (!value) return t('recipeDetailUnknownTime');
    try { return new Date(Number(value)).toLocaleString(); } catch (error) { return t('recipeDetailUnknownTime'); }
}

async function copyText(value) {
    if (value === null || value === undefined || value === '') return false;
    try {
        await navigator.clipboard.writeText(String(value));
        return true;
    } catch (error) {
        console.warn('Could not copy recipe detail value:', error);
        return false;
    }
}

async function copyTextWithFeedback(buttonElement, value) {
    const original = buttonElement.textContent;
    const isIcon = original.length <= 2;
    const copied = await copyText(value);
    
    if (isIcon) {
        buttonElement.textContent = copied ? '✓' : '!';
    } else {
        buttonElement.textContent = copied
            ? `✓ ${t('recipeCopied')}`
            : `! ${t('recipeCopyFailed')}`;
    }
    
    buttonElement.style.color = copied ? '#6ee7b7' : '#fca5a5';
    buttonElement.style.borderColor = copied ? 'rgba(110, 231, 183, 0.7)' : 'rgba(252, 165, 165, 0.7)';
    buttonElement.style.transition = 'all 0.2s ease';
    
    window.setTimeout(() => {
        buttonElement.textContent = original;
        buttonElement.style.color = '';
        buttonElement.style.borderColor = '';
    }, 1200);
    return copied;
}

function appendCopyButton(parent, value, label = t('recipeCopyParameter')) {
    const copy = button(parent, '', 'anomalous-recipe-copy-param anomalous-recipe-detail-copy');
    copy.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    copy.title = label;
    copy.setAttribute('aria-label', label);
    copy.onclick = () => { void copyTextWithFeedback(copy, value); };
    return copy;
}

async function updateInlineRecipeMetadata(owner, recipe, changes) {
    const filename = owner?.recipeDetailFilename;
    if (!filename) throw new Error('recipe metadata filename missing');
    const next = JSON.parse(JSON.stringify({ ...recipe, ...changes }));
    const response = await fetch('/anomalous/update_recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, ...next }),
    });
    const payload = await response.json();
    if (!response.ok || payload.status !== 'success') throw new Error('recipe metadata update failed');
    Object.assign(recipe, changes, { updated_timestamp: Date.now() });
    await owner.refreshRecipes?.();
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
            await updateInlineRecipeMetadata(owner, recipe, { [field]: value });
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

function needsExpansion(value) {
    const text = String(value || '');
    return text.length > 260 || text.split(/\r?\n/).length > 3;
}

function appendValueViewer(parent, value, className = '', options = {}) {
    const text = displayValue(value);
    const viewer = document.createElement('div');
    viewer.className = `anomalous-recipe-detail-value-viewer${className ? ` ${className}` : ''}`;
    const code = appendText(viewer, 'code', text, 'anomalous-recipe-detail-full-value');
    if (options.collapse !== false && needsExpansion(text)) {
        code.classList.add('is-collapsed');
        const toggle = button(viewer, t('recipeDetailExpandValue'), 'anomalous-recipe-detail-value-toggle');
        toggle.onclick = () => {
            const expanded = code.classList.toggle('is-collapsed') === false;
            toggle.textContent = expanded ? t('recipeDetailCollapseValue') : t('recipeDetailExpandValue');
        };
    }
    if (options.copy !== false) appendCopyButton(viewer, text);
    parent.appendChild(viewer);
    return viewer;
}

const PROMPT_ROLES = new Set(['positive', 'negative', 'both', 'ignored', 'unknown']);
const PROMPT_WIDGET_NAME = /^(?:text|prompt|text_[gl]|positive|negative)$/i;

function promptTextForNode(source, node) {
    const values = [];
    for (const widget of node?.widgets || []) {
        if (!PROMPT_WIDGET_NAME.test(String(widget?.name || ''))) continue;
        const value = fullWidgetValue(source, node, widget);
        if (typeof value === 'string' && value.trim() && !values.includes(value.trim())) values.push(value.trim());
    }
    if (!values.length && isSupportedPromptNodeType(node?.type)) {
        const workflowNode = (source?.workflow?.nodes || []).find((candidate) => String(candidate?.id) === String(node?.id));
        const value = workflowNode?.widgets_values?.find((candidate) => typeof candidate === 'string' && candidate.trim());
        if (value) values.push(value.trim());
    }
    return values.join('\n\n');
}

function legacyPromptRole(params, text) {
    if (!text) return null;
    const positive = new Set(Array.isArray(params?.promptPositive) ? params.promptPositive : []);
    const negative = new Set(Array.isArray(params?.promptNegative) ? params.promptNegative : []);
    if (positive.has(text) && !negative.has(text)) return 'positive';
    if (negative.has(text) && !positive.has(text)) return 'negative';
    return null;
}

function promptEntries(source, roleOwner = source) {
    const params = source?.params || {};
    const roleParams = roleOwner?.params || {};
    const overrides = roleParams.promptRoleOverrides || {};
    const entries = [];
    for (const node of params.nodes || []) {
        const text = promptTextForNode(source, node);
        if (!text) continue;
        const isKnown = isSupportedPromptNodeType(node?.type);
        const isTextCandidate = isKnown || (node.widgets || []).some((widget) => PROMPT_WIDGET_NAME.test(String(widget?.name || '')));
        if (!isTextCandidate) continue;
        const override = overrides[String(node.id)]?.role;
        const automaticRole = PROMPT_ROLES.has(node.role)
            ? node.role
            : (isKnown ? legacyPromptRole(params, text) : null);
        entries.push({
            id: node.id,
            type: node.type || 'Unknown',
            title: node.title || node.type || t('recipeDetailUnknownNode'),
            text,
            supported: isKnown,
            automaticRole: automaticRole || 'unknown',
            role: PROMPT_ROLES.has(override) ? override : (automaticRole || 'unknown'),
            manual: PROMPT_ROLES.has(override),
        });
    }
    return entries;
}

function promptValues(source, roleOwner = source) {
    const positive = [];
    const negative = [];
    const entries = promptEntries(source, roleOwner);
    for (const entry of entries) {
        if ((entry.role === 'positive' || entry.role === 'both') && !positive.includes(entry.text)) positive.push(entry.text);
        if ((entry.role === 'negative' || entry.role === 'both') && !negative.includes(entry.text)) negative.push(entry.text);
    }
    return { positive, negative, entries };
}

function paramsWithPromptRole(recipe, nodeId, selectedRole) {
    const params = JSON.parse(JSON.stringify(recipe?.params || {}));
    const overrides = { ...(params.promptRoleOverrides || {}) };
    const key = String(nodeId);
    if (selectedRole === 'auto') {
        delete overrides[key];
    } else if (PROMPT_ROLES.has(selectedRole)) {
        const workflowNode = (recipe?.workflow?.nodes || []).find((node) => String(node?.id) === key);
        overrides[key] = {
            role: selectedRole,
            nodeType: workflowNode?.type || (params.nodes || []).find((node) => String(node?.id) === key)?.type || 'Unknown',
            source: 'manual',
        };
    }
    if (Object.keys(overrides).length) params.promptRoleOverrides = overrides;
    else delete params.promptRoleOverrides;

    const owner = { ...recipe, params };
    const resolved = promptEntries(owner, owner);
    params.promptPositive = [...new Set(resolved.filter((entry) => entry.role === 'positive' || entry.role === 'both').map((entry) => entry.text))];
    params.promptNegative = [...new Set(resolved.filter((entry) => entry.role === 'negative' || entry.role === 'both').map((entry) => entry.text))];
    return params;
}

function fullWidgetValue(recipe, node, widget) {
    const workflowNode = (recipe?.workflow?.nodes || []).find((candidate) => String(candidate?.id) === String(node?.id));
    const index = Number.isInteger(widget?.index) ? widget.index : -1;
    if (index >= 0 && Array.isArray(workflowNode?.widgets_values) && workflowNode.widgets_values[index] !== undefined) {
        return workflowNode.widgets_values[index];
    }
    return widget?.value;
}

function fullDiffValue(value) {
    if (value === null || value === undefined || value === '') return t('recipeDetailUnavailable');
    if (typeof value === 'string') return value.trim();
    try { return JSON.stringify(value, null, 2); } catch (error) { return String(value); }
}

function identityBadge(reference) {
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

function fingerprintText(recipe) {
    return recipe?.workflow_fingerprint?.value || '';
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

function modelDisplayName(value) {
    const path = String(value || '').replace(/\\/g, '/');
    const filename = path.split('/').pop() || t('recipeDetailUnavailable');
    return filename.replace(/\.(?:safetensors|ckpt|pt|bin|sft)$/i, '');
}

function previewIsVideo(url) {
    return /\.(?:mp4|webm)(?:$|\?|&|#)/i.test(url || '');
}

function outputImageUrl(image) {
    if (!image || image.type !== 'output' || typeof image.filename !== 'string') return '';
    const query = new URLSearchParams({ filename: image.filename, type: 'output' });
    if (image.subfolder) query.set('subfolder', image.subfolder);
    return `/view?${query.toString()}`;
}

function galleryWorkbenchItems(images) {
    return (images || []).map(sourceImage => ({
        filename: sourceImage.filename,
        subfolder: sourceImage.subfolder || '',
        url: outputImageUrl(sourceImage),
        sourceImage,
    })).filter(item => item.url);
}

function openGalleryImageDetail(owner, images, sourceImage, url) {
    const items = galleryWorkbenchItems(images);
    const currentIndex = items.findIndex(item =>
        item.filename === sourceImage?.filename && (item.subfolder || '') === (sourceImage?.subfolder || '')
    );
    void showImageMaterialDetail(owner, sourceImage, url, {
        items,
        currentIndex: currentIndex >= 0 ? currentIndex : 0,
    });
}

function appendRecipeCover(parent, owner, recipe) {
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

async function loadCurrentPreviews(owner, references) {
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

function openLocalModel(owner, model) {
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

async function matchLocalModel(owner, recipe, reference, status, rerender) {
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

async function matchRecipeModels(owner, references, status, rerender) {
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

async function applyLocalModelMatch(owner, recipe, reference, status, rerender) {
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
        await updateInlineRecipeMetadata(owner, recipe, { workflow, params });
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

async function applyAllLocalModelMatches(owner, recipe, references, status, rerender) {
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
        await updateInlineRecipeMetadata(owner, recipe, { workflow, params });
        if (typeof rerender === 'function') rerender();
        if (status) status.textContent = t('recipeApplyAllMatchesSuccess');
        return true;
    } catch (error) {
        console.error('Could not apply all local model matches:', error);
        if (status) status.textContent = t('recipeApplyLocalMatchError');
        return false;
    }
}

async function updateRecipeModelNote(owner, recipe, reference, note, rerender) {
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
    await updateInlineRecipeMetadata(owner, recipe, { params });
    recipe.params = params;
    reference.user_note = cleanNote;
    rerender();
}

function missingNodeTypes(recipe) {
    const registry = globalThis.LiteGraph?.registered_node_types;
    if (!registry) return [];
    return [...new Set((recipe?.workflow?.nodes || [])
        .map((node) => node?.type || node?.class_type)
        .filter((type) => type && !registry[type]))];
}

function renderStat(parent, label, value, kind = '') {
    const stat = document.createElement('div');
    stat.className = 'anomalous-recipe-detail-stat';
    appendText(stat, 'span', label, 'anomalous-recipe-detail-stat-label');
    appendText(stat, 'strong', value, kind ? `anomalous-recipe-detail-stat-${kind}` : '');
    parent.appendChild(stat);
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

function renderReadinessBanner(parent, owner, recipe, references, finish, onRerender) {
    const banner = document.createElement('div');
    const hasPendingMatches = (references || []).some((ref) => ref.localMatch && !ref.localModel);
    const missingCandidates = (references || []).filter((ref) => !ref.localModel && ref.currentAvailability === 'missing' && !ref.localMatch);
    const missingNodes = missingNodeTypes(recipe);

    let bannerKind = 'is-ready';
    let statusText = t('recipeStatusReady');

    if (hasPendingMatches) {
        bannerKind = 'is-warning';
        const pendingCount = (references || []).filter((ref) => ref.localMatch && !ref.localModel).length;
        statusText = t('recipeStatusNeedAttention').replace('{count}', String(pendingCount));
    } else if (missingCandidates.length > 0) {
        bannerKind = 'is-missing';
        statusText = t('recipeStatusMissing').replace('{count}', String(missingCandidates.length));
    }

    banner.className = `anomalous-recipe-readiness-banner ${bannerKind}`;

    const textWrap = document.createElement('div');
    textWrap.style.display = 'flex';
    textWrap.style.flexDirection = 'column';
    textWrap.style.gap = '3px';

    const mainStatus = appendText(textWrap, 'strong', statusText);
    if (missingNodes.length > 0) {
        appendText(textWrap, 'small', `⚠️ ${t('recipeMissingNodes')}: ${missingNodes.slice(0, 3).join(', ')}${missingNodes.length > 3 ? '…' : ''}`, 'anomalous-recipe-detail-muted');
    }
    banner.appendChild(textWrap);

    const actionWrap = document.createElement('div');
    actionWrap.style.display = 'flex';
    actionWrap.style.gap = '8px';
    actionWrap.style.alignItems = 'center';

    if (hasPendingMatches) {
        const applyAllBtn = button(actionWrap, t('recipeApplyAllMatches'), 'anomalous-recipe-banner-btn is-match-all');
        applyAllBtn.onclick = async () => {
            applyAllBtn.disabled = true;
            await applyAllLocalModelMatches(owner, recipe, references, mainStatus, onRerender);
        };
    } else if (missingCandidates.length > 0) {
        const matchBtn = button(actionWrap, '🔎 ' + t('recipeMatchRecipeModels'), 'anomalous-btn-ghost');
        matchBtn.style.padding = '4px 10px';
        matchBtn.style.fontSize = '0.8rem';
        matchBtn.onclick = async () => {
            matchBtn.disabled = true;
            matchBtn.textContent = t('recipeMatchingRecipeModels');
            try {
                await matchRecipeModels(owner, references, mainStatus, onRerender);
            } finally {
                matchBtn.disabled = false;
                matchBtn.textContent = '🔎 ' + t('recipeMatchRecipeModels');
            }
        };
    }

    banner.appendChild(actionWrap);
    parent.appendChild(banner);
}

function renderPromptOverviewSection(parent, recipe) {
    const prompts = promptValues(recipe, recipe);
    if (!prompts?.entries?.length) return;

    const wrap = document.createElement('div');
    wrap.style.display = 'grid';
    wrap.style.gap = '10px';
    wrap.style.marginBottom = '16px';

    for (const entry of prompts.entries) {
        if (!entry?.value || typeof entry.value !== 'string' || !entry.value.trim()) continue;
        const isNegative = entry.role === 'negative';
        const box = document.createElement('div');
        box.className = `anomalous-recipe-prompt-box ${isNegative ? 'is-negative' : 'is-positive'}`;

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '8px';

        const badge = document.createElement('span');
        badge.className = `anomalous-recipe-prompt-badge ${isNegative ? 'is-negative' : 'is-positive'}`;
        const isZh = window.anomalous_browser_lang === 'zh';
        badge.textContent = isNegative ? (isZh ? '🔴 负向提示词 (Negative)' : '🔴 Negative Prompt') : (isZh ? '🟢 正向提示词 (Positive)' : '🟢 Positive Prompt');
        header.appendChild(badge);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'anomalous-recipe-prompt-micro-copy';
        const copyTitle = isZh ? '复制提示词' : 'Copy prompt';
        const copiedTitle = isZh ? '已复制' : 'Copied';
        copyBtn.title = copyTitle;
        copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(entry.value).then(() => {
                copyBtn.classList.add('is-copied');
                copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
                copyBtn.title = copiedTitle;
                setTimeout(() => {
                    copyBtn.classList.remove('is-copied');
                    copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
                    copyBtn.title = copyTitle;
                }, 1500);
            });
        };
        header.appendChild(copyBtn);

        box.appendChild(header);
        const text = appendText(box, 'div', entry.value);
        text.style.whiteSpace = 'pre-wrap';
        text.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        text.style.fontSize = '0.82rem';
        text.style.lineHeight = '1.6';
        text.style.color = '#cbd5e1';

        wrap.appendChild(box);
    }

    if (wrap.childElementCount) {
        parent.appendChild(wrap);
    }
}

function renderOverview(content, owner, recipe, references, finish) {
    const overview = document.createElement('div');
    overview.className = 'anomalous-recipe-detail-overview';
    const hero = document.createElement('div');
    hero.className = 'anomalous-recipe-detail-hero';
    
    // Left media wrap
    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'anomalous-recipe-detail-hero-media';
    appendRecipeCover(mediaWrap, owner, recipe);
    hero.appendChild(mediaWrap);

    // Right control deck
    const copy = document.createElement('div');
    copy.className = 'anomalous-recipe-detail-hero-copy';
    
    // Title + Scope Capsule
    const titleRow = document.createElement('div');
    titleRow.className = 'anomalous-recipe-inline-title-row';
    titleRow.style.display = 'flex';
    titleRow.style.alignItems = 'center';
    titleRow.style.gap = '8px';
    titleRow.style.flexWrap = 'wrap';
    renderInlineTitle(titleRow, owner, recipe);
    
    const scopePill = document.createElement('span');
    scopePill.className = 'anomalous-recipe-scope-pill';
    scopePill.textContent = recipe.workflow_scope === 'partial' ? t('recipeScopePartial') : t('recipeScopeComplete');
    titleRow.appendChild(scopePill);
    copy.appendChild(titleRow);

    // Readiness status banner inside Hero
    renderReadinessBanner(copy, owner, recipe, references, finish, () => {
        if (owner.recipeDetailActiveTab === 'overview') {
            content.replaceChildren();
            renderOverview(content, owner, recipe, references, finish);
        }
    });

    // Primary action bar
    const overviewActions = document.createElement('div');
    overviewActions.className = 'anomalous-recipe-actions-primary';
    overviewActions.style.margin = '8px 0';
    overviewActions.style.display = 'flex';
    overviewActions.style.alignItems = 'center';
    overviewActions.style.gap = '8px';

    const heroAppendIcon = recipe?.workflow_scope === 'partial'
        ? `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`
        : `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    const heroAppend = button(
        overviewActions,
        '',
        'anomalous-recipe-btn-primary-action',
    );
    heroAppend.innerHTML = `${heroAppendIcon}${recipeCanvasActionLabel(recipe)}`;
    heroAppend.style.padding = '8px 16px';
    heroAppend.style.fontSize = '0.88rem';
    heroAppend.onclick = () => {
        void runRecipeAction(heroAppend, async () => {
            if (await applyRecipeToCanvas(owner, recipe)) finish('canvas');
        });
    };

    const more = document.createElement('details');
    more.className = 'anomalous-secondary-actions';
    appendText(more, 'summary', t('notebookMore'));
    overviewActions.appendChild(more);

    const heroEdit = button(more, '', 'anomalous-btn-ghost');
    heroEdit.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>${t('recipeEdit')}`;
    heroEdit.title = t('recipeEdit');
    heroEdit.onclick = () => finish('edit');

    const heroExport = button(more, '', 'anomalous-btn-ghost');
    heroExport.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${t('recipeExport')}`;
    heroExport.title = t('recipeExport');
    heroExport.onclick = async () => {
        try {
            await exportRecipePackage(owner.recipeDetailFilename, recipe);
        } catch (error) {
            console.error('Could not export recipe package:', error);
            await anomalousAlert(t('recipeExportError'));
        }
    };

    copy.appendChild(overviewActions);

    // Studio Metrics Grid
    const params = recipe?.params || {};
    const resDisplay = formatRecipeResolution(params.resolution);
    if (params.steps || params.cfg || params.sampler_name || resDisplay) {
        const metrics = document.createElement('div');
        metrics.className = 'anomalous-recipe-studio-metrics';
        const addTile = (labelKey, val) => {
            if (val === undefined || val === null || val === '') return;
            const tile = document.createElement('div');
            tile.className = 'anomalous-recipe-studio-metric-tile';
            appendText(tile, 'span', t(labelKey), 'anomalous-recipe-studio-metric-label');
            appendText(tile, 'span', String(val), 'anomalous-recipe-studio-metric-val');
            metrics.appendChild(tile);
        };
        addTile('recipeDetailSteps', params.steps);
        addTile('recipeDetailCFG', params.cfg);
        addTile('recipeDetailSampler', params.sampler_name || params.samplers);
        addTile('recipeDetailResolution', resDisplay);
        copy.appendChild(metrics);
    }

    // Notes & Tags
    const notes = document.createElement('div');
    notes.className = 'anomalous-recipe-detail-notes';
    renderInlineNotes(notes, owner, recipe);
    copy.appendChild(notes);

    const tags = document.createElement('div');
    tags.className = 'anomalous-recipe-tags anomalous-recipe-detail-tags';
    renderInlineTags(tags, owner, recipe);
    copy.appendChild(tags);

    const updatedSmall = appendText(copy, 'small', `${t('recipeDetailUpdated')}: ${dateText(recipe.updated_timestamp || recipe.timestamp)}`, 'anomalous-recipe-detail-muted');
    updatedSmall.style.marginTop = '6px';
    updatedSmall.style.display = 'block';
    updatedSmall.style.opacity = '0.75';

    hero.appendChild(copy);
    overview.appendChild(hero);

    // Prompt Showcase Section
    renderPromptOverviewSection(overview, recipe);

    // Technical details
    const advanced = document.createElement('details');
    advanced.className = 'anomalous-recipe-advanced-info';
    advanced.style.marginBottom = '14px';
    appendText(advanced, 'summary', t('recipeAdvancedInfo'));
    const fingerprint = document.createElement('div');
    fingerprint.className = 'anomalous-recipe-advanced-row';
    appendText(fingerprint, 'span', `${t('recipeDetailFingerprint')}:`);
    appendText(fingerprint, 'code', fingerprintText(recipe) || t('recipeDetailNotIndexed'));
    if (fingerprintText(recipe)) appendCopyButton(fingerprint, fingerprintText(recipe), t('recipeDetailCopyFingerprint'));
    advanced.appendChild(fingerprint);
    overview.appendChild(advanced);

    // Model Equipment Summary
    const summary = document.createElement('section');
    summary.className = 'anomalous-recipe-detail-section';
    appendText(summary, 'h4', t('recipeDetailSummary'));
    const modelComposition = document.createElement('div');
    modelComposition.className = 'anomalous-recipe-model-composition';
    summary.appendChild(modelComposition);
    renderModelComposition(modelComposition, owner, recipe, references, finish, params);
    overview.appendChild(summary);

    content.appendChild(overview);
}

function openOriginEditDialog(owner, recipe, reference, finish) {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(0, 0, 0, 0.6)';
    overlay.style.backdropFilter = 'blur(4px)';
    overlay.style.padding = '20px';
    overlay.style.boxSizing = 'border-box';
    
    const dialog = document.createElement('div');
    dialog.style.background = 'linear-gradient(145deg, rgba(48, 49, 55, 0.98), rgba(27, 28, 33, 0.98))';
    dialog.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    dialog.style.borderRadius = '16px';
    dialog.style.padding = '24px';
    dialog.style.maxWidth = '400px';
    dialog.style.width = '100%';
    dialog.style.boxShadow = '0 12px 40px rgba(0, 0, 0, 0.4)';
    dialog.style.color = '#fff';
    dialog.style.fontFamily = 'Inter, -apple-system, sans-serif';
    dialog.style.display = 'flex';
    dialog.style.flexDirection = 'column';
    dialog.style.gap = '16px';
    
    const title = document.createElement('h3');
    title.textContent = t('recipeOriginDialogTitle');
    title.style.margin = '0 0 8px 0';
    title.style.fontSize = '18px';
    title.style.fontWeight = '600';
    dialog.appendChild(title);

    if (!recipe.params || typeof recipe.params !== 'object') recipe.params = {};
    if (!Array.isArray(recipe.params.model_references)) recipe.params.model_references = [];
    const referenceCategory = reference?.category || reference?.type || '';
    let match = recipe.params.model_references.find((r) => (
        String(r?.node_id ?? '') === String(reference?.node_id ?? '')
        && Number(r?.widget_index) === Number(reference?.widget_index)
        && String(r?.category || r?.type || '') === String(referenceCategory)
        && r?.saved_value === reference?.saved_value
    ));
    if (!match) {
        match = {
            node_id: reference.node_id,
            node_type: reference.node_type,
            node_title: reference.node_title,
            widget_index: reference.widget_index,
            widget_name: reference.widget_name,
            saved_value: reference.saved_value,
            category: referenceCategory,
            base_model: reference.base_model,
            identity: reference.identity,
        };
        recipe.params.model_references.push(match);
    }

    const createInputGroup = (labelText, value) => {
        const group = document.createElement('div');
        group.style.display = 'flex';
        group.style.flexDirection = 'column';
        group.style.gap = '6px';
        const label = document.createElement('label');
        label.textContent = labelText;
        label.style.fontSize = '13px';
        label.style.color = 'rgba(255, 255, 255, 0.7)';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value || '';
        input.style.background = 'rgba(0, 0, 0, 0.2)';
        input.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        input.style.padding = '10px 12px';
        input.style.borderRadius = '8px';
        input.style.color = '#fff';
        input.style.fontSize = '14px';
        input.style.outline = 'none';
        input.style.transition = 'border-color 0.2s';
        input.onfocus = () => input.style.borderColor = 'var(--anomalous-accent, #6366f1)';
        input.onblur = () => input.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        group.appendChild(label);
        group.appendChild(input);
        return { group, input };
    };

    const nameGroup = createInputGroup(t('recipeOriginOfficialName'), match.origin?.model_name);
    dialog.appendChild(nameGroup.group);
    
    const urlGroup = createInputGroup(t('recipeOriginModelUrl'), match.origin?.model_url);
    dialog.appendChild(urlGroup.group);

    const hash = reference.identity?.sha256;
    if (hash) {
        const fetchBtn = document.createElement('button');
        fetchBtn.type = 'button';
        fetchBtn.className = 'anomalous-btn-ghost';
        fetchBtn.textContent = t('recipeOriginFetchHash');
        fetchBtn.style.padding = '8px 14px';
        fetchBtn.style.fontSize = '13px';
        fetchBtn.style.marginTop = '4px';
        
        fetchBtn.onclick = async () => {
            fetchBtn.disabled = true;
            fetchBtn.style.opacity = '0.5';
            fetchBtn.style.cursor = 'not-allowed';
            const originalText = fetchBtn.textContent;
            fetchBtn.textContent = t('recipeOriginFetching');
            try {
                const res = await fetch(`https://civitai.com/api/v1/model-versions/by-hash/${hash}`);
                if (!res.ok) throw new Error('Fetch failed');
                const data = await res.json();
                if (data && data.model && data.model.name) {
                    nameGroup.input.value = data.model.name;
                    urlGroup.input.value = `https://civitai.com/models/${data.modelId}?modelVersionId=${data.id}`;
                    fetchBtn.textContent = t('recipeOriginFetchSuccess');
                    fetchBtn.style.background = 'rgba(46, 204, 113, 0.2)';
                    fetchBtn.style.borderColor = 'rgba(46, 204, 113, 0.5)';
                    fetchBtn.style.color = '#2ecc71';
                } else {
                    throw new Error('Invalid data');
                }
            } catch (err) {
                console.error('Civitai fetch error:', err);
                fetchBtn.textContent = t('recipeOriginFetchFailed');
                fetchBtn.style.background = 'rgba(231, 76, 60, 0.2)';
                fetchBtn.style.borderColor = 'rgba(231, 76, 60, 0.5)';
                fetchBtn.style.color = '#e74c3c';
            }
            setTimeout(() => {
                fetchBtn.textContent = originalText;
                fetchBtn.disabled = false;
                fetchBtn.style.opacity = '1';
                fetchBtn.style.cursor = 'pointer';
                fetchBtn.style.background = '';
                fetchBtn.style.borderColor = '';
                fetchBtn.style.color = '';
            }, 2500);
        };
        dialog.appendChild(fetchBtn);
    }

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '12px';
    actions.style.justifyContent = 'flex-end';
    actions.style.marginTop = '16px';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = t('recipeCancel');
    cancelBtn.className = 'anomalous-btn-danger';
    cancelBtn.style.padding = '8px 16px';
    cancelBtn.style.fontSize = '14px';
    cancelBtn.onclick = () => document.body.removeChild(overlay);
    
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = t('recipeSave');
    saveBtn.className = 'anomalous-btn-primary';
    saveBtn.style.padding = '8px 16px';
    saveBtn.style.fontSize = '14px';
    
    saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
        saveBtn.style.cursor = 'wait';
        
        const newName = nameGroup.input.value.trim();
        const newUrl = urlGroup.input.value.trim();
        if (!match.origin) match.origin = {};
        match.origin.provider = 'civitai';
        if (newName) match.origin.model_name = newName; else delete match.origin.model_name;
        if (newUrl) match.origin.model_url = newUrl; else delete match.origin.model_url;
        
        try {
            await updateInlineRecipeMetadata(owner, recipe, { params: recipe.params });
            document.body.removeChild(overlay);
            finish('refresh');
        } catch (e) {
            console.error('Update failed', e);
            saveBtn.disabled = false;
            cancelBtn.disabled = false;
            saveBtn.style.opacity = '1';
            saveBtn.style.cursor = 'pointer';
            anomalousAlert(t('recipeUpdateError'));
        }
    };
    
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    dialog.appendChild(actions);
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    // Close on click outside
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });
}

function renderModelComposition(container, owner, recipe, references, finish, params) {
    container.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'anomalous-recipe-detail-section-heading';
    appendText(heading, 'h5', t('recipeDetailModelComposition'));
    const refresh = button(heading, t('recipeDetailRefreshAvailability'), 'anomalous-btn-primary anomalous-recipe-refresh-button');
    const status = appendText(
        heading,
        'small',
        owner.recipeDetailPreviewState === 'loading' ? t('recipeDetailLoadingPreviews') : '',
        'anomalous-recipe-detail-muted',
    );
    status.setAttribute('aria-live', 'polite');
    refresh.onclick = async () => {
        if (refresh.disabled) return;
        refresh.disabled = true;
        refresh.classList.add('is-loading');
        refresh.setAttribute('aria-busy', 'true');
        refresh.textContent = t('recipeDetailRefreshing');
        status.textContent = t('recipeDetailRefreshing');
        try {
            const response = await fetch('/anomalous/refresh_recipe_identity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: owner.recipeDetailFilename, references }),
            });
            const payload = await response.json();
            if (!response.ok || payload.status !== 'success') throw new Error('identity refresh failed');
            const resultMap = new Map((payload.results || []).map((item) => [
                `${item.node_id}:${item.widget_index}:${item.saved_value}`,
                item,
            ]));
            for (const reference of references) {
                const result = resultMap.get(`${reference.node_id}:${reference.widget_index}:${reference.saved_value}`);
                if (!result) continue;
                reference.currentAvailability = result.availability;
                if (result.identity && result.identity.status === 'verified' && !reference.identity?.sha256) {
                    reference.identity = result.identity;
                }
            }
            await loadCurrentPreviews(owner, references);
            renderModelComposition(container, owner, recipe, references, finish, params);
        } catch (error) {
            console.error('Could not refresh recipe model availability:', error);
            status.textContent = t('recipeDetailRefreshError');
            refresh.textContent = t('recipeDetailRefreshAvailability');
            refresh.disabled = false;
            refresh.classList.remove('is-loading');
            refresh.removeAttribute('aria-busy');
        }
    };
    container.appendChild(heading);
    if (!references.length) {
        appendText(container, 'p', t('recipeDetailNoModelReferences'), 'anomalous-recipe-detail-muted');
        return;
    }
    const baseModels = [];
    const otherModels = [];
    for (const reference of references) {
        const isBaseMatch = (params && params.baseModel && reference.saved_value === params.baseModel) || /(unet|checkpoint|ckpt|base)/i.test(reference.node_title || reference.node_type || reference.category || '');
        if (isBaseMatch) baseModels.push(reference);
        else otherModels.push(reference);
    }

    const createCard = (reference, forceBaseClass) => {
        const card = document.createElement('article');
        const isLocal = Boolean(reference.localModel);
        const isBase = forceBaseClass;
        card.className = `anomalous-recipe-model-reference${isLocal ? ' is-local' : ' is-unresolved'}${isBase ? ' is-base-model' : ''}`;
        const body = document.createElement('div');
        body.className = 'anomalous-recipe-model-reference-body';
        const openModel = isLocal
            ? () => {
                const payload = owner.recipeDetailPayload;
                const view = owner.recipeDetailView;
                owner.recipeReturnState = {
                    activeTab: owner.recipeDetailActiveTab || 'overview',
                    scrollTop: view?.scrollTop || 0,
                };
                owner.recipeModelReturn = () => {
                    owner.modal?.classList.add('visible');
                    if (owner.nbPanel) owner.nbPanel.style.display = 'flex';
                    if (owner.notebookBody) owner.notebookBody.style.display = 'none';
                    owner.notebookNotesTab?.classList.remove('active');
                    owner.notebookRecipesTab?.classList.add('active');
                    if (owner.detailPanel) {
                        owner.detailPanel.style.display = 'none';
                        owner.stopMediaInContainer?.(owner.detailPanel);
                        owner.detailPanel.replaceChildren();
                    }
                    if (owner.recipeView) owner.recipeView.style.display = 'flex';
                    if (payload) showRecipeDetail(owner, payload);
                };
                if (openLocalModel(owner, reference.localModel)) finish('model');
                else owner.recipeModelReturn = null;
            }
            : null;
        appendModelPreview(body, owner, reference, openModel);
        const details = document.createElement('div');
        details.className = 'anomalous-recipe-model-reference-details';
        const top = document.createElement('div');
        top.className = 'anomalous-recipe-model-reference-top';
        appendText(top, 'strong', reference.node_title || reference.node_type || t('recipeUnknownNode'));
        appendText(top, 'span', reference.category || t('recipeDetailModel'), 'anomalous-recipe-detail-muted');
        top.appendChild(identityBadge(reference));
        details.appendChild(top);
        const origin = reference.origin;
        const officialNameStr = origin?.model_name;
        const localFileNameStr = reference.saved_value || t('recipeDetailUnavailable');
        
        const primaryNameStr = officialNameStr ? officialNameStr : localFileNameStr;
        const nameBlock = document.createElement('div');
        nameBlock.className = 'anomalous-recipe-model-name-block';
        details.appendChild(nameBlock);
        
        const nameRow = document.createElement('div');
        nameRow.className = 'anomalous-recipe-model-name-row';
        nameBlock.appendChild(nameRow);

        const primaryName = isLocal
            ? button(nameRow, modelDisplayName(primaryNameStr), 'anomalous-recipe-model-name is-resolved')
            : appendText(nameRow, 'span', modelDisplayName(primaryNameStr), 'anomalous-recipe-model-name is-unresolved');
        
        primaryName.title = officialNameStr || localFileNameStr;
        if (isLocal) primaryName.onclick = openModel;

        if (officialNameStr && origin?.model_url) {
            const civitaiLink = document.createElement('a');
            civitaiLink.href = origin.model_url;
            civitaiLink.target = '_blank';
            civitaiLink.className = 'anomalous-recipe-civitai-btn';
            civitaiLink.innerHTML = '🌍 Civitai';
            civitaiLink.title = 'View on Civitai';
            civitaiLink.onclick = (e) => e.stopPropagation();
            nameRow.appendChild(civitaiLink);
        }
        
        const editOriginBtn = document.createElement('button');
        editOriginBtn.className = 'anomalous-recipe-civitai-btn';
        editOriginBtn.innerHTML = t('recipeDetailEditOrigin');
        editOriginBtn.title = t('recipeOriginDialogTitle');
        editOriginBtn.style.marginLeft = '8px';
        editOriginBtn.style.background = 'transparent';
        editOriginBtn.style.border = '1px solid rgba(255,255,255,0.1)';
        editOriginBtn.style.color = 'rgba(255,255,255,0.7)';
        editOriginBtn.onclick = (e) => {
            e.stopPropagation();
            openOriginEditDialog(owner, recipe, reference, finish);
        };

        if (officialNameStr) {
            const subName = document.createElement('div');
            subName.className = 'anomalous-recipe-model-subtitle';
            subName.textContent = localFileNameStr;
            subName.title = localFileNameStr;
            nameBlock.appendChild(subName);
        }
        const referenceDetails = document.createElement('details');
        referenceDetails.className = 'anomalous-recipe-advanced-info anomalous-recipe-model-path';
        appendText(referenceDetails, 'summary', t('recipeAdvancedInfo'));
        referenceDetails.appendChild(editOriginBtn);
        const referenceValue = document.createElement('div');
        referenceValue.className = 'anomalous-recipe-advanced-row';
        appendText(referenceValue, 'span', `${t('recipeModelPath')}:`);
        appendText(referenceValue, 'code', reference.saved_value || t('recipeDetailUnavailable'));
        appendCopyButton(referenceValue, reference.saved_value || '', t('recipeCopyParameter'));
        referenceDetails.appendChild(referenceValue);
        
        const meta = document.createElement('div');
        meta.className = 'anomalous-recipe-model-reference-meta';
        const identity = normaliseIdentity(reference.identity);
        if (identity.sha256) {
            const hash = document.createElement('div');
            hash.className = 'anomalous-recipe-advanced-row';
            appendText(hash, 'span', 'SHA256:');
            appendText(hash, 'code', identity.sha256);
            appendCopyButton(hash, identity.sha256, t('recipeDetailCopyHash'));
            referenceDetails.appendChild(hash);
        }
        details.appendChild(referenceDetails);
        if (formatIdentitySize(identity.size)) appendText(meta, 'span', formatIdentitySize(identity.size));
        appendText(meta, 'span', reference.currentAvailability === 'available'
            ? t('recipeDetailAvailable')
            : reference.currentAvailability === 'missing' ? t('recipeDetailMissing') : t('recipeDetailAvailabilityNotChecked'));
        const noteText = appendText(
            meta,
            'small',
            reference.user_note || t('recipeModelNoteEmpty'),
            'anomalous-recipe-model-note anomalous-recipe-detail-muted',
        );
        noteText.title = reference.user_note || t('recipeModelNoteEmpty');
        const noteButton = button(
            meta,
            t(reference.user_note ? 'recipeModelNoteEdit' : 'recipeModelNoteAdd'),
            'anomalous-btn-ghost anomalous-recipe-model-match',
        );
        noteButton.onclick = async () => {
            const note = await anomalousPrompt(
                t('recipeModelNotePrompt'),
                reference.user_note || '',
                t('recipeModelNoteTitle'),
                { multiline: true, maxLength: 1000, rows: 6 },
            );
            if (note === null) return;
            noteButton.disabled = true;
            try {
                await updateRecipeModelNote(owner, recipe, reference, note, () => {
                    renderModelComposition(container, owner, recipe, references, finish, params);
                });
            } catch (error) {
                console.error('Could not update recipe model note:', error);
                noteButton.disabled = false;
                await anomalousAlert(t('recipeModelNoteError'));
            }
        };
        if (!isLocal) {
            const matchStatus = appendText(meta, 'small', '', 'anomalous-recipe-model-match-status');
            const match = button(meta, t('recipeMatchLocalModel'), 'anomalous-btn-primary anomalous-recipe-model-match');
            match.onclick = async () => {
                match.disabled = true;
                await matchLocalModel(owner, recipe, reference, matchStatus, () => {
                    renderModelComposition(container, owner, recipe, references, finish, params);
                });
                if (!reference.localModel) match.disabled = false;
            };
        }
        if (reference.localMatch?.filename && reference.localMatch.filename !== reference.saved_value) {
            const applyStatus = appendText(meta, 'small', '', 'anomalous-recipe-model-match-status');
            const applyLabel = reference.localMatch.confirmation_required
                ? t('recipeConfirmSizeCandidate')
                : t('recipeApplyLocalMatch');
            const apply = button(meta, applyLabel, 'anomalous-btn-ghost anomalous-recipe-model-match');
            apply.title = t('recipeApplyLocalMatchDesc');
            apply.onclick = async () => {
                apply.disabled = true;
                await applyLocalModelMatch(owner, recipe, reference, applyStatus, () => {
                    renderModelComposition(container, owner, recipe, references, finish, params);
                });
                if (reference.localMatch?.filename) apply.disabled = false;
            };
        }
        details.appendChild(meta);
        body.appendChild(details);
        card.appendChild(body);
        return card;
    };

    const categories = new Map();
    for (const reference of otherModels) {
        let cat = 'Other';
        const typeStr = (reference.node_title || reference.node_type || reference.category || '').toLowerCase();
        if (/lora/i.test(typeStr)) cat = 'LoRA';
        else if (/vae/i.test(typeStr)) cat = 'VAE';
        else if (/controlnet/i.test(typeStr)) cat = 'ControlNet';
        else if (/clip/i.test(typeStr)) cat = 'CLIP';
        else if (/upscale/i.test(typeStr)) cat = 'Upscaler';
        
        if (!categories.has(cat)) categories.set(cat, []);
        categories.get(cat).push(reference);
    }

    const appendSection = (title, models, isBase) => {
        if (!models.length) return;
        if (container.children.length > 1) { // Skip divider for the very first section
            const divider = document.createElement('hr');
            divider.className = 'anomalous-recipe-model-divider';
            divider.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
            divider.style.margin = '20px 0 16px 0';
            container.appendChild(divider);
        }
        
        if (title) {
            const h = document.createElement('h5');
            h.textContent = title;
            h.style.margin = '0 0 12px 0';
            h.style.color = '#9ec8ff';
            h.style.fontSize = '0.9rem';
            h.style.textTransform = 'uppercase';
            h.style.letterSpacing = '0.5px';
            container.appendChild(h);
        }
        
        const list = document.createElement('div');
        list.className = 'anomalous-recipe-model-reference-list';
        models.forEach(ref => list.appendChild(createCard(ref, isBase)));
        container.appendChild(list);
    };

    appendSection('Base Models', baseModels, true);
    for (const [cat, models] of categories.entries()) {
        appendSection(cat, models, false);
    }
}

function topologicalSortNodes(workflowNodes, workflowLinks) {
    const inDegree = new Map();
    const adj = new Map();
    const allIds = new Set();
    
    for (const node of workflowNodes) {
        const id = String(node.id);
        allIds.add(id);
        inDegree.set(id, 0);
        adj.set(id, []);
    }
    
    const rawLinks = workflowLinks;
    const linksArray = Array.isArray(rawLinks) ? rawLinks : (rawLinks && typeof rawLinks === 'object' ? Object.values(rawLinks) : []);
    
    for (const link of linksArray) {
        if (!Array.isArray(link) || link.length < 4) continue;
        const originId = String(link[1]);
        const targetId = String(link[3]);
        if (allIds.has(originId) && allIds.has(targetId)) {
            adj.get(originId).push(targetId);
            inDegree.set(targetId, inDegree.get(targetId) + 1);
        }
    }
    
    const queue = [];
    for (const [id, deg] of inDegree.entries()) {
        if (deg === 0) queue.push(id);
    }
    
    const sorted = [];
    while (queue.length > 0) {
        const u = queue.shift();
        sorted.push(u);
        for (const v of adj.get(u)) {
            inDegree.set(v, inDegree.get(v) - 1);
            if (inDegree.get(v) === 0) queue.push(v);
        }
    }
    
    for (const id of allIds) {
        if (inDegree.get(id) > 0) sorted.push(id);
    }
    
    return sorted;
}

function parameterNodeOrder(recipe) {
    const summaries = Array.isArray(recipe?.params?.nodes) ? recipe.params.nodes : [];
    const workflowNodes = Array.isArray(recipe?.workflow?.nodes) ? recipe.workflow.nodes : [];
    const byId = new Map(workflowNodes.map((node) => [String(node?.id), node]));
    const summaryById = new Map(summaries.map((node) => [String(node?.id), node]));
    const orderedIds = topologicalSortNodes(workflowNodes, recipe?.workflow?.links);
    const result = [];
    const seen = new Set();
    for (const id of orderedIds) {
        const summary = summaryById.get(id);
        const workflowNode = byId.get(id);
        if (summary || workflowNode) {
            result.push({ summary: summary || { id, type: workflowNode?.type, title: workflowNode?.title, widgets: [] }, workflowNode });
            seen.add(id);
        }
    }
    for (const summary of summaries) {
        const id = String(summary?.id);
        if (!seen.has(id)) result.push({ summary, workflowNode: byId.get(id) });
    }
    return result;
}

function isVolatileParameter(node, widget, index) {
    const widgetName = String(widget?.name || '').toLowerCase();
    if (/(^|[_\s-])(seed|noise_seed|random_seed|variation_seed|last_seed)([_\s-]|$)/i.test(widgetName)) return true;
    const nodeType = String(node?.type || '').toLowerCase();
    if (nodeType === 'ksampler') return index === 0;
    if (nodeType === 'ksampleradvanced') return index === 1;
    return false;
}

function renderParameterField(parent, label, value, options = {}) {
    if (value === undefined || value === null || value === '') return false;
    const row = document.createElement('div');
    row.className = 'anomalous-recipe-detail-parameter-row';
    const text = displayValue(value);
    if (options.wide || Array.isArray(value) || typeof value === 'object' || text.length > 35) {
        row.classList.add('is-wide');
    }
    appendText(row, 'span', label, 'anomalous-recipe-detail-label');
    appendValueViewer(
        row,
        options.redact ? t('recipeDetailVolatileIgnored') : value,
        '',
        { collapse: options.collapse !== false, copy: options.copy !== false && !options.redact },
    );
    parent.appendChild(row);
    return true;
}

function cloneJson(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return null; }
}

async function saveParameterMaterial(owner, recipe, parameterState, nodeIds, name, actionButton) {
    if (!owner?.recipeDetailFilename || !actionButton || actionButton.disabled) return false;
    const originalLabel = actionButton.textContent;
    actionButton.disabled = true;
    actionButton.textContent = t('materialSaving');
    const body = {
        recipe_filename: owner.recipeDetailFilename,
        ...(parameterState?.selectedFilename ? { parameter_filename: parameterState.selectedFilename } : {}),
        ...(Array.isArray(nodeIds) && nodeIds.length ? { selected_node_ids: nodeIds } : {}),
        name: String(name || '').trim().slice(0, 120),
        tags: Array.isArray(recipe?.tags) ? recipe.tags : [],
    };
    const send = () => fetch('/anomalous/save_parameter_material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    try {
        let response = await send();
        if (response.status === 409) {
            const duplicate = await response.json();
            if (duplicate.status !== 'duplicate') throw new Error('parameter material conflict');
            if (!await anomalousConfirm(t('materialDuplicateConfirm', { name: duplicate.name }))) return false;
            body.allow_duplicate = true;
            response = await send();
        }
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'parameter material save failed');
        actionButton.textContent = t('materialSaved');
        showMaterialSaved(owner, payload.material);
        await owner.refreshMaterials?.();
        window.setTimeout(() => {
            if (!actionButton.isConnected) return;
            actionButton.textContent = originalLabel;
            actionButton.disabled = false;
        }, 1400);
        return true;
    } catch (error) {
        console.error('Could not save recipe parameter material:', error);
        await anomalousAlert(t('materialSaveError'));
        return false;
    } finally {
        if (actionButton.isConnected && actionButton.textContent !== t('materialSaved')) {
            actionButton.textContent = originalLabel;
            actionButton.disabled = false;
        }
    }
}

function editorValueText(value) {
    if (typeof value === 'string') return value;
    if (value === undefined) return '';
    try { return JSON.stringify(value); } catch (error) { return String(value); }
}

function parseEditorValue(raw, original) {
    if (typeof original === 'number') {
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new Error('invalid number');
        return value;
    }
    if (typeof original === 'boolean') {
        if (raw !== 'true' && raw !== 'false') throw new Error('invalid boolean');
        return raw === 'true';
    }
    if (original !== null && typeof original === 'object') return JSON.parse(raw);
    return raw;
}

function renderParameterNotebookEditor(wrapper, owner, recipe, parameterState, source, selectParameterTab) {
    const editorState = parameterState.editor;
    editorState.draft.params = editorState.draft.params || {};
    const editor = document.createElement('section');
    editor.className = 'anomalous-recipe-detail-section anomalous-recipe-parameter-editor';
    const heading = document.createElement('div');
    heading.className = 'anomalous-recipe-detail-section-heading';
    appendText(heading, 'h4', t('recipeParameterNew'));
    const actions = document.createElement('div');
    const cancel = button(actions, t('recipeParameterCancel'), 'anomalous-btn-ghost');
    cancel.onclick = () => {
        parameterState.editor = null;
        selectParameterTab?.();
    };
    const save = button(actions, t('recipeParameterSave'), 'anomalous-btn-primary');
    save.onclick = async () => {
        const name = nameInput.value.trim() || recipe.name || t('recipeParameterUntitled');
        save.disabled = true;
        try {
            const response = await fetch('/anomalous/save_parameter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    tags: recipe.tags || [],
                    notes: recipe.notes || '',
                    params: editorState.draft.params || {},
                    workflow: editorState.draft.workflow,
                    recipe_filename: owner.recipeDetailFilename,
                }),
            });
            if (!response.ok) throw new Error('parameter note save failed');
            parameterState.editor = null;
            parameterState.status = 'idle';
            parameterState.selectedFilename = null;
            await parameterState.refresh?.(true);
            selectParameterTab?.();
        } catch (error) {
            console.error('Could not save the new parameter notebook:', error);
            await anomalousAlert(t('recipeParameterSaveError'));
            save.disabled = false;
        }
    };
    actions.append(cancel, save);
    heading.appendChild(actions);
    editor.appendChild(heading);
    appendText(editor, 'p', t('recipeParameterNewHint'), 'anomalous-recipe-detail-muted');

    const nameRow = document.createElement('label');
    nameRow.className = 'anomalous-recipe-parameter-editor-name';
    appendText(nameRow, 'span', t('recipeParameterName'));
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 200;
    nameInput.value = editorState.name || `${recipe.name || t('recipeUntitled')} · ${t('recipeParameterNew')}`;
    nameRow.appendChild(nameInput);
    editor.appendChild(nameRow);

    const nodeList = document.createElement('div');
    nodeList.className = 'anomalous-recipe-detail-parameter-list anomalous-recipe-parameter-editor-list';
    let rendered = 0;
    for (const { summary: node, workflowNode } of parameterNodeOrder(editorState.draft)) {
        if (!workflowNode || !Array.isArray(workflowNode.widgets_values)) continue;
        const widgets = Array.isArray(node?.widgets) && node.widgets.length
            ? node.widgets
            : workflowNode.widgets_values.map((value, index) => ({ name: `${t('recipeDetailWidget')} ${index + 1}`, index, value }));
        const block = document.createElement('article');
        block.className = 'anomalous-recipe-detail-parameter-node';
        const titleText = [node.title, node.type].filter(Boolean).join(' · ') || t('recipeDetailUnknownNode');
        appendText(block, 'strong', titleText, 'anomalous-recipe-detail-node-title');
        
        const widgetsContainer = document.createElement('div');
        widgetsContainer.className = 'anomalous-recipe-detail-node-widgets';
        
        for (let visibleIndex = 0; visibleIndex < widgets.length && rendered < 1200; visibleIndex += 1) {
            const widget = widgets[visibleIndex] || {};
            const index = Number.isInteger(widget.index) ? widget.index : visibleIndex;
            if (index < 0 || index >= workflowNode.widgets_values.length) continue;
            const value = workflowNode.widgets_values[index];
            const row = document.createElement('label');
            row.className = 'anomalous-recipe-detail-parameter-row anomalous-recipe-parameter-editor-row';
            appendText(row, 'span', widget.name || `${t('recipeDetailWidget')} ${index + 1}`, 'anomalous-recipe-detail-parameter-name');
            const volatile = isVolatileParameter(node, widget, index);
            const sensitive = /(?:api.?key|access.?token|auth|password|passwd|secret|credential)/i.test(String(widget.name || ''));
            if (volatile || sensitive) {
                appendValueViewer(row, t(volatile ? 'recipeDetailVolatileIgnored' : 'recipeParameterSensitiveHidden'), '', { copy: false });
            } else {
                const input = document.createElement(typeof value === 'string' && (value.length > 100 || /text|prompt/i.test(String(widget.name || ''))) ? 'textarea' : 'input');
                input.className = 'anomalous-recipe-parameter-editor-input';
                input.value = editorValueText(value);
                if (input.tagName === 'TEXTAREA') input.rows = Math.min(8, Math.max(3, input.value.split(/\r?\n/).length));
                input.onchange = () => {
                    try {
                        const next = parseEditorValue(input.value, value);
                        applyRecipeWidgetChanges(editorState.draft.params || {}, editorState.draft.workflow, [{
                            nodeId: workflowNode.id,
                            widgetIndex: index,
                            value: next,
                            previousValue: value,
                        }]);
                        workflowNode.widgets_values[index] = next;
                        input.classList.remove('is-invalid');
                    } catch (error) {
                        input.classList.add('is-invalid');
                        console.warn('Parameter input invalid:', error);
                    }
                };
                row.appendChild(input);
            }
            widgetsContainer.appendChild(row);
            rendered += 1;
        }
        if (widgetsContainer.childElementCount) {
            block.appendChild(widgetsContainer);

            nodeList.appendChild(block);
        }
    }
    if (!nodeList.childElementCount) appendText(nodeList, 'p', t('recipeDetailNoSavedParameters'), 'anomalous-recipe-detail-muted');
    editor.appendChild(nodeList);
    wrapper.appendChild(editor);
}

function promptRoleLabel(role) {
    return t({
        positive: 'recipePromptRolePositive',
        negative: 'recipePromptRoleNegative',
        both: 'recipePromptRoleBoth',
        ignored: 'recipePromptRoleIgnored',
        unknown: 'recipePromptRoleUnknown',
    }[role] || 'recipePromptRoleUnknown');
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

function renderRawNodesLazy(parent, source, options = {}) {
    const ordered = parameterNodeOrder(source);
    if (!ordered.length) return;
    const reusable = ordered.filter(({ workflowNode }) =>
        workflowNode?.id != null && Array.isArray(workflowNode.widgets_values) && workflowNode.widgets_values.length
    );
    const selectedIds = new Set();

    const details = document.createElement('details');
    details.className = 'anomalous-recipe-advanced-info anomalous-recipe-raw-nodes-details';

    const summary = document.createElement('summary');
    summary.className = 'anomalous-recipe-raw-nodes-summary';
    summary.textContent = `${t('recipeRawNodesToggle')} (${ordered.length} ${t('recipeRawNodesCount')}) ▾`;
    details.appendChild(summary);

    let selecting = false;
    let updateSelection = () => {};
    if (typeof options.onSaveNodes === 'function' && reusable.length) {
        const selectionBar = document.createElement('div');
        selectionBar.className = 'anomalous-recipe-material-selection';
        selectionBar.hidden = true;
        const choose = button(details, t('materialChooseParameters'), 'anomalous-btn-ghost');
        choose.setAttribute('aria-expanded', 'false');
        choose.onclick = () => {
            selecting = !selecting;
            selectionBar.hidden = !selecting;
            choose.textContent = t(selecting ? 'materialFinishSelection' : 'materialChooseParameters');
            choose.setAttribute('aria-expanded', String(selecting));
            if (!selecting) selectedIds.clear();
            updateSelection();
        };
        const selectionText = appendText(selectionBar, 'span', '', 'anomalous-workbench-node-selection-count');
        const selectAll = button(selectionBar, t('materialSelectAllNodes'), 'anomalous-btn-ghost');
        const clear = button(selectionBar, t('materialClearNodeSelection'), 'anomalous-btn-ghost');
        const saveSelected = button(selectionBar, t('materialSaveSelectedAction', { count: 0 }), 'anomalous-preset-btn-primary');
        updateSelection = () => {
            const count = selectedIds.size;
            selectionText.textContent = t('materialSelectedNodeCount', { count });
            saveSelected.textContent = t('materialSaveSelectedAction', { count });
            saveSelected.disabled = count === 0;
            details.querySelectorAll('.anomalous-recipe-material-node-select').forEach(input => {
                input.hidden = !selecting;
                input.checked = selectedIds.has(input.dataset.nodeId);
            });
        };
        selectAll.onclick = () => {
            reusable.forEach(({ workflowNode }) => selectedIds.add(String(workflowNode.id)));
            updateSelection();
        };
        clear.onclick = () => {
            selectedIds.clear();
            updateSelection();
        };
        saveSelected.onclick = () => options.onSaveNodes(
            [...selectedIds],
            t('materialSelectedNodesName', { count: selectedIds.size }),
            saveSelected,
        );
        updateSelection();
        details.appendChild(selectionBar);
    }

    const nodeList = document.createElement('div');
    nodeList.className = 'anomalous-recipe-detail-parameter-list';
    nodeList.style.marginTop = '12px';

    let renderedCount = 0;
    const PAGE_SIZE = 10;

    const renderNextBatch = () => {
        const batch = ordered.slice(renderedCount, renderedCount + PAGE_SIZE);
        for (const { summary: node, workflowNode } of batch) {
            const widgets = Array.isArray(node?.widgets) && node.widgets.length
                ? node.widgets
                : (Array.isArray(workflowNode?.widgets_values)
                    ? workflowNode.widgets_values.map((value, index) => ({
                        name: `${t('recipeDetailWidget')} ${index + 1}`,
                        index,
                        value,
                    }))
                    : []);
            if (!widgets.length) continue;
            const block = document.createElement('article');
            block.className = 'anomalous-recipe-detail-parameter-node';
            const title = [node.title, node.type].filter(Boolean).join(' · ') || t('recipeDetailUnknownNode');
            const nodeHeader = document.createElement('div');
            nodeHeader.className = 'anomalous-recipe-material-node-header';
            if (typeof options.onSaveNodes === 'function' && workflowNode?.id != null) {
                const select = document.createElement('input');
                select.type = 'checkbox';
                select.hidden = !selecting;
                select.className = 'anomalous-recipe-material-node-select';
                select.setAttribute('aria-label', t('materialSelectNodeForSaving'));
                select.dataset.nodeId = String(workflowNode.id);
                select.checked = selectedIds.has(select.dataset.nodeId);
                select.title = t('materialSelectNodeForSaving');
                select.onchange = () => {
                    if (select.checked) selectedIds.add(select.dataset.nodeId);
                    else selectedIds.delete(select.dataset.nodeId);
                    updateSelection();
                };
                nodeHeader.appendChild(select);
            }
            appendText(nodeHeader, 'strong', title, 'anomalous-recipe-detail-node-title');
            if (typeof options.onSaveNodes === 'function' && workflowNode?.id != null) {
                const saveNode = button(nodeHeader, t('materialSaveToLibraryShort'), 'anomalous-material-node-save');
                saveNode.onclick = () => options.onSaveNodes([workflowNode.id], title, saveNode);
            }
            block.appendChild(nodeHeader);
            const widgetsContainer = document.createElement('div');
            widgetsContainer.className = 'anomalous-recipe-detail-node-widgets';
            for (let visibleIndex = 0; visibleIndex < widgets.length; visibleIndex += 1) {
                const widget = widgets[visibleIndex] || {};
                const index = Number.isInteger(widget.index) ? widget.index : visibleIndex;
                const value = Array.isArray(workflowNode?.widgets_values) && workflowNode.widgets_values[index] !== undefined
                    ? workflowNode.widgets_values[index]
                    : widget.value;
                const label = widget.name || `${t('recipeDetailWidget')} ${index + 1}`;
                const volatile = isVolatileParameter(node, widget, index);
                renderParameterField(widgetsContainer, label, volatile ? 0 : value, {
                    redact: volatile,
                    collapse: false,
                });
            }
            if (widgetsContainer.childElementCount) {
                block.appendChild(widgetsContainer);
                nodeList.appendChild(block);
            }
        }
        renderedCount += batch.length;
        updateSelection();

        const oldBtn = details.querySelector('.anomalous-recipe-lazy-expand-btn');
        if (oldBtn) oldBtn.remove();

        if (renderedCount < ordered.length) {
            const remaining = ordered.length - renderedCount;
            const expandBtn = document.createElement('button');
            expandBtn.type = 'button';
            expandBtn.className = 'anomalous-recipe-lazy-expand-btn';
            expandBtn.textContent = `${t('recipeRawNodesShowMore')} (${remaining})`;
            expandBtn.onclick = (e) => {
                e.preventDefault();
                renderNextBatch();
            };
            details.appendChild(expandBtn);
        }
    };

    details.ontoggle = () => {
        if (details.open && renderedCount === 0) {
            renderNextBatch();
        }
    };

    details.appendChild(nodeList);
    parent.appendChild(details);
}

function renderPromptSection(parent, owner, recipe, source, rerender, onSaveNodes) {
    const prompts = promptValues(source, recipe);
    if (!prompts.entries.length) {
        appendText(parent, 'p', t('recipeDetailNoPrompts'), 'anomalous-recipe-detail-muted');
        return;
    }

    const heading = document.createElement('div');
    heading.className = 'anomalous-recipe-detail-section-heading';
    heading.style.display = 'flex';
    heading.style.alignItems = 'center';
    heading.style.justifyContent = 'space-between';
    heading.style.marginBottom = '12px';

    const headingLeft = document.createElement('div');
    headingLeft.style.display = 'flex';
    headingLeft.style.alignItems = 'center';
    headingLeft.style.gap = '8px';
    appendText(headingLeft, 'h5', t('recipeDetailPrompts') || '提示词');

    const noticeTooltip = t('recipePromptSupportNotice') || '当前仅自动识别 ComfyUI 原生 CLIPTextEncode 与已知官方连接；第三方文本节点请手动标注。';
    const infoIcon = document.createElement('span');
    infoIcon.className = 'anomalous-recipe-info-bubble';
    infoIcon.title = noticeTooltip;
    infoIcon.innerHTML = `ⓘ <span style="font-size:0.75rem;font-weight:normal;opacity:0.75;">${window.anomalous_browser_lang === 'zh' ? '支持说明' : 'Notice'}</span>`;
    infoIcon.style.cursor = 'help';
    headingLeft.appendChild(infoIcon);
    heading.appendChild(headingLeft);
    parent.appendChild(heading);

    const promptList = document.createElement('div');
    promptList.className = 'anomalous-recipe-detail-prompt-list';
    for (const entry of prompts.entries) {
        const card = document.createElement('article');
        card.className = `anomalous-recipe-detail-prompt anomalous-recipe-prompt-role-${entry.role}`;

        // Top full-width header bar
        const headerRow = document.createElement('div');
        headerRow.className = 'anomalous-recipe-prompt-card-header';
        headerRow.style.display = 'flex';
        headerRow.style.justifyContent = 'space-between';
        headerRow.style.alignItems = 'center';
        headerRow.style.gap = '10px';
        headerRow.style.marginBottom = '8px';

        // Left info group: Interactive role badge + Node title & type
        const leftGroup = document.createElement('div');
        leftGroup.className = 'anomalous-recipe-prompt-card-header-left';
        leftGroup.style.display = 'flex';
        leftGroup.style.alignItems = 'center';
        leftGroup.style.gap = '8px';
        leftGroup.style.flexWrap = 'wrap';

        const isZh = window.anomalous_browser_lang === 'zh';
        const roleBadge = document.createElement('button');
        roleBadge.type = 'button';
        roleBadge.className = `anomalous-recipe-prompt-role-badge is-${entry.role} is-interactive`;
        const roleDot = entry.role === 'positive' ? '🟢' : entry.role === 'negative' ? '🔴' : '🟣';
        roleBadge.innerHTML = `${roleDot} <span>${promptRoleLabel(entry.role)}</span> <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>`;
        roleBadge.title = isZh ? '点击切换提示词用途 (正向/负向/忽略)' : 'Click to adjust prompt role';

        const roleSelect = document.createElement('select');
        roleSelect.className = 'anomalous-recipe-prompt-role-select';
        roleSelect.setAttribute('aria-label', t('recipePromptRoleChoose'));
        const choices = [
            ['auto', `${t('recipePromptRoleAutomatic')} · ${promptRoleLabel(entry.automaticRole)}`],
            ['positive', t('recipePromptRolePositive')],
            ['negative', t('recipePromptRoleNegative')],
            ['both', t('recipePromptRoleBoth')],
            ['unknown', t('recipePromptRoleUnknown')],
            ['ignored', t('recipePromptRoleIgnored')],
        ];
        for (const [value, label] of choices) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            roleSelect.appendChild(option);
        }
        roleSelect.value = entry.manual ? entry.role : 'auto';
        roleSelect.style.display = 'none';
        roleSelect.onchange = async () => {
            const previous = entry.manual ? entry.role : 'auto';
            roleSelect.disabled = true;
            card.classList.add('is-saving');
            try {
                const params = paramsWithPromptRole(recipe, entry.id, roleSelect.value);
                await updateInlineRecipeMetadata(owner, recipe, { params });
                rerender?.();
            } catch (error) {
                console.error('Could not update prompt role:', error);
                roleSelect.value = previous;
                roleSelect.disabled = false;
                card.classList.remove('is-saving');
                await anomalousAlert(t('recipePromptRoleSaveError'));
            }
        };
        roleBadge.onclick = () => {
            if (roleSelect.style.display === 'none') {
                roleSelect.style.display = 'inline-block';
                roleSelect.focus();
            } else {
                roleSelect.style.display = 'none';
            }
        };

        leftGroup.appendChild(roleBadge);
        leftGroup.appendChild(roleSelect);

        const nodeTitle = document.createElement('span');
        nodeTitle.className = 'anomalous-recipe-prompt-card-node-title';
        nodeTitle.textContent = entry.title || 'CLIPTextEncode';
        nodeTitle.title = entry.type || '';
        leftGroup.appendChild(nodeTitle);

        if (entry.type && entry.type !== entry.title) {
            const nodeTypeEl = document.createElement('span');
            nodeTypeEl.className = 'anomalous-recipe-prompt-card-node-type';
            nodeTypeEl.textContent = `(${entry.type})`;
            leftGroup.appendChild(nodeTypeEl);
        }

        headerRow.appendChild(leftGroup);

        // Right actions tray (Save to Material + Micro Copy)
        const actionTray = document.createElement('div');
        actionTray.className = 'anomalous-recipe-prompt-card-action-tray';
        actionTray.style.display = 'flex';
        actionTray.style.alignItems = 'center';
        actionTray.style.gap = '6px';

        if (typeof onSaveNodes === 'function') {
            const savePromptBtn = document.createElement('button');
            savePromptBtn.type = 'button';
            savePromptBtn.className = 'anomalous-recipe-prompt-micro-copy';
            savePromptBtn.title = t('materialSavePromptAction') || '存入素材库';
            savePromptBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
            savePromptBtn.onclick = (e) => {
                e.stopPropagation();
                onSaveNodes([entry.id], entry.title || t('materialPromptNode'), savePromptBtn);
            };
            actionTray.appendChild(savePromptBtn);
        }

        const copyPromptBtn = document.createElement('button');
        copyPromptBtn.type = 'button';
        copyPromptBtn.className = 'anomalous-recipe-prompt-micro-copy';
        const copyTitle = isZh ? '复制提示词' : 'Copy prompt';
        const copiedTitle = isZh ? '已复制' : 'Copied';
        copyPromptBtn.title = copyTitle;
        copyPromptBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
        copyPromptBtn.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(entry.text || '').then(() => {
                copyPromptBtn.classList.add('is-copied');
                copyPromptBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
                copyPromptBtn.title = copiedTitle;
                setTimeout(() => {
                    copyPromptBtn.classList.remove('is-copied');
                    copyPromptBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
                    copyPromptBtn.title = copyTitle;
                }, 1200);
            });
        };
        actionTray.appendChild(copyPromptBtn);
        headerRow.appendChild(actionTray);
        card.appendChild(headerRow);

        // Full-width prompt body
        const body = document.createElement('div');
        body.className = 'anomalous-recipe-prompt-card-body';
        appendValueViewer(body, entry.text, '', { copy: false });
        card.appendChild(body);

        promptList.appendChild(card);
    }
    parent.appendChild(promptList);
}

function renderRecipeParameters(content, owner, recipe, gallery, refreshGallery, parameterState, selectParameterTab) {
    const selectedNotebook = parameterState?.notebooks?.find((item) => item.filename === parameterState.selectedFilename);
    const baseSource = selectedNotebook?.data?.workflow ? selectedNotebook.data : recipe;
    const source = parameterState?.editor?.draft || baseSource;
    const animateSelection = Boolean(parameterState?.switchToken);
    if (animateSelection && !parameterState.switchTokenClearing) {
        parameterState.switchTokenClearing = true;
        Promise.resolve().then(() => {
            parameterState.switchToken = 0;
            parameterState.switchTokenClearing = false;
        });
    }
    const wrapper = document.createElement('div');
    wrapper.className = `anomalous-recipe-detail-parameters${animateSelection ? ' is-switching' : ''}`;

    const layout = document.createElement('div');
    layout.className = 'anomalous-recipe-parameter-notebook-layout';
    const sidebar = document.createElement('aside');
    sidebar.className = 'anomalous-recipe-parameter-notebook-sidebar';
    
    const sidebarHeading = document.createElement('div');
    sidebarHeading.className = 'anomalous-recipe-detail-section-heading';
    sidebarHeading.style.marginBottom = '12px';
    sidebarHeading.style.alignItems = 'center';
    sidebarHeading.style.display = 'flex';
    appendText(sidebarHeading, 'strong', t('recipeParameterSnapshots'));
    
    const refreshSnapshots = document.createElement('button');
    refreshSnapshots.className = 'anomalous-btn-ghost';
    refreshSnapshots.style.padding = '4px 8px';
    refreshSnapshots.title = t('recipeParameterRefresh');
    refreshSnapshots.innerHTML = '↻';
    refreshSnapshots.onclick = () => { void parameterState.refresh?.(true); };
    sidebarHeading.appendChild(refreshSnapshots);
    sidebar.appendChild(sidebarHeading);
    
    const sidebarActions = document.createElement('div');
    sidebarActions.className = 'anomalous-recipe-sidebar-actions';
    sidebarActions.style.display = 'grid';
    sidebarActions.style.gap = '8px';
    sidebarActions.style.marginBottom = '12px';

    const readCurrentHandler = async () => {
        readCurrent.disabled = true;
        readCurrent.classList.add('is-busy');
        const originalLabel = readCurrent.textContent;
        readCurrent.textContent = t('recipeParameterReadCurrentSaving');
        try {
            if (!app.graph?.serialize) throw new Error('recipe_parameter_canvas_unavailable');
            const current = captureRecipeDraft(app.graph);
            assertRecipeSkeleton(recipe.workflow, current.workflow);
            const response = await fetch('/anomalous/save_parameter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `${recipe.name || t('recipeUntitled')} · ${t('recipeParameterReadCurrent')}`,
                    tags: recipe.tags || [],
                    notes: recipe.notes || '',
                    params: current.metadata,
                    workflow: current.workflow,
                    recipe_filename: owner.recipeDetailFilename,
                }),
            });
            if (!response.ok) throw new Error('current parameter note save failed');
            parameterState.editor = null;
            parameterState.status = 'idle';
            parameterState.selectedFilename = null;
            gallery.status = 'idle';
            gallery.images = [];
            gallery.scanned = 0;
            await parameterState.refresh?.(true);
            selectParameterTab?.();
        } catch (error) {
            console.error('Could not read current canvas parameters:', error);
            await anomalousAlert(error.code === 'recipe_parameter_skeleton_mismatch'
                ? t('recipeParameterSkeletonMismatch')
                : t('recipeParameterReadCurrentError'));
        } finally {
            readCurrent.disabled = false;
            readCurrent.classList.remove('is-busy');
            readCurrent.innerHTML = originalLabel;
        }
    };

    const readCurrent = button(sidebarActions, '', 'anomalous-preset-btn-primary');
    readCurrent.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>${t('recipeParameterReadCurrent')}`;
    readCurrent.onclick = readCurrentHandler;

    const newSnapshot = button(sidebarActions, '', 'anomalous-preset-btn-secondary');
    newSnapshot.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>${t('recipeParameterNew')}`;
    newSnapshot.onclick = () => {
        const draft = cloneJson({
            workflow: baseSource.workflow,
            params: baseSource.params || {},
        });
        if (!draft?.workflow) return;
        parameterState.editor = {
            draft,
            name: `${recipe.name || t('recipeUntitled')} · ${t('recipeParameterNew')}`,
        };
        parameterState.selectedFilename = null;
        gallery.status = 'idle';
        gallery.images = [];
        gallery.scanned = 0;
        selectParameterTab?.();
    };

    sidebar.appendChild(sidebarActions);
    appendText(sidebar, 'small', t('recipeParameterSnapshotsHint'), 'anomalous-recipe-detail-muted');
    const snapshotList = document.createElement('div');
    snapshotList.className = 'anomalous-recipe-parameter-notebook-list';
    snapshotList.style.marginTop = '8px';
    if (parameterState?.status === 'loading') {
        appendText(snapshotList, 'p', t('recipeParameterLoading'), 'anomalous-recipe-detail-muted');
    } else if (parameterState?.status === 'error') {
        appendText(snapshotList, 'p', t('recipeParameterLoadError'), 'anomalous-recipe-dialog-error');
    } else if (parameterState?.notebooks?.length) {
        for (const notebook of parameterState.notebooks) {
            const isSelected = notebook.filename === parameterState.selectedFilename;
            const row = document.createElement('div');
            row.className = `anomalous-preset-item-card${isSelected ? ' is-active' : ''}`;
            const notebookName = notebook.name || t('recipeParameterUntitled');

            const main = document.createElement('div');
            main.className = 'anomalous-preset-item-main';
            main.onclick = () => {
                if (parameterState.selectedFilename === notebook.filename) return;
                parameterState.editor = null;
                parameterState.selectedFilename = notebook.filename;
                parameterState.switchToken = (parameterState.switchToken || 0) + 1;
                gallery.status = 'idle';
                gallery.images = [];
                gallery.scanned = 0;
                selectParameterTab?.();
            };

            const titleRow = document.createElement('div');
            titleRow.className = 'anomalous-preset-item-title-row';
            titleRow.style.display = 'flex';
            titleRow.style.alignItems = 'center';
            titleRow.style.gap = '6px';
            titleRow.style.minWidth = '0';

            if (isSelected) {
                const activeDot = document.createElement('span');
                activeDot.className = 'anomalous-preset-active-dot';
                activeDot.title = t('recipeParameterActive') || '当前生效';
                titleRow.appendChild(activeDot);
            }

            const titleEl = appendText(titleRow, 'div', notebookName, 'anomalous-preset-item-title');
            titleEl.title = notebookName;
            main.appendChild(titleRow);

            const meta = document.createElement('div');
            meta.className = 'anomalous-preset-item-meta';
            appendText(meta, 'span', dateText(notebook.timestamp), 'anomalous-preset-item-date');
            main.appendChild(meta);
            row.appendChild(main);

            const actions = document.createElement('div');
            actions.className = 'anomalous-preset-item-actions';

            const saveMaterial = button(actions, '', 'anomalous-preset-item-btn');
            saveMaterial.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
            saveMaterial.title = t('materialSaveNotebookHint');
            saveMaterial.onclick = async (e) => {
                e.stopPropagation();
                await saveParameterMaterial(
                    owner,
                    recipe,
                    { ...parameterState, selectedFilename: notebook.filename },
                    null,
                    `${notebookName} · ${t('materialAllParameters')}`,
                    saveMaterial,
                );
            };

            const rename = button(actions, '', 'anomalous-preset-item-btn');
            rename.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
            rename.title = t('recipeParameterRename');
            rename.onclick = async (e) => {
                e.stopPropagation();
                const newName = await anomalousPrompt(t('recipeParameterRenamePrompt'), notebookName);
                if (newName === null || !newName.trim() || newName.trim() === notebookName) return;
                const trimmedName = newName.trim();
                rename.disabled = true;
                row.classList.add('is-busy');
                try {
                    const response = await fetch('/anomalous/rename_parameter', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename: notebook.filename, name: trimmedName }),
                    });
                    const payload = await response.json();
                    if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'rename failed');
                    notebook.name = trimmedName;
                    await parameterState.refresh?.(true);
                } catch (error) {
                    console.error('Could not rename parameter notebook:', error);
                    rename.disabled = false;
                    row.classList.remove('is-busy');
                    await anomalousAlert(t('recipeParameterRenameError'));
                }
            };

            const remove = button(actions, '', 'anomalous-preset-item-btn is-delete');
            remove.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
            remove.title = t('recipeParameterDelete');
            remove.onclick = async (e) => {
                e.stopPropagation();
                if (!await anomalousConfirm(t('recipeParameterDeleteConfirm', { name: notebookName }))) return;
                remove.disabled = true;
                row.classList.add('is-deleting');
                try {
                    const response = await fetch('/anomalous/delete_parameter', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename: notebook.filename }),
                    });
                    const payload = await response.json();
                    if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'parameter notebook delete failed');
                    if (parameterState.selectedFilename === notebook.filename) parameterState.selectedFilename = null;
                    parameterState.editor = null;
                    parameterState.parameterGalleryRequestId += 1;
                    gallery.status = 'idle';
                    gallery.images = [];
                    gallery.scanned = 0;
                    await parameterState.refresh?.(true);
                } catch (error) {
                    console.error('Could not delete parameter notebook:', error);
                    remove.disabled = false;
                    row.classList.remove('is-deleting');
                    await anomalousAlert(t('recipeParameterDeleteError'));
                }
            };

            row.appendChild(actions);
            snapshotList.appendChild(row);
        }
    } else {
        appendText(snapshotList, 'p', t('recipeParameterNoSnapshots'), 'anomalous-recipe-detail-muted');
    }
    sidebar.appendChild(snapshotList);

    if (parameterState?.editor) {
        renderParameterNotebookEditor(wrapper, owner, recipe, parameterState, source, selectParameterTab);
        layout.append(sidebar, wrapper);
        content.appendChild(layout);
        return;
    }

    const intro = document.createElement('section');
    intro.className = 'anomalous-preset-console-header';

    const consoleInfo = document.createElement('div');
    consoleInfo.className = 'anomalous-preset-console-info';

    const titleRow = document.createElement('div');
    titleRow.className = 'anomalous-preset-console-title-row';

    const currentNotebook = parameterState.notebooks?.find(nb => nb.filename === parameterState.selectedFilename);
    const currentName = currentNotebook?.name || source?.name || t('recipeParameterCurrentRecipe');

    appendText(titleRow, 'h3', currentName, 'anomalous-preset-console-title');
    appendText(titleRow, 'span', t('recipeParameterActive'), 'anomalous-preset-item-badge');
    consoleInfo.appendChild(titleRow);

    appendText(consoleInfo, 'p', t('recipeDetailParametersHint'), 'anomalous-recipe-detail-muted');

    const consoleActions = document.createElement('div');
    consoleActions.className = 'anomalous-preset-console-actions';

    const applyButton = button(consoleActions, '', 'anomalous-preset-btn-primary');
    applyButton.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>${t('recipeParameterApply')}`;
    applyButton.style.padding = '8px 16px';
    applyButton.style.fontSize = '0.88rem';
    const applyStatus = appendText(consoleActions, 'small', '', 'anomalous-recipe-header-status');
    applyButton.onclick = async () => {
        applyButton.disabled = true;
        applyButton.classList.add('is-busy');
        applyStatus.textContent = t('recipeParameterApplying');
        try {
            const result = applyRecipeParametersToCanvas(source);
            applyStatus.textContent = t('recipeParameterApplied').replace('{count}', String(result.widgets));
        } catch (error) {
            console.error('Could not apply recipe parameter notebook:', error);
            const detailKey = {
                recipe_parameter_skeleton_mismatch: 'recipeParameterSkeletonMismatch',
                recipe_parameter_widget_mismatch: 'recipeParameterWidgetMismatch',
                recipe_parameter_node_unavailable: 'recipeParameterNodeUnavailable',
            }[error.code];
            const errorMessage = error.message || String(error);
            applyStatus.textContent = detailKey
                ? `${t(detailKey)} ${errorMessage}`.trim()
                : `${t('recipeParameterApplyError')} ${errorMessage}`.trim();
            applyStatus.title = errorMessage;
        } finally {
            applyButton.disabled = false;
            applyButton.classList.remove('is-busy');
        }
    };

    const saveAllMaterial = button(consoleActions, t('materialSaveAllParameters'), 'anomalous-preset-btn-secondary');
    saveAllMaterial.onclick = () => saveParameterMaterial(
        owner,
        recipe,
        parameterState,
        null,
        `${currentName} · ${t('materialAllParameters')}`,
        saveAllMaterial,
    );

    if (parameterState?.selectedFilename) {
        const renameHeadingBtn = button(consoleActions, '', 'anomalous-btn-ghost');
        renameHeadingBtn.innerHTML = `<svg style="width:13px;height:13px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>${t('recipeParameterRename')}`;
        renameHeadingBtn.onclick = async () => {
            const newName = await anomalousPrompt(t('recipeParameterRenamePrompt'), currentName);
            if (newName === null || !newName.trim() || newName.trim() === currentName) return;
            const trimmedName = newName.trim();
            renameHeadingBtn.disabled = true;
            try {
                const response = await fetch('/anomalous/rename_parameter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: parameterState.selectedFilename, name: trimmedName }),
                });
                const payload = await response.json();
                if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'rename failed');
                await parameterState.refresh?.(true);
            } catch (error) {
                console.error('Could not rename parameter notebook:', error);
                renameHeadingBtn.disabled = false;
                await anomalousAlert(t('recipeParameterRenameError'));
            }
        };
    }
    consoleInfo.appendChild(consoleActions);
    intro.appendChild(consoleInfo);

    // Compact gallery showcase tile on top right
    if (gallery.status === 'ready' && gallery.images.length) {
        const compactGallery = document.createElement('div');
        compactGallery.className = 'anomalous-preset-compact-gallery';
        compactGallery.title = `${t('recipeParameterGallery')} (${gallery.images.length})`;
        const thumb = document.createElement('img');
        thumb.src = outputImageUrl(gallery.images[0]);
        compactGallery.appendChild(thumb);
        const galleryBadge = appendText(compactGallery, 'span', '', 'anomalous-preset-compact-gallery-badge');
        galleryBadge.innerHTML = `<svg style="width:11px;height:11px;margin-right:3px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>${gallery.images.length}`;
        compactGallery.onclick = () => {
            const dialog = document.createElement('dialog');
            dialog.className = 'anomalous-recipe-gallery-dialog';
            const closeBtn = document.createElement('button');
            closeBtn.className = 'anomalous-dialog-close anomalous-btn-ghost';
            closeBtn.innerHTML = '✕';
            closeBtn.onclick = () => dialog.close();
            dialog.appendChild(closeBtn);
            const heading = document.createElement('h3');
            heading.textContent = `${t('recipeParameterGallery')} (${gallery.images.length})`;
            heading.className = 'anomalous-recipe-gallery-dialog-title';
            dialog.appendChild(heading);
            const grid = document.createElement('div');
            grid.className = 'anomalous-recipe-gallery-grid';
            for (const sourceImage of gallery.images) {
                const card = document.createElement('article');
                card.className = 'anomalous-recipe-gallery-card';
                const url = outputImageUrl(sourceImage);
                const image = document.createElement('img');
                image.src = url;
                image.loading = 'lazy';
                image.onclick = () => owner.showGalleryViewer?.(url);
                card.appendChild(image);
                const actions = document.createElement('div');
                actions.className = 'anomalous-recipe-gallery-card-actions';
                const details = button(actions, '', 'anomalous-btn-primary');
                details.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>${t('materialViewDetails')}`;
                details.onclick = event => {
                    event.stopPropagation();
                    const images = gallery.images;
                    dialog.close();
                    openGalleryImageDetail(owner, images, sourceImage, url);
                };
                card.appendChild(actions);
                grid.appendChild(card);
            }
            dialog.appendChild(grid);
            document.body.appendChild(dialog);
            dialog.addEventListener('close', () => dialog.remove());
            dialog.showModal();
        };
        intro.appendChild(compactGallery);
    }

    const params = source?.params || {};
    const resDisplay = formatRecipeResolution(params.resolution);
    const summary = document.createElement('section');
    summary.className = 'anomalous-recipe-detail-section anomalous-preset-bento-deck';

    const summaryHeader = document.createElement('div');
    summaryHeader.className = 'anomalous-recipe-detail-section-heading';
    summaryHeader.style.display = 'flex';
    summaryHeader.style.justifyContent = 'space-between';
    summaryHeader.style.alignItems = 'center';
    summaryHeader.style.marginBottom = '12px';
    appendText(summaryHeader, 'h5', t('recipeDetailParameterSummary') || '参数概览');
    summary.appendChild(summaryHeader);

    // Bento Grid for core scalar generation parameters
    const bentoGrid = document.createElement('div');
    bentoGrid.className = 'anomalous-recipe-bento-grid';

    const bentoItems = [
        { label: t('recipeDetailSteps') || '步数', val: params.steps, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' },
        { label: t('recipeDetailCFG') || 'CFG Scale', val: params.cfg, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>' },
        { label: t('recipeDetailSampler') || '采样器', val: params.sampler_name || params.samplers, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="8" cy="8" r="1.5"/><circle cx="16" cy="16" r="1.5"/><circle cx="12" cy="12" r="1.5"/></svg>' },
        { label: t('recipeDetailScheduler') || '调度器', val: params.scheduler, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' },
        { label: t('recipeDetailResolution') || '分辨率', val: resDisplay || params.resolution, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>' },
        { label: t('recipeDetailDenoise') || '降噪比', val: params.denoise, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg>' },
        { label: t('recipeDetailSeed') || '随机种子', val: params.seed, icon: '<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>', isSeed: true },
    ].filter(item => item.val !== undefined && item.val !== null && item.val !== '');

    if (bentoItems.length > 0) {
        for (const item of bentoItems) {
            const tile = document.createElement('div');
            tile.className = 'anomalous-recipe-bento-tile';

            const labelRow = document.createElement('div');
            labelRow.className = 'anomalous-recipe-bento-label-row';
            labelRow.style.display = 'flex';
            labelRow.style.justifyContent = 'space-between';
            labelRow.style.alignItems = 'center';

            const bentoLabel = document.createElement('span');
            bentoLabel.className = 'anomalous-recipe-bento-label';
            bentoLabel.innerHTML = `${item.icon}${item.label}`;
            labelRow.appendChild(bentoLabel);

            if (item.isSeed) {
                const copySeedBtn = document.createElement('button');
                copySeedBtn.className = 'anomalous-recipe-prompt-micro-copy';
                copySeedBtn.title = t('recipeCopyParameter') || '复制参数';
                copySeedBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
                copySeedBtn.onclick = (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(String(item.val)).then(() => {
                        copySeedBtn.classList.add('is-copied');
                        setTimeout(() => copySeedBtn.classList.remove('is-copied'), 1200);
                    });
                };
                labelRow.appendChild(copySeedBtn);
            }

            tile.appendChild(labelRow);
            const valEl = appendText(tile, 'span', String(item.val), 'anomalous-recipe-bento-val');
            valEl.title = String(item.val);
            bentoGrid.appendChild(tile);
        }
        summary.appendChild(bentoGrid);
    }

    // Base Model & LoRA Matrix
    const baseModelVal = params.baseModel || params.baseModels;
    if (baseModelVal || (Array.isArray(params.loras) && params.loras.length > 0)) {
        const modelsDeck = document.createElement('div');
        modelsDeck.className = 'anomalous-recipe-models-bento-deck';
        modelsDeck.style.display = 'grid';
        modelsDeck.style.gap = '8px';
        modelsDeck.style.marginTop = '10px';

        if (baseModelVal) {
            const modelCard = document.createElement('div');
            modelCard.className = 'anomalous-recipe-model-highlight-card';
            modelCard.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><span style="display:inline-flex;align-items:center;color:#dc143c;"><svg style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></span><span style="font-size:0.75rem;color:#94a3b8;text-transform:uppercase;font-weight:600;">${t('recipeDetailBaseModel') || '底模'}</span></div><div style="font-size:0.9rem;font-weight:600;color:#f8fafc;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(String(baseModelVal))}">${escapeHtml(String(baseModelVal))}</div>`;
            modelsDeck.appendChild(modelCard);
        }

        if (Array.isArray(params.loras) && params.loras.length > 0) {
            const loraSection = document.createElement('div');
            loraSection.className = 'anomalous-recipe-lora-stack';
            const loraHeader = appendText(loraSection, 'div', '', 'anomalous-recipe-bento-label');
            loraHeader.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>${t('recipeDetailLoraSummary') || 'LoRA 阵容'} (${params.loras.length})`;

            const loraGrid = document.createElement('div');
            loraGrid.style.display = 'grid';
            loraGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
            loraGrid.style.gap = '8px';
            loraGrid.style.marginTop = '6px';

            for (const lora of params.loras) {
                const loraPill = document.createElement('div');
                loraPill.className = 'anomalous-recipe-lora-pill';
                const loraName = typeof lora === 'object' && lora !== null ? (lora.name || 'Unknown') : String(lora);
                const modelWeight = typeof lora === 'object' && lora !== null && lora.strength_model !== undefined ? lora.strength_model : 1;
                const clipWeight = typeof lora === 'object' && lora !== null && lora.strength_clip !== undefined ? lora.strength_clip : 1;

                loraPill.innerHTML = `<div class="anomalous-recipe-lora-name" title="${escapeHtml(String(loraName))}">🎭 ${escapeHtml(String(loraName))}</div><div class="anomalous-recipe-lora-weights"><span title="Model Strength">M:${escapeHtml(String(modelWeight))}</span><span title="CLIP Strength">C:${escapeHtml(String(clipWeight))}</span></div>`;
                loraGrid.appendChild(loraPill);
            }
            loraSection.appendChild(loraGrid);
            modelsDeck.appendChild(loraSection);
        }
        summary.appendChild(modelsDeck);
    }

    if (!bentoItems.length && !baseModelVal && (!Array.isArray(params.loras) || !params.loras.length)) {
        appendText(summary, 'p', t('recipeDetailNoSavedParameters'), 'anomalous-recipe-detail-muted');
    }

    const promptWrap = document.createElement('div');
    promptWrap.style.marginBottom = '14px';
    const saveNamedNodes = (nodeIds, label, actionButton) => saveParameterMaterial(
        owner,
        recipe,
        parameterState,
        nodeIds,
        `${currentName} · ${label}`,
        actionButton,
    );
    renderPromptSection(promptWrap, owner, recipe, source, selectParameterTab, saveNamedNodes);

    const nodesSection = document.createElement('section');
    nodesSection.className = 'anomalous-recipe-detail-section';
    renderRawNodesLazy(nodesSection, source, { onSaveNodes: saveNamedNodes });

    wrapper.append(intro, summary, promptWrap, nodesSection);
    layout.append(sidebar, wrapper);
    content.appendChild(layout);
}


function diffCategoryLabel(category) {
    return t({
        pinned: 'recipeDiffPinned',
        prompts: 'recipeDiffPrompts',
        models: 'recipeDiffModels',
        parameters: 'recipeDiffParameters',
        workflow: 'recipeDiffWorkflow',
        presentation: 'recipeDiffPresentation',
    }[category] || 'recipeDiffOther');
}

function appendDiffValue(parent, label, value, kind) {
    const item = document.createElement('div');
    item.className = `anomalous-recipe-diff-value anomalous-recipe-diff-value-${kind}`;
    appendText(item, 'small', label, 'anomalous-recipe-detail-muted');
    appendValueViewer(item, fullDiffValue(value));
    parent.appendChild(item);
}

function renderDiffPanel(parent, owner, recipe, version, trigger) {
    const panel = document.createElement('div');
    panel.className = 'anomalous-recipe-version-diff';
    appendText(panel, 'strong', t('recipeDiffLoading'));
    parent.appendChild(panel);
    trigger.disabled = true;
    fetch(`/anomalous/recipe_version?filename=${encodeURIComponent(owner.recipeDetailFilename)}&version=${encodeURIComponent(version.version)}`)
        .then(async (response) => {
            const payload = await response.json();
            if (!response.ok || payload.status !== 'success' || !payload.data?.workflow) throw new Error('version diff request failed');
            return payload.data;
        })
        .then((historical) => {
            panel.replaceChildren();
            const changes = buildRecipeDiff(historical, recipe);
            if (diffIsEmpty(changes)) {
                appendText(panel, 'p', t('recipeDiffNoChanges'), 'anomalous-recipe-detail-muted');
                return;
            }
            appendText(panel, 'strong', `${t('recipeDiffSummary')} (${changes.length})`);
            const groups = new Map();
            for (const change of changes) {
                if (!groups.has(change.category)) groups.set(change.category, []);
                groups.get(change.category).push(change);
            }
            for (const [category, categoryChanges] of groups) {
                const group = document.createElement('section');
                group.className = 'anomalous-recipe-diff-group';
                appendText(group, 'h5', diffCategoryLabel(category));
                for (const change of categoryChanges) {
                    const row = document.createElement('article');
                    row.className = `anomalous-recipe-diff-row anomalous-recipe-diff-${change.kind}`;
                    const values = document.createElement('div');
                    values.className = 'anomalous-recipe-diff-values';
                    const marker = change.kind === 'added' ? '+' : change.kind === 'removed' ? '−' : '→';
                    appendText(row, 'span', marker, 'anomalous-recipe-diff-marker');
                    appendText(row, 'strong', change.label || change.key, 'anomalous-recipe-diff-label');
                    if (change.kind !== 'added') appendDiffValue(values, t('recipeDiffBefore'), change.before, 'before');
                    if (change.kind === 'changed') appendText(row, 'span', '→', 'anomalous-recipe-diff-arrow');
                    if (change.kind !== 'removed') appendDiffValue(values, t('recipeDiffAfter'), change.after, 'after');
                    row.appendChild(values);
                    group.appendChild(row);
                }
                panel.appendChild(group);
            }
        })
        .catch((error) => {
            console.error('Could not compare Workflow Recipe version:', error);
            panel.replaceChildren();
            appendText(panel, 'p', t('recipeDiffError'), 'anomalous-recipe-dialog-error');
        })
        .finally(() => {
            trigger.disabled = false;
            trigger.textContent = t('recipeCompareVersion');
        });
}

function renderVersions(content, owner, recipe, history, finish) {
    const section = document.createElement('section');
    section.className = 'anomalous-recipe-detail-section';
    appendText(section, 'h4', t('recipeHistory'));
    const timeline = document.createElement('div');
    timeline.className = 'anomalous-recipe-version-timeline';
    const current = document.createElement('article');
    current.className = 'anomalous-recipe-version-row current';
    appendText(current, 'strong', t('recipeDetailCurrentVersion'));
    appendText(current, 'span', dateText(recipe.updated_timestamp || recipe.timestamp));
    const currentFingerprint = fingerprintText(recipe);
    appendText(current, 'code', shortHash(currentFingerprint) || t('recipeDetailNotIndexed'));
    if (currentFingerprint) appendCopyButton(current, currentFingerprint, t('recipeDetailCopyFingerprint'));
    timeline.appendChild(current);
    for (const version of history || []) {
        const row = document.createElement('article');
        row.className = 'anomalous-recipe-version-row';
        const copy = document.createElement('div');
        appendText(copy, 'strong', version.name || t('recipeUnknownVersion'));
        appendText(copy, 'span', dateText(version.timestamp));
        row.appendChild(copy);
        const versionFingerprint = version.workflow_fingerprint?.value || '';
        appendText(row, 'code', shortHash(versionFingerprint) || t('recipeDetailNotIndexed'));
        if (versionFingerprint) appendCopyButton(row, versionFingerprint, t('recipeDetailCopyFingerprint'));
        const compare = button(row, t('recipeCompareVersion'), 'anomalous-btn-primary');
        compare.onclick = () => {
            const existing = row.querySelector('.anomalous-recipe-version-diff');
            if (existing) {
                existing.remove();
                compare.textContent = t('recipeCompareVersion');
                return;
            }
            compare.textContent = t('recipeDiffLoading');
            renderDiffPanel(row, owner, recipe, version, compare);
        };
        const restore = button(row, t('recipeRestoreVersion'), 'anomalous-btn-danger');
        restore.onclick = async () => {
            if (!await anomalousConfirm(t('recipeRestoreVersionConfirm'))) return;
            try {
                const response = await fetch('/anomalous/restore_recipe_version', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: owner.recipeDetailFilename, version: version.version }),
                });
                if (!response.ok) throw new Error('restore failed');
                await owner.refreshRecipes();
                finish('restored');
            } catch (error) {
                console.error('Could not restore recipe version:', error);
                await anomalousAlert(t('recipeUpdateError'));
            }
        };
        timeline.appendChild(row);
    }
    if (!(history || []).length) appendText(timeline, 'p', t('recipeHistoryEmpty'), 'anomalous-recipe-detail-muted');
    section.appendChild(timeline);
    content.appendChild(section);
}

function renderRecipeGallery(content, owner, recipe, gallery, refresh) {
    const section = document.createElement('section');
    section.className = 'anomalous-recipe-detail-section anomalous-recipe-gallery';
    const heading = document.createElement('div');
    heading.className = 'anomalous-recipe-detail-section-heading';
    appendText(heading, 'h4', t('recipeGallery'));
    const refreshButton = button(heading, t('recipeGalleryRefresh'), 'anomalous-btn-ghost anomalous-recipe-gallery-refresh');
    refreshButton.onclick = () => { void refresh(true); };
    section.appendChild(heading);

    if (gallery.status === 'loading') {
        appendText(section, 'p', t('recipeGalleryLoading'), 'anomalous-recipe-detail-muted');
        content.appendChild(section);
        return;
    }
    if (gallery.status === 'error') {
        appendText(section, 'p', t('recipeGalleryLoadError'), 'anomalous-recipe-detail-muted');
        content.appendChild(section);
        return;
    }

    if (gallery.status === 'ready') {
        appendText(section, 'small', t('recipeGalleryScanHint').replace('{count}', String(gallery.scanned || 0)), 'anomalous-recipe-detail-muted');
    }
    if (!gallery.images.length) {
        appendText(section, 'p', t('recipeGalleryEmpty'), 'anomalous-recipe-detail-muted');
        content.appendChild(section);
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'anomalous-recipe-gallery-grid';
    for (const sourceImage of gallery.images) {
        const card = document.createElement('article');
        card.className = 'anomalous-recipe-gallery-card';
        const url = outputImageUrl(sourceImage);
        const image = document.createElement('img');
        image.src = url;
        image.alt = t('recipeGalleryOpenImage');
        image.loading = 'lazy';
        image.onclick = () => owner.showGalleryViewer?.(url);
        card.appendChild(image);
        const actions = document.createElement('div');
        actions.className = 'anomalous-recipe-gallery-card-actions';
        const details = button(actions, `🔎 ${t('materialViewDetails')}`, 'anomalous-btn-primary');
        details.onclick = event => {
            event.stopPropagation();
            openGalleryImageDetail(owner, gallery.images, sourceImage, url);
        };
        card.appendChild(actions);
        grid.appendChild(card);
    }
    section.appendChild(grid);
    content.appendChild(section);
}

async function showGalleryComparison(card, owner, sourceImage) {
    const existing = card.querySelector('.anomalous-recipe-gallery-comparison');
    if (existing) {
        existing.remove();
        return;
    }
    const panel = document.createElement('div');
    panel.className = 'anomalous-recipe-gallery-comparison';
    appendText(panel, 'strong', t('recipeGalleryComparison'));
    appendText(panel, 'p', t('recipeGalleryComparisonLoading'), 'anomalous-recipe-detail-muted');
    card.appendChild(panel);
    try {
        const query = new URLSearchParams({
            filename: owner.recipeDetailFilename,
            image_filename: sourceImage.filename,
            image_subfolder: sourceImage.subfolder || '',
        });
        const response = await fetch(`/anomalous/recipe_gallery_compare?${query.toString()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('gallery comparison failed');
        const payload = await response.json();
        const comparison = payload.comparison || {};
        panel.replaceChildren();
        appendText(panel, 'strong', t('recipeGalleryComparison'));
        if (!comparison.changes?.length) {
            appendText(panel, 'p', t('recipeGalleryNoDifferences'), 'anomalous-recipe-detail-muted');
            return;
        }
        appendText(panel, 'small', t('recipeGalleryDifferenceHint'), 'anomalous-recipe-detail-muted');
        for (const change of comparison.changes) {
            const row = document.createElement('div');
            row.className = 'anomalous-recipe-gallery-diff-row';
            appendText(row, 'strong', `${change.type} #${change.index}`);
            const values = document.createElement('div');
            values.className = 'anomalous-recipe-gallery-diff-values';
            appendText(values, 'span', `${t('recipeGalleryRecipeValue')}: ${displayValue(change.recipe)}`);
            appendText(values, 'span', `${t('recipeGalleryImageValue')}: ${displayValue(change.image)}`);
            row.appendChild(values);
            panel.appendChild(row);
        }
    } catch (error) {
        console.error('Could not compare recipe gallery image:', error);
        panel.replaceChildren();
        appendText(panel, 'strong', t('recipeGalleryComparison'));
        appendText(panel, 'p', t('recipeGalleryComparisonError'), 'anomalous-recipe-detail-muted');
    }
}

export function showRecipeDetail(owner, { recipe, filename, history = [] }) {
    const returnState = owner.recipeReturnState || null;
    owner.recipeReturnState = null;
    owner.recipeDetailPayload = { recipe, filename, history };
    owner.recipeDetailFilename = filename;
    owner.recipeListContainer.style.display = 'none';
    const topbars = owner.recipeView ? Array.from(owner.recipeView.querySelectorAll('.anomalous-recipe-topbar, .anomalous-recipe-actionbar')) : [];
    topbars.forEach(bar => { bar.style.display = 'none'; });
    const betaNotice = owner.recipeView?.querySelector('.anomalous-recipe-beta-notice');
    if (betaNotice) betaNotice.style.display = 'none';
    if (owner.recipeDetailView) owner.recipeDetailView.remove();

    const view = document.createElement('div');
    view.className = 'anomalous-recipe-detail-view';
    owner.recipeDetailView = view;
    const references = deriveRecipeModelReferences(recipe);
    owner.recipeDetailPreviewState = 'idle';
    let resolveAction;
    let settled = false;
    const result = new Promise((resolve) => { resolveAction = resolve; });
    const finish = (mode) => {
        if (settled) return;
        settled = true;
        view.remove();
        owner.recipeDetailView = null;
        if (!['canvas', 'append', 'model'].includes(mode)) {
            owner.recipeListContainer.style.display = '';
            topbars.forEach(bar => { bar.style.display = ''; });
            if (betaNotice) betaNotice.style.display = '';
        }
        if (owner.recipeDetailFinish === finish) owner.recipeDetailFinish = null;
        if (mode !== 'model') delete owner.recipeDetailPayload;
        resolveAction({ mode });
    };
    owner.recipeDetailFinish = finish;


    const tabs = document.createElement('div');
    tabs.className = 'anomalous-recipe-detail-tabs';
    const content = document.createElement('div');
    content.className = 'anomalous-recipe-detail-content';
    const gallery = { status: 'idle', images: [], scanned: 0 };
    const parameterGallery = { status: 'idle', images: [], scanned: 0 };
    const parameterState = {
        status: 'idle',
        notebooks: [],
        selectedFilename: null,
        switchToken: 0,
        parameterGalleryRequestId: 0,
        refresh: null,
    };
    const galleryTabLabel = () => gallery.status === 'ready'
        ? `${t('recipeGallery')} (${gallery.images.length})`
        : t('recipeGallery');
    const updateGalleryTab = () => {
        const tab = tabs.querySelector('[data-tab="gallery"]');
        if (tab) tab.textContent = galleryTabLabel();
    };
    const refreshGallery = async (force = false) => {
        if (gallery.status === 'loading' || (!force && gallery.status === 'ready')) return;
        gallery.status = 'loading';
        updateGalleryTab();
        if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'gallery') selectTab('gallery');
        try {
            const response = await fetch(`/anomalous/recipe_gallery?filename=${encodeURIComponent(filename)}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('recipe gallery request failed');
            const payload = await response.json();
            gallery.images = Array.isArray(payload.images) ? payload.images : [];
            gallery.scanned = Number(payload.scanned) || 0;
            gallery.status = 'ready';
        } catch (error) {
            console.error('Could not load recipe gallery:', error);
            gallery.status = 'error';
        }
        updateGalleryTab();
        if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'gallery') selectTab('gallery');
    };
    const refreshParameterNotebooks = async (force = false) => {
        if (parameterState.status === 'loading' || (!force && parameterState.status === 'ready')) return;
        parameterState.status = 'loading';
        if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'parameters') selectTab('parameters');
        try {
            const response = await fetch(`/anomalous/parameters?recipe_filename=${encodeURIComponent(filename)}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('recipe parameter notebook request failed');
            const payload = await response.json();
            parameterState.notebooks = Array.isArray(payload.notebooks) ? payload.notebooks : [];
            if (!parameterState.notebooks.some((item) => item.filename === parameterState.selectedFilename)) {
                parameterState.selectedFilename = parameterState.notebooks[0]?.filename || null;
            }
            parameterState.status = 'ready';
        } catch (error) {
            console.error('Could not load recipe parameter notebooks:', error);
            parameterState.status = 'error';
        }
        parameterGallery.status = 'idle';
        parameterGallery.images = [];
        parameterGallery.scanned = 0;
        if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'parameters') {
            selectTab('parameters');
            void refreshParameterGallery();
        }
    };
    parameterState.refresh = refreshParameterNotebooks;
    const refreshParameterGallery = async (force = false) => {
        if (parameterGallery.status === 'loading' || (!force && parameterGallery.status === 'ready')) return;
        parameterGallery.status = 'loading';
        const requestId = ++parameterState.parameterGalleryRequestId;
        if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'parameters') selectTab('parameters');
        try {
            const selectedFilename = parameterState.selectedFilename;
            const endpoint = selectedFilename
                ? `/anomalous/parameter_gallery?filename=${encodeURIComponent(selectedFilename)}`
                : `/anomalous/recipe_parameter_gallery?filename=${encodeURIComponent(filename)}`;
            const response = await fetch(endpoint, { cache: 'no-store' });
            if (!response.ok) throw new Error('recipe parameter gallery request failed');
            const payload = await response.json();
            if (payload.status !== 'success') throw new Error('recipe parameter gallery response failed');
            if (requestId !== parameterState.parameterGalleryRequestId || selectedFilename !== parameterState.selectedFilename) return;
            parameterGallery.images = Array.isArray(payload.images) ? payload.images : [];
            parameterGallery.scanned = Number(payload.scanned) || 0;
            parameterGallery.status = 'ready';
        } catch (error) {
            if (requestId !== parameterState.parameterGalleryRequestId) return;
            console.error('Could not load recipe parameter gallery:', error);
            parameterGallery.status = 'error';
        }
        if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'parameters') selectTab('parameters');
    };
    const tabDefinitions = [
        ['overview', t('recipeDetailOverview'), () => {
            renderOverview(content, owner, recipe, references, finish);
        }],
        ['parameters', t('recipeDetailParameters'), () => renderRecipeParameters(
            content,
            owner,
            recipe,
            parameterGallery,
            refreshParameterGallery,
            parameterState,
            () => selectTab('parameters'),
        )],
        ['versions', t('recipeDetailVersions'), () => renderVersions(content, owner, recipe, history, finish)],
        ['gallery', galleryTabLabel(), () => renderRecipeGallery(content, owner, recipe, gallery, refreshGallery)],
    ];
    const selectTab = (active) => {
        owner.recipeDetailActiveTab = active;
        content.replaceChildren();
        for (const [key, label, render] of tabDefinitions) {
            const tab = tabs.querySelector(`[data-tab="${key}"]`);
            tab?.classList.toggle('active', key === active);
        }
        try {
            tabDefinitions.find(([key]) => key === active)?.[2]();
        } catch (tabError) {
            console.error(`Error rendering recipe detail tab "${active}":`, tabError);
            appendText(content, 'p', `Tab render error: ${tabError?.message || tabError}`, 'anomalous-recipe-dialog-error');
        }
        if (active === 'parameters') {
            if (parameterState.status === 'idle') void refreshParameterNotebooks();
            else if (parameterState.status === 'ready' && parameterGallery.status === 'idle') void refreshParameterGallery();
        }
        if (active !== 'overview' || owner.recipeDetailPreviewState !== 'idle') return;
        owner.recipeDetailPreviewState = 'loading';
        void loadCurrentPreviews(owner, references)
            .catch((error) => console.warn('Could not load recipe model previews:', error))
            .finally(() => {
                owner.recipeDetailPreviewState = 'loaded';
                if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'overview') {
                    // Re-render the overview so newly loaded previews become visible.
                    selectTab('overview');
                }
            });
    };
    const backTab = button(tabs, '← ' + t('recipeDetailBack'), 'anomalous-recipe-detail-tab anomalous-recipe-back-tab');
    backTab.style.backgroundColor = 'transparent';
    backTab.style.color = 'var(--descrip-text, #a8a8a8)';
    backTab.onmouseover = () => { backTab.style.color = '#fff'; };
    backTab.onmouseout = () => { backTab.style.color = 'var(--descrip-text, #a8a8a8)'; };
    backTab.onclick = () => finish('back');
    for (const [key, label] of tabDefinitions) {
        const tab = button(tabs, label, 'anomalous-recipe-detail-tab');
        tab.dataset.tab = key;
        tab.onclick = () => selectTab(key);
    }
    view.append(tabs, content);
    owner.recipeView.appendChild(view);
    selectTab(returnState?.activeTab || 'overview');
    void refreshGallery();
    void refreshParameterNotebooks();
    if (returnState?.scrollTop) {
        requestAnimationFrame(() => {
            view.scrollTop = returnState.scrollTop;
            content.scrollTop = returnState.scrollTop;
        });
    }
    return result;
}
