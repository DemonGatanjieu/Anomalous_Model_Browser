/**
 * The training network (训练网络) at the size of the AI page: what the runs here showed and the training
 * rounds that add to it. The side switch of the AI workbench opens it (ui_ai_side_views.js) over the
 * tasks, the timeline and the side column; its back button (Esc presses it, as the browser's pages one
 * level down) or another view of the switch closes it. Its head: whether the AI is told the record (ai_gates.record_view), the graph or the table
 * (ui_ai_network_graph.js, kept on this browser) and a training round to start; under it the numbers
 * (runs, judged by the user, by the AI, pairs that could be tried, rounds) and which items to show.
 * Beside the drawing the detail column (ui_ai_network_detail.js); a training round is set up in
 * place of both (ui_ai_training_setup.js). GET /anomalous/ai_training, read again each time it opens.
 */

import { translate as t } from './locales.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { trainingSetup } from './ui_ai_training_setup.js';
import { KINDS, networkOf, same, totals } from './ui_ai_network_data.js';
import { graphBox, matrixBox, releaseGraph } from './ui_ai_network_graph.js';
import { detailBox, forgetRuns } from './ui_ai_network_detail.js';

const MODE_KEY = 'anomalous.aiNetMode';
const MODES = ['graph', 'table'];
const TILES = ['runs', 'judged', 'ai', 'untried', 'rounds'];
const TONES = ['good', 'fair', 'bad', 'ran', 'ai', 'untried'];
const state = {
    ctx: null, // {owner, openTask(id)}: the workbench's, set each time its side column is drawn
    root: null,
    data: null, // the network last read, or {error}
    reading: null,
    chosen: null, // {base} | {kind, name} | {base, kind, name}
    drawnPick: null, // what the detail column showed last (its scroll goes back to the top when it changes)
    setup: null, // the training round being set up: its preset, or null
    filter: { kind: 'all', ran: false },
    mode: null,
};

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

function storedMode() {
    try {
        const kept = localStorage.getItem(MODE_KEY);
        return MODES.includes(kept) ? kept : 'graph';
    } catch (_) {
        return 'graph';
    }
}

function keepMode(mode) {
    state.mode = mode;
    try {
        localStorage.setItem(MODE_KEY, mode);
    } catch (_) { /* only not kept */ }
}

/** The workbench's ways in (`ctx`: {owner, openTask(id)}), kept for when the switch opens the network. */
export function setNetworkContext(ctx) {
    state.ctx = ctx;
}

export const networkOpen = () => Boolean(state.root?.isConnected);

export function closeNetwork() {
    releaseGraph();
    state.root?.remove();
    state.root = null;
    state.setup = null;
}

const openTask = (id) => {
    closeNetwork();
    state.ctx?.openTask?.(id);
};

function read() {
    if (state.reading) return;
    forgetRuns();
    state.reading = fetch('/anomalous/ai_training').then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || response.statusText);
        state.data = data;
    }).catch((error) => { state.data = { error: error.message }; }).finally(() => { state.reading = null; draw(); });
}

/** Opens the network over the AI page (read again), or reads it again when it is open. */
export function openNetwork() {
    const host = state.ctx?.owner?.aiPanel;
    if (!host) return;
    if (!networkOpen()) {
        state.root = el('section', 'anomalous-ai-netx');
        state.root.tabIndex = -1;
        state.root.setAttribute('aria-label', t('aiSideNetwork'));
        // First in the page, so the browser's Esc (ui_browser_navigation.js) finds its back button before the workbench's.
        host.prepend(state.root);
    }
    state.mode ||= storedMode();
    draw();
    read();
    state.root.focus({ preventScroll: true });
}

function choose(pick) {
    state.chosen = same(state.chosen, pick) ? null : pick;
    draw();
}

function train(preset) {
    state.setup = preset;
    draw();
}

function segmented(values, current, labelOf, onPick) {
    const box = el('div', 'anomalous-ai-gates-choice anomalous-ai-netx-seg');
    box.setAttribute('role', 'radiogroup');
    for (const value of values) {
        const option = button(`anomalous-ai-gates-option${value === current ? ' is-on' : ''}`, labelOf(value), () => onPick(value));
        option.setAttribute('role', 'radio');
        option.setAttribute('aria-checked', String(value === current));
        box.append(option);
    }
    return box;
}

