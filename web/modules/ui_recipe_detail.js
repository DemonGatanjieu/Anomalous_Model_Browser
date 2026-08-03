import { app } from '../../../scripts/app.js';
import {  i18n  } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import {
    deriveRecipeModelReferences,
    formatIdentitySize,
    normaliseIdentity,
    recipeReferenceKey,
    shortHash,
} from './recipe_identity.js';
import { buildRecipeDiff, diffIsEmpty } from './recipe_diff.js';
import { appendRecipeToCanvas } from './recipe_actions.js';

const t = (key) => {
    let lang = window.anomalous_browser_lang || 'zh';
    if (lang.startsWith('en')) lang = 'en';
    return i18n[lang]?.[key] || i18n.en?.[key] || key;
};

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

function canvasMayContainUserWork() {
    if (!app.graph?._nodes?.length) return false;
    if (app.canvas?.dirty_canvas === false || app.graph?.dirty === false) return false;
    return true;
}

function closeRecipeWorkspace(owner) {
    owner?.nbPanel && (owner.nbPanel.style.display = 'none');
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

function missingRecipeNodeTypes(recipe) {
    const registry = globalThis.LiteGraph?.registered_node_types;
    if (!registry) return [];
    return [...new Set((recipe?.workflow?.nodes || [])
        .map((node) => node?.type || node?.class_type)
        .filter((type) => type && !registry[type]))];
}

export async function openRecipeOnCanvas(owner, recipe) {
    const missingTypes = missingRecipeNodeTypes(recipe);
    const missingWarning = missingTypes.length
        ? `\n\n${t('recipeMissingNodes')}:\n${missingTypes.slice(0, 12).join('\n')}`
        : '';
    if ((canvasMayContainUserWork() || missingWarning) && !await anomalousConfirm(`${t('recipeOpenCanvasConfirm')}${missingWarning}`)) return false;
    try {
        await app.loadGraphData(recipe.workflow);
        app.canvas?.setDirty?.(true, true);
        closeRecipeWorkspace(owner);
        return true;
    } catch (error) {
        console.error('Could not open Workflow Recipe on canvas:', error);
        await anomalousAlert(t('recipeRestoreError'));
        return false;
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

function appendValueViewer(parent, value, className = '') {
    const text = displayValue(value);
    const viewer = document.createElement('div');
    viewer.className = `anomalous-recipe-detail-value-viewer${className ? ` ${className}` : ''}`;
    const code = appendText(viewer, 'code', text, 'anomalous-recipe-detail-full-value');
    if (needsExpansion(text)) {
        code.classList.add('is-collapsed');
        const toggle = button(viewer, t('recipeDetailExpandValue'), 'anomalous-recipe-detail-value-toggle');
        toggle.onclick = () => {
            const expanded = code.classList.toggle('is-collapsed') === false;
            toggle.textContent = expanded ? t('recipeDetailCollapseValue') : t('recipeDetailExpandValue');
        };
    }
    appendCopyButton(viewer, text);
    parent.appendChild(viewer);
    return viewer;
}

function promptValues(recipe) {
    const params = recipe?.params || {};
    const positive = [...new Set((Array.isArray(params?.promptPositive) ? params.promptPositive : [params?.promptPositive])
        .filter((value) => typeof value === 'string' && value.trim()))];
    const negative = [...new Set((Array.isArray(params?.promptNegative) ? params.promptNegative : [params?.promptNegative])
        .filter((value) => typeof value === 'string' && value.trim()))];
    for (const node of params?.nodes || []) {
        if (!/cliptextencode/i.test(String(node?.type || ''))) continue;
        const widget = (node.widgets || []).find((candidate) => /^(text|prompt)$/i.test(String(candidate?.name || '')));
        const text = widget ? fullWidgetValue(recipe, node, widget) : null;
        if (typeof text !== 'string' || !text.trim()) continue;
        const descriptor = `${node?.title || ''} ${node?.type || ''}`;
        if (/(negative|neg|负面|反向)/i.test(descriptor)) {
            if (!negative.includes(text)) negative.push(text);
        } else if (!positive.length && !positive.includes(text)) {
            positive.push(text);
        }
    }
    return { positive, negative };
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
        'checkpoints', 'unet', 'diffusion_models', 'loras', 'vae', 'controlnet',
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

function appendRecipeCover(parent, recipe) {
    const sourceUrl = outputImageUrl(recipe?.source_image);
    const url = previewIsVideo(sourceUrl) ? sourceUrl : recipe?.thumbnail || sourceUrl;
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
    owner.showDetail(model);
    owner.nbPanel && (owner.nbPanel.style.display = 'none');
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

function renderPromptSection(parent, recipe) {
    const prompts = promptValues(recipe);
    const section = document.createElement('section');
    section.className = 'anomalous-recipe-detail-section anomalous-recipe-detail-prompts';
    appendText(section, 'h4', t('recipeDetailPrompts'));
    const entries = [
        ...prompts.positive.map((value, index) => ({ label: `${t('recipeDetailPositivePrompt')}${prompts.positive.length > 1 ? ` ${index + 1}` : ''}`, value, kind: 'positive' })),
        ...prompts.negative.map((value, index) => ({ label: `${t('recipeDetailNegativePrompt')}${prompts.negative.length > 1 ? ` ${index + 1}` : ''}`, value, kind: 'negative' })),
    ];
    if (!entries.length) {
        appendText(section, 'p', t('recipeDetailNoPrompts'), 'anomalous-recipe-detail-muted');
        parent.appendChild(section);
        return prompts;
    }
    const list = document.createElement('div');
    list.className = 'anomalous-recipe-detail-prompt-list';
    for (const entry of entries) {
        const row = document.createElement('article');
        row.className = `anomalous-recipe-detail-prompt anomalous-recipe-detail-prompt-${entry.kind}`;
        appendText(row, 'strong', entry.label, 'anomalous-recipe-detail-prompt-label');
        appendValueViewer(row, entry.value);
        list.appendChild(row);
    }
    section.appendChild(list);
    parent.appendChild(section);
    return prompts;
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
    appendRecipeCover(hero, recipe);
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
    const prompts = renderPromptSection(overview, recipe);

    const actions = document.createElement('div');
    actions.className = 'anomalous-recipe-actions anomalous-recipe-detail-actions';
    const edit = button(actions, t('recipeEdit'), 'anomalous-btn-success');
    edit.onclick = () => finish('edit');
    const load = button(actions, t('recipeOpenCanvas'), 'anomalous-btn-primary');
    load.onclick = () => {
        void runRecipeAction(load, async () => {
            if (await openRecipeOnCanvas(owner, recipe)) finish('canvas');
        });
    };
    const append = button(actions, t('recipeAppendCanvas'), 'anomalous-btn-primary');
    append.onclick = () => {
        void runRecipeAction(append, async () => {
            if (await appendRecipeOnCanvas(owner, recipe)) finish('append');
        });
    };
    const copyPrompt = button(actions, t('recipeDetailCopyPrompt'), 'anomalous-btn-primary');
    const promptBundle = [
        prompts.positive.length ? `${t('recipeDetailPositivePrompt')}:\n${prompts.positive.join('\n\n')}` : '',
        prompts.negative.length ? `${t('recipeDetailNegativePrompt')}:\n${prompts.negative.join('\n\n')}` : '',
    ].filter(Boolean).join('\n\n');
    copyPrompt.disabled = !promptBundle;
    copyPrompt.onclick = () => { void copyTextWithFeedback(copyPrompt, promptBundle); };
    overview.appendChild(actions);
    content.appendChild(overview);
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

function parameterNodesWithPromptFallback(recipe) {
    const nodes = (recipe?.params?.nodes || []).map((node) => ({
        ...node,
        widgets: [...(node.widgets || [])],
    }));
    const byId = new Map(nodes.map((node) => [String(node.id), node]));
    for (const workflowNode of recipe?.workflow?.nodes || []) {
        if (!/cliptextencode/i.test(String(workflowNode?.type || ''))) continue;
        const id = String(workflowNode?.id ?? '');
        if (!id) continue;
        const hasSavedWidget = Array.isArray(workflowNode.widgets_values)
            && workflowNode.widgets_values.length > 0;
        if (!hasSavedWidget) continue;
        const promptWidget = {
            name: 'text',
            value: workflowNode.widgets_values[0],
            index: 0,
        };
        const summary = byId.get(id);
        if (summary) {
            if (!summary.widgets.some((widget) => /^(text|prompt)$/i.test(String(widget?.name || '')))) {
                summary.widgets.push(promptWidget);
            }
            continue;
        }
        const fallback = {
            id: workflowNode.id ?? null,
            type: workflowNode.type || 'CLIPTextEncode',
            title: workflowNode.title || null,
            widgets: [promptWidget],
            widgetCount: 1,
        };
        nodes.push(fallback);
        byId.set(id, fallback);
    }
    const ordered = [];
    const added = new Set();
    const workflowNodes = recipe?.workflow?.nodes || [];
    const workflowLinks = recipe?.workflow?.links || [];
    const topoIds = topologicalSortNodes(workflowNodes, workflowLinks);
    
    for (const id of topoIds) {
        const node = byId.get(id);
        if (!node || added.has(node)) continue;
        added.add(node);
        ordered.push(node);
    }
    for (const node of nodes) {
        if (added.has(node)) continue;
        added.add(node);
        ordered.push(node);
    }
    return ordered;
}

function getNativeNodeTranslation(nodeType, originalTitle, hasCustomTitle) {
    if (hasCustomTitle && originalTitle) return originalTitle;
    if (window.LiteGraph && LiteGraph.registered_node_types && LiteGraph.registered_node_types[nodeType]) {
        const title = LiteGraph.registered_node_types[nodeType].title;
        if (title) return title;
    }
    return originalTitle || nodeType;
}

function getNativeWidgetTranslation(nodeType, widgetName) {
    if (window.LiteGraph && LiteGraph.registered_node_types && LiteGraph.registered_node_types[nodeType]) {
        try {
            const dummy = LiteGraph.createNode(nodeType);
            if (dummy && dummy.widgets) {
                const w = dummy.widgets.find((w) => w.name === widgetName);
                if (w && w.label) return w.label;
            }
        } catch (e) {
            // Ignore error if node fails to instantiate without canvas
        }
    }
    return widgetName;
}

function renderParameters(content, recipe) {
    const section = document.createElement('section');
    section.className = 'anomalous-recipe-detail-section';
    const heading = document.createElement('div');
    heading.className = 'anomalous-recipe-detail-section-heading';
    appendText(heading, 'h4', t('recipeDetailParameters'));
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = t('recipeDetailSearchParameters');
    search.className = 'anomalous-recipe-detail-search';
    heading.appendChild(search);
    section.appendChild(heading);
    const list = document.createElement('div');
    list.className = 'anomalous-recipe-detail-parameter-list';
    const render = () => {
        list.replaceChildren();
        const query = search.value.trim().toLowerCase();
        for (const node of parameterNodesWithPromptFallback(recipe)) {
            const widgets = (node.widgets || []).map((widget) => ({
                widget,
                value: fullWidgetValue(recipe, node, widget),
            })).filter(({ widget, value }) => {
                const haystack = `${node.title || ''} ${node.type || ''} ${widget.name || ''} ${displayValue(value)}`.toLowerCase();
                return !query || haystack.includes(query);
            });
            if (!widgets.length) continue;
            const hasCustomTitle = !!node.title;
            const displayTitle = getNativeNodeTranslation(node.type, node.title, hasCustomTitle);
            
            const block = document.createElement('article');
            block.className = 'anomalous-recipe-detail-parameter-node';
            appendText(block, 'strong', displayTitle || t('recipeUnknownNode'));
            appendText(block, 'small', node.type || '', 'anomalous-recipe-detail-muted');
            for (const { widget, value } of widgets) {
                const row = document.createElement('div');
                row.className = 'anomalous-recipe-detail-parameter-widget';
                const displayWidgetName = getNativeWidgetTranslation(node.type, widget.name) || t('recipeUnknownWidget');
                appendText(row, 'span', displayWidgetName, 'anomalous-recipe-detail-parameter-name');
                appendValueViewer(row, value);
                block.appendChild(row);
            }
            list.appendChild(block);
        }
        if (!list.children.length) appendText(list, 'p', t('recipeDetailNoParameters'), 'anomalous-recipe-detail-muted');
    };
    search.oninput = render;
    render();
    section.appendChild(list);
    content.appendChild(section);
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

    const header = document.createElement('div');
    header.className = 'anomalous-recipe-detail-header';
    const back = button(header, t('recipeDetailBack'), 'anomalous-btn-primary');
    back.onclick = () => finish('back');
    appendText(header, 'h3', recipe.name || t('recipeUntitled'));
    const headerActions = document.createElement('div');
    headerActions.className = 'anomalous-recipe-actions-primary';
    const refreshOrigin = button(headerActions, '🌍 ' + t('recipeDetailRefreshOrigin'), 'anomalous-btn-ghost');
    refreshOrigin.title = t('recipeDetailRefreshOriginDesc');
    refreshOrigin.onclick = async () => {
        refreshOrigin.disabled = true;
        refreshOrigin.textContent = '...';
        try {
            const response = await fetch('/anomalous/update_recipe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, refreshIdentities: true }),
            });
            if (!response.ok) throw new Error('refresh failed');
            const data = await response.json();
            if (data.status === 'success') {
                if (owner.refreshRecipes) await owner.refreshRecipes();
                finish('refresh');
            }
        } catch (error) {
            console.error('Could not refresh identities:', error);
        }
    };
    
    const load = button(headerActions, t('recipeOpenCanvas'), 'anomalous-btn-primary');
    load.onclick = () => {
        void runRecipeAction(load, async () => {
            if (await openRecipeOnCanvas(owner, recipe)) finish('canvas');
        });
    };
    const append = button(headerActions, t('recipeAppendCanvas'), 'anomalous-btn-ghost');
    append.onclick = () => {
        void runRecipeAction(append, async () => {
            if (await appendRecipeOnCanvas(owner, recipe)) finish('append');
        });
    };
    
    const secondaryActions = document.createElement('div');
    secondaryActions.className = 'anomalous-recipe-actions-secondary';
    const edit = button(secondaryActions, '✏️', 'anomalous-btn-icon anomalous-btn-edit');
    edit.title = t('recipeEdit');
    edit.onclick = () => finish('edit');
    headerActions.appendChild(secondaryActions);
    header.appendChild(headerActions);
    view.appendChild(header);

    const tabs = document.createElement('div');
    tabs.className = 'anomalous-recipe-detail-tabs';
    const content = document.createElement('div');
    content.className = 'anomalous-recipe-detail-content';
    const tabDefinitions = [
        ['overview', t('recipeDetailOverview'), () => {
            renderOverview(content, owner, recipe, references, finish);
        }],
        ['parameters', t('recipeDetailParameters'), () => renderParameters(content, recipe)],
        ['versions', t('recipeDetailVersions'), () => renderVersions(content, owner, recipe, history, finish)],
    ];
    const selectTab = (active) => {
        owner.recipeDetailActiveTab = active;
        content.replaceChildren();
        for (const [key, label, render] of tabDefinitions) {
            const tab = tabs.querySelector(`[data-tab="${key}"]`);
            tab?.classList.toggle('active', key === active);
        }
        tabDefinitions.find(([key]) => key === active)?.[2]();
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
    for (const [key, label] of tabDefinitions) {
        const tab = button(tabs, label, 'anomalous-recipe-detail-tab');
        tab.dataset.tab = key;
        tab.onclick = () => selectTab(key);
    }
    view.append(tabs, content);
    owner.recipeView.appendChild(view);
    selectTab(returnState?.activeTab || 'overview');
    if (returnState?.scrollTop) {
        requestAnimationFrame(() => {
            view.scrollTop = returnState.scrollTop;
            content.scrollTop = returnState.scrollTop;
        });
    }
    return result;
}
