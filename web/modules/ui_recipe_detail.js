import { app } from '../../../scripts/app.js';
import { i18n } from './locales.js';
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

function missingRecipeNodeTypes(recipe) {
    const registry = globalThis.LiteGraph?.registered_node_types;
    if (!registry) return [];
    return [...new Set((recipe?.params?.nodes || [])
        .map((node) => node?.type)
        .filter((type) => type && !registry[type]))];
}

export async function openRecipeOnCanvas(owner, recipe) {
    const missingTypes = missingRecipeNodeTypes(recipe);
    const missingWarning = missingTypes.length
        ? `\n\n${t('recipeMissingNodes')}:\n${missingTypes.slice(0, 12).join('\n')}`
        : '';
    if ((canvasMayContainUserWork() || missingWarning) && !confirm(`${t('recipeOpenCanvasConfirm')}${missingWarning}`)) return false;
    try {
        await app.loadGraphData(recipe.workflow);
        app.canvas?.setDirty?.(true, true);
        closeRecipeWorkspace(owner);
        return true;
    } catch (error) {
        console.error('Could not open Workflow Recipe on canvas:', error);
        alert(t('recipeRestoreError'));
        return false;
    }
}

export function appendRecipeOnCanvas(owner, recipe) {
    try {
        appendRecipeToCanvas(recipe);
        closeRecipeWorkspace(owner);
        return true;
    } catch (error) {
        console.error('Could not append Workflow Recipe:', error);
        alert(error.code === 'recipe_append_missing_node'
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

function appendCopyButton(parent, value, label = t('recipeCopyParameter')) {
    const copy = button(parent, '⧉', 'anomalous-recipe-copy-param anomalous-recipe-detail-copy');
    copy.title = label;
    copy.setAttribute('aria-label', label);
    copy.onclick = async () => {
        const original = copy.textContent;
        copy.textContent = await copyText(value) ? '✓' : '!';
        setTimeout(() => { copy.textContent = original; }, 1200);
    };
    return copy;
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
    const badge = document.createElement('span');
    badge.className = `anomalous-recipe-identity-badge anomalous-recipe-identity-${identity.status}`;
    badge.textContent = t(`recipeIdentity${identity.status[0].toUpperCase()}${identity.status.slice(1)}`);
    return badge;
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

function previewIsVideo(url) {
    return /\.(?:mp4|webm)(?:$|\?|&|#)/i.test(url || '');
}

function recipeAssetUrl(owner, assetId) {
    if (!owner?.recipeDetailFilename || !assetId) return '';
    return `/anomalous/recipe_asset?filename=${encodeURIComponent(owner.recipeDetailFilename)}&asset=${encodeURIComponent(assetId)}`;
}

function appendModelPreview(parent, owner, reference) {
    const preview = document.createElement('div');
    preview.className = 'anomalous-recipe-model-preview';
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
    }
}

function missingNodeTypes(recipe) {
    const registry = globalThis.LiteGraph?.registered_node_types;
    if (!registry) return [];
    return [...new Set((recipe?.params?.nodes || [])
        .map((node) => node?.type)
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

function renderOverview(content, owner, recipe, references, finish) {
    const overview = document.createElement('div');
    overview.className = 'anomalous-recipe-detail-overview';
    const hero = document.createElement('div');
    hero.className = 'anomalous-recipe-detail-hero';
    if (typeof recipe.thumbnail === 'string') {
        const image = document.createElement('img');
        image.src = recipe.thumbnail;
        image.alt = recipe.name || t('recipeThumbnail');
        hero.appendChild(image);
    }
    const copy = document.createElement('div');
    copy.className = 'anomalous-recipe-detail-hero-copy';
    appendText(copy, 'h3', recipe.name || t('recipeUntitled'));
    const notes = document.createElement('div');
    notes.className = 'anomalous-recipe-detail-notes';
    appendText(notes, 'p', recipe.notes || t('recipeDetailNoNotes'), 'anomalous-recipe-detail-muted');
    if (recipe.notes) appendCopyButton(notes, recipe.notes);
    copy.appendChild(notes);
    const tags = document.createElement('div');
    tags.className = 'anomalous-recipe-tags';
    for (const tag of recipe.tags || []) appendText(tags, 'span', tag, 'anomalous-recipe-badge anomalous-recipe-badge-tag');
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
    renderStat(stats, t('recipeDetailFingerprint'), shortHash(fingerprintText(recipe)) || t('recipeDetailNotIndexed'));
    overview.appendChild(stats);

    const summary = document.createElement('section');
    summary.className = 'anomalous-recipe-detail-section';
    appendText(summary, 'h4', t('recipeDetailSummary'));
    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'anomalous-recipe-detail-summary-grid';
    const params = recipe.params || {};
    const values = [
        [t('recipeModel'), params.baseModel],
        [t('recipeDetailLoraSummary'), (params.loras || []).map((item) => item.name).join(', ')],
        [t('recipeSteps'), params.steps],
        ['CFG', params.cfg],
        [t('recipeDetailSampler'), params.sampler_name],
        [t('recipeDetailResolution'), params.resolution ? `${params.resolution.width} x ${params.resolution.height}` : ''],
    ];
    for (const [label, value] of values) {
        const row = document.createElement('div');
        appendText(row, 'span', label, 'anomalous-recipe-detail-label');
        appendText(row, 'span', value || t('recipeDetailUnavailable'), 'anomalous-recipe-detail-value');
        summaryGrid.appendChild(row);
    }
    summary.appendChild(summaryGrid);
    overview.appendChild(summary);
    const prompts = renderPromptSection(overview, recipe);

    const actions = document.createElement('div');
    actions.className = 'anomalous-recipe-actions anomalous-recipe-detail-actions';
    const edit = button(actions, t('recipeEdit'), 'anomalous-btn-success');
    edit.onclick = () => finish('edit');
    const load = button(actions, t('recipeOpenCanvas'), 'anomalous-btn-primary');
    load.onclick = () => { void openRecipeOnCanvas(owner, recipe); };
    const append = button(actions, t('recipeAppendCanvas'), 'anomalous-btn-primary');
    append.onclick = () => appendRecipeOnCanvas(owner, recipe);
    const copyPrompt = button(actions, t('recipeDetailCopyPrompt'), 'anomalous-btn-primary');
    const promptBundle = [
        prompts.positive.length ? `${t('recipeDetailPositivePrompt')}:\n${prompts.positive.join('\n\n')}` : '',
        prompts.negative.length ? `${t('recipeDetailNegativePrompt')}:\n${prompts.negative.join('\n\n')}` : '',
    ].filter(Boolean).join('\n\n');
    copyPrompt.disabled = !promptBundle;
    copyPrompt.onclick = () => copyText(promptBundle);
    const copyFingerprint = button(actions, t('recipeDetailCopyFingerprint'), 'anomalous-btn-primary');
    copyFingerprint.disabled = !fingerprintText(recipe);
    copyFingerprint.onclick = () => copyText(fingerprintText(recipe));
    overview.appendChild(actions);
    content.appendChild(overview);
}

function renderModels(content, owner, recipe, references) {
    const section = document.createElement('section');
    section.className = 'anomalous-recipe-detail-section';
    const heading = document.createElement('div');
    heading.className = 'anomalous-recipe-detail-section-heading';
    appendText(heading, 'h4', t('recipeDetailModels'));
    const refresh = button(heading, t('recipeDetailRefreshAvailability'), 'anomalous-btn-primary');
    const status = appendText(
        heading,
        'small',
        owner.recipeDetailPreviewState === 'loading' ? t('recipeDetailLoadingPreviews') : '',
        'anomalous-recipe-detail-muted',
    );
    refresh.onclick = async () => {
        refresh.disabled = true;
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
            content.replaceChildren();
            renderModels(content, owner, recipe, references);
        } catch (error) {
            console.error('Could not refresh recipe model availability:', error);
            status.textContent = t('recipeDetailRefreshError');
            refresh.disabled = false;
        }
    };
    section.appendChild(heading);
    if (!references.length) {
        appendText(section, 'p', t('recipeDetailNoModelReferences'), 'anomalous-recipe-detail-muted');
        content.appendChild(section);
        return;
    }
    const list = document.createElement('div');
    list.className = 'anomalous-recipe-model-reference-list';
    for (const reference of references) {
        const card = document.createElement('article');
        card.className = 'anomalous-recipe-model-reference';
        const body = document.createElement('div');
        body.className = 'anomalous-recipe-model-reference-body';
        appendModelPreview(body, owner, reference);
        const details = document.createElement('div');
        details.className = 'anomalous-recipe-model-reference-details';
        const top = document.createElement('div');
        top.className = 'anomalous-recipe-model-reference-top';
        appendText(top, 'strong', reference.node_title || reference.node_type || t('recipeUnknownNode'));
        appendText(top, 'span', reference.category || t('recipeDetailModel'), 'anomalous-recipe-detail-muted');
        top.appendChild(identityBadge(reference));
        details.appendChild(top);
        const referenceValue = document.createElement('div');
        referenceValue.className = 'anomalous-recipe-model-reference-value';
        appendValueViewer(referenceValue, reference.saved_value || t('recipeDetailUnavailable'));
        details.appendChild(referenceValue);
        const meta = document.createElement('div');
        meta.className = 'anomalous-recipe-model-reference-meta';
        const identity = normaliseIdentity(reference.identity);
        if (identity.sha256) {
            appendText(meta, 'span', `SHA256 ${shortHash(identity.sha256)}`);
            appendCopyButton(meta, identity.sha256, t('recipeDetailCopyHash'));
        }
        if (formatIdentitySize(identity.size)) appendText(meta, 'span', formatIdentitySize(identity.size));
        appendText(meta, 'span', reference.currentAvailability === 'available'
            ? t('recipeDetailAvailable')
            : reference.currentAvailability === 'missing' ? t('recipeDetailMissing') : t('recipeDetailAvailabilityNotChecked'));
        details.appendChild(meta);
        body.appendChild(details);
        card.appendChild(body);
        list.appendChild(card);
    }
    section.appendChild(list);
    content.appendChild(section);
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
        for (const node of recipe.params?.nodes || []) {
            const widgets = (node.widgets || []).map((widget) => ({
                widget,
                value: fullWidgetValue(recipe, node, widget),
            })).filter(({ widget, value }) => {
                const haystack = `${node.title || ''} ${node.type || ''} ${widget.name || ''} ${displayValue(value)}`.toLowerCase();
                return !query || haystack.includes(query);
            });
            if (!widgets.length) continue;
            const block = document.createElement('article');
            block.className = 'anomalous-recipe-detail-parameter-node';
            appendText(block, 'strong', node.title || node.type || t('recipeUnknownNode'));
            appendText(block, 'small', node.type || '', 'anomalous-recipe-detail-muted');
            for (const { widget, value } of widgets) {
                const row = document.createElement('div');
                row.className = 'anomalous-recipe-detail-parameter-row';
                appendText(row, 'span', widget.name || t('recipeDetailWidget'), 'anomalous-recipe-detail-label');
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
            if (!confirm(t('recipeRestoreVersionConfirm'))) return;
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
                alert(t('recipeUpdateError'));
            }
        };
        timeline.appendChild(row);
    }
    if (!(history || []).length) appendText(timeline, 'p', t('recipeHistoryEmpty'), 'anomalous-recipe-detail-muted');
    section.appendChild(timeline);
    content.appendChild(section);
}

export function showRecipeDetail(owner, { recipe, filename, history = [] }) {
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
    const result = new Promise((resolve) => { resolveAction = resolve; });
    const finish = (mode) => {
        view.remove();
        owner.recipeDetailView = null;
        owner.recipeListContainer.style.display = '';
        owner.recipeView.querySelector('.anomalous-recipe-actionbar').style.display = '';
        resolveAction({ mode });
    };

    const header = document.createElement('div');
    header.className = 'anomalous-recipe-detail-header';
    const back = button(header, t('recipeDetailBack'), 'anomalous-btn-primary');
    back.onclick = () => finish('back');
    appendText(header, 'h3', recipe.name || t('recipeUntitled'));
    const headerActions = document.createElement('div');
    const edit = button(headerActions, t('recipeEdit'), 'anomalous-btn-success');
    edit.onclick = () => finish('edit');
    const load = button(headerActions, t('recipeOpenCanvas'), 'anomalous-btn-primary');
    load.onclick = () => { void openRecipeOnCanvas(owner, recipe); };
    const append = button(headerActions, t('recipeAppendCanvas'), 'anomalous-btn-primary');
    append.onclick = () => appendRecipeOnCanvas(owner, recipe);
    header.appendChild(headerActions);
    view.appendChild(header);

    const tabs = document.createElement('div');
    tabs.className = 'anomalous-recipe-detail-tabs';
    const content = document.createElement('div');
    content.className = 'anomalous-recipe-detail-content';
    const tabDefinitions = [
        ['overview', t('recipeDetailOverview'), () => renderOverview(content, owner, recipe, references, finish)],
        ['models', t('recipeDetailModels'), () => renderModels(content, owner, recipe, references)],
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
        if (active !== 'models' || owner.recipeDetailPreviewState !== 'idle') return;
        owner.recipeDetailPreviewState = 'loading';
        void loadCurrentPreviews(owner, references)
            .catch((error) => console.warn('Could not load recipe model previews:', error))
            .finally(() => {
                owner.recipeDetailPreviewState = 'loaded';
                if (owner.recipeDetailView === view && owner.recipeDetailActiveTab === 'models') {
                    content.replaceChildren();
                    renderModels(content, owner, recipe, references);
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
    selectTab('overview');
    return result;
}
