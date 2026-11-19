/**
 * The "从哪开始 / Start from" first row in the `say` and `private` starter sheets
 * (plugged into web/modules/ui_ai_starter_sheet.js; pills, or for the private card's steps cards with an icon
 * and a line each) and the standalone "Build a new one (text to image)" dialog for the message box
 * (`openBuildRouteWindow`). Pure rules live in ./ai_start_from.js.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { createViewScope } from './ui_lifecycle.js';
import { openTabs } from './preset_runs.js';
import { aiWindow } from './ui_ai_connect.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { icon } from './ui_ai_icons.js';
import { modelMetaSummary, modelThumb, openModelPicker } from './ui_ai_model_pick.js';
import { workflowChoice } from './ui_workflow_pick.js';
import {
    START_FROM_KEY,
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

    const state = { first: initialState.first || '', second: initialState.second || '', route: initialState.route || '' };
    const waysBox = el('div', 'anomalous-ai-start-ways');
    const findModel = id => (models || []).find(item => item.model_id === id) || null;
    scope.onDispose(() => waysAbort?.abort());

    // The models picked, each a chip with its number (the first draws first), a swap between two, and a button to the picker.
    const picked = el('div', 'anomalous-ai-start-models');
    const pickButton = button('anomalous-ai-start-pick', '', () => openModelPicker({
        title: t('aiPickBaseTitle'),
        models: models || [],
        picked: [state.first, state.second].filter(Boolean),
        max: 2,
        min: 1,
        numbered: true,
        fits: (ids, model) => !ids.length || secondModelChoices(models || [], ids[0]).some(item => item.model_id === model.model_id),
        unfit: t('aiPickSameFamily'),
        role: index => t(index ? 'aiPickRoleSecond' : 'aiPickRoleFirst'),
        note: t('aiStartNewOnly'),
        hint: t('aiPickBaseHint'),
        from: pickButton,
        onDone: (ids) => {
            state.first = ids[0];
            state.second = ids[1] || '';
            drawPicked();
            fetchWays();
        },
    }));
    const swap = button('anomalous-ai-start-swap', '', () => {
        [state.first, state.second] = [state.second, state.first];
        drawPicked();
        fetchWays();
    });
    swap.title = t('aiStartSwap');
    swap.setAttribute('aria-label', t('aiStartSwap'));
    swap.append(icon('swap', 14));
    const one = el('span', 'anomalous-ai-start-model');
    const two = el('span', 'anomalous-ai-start-model');
    picked.append(one, swap, two, pickButton); // filled in place: a moved button would lose the focus

    function fillChip(chip, model, number) {
        chip.hidden = !model;
        if (!model) return;
        const meta = modelMetaSummary(model);
        const words = el('span', 'anomalous-ai-start-model-words');
        words.append(el('span', 'anomalous-ai-start-model-name', model.name));
        if (meta) words.append(el('span', 'anomalous-ai-start-model-meta', meta));
        chip.replaceChildren(modelThumb(model, 'anomalous-ai-start-model-thumb'), el('span', 'anomalous-ai-start-model-num', String(number)), words);
        chip.title = meta ? `${model.name} (${meta})` : model.name;
    }

    function drawPicked() {
        const first = findModel(state.first);
        const second = first && state.second ? findModel(state.second) : null;
        fillChip(one, first, 1);
        fillChip(two, second, 2);
        swap.hidden = !second;
        pickButton.replaceChildren(icon('models', 14), el('span', '', t(first ? 'aiStartChangeModels' : 'aiStartPickModels')));
    }

    /** A combo's flow in small covers: the first model, a magnifier where the picture gets bigger, the second. */
    function flowOf(way, first, second) {
        const flow = el('div', 'anomalous-ai-start-way-flow');
        flow.append(modelThumb(first, 'anomalous-ai-start-way-thumb'));
        if (way.models === 2 && second) {
            flow.append(icon('arrowRight', 12), ...(way.enlarge ? [icon('expand', 12), icon('arrowRight', 12)] : []), modelThumb(second, 'anomalous-ai-start-way-thumb'));
        }
        return flow;
    }

    function drawWays() {
        if (loadingWays) {
            waysBox.replaceChildren(el('div', 'anomalous-ai-start-from-note', t('aiStartLoadingRoutes')));
            return;
        }
        if (waysError) {
            waysBox.replaceChildren(el('div', 'anomalous-ai-start-from-warn', waysError));
            return;
        }
        if (!ways.length) {
            waysBox.replaceChildren(el('div', 'anomalous-ai-start-from-warn', t('aiStartNoBuildableWays')));
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
            const words = el('div', 'anomalous-ai-start-way-words');
            words.append(
                el('div', 'anomalous-ai-start-way-title', t(`aiRoute_${way.id}`, { a: first?.name || '', b: second?.name || '' })),
                el('div', 'anomalous-ai-start-way-detail', t(`aiRouteDetail_${way.id}`)),
            );
            node.append(...(first ? [flowOf(way, first, second)] : []), words);
            return node;
        }));
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
        drawPicked();
        drawWays();
        if (!body.contains(picked)) {
            body.replaceChildren(el('span', 'anomalous-ai-start-sublabel', t('aiStartModelsLabel')), picked,
                el('span', 'anomalous-ai-start-sublabel', t('aiStartWaysLabel')), waysBox);
        }
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

    return {
        state,
        renderInto,
        drawWays,
        fetchInitial,
        firstName: () => findModel(state.first)?.name || '',
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
            if (!body.contains(document.activeElement)) routeBody.querySelector('input:not([hidden]), .anomalous-ai-model-field-btn, select')?.focus();
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
const CHOICE_ICONS = { new: 'plus', open: 'nodes', card: 'workflows', ai: 'sparkle' };

/** The row in a starter sheet; `cards`: each choice a card with an icon and a line, the sheet asking the question. */
export function startFromSection({ data, cards = false }) {
    const scope = createViewScope();
    const remembered = readRemembered();
    const workflows = data.workflows || [];
    const canOpen = Boolean(openTabs()[0]?.runs);
    const loadInfo = loadImageInfo(app.graph);
    let hasNew = Number(data.models || 0) > 0;
    let touchedMode = false;

    const state = resolveStartFrom(remembered, { hasNew, models: null, ways: null, canOpen, workflows });

    const root = el('div', 'anomalous-ai-start-field anomalous-ai-start-from');
    if (!cards) root.append(el('span', 'anomalous-ai-start-label', t('aiStartFromLabel')));
    const pillsRow = el('div', cards ? 'anomalous-ai-start-choices' : 'anomalous-ai-start-pills');
    const choice = (mode) => {
        if (!cards) return button('anomalous-ai-start-pill', t(`aiStartFrom_${mode}`), () => pickMode(mode));
        const node = button('anomalous-ai-start-choice', '', () => pickMode(mode));
        const words = el('span', 'anomalous-ai-start-choice-words');
        words.append(el('span', 'anomalous-ai-start-choice-title', t(`aiStartFrom_${mode}`)), el('span', 'anomalous-ai-start-choice-hint', t(`aiStartFromHint_${mode}`)));
        node.append(icon(CHOICE_ICONS[mode], 18), words);
        return node;
    };
    const pills = { new: choice('new'), open: choice('open'), card: choice('card'), ai: choice('ai') };
    pills.new.hidden = !hasNew;
    pills.open.disabled = !canOpen;
    if (!canOpen) pills.open.title = t('aiStartOpenNoOutput');
    pills.card.hidden = !workflows.length;
    pillsRow.append(pills.new, pills.open, pills.card, pills.ai);
    root.append(pillsRow);
    if (!canOpen) root.append(el('div', 'anomalous-ai-start-from-note', t('aiStartOpenDisabled')));

    // A saved workflow: the chosen one as a line, its button to the picker's window.
    const wfChoice = workflows.length ? workflowChoice({ workflows, picked: state.card, onChange: (wf) => { state.card = wf.file; } }) : null;
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

    function draw() {
        drawPills();
        if (state.mode === 'new') {
            routePart.renderInto(body);
        } else if (state.mode === 'open') {
            body.replaceChildren(el('div', 'anomalous-ai-start-from-note', openFactLine(loadInfo)));
        } else if (state.mode === 'card' && wfChoice) {
            wfChoice.set(state.card);
            body.replaceChildren(wfChoice.node);
        } else {
            body.replaceChildren(el('div', 'anomalous-ai-start-from-note', t('aiStartAiHint')));
        }
    }

    draw();
    if (hasNew) routePart.fetchInitial();

    return {
        node: root,
        stop: () => scope.dispose(),
        save: () => writeRemembered({ ...state, ...routePart.state }),
        /** What was chosen, in words: "Build a new one · <base model>", "A saved workflow · <its name>". */
        describe: () => {
            const chosen = state.mode === 'new' ? routePart.firstName()
                : state.mode === 'card' ? workflows.find(item => item.file === state.card)?.name : '';
            return [t(`aiStartFrom_${state.mode}`), chosen].filter(Boolean).join(' · ');
        },
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
