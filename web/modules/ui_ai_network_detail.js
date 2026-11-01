/**
 * The training network's detail column (ui_ai_network.js): what is picked in the graph or the table.
 * Nothing picked: the training rounds started here (each opens its task) and how to read the
 * network. A base model: its models here with how often each ran, the items it ran with, those it has
 * not tried. An item: the base models it ran on and those not tried. A pair: how its runs turned out,
 * by the user and by the AI, and each run (GET /anomalous/ai_training/runs, newest first): when, on
 * which model, by which AI app, how it was judged, its pictures and its task. Each can start a
 * training round on it (`train(preset)`, ui_ai_training_setup.js).
 */

import { translate as t } from './locales.js';
import { imageResults } from './ui_ai_images.js';
import { baseLabel, countWords, isBase, isPair, meter, short, touches, untried } from './ui_ai_network_data.js';

const MODELS_SHOWN = 12;
const runsRead = new Map(); // pair key → {runs} | {error} | 'reading'

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

/** The runs read so far are forgotten (the network was read again). */
export function forgetRuns() {
    runsRead.clear();
}

const when = seconds => new Date(seconds * 1000).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const section = label => el('div', 'anomalous-ai-net-section', label);

/** A model's name from its file, as the network lists it, else the file without its extension. */
function modelName(data, file) {
    return data.models.find(model => model.file === file)?.name || String(file || '').replace(/\.[^.]+$/, '') || t('aiNetModelUnknown');
}

function rowsOf(edges, labelOf, choose) {
    return edges.map((edge) => {
        const row = button(`anomalous-ai-net-row is-${edge.look.tone}${edge.look.ai ? ' is-ai' : ''}`, undefined,
            () => choose({ base: edge.base, kind: edge.item.kind, name: edge.item.name }));
        row.append(el('span', 'anomalous-ai-net-row-name', labelOf(edge)), el('span', 'anomalous-ai-net-row-count', short(edge.count)));
        return row;
    });
}

function chips(pairs, labelOf, choose) {
    const box = el('div', 'anomalous-ai-net-chips');
    for (const [base, item] of pairs) box.append(button('anomalous-ai-net-chip', `+ ${labelOf(base, item)}`, () => choose({ base, kind: item.kind, name: item.name })));
    return box;
}

/** One run of a pair: when, which model and AI, how it was judged, its pictures, its task. */
function runRow(run, data, ctx) {
    const row = el('div', 'anomalous-ai-net-run');
    const top = el('div', 'anomalous-ai-net-run-top');
    top.append(el('span', 'anomalous-ai-net-run-when', when(run.at)), el('span', 'anomalous-ai-net-run-model', modelName(data, run.model)));
    if (run.client) top.append(el('span', 'anomalous-ai-net-run-client', run.client));
    const marks = el('div', 'anomalous-ai-net-run-marks');
    const user = run.state === 'error' ? 'error' : run.judged ? `${run.judged}_${run.by}` : 'none';
    marks.append(el('span', `anomalous-ai-net-mark is-${run.state === 'error' ? 'bad' : run.judged || 'none'}`, t(`aiNetJudged_${user}`)));
    if (run.ai) marks.append(el('span', `anomalous-ai-net-mark is-ai is-${run.ai === 'picked' ? 'good' : 'passed'}`, t(`aiNetAiMark_${run.ai}`)));
    row.append(top, marks);
    const pictures = run.pictures.map(([subfolder, filename]) => ({ type: 'image', folder: 'output', filename, subfolder }));
    if (pictures.length) row.append(imageResults(pictures, ctx.owner, { compact: true }));
    if (run.task) row.append(button('anomalous-ai-net-link', t('aiNetOpenTask'), () => ctx.openTask(run.task)));
    return row;
}

