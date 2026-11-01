/**
 * The training network's two drawings (ui_ai_network.js). The graph: the base models left, the ways,
 * skills and node packs right, a line for each pair that ran, coloured by how it turned out (dashed:
 * only the AI judged it) and as wide as it ran often, drawn over the two columns from where their
 * nodes are (a ResizeObserver redraws them); with a node picked, faint dashes lead to what it has not
 * tried. The table: a column per base model, a row per item grouped by kind (those that ran most
 * first), a cell per pair saying
 * how many of its runs turned out well, "+" where the pair could still be tried. A click on a node,
 * a line, a heading or a cell picks it (`choose`).
 */

import { translate as t } from './locales.js';
import { KINDS, baseLabel, canTry, isPair, meter, pairKey, same, short, touches, untried } from './ui_ai_network_data.js';

const SVG = 'http://www.w3.org/2000/svg';
let watcher = null; // redraws the graph's lines when its size changes

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

/** The graph's lines stop following its size (another drawing, or the network closed). */
export function releaseGraph() {
    watcher?.disconnect();
    watcher = null;
}

/** A node of the graph or a heading of the table: its name, a line under it, how its runs turned out. */
function nodeFace(node, name, sub, counts, runs) {
    const top = el('span', 'anomalous-ai-net-node-top');
    top.append(el('span', 'anomalous-ai-net-node-name', name));
    if (runs) top.append(el('span', 'anomalous-ai-net-node-runs', t('aiNetRunsShort', { runs })));
    node.append(top, el('span', 'anomalous-ai-net-node-sub', sub), meter(counts));
    node.title = name;
    return node;
}

const baseSub = base => (base.models ? t('aiNetModelsHere', { count: base.models }) : t('aiNetNotHere'));

/** The lines between the columns, drawn from where the nodes are now. */
function drawLines(svg, graph, nodes, net, chosen, open) {
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
    for (const edge of net.edges) {
        const own = touches(edge, chosen);
        const picked = isPair(chosen) && own;
        line(edge.base, edge.item, `anomalous-ai-net-line is-${edge.look.tone}${edge.look.ai ? ' is-ai' : ''}${own ? '' : ' is-dim'}${picked ? ' is-chosen' : ''}`,
            2 + Math.min(edge.count.runs, 12) * 0.5, edge.onClick, `${baseLabel(edge.base)} × ${edge.item.title}: ${short(edge.count)}`);
    }
}

/** The graph: base models left, items right, the lines between. */
export function graphBox(net, chosen, choose) {
    const open = untried(net, chosen);
    for (const edge of net.edges) edge.onClick = () => choose({ base: edge.base, kind: edge.item.kind, name: edge.item.name });
    const graph = el('div', 'anomalous-ai-net-graph');
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'anomalous-ai-net-lines');
    svg.setAttribute('aria-hidden', 'true');
    const nodes = new Map();
    const lit = new Set(open.flatMap(([base, item]) => [`base:${base}`, item.key]));
    const column = (head, entries, keyOf, nameOf, subOf, pickOf, countsOf, extra) => {
        const box = el('div', `anomalous-ai-net-col ${extra}`);
        box.append(el('div', 'anomalous-ai-net-head', head));
        for (const entry of entries) {
            const pick = pickOf(entry);
            const on = same(chosen, pick);
            const dim = chosen && !on && !net.edges.some(edge => touches(edge, chosen) && touches(edge, pick)) && !lit.has(keyOf(entry));
            const counts = countsOf(entry);
            const node = button(`anomalous-ai-net-node${on ? ' is-chosen' : ''}${dim ? ' is-dim' : ''}`, undefined, () => choose(pick));
            node.setAttribute('aria-pressed', String(on));
            nodes.set(keyOf(entry), nodeFace(node, nameOf(entry), subOf(entry), counts, counts.reduce((all, count) => all + count.runs, 0)));
            box.append(node);
        }
        return box;
    };
    graph.append(svg,
        column(t('aiNetModels'), net.bases, base => `base:${base.base}`, base => baseLabel(base.base), baseSub,
            base => ({ base: base.base }), base => net.edges.filter(edge => edge.base === base.base).map(edge => edge.count), 'is-bases'),
        column(t('aiNetItems'), net.items, item => item.key, item => item.title, item => item.sub,
            item => ({ kind: item.kind, name: item.name }), item => net.edges.filter(edge => edge.item === item).map(edge => edge.count), 'is-items'));
    const draw = () => drawLines(svg, graph, nodes, net, chosen, open);
    releaseGraph();
    watcher = new ResizeObserver(draw);
    watcher.observe(graph);
    return graph;
}

