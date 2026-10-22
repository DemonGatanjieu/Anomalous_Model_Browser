/**
 * A workflow's details: the bar (Back, its name edited in place, the models' state, Open and
 * ⋯), then its values on the left (the workflow's own, the saved sets, all its pictures, its
 * versions; ui_recipe_sets.js) and the chosen one on the right (ui_recipe_set_view.js, or the
 * pictures or versions). Opening on the canvas, editing and model detail end the session.
 */

import { app } from '../../../scripts/app.js';
import { translate } from './locales.js';
import { deriveRecipeModelReferences } from './recipe_identity.js';
import { appendRecipeToCanvas } from './recipe_actions.js';
import { handWorkflowToAi } from './ui_ai_handoff.js';
import { appendText, button } from './ui_recipe_detail_dom.js';
import { renderVersions } from './ui_recipe_versions.js';
import { renderRecipeGallery } from './ui_recipe_gallery.js';
import { recipeCanvasActionLabel, renderInlineTitle, renderReadiness } from './ui_recipe_info.js';
import { renderDetailNav, listedSets } from './ui_recipe_sets.js';
import { renderSetView } from './ui_recipe_set_view.js';
import { exportRecipePackage } from './ui_recipe_package.js';
import { openPopupMenu } from './ui_popup_menu.js';
import { loadCurrentPreviews, openLocalModel } from './ui_recipe_models.js';
import { anomalousAlert } from './ui_dialog.js';

const t = (key, params) => translate(key, params);

/** Hides the browser over the canvas; the Workflows page stays, so opening it again shows the list. */
function closeRecipeWorkspace(owner) {
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
        activeTab: owner.recipeDetailActiveTab || 'set',
        filename: owner.recipeDetailSelectedSet || null,
        scrollTop: view?.querySelector('.anomalous-wfd-main')?.scrollTop || 0,
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

/** Loads one JSON list into `state` ({ status, images, scanned }); null when the request failed. */
async function loadPictures(url, state) {
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (payload.status && payload.status !== 'success')) throw new Error('recipe pictures request failed');
    state.images = Array.isArray(payload.images) ? payload.images : [];
    state.scanned = Number(payload.scanned) || 0;
    state.status = 'ready';
}

/** The bar over the details: Back, the name, the models' state, Open, ⋯ (edit, export). */
function detailBar(owner, recipe, references, finish) {
    const bar = document.createElement('div');
    bar.className = 'anomalous-wfd-bar';
    const back = button(bar, `‹ ${t('recipeDetailBack')}`, 'anomalous-wfd-back');
    back.onclick = () => finish('back');
    const title = document.createElement('div');
    title.className = 'anomalous-wfd-title';
    renderInlineTitle(title, owner, recipe);
    if (recipe.workflow_scope === 'partial') appendText(title, 'span', t('recipeScopePill_partial'), 'anomalous-wfd-kind');
    const status = document.createElement('div');
    status.className = 'anomalous-wfd-bar-status';
    renderReadiness(status, recipe, references);
    const open = button(bar, `▶ ${recipeCanvasActionLabel(recipe)}`, 'anomalous-wfd-primary');
    open.onclick = async () => {
        open.disabled = true;
        if (await applyRecipeToCanvas(owner, recipe)) finish('canvas');
        open.disabled = false;
    };
    const hand = button(bar, `✦ ${t('aiHand')}`, 'anomalous-wf-icon-btn');
    hand.title = t('aiHandHint');
    hand.onclick = () => void handWorkflowToAi(owner, recipe.name || owner.recipeDetailFilename || '');
    const more = button(bar, '⋯', 'anomalous-wf-icon-btn');
    more.title = t('notebookMore');
    more.onclick = () => openPopupMenu(more, [
        { label: t('recipeEdit'), run: () => finish('edit') },
        { label: t('recipeExport'), run: () => exportRecipePackage({ filename: owner.recipeDetailFilename, data: recipe }) },
    ]);
    bar.insertBefore(title, open);
    bar.insertBefore(status, open);
    return { bar, status };
}