/** The runs of a pair, read when first shown. */
function runsBox(edge, data, ctx, redraw) {
    const key = JSON.stringify([edge.item.kind, edge.item.name, edge.base]);
    const known = runsRead.get(key);
    const box = el('div', 'anomalous-ai-net-runs');
    if (!known) {
        runsRead.set(key, 'reading');
        const query = new URLSearchParams({ kind: edge.item.kind, name: edge.item.name, base: edge.base });
        fetch(`/anomalous/ai_training/runs?${query}`).then(async (response) => {
            const answer = await response.json().catch(() => ({}));
            runsRead.set(key, response.ok ? { runs: answer.runs || [] } : { error: answer.error || response.statusText });
        }).catch(error => runsRead.set(key, { error: error.message })).finally(redraw);
    }
    if (!known || known === 'reading') box.append(el('div', 'anomalous-ai-net-hint', t('aiNetRunsReading')));
    else if (known.error) box.append(el('div', 'anomalous-ai-net-hint', t('aiNetUnread', { error: known.error })));
    else box.append(...known.runs.map(run => runRow(run, data, ctx)));
    return box;
}

/** Nothing picked: the training rounds and how to read the network. */
function roundsBox(net, ctx, train) {
    const box = el('div', 'anomalous-ai-net-detail-body');
    box.append(section(t('aiNetRounds')));
    const rounds = net.data.rounds || [];
    if (!rounds.length) box.append(el('div', 'anomalous-ai-net-hint', t('aiNetRoundsNone')));
    for (const round of rounds) {
        const row = el('div', 'anomalous-ai-net-round');
        const status = round.done >= round.total ? 'done' : !round.taken ? 'waiting' : round.ended ? 'ended' : 'going';
        const top = el('div', 'anomalous-ai-net-run-top');
        top.append(el('span', 'anomalous-ai-net-round-title', round.title || round.target), el('span', `anomalous-ai-net-mark is-${status === 'done' ? 'good' : 'none'}`, t(`aiNetRound_${status}`)));
        const progress = el('div', 'anomalous-ai-net-progress');
        const fill = el('span', 'anomalous-ai-net-progress-fill');
        fill.style.width = `${round.total ? Math.round(round.done / round.total * 100) : 0}%`;
        progress.append(fill);
        row.append(top, el('div', 'anomalous-ai-net-detail-line is-soft', t('aiNetRoundLine', { when: when(round.started), done: round.done, total: round.total, models: round.models.join('、') })),
            progress, button('anomalous-ai-net-link', t('aiNetOpenTask'), () => ctx.openTask(round.id)));
        box.append(row);
    }
    box.append(button('anomalous-ai-net-train', t('aiNetTrain'), () => train({})), section(t('aiNetHow')),
        el('div', 'anomalous-ai-net-hint', t(net.edges.length ? 'aiNetHint' : 'aiNetEmpty')));
    return box;
}

/** A base model: its models here, the items it ran with, what it has not tried. */
function baseBox(net, pick, choose, train) {
    const base = net.bases.find(entry => entry.base === pick.base);
    if (!base) return null;
    const box = el('div', 'anomalous-ai-net-detail-body');
    const edges = net.edges.filter(edge => edge.base === base.base);
    box.append(el('div', 'anomalous-ai-net-detail-title', baseLabel(base.base)),
        el('div', 'anomalous-ai-net-detail-line is-soft', base.models ? t('aiNetModelsHere', { count: base.models }) : t('aiNetNotHere')),
        meter(edges.map(edge => edge.count)));
    const runsOf = file => net.data.by_model?.[file]?.runs || 0;
    const models = net.data.models.filter(model => model.base === base.base).sort((a, b) => runsOf(b.file) - runsOf(a.file) || a.name.localeCompare(b.name));
    if (models.length) {
        box.append(section(t('aiNetTheseModels')));
        const list = el('div', 'anomalous-ai-net-models');
        for (const model of models.slice(0, MODELS_SHOWN)) {
            const row = el('div', 'anomalous-ai-net-model');
            row.append(el('span', 'anomalous-ai-net-row-name', model.name),
                el('span', 'anomalous-ai-net-row-count', runsOf(model.file) ? t('aiNetRunsShort', { runs: runsOf(model.file) }) : t('aiNetNeverRan')));
            list.append(row);
        }
        if (models.length > MODELS_SHOWN) list.append(el('div', 'anomalous-ai-net-hint', t('aiNetMoreModels', { count: models.length - MODELS_SHOWN })));
        box.append(list);
    }
    if (edges.length) box.append(section(t('aiNetRanWith')), ...rowsOf(edges, edge => edge.item.title, choose));
    const open = untried(net, pick);
    if (open.length) box.append(section(t('aiNetNotTried')), chips(open, (_base, item) => item.title, choose));
    if (base.models) box.append(button('anomalous-ai-net-train', t('aiNetTrainBase'), () => train({ base: base.base })));
    return box;
}