function headBar(data) {
    const bar = el('div', 'anomalous-ai-netx-head');
    const title = el('h2', 'anomalous-ai-netx-title');
    title.append(icon('pulse', 18), el('span', '', t('aiSideNetwork')));
    bar.append(iconButton('anomalous-ai-netx-back', 'chevronLeft', t('aiNetBack'), closeNetwork), title);
    if (!data || data.error) return bar;
    const seen = data.shown_to_ai === true;
    const chip = el('span', `anomalous-ai-netx-seen${seen ? ' is-on' : ''}`, t(`aiNetSeenChip_${seen}`));
    chip.title = t(`aiNetSeen_${seen}`);
    bar.append(chip, el('span', 'anomalous-ai-netx-gap'));
    if (!state.setup) {
        bar.append(segmented(MODES, state.mode, mode => t(`aiNetMode_${mode}`), (mode) => { keepMode(mode); draw(); }),
            button('anomalous-ai-net-train', t('aiNetTrain'), () => train({})));
    }
    return bar;
}

function tiles(net) {
    const numbers = totals(net);
    const box = el('div', 'anomalous-ai-netx-tiles');
    for (const key of TILES) {
        const tile = el('div', `anomalous-ai-netx-tile is-${key}`);
        tile.append(el('span', 'anomalous-ai-netx-tile-value', numbers[key]), el('span', 'anomalous-ai-netx-tile-label', t(`aiNetTile_${key}`)));
        box.append(tile);
    }
    return box;
}

function filters() {
    const bar = el('div', 'anomalous-ai-netx-filters');
    const ran = el('label', 'anomalous-ai-netx-check');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = state.filter.ran;
    check.onchange = () => {
        state.filter.ran = check.checked;
        draw();
    };
    ran.append(check, el('span', '', t('aiNetOnlyRan')));
    bar.append(segmented(['all', ...KINDS], state.filter.kind, kind => t(kind === 'all' ? 'aiNetKindAll' : `aiNetKind_${kind}`),
        (kind) => { state.filter.kind = kind; draw(); }), ran);
    return bar;
}

function legend() {
    const box = el('div', 'anomalous-ai-netx-legend');
    for (const tone of TONES) {
        const key = el('span', 'anomalous-ai-netx-key');
        key.append(el('span', `anomalous-ai-netx-swatch is-${tone}`), el('span', '', t(`aiNetKey_${tone}`)));
        box.append(key);
    }
    box.append(el('span', 'anomalous-ai-netx-key-note', t(`aiNetKeyNote_${state.mode}`)));
    return box;
}

function draw() {
    const root = state.root;
    if (!root?.isConnected) return;
    const data = state.data;
    if (!data || data.error) {
        root.replaceChildren(headBar(data), el('div', 'anomalous-ai-stage-empty', data ? t('aiNetUnread', { error: data.error }) : t('aiNetReading')));
        return;
    }
    if (state.setup) {
        const page = el('div', 'anomalous-ai-netx-setup');
        page.append(trainingSetup(data, state.setup, {
            back: () => {
                state.setup = null;
                draw();
                read(); // a round may have been started
            },
            openTask,
        }));
        root.replaceChildren(headBar(data), page);
        return;
    }
    const before = root.querySelector('.anomalous-ai-netx-main');
    const beforeDetail = root.querySelector('.anomalous-ai-net-detail');
    const net = networkOf(data, state.filter);
    const main = el('div', `anomalous-ai-netx-main is-${state.mode}`);
    main.append(filters(), state.mode === 'table' ? matrixBox(net, state.chosen, choose) : graphBox(net, state.chosen, choose), legend());
    if (!net.edges.length) main.append(el('div', 'anomalous-ai-net-hint', t('aiNetEmpty')));
    const detail = detailBox(net, state.chosen, { choose, train, redraw: draw, ctx: { owner: state.ctx?.owner, openTask } });
    const body = el('div', 'anomalous-ai-netx-body');
    body.append(main, detail);
    root.replaceChildren(headBar(data), tiles(net), body);
    if (before) [main.scrollTop, main.scrollLeft] = [before.scrollTop, before.scrollLeft];
    if (beforeDetail && same(state.drawnPick, state.chosen)) detail.scrollTop = beforeDetail.scrollTop;
    state.drawnPick = state.chosen;
}
