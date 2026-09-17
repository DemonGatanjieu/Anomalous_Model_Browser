/** Curated image/workflow and Recipe parameter materials. */

import { app } from '../../../scripts/app.js';
import { selectedMaterialNode } from './node_material_actions.js';
import { translate, resolveLocale } from './locales.js';
import { showImageWorkbench } from './ui_gallery_detail.js';
import { text, jsonResponse } from './ui_dom.js';
import { renderMaterialCard } from './ui_material_cards.js';
import { leaveMaterialDetail, showMaterialDetail } from './ui_material_detail.js';
import { updateMaterialContext, watchMaterialSelection } from './ui_material_application.js';

const t = (key, params) => translate(key, params);

function hideSiblingWorkspaceViews(owner) {
    if (owner.notebookContainer) owner.notebookContainer.style.display = 'none';
    if (owner.notebookBody) owner.notebookBody.style.display = 'none';
    if (owner.recipeView) owner.recipeView.style.display = 'none';
    if (owner.recipeContainer) owner.recipeContainer.style.display = 'none';
    owner.notebookNotesTab?.classList.remove('active');
    owner.notebookRecipesTab?.classList.remove('active');
}

function buildMaterialTopbar(owner) {
    const topbar = text(owner.materialView, 'header', '', 'anomalous-material-topbar');
    owner.materialTopbar = topbar;

    // 1. 左侧微胶囊分类切换
    const left = text(topbar, 'div', '', 'anomalous-material-topbar-left');
    const pills = text(left, 'div', '', 'anomalous-material-pills');
    const categories = [
        { id: 'all', key: 'materialKindPill_all', kind: '' },
        { id: 'workflow', key: 'materialKindPill_workflow', kind: 'image_workflow_snapshot' },
        { id: 'params', key: 'materialKindPill_params', kind: 'recipe_parameter_selection' },
        { id: 'prompts', key: 'materialKindPill_prompts', kind: 'prompt_plan' },
    ];
    owner.materialKindPills = {};
    for (const cat of categories) {
        const pill = text(pills, 'button', t(cat.key) || cat.id, 'anomalous-material-pill');
        pill.type = 'button';
        if ((!owner.materialKindCategory && cat.id === 'all') || owner.materialKindCategory === cat.id) {
            pill.classList.add('is-active');
        }
        pill.onclick = () => {
            for (const p of Object.values(owner.materialKindPills)) p.classList.remove('is-active');
            pill.classList.add('is-active');
            owner.materialKindCategory = cat.id;
            owner.materialKind = '';
            if (cat.id === 'prompts') owner.materialApplyMode = false;
            owner.refreshMaterials(1);
        };
        owner.materialKindPills[cat.id] = pill;
    }

    // 2. 中间紧凑搜索与标签下拉
    const center = text(topbar, 'div', '', 'anomalous-material-topbar-center');
    const searchWrap = text(center, 'div', '', 'anomalous-material-search-wrap');
    const searchIcon = text(searchWrap, 'span', '', 'anomalous-material-search-icon');
    searchIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
    const search = text(searchWrap, 'input', '', 'anomalous-material-search-input');
    search.type = 'search';
    search.placeholder = t('materialSearchHint') || '搜索素材名称或标签...';
    search.value = owner.materialQuery || '';
    search.oninput = () => {
        clearTimeout(owner.materialSearchTimer);
        owner.materialQuery = search.value;
        owner.materialSearchTimer = setTimeout(() => owner.refreshMaterials(1), 250);
    };

    owner.materialTagSelect = text(center, 'select', '', 'anomalous-material-tag-select');
    owner.materialTagSelect.setAttribute('aria-label', t('materialTags'));
    owner.materialTagSelect.onchange = () => {
        owner.materialTag = owner.materialTagSelect.value;
        owner.refreshMaterials(1);
    };

    // 3. 右侧操作组
    const right = text(topbar, 'div', '', 'anomalous-material-topbar-right');

    // 视图切换 (网格 / 列表)
    const viewSwitch = text(right, 'div', '', 'anomalous-material-view-switch');
    const currentMode = owner.materialViewMode || (typeof localStorage !== 'undefined' ? localStorage.getItem('anomalous_material_view_mode') : null) || 'grid';
    owner.materialViewMode = currentMode;

    const gridBtn = text(viewSwitch, 'button', '', `anomalous-material-view-btn${currentMode === 'grid' ? ' is-active' : ''}`);
    gridBtn.type = 'button';
    gridBtn.title = t('materialViewGrid') || '网格视图';
    gridBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`;

    const listBtn = text(viewSwitch, 'button', '', `anomalous-material-view-btn${currentMode === 'list' ? ' is-active' : ''}`);
    listBtn.type = 'button';
    listBtn.title = t('materialViewList') || '列表视图';
    listBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`;

    gridBtn.onclick = () => {
        owner.materialViewMode = 'grid';
        if (typeof localStorage !== 'undefined') localStorage.setItem('anomalous_material_view_mode', 'grid');
        gridBtn.classList.add('is-active');
        listBtn.classList.remove('is-active');
        owner.materialList?.classList.remove('is-list');
        owner.materialList?.classList.add('is-grid');
    };

    listBtn.onclick = () => {
        owner.materialViewMode = 'list';
        if (typeof localStorage !== 'undefined') localStorage.setItem('anomalous_material_view_mode', 'list');
        listBtn.classList.add('is-active');
        gridBtn.classList.remove('is-active');
        owner.materialList?.classList.remove('is-grid');
        owner.materialList?.classList.add('is-list');
    };

    // 刷新按钮
    const refreshBtn = text(right, 'button', '↻', 'anomalous-material-topbar-btn');
    refreshBtn.type = 'button';
    refreshBtn.title = t('refresh');
    refreshBtn.onclick = () => owner.refreshMaterials();


}