/** An item: the base models it ran on, those not tried. */
function itemBox(net, pick, choose, train) {
    const item = net.items.find(entry => entry.kind === pick.kind && entry.name === pick.name);
    if (!item) return null;
    const box = el('div', 'anomalous-ai-net-detail-body');
    const edges = net.edges.filter(edge => edge.item === item);
    box.append(el('div', 'anomalous-ai-net-detail-title', item.title), el('div', 'anomalous-ai-net-detail-line is-soft', item.sub), meter(edges.map(edge => edge.count)));
    if (edges.length) box.append(section(t('aiNetRanOn')), ...rowsOf(edges, edge => baseLabel(edge.base), choose));
    const open = untried(net, pick);
    if (open.length) box.append(section(t('aiNetNotTried')), chips(open, base => baseLabel(base), choose));
    if (item.usable) box.append(button('anomalous-ai-net-train', t('aiNetTrainItem'), () => train({ item })));
    return box;
}

/** A pair: how it turned out, then each run. */
function pairBox(net, pick, ctx, train, redraw) {
    const item = net.items.find(entry => entry.kind === pick.kind && entry.name === pick.name);
    if (!item) return null;
    const box = el('div', 'anomalous-ai-net-detail-body');
    box.append(el('div', 'anomalous-ai-net-detail-title', `${baseLabel(pick.base)} × ${item.title}`), el('div', 'anomalous-ai-net-detail-line is-soft', item.sub));
    const edge = net.edges.find(entry => touches(entry, pick));
    if (!edge) {
        box.append(el('div', 'anomalous-ai-net-detail-line', t('aiNetPairUntried')));
        if (item.usable) box.append(button('anomalous-ai-net-train', t('aiNetTrainThis'), () => train({ item, base: pick.base })));
        return box;
    }
    const count = edge.count;
    const user = countWords(count, ['good', 'bad', 'passed']);
    box.append(meter([count]), el('div', 'anomalous-ai-net-detail-line', t('aiNetRuns', { runs: count.runs })),
        el('div', 'anomalous-ai-net-detail-line', user ? t('aiNetUser', { parts: user }) : t('aiNetUserNone')));
    if (count.ai_good || count.ai_passed) box.append(el('div', 'anomalous-ai-net-detail-line', t('aiNetAi', { parts: countWords(count, ['ai_good', 'ai_passed']) })));
    if (count.failed) box.append(el('div', 'anomalous-ai-net-detail-line', countWords(count, ['failed'])));
    if (count.clients.length) box.append(el('div', 'anomalous-ai-net-detail-line is-soft', t('aiRecordBy', { names: count.clients.join(', ') })));
    if (item.usable) box.append(button('anomalous-ai-net-train', t('aiNetTrainThis'), () => train({ item, base: pick.base })));
    box.append(section(t('aiNetEachRun')), runsBox(edge, net.data, ctx, redraw));
    return box;
}

/**
 * The column for what is picked (`chosen`). `opts`: {choose(pick), train(preset), redraw(), ctx: {owner, openTask(id)}}.
 */
export function detailBox(net, chosen, { choose, train, redraw, ctx }) {
    const box = el('div', 'anomalous-ai-net-detail');
    const shown = !chosen ? roundsBox(net, ctx, train)
        : isPair(chosen) ? pairBox(net, chosen, ctx, train, redraw)
            : isBase(chosen) ? baseBox(net, chosen, choose, train) : itemBox(net, chosen, choose, train);
    if (chosen) box.append(button('anomalous-ai-net-link', t('aiNetUnpick'), () => choose(chosen)));
    if (chosen && !shown) box.append(el('div', 'anomalous-ai-net-hint', t('aiNetGone')));
    box.append(shown || roundsBox(net, ctx, train));
    return box;
}
