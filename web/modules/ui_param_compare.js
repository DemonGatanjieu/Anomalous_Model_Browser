/**
 * The parameter comparison window: two output images, or an image and the canvas, as
 * param_compare.js reads them. It says whether both are the same node structure and lists
 * each value that differs (prompts by the tags taken out and put in, seeds apart); with the
 * canvas on one side, the ticked values of the image are written onto the canvas as one
 * Ctrl+Z step, with Undo. Also the gallery's pick: the ⇄ of one card, then another's or the canvas.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { recordCanvasStep } from './canvas_history.js';
import { detachedGraph } from './detached_graph.js';
import { applyNodeMaterialValues } from './node_material_actions.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { compareParams, isLongText, readParams, shownValue, textDifference } from './param_compare.js';

const MODE_KEYS = { 0: 'compareModeOn', 2: 'compareModeMuted', 4: 'compareModeBypassed' };
const SHOWN_TAGS = 12; // a prompt swapped whole lists every tag: the rest wait behind a button
const ROLE_KEYS = { positive: 'recipePromptRolePositive', negative: 'recipePromptRoleNegative', both: 'recipePromptRoleBoth' };
let openWindow = null;

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

const canvasGraph = () => app.rootGraph || app.graph;
const imageQuery = image => `filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder || '')}`;
const sideName = side => (side.canvas ? t('compareCanvas') : side.image.filename);

/** One side's parameters: the canvas as it is now, or the workflow kept in an output image. */
async function readSide(side, signal) {
    if (side.canvas) return readParams(canvasGraph());
    const response = await fetch('/anomalous/inspect_image_material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_image: { type: 'output', ...side.image } }),
        signal,
    });
    if (response.status === 400) throw new Error(t('compareNoWorkflow'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { workflow } = await response.json();
    if (!workflow) throw new Error(t('compareNoWorkflow'));
    return readParams(detachedGraph(workflow));
}

function sideCard(side, letter) {
    const card = el('div', 'anomalous-compare-side');
    if (side.canvas) card.append(el('div', 'anomalous-compare-thumb is-canvas', '▦'));
    else {
        const img = el('img', 'anomalous-compare-thumb');
        img.src = `/anomalous/output_thumbnail?${imageQuery(side.image)}`;
        img.alt = '';
        card.append(img);
    }
    const name = el('div', 'anomalous-compare-side-name', `${letter} · ${sideName(side)}`);
    name.title = sideName(side);
    card.append(name);
    return card;
}

/** A long text's difference: tags taken out and put in, or the changed part in its place. */
function textCell(row) {
    const cell = el('div', 'anomalous-compare-text');
    const diff = textDifference(row.aText, row.bText);
    if (diff.tags) {
        const removed = diff.removed.map(tag => el('span', 'anomalous-compare-tag is-removed', `− ${tag}`));
        const added = diff.added.map(tag => el('span', 'anomalous-compare-tag is-added', `+ ${tag}`));
        // Both kinds show at first: half each, or more of one when the other has fewer.
        const firstRemoved = Math.max(SHOWN_TAGS / 2, SHOWN_TAGS - added.length);
        const shown = [...removed.slice(0, firstRemoved), ...added.slice(0, SHOWN_TAGS - Math.min(removed.length, firstRemoved))];
        const rest = [...removed.slice(firstRemoved), ...added.slice(SHOWN_TAGS - Math.min(removed.length, firstRemoved))];
        cell.append(...shown);
        if (rest.length) {
            const more = button('anomalous-compare-more', t('compareMoreTags', { count: rest.length }), () => more.replaceWith(...rest));
            cell.append(more);
        }
        return cell;
    }
    cell.append(document.createTextNode(diff.before), el('span', 'is-out', diff.aPart), el('span', 'is-in', diff.bPart), document.createTextNode(diff.after));
    return cell;
}

const cellText = (row, value) => (row.mode ? t(MODE_KEYS[value] || 'compareModeOn') : shownValue(value));

function rowLine(row, tick) {
    const line = el('div', 'anomalous-compare-row');
    const label = el('label', 'anomalous-compare-name');
    if (tick) label.append(tick);
    label.append(document.createTextNode(row.mode ? t('compareState') : row.name));
    if (ROLE_KEYS[row.role]) label.append(el('span', `anomalous-compare-role is-${row.role}`, t(ROLE_KEYS[row.role])));
    line.append(label);
    if (!row.mode && isLongText(row)) {
        line.append(textCell(row));
        return line;
    }
    for (const [value, className] of [[row.a, 'is-a'], [row.b, 'is-b']]) {
        const text = cellText(row, value);
        const cell = el('div', `anomalous-compare-value ${className}`, text);
        cell.title = text;
        line.append(cell);
    }
    return line;
}

function columnHeads() {
    const line = el('div', 'anomalous-compare-row is-head');
    line.append(el('span', '', t('compareParameter')), el('span', '', 'A'), el('span', '', 'B'));
    return line;
}

function nodeBlock(node, rows, ticks) {
    const block = el('div', 'anomalous-compare-node');
    const ids = node.aId === node.bId ? `#${node.bId}` : `A #${node.aId} · B #${node.bId}`;
    block.append(el('div', 'anomalous-compare-node-title', `${node.title} ${ids}`));
    for (const row of rows) block.append(rowLine(row, ticks?.get(row)));
    return block;
}

function nodeList(title, nodes) {
    const block = el('div', 'anomalous-compare-node is-structure');
    block.append(el('div', 'anomalous-compare-node-title', title));
    block.append(el('div', 'anomalous-compare-structure-list', nodes.map(node => `${node.title} #${node.id}`).join('、')));
    return block;
}

/**
 * Writes the ticked rows' image values onto the live canvas nodes, one Ctrl+Z step for all.
 * `fromKey`: the image side ('a' or 'b'); the canvas's node is the other side's id. Returns { done, skipped, undo }.
 */
function applyRows(entries, fromKey) {
    const graph = canvasGraph();
    const byNode = new Map();
    for (const { node, row } of entries) {
        const id = fromKey === 'a' ? node.bId : node.aId;
        if (!byNode.has(id)) byNode.set(id, { id, node, rows: [] });
        byNode.get(id).rows.push(row);
    }
    const results = [];
    let done = 0;
    let skipped = 0;
    for (const { id, node, rows } of byNode.values()) {
        const live = graph?.getNodeById?.(Number(id)) ?? graph?.getNodeById?.(id);
        const values = live?.type === node.type ? rows.map(row => ({ index: live.widgets?.findIndex(widget => widget?.name === row.name), value: row[fromKey] }))
            .filter(entry => entry.index >= 0) : [];
        try {
            if (!values.length) throw new Error('materialNoCompatibleValues');
            results.push(applyNodeMaterialValues(app, live, values, { record: false }));
            done += values.length;
            skipped += rows.length - values.length;
        } catch (_) {
            skipped += rows.length;
        }
    }
    if (results.length) recordCanvasStep(app);
    const undo = () => {
        for (const result of results.reverse()) {
            try { result.undo(); } catch (_) { /* the node changed since: leave it */ }
        }
        recordCanvasStep(app);
    };
    return { done, skipped, undo };
}

/** Opens the comparison of `left` and `right`, each { image: { filename, subfolder, type? } } or { canvas: true }. */
export function openParamCompare(left, right) {
    openWindow?.close();
    const controller = new AbortController();
    const sides = [left, right];
    let read = null;

    const overlay = el('div', 'anomalous-dialog-overlay anomalous-compare-overlay');
    const dialog = el('div', 'anomalous-compare-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const head = el('div', 'anomalous-compare-head');
    const sidesRow = el('div', 'anomalous-compare-sides');
    const summary = el('div', 'anomalous-compare-summary', t('compareLoading'));
    const body = el('div', 'anomalous-compare-body');
    const footer = el('div', 'anomalous-compare-footer');
    const close = () => {
        controller.abort();
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        if (openWindow?.close === close) openWindow = null;
    };
    const onKey = (event) => {
        if (event.key !== 'Escape' || document.querySelectorAll('.anomalous-dialog-overlay').length > 1) return;
        event.stopPropagation();
        close();
    };
    head.append(el('h3', 'anomalous-compare-title', t('compareTitle')), button('anomalous-compare-close', '×', close));
    head.lastChild.title = t('close');

    const render = () => {
        const [a, b] = read;
        const result = compareParams(a, b);
        const canvasKey = sides[0].canvas ? 'a' : (sides[1].canvas ? 'b' : null);
        const fromKey = canvasKey === 'a' ? 'b' : 'a';
        sidesRow.replaceChildren(sideCard(sides[0], 'A'), button('anomalous-compare-swap', '⇄', () => {
            sides.reverse();
            read.reverse();
            render();
        }), sideCard(sides[1], 'B'));
        sidesRow.children[1].title = t('compareSwap');

        const seeds = [];
        const ticks = new Map();
        const entries = [];
        let diffCount = 0;
        body.replaceChildren(columnHeads());
        for (const node of result.nodes) {
            const rows = node.rows.filter(row => !row.volatile);
            node.rows.filter(row => row.volatile).forEach(row => seeds.push({ node, row }));
            if (!rows.length) continue;
            diffCount += rows.length;
            if (canvasKey) {
                for (const row of rows.filter(item => !item.mode)) {
                    const tick = el('input');
                    tick.type = 'checkbox';
                    tick.checked = true;
                    tick.onchange = () => updateApply();
                    ticks.set(row, tick);
                    entries.push({ node, row, tick });
                }
            }
            body.append(nodeBlock(node, rows, ticks));
        }
        if (!diffCount) body.append(el('div', 'anomalous-compare-empty', t(result.compared ? 'compareNoDifference' : 'compareNothingPaired')));
        if (seeds.length) {
            const details = el('details', 'anomalous-compare-seeds');
            details.append(el('summary', '', t('compareSeeds')));
            for (const { node, row } of seeds) details.append(nodeBlock(node, [row]));
            body.append(details);
        }
        if (result.onlyA.length) body.append(nodeList(t('compareOnlyIn', { side: 'A' }), result.onlyA));
        if (result.onlyB.length) body.append(nodeList(t('compareOnlyIn', { side: 'B' }), result.onlyB));
        if (result.rewired.length) body.append(nodeList(t('compareRewired'), result.rewired));

        summary.replaceChildren(
            el('span', `anomalous-compare-badge ${result.sameStructure ? 'is-same' : 'is-other'}`, t(result.sameStructure ? 'compareSameStructure' : 'compareOtherStructure')),
            document.createTextNode(t('compareSummary', { diff: diffCount, same: result.sameCount })),
        );

        const apply = button('anomalous-compare-apply', '', () => {
            const picked = entries.filter(entry => entry.tick.checked);
            if (!picked.length) return;
            const { done, skipped, undo } = applyRows(picked, fromKey);
            const message = t('compareApplied', { count: done }) + (skipped ? t('compareApplySkipped', { count: skipped }) : '');
            showWorkbenchToast(message, done ? { label: t('compareUndo'), run: () => { undo(); refreshCanvas(); } } : null);
            refreshCanvas();
        });
        const updateApply = () => {
            const count = entries.filter(entry => entry.tick.checked).length;
            apply.textContent = count ? t('compareApply', { count }) : t('compareApplyNone');
            apply.disabled = !count;
        };
        updateApply();
        footer.replaceChildren();
        if (canvasKey) footer.append(el('div', 'anomalous-compare-hint', t('compareCanvasHint')));
        footer.append(button('anomalous-compare-done', t('compareClose'), close));
        if (canvasKey && entries.length) footer.append(apply);
    };
    const refreshCanvas = () => {
        if (!overlay.isConnected) return;
        read = read.map((params, index) => (sides[index].canvas ? readParams(canvasGraph()) : params));
        render();
    };

    overlay.onclick = (event) => { if (event.target === overlay) close(); };
    dialog.append(head, sidesRow, summary, body, footer);
    overlay.append(dialog);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    openWindow = { close };
    sidesRow.append(sideCard(left, 'A'), sideCard(right, 'B'));
    footer.append(button('anomalous-compare-done', t('compareClose'), close));

    Promise.all(sides.map(side => readSide(side, controller.signal))).then((params) => {
        if (controller.signal.aborted) return;
        read = params;
        render();
    }).catch((error) => {
        if (controller.signal.aborted) return;
        summary.textContent = t('compareLoadFailed', { error: error?.message || String(error) });
        summary.classList.add('is-error');
    });
    return close;
}

// ---- The gallery's pick: the first image waits for a second one or the canvas. ----

const pickKey = image => `${image.subfolder || ''}\n${image.filename}`;

export const isComparePicked = (owner, image) => owner.comparePick && pickKey(owner.comparePick) === pickKey(image);

function clearPick(owner) {
    owner.comparePick = null;
    owner.galleryPanel?.querySelectorAll('.anomalous-gallery-card.is-compare-picked').forEach(card => card.classList.remove('is-compare-picked'));
    owner.galleryPanel?.querySelector('.anomalous-compare-bar')?.remove();
}

function showPickBar(owner) {
    owner.galleryPanel?.querySelector('.anomalous-compare-bar')?.remove();
    const image = owner.comparePick;
    const bar = el('div', 'anomalous-compare-bar');
    bar.append(
        el('span', 'anomalous-compare-bar-text', t('comparePicked', { name: image.filename })),
        button('anomalous-compare-bar-btn', t('compareWithCanvas'), () => {
            clearPick(owner);
            openParamCompare({ image }, { canvas: true });
        }),
        button('anomalous-compare-bar-btn is-quiet', t('dialogCancel'), () => clearPick(owner)),
    );
    owner.galleryPanel?.append(bar);
}

/** The ⇄ of a card: the first press picks the image, a second image's opens the comparison. */
export function pressCompare(owner, image, card) {
    if (isComparePicked(owner, image)) {
        clearPick(owner);
        return;
    }
    if (owner.comparePick) {
        const first = owner.comparePick;
        clearPick(owner);
        openParamCompare({ image: first }, { image });
        return;
    }
    owner.comparePick = { filename: image.filename, subfolder: image.subfolder || '' };
    card.classList.add('is-compare-picked');
    showPickBar(owner);
}