/** A cell's words: good runs of all, by the user (else the AI's picks, else only the runs). */
function cellText(edge) {
    const count = edge.count;
    if (edge.look.tone === 'ran') return String(count.runs);
    return `${edge.look.ai ? count.ai_good : count.good}/${count.runs}`;
}

/** The table: a column per base model, a row per item (by kind), a cell per pair. */
export function matrixBox(net, chosen, choose) {
    releaseGraph();
    const wrap = el('div', 'anomalous-ai-net-matrix-wrap');
    const table = el('table', 'anomalous-ai-net-matrix');
    const head = el('tr');
    const corner = el('th', 'anomalous-ai-net-corner', t('aiNetItems'));
    corner.scope = 'col';
    head.append(corner);
    for (const base of net.bases) {
        const pick = { base: base.base };
        const cell = el('th', `anomalous-ai-net-colhead${chosen?.base === base.base ? ' is-lit' : ''}`);
        cell.scope = 'col';
        const counts = net.edges.filter(edge => edge.base === base.base).map(edge => edge.count);
        cell.append(nodeFace(button(`anomalous-ai-net-node is-head${same(chosen, pick) ? ' is-chosen' : ''}`, undefined, () => choose(pick)),
            baseLabel(base.base), baseSub(base), counts, counts.reduce((all, count) => all + count.runs, 0)));
        head.append(cell);
    }
    const body = el('tbody');
    const edges = new Map(net.edges.map(edge => [pairKey(edge.base, edge.item), edge]));
    const runsOf = kind => net.items.filter(item => item.kind === kind).reduce((all, item) => all + item.runs, 0);
    for (const kind of [...KINDS].sort((a, b) => runsOf(b) - runsOf(a))) { // the kinds that ran most first
        const rows = net.items.filter(item => item.kind === kind);
        if (!rows.length) continue;
        const group = el('tr', 'anomalous-ai-net-group');
        const label = el('th', '', t(`aiNetKind_${kind}`));
        label.colSpan = net.bases.length + 1;
        group.append(label);
        body.append(group);
        for (const item of rows) {
            const pick = { kind: item.kind, name: item.name };
            const row = el('tr', chosen?.kind === item.kind && chosen?.name === item.name ? 'is-lit' : '');
            const rowHead = el('th', 'anomalous-ai-net-rowhead');
            rowHead.scope = 'row';
            const counts = net.edges.filter(edge => edge.item === item).map(edge => edge.count);
            rowHead.append(nodeFace(button(`anomalous-ai-net-node is-head${same(chosen, pick) ? ' is-chosen' : ''}`, undefined, () => choose(pick)),
                item.title, item.sub, counts, item.runs));
            row.append(rowHead);
            for (const base of net.bases) {
                const edge = edges.get(pairKey(base.base, item));
                const pair = { base: base.base, kind: item.kind, name: item.name };
                const cell = el('td', chosen?.base === base.base ? 'is-lit' : '');
                const on = same(chosen, pair) ? ' is-chosen' : '';
                if (edge) {
                    const node = button(`anomalous-ai-net-cell is-${edge.look.tone}${edge.look.ai ? ' is-ai' : ''}${on}`, cellText(edge), () => choose(pair));
                    node.title = `${baseLabel(base.base)} × ${item.title}: ${short(edge.count)}`;
                    cell.append(node);
                } else if (canTry(net, base, item)) {
                    const node = button(`anomalous-ai-net-cell is-open${on}`, '+', () => choose(pair));
                    node.title = t('aiNetCellOpen', { base: baseLabel(base.base), item: item.title });
                    cell.append(node);
                } else {
                    cell.append(el('span', 'anomalous-ai-net-cell is-none'));
                }
                row.append(cell);
            }
            body.append(row);
        }
    }
    const thead = el('thead');
    thead.append(head);
    table.append(thead, body);
    wrap.append(table);
    return wrap;
}
