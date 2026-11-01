/**
 * The side column's training network (训练网络, ui_ai_side_views.js): what the runs here showed, as a
 * graph. Left the base models (those of the main models here, and any the record names), right the
 * ready-made ways, the skills and the node packs that ran; a line joins a model and an item that ran
 * together, its colour how that turned out (api/ai_evidence.py: the user's picks, keeps and word,
 * else, dashed, the AI's own pick), its width how often. A click on a node or a line shows it below:
 * the counts, who judged, which AI apps ran it, its last pictures, and, for a node, the pairs not
 * tried yet (dashed in the graph); a training round (ui_ai_training_setup.js) starts from there or
 * from the top. GET /anomalous/ai_training, read again each time the view is opened.
 */

import { resolveLocale, translate as t } from './locales.js';
import { sideHead } from './ui_ai_side.js';
import { imageResults } from './ui_ai_images.js';
import { trainingSetup } from './ui_ai_training_setup.js';

const SVG = 'http://www.w3.org/2000/svg';
const COUNTS = ['good', 'bad', 'passed', 'failed'];
let shown = null; // the network last read, or {error}
let reading = null;
let chosen = null; // {base} | {kind, name} | {base, kind, name}
let setup = null; // the training round being set up: its preset, or null
let watcher = null; // redraws the lines when the graph's size changes

const words = value => (resolveLocale() === 'zh' ? value?.zh : value?.en) || value?.en || value?.zh || '';
const baseLabel = base => base || t('aiRecordOther');

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

/** The items: the ways and skills on (and any with a record) and the node packs that ran, those that ran most first. */
function itemsOf(data) {
    const record = data.record || {};
    const out = [];
    for (const block of data.blocks) {
        const usable = block.usable && block.on;
        if (usable || record.way?.[block.name]) out.push({ kind: 'way', name: block.name, title: words(block.title), sub: t(`aiBlocksJob_${block.job}`), usable });
    }
    for (const skill of data.skills) {
        if (skill.on || record.skill?.[skill.name]) out.push({ kind: 'skill', name: skill.name, title: words(skill.title), sub: 'Skill', usable: skill.on });
    }
    for (const pack of Object.keys(record.pack || {}).sort()) out.push({ kind: 'pack', name: pack, title: pack, sub: t('aiNetPack'), usable: false });
    const runs = item => Object.values(record[item.kind]?.[item.name] || {}).reduce((sum, count) => sum + count.runs, 0);
    return out.map(item => ({ ...item, key: `${item.kind}:${item.name}`, runs: runs(item) })).sort((a, b) => b.runs - a.runs);
}

/** The base models with how many main models here have each and how often they ran, most run first. */
function basesOf(data, edges) {
    const bases = new Map(data.models.map(model => [model.base, 0]));
    for (const model of data.models) bases.set(model.base, bases.get(model.base) + 1);
    const runs = new Map();
    for (const edge of edges) {
        runs.set(edge.base, (runs.get(edge.base) || 0) + edge.count.runs);
        if (!bases.has(edge.base)) bases.set(edge.base, 0);
    }
    return [...bases].map(([base, models]) => ({ base, models, runs: runs.get(base) || 0 }))
        .sort((a, b) => b.runs - a.runs || b.models - a.models || a.base.localeCompare(b.base));
}

/** How a pair turned out: the user's judgement first, else the AI's (`ai`), else only that it ran. */
function look(count) {
    const share = (good, all) => (good / all >= 0.6 ? 'good' : good / all >= 0.3 ? 'fair' : 'bad');
    const user = count.good + count.bad + count.passed;
    const ai = count.ai_good + count.ai_passed;
    if (user) return { tone: share(count.good, user), ai: false };
    if (ai) return { tone: share(count.ai_good, ai), ai: true };
    return { tone: 'ran', ai: false };
}

function edgesOf(data, items) {
    return items.flatMap(item => Object.entries(data.record?.[item.kind]?.[item.name] || {})
        .map(([base, count]) => ({ base, item, count, look: look(count) })));
}

const isBase = pick => pick && pick.base !== undefined && !pick.kind;
const isItem = pick => pick && pick.kind && pick.base === undefined;
const touches = (edge, pick) => !pick || (pick.base === undefined || pick.base === edge.base) && (!pick.kind || pick.kind === edge.item.kind && pick.name === edge.item.name);

/** The pairs of the chosen node not tried yet: [base, item], items that can run, bases with models here. */
function untried(bases, items, edges) {
    const tried = new Set(edges.map(edge => `${edge.base}|${edge.item.key}`));
    if (isBase(chosen)) return items.filter(item => item.usable && !tried.has(`${chosen.base}|${item.key}`)).map(item => [chosen.base, item]);
    const item = isItem(chosen) && items.find(entry => entry.kind === chosen.kind && entry.name === chosen.name);
    return item?.usable ? bases.filter(base => base.models && !tried.has(`${base.base}|${item.key}`)).map(base => [base.base, item]) : [];
}

