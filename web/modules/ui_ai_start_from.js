/**
 * The "从哪开始 / Start from" first row in the `say` and `private` starter sheets
 * (plugged into web/modules/ui_ai_starter_sheet.js) and the standalone "Build a new one
 * (text to image)" dialog for the message box (`openBuildRouteWindow`). Pure rules live in ./ai_start_from.js.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { createViewScope } from './ui_lifecycle.js';
import { openTabs } from './preset_runs.js';
import { aiWindow } from './ui_ai_connect.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import {
    SEARCH_FROM,
    START_FROM_KEY,
    buildStrip,
    filterModels,
    filterWorkflows,
    loadImageInfo,
    pickWay,
    resolveStartFrom,
    routeModels,
    secondModelChoices,
    stillValidStartFrom,
} from './ai_start_from.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

function option(value, label) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    return node;
}

function readRemembered() {
    try {
        const raw = localStorage.getItem(START_FROM_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

function writeRemembered(state) {
    try {
        localStorage.setItem(START_FROM_KEY, JSON.stringify({
            mode: state.mode,
            first: state.first,
            second: state.second,
            route: state.route,
            card: state.card,
        }));
    } catch (_) {}
}

function openFactLine(loadInfo) {
    if (!loadInfo.count) return t('aiStartOpenNoImages');
    const files = loadInfo.names.join(t('listSeparator'));
    if (loadInfo.count === 1) return files ? t('aiStartOpenOneImage', { files }) : t('aiStartOpenOneImageAnon');
    return files ? t('aiStartOpenWithImages', { count: loadInfo.count, files }) : t('aiStartOpenWithImagesAnon', { count: loadInfo.count });
}

/** Posts `{route, models}` to `/anomalous/ai_tasks/{id}/route` (shared by starter sheets and the message box build window). */
export async function applyTaskRoute(taskId, picked) {
    const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(taskId)}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: picked.route, models: picked.models }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
    return payload;
}

const modelLabel = item => (item.favourite ? t('aiStartFavModel', { name: item.name }) : item.name);

