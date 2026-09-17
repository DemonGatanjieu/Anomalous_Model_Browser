/** Workflow Recipe catalog shell: navigation, filters, view mode, and loading. */

import { translate } from './locales.js';
import { appendText } from './ui_recipe_detail_dom.js';
import { app } from '../../../scripts/app.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { bindMaterialDrag } from './material_drag.js';
import { applyRecipeToCanvas, showRecipeDetail } from './ui_recipe_detail.js';
import {
    appendRecipeCover,
    outputImageUrl,
    previewIsVideo,
    recipeAssetUrl,
    safeThumbnail,
} from './ui_recipe_media.js';

const t = (key, params) => translate(key, params);

export function updateRecipeFilterControls(owner, recipes) {
    if (!owner.recipeTagSelect) return;
    const tags = [...new Set((recipes || []).flatMap(item => item?.data?.tags || []))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    const selected = [...(owner.recipeSelectedTags || [])][0] || '';
    owner.recipeSelectedTags = new Set(selected ? [selected] : []);
    owner.recipeTagSelect.replaceChildren();
    appendText(owner.recipeTagSelect, 'option', t('materialAllTags')).value = '';
    if (selected && !tags.includes(selected)) tags.push(selected);
    for (const tag of tags) appendText(owner.recipeTagSelect, 'option', tag).value = tag;
    owner.recipeTagSelect.value = selected;
}

function buildRecipeStudioTopbar(owner) {
    const topbar = document.createElement('div');
    topbar.className = 'anomalous-recipe-topbar';

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
    for (const { id, label } of scopes) {
        const scopeButton = appendText(pillsWrap, 'button', label, 'anomalous-recipe-pill');
        scopeButton.type = 'button';
        if (owner.recipeScopeFilter === id) scopeButton.classList.add('is-active');
        scopeButton.onclick = () => {
            if (owner.recipeScopeFilter === id) return;
            owner.recipeScopeFilter = id;
            pillsWrap.querySelectorAll('.anomalous-recipe-pill').forEach(element => element.classList.remove('is-active'));
            scopeButton.classList.add('is-active');
            owner.renderRecipeList(owner.recipeRecords || []);
        };
    }
    left.appendChild(pillsWrap);
    topbar.appendChild(left);

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
        owner.recipeSelectedTags = new Set(tagSelect.value ? [tagSelect.value] : []);
        owner.renderRecipeList(owner.recipeRecords || []);
    };
    owner.recipeTagSelect = tagSelect;
    center.appendChild(tagSelect);
    owner.recipeFilterSummary = appendText(center, 'small', '0/0', 'anomalous-recipe-filter-summary');
    topbar.appendChild(center);

    const right = document.createElement('div');
    right.className = 'anomalous-recipe-topbar-right';
    const viewSwitch = document.createElement('div');
    viewSwitch.className = 'anomalous-recipe-view-switch';
    owner.recipeViewMode = owner.recipeViewMode || 'grid';
    const gridButton = document.createElement('button');
    gridButton.type = 'button';
    gridButton.className = 'anomalous-recipe-view-btn' + (owner.recipeViewMode === 'grid' ? ' is-active' : '');
    gridButton.title = t('recipeViewGrid');
    gridButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h7v7H3V3zm11 0h7v7h-7V3zm-11 11h7v7H3v-7zm11 0h7v7h-7v-7z"/></svg>';
    const listButton = document.createElement('button');
    listButton.type = 'button';
    listButton.className = 'anomalous-recipe-view-btn' + (owner.recipeViewMode === 'list' ? ' is-active' : '');
    listButton.title = t('recipeViewList');
    listButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4h18v3H3V4zm0 7h18v3H3v-3zm0 7h18v3H3v-3z"/></svg>';
    const setViewMode = mode => {
        if (owner.recipeViewMode === mode) return;
        owner.recipeViewMode = mode;
        gridButton.classList.toggle('is-active', mode === 'grid');
        listButton.classList.toggle('is-active', mode === 'list');
        owner.recipeListContainer?.classList.toggle('is-grid', mode === 'grid');
        owner.recipeListContainer?.classList.toggle('is-list', mode === 'list');
    };
    gridButton.onclick = () => setViewMode('grid');
    listButton.onclick = () => setViewMode('list');
    viewSwitch.append(gridButton, listButton);
    right.appendChild(viewSwitch);

    const importButton = appendText(right, 'button', '⇧', 'anomalous-recipe-topbar-btn anomalous-tooltip-target');
    importButton.type = 'button';
    importButton.disabled = true;
    importButton.setAttribute('data-tooltip', t('recipeImportUnavailable'));
    importButton.setAttribute('aria-label', t('recipeImportUnavailable'));

    const saveButton = appendText(right, 'button', '', 'anomalous-recipe-topbar-btn is-primary');
    saveButton.dataset.recipeSaveCurrent = 'true';
    saveButton.type = 'button';
    saveButton.innerHTML = `<svg style="width:14px;height:14px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>${t('recipeSaveCurrent')}`;
    saveButton.onclick = () => owner.handleSaveRecipe();
    const closeButton = appendText(right, 'button', '✕', 'anomalous-recipe-topbar-btn anomalous-recipe-topbar-close');
    closeButton.type = 'button';
    closeButton.title = t('workspaceClose') || (window.anomalous_browser_lang === 'zh' ? '关闭' : 'Close');
    closeButton.onclick = () => owner.closeWorkspace();
    topbar.appendChild(right);
    return topbar;
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

export function recipeMatchesFilter(data, query, selectedTags, scope = 'all') {
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
        const loraTag = appendText(strip, 'span', '', 'anomalous-recipe-spec-tag is-lora');
        loraTag.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>${loras.length} ${t('recipeCardSpecsLoras')}`;
        loraTag.title = loras.map((l) => (typeof l === 'object' && l?.name ? l.name : String(l))).join(', ');
    }

    if (params.steps) {
        const samplerName = params.sampler_name ? ` · ${params.sampler_name}` : '';
        const stepTag = appendText(strip, 'span', '', 'anomalous-recipe-spec-tag is-step');
        stepTag.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${params.steps} ${t('recipeCardSpecsSteps')}${samplerName}`;
        stepTag.title = `${params.steps} ${t('recipeCardSpecsSteps')}${samplerName}`;
    }

    const formattedRes = formatRecipeResolution(params.resolution);
    if (formattedRes) {
        const resTag = appendText(strip, 'span', '', 'anomalous-recipe-spec-tag');
        resTag.innerHTML = `<svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>${formattedRes}`;
        resTag.title = `${t('recipeCardSpecsResolution')}: ${formattedRes}`;
    }

    return strip.childElementCount ? strip : null;
}