function choose(pick, redraw) {
    chosen = JSON.stringify(chosen) === JSON.stringify(pick) ? null : pick;
    redraw();
}

/** The lines between the columns, drawn from where the nodes are now. */
function drawLines(svg, graph, nodes, edges, open) {
    const box = graph.getBoundingClientRect();
    svg.setAttribute('width', String(box.width));
    svg.setAttribute('height', String(box.height));
    svg.replaceChildren();
    const at = (node, right) => {
        const rect = node.getBoundingClientRect();
        return [(right ? rect.right : rect.left) - box.left, rect.top + rect.height / 2 - box.top];
    };
    const line = (base, item, className, width, onClick, title) => {
        const from = nodes.get(`base:${base}`);
        const to = nodes.get(item.key);
        if (!from || !to) return;
        const [x1, y1] = at(from, true);
        const [x2, y2] = at(to, false);
        const middle = (x1 + x2) / 2;
        const shape = `M${x1} ${y1} C${middle} ${y1} ${middle} ${y2} ${x2} ${y2}`;
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('d', shape);
        path.setAttribute('class', className);
        path.style.strokeWidth = `${width}px`;
        svg.append(path);
        if (!onClick) return;
        const hit = document.createElementNS(SVG, 'path');
        hit.setAttribute('d', shape);
        hit.setAttribute('class', 'anomalous-ai-net-hit');
        hit.addEventListener('click', onClick);
        const tip = document.createElementNS(SVG, 'title');
        tip.textContent = title;
        hit.append(tip);
        svg.append(hit);
    };
    for (const [base, item] of open) line(base, item, 'anomalous-ai-net-line is-untried', 1.5);
    for (const edge of edges) {
        const own = touches(edge, chosen);
        const picked = chosen?.kind && chosen.base !== undefined && own;
        line(edge.base, edge.item, `anomalous-ai-net-line is-${edge.look.tone}${edge.look.ai ? ' is-ai' : ''}${own ? '' : ' is-dim'}${picked ? ' is-chosen' : ''}`,
            1.5 + Math.min(edge.count.runs, 10) * 0.35, edge.onClick, `${baseLabel(edge.base)} × ${edge.item.title}: ${short(edge.count)}`);
    }
}

/** "4 runs · 3 good", or the AI's word when the user gave none. */
function short(count) {
    const judged = look(count);
    return t(judged.ai ? 'aiNetShortAi' : 'aiNetShort', { runs: count.runs, good: judged.ai ? count.ai_good : count.good });
}

function countWords(count, keys) {
    return keys.filter(key => count[key]).map(key => t(`aiNetCount_${key}`, { n: count[key] })).join(' · ');
}

/** What is shown below the graph for the chosen node or line. */
function detailBox(data, bases, items, edges, ctx, redraw) {
    const box = el('div', 'anomalous-ai-net-detail');
    if (!chosen) {
        box.append(el('div', 'anomalous-ai-net-hint', t(edges.length ? 'aiNetHint' : 'aiNetEmpty')));
        return box;
    }
    const train = (label, preset) => button('anomalous-ai-net-train is-small', label, () => { setup = preset; redraw(); });
    if (chosen.kind && chosen.base !== undefined) {
        const edge = edges.find(item => touches(item, chosen));
        if (!edge) return box;
        const count = edge.count;
        box.append(el('div', 'anomalous-ai-net-detail-title', `${baseLabel(edge.base)} × ${edge.item.title}`),
            el('div', 'anomalous-ai-net-detail-line', t('aiNetRuns', { runs: count.runs })),
            el('div', 'anomalous-ai-net-detail-line', countWords(count, ['good', 'bad', 'passed']) ? t('aiNetUser', { parts: countWords(count, ['good', 'bad', 'passed']) }) : t('aiNetUserNone')));
        if (count.ai_good || count.ai_passed) box.append(el('div', 'anomalous-ai-net-detail-line', t('aiNetAi', { parts: countWords(count, ['ai_good', 'ai_passed']) })));
        if (count.failed) box.append(el('div', 'anomalous-ai-net-detail-line', countWords(count, ['failed'])));
        if (count.clients.length) box.append(el('div', 'anomalous-ai-net-detail-line is-soft', t('aiRecordBy', { names: count.clients.join(', ') })));
        const pictures = [...count.pictures].reverse().map(([subfolder, filename]) => ({ type: 'image', folder: 'output', filename, subfolder }));
        if (pictures.length) box.append(imageResults(pictures, ctx.owner, { compact: true }));
        if (edge.item.usable) box.append(train(t('aiNetTrainThis'), { item: edge.item, base: edge.base }));
        return box;
    }
    const base = isBase(chosen) ? bases.find(item => item.base === chosen.base) : null;
    const item = base ? null : items.find(entry => entry.kind === chosen.kind && entry.name === chosen.name);
    if (!base && !item) return box;
    box.append(el('div', 'anomalous-ai-net-detail-title', base ? baseLabel(base.base) : item.title),
        el('div', 'anomalous-ai-net-detail-line is-soft', base ? (base.models ? t('aiNetModelsHere', { count: base.models }) : t('aiNetNotHere')) : item.sub));
    for (const edge of edges.filter(entry => touches(entry, chosen))) {
        const label = base ? edge.item.title : baseLabel(edge.base);
        const row = button(`anomalous-ai-net-row is-${edge.look.tone}${edge.look.ai ? ' is-ai' : ''}`, '', () => choose({ base: edge.base, kind: edge.item.kind, name: edge.item.name }, redraw));
        row.append(el('span', 'anomalous-ai-net-row-name', label), el('span', 'anomalous-ai-net-row-count', short(edge.count)));
        box.append(row);
    }
    const open = untried(bases, items, edges);
    if (open.length) box.append(el('div', 'anomalous-ai-net-detail-line is-soft', t('aiNetUntried', { names: open.map(([key, entry]) => (base ? entry.title : baseLabel(key))).join('、') })));
    if (base?.models) box.append(train(t('aiNetTrainBase'), { base: base.base }));
    if (item?.usable) box.append(train(t('aiNetTrainItem'), { item }));
    return box;
}

