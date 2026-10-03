import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { deriveRecipeModelReferences } from './recipe_identity.js';
import {
    appendRecipeToCanvas,
} from './recipe_actions.js';
import {
    appendText,
    button,
} from './ui_recipe_detail_dom.js';
import { renderVersions } from './ui_recipe_versions.js';
import { renderRecipeGallery } from './ui_recipe_gallery.js';
import { updateRecipeMetadata as updateInlineRecipeMetadata } from './ui_recipe_metadata.js';
import { renderOverview } from './ui_recipe_overview.js';
import { promptValues, renderRecipeParameters } from './ui_recipe_parameters.js';
import { loadCurrentPreviews, openLocalModel, renderRecipeModels } from './ui_recipe_models.js';

const t = (key, params) => translate(key, params);

function closeRecipeWorkspace(owner) {
    if (!owner) return;
    owner.nbPanel && (owner.nbPanel.style.display = 'none');
    owner.notebookBody && (owner.notebookBody.style.display = 'none');
    owner.recipeView && (owner.recipeView.style.display = 'none');
    owner.modal?.classList.remove('visible');
    owner?.close?.();
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

/** Opens a recipe model's detail; Back there returns to this recipe where it was. */
function openRecipeModel(owner, reference, finish) {
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
        if (owner.recipeContainer) owner.recipeContainer.style.display = 'flex';
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

function renderModelComposition(container, owner, recipe, references, finish) {
    renderRecipeModels(container, owner, recipe, references, (reference) => openRecipeModel(owner, reference, finish));
}

function syncRecipeReferencesToCatalog(owner, filename, references) {
    if (!owner || !filename || !Array.isArray(references)) return;
    const record = (owner.recipeRecords || []).find((r) => r?.filename === filename);
    if (record?.data?.params) {
        record.data.params.model_references = references.map((r) => ({
            ...r,
            currentAvailability: r.currentAvailability || (r.localModel ? 'available' : undefined),
        }));
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
        syncRecipeReferencesToCatalog(owner, filename, references);
        if (!['canvas', 'append', 'model'].includes(mode)) {
            owner.recipeListContainer.style.display = '';
            topbars.forEach(bar => { bar.style.display = ''; });
            owner.renderRecipeList?.(owner.recipeRecords || []);
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
            renderOverview(content, owner, recipe, references, finish, {
                applyRecipeToCanvas,
                promptValues,
                renderModelComposition,
            });
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
                syncRecipeReferencesToCatalog(owner, filename, references);
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
