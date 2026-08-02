import { app } from '../../../scripts/app.js';
import { i18n } from './locales.js';
import {
    deriveRecipeModelReferences,
    formatIdentitySize,
    normaliseIdentity,
    recipeReferenceKey,
    shortHash,
} from './recipe_identity.js';

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

function displayValue(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (error) { return String(value); }
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
    if (!value) return;
    try { await navigator.clipboard.writeText(String(value)); } catch (error) { console.warn('Could not copy recipe detail value:', error); }
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

function renderOverview(content, recipe, references, finish) {
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
    appendText(copy, 'p', recipe.notes || t('recipeDetailNoNotes'), 'anomalous-recipe-detail-muted');
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
    const positive = Array.isArray(params.promptPositive) ? params.promptPositive[0] : params.promptPositive;
    const values = [
        [t('recipeModel'), params.baseModel],
        [t('recipeDetailLoraSummary'), (params.loras || []).map((item) => item.name).join(', ')],
        [t('recipeSteps'), params.steps],
        ['CFG', params.cfg],
        [t('recipeDetailSampler'), params.sampler_name],
        [t('recipeDetailResolution'), params.resolution ? `${params.resolution.width} x ${params.resolution.height}` : ''],
        [t('recipePrompt'), compact(positive, 260)],
    ];
    for (const [label, value] of values) {
        const row = document.createElement('div');
        appendText(row, 'span', label, 'anomalous-recipe-detail-label');
        appendText(row, 'span', value || t('recipeDetailUnavailable'), 'anomalous-recipe-detail-value');
        summaryGrid.appendChild(row);
    }
    summary.appendChild(summaryGrid);
    overview.appendChild(summary);

    const actions = document.createElement('div');
    actions.className = 'anomalous-recipe-actions anomalous-recipe-detail-actions';
    const edit = button(actions, t('recipeEdit'), 'anomalous-btn-success');
    edit.onclick = () => finish('edit');
    const load = button(actions, t('recipeRestore'), 'anomalous-btn-primary');
    load.onclick = () => {
        app.loadGraphData(recipe.workflow);
        app.canvas?.setDirty?.(true, true);
    };
    const copyPrompt = button(actions, t('recipeDetailCopyPrompt'), 'anomalous-btn-primary');
    copyPrompt.onclick = () => copyText(positive);
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
        appendText(details, 'code', reference.saved_value || t('recipeDetailUnavailable'), 'anomalous-recipe-model-reference-value');
        const meta = document.createElement('div');
        meta.className = 'anomalous-recipe-model-reference-meta';
        const identity = normaliseIdentity(reference.identity);
        if (identity.sha256) {
            appendText(meta, 'span', `SHA256 ${shortHash(identity.sha256)}`);
            const copy = button(meta, t('recipeDetailCopyHash'), 'anomalous-recipe-copy-param');
            copy.onclick = () => copyText(identity.sha256);
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
            const widgets = (node.widgets || []).filter((widget) => {
                const haystack = `${node.title || ''} ${node.type || ''} ${widget.name || ''} ${displayValue(widget.value)}`.toLowerCase();
                return !query || haystack.includes(query);
            });
            if (!widgets.length) continue;
            const block = document.createElement('article');
            block.className = 'anomalous-recipe-detail-parameter-node';
            appendText(block, 'strong', node.title || node.type || t('recipeUnknownNode'));
            appendText(block, 'small', node.type || '', 'anomalous-recipe-detail-muted');
            for (const widget of widgets) {
                const row = document.createElement('div');
                row.className = 'anomalous-recipe-detail-parameter-row';
                appendText(row, 'span', widget.name || t('recipeDetailWidget'), 'anomalous-recipe-detail-label');
                appendText(row, 'code', compact(displayValue(widget.value), 320), 'anomalous-recipe-detail-value');
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
    appendText(current, 'code', shortHash(fingerprintText(recipe)) || t('recipeDetailNotIndexed'));
    timeline.appendChild(current);
    for (const version of history || []) {
        const row = document.createElement('article');
        row.className = 'anomalous-recipe-version-row';
        const copy = document.createElement('div');
        appendText(copy, 'strong', version.name || t('recipeUnknownVersion'));
        appendText(copy, 'span', dateText(version.timestamp));
        row.appendChild(copy);
        appendText(row, 'code', shortHash(version.workflow_fingerprint?.value) || t('recipeDetailNotIndexed'));
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
    const load = button(headerActions, t('recipeRestore'), 'anomalous-btn-primary');
    load.onclick = () => { app.loadGraphData(recipe.workflow); app.canvas?.setDirty?.(true, true); };
    header.appendChild(headerActions);
    view.appendChild(header);

    const tabs = document.createElement('div');
    tabs.className = 'anomalous-recipe-detail-tabs';
    const content = document.createElement('div');
    content.className = 'anomalous-recipe-detail-content';
    const tabDefinitions = [
        ['overview', t('recipeDetailOverview'), () => renderOverview(content, recipe, references, finish)],
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