export function showRecipeDetail(owner, { recipe, filename, history = [] }) {
    const returnState = owner.recipeReturnState || null;
    owner.recipeReturnState = null;
    owner.recipeDetailPayload = { recipe, filename, history };
    owner.recipeDetailFilename = filename;
    owner.recipeListContainer.style.display = 'none';
    const topbars = owner.recipeView ? Array.from(owner.recipeView.querySelectorAll('.anomalous-wf-bar')) : [];
    topbars.forEach(bar => { bar.style.display = 'none'; });
    if (owner.recipeDetailView) owner.recipeDetailView.remove();

    const view = document.createElement('div');
    view.className = 'anomalous-recipe-detail-view';
    owner.recipeDetailView = view;
    const references = deriveRecipeModelReferences(recipe);
    let resolveAction;
    let settled = false;
    const result = new Promise((resolve) => { resolveAction = resolve; });
    const finish = (mode) => {
        if (settled) return;
        settled = true;
        view.remove();
        owner.recipeDetailView = null;
        syncRecipeReferencesToCatalog(owner, filename, references);
        if (mode !== 'model') {
            owner.recipeListContainer.style.display = '';
            topbars.forEach(bar => { bar.style.display = ''; });
            owner.renderRecipeList?.(owner.recipeRecords || []);
        }
        if (owner.recipeDetailFinish === finish) owner.recipeDetailFinish = null;
        if (mode !== 'model') delete owner.recipeDetailPayload;
        resolveAction({ mode });
    };
    owner.recipeDetailFinish = finish;

    const gallery = { status: 'idle', images: [], scanned: 0 };
    const parameterGallery = { status: 'idle', images: [], scanned: 0, requestId: 0 };
    const parameterState = { status: 'idle', notebooks: [], selectedFilename: null, editor: null, refresh: null };
    // The view: { kind: 'set' | 'gallery' | 'versions', filename } (a set's file, null for the workflow's own).
    const legacyTabs = { overview: 'set', parameters: 'set' };
    const viewState = {
        kind: legacyTabs[returnState?.activeTab] || returnState?.activeTab || 'set',
        filename: returnState?.filename || null,
        firstSet: Boolean(returnState?.firstSet),
    };

    const { bar, status } = detailBar(owner, recipe, references, finish);
    const body = document.createElement('div');
    body.className = 'anomalous-wfd-body';
    const nav = document.createElement('nav');
    nav.className = 'anomalous-wfd-nav';
    const main = document.createElement('div');
    main.className = 'anomalous-wfd-main';
    body.append(nav, main);

    const openModel = (reference) => openRecipeModel(owner, reference, finish);
    const ctx = {
        owner, recipe, parameterState, parameterGallery, gallery, history, references, openModel,
        get view() { return viewState; },
        get notebook() { return parameterState.notebooks.find(item => item.filename === viewState.filename) || null; },
        select: (kind, file = viewState.filename) => select(kind, file),
        rerender: () => render(),
    };
    const render = () => {
        if (owner.recipeDetailView !== view) return;
        owner.recipeDetailActiveTab = viewState.kind;
        owner.recipeDetailSelectedSet = viewState.filename;
        renderDetailNav(nav, ctx);
        main.replaceChildren();
        try {
            if (viewState.kind === 'gallery') renderRecipeGallery(main, owner, recipe, gallery, refreshGallery);
            else if (viewState.kind === 'versions') renderVersions(main, owner, recipe, history, finish);
            else renderSetView(main, ctx);
        } catch (error) {
            console.error('Could not draw the workflow details:', error);
            appendText(main, 'p', `${t('recipeLoadError')} ${error?.message || ''}`, 'anomalous-recipe-dialog-error');
        }
    };
    const refreshGallery = async (force = false) => {
        if (gallery.status === 'loading' || (!force && gallery.status === 'ready')) return;
        gallery.status = 'loading';
        render();
        try {
            await loadPictures(`/anomalous/recipe_gallery?filename=${encodeURIComponent(filename)}`, gallery);
        } catch (error) {
            console.error('Could not load recipe gallery:', error);
            gallery.status = 'error';
        }
        render();
    };
    const refreshParameterGallery = async () => {
        const requestId = ++parameterGallery.requestId;
        const selected = viewState.filename;
        parameterGallery.status = 'loading';
        const url = selected
            ? `/anomalous/parameter_gallery?filename=${encodeURIComponent(selected)}`
            : `/anomalous/recipe_parameter_gallery?filename=${encodeURIComponent(filename)}`;
        try {
            const state = { status: 'idle' };
            await loadPictures(url, state);
            if (requestId !== parameterGallery.requestId) return;
            Object.assign(parameterGallery, { images: state.images, scanned: state.scanned, status: 'ready' });
        } catch (error) {
            if (requestId !== parameterGallery.requestId) return;
            console.error('Could not load the parameter set pictures:', error);
            parameterGallery.status = 'error';
        }
        if (viewState.kind === 'set') render();
    };
    parameterState.refresh = async () => {
        parameterState.status = 'loading';
        render();
        try {
            const response = await fetch(`/anomalous/parameters?recipe_filename=${encodeURIComponent(filename)}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('recipe parameter notebook request failed');
            const payload = await response.json();
            parameterState.notebooks = Array.isArray(payload.notebooks) ? payload.notebooks : [];
            parameterState.status = 'ready';
        } catch (error) {
            console.error('Could not load recipe parameter notebooks:', error);
            parameterState.status = 'error';
        }
        const listed = listedSets(recipe, parameterState.notebooks);
        if (viewState.firstSet && listed.length) viewState.filename = listed[0].filename;
        viewState.firstSet = false;
        if (!parameterState.notebooks.some(item => item.filename === viewState.filename)) viewState.filename = null;
        render();
        void refreshParameterGallery();
    };
    const select = (kind, file) => {
        const setChanged = kind === 'set' && file !== viewState.filename;
        viewState.kind = kind;
        if (kind === 'set') viewState.filename = file || null;
        main.scrollTop = 0;
        if (setChanged) {
            parameterGallery.status = 'idle';
            void refreshParameterGallery();
        }
        if (kind === 'gallery') void refreshGallery();
        render();
    };

    view.append(bar, body);
    owner.recipeView.appendChild(view);
    render();
    void parameterState.refresh();
    void refreshGallery();
    void loadCurrentPreviews(owner, references)
        .catch((error) => console.warn('Could not load recipe model previews:', error))
        .finally(() => {
            syncRecipeReferencesToCatalog(owner, filename, references);
            if (owner.recipeDetailView !== view) return;
            status.replaceChildren();
            renderReadiness(status, recipe, references);
            if (viewState.kind === 'set' && !viewState.filename) render();
        });
    if (returnState?.scrollTop) requestAnimationFrame(() => { main.scrollTop = returnState.scrollTop; });
    return result;
}