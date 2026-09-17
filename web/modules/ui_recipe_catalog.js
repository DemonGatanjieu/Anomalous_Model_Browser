/** Workflow Recipe catalog shell: navigation, filters, view mode, and loading. */

import { translate } from './locales.js';
import { appendText } from './ui_recipe_detail_dom.js';
import { createRecipeCard } from './ui_recipe_cards.js';

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