/** Shared fields/controller for "新搭一张（文生图）": used by both `startFromSection` and `openBuildRouteWindow`. */
function newRoutePart({ scope, remembered, alwaysRemember = false, initialState = {}, onUnavailable, onChange }) {
    let models = null;
    let ways = [];
    let loadingInit = true;
    let loadingWays = false;
    let loadError = '';
    let waysError = '';
    let waysSeq = 0;
    let waysAbort = null;
    scope.onDispose(() => waysAbort?.abort());

    const state = { first: initialState.first || '', second: initialState.second || '', route: initialState.route || '' };
    const firstSearch = el('input', 'anomalous-ai-start-input');
    firstSearch.type = 'search';
    firstSearch.placeholder = t('aiStartModelSearch');
    const firstPick = el('select', 'anomalous-ai-start-select');
    const secondSearch = el('input', 'anomalous-ai-start-input');
    secondSearch.type = 'search';
    secondSearch.placeholder = t('aiStartModelSearch');
    const secondPick = el('select', 'anomalous-ai-start-select');
    const waysBox = el('div', 'anomalous-ai-start-ways');
    const strip = el('div', 'anomalous-ai-start-strip');
    const findModel = id => (models || []).find(item => item.model_id === id) || null;

    function drawFirstSelect() {
        const list = models || [];
        firstSearch.hidden = list.length < SEARCH_FROM;
        const shown = filterModels(list, firstSearch.value, state.first);
        firstPick.replaceChildren(...shown.map(item => option(item.model_id, modelLabel(item))));
        firstPick.value = state.first;
    }

    function drawSecondSelect() {
        const pool = secondModelChoices(models || [], state.first);
        secondSearch.hidden = pool.length < SEARCH_FROM;
        const shown = filterModels(pool, secondSearch.value, state.second);
        secondPick.replaceChildren(option('', t('aiStartSecondNone')), ...shown.map(item => option(item.model_id, modelLabel(item))));
        secondPick.value = shown.some(item => item.model_id === state.second) ? state.second : '';
    }

    function drawWays() {
        if (loadingWays) {
            waysBox.replaceChildren(el('div', 'anomalous-ai-start-from-note', t('aiStartLoadingRoutes')));
            strip.hidden = true;
            return;
        }
        if (waysError) {
            waysBox.replaceChildren(el('div', 'anomalous-ai-start-from-warn', waysError));
            strip.hidden = true;
            return;
        }
        if (!ways.length) {
            waysBox.replaceChildren(el('div', 'anomalous-ai-start-from-warn', t('aiStartNoBuildableWays')));
            strip.hidden = true;
            return;
        }
        const first = findModel(state.first);
        const second = state.second ? findModel(state.second) : null;
        waysBox.replaceChildren(...ways.map((way) => {
            const on = state.route === way.id;
            const node = button(`anomalous-ai-start-way${on ? ' is-on' : ''}`, '', () => {
                state.route = way.id;
                drawWays();
            });
            node.setAttribute('aria-pressed', String(on));
            node.append(
                el('div', 'anomalous-ai-start-way-title', t(`aiRoute_${way.id}`, { a: first?.name || '', b: second?.name || '' })),
                el('div', 'anomalous-ai-start-way-detail', t(`aiRouteDetail_${way.id}`)),
            );
            return node;
        }));
        const line = buildStrip(state.route, first?.name || '', second?.name || '', t);
        strip.textContent = line;
        strip.hidden = !line;
    }

    function renderInto(body) {
        if (loadingInit && !models) {
            body.replaceChildren(el('div', 'anomalous-ai-start-from-note', t('aiStartLoadingRoutes')));
            return;
        }
        if (loadError && !models?.length) {
            body.replaceChildren(el('div', 'anomalous-ai-start-from-warn', loadError));
            return;
        }
        if (!models?.length) {
            body.replaceChildren(el('div', 'anomalous-ai-start-from-warn', t('aiStartNewOnly')));
            return;
        }
        const firstWrap = el('div', 'anomalous-ai-start-sub');
        firstWrap.append(el('span', 'anomalous-ai-start-sublabel', t('aiStartFirstModel')), firstSearch, firstPick);
        const secondWrap = el('div', 'anomalous-ai-start-sub');
        secondWrap.append(el('span', 'anomalous-ai-start-sublabel', t('aiStartSecondModel')), secondSearch, secondPick);
        drawFirstSelect();
        drawSecondSelect();
        drawWays();
        body.replaceChildren(firstWrap, secondWrap, el('span', 'anomalous-ai-start-sublabel', t('aiStartWaysLabel')), waysBox, strip,
            el('div', 'anomalous-ai-start-from-note', t('aiStartNewOnly')));
    }

    async function fetchWays() {
        waysAbort?.abort();
        waysAbort = new AbortController();
        const signal = waysAbort.signal;
        const seq = ++waysSeq;
        loadingWays = true;
        waysError = '';
        onChange?.();
        const query = new URLSearchParams({ first: state.first, ...(state.second ? { second: state.second } : {}) });
        try {
            const response = await fetch(`/anomalous/ai_routes?${query}`, { signal });
            const payload = await response.json().catch(() => ({}));
            if (scope.signal.aborted || signal.aborted || seq !== waysSeq) return;
            loadingWays = false;
            if (!response.ok) {
                waysError = payload.error || `HTTP ${response.status}`;
                ways = [];
                state.route = '';
            } else {
                ways = payload.ways || [];
                state.route = pickWay(ways, state.route, state.second);
            }
        } catch (error) {
            if (error?.name === 'AbortError' || scope.signal.aborted || seq !== waysSeq) return;
            loadingWays = false;
            waysError = error.message;
            ways = [];
            state.route = '';
        }
        onChange?.();
    }

    async function fetchInitial() {
        const wantRemembered = (alwaysRemember || remembered?.mode === 'new') && Boolean(remembered?.first);
        const query = wantRemembered
            ? `?${new URLSearchParams({ first: remembered.first, ...(remembered.second ? { second: remembered.second } : {}) })}`
            : '';
        try {
            const response = await fetch(`/anomalous/ai_routes${query}`, { signal: scope.signal });
            const payload = await response.json().catch(() => ({}));
            if (scope.signal.aborted) return;
            loadingInit = false;
            if (!response.ok && !payload.models?.length) {
                loadError = payload.error || `HTTP ${response.status}`;
                onChange?.();
                return;
            }
            models = payload.models || [];
            if (!models.length) {
                onUnavailable?.();
                onChange?.();
                return;
            }
            if (!response.ok) {
                waysError = payload.error || `HTTP ${response.status}`;
                state.first = payload.first || models[0].model_id;
                state.second = payload.second || '';
                state.route = '';
                onChange?.();
                return;
            }
            ways = payload.ways || [];
            const nextFirst = payload.first || models[0].model_id;
            const nextSecond = payload.second || '';
            const candidate = wantRemembered ? { ...remembered, mode: 'new' } : null;
            if (candidate && stillValidStartFrom(candidate, { hasNew: true, models, ways })) {
                state.first = candidate.first;
                state.second = candidate.second || '';
                state.route = candidate.route;
            } else {
                state.first = nextFirst;
                state.second = nextSecond;
                state.route = pickWay(ways, '', nextSecond);
            }
            onChange?.(Boolean(wantRemembered));
        } catch (error) {
            if (error?.name === 'AbortError' || scope.signal.aborted) return;
            loadingInit = false;
            loadError = error.message;
            onChange?.();
        }
    }

    firstSearch.oninput = drawFirstSelect;
    firstPick.onchange = () => {
        state.first = firstPick.value;
        if (!secondModelChoices(models || [], state.first).some(item => item.model_id === state.second)) {
            state.second = '';
            secondSearch.value = '';
        }
        drawSecondSelect();
        fetchWays();
    };
    secondSearch.oninput = drawSecondSelect;
    secondPick.onchange = () => {
        state.second = secondPick.value;
        fetchWays();
    };

    return {
        state,
        renderInto,
        drawWays,
        fetchInitial,
        read() {
            if (loadingInit || loadingWays) return { errorKey: 'aiStartWaitRoutes' };
            if (loadError && !models?.length) return { errorText: loadError };
            if (!models?.length) return { errorKey: 'aiStartNewOnly' };
            if (waysError) return { errorText: waysError };
            if (!state.first || !state.route) return { errorKey: 'aiStartNeedRoute' };
            return { mode: 'new', route: state.route, models: routeModels(state.route, state.first, state.second) };
        },
    };
}