function graphBox(data, ctx, redraw) {
    const items = itemsOf(data);
    const edges = edgesOf(data, items);
    const bases = basesOf(data, edges);
    for (const edge of edges) edge.onClick = () => choose({ base: edge.base, kind: edge.item.kind, name: edge.item.name }, redraw);
    const graph = el('div', 'anomalous-ai-net-graph');
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'anomalous-ai-net-lines');
    svg.setAttribute('aria-hidden', 'true');
    const nodes = new Map();
    const column = (head, entries, keyOf, labelOf, subOf, pickOf, extra) => {
        const box = el('div', `anomalous-ai-net-col ${extra}`);
        box.append(el('div', 'anomalous-ai-net-head', head));
        for (const entry of entries) {
            const pick = pickOf(entry);
            const lit = JSON.stringify(chosen) === JSON.stringify(pick);
            const dim = chosen && !lit && !edges.some(edge => touches(edge, chosen) && touches(edge, pick)) && !untried(bases, items, edges).some(([base, item]) => keyOf(entry) === `base:${base}` || keyOf(entry) === item.key);
            const node = button(`anomalous-ai-net-node${lit ? ' is-chosen' : ''}${dim ? ' is-dim' : ''}`, '', () => choose(pick, redraw));
            node.setAttribute('aria-pressed', String(lit));
            node.append(el('span', 'anomalous-ai-net-node-name', labelOf(entry)), el('span', 'anomalous-ai-net-node-sub', subOf(entry)));
            nodes.set(keyOf(entry), node);
            box.append(node);
        }
        return box;
    };
    graph.append(svg,
        column(t('aiNetModels'), bases, base => `base:${base.base}`, base => baseLabel(base.base),
            base => (base.models ? t('aiNetModelsHere', { count: base.models }) : t('aiNetNotHere')), base => ({ base: base.base }), 'is-bases'),
        column(t('aiNetItems'), items, item => item.key, item => item.title, item => item.sub, item => ({ kind: item.kind, name: item.name }), 'is-items'));
    const draw = () => drawLines(svg, graph, nodes, edges, untried(bases, items, edges));
    watcher?.disconnect();
    watcher = new ResizeObserver(draw);
    watcher.observe(graph);
    return [graph, detailBox(data, bases, items, edges, ctx, redraw)];
}

function draw(pane, ctx, redraw) {
    const body = el('div', 'anomalous-ai-stage-body anomalous-ai-net');
    if (!shown || shown.error) {
        body.append(el('div', 'anomalous-ai-stage-empty', shown ? t('aiNetUnread', { error: shown.error }) : t('aiNetReading')));
    } else if (setup) {
        body.append(trainingSetup(shown, setup, { back: () => { setup = null; redraw(); }, openTask: ctx.openTask }));
    } else {
        body.append(el('div', 'anomalous-ai-blocks-note', t('aiNetIntro')),
            el('div', 'anomalous-ai-blocks-note', t(`aiNetSeen_${shown.shown_to_ai === true}`)),
            button('anomalous-ai-net-train', t('aiNetTrain'), () => { setup = {}; redraw(); }), ...graphBox(shown, ctx, redraw));
    }
    pane.replaceChildren(sideHead(t('aiSideNetwork'), ctx.close), body);
}

/** The view into `pane`; `ctx`: {close, owner, openTask(id)}. `fresh`: just opened, so the network is read again. */
export function renderNetworkView(pane, ctx, fresh = false) {
    const redraw = () => draw(pane, ctx, redraw);
    if ((fresh || !shown) && !reading) {
        reading = fetch('/anomalous/ai_training').then(async (response) => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || response.statusText);
            shown = data;
        }).catch((error) => { shown = { error: error.message }; }).finally(() => { reading = null; redraw(); });
    }
    redraw();
}
