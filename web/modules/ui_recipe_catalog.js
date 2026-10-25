/** The Workflows page (Workflow Recipe catalog): its bar (search, filter, view), the list, loading. Cards: ui_recipe_cards.js. */

import { translate } from './locales.js';
import { appendText } from './ui_recipe_detail_dom.js';
import { createRecipeCard } from './ui_recipe_cards.js';
import { openPopupMenu } from './ui_popup_menu.js';
import { moveWorkflowMaterials, workflowMaterialCount } from './recipe_save.js';
import { openShareDialog } from './ui_share.js';
import { fetchParameterSetSignatures, showParameterSetCount } from './ui_param_set_keys.js';

const t = (key, params) => translate(key, params);

/**
 * A strip offering to move the whole workflows kept as materials (before stars made recipes)
 * to the recipes; it shows only while there are some.
 */
function buildMoveStrip(owner) {
    const strip = document.createElement('div');
    strip.className = 'anomalous-recipe-move-strip';
    strip.hidden = true;
    const copy = appendText(strip, 'span', '');
    const move = appendText(strip, 'button', t('recipeMoveKeptButton'), 'anomalous-btn-primary');
    move.type = 'button';
    move.onclick = async () => {
        move.disabled = true;
        const moved = await moveWorkflowMaterials((done, total) => { move.textContent = `${done} / ${total}`; });
        copy.textContent = t('recipeMovedKept', { count: moved });
        move.remove();
        await owner.refreshRecipes();
    };
    workflowMaterialCount().then((count) => {
        copy.textContent = t('recipeMoveKept', { count });
        strip.hidden = !count;
    }).catch(() => {});
    return strip;
}