/** Opens the standalone "Build a new one (text to image)" dialog for the task shown. */
export function openBuildRouteWindow({ task, built }) {
    const scope = createViewScope();
    const remembered = readRemembered();
    const body = el('div', 'anomalous-ai-start-sheet');
    const routeBody = el('div', 'anomalous-ai-start-from-body');
    const error = el('div', 'anomalous-ai-start-error');
    let close = () => {};

    const part = newRoutePart({
        scope,
        remembered,
        alwaysRemember: true,
        onChange: () => {
            part.renderInto(routeBody);
            if (!body.contains(document.activeElement)) routeBody.querySelector('input:not([hidden]), select')?.focus();
        },
    });
    const go = button('anomalous-ai-start-go', t('aiStartBuildNow'), async () => {
        const picked = part.read();
        if (picked.errorKey || picked.errorText) {
            error.textContent = picked.errorKey ? t(picked.errorKey) : picked.errorText;
            return;
        }
        const taskId = typeof task === 'function' ? task()?.id : task?.id;
        if (!taskId) return;
        go.disabled = true;
        error.textContent = '';
        try {
            await applyTaskRoute(taskId, picked);
            if (scope.signal.aborted) return;
            writeRemembered({ mode: remembered?.mode || 'new', first: part.state.first, second: part.state.second, route: part.state.route, card: remembered?.card || '' });
            close();
            showWorkbenchToast(t('aiRouteBuilt'));
            await built?.();
        } catch (err) {
            if (scope.signal.aborted) return;
            go.disabled = false;
            error.textContent = err?.message || String(err);
        }
    });
    const actions = el('div', 'anomalous-ai-start-actions');
    actions.append(go);
    body.append(routeBody, error, actions);
    body.addEventListener('input', () => { error.textContent = ''; });
    body.addEventListener('change', () => { error.textContent = ''; });
    body.addEventListener('click', (event) => {
        if (event.target.closest('button') && event.target.closest('button') !== go) error.textContent = '';
    });
    part.renderInto(routeBody);
    close = aiWindow(t('aiStartFrom_new'), body, () => scope.dispose());
    part.fetchInitial();
    body.querySelector('input:not([hidden]), select, button')?.focus();
    return close;
}

