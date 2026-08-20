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

export async function appendRecipeOnCanvas(owner, recipe) {
    try {
        appendRecipeToCanvas(recipe);
        closeRecipeWorkspace(owner);
        return true;
    } catch (error) {
        console.error('Could not append Workflow Recipe:', error);
        await anomalousAlert(error.code === 'recipe_append_missing_node'
            ? `${t('recipeAppendError')}\n${error.message}`
            : t('recipeAppendError'));
        return false;
    }
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
        if (!result.found) {
            status.textContent = result.ambiguous
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
            filename: model.filename,
            type: model.type,
            matched_by_hash: result.matched_by_hash === true,
            matched_by_size: result.matched_by_size === true,
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
        if (!reference || !result?.found) continue;
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
            filename: model.filename,
            type: model.type,
            matched_by_hash: result.matched_by_hash === true,
            matched_by_size: result.matched_by_size === true,
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

    const params = JSON.parse(JSON.stringify(recipe.params || {}));
    if (Array.isArray(params.model_references)) {
        const stored = params.model_references.find((candidate) => (
            String(candidate?.node_id ?? '') === String(reference?.node_id ?? '')
            && Number(candidate?.widget_index) === index
            && String(candidate?.category || '') === String(reference?.category || '')
            && candidate?.saved_value === reference?.saved_value
        ));
        if (stored) stored.saved_value = filename;
    }

    status.textContent = t('recipeApplyingLocalMatch');
    try {
        await updateInlineRecipeMetadata(owner, recipe, { workflow, params });
        reference.saved_value = filename;
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

function renderOverview(content, owner, recipe, references, finish) {
    const overview = document.createElement('div');
    overview.className = 'anomalous-recipe-detail-overview';
    const hero = document.createElement('div');
    hero.className = 'anomalous-recipe-detail-hero';
    appendRecipeCover(hero, owner, recipe);
    const copy = document.createElement('div');
    copy.className = 'anomalous-recipe-detail-hero-copy';
    const title = document.createElement('div');
    title.className = 'anomalous-recipe-inline-title-row';
    renderInlineTitle(title, owner, recipe);
    copy.appendChild(title);
    const notes = document.createElement('div');
    notes.className = 'anomalous-recipe-detail-notes';
    renderInlineNotes(notes, owner, recipe);
    copy.appendChild(notes);
    const tags = document.createElement('div');
    tags.className = 'anomalous-recipe-tags anomalous-recipe-detail-tags';
    renderInlineTags(tags, owner, recipe);
    copy.appendChild(tags);
    appendText(copy, 'small', `${t('recipeDetailUpdated')}: ${dateText(recipe.updated_timestamp || recipe.timestamp)}`, 'anomalous-recipe-detail-muted');
    
    const overviewActions = document.createElement('div');
    overviewActions.className = 'anomalous-recipe-actions-primary';
    overviewActions.style.marginTop = '12px';
    const matchRecipe = button(overviewActions, '🔎 ' + t('recipeMatchRecipeModels'), 'anomalous-btn-ghost');
    matchRecipe.title = t('recipeMatchRecipeModelsDesc');
    const matchRecipeStatus = appendText(overviewActions, 'small', '', 'anomalous-recipe-header-status');
    matchRecipeStatus.setAttribute('aria-live', 'polite');
    matchRecipe.onclick = async () => {
        matchRecipe.disabled = true;
        matchRecipe.classList.add('is-busy');
        matchRecipe.textContent = t('recipeMatchingRecipeModels');
        try {
            const result = await matchRecipeModels(owner, references, matchRecipeStatus, () => {
                if (owner.recipeDetailActiveTab === 'overview') selectTab('overview');
            });
            matchRecipeStatus.textContent = result.total
                ? t('recipeRecipeMatchSummary').replace('{found}', String(result.found)).replace('{total}', String(result.total))
                : t('recipeAllModelsMatched');
        } catch (error) {
            console.error('Could not match recipe models locally:', error);
            matchRecipeStatus.textContent = t('recipeLocalModelMatchError');
        } finally {
            matchRecipe.disabled = false;
            matchRecipe.classList.remove('is-busy');
            matchRecipe.textContent = '🔎 ' + t('recipeMatchRecipeModels');
        }
    };
    
    const heroAppend = button(overviewActions, t('recipeAppendCanvas'), 'anomalous-btn-ghost');
    heroAppend.onclick = () => {
        void runRecipeAction(heroAppend, async () => {
            if (await appendRecipeOnCanvas(owner, recipe)) finish('append');
        });
    };
    
    const secondaryActions = document.createElement('div');
    secondaryActions.className = 'anomalous-recipe-actions-secondary';
    const heroEdit = button(secondaryActions, '✏️', 'anomalous-btn-icon anomalous-btn-edit');
    heroEdit.title = t('recipeEdit');
    heroEdit.onclick = () => finish('edit');
    overviewActions.appendChild(secondaryActions);
    copy.appendChild(overviewActions);
    
    hero.appendChild(copy);
    overview.appendChild(hero);


    const stats = document.createElement('div');
    stats.className = 'anomalous-recipe-detail-stats';
    const verified = references.filter((reference) => normaliseIdentity(reference.identity).status === 'verified').length;
    const unverified = references.filter((reference) => normaliseIdentity(reference.identity).status === 'unverified').length;
    const missing = missingNodeTypes(recipe).length;
    renderStat(stats, t('recipeDetailIdentity'), `${verified}/${references.length}`, verified === references.length ? 'good' : 'warn');
    renderStat(stats, t('recipeDetailUnverified'), String(unverified), unverified ? 'warn' : 'good');
    renderStat(stats, t('recipeDetailMissingNodes'), String(missing), missing ? 'warn' : 'good');
    overview.appendChild(stats);

    const advanced = document.createElement('details');
    advanced.className = 'anomalous-recipe-advanced-info';
    appendText(advanced, 'summary', t('recipeAdvancedInfo'));
    const fingerprint = document.createElement('div');
    fingerprint.className = 'anomalous-recipe-advanced-row';
    appendText(fingerprint, 'span', `${t('recipeDetailFingerprint')}:`);
    appendText(fingerprint, 'code', fingerprintText(recipe) || t('recipeDetailNotIndexed'));
    if (fingerprintText(recipe)) appendCopyButton(fingerprint, fingerprintText(recipe), t('recipeDetailCopyFingerprint'));
    advanced.appendChild(fingerprint);
    overview.appendChild(advanced);

    const summary = document.createElement('section');
    summary.className = 'anomalous-recipe-detail-section';
    appendText(summary, 'h4', t('recipeDetailSummary'));
    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'anomalous-recipe-detail-summary-grid';
    const params = recipe.params || {};
    const modelComposition = document.createElement('div');
    modelComposition.className = 'anomalous-recipe-model-composition';
    summary.appendChild(modelComposition);
    renderModelComposition(modelComposition, owner, recipe, references, finish, params);
    overview.appendChild(summary);

    const actions = document.createElement('div');
    actions.className = 'anomalous-recipe-actions anomalous-recipe-detail-actions';
    const edit = button(actions, t('recipeEdit'), 'anomalous-btn-success');
    edit.onclick = () => finish('edit');
    const append = button(actions, t('recipeAppendCanvas'), 'anomalous-btn-primary');
    append.onclick = () => {
        void runRecipeAction(append, async () => {
            if (await appendRecipeOnCanvas(owner, recipe)) finish('append');
        });
    };
    overview.appendChild(actions);
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
        fetchBtn.textContent = t('recipeOriginFetchHash');
        fetchBtn.style.background = 'rgba(255, 255, 255, 0.05)';
        fetchBtn.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        fetchBtn.style.color = '#fff';
        fetchBtn.style.padding = '8px 12px';
        fetchBtn.style.borderRadius = '8px';
        fetchBtn.style.cursor = 'pointer';
        fetchBtn.style.fontSize = '13px';
        fetchBtn.style.transition = 'all 0.2s';
        fetchBtn.style.marginTop = '4px';
        fetchBtn.onmouseover = () => fetchBtn.style.background = 'rgba(255, 255, 255, 0.1)';
        fetchBtn.onmouseout = () => fetchBtn.style.background = 'rgba(255, 255, 255, 0.05)';
        
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
                fetchBtn.style.background = 'rgba(255, 255, 255, 0.05)';
                fetchBtn.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                fetchBtn.style.color = '#fff';
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
    cancelBtn.textContent = t('recipeCancel');
    cancelBtn.style.background = 'transparent';
    cancelBtn.style.border = 'none';
    cancelBtn.style.color = 'rgba(255, 255, 255, 0.7)';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.style.padding = '8px 16px';
    cancelBtn.style.fontSize = '14px';
    cancelBtn.style.borderRadius = '6px';
    cancelBtn.onmouseover = () => cancelBtn.style.background = 'rgba(255, 255, 255, 0.05)';
    cancelBtn.onmouseout = () => cancelBtn.style.background = 'transparent';
    cancelBtn.onclick = () => document.body.removeChild(overlay);
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = t('recipeSave');
    saveBtn.style.background = 'var(--anomalous-accent, #6366f1)';
    saveBtn.style.border = 'none';
    saveBtn.style.color = '#fff';
    saveBtn.style.cursor = 'pointer';
    saveBtn.style.padding = '8px 16px';
    saveBtn.style.fontSize = '14px';
    saveBtn.style.fontWeight = '500';
    saveBtn.style.borderRadius = '6px';
    saveBtn.style.boxShadow = '0 2px 8px rgba(99, 102, 241, 0.3)';
    saveBtn.onmouseover = () => saveBtn.style.filter = 'brightness(1.1)';
    saveBtn.onmouseout = () => saveBtn.style.filter = 'none';
    
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
        nameRow.appendChild(editOriginBtn);

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
            const apply = button(meta, t('recipeApplyLocalMatch'), 'anomalous-btn-ghost anomalous-recipe-model-match');
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

function renderPromptSection(parent, owner, recipe, source, rerender) {
    const prompts = promptValues(source, recipe);
    if (!prompts.entries.length) {
        appendText(parent, 'p', t('recipeDetailNoPrompts'), 'anomalous-recipe-detail-muted');
        return;
    }

    const heading = document.createElement('div');
    heading.className = 'anomalous-recipe-detail-section-heading';
    appendText(heading, 'h5', t('recipeDetailPrompts'));
    appendText(heading, 'small', t('recipePromptSupportNotice'), 'anomalous-recipe-detail-muted');
    parent.appendChild(heading);

    const promptList = document.createElement('div');
    promptList.className = 'anomalous-recipe-detail-prompt-list';
    for (const entry of prompts.entries) {
        const card = document.createElement('article');
        card.className = `anomalous-recipe-detail-prompt anomalous-recipe-prompt-role-${entry.role}`;

        const meta = document.createElement('div');
        meta.className = 'anomalous-recipe-prompt-meta';
        appendText(meta, 'strong', entry.title, 'anomalous-recipe-detail-prompt-label');
        appendText(meta, 'small', entry.type, 'anomalous-recipe-detail-muted');
        const badge = appendText(meta, 'span', promptRoleLabel(entry.role), `anomalous-recipe-prompt-role-badge is-${entry.role}`);
        badge.title = entry.manual ? t('recipePromptRoleManual') : t('recipePromptRoleAutomatic');

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
        meta.appendChild(roleSelect);

        const value = document.createElement('div');
        value.className = 'anomalous-recipe-prompt-value';
        appendValueViewer(value, entry.text);
        card.append(meta, value);
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

    const selectionBanner = document.createElement('section');
    selectionBanner.className = 'anomalous-recipe-parameter-selection-banner';
    selectionBanner.setAttribute('aria-live', 'polite');
    const selectionCopy = document.createElement('div');
    selectionCopy.className = 'anomalous-recipe-parameter-selection-copy';
    appendText(selectionCopy, 'small', t('recipeParameterShowing'), 'anomalous-recipe-detail-muted');
    appendText(
        selectionCopy,
        'strong',
        parameterState?.editor?.name || selectedNotebook?.name || t('recipeParameterCurrentRecipe'),
    );
    if (selectedNotebook?.timestamp) appendText(selectionCopy, 'small', dateText(selectedNotebook.timestamp), 'anomalous-recipe-detail-muted');
    appendText(selectionBanner, 'span', t('recipeParameterActive'), 'anomalous-recipe-parameter-selection-badge');
    selectionBanner.prepend(selectionCopy);
    wrapper.appendChild(selectionBanner);

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
    
    const newSnapshot = button(sidebarActions, t('recipeParameterNew'), 'anomalous-btn-primary');
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
            readCurrent.textContent = originalLabel;
        }
    };
    
    const readCurrent = button(sidebarActions, t('recipeParameterReadCurrent'), 'anomalous-btn-success');
    readCurrent.onclick = readCurrentHandler;
    
    sidebar.appendChild(sidebarActions);
    appendText(sidebar, 'small', t('recipeParameterSnapshotsHint'), 'anomalous-recipe-detail-muted');
    const snapshotList = document.createElement('div');
    snapshotList.className = 'anomalous-recipe-parameter-notebook-list';
    if (parameterState?.status === 'loading') {
        appendText(snapshotList, 'p', t('recipeParameterLoading'), 'anomalous-recipe-detail-muted');
    } else if (parameterState?.status === 'error') {
        appendText(snapshotList, 'p', t('recipeParameterLoadError'), 'anomalous-recipe-dialog-error');
    } else if (parameterState?.notebooks?.length) {
        for (const notebook of parameterState.notebooks) {
            const row = document.createElement('div');
            row.className = 'anomalous-recipe-parameter-notebook-row';
            const notebookName = notebook.name || t('recipeParameterUntitled');
            const item = button(row, notebookName, 'anomalous-recipe-parameter-notebook-item');
            item.classList.toggle('is-active', notebook.filename === parameterState.selectedFilename);
            item.setAttribute('aria-pressed', notebook.filename === parameterState.selectedFilename ? 'true' : 'false');
            item.title = `${notebookName} · ${dateText(notebook.timestamp)}`;
            appendText(item, 'small', dateText(notebook.timestamp), 'anomalous-recipe-detail-muted');
            item.onclick = () => {
                if (parameterState.selectedFilename === notebook.filename) return;
                item.classList.add('is-switching');
                parameterState.editor = null;
                parameterState.selectedFilename = notebook.filename;
                parameterState.switchToken = (parameterState.switchToken || 0) + 1;
                gallery.status = 'idle';
                gallery.images = [];
                gallery.scanned = 0;
                selectParameterTab?.();
            };

            const rename = button(row, '✏️', 'anomalous-recipe-parameter-notebook-rename');
            rename.title = t('recipeParameterRename');
            rename.setAttribute('aria-label', `${t('recipeParameterRename')}: ${notebookName}`);
            rename.onclick = async () => {
                const newName = await anomalousPrompt(t('recipeParameterRenamePrompt'), notebookName);
                if (newName === null || !newName.trim() || newName.trim() === notebookName) return;
                const trimmedName = newName.trim();
                rename.disabled = true;
                item.disabled = true;
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
                    item.disabled = false;
                    row.classList.remove('is-busy');
                    await anomalousAlert(t('recipeParameterRenameError'));
                }
            };

            const remove = button(row, '×', 'anomalous-recipe-parameter-notebook-delete');
            remove.title = t('recipeParameterDelete');
            remove.setAttribute('aria-label', `${t('recipeParameterDelete')}: ${notebookName}`);
            remove.onclick = async () => {
                if (!await anomalousConfirm(t('recipeParameterDeleteConfirm', { name: notebookName }))) return;
                remove.disabled = true;
                item.disabled = true;
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
                    item.disabled = false;
                    row.classList.remove('is-deleting');
                    await anomalousAlert(t('recipeParameterDeleteError'));
                }
            };
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
    intro.className = 'anomalous-recipe-detail-section';
    const introHeading = document.createElement('div');
    introHeading.className = 'anomalous-recipe-detail-section-heading';
    appendText(introHeading, 'h4', t('recipeDetailParameters'));
    if (parameterState?.selectedFilename) {
        const currentNotebook = parameterState.notebooks?.find(nb => nb.filename === parameterState.selectedFilename);
        const currentName = currentNotebook?.name || source?.name || t('recipeParameterUntitled');
        const renameHeadingBtn = button(introHeading, '✏️ ' + t('recipeParameterRename'), 'anomalous-btn-ghost');
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
    const applyButton = button(introHeading, t('recipeParameterApply'), 'anomalous-btn-primary');
    const applyStatus = appendText(introHeading, 'small', '', 'anomalous-recipe-header-status');
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
    intro.appendChild(introHeading);
    appendText(intro, 'p', t('recipeDetailParametersHint'), 'anomalous-recipe-detail-muted');

    renderPromptSection(intro, owner, recipe, source, selectParameterTab);

    const params = source?.params || {};
    const summary = document.createElement('section');
    summary.className = 'anomalous-recipe-detail-section';
    appendText(summary, 'h5', t('recipeDetailParameterSummary'));
    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'anomalous-recipe-detail-summary-grid';
    let formattedLoras = params.loras;
    if (Array.isArray(params.loras) && params.loras.length > 0) {
        formattedLoras = params.loras.map(lora => 
            typeof lora === 'object' && lora !== null 
                ? `• ${lora.name || 'Unknown'}\n  (Model: ${lora.strength_model ?? 1}, CLIP: ${lora.strength_clip ?? 1})` 
                : String(lora)
        ).join('\n\n');
    }

    const scalarFields = [
        ['recipeDetailSampler', params.sampler_name || params.samplers, {}],
        ['recipeDetailScheduler', params.scheduler, {}],
        ['recipeDetailSteps', params.steps, {}],
        ['recipeDetailCFG', params.cfg, {}],
        ['recipeDetailDenoise', params.denoise, {}],
        ['recipeDetailSeed', params.seed ?? 0, { redact: true, copy: false }],
        ['recipeDetailResolution', params.resolution, { wide: true }],
        ['recipeDetailBaseModel', params.baseModel || params.baseModels, { wide: true }],
        ['recipeDetailLoraSummary', formattedLoras, { wide: true }],
    ];
    for (const [labelKey, value, options] of scalarFields) renderParameterField(summaryGrid, t(labelKey), value, { ...options, collapse: false });
    if (summaryGrid.childElementCount) summary.appendChild(summaryGrid);
    else appendText(summary, 'p', t('recipeDetailNoSavedParameters'), 'anomalous-recipe-detail-muted');

    const nodesSection = document.createElement('section');
    nodesSection.className = 'anomalous-recipe-detail-section';
    appendText(nodesSection, 'h5', t('recipeDetailNodeParameters'));
    const nodeList = document.createElement('div');
    nodeList.className = 'anomalous-recipe-detail-parameter-list';
    let renderedWidgets = 0;
    for (const { summary: node, workflowNode } of parameterNodeOrder(source)) {
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
        appendText(block, 'strong', title, 'anomalous-recipe-detail-node-title');
        const widgetsContainer = document.createElement('div');
        widgetsContainer.className = 'anomalous-recipe-detail-node-widgets';
        for (let visibleIndex = 0; visibleIndex < widgets.length && renderedWidgets < 1200; visibleIndex += 1) {
            const widget = widgets[visibleIndex] || {};
            const index = Number.isInteger(widget.index) ? widget.index : visibleIndex;
            const value = Array.isArray(workflowNode?.widgets_values) && workflowNode.widgets_values[index] !== undefined
                ? workflowNode.widgets_values[index]
                : widget.value;
            const label = widget.name || `${t('recipeDetailWidget')} ${index + 1}`;
            const volatile = isVolatileParameter(node, widget, index);
            if (renderParameterField(widgetsContainer, label, volatile ? 0 : value, {
                redact: volatile,
                collapse: false,
            })) renderedWidgets += 1;
        }
        if (widgetsContainer.childElementCount) {
            block.appendChild(widgetsContainer);

            nodeList.appendChild(block);
        }
    }
    if (nodeList.childElementCount) nodesSection.appendChild(nodeList);
    else appendText(nodesSection, 'p', t('recipeDetailNoSavedParameters'), 'anomalous-recipe-detail-muted');

    wrapper.append(intro, summary, nodesSection);
    
    // Replace old bottom gallery with Hero Section at the top
    if (gallery.status === 'ready' && gallery.images.length) {
        const heroSection = document.createElement('section');
        heroSection.className = 'anomalous-recipe-detail-hero';
        
        const heroImage = document.createElement('img');
        heroImage.src = outputImageUrl(gallery.images[0]);
        heroImage.className = 'anomalous-recipe-detail-hero-image';
        heroImage.onclick = () => owner.showGalleryViewer?.(heroImage.src);
        heroSection.appendChild(heroImage);
        
        const galleryButton = document.createElement('button');
        galleryButton.className = 'anomalous-recipe-detail-hero-gallery-btn';
        galleryButton.innerHTML = `🖼️ ${t('recipeParameterGallery')}`;
        galleryButton.onclick = () => {
            const dialog = document.createElement('dialog');
            dialog.className = 'anomalous-recipe-gallery-dialog';
            
            const closeBtn = document.createElement('button');
            closeBtn.className = 'anomalous-dialog-close anomalous-btn-ghost';
            closeBtn.innerHTML = '✕';
            closeBtn.onclick = () => dialog.close();
            dialog.appendChild(closeBtn);
            
            const heading = document.createElement('h3');
            heading.textContent = t('recipeParameterGallery');
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
                grid.appendChild(card);
            }
            dialog.appendChild(grid);
            document.body.appendChild(dialog);
            
            dialog.addEventListener('close', () => dialog.remove());
            dialog.showModal();
        };
        heroSection.appendChild(galleryButton);
        wrapper.insertBefore(heroSection, intro);
    }

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
    owner.recipeView.querySelector('.anomalous-recipe-actionbar').style.display = 'none';
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
            const actionbar = owner.recipeView?.querySelector('.anomalous-recipe-actionbar');
            if (actionbar) actionbar.style.display = '';
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
        tabDefinitions.find(([key]) => key === active)?.[2]();
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