function renderMaterialPagination(owner, payload) {
    owner.materialPager.replaceChildren();
    const previous = text(owner.materialPager, 'button', t('materialPrevious'), 'anomalous-btn-ghost');
    previous.type = 'button';
    previous.disabled = payload.page <= 1;
    previous.onclick = () => owner.refreshMaterials(payload.page - 1);
    text(owner.materialPager, 'span', t('materialPageSummary', { page: payload.page, pages: payload.pages, count: payload.total }));
    const next = text(owner.materialPager, 'button', t('materialNext'), 'anomalous-btn-ghost');
    next.type = 'button';
    next.disabled = payload.page >= payload.pages;
    next.onclick = () => owner.refreshMaterials(payload.page + 1);

    if (owner.materialTagSelect) {
        const tags = owner.materialTagSelect;
        tags.replaceChildren();
        text(tags, 'option', t('materialAllTags')).value = '';
        for (const tag of payload.tags || []) text(tags, 'option', tag).value = tag;
        if (owner.materialTag && !(payload.tags || []).includes(owner.materialTag)) text(tags, 'option', owner.materialTag).value = owner.materialTag;
        tags.value = owner.materialTag || '';
    }
}

export async function refreshMaterials(page = this.materialPage || 1) {
    if (!this.materialList) return;
    this.materialListController?.abort();
    const controller = new AbortController();
    this.materialListController = controller;
    this.materialList.replaceChildren();
    text(this.materialList, 'p', t('loading'), 'anomalous-material-empty');
    updateMaterialContext(this);
    for (const [key, pill] of Object.entries(this.materialKindPills || {})) pill.classList.toggle('is-active', key === (this.materialKindCategory || 'all'));
    const query = new URLSearchParams({
        page,
        limit: 48,
        q: this.materialQuery || '',
        tag: this.materialTag || '',
        kind: this.materialKind || '',
        category: this.materialKindCategory || 'all',
    });
    if (this.materialApplyMode && this.materialTarget) query.set('node_type', this.materialTarget.type);
    try {
        const response = await fetch(`/anomalous/materials?${query}`, { cache: 'no-store', signal: controller.signal });
        const payload = await jsonResponse(response, 'material list failed');
        if (this.materialListController !== controller) return;
        this.materialPage = payload.page;
        this.materialList.replaceChildren();
        renderMaterialPagination(this, payload);
        const materials = Array.isArray(payload.materials) ? payload.materials : [];
        if (!materials.length) {
            text(this.materialList, 'p', t(this.materialQuery || this.materialTag || this.materialKind ? 'materialNoMatches' : 'materialEmpty'), 'anomalous-material-empty');
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const material of materials) fragment.appendChild(renderMaterialCard(this, material));
        this.materialList.appendChild(fragment);
    } catch (error) {
        if (error?.name === 'AbortError' || this.materialListController !== controller) return;
        console.error('Could not load materials:', error);
        this.materialList.replaceChildren();
        text(this.materialList, 'p', t('materialLoadError'), 'anomalous-material-empty');
    } finally {
        if (this.materialListController === controller) this.materialListController = null;
    }
}

export async function showMaterials() {

    this.nbPanel.style.display = 'flex';
    if (!this.materialContainer) {
        this.materialContainer = text(this.nbPanel, 'div', '', 'anomalous-nb-container anomalous-material-container');
        const header = text(this.materialContainer, 'div', '', 'anomalous-nb-header');
        this.materialHeading = text(header, 'h2', t('materialLibrary'));
        const close = text(header, 'button', '×', 'anomalous-btn-ghost');
        close.setAttribute('aria-label', t('close'));
        close.onclick = () => this.closeWorkspace();
    }
    this.materialHeading.textContent = t('materialLibrary');
    this.materialContainer.style.display = 'flex';
    watchMaterialSelection(this, showMaterialDetail);
    hideSiblingWorkspaceViews(this);
    leaveMaterialDetail(this);
    if (this.materialView && this.materialViewLocale !== resolveLocale()) {
        this.materialView.remove();
        this.materialView = null;
    }
    if (!this.materialView) {
        this.materialViewLocale = resolveLocale();
        this.materialView = document.createElement('div');
        this.materialView.className = 'anomalous-material-body';

        buildMaterialTopbar(this);

        const mainArea = text(this.materialView, 'div', '', 'anomalous-material-main-area');
        this.materialMainArea = mainArea;

        const contentArea = text(mainArea, 'div', '', 'anomalous-material-content');
        this.materialContentArea = contentArea;

        this.materialContext = text(contentArea, 'div', '', 'anomalous-material-target-context');

        const initialMode = this.materialViewMode || localStorage.getItem('anomalous_material_view_mode') || 'grid';
        this.materialList = document.createElement('div');
        this.materialList.className = `anomalous-material-list is-${initialMode}`;
        contentArea.appendChild(this.materialList);

        this.materialPager = text(contentArea, 'nav', '', 'anomalous-material-pager');
        this.materialPager.setAttribute('aria-label', t('materialPagination'));

        this.materialContainer.appendChild(this.materialView);
    }
    this.materialView.style.display = 'flex';
    updateMaterialContext(this);
    await this.refreshMaterials();
}

/**
 * Direct client-side PNG chunk parser to safely extract embedded ComfyUI metadata
 * without requiring a server reboot or server-side re-encoding.
 */
export async function showImageMaterialDetail(owner, sourceImage, imageUrl, options = {}) {
    return showImageWorkbench(owner, sourceImage, imageUrl, options);
}

export async function openSavedMaterial(material) {
    this.recipeDetailFinish?.('closed');
    this.modal?.classList.add('visible');
    if (this.nbPanel.style.display !== 'flex' && !this.workspaceReturnState) {
        this.workspaceReturnState = Object.fromEntries([
            ['grid', this.grid], ['detail', this.detailPanel], ['gallery', this.galleryPanel],
            ['doctor', this.doctorPanel], ['assistant', this.assistantPanel],
        ].filter(([, panel]) => panel).map(([key, panel]) => [key, panel.style.display]));
    }
    this.nbPanel.style.display = 'flex';
    for (const panel of [this.grid, this.detailPanel, this.galleryPanel, this.doctorPanel, this.assistantPanel, this.paramPanel]) {
        if (panel) panel.style.display = 'none';
    }
    await showMaterials.call(this);
    if (material) await showMaterialDetail(this, material);
}


export async function openMaterialLibrary() {
    this.materialApplyMode = !!selectedMaterialNode(app);
    this.materialTarget = selectedMaterialNode(app);
    if (this.materialApplyMode) { this.materialKind = ''; this.materialKindCategory = 'all'; }
    await openSavedMaterial.call(this, null);
}