/** Builds `{ node, read, save, stop }` for the sheet's "从哪开始 / Start from" section. */
export function startFromSection({ data }) {
    const scope = createViewScope();
    const remembered = readRemembered();
    const workflows = data.workflows || [];
    const canOpen = Boolean(openTabs()[0]?.runs);
    const loadInfo = loadImageInfo(app.graph);
    let hasNew = Number(data.models || 0) > 0;
    let touchedMode = false;

    const state = resolveStartFrom(remembered, { hasNew, models: null, ways: null, canOpen, workflows });

    const root = el('div', 'anomalous-ai-start-field anomalous-ai-start-from');
    root.append(el('span', 'anomalous-ai-start-label', t('aiStartFromLabel')));
    const pillsRow = el('div', 'anomalous-ai-start-pills');
    const pills = {
        new: button('anomalous-ai-start-pill', t('aiStartFrom_new'), () => pickMode('new')),
        open: button('anomalous-ai-start-pill', t('aiStartFrom_open'), () => pickMode('open')),
        card: button('anomalous-ai-start-pill', t('aiStartFrom_card'), () => pickMode('card')),
        ai: button('anomalous-ai-start-pill', t('aiStartFrom_ai'), () => pickMode('ai')),
    };
    pills.new.hidden = !hasNew;
    pills.open.disabled = !canOpen;
    if (!canOpen) pills.open.title = t('aiStartOpenNoOutput');
    pills.card.hidden = !workflows.length;
    pillsRow.append(pills.new, pills.open, pills.card, pills.ai);
    root.append(pillsRow);
    if (!canOpen) root.append(el('div', 'anomalous-ai-start-from-note', t('aiStartOpenDisabled')));

    const cardSearch = el('input', 'anomalous-ai-start-input');
    cardSearch.type = 'search';
    cardSearch.placeholder = t('aiPresetSearch');
    cardSearch.hidden = workflows.length < SEARCH_FROM;
    const cardPick = el('select', 'anomalous-ai-start-select');
    const body = el('div', 'anomalous-ai-start-from-body');
    root.append(body);

    const routePart = newRoutePart({
        scope,
        remembered,
        initialState: state,
        onUnavailable: () => {
            hasNew = false;
            if (state.mode === 'new') state.mode = 'ai';
        },
        onChange: (usedRemembered) => {
            Object.assign(state, routePart.state);
            if (!usedRemembered && remembered?.mode === 'new' && !touchedMode && hasNew) state.mode = 'new';
            draw();
        },
    });

    function pickMode(mode) {
        if ((mode === 'open' && !canOpen) || (mode === 'new' && !hasNew) || (mode === 'card' && !workflows.length)) return;
        touchedMode = true;
        state.mode = mode;
        draw();
    }

    function drawPills() {
        pills.new.hidden = !hasNew;
        for (const [key, node] of Object.entries(pills)) {
            const on = state.mode === key;
            node.classList.toggle('is-on', on);
            node.setAttribute('aria-pressed', String(on));
        }
    }

    function drawCardSelect() {
        const shown = filterWorkflows(workflows, cardSearch.value, state.card);
        cardPick.replaceChildren(...shown.map(item => option(item.file, item.name)));
        cardPick.value = state.card;
    }

    function draw() {
        drawPills();
        if (state.mode === 'new') {
            routePart.renderInto(body);
        } else if (state.mode === 'open') {
            body.replaceChildren(el('div', 'anomalous-ai-start-from-note', openFactLine(loadInfo)));
        } else if (state.mode === 'card') {
            drawCardSelect();
            body.replaceChildren(cardSearch, cardPick);
        } else {
            body.replaceChildren(el('div', 'anomalous-ai-start-from-note', t('aiStartAiHint')));
        }
    }

    cardSearch.oninput = drawCardSelect;
    cardPick.onchange = () => { state.card = cardPick.value; };
    draw();
    if (hasNew) routePart.fetchInitial();

    return {
        node: root,
        stop: () => scope.dispose(),
        save: () => writeRemembered({ ...state, ...routePart.state }),
        read: () => {
            if (state.mode === 'new') return routePart.read();
            if (state.mode === 'open') {
                if (!openTabs()[0]?.runs) return { errorKey: 'aiStartOpenDisabled' };
                return { mode: 'open', count: loadImageInfo(app.graph).count };
            }
            if (state.mode === 'card') {
                const chosen = workflows.find(item => item.file === state.card) || workflows[0];
                if (!chosen) return { errorKey: 'aiStartNoWorkflows' };
                return { mode: 'card', card: chosen.file, cardName: chosen.name };
            }
            return { mode: 'ai' };
        },
    };
}