/** The page's tags, for the filter menu. */
function recipeTags(owner) {
    return [...new Set((owner.recipeRecords || []).flatMap(item => item?.data?.tags || []))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
}

/** The filter button says how many filters are on. */
export function updateRecipeFilterControls(owner) {
    const button = owner.recipeFilterButton;
    if (!button) return;
    const active = (owner.recipeScopeFilter && owner.recipeScopeFilter !== 'all' ? 1 : 0) + (owner.recipeSelectedTags?.size || 0);
    button.textContent = active ? t('workflowsFilterOn', { count: active }) : t('workflowsFilter');
    button.classList.toggle('is-active', Boolean(active));
}

/** The filter menu: what kind of workflow, then one tag. */
function openFilterMenu(owner, anchor) {
    const rerender = () => owner.renderRecipeList(owner.recipeRecords || []);
    const scope = owner.recipeScopeFilter || 'all';
    const tag = [...(owner.recipeSelectedTags || [])][0] || '';
    const items = [{ heading: t('workflowsFilterKind') }];
    for (const id of ['all', 'complete', 'partial']) {
        items.push({ label: t(`recipeScopePill_${id}`), checked: scope === id, run: () => { owner.recipeScopeFilter = id; rerender(); } });
    }
    const tags = recipeTags(owner);
    if (tags.length) {
        items.push({ heading: t('workflowsFilterTag') });
        items.push({ label: t('materialAllTags'), checked: !tag, run: () => { owner.recipeSelectedTags = new Set(); rerender(); } });
        for (const name of tags) {
            items.push({ label: `#${name}`, checked: tag === name, run: () => { owner.recipeSelectedTags = new Set([name]); rerender(); } });
        }
    }
    openPopupMenu(anchor, items);
}

/** The one row over the list: search, filter, count, view, share and import, save the canvas. */
function buildWorkflowBar(owner) {
    const bar = document.createElement('div');
    bar.className = 'anomalous-wf-bar';

    const search = document.createElement('label');
    search.className = 'anomalous-wf-search';
    search.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>'; // static markup only
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = t('recipeSearchPlaceholder');
    searchInput.value = owner.recipeSearchQuery || '';
    searchInput.oninput = () => {
        owner.recipeSearchQuery = searchInput.value;
        owner.renderRecipeList(owner.recipeRecords || []);
    };
    owner.recipeSearchInput = searchInput;
    search.append(searchInput);

    const filter = appendText(bar, 'button', '', 'anomalous-wf-filter');
    filter.type = 'button';
    filter.onclick = () => openFilterMenu(owner, filter);
    owner.recipeFilterButton = filter;
    bar.prepend(search);
    owner.recipeFilterSummary = appendText(bar, 'span', '0/0', 'anomalous-wf-count');

    owner.recipeViewMode = owner.recipeViewMode || 'grid';
    const view = appendText(bar, 'button', '', 'anomalous-wf-icon-btn');
    view.type = 'button';
    const showViewButton = () => {
        const list = owner.recipeViewMode === 'list';
        view.textContent = list ? '▦' : '☰';
        view.title = t(list ? 'recipeViewGrid' : 'recipeViewList');
        view.setAttribute('aria-label', view.title);
    };
    view.onclick = () => {
        owner.recipeViewMode = owner.recipeViewMode === 'list' ? 'grid' : 'list';
        owner.recipeListContainer?.classList.toggle('is-grid', owner.recipeViewMode === 'grid');
        owner.recipeListContainer?.classList.toggle('is-list', owner.recipeViewMode === 'list');
        showViewButton();
    };
    showViewButton();

    // Share and import (ui_share.js): share codes, workflow files, images, backups.
    const share = appendText(bar, 'button', '⇅', 'anomalous-wf-icon-btn');
    share.type = 'button';
    share.title = t('toolWorkflowTransferTitle');
    share.setAttribute('aria-label', share.title);
    share.onclick = () => openShareDialog(owner);

    const save = appendText(bar, 'button', `+ ${t('recipeSaveCurrent')}`, 'anomalous-wf-save');
    save.type = 'button';
    save.dataset.recipeSaveCurrent = 'true';
    save.onclick = () => owner.handleSaveRecipe();
    updateRecipeFilterControls(owner);
    return bar;
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

function renderRecipeEmptyGuide(owner) {
    const guide = appendText(owner.recipeListContainer, 'div', '', 'anomalous-recipe-empty-guide');
    appendText(guide, 'div', '⚡', 'anomalous-recipe-empty-icon');
    appendText(guide, 'h3', t('recipeEmptyGuideTitle'), 'anomalous-recipe-empty-title');
    appendText(guide, 'p', t('recipeEmptyGuideSubtitle'), 'anomalous-recipe-empty-subtitle');

    const steps = appendText(guide, 'div', '', 'anomalous-recipe-empty-steps');

    const step1 = appendText(steps, 'div', '', 'anomalous-recipe-empty-step');
    appendText(step1, 'div', '💾', 'anomalous-recipe-step-icon');
    appendText(step1, 'strong', t('recipeEmptyStep1Title'));
    appendText(step1, 'p', t('recipeEmptyStep1Desc'));

    const step2 = appendText(steps, 'div', '', 'anomalous-recipe-empty-step');
    appendText(step2, 'div', '🎯', 'anomalous-recipe-step-icon');
    appendText(step2, 'strong', t('recipeEmptyStep2Title'));
    appendText(step2, 'p', t('recipeEmptyStep2Desc'));

    const step3 = appendText(steps, 'div', '', 'anomalous-recipe-empty-step');
    appendText(step3, 'div', '🩺', 'anomalous-recipe-step-icon');
    appendText(step3, 'strong', t('recipeEmptyStep3Title'));
    appendText(step3, 'p', t('recipeEmptyStep3Desc'));

    const actionBtn = appendText(guide, 'button', '', 'anomalous-recipe-empty-action-btn');
    actionBtn.type = 'button';
    actionBtn.innerHTML = `<svg style="width:14px;height:14px;margin-right:6px;vertical-align:-2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span>${t('recipeEmptySaveCurrentBtn')}</span>`;
    actionBtn.onclick = () => owner.handleSaveRecipe?.();
}

export function renderRecipeList(recipes, services) {
    this.recipeListContainer.replaceChildren();
    updateRecipeFilterControls(this);
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
        if (this.recipeSearchQuery || (this.recipeSelectedTags && this.recipeSelectedTags.size > 0) || (this.recipeScopeFilter && this.recipeScopeFilter !== 'all')) {
            appendText(this.recipeListContainer, 'p', t('recipeNoMatches'), 'anomalous-recipe-empty');
        } else {
            renderRecipeEmptyGuide(this);
        }
        return;
    }
    if (!filtered.length) {
        appendText(this.recipeListContainer, 'p', t('recipeNoMatches'), 'anomalous-recipe-empty');
        return;
    }
    const setSignatures = fetchParameterSetSignatures();
    for (const recipe of filtered) {
        try {
            const card = createRecipeCard(this, recipe, services);
            showParameterSetCount(this, card, recipe, setSignatures);
            this.recipeListContainer.appendChild(card);
        } catch (cardError) {
            console.error('Could not render Workflow Recipe card:', recipe?.filename, cardError);
            const notice = appendText(this.recipeListContainer, 'p', `${recipe?.data?.name || t('recipeUntitled')} — ${t('recipeLoadError')}`, 'anomalous-recipe-empty');
            notice.setAttribute('role', 'alert');
        }
    }
}


export async function showRecipes() {
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

    if (this.recipeDetailView) {
        this.recipeDetailView.remove();
        this.recipeDetailView = null;
        if (this.recipeListContainer) this.recipeListContainer.style.display = '';
        const bar = this.recipeView?.querySelector('.anomalous-wf-bar');
        if (bar) bar.style.display = '';
    }
    if (this.recipeView) {
        this.recipeView.style.display = 'flex';
        if (!this.recipeDetailView) {
            if (this.recipeListContainer) this.recipeListContainer.style.display = '';
            const bar = this.recipeView?.querySelector('.anomalous-wf-bar');
            if (bar) bar.style.display = '';
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
    this.recipeView.appendChild(buildWorkflowBar(this));
    this.recipeView.appendChild(buildMoveStrip(this));

    this.recipeListContainer = document.createElement('div');
    this.recipeListContainer.className = `anomalous-wf-list ${this.recipeViewMode === 'list' ? 'is-list' : 'is-grid'}`;
    this.recipeView.appendChild(this.recipeListContainer);
    this.recipeContainer.appendChild(this.recipeView);
    await this.refreshRecipes();
}

export async function resolveCatalogRecipeReadiness(owner, recipes) {
    if (!owner || !Array.isArray(recipes) || !recipes.length) return;
    const refMap = new Map();
    for (const item of recipes) {
        const refs = item?.data?.params?.model_references;
        if (!Array.isArray(refs)) continue;
        for (const ref of refs) {
            if (ref?.currentAvailability) continue;
            const val = ref?.saved_value;
            if (typeof val === 'string' && val.trim()) {
                const key = `${ref.node_id}:${ref.widget_index}:${val}`;
                if (!refMap.has(key)) {
                    refMap.set(key, {
                        node_id: ref.node_id,
                        widget_index: ref.widget_index,
                        saved_value: val,
                        category: ref.category,
                    });
                }
            }
        }
    }
    if (!refMap.size) return;
    try {
        const references = [...refMap.values()].slice(0, 128);
        const response = await fetch('/anomalous/refresh_recipe_identity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ references }),
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (payload.status !== 'success' || !Array.isArray(payload.results)) return;
        const resultMap = new Map(payload.results.map((r) => [
            `${r.node_id}:${r.widget_index}:${r.saved_value}`,
            r.availability,
        ]));
        let updated = false;
        for (const item of recipes) {
            const refs = item?.data?.params?.model_references;
            if (!Array.isArray(refs)) continue;
            for (const ref of refs) {
                const key = `${ref.node_id}:${ref.widget_index}:${ref.saved_value}`;
                const avail = resultMap.get(key);
                if (avail && ref.currentAvailability !== avail) {
                    ref.currentAvailability = avail;
                    updated = true;
                }
            }
        }
        if (updated && owner.recipeListContainer && !owner.recipeDetailView) {
            owner.renderRecipeList(owner.recipeRecords || []);
        }
    } catch (err) {
        console.warn('Could not pre-resolve recipe readiness:', err);
    }
}

export async function refreshRecipes() {
    if (!this.recipeListContainer) return;
    try {
        const response = await fetch('/anomalous/recipes');
        if (!response.ok) throw new Error('recipe list request failed');
        const payload = await response.json();
        this.recipeRecords = payload.recipes || [];
        updateRecipeFilterControls(this);
    } catch (error) {
        console.error('Could not load Workflow Recipes from server:', error);
        this.recipeListContainer.replaceChildren();
        appendText(this.recipeListContainer, 'p', t('recipeLoadError'), 'anomalous-recipe-empty');
        return;
    }
    this.renderRecipeList(this.recipeRecords);
    void resolveCatalogRecipeReadiness(this, this.recipeRecords);
}
