/**
 * The Models page's "Sources" view: where each model can be downloaded, for the open
 * workflow's models or every model here. Each row's link can be typed or pasted (any site),
 * found automatically, opened, and saved (model_source_links.js keeps it in the model's
 * information and, for the workflow's models, in the workflow). The workflow's list can go
 * on the canvas as a note or to the clipboard. It is drawn in the models grid under the
 * page's tabs while `owner.modelView === 'sources'`; `owner.modelSources` keeps scope, filter
 * and search across redraws.
 */

import { translate as t } from './locales.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { typeLabel } from './ui_model_types.js';
import { foundationModelType, partitionSourceModels } from './model_source_data.js';
import {
    autoDetectModelSource, collectWorkflowModels, copySourcesSummary, createCanvasNoteNode, detectPlatform,
    fetchAllLibraryModels, keepAllInWorkflow, normalizeUrl, openExternalUrl, resolveWorkflowModelsMetadata, saveModelSource,
} from './model_source_links.js';

const COMPONENT_LABELS = {
    clip: 'modelSourcesTypeTextEncoder', text_encoders: 'modelSourcesTypeTextEncoder',
    vae: 'modelSourcesTypeVae', vae_approx: 'modelSourcesTypeVaeApprox', clip_vision: 'modelSourcesTypeVisionEncoder',
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

function viewState(owner) {
    owner.modelSources ||= { scope: 'library', filter: 'all', search: '', workflow: [], library: [], libraryStatus: 'idle', componentsOpen: false, controller: null };
    return owner.modelSources;
}

/** Opens the view on the Models page; `scope`: 'workflow' (the open workflow) or 'library'. */
export function showModelSources(owner, scope = 'library') {
    const state = viewState(owner);
    Object.assign(state, { scope, filter: 'all', search: '' }); // a fresh look, not the last search
    state.libraryStatus = 'idle'; // scans and edits may have changed it since
    owner.modelView = 'sources';
    owner.goTo?.('models');
    owner.loadModels();
}

function paintSite(badge, url) {
    const site = detectPlatform(url);
    badge.hidden = !site;
    if (!site) return;
    badge.textContent = site.name;
    Object.assign(badge.style, { color: site.color, background: site.bg, borderColor: site.border });
}

/** One model: name, where it is, its link and what can be done with it. */
function renderRow(model) {
    const row = el('div', 'anomalous-msrc-row');
    const info = el('div', 'anomalous-msrc-info');
    const name = el('strong', 'anomalous-msrc-name', model.basename || model.filename);
    name.title = model.filename;
    const where = model.nodeId != null
        ? `${model.nodeTitle} #${model.nodeId}`
        : [model.type ? typeLabel({ type: model.type }) : '', model.subfolder].filter(Boolean).join(' · ');
    info.append(name, el('small', 'anomalous-msrc-where', where));
    const component = foundationModelType(model);
    if (component) info.append(el('span', 'anomalous-msrc-tag', `${t(COMPONENT_LABELS[component] || 'modelSourcesTypeVae')} · ${t('modelSourcesStatusUnfilledOptional')}`));
    if (model.isMissing) info.append(el('span', 'anomalous-msrc-tag is-missing', t('modelSourcesStatusMissingOnDisk')));

    const link = el('div', 'anomalous-msrc-link');
    const site = el('span', 'anomalous-msrc-site');
    const input = el('input', 'anomalous-msrc-input');
    input.type = 'url';
    input.spellcheck = false;
    input.placeholder = t('modelSourcesUrlPlaceholder');
    input.value = model.url || '';
    const open = button('anomalous-msrc-btn', t('modelSourcesOpen'), () => openExternalUrl(input.value));
    const find = button('anomalous-msrc-btn', t('modelSourcesAutoDetect'), null);
    const save = button('anomalous-msrc-btn is-primary', t('modelSourcesSave'), null);
    link.append(site, input, open, find, save);
    row.append(info, link);

    const sync = () => {
        const dirty = normalizeUrl(input.value) !== normalizeUrl(model.initialUrl || '');
        row.classList.toggle('is-dirty', dirty);
        row.classList.toggle('is-empty', !input.value.trim());
        save.hidden = !dirty;
        open.disabled = !input.value.trim();
        find.hidden = Boolean(input.value.trim());
        paintSite(site, input.value);
    };
    const commit = async () => {
        save.disabled = true;
        try {
            const kept = await saveModelSource(model, input.value);
            input.value = model.url;
            showWorkbenchToast(t(kept.local && kept.workflow ? 'modelSourcesSavedBoth' : kept.local ? 'modelSourcesSavedLocal' : 'modelSourcesSavedWorkflow'));
        } catch (error) {
            showWorkbenchToast(t('modelSourcesSaveFailed', { error: error.message }));
        } finally {
            save.disabled = false;
            sync();
        }
    };
    input.oninput = () => { model.url = input.value.trim(); sync(); };
    input.onkeydown = (event) => {
        if (event.key === 'Enter' && !save.hidden) commit();
        if (event.key === 'Escape') {
            event.stopPropagation(); // the panel stays open
            input.value = model.initialUrl || '';
            model.url = input.value;
            sync();
        }
    };
    save.onclick = commit;
    find.onclick = async () => {
        find.disabled = true;
        try {
            const found = await autoDetectModelSource(model);
            if (found) {
                input.value = found;
                model.url = found;
            }
            showWorkbenchToast(t(found ? 'modelSourcesFound' : 'modelSourcesNotFound'));
        } finally {
            find.disabled = false;
            sync();
        }
    };
    sync();
    return row;
}

async function loadLibrary(state, signal, draw) {
    if (state.libraryStatus !== 'idle') return;
    state.libraryStatus = 'loading';
    draw();
    try {
        state.library = await fetchAllLibraryModels(signal);
        state.libraryStatus = 'ready';
    } catch (error) {
        if (signal.aborted) return;
        console.warn('[AMB] Model sources: the library did not load.', error);
        state.libraryStatus = 'error';
    }
    draw();
}

function renderBar(state, draw, setScope) {
    const bar = el('div', 'anomalous-msrc-bar');
    const scopes = el('div', 'anomalous-msrc-pills');
    const libraryCount = state.libraryStatus === 'ready' ? state.library.length : '…';
    for (const [id, label] of [['workflow', `${t('modelSourcesScopeWorkflow')} · ${state.workflow.length}`], ['library', `${t('modelSourcesScopeLibrary')} · ${libraryCount}`]]) {
        scopes.append(button(`anomalous-msrc-pill${state.scope === id ? ' is-active' : ''}`, label, () => setScope(id)));
    }
    const filters = el('div', 'anomalous-msrc-pills');
    for (const [id, key] of [['all', 'modelSourcesFilterAll'], ['resolved', 'modelSourcesFilterResolved'], ['unresolved', 'modelSourcesFilterUnresolved']]) {
        filters.append(button(`anomalous-msrc-pill${state.filter === id ? ' is-active' : ''}`, t(key), () => { state.filter = id; draw(); }));
    }
    const search = el('input', 'anomalous-msrc-search');
    search.type = 'search';
    search.placeholder = t('modelSourcesSearchPlaceholder');
    search.value = state.search;
    search.oninput = () => { state.search = search.value.trim().toLowerCase(); draw({ keepSearchFocus: true }); };
    bar.append(scopes, filters, search);
    return bar;
}

function renderFoot(state, shown, main) {
    const foot = el('div', 'anomalous-msrc-foot');
    const done = main.filter(model => model.url).length;
    foot.append(el('span', 'anomalous-msrc-stats', t('modelSourcesStats', { done, total: main.length })));
    const actions = el('div', 'anomalous-msrc-actions');
    actions.append(button('anomalous-msrc-btn', t('modelSourcesCopySummary'), async () => {
        await copySourcesSummary(shown);
        showWorkbenchToast(t('modelSourcesCopied'));
    }));
    if (state.scope === 'workflow') {
        actions.append(button('anomalous-msrc-btn', t('modelSourcesGenerateNoteNode'), () => {
            if (createCanvasNoteNode(state.workflow)) showWorkbenchToast(t('modelSourcesNoteCreated'));
        }), button('anomalous-msrc-btn', t('modelSourcesKeepAll'), () => {
            showWorkbenchToast(t('modelSourcesKeptAll', { count: keepAllInWorkflow(state.workflow) }));
        }));
    }
    foot.append(actions);
    return foot;
}

function renderList(state, draw) {
    const list = el('div', 'anomalous-msrc-list');
    if (state.scope === 'library' && state.libraryStatus !== 'ready') {
        list.append(el('p', 'anomalous-msrc-empty', t(state.libraryStatus === 'error' ? 'modelSourcesLibraryLoadFailed' : 'modelSourcesLibraryLoading')));
        if (state.libraryStatus === 'error') list.append(button('anomalous-msrc-btn', t('modelSourcesRetry'), () => { state.libraryStatus = 'idle'; draw({ reload: true }); }));
        return { list, shown: [], main: [] };
    }
    const models = state.scope === 'workflow' ? state.workflow : state.library;
    const group = partitionSourceModels(models, state.filter, state.search);
    list.append(...group.mainModels.map(renderRow));
    if (group.allComponentCount) {
        const toggle = button('anomalous-msrc-components', `${state.componentsOpen ? '▾' : '▸'} ${t('modelSourcesComponentsAdvanced', { count: group.componentModels.length })} · ${t('modelSourcesComponentsOptionalHint')}`,
            () => { state.componentsOpen = !state.componentsOpen; draw(); });
        toggle.setAttribute('aria-expanded', String(state.componentsOpen));
        list.append(toggle);
        if (state.componentsOpen) list.append(...group.componentModels.map(renderRow));
    }
    if (!group.mainModels.length && !group.allComponentCount) {
        list.append(el('p', 'anomalous-msrc-empty', t(state.scope === 'workflow' && !models.length ? 'modelSourcesWorkflowEmpty' : 'modelSourcesNoModelsFound')));
    }
    const shown = [...group.mainModels, ...(state.componentsOpen ? group.componentModels : [])];
    return { list, shown, main: models.filter(model => !foundationModelType(model)) };
}

/** Draws the view into the models grid (after the type bar). */
export function renderModelSourcesView(owner, grid) {
    const state = viewState(owner);
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    state.workflow = collectWorkflowModels();
    const view = el('section', 'anomalous-msrc');
    grid.appendChild(view);

    const draw = ({ keepSearchFocus = false, reload = false } = {}) => {
        if (controller.signal.aborted || !view.isConnected) return;
        if (reload) loadLibrary(state, controller.signal, draw);
        const { list, shown, main } = renderList(state, draw);
        const head = el('div', 'anomalous-msrc-head');
        head.append(el('h2', 'anomalous-msrc-title', t('modelSourcesTitle')), el('p', 'anomalous-msrc-lead', t('modelSourcesLead')));
        const bar = renderBar(state, draw, (scope) => {
            state.scope = scope;
            if (scope === 'library') loadLibrary(state, controller.signal, draw);
            draw();
        });
        view.replaceChildren(head, bar, list, renderFoot(state, shown, main));
        if (keepSearchFocus) {
            const search = bar.querySelector('.anomalous-msrc-search');
            search.focus();
            search.setSelectionRange(search.value.length, search.value.length);
        }
    };
    draw();
    resolveWorkflowModelsMetadata(state.workflow, controller.signal).then(changed => { if (changed) draw(); });
    if (state.scope === 'library') loadLibrary(state, controller.signal, draw);
}