export function getRecipeReadiness(recipeData) {
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

function createRecipeCard(owner, recipe, services) {
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
        const pill = document.createElement('span');
        pill.className = 'anomalous-recipe-cover-pill';
        pill.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:-1px;margin-right:4px;"><path d="m21 16-9 5-9-5V8l9-5 9 5v8z"/><path d="m3.27 6.96 8.73 4.84 8.73-4.84"/><path d="M12 22.08V11.8"/></svg>';
        appendText(pill, 'span', modelDisplayName(baseModelStr));
        pill.title = String(baseModelStr);
        bottomChips.appendChild(pill);
    }
    mediaWrap.appendChild(bottomChips);

    // Scope Pill (Top-right of cover)
    const isPartial = data.workflow_scope === 'partial';
    const scopePill = document.createElement('span');
    scopePill.className = `anomalous-recipe-scope-pill ${isPartial ? 'is-partial' : 'is-complete'}`;
    const scopeSvg = isPartial
        ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:-1px;margin-right:3px;"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v6"/><path d="M9 6h6"/></svg>`
        : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:-1px;margin-right:3px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
    scopePill.innerHTML = `${scopeSvg}<span>${t(isPartial ? 'recipeScopePill_partial' : 'recipeScopePill_complete')}</span>`;
    mediaWrap.appendChild(scopePill);
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

    // Footer: Primary Action Button + Mini Actions
    const footer = document.createElement('div');
    footer.className = 'anomalous-recipe-card-footer';

    const appendBtn = document.createElement('button');
    appendBtn.type = 'button';
    appendBtn.className = 'anomalous-recipe-btn-primary-action anomalous-tooltip-target';
    const actionSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:inline-block;vertical-align:-1px;margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    appendBtn.innerHTML = `${actionSvg}<span>${t(isPartial ? 'recipeAppendCanvas' : 'recipeOpenCanvas')}</span>`;
    appendBtn.removeAttribute('title');
    appendBtn.setAttribute('data-tooltip', isPartial ? t('recipeAppendCanvas') : t('recipeOpenCanvas'));
    appendBtn.setAttribute('data-tooltip-pos', 'top');
    appendBtn.onclick = (e) => {
        e.stopPropagation();
        runRecipeCardAction(appendBtn, async () => {
            const graph = app.graph;
            const fullRecipe = await services.fetchRecipeData(recipe.filename);
            if (app.graph !== graph) throw new Error('materialTargetChanged');
            await applyRecipeToCanvas(owner, fullRecipe);
        }, isPartial ? 'recipeAppendError' : 'recipeOpenError');
    };
    footer.appendChild(appendBtn);

    const miniActions = document.createElement('div');
    miniActions.className = 'anomalous-recipe-card-mini-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'anomalous-recipe-card-mini-btn anomalous-tooltip-target';
    editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
    editBtn.removeAttribute('title');
    editBtn.setAttribute('data-tooltip', t('recipeEdit'));
    editBtn.setAttribute('data-tooltip-pos', 'top');
    editBtn.onclick = (e) => {
        e.stopPropagation();
        runRecipeCardAction(editBtn, () => services.editRecipe(owner, recipe?.data || {}, recipe.filename), 'recipeUpdateError');
    };

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'anomalous-recipe-card-mini-btn anomalous-tooltip-target';
    exportBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    exportBtn.removeAttribute('title');
    exportBtn.setAttribute('data-tooltip', t('recipeExportUnavailable'));
    exportBtn.setAttribute('aria-label', t('recipeExportUnavailable'));
    exportBtn.disabled = true;
    exportBtn.setAttribute('data-tooltip-pos', 'top');

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'anomalous-recipe-card-mini-btn is-delete anomalous-tooltip-target';
    removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;
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
        const bundle = await services.fetchRecipeBundle(recipe.filename);
        const result = await showRecipeDetail(owner, {
            recipe: bundle.data,
            filename: recipe.filename,
            history: bundle.history,
        });
        if (result?.mode === 'edit') await services.editRecipe(owner, bundle.data, recipe.filename, bundle.history);
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
            const fullRecipe = await services.fetchRecipeData(dragData.filename);
            if (app.graph !== graph) throw new Error('materialTargetChanged');
            await applyRecipeToCanvas(owner, fullRecipe);
        },
    });

    return card;
}

export function renderRecipeList(recipes, services) {
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
            this.recipeListContainer.appendChild(createRecipeCard(this, recipe, services));
        } catch (cardError) {
            console.error('Could not render Workflow Recipe card:', recipe?.filename, cardError);
            const notice = appendText(this.recipeListContainer, 'p', `${recipe?.data?.name || t('recipeUntitled')} — ${t('recipeLoadError')}`, 'anomalous-recipe-empty');
            notice.setAttribute('role', 'alert');
        }
    }
}


export async function showRecipes() {
    if (this.materialContainer) this.materialContainer.style.display = 'none';
    if (this.notebookContainer) this.notebookContainer.style.display = 'none';
    if (this.nbPanel) this.nbPanel.style.display = 'flex';

    if (!this.recipeContainer) {
        this.recipeContainer = document.createElement('div');
        this.recipeContainer.className = 'anomalous-nb-container anomalous-recipe-container';
        this.nbPanel.appendChild(this.recipeContainer);
    }
    this.recipeContainer.style.display = 'flex';
    if (typeof this.recipeModelReturn === 'function') {
        const returnToRecipe = this.recipeModelReturn;
        this.recipeModelReturn = null;
        returnToRecipe();
        return;
    }
    this.recipeDetailFinish?.('closed');
    if (this.notebookBody) this.notebookBody.style.display = 'none';
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
    this.recipeView.appendChild(buildRecipeStudioTopbar(this));
    this.recipeListContainer = document.createElement('div');
    this.recipeListContainer.className = `anomalous-recipe-list ${this.recipeViewMode === 'list' ? 'is-list' : 'is-grid'}`;
    this.recipeView.appendChild(this.recipeListContainer);
    this.recipeContainer.appendChild(this.recipeView);
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
