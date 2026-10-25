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
import { readDetached } from './detached_graph.js';
import { applyNodeMaterialValues } from './node_material_actions.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { keyParamTest, onKeyParamsChange, toggleKeyParam } from './key_params.js';
import { compareParams, isLongText, readParams, shownValue, textDifference } from './param_compare.js';

const MODE_KEYS = { 0: 'compareModeOn', 2: 'compareModeMuted', 4: 'compareModeBypassed' };
const SHOWN_TAGS = 10; // per side: a prompt swapped whole lists every tag, the rest wait behind a button
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
const sideName = side => (side.canvas ? t('compareCanvas') : (side.label || side.image?.filename || ''));
const sideTitle = side => (side.image?.filename && side.label ? `${side.label} · ${side.image.filename}` : sideName(side));

/** One side's parameters: the canvas as it is now, a saved workflow, or the workflow kept in an output image. */
async function readSide(side, signal) {
    if (side.canvas) return readParams(canvasGraph());
    if (side.workflow) return readDetached(side.workflow, readParams);
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
    return readDetached(workflow, readParams);
}

function sideCard(side, letter) {
    const card = el('div', 'anomalous-compare-side');
    if (side.canvas || side.workflow) card.append(el('div', 'anomalous-compare-thumb is-canvas', side.canvas ? '▦' : '▤'));
    else {
        const img = el('img', 'anomalous-compare-thumb');
        img.src = `/anomalous/output_thumbnail?${imageQuery(side.image)}`;
        img.alt = '';
        card.append(img);
    }
    const name = el('div', 'anomalous-compare-side-name', sideTitle(side));
    name.title = sideTitle(side);
    card.append(letterBadge(letter), name);
    return card;
}

/** A or B in its own colour, the same in the side cards, the column heads and the text lines. */
const letterBadge = letter => el('span', `anomalous-compare-letter is-${letter.toLowerCase()}`, letter);

/** One side's line of a long text: its letter, then its tags or its text with the differing part marked. */
function textLine(letter, parts) {
    const line = el('div', `anomalous-compare-text-line is-${letter.toLowerCase()}`);
    line.append(letterBadge(letter), ...parts);
    return line;
}

/** A long text's difference, one line per side: the tags only that side has, or its differing part in place. */
function textCell(row) {
    const cell = el('div', 'anomalous-compare-text');
    const diff = textDifference(row.aText, row.bText);
    if (diff.tags) {
        for (const [letter, tags] of [['A', diff.onlyA], ['B', diff.onlyB]]) {
            if (!tags.length) continue;
            const chips = tags.map(tag => el('span', 'anomalous-compare-tag', tag));
            const parts = [el('span', 'anomalous-compare-line-label', t('compareTagsOnly')), ...chips.slice(0, SHOWN_TAGS)];
            if (chips.length > SHOWN_TAGS) {
                const more = button('anomalous-compare-more', t('compareMoreTags', { count: chips.length - SHOWN_TAGS }), () => more.replaceWith(...chips.slice(SHOWN_TAGS)));
                parts.push(more);
            }
            cell.append(textLine(letter, parts));
        }
        return cell;
    }
    for (const [letter, part] of [['A', diff.aPart], ['B', diff.bPart]]) {
        const text = el('span', 'anomalous-compare-text-body');
        // A side with nothing where the other has more shows no mark: the other's line marks it.
        text.append(document.createTextNode(diff.before), ...(part ? [el('mark', '', part)] : []), document.createTextNode(diff.after));
        cell.append(textLine(letter, [text]));
    }
    return cell;
}

const cellText = (row, value) => (row.mode ? t(MODE_KEYS[value] || 'compareModeOn') : shownValue(value));

/** The ☆ beside a value's name: stars (or unstars) that widget of that node type everywhere. */
function starButton(node, row, starred) {
    const star = button(`anomalous-compare-star${starred ? ' is-on' : ''}`, starred ? '★' : '☆', () => {
        star.disabled = true;
        toggleKeyParam(node.type, row.name).catch(() => { star.disabled = false; });
    });
    star.title = t(starred ? 'compareUnstar' : 'compareStar');
    return star;
}

/**
 * A value's line: its name (with the star, the tick, the node's title for a key value, and the
 * workflow's mark with its note for a focus value), then A and B.
 */
function rowLine(row, tick, { node = null, starred = false, prefix = '', focus = null } = {}) {
    const line = el('div', `anomalous-compare-row${row.same ? ' is-same' : ''}`);
    const name = el('div', 'anomalous-compare-name');
    if (node && !row.mode) name.append(starButton(node, row, starred));
    const label = el('label', 'anomalous-compare-label');
    if (tick) label.append(tick);
    if (prefix) label.append(el('span', 'anomalous-compare-prefix', prefix));
    label.append(document.createTextNode(row.mode ? t('compareState') : row.name));
    name.append(label);
    if (focus) line.append(el('div', 'anomalous-compare-focus', `◆ ${focus.note ? `${t('focusBadge')} · ${focus.note}` : t('focusBadge')}`));
    if (ROLE_KEYS[row.role]) name.append(el('span', `anomalous-compare-role is-${row.role}`, t(ROLE_KEYS[row.role])));
    line.append(name);
    if (!row.mode && isLongText(row)) {
        // The same long value on both sides is written once, across both columns.
        line.append(row.same ? el('div', 'anomalous-compare-value is-both', shownValue(row.a)) : textCell(row));
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
    const head = (letter) => {
        const cell = el('span');
        cell.append(letterBadge(letter));
        return cell;
    };
    line.append(el('span', '', t('compareParameter')), head('A'), head('B'));
    return line;
}

function nodeBlock(node, rows, ticks) {
    const block = el('div', 'anomalous-compare-node');
    const ids = node.aId === node.bId ? `#${node.bId}` : `A #${node.aId} · B #${node.bId}`;
    block.append(el('div', 'anomalous-compare-node-title', `${node.title} ${ids}`));
    for (const row of rows) block.append(rowLine(row, ticks?.get(row), { node }));
    return block;
}

/** The focus and starred values first (the workflow's focus values leading), equal ones too (dimmed), each with its node's title. */
function keyBlock(keys, ticks, starred, focus) {
    const block = el('div', 'anomalous-compare-node is-keys');
    block.append(el('div', 'anomalous-compare-node-title', t('compareKeys')));
    const marked = keys.map(key => ({ ...key, mark: focus?.(key.node.type, key.row.name, key.node.bId, key.node.aId) || null }));
    marked.sort((x, y) => Boolean(y.mark) - Boolean(x.mark));
    for (const { node, row, mark } of marked) {
        block.append(rowLine(row, ticks.get(row), { node, starred: starred(node.type, row.name), prefix: node.title, focus: mark }));
    }
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

/**
 * Opens the comparison of `left` and `right`, each { image: { filename, subfolder, type? } },
 * { workflow, label } (a recipe or one of its parameter sets) or { canvas: true }. `focus`: a
 * workflow's focus values (recipe_focus.js focusTest), listed first with the starred ones.
 */
export function openParamCompare(left, right, { focus = null } = {}) {
    openWindow?.close();
    const controller = new AbortController();
    const sides = [left, right];
    let read = null;
    let showSame = false; // equal values listed too, so they can be starred

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
        stopStars();
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
        const starred = keyParamTest();
        const isKey = (type, widget, ...ids) => starred(type, widget) || Boolean(focus?.(type, widget, ...ids));
        const result = compareParams(a, b, { isKey, includeSame: showSame });
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
        const tickFor = (node, row) => {
            const tick = el('input');
            tick.type = 'checkbox';
            tick.checked = true;
            tick.onchange = () => updateApply();
            ticks.set(row, tick);
            entries.push({ node, row, tick });
        };
        for (const { node, row } of result.keys) {
            if (row.same) continue;
            diffCount += 1;
            if (canvasKey && !row.volatile) tickFor(node, row);
        }
        if (result.keys.length) body.append(keyBlock(result.keys, ticks, starred, focus));
        else body.append(el('div', 'anomalous-compare-key-hint', t('compareKeyHint')));
        for (const node of result.nodes) {
            const rows = node.rows.filter(row => !row.volatile);
            node.rows.filter(row => row.volatile).forEach(row => seeds.push({ node, row }));
            if (!rows.length) continue;
            diffCount += rows.filter(row => !row.same).length;
            if (canvasKey) rows.filter(item => !item.mode && !item.same).forEach(row => tickFor(node, row));
            body.append(nodeBlock(node, rows, ticks));
        }
        if (!diffCount && !showSame) body.append(el('div', 'anomalous-compare-empty', t(result.compared ? 'compareNoDifference' : 'compareNothingPaired')));
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
            sameToggle(),
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
    const sameToggle = () => {
        const label = el('label', 'anomalous-compare-same-toggle');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = showSame;
        box.onchange = () => { showSame = box.checked; render(); };
        label.append(box, document.createTextNode(t('compareShowSame')));
        return label;
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
    // A star changed here or elsewhere: the starred values move up or back.
    const stopStars = onKeyParamsChange(() => { if (read && overlay.isConnected) render(); });
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

// ---- The canvas beside the newest picture: what changed since the last run. ----

/** The newest output picture that can hold a workflow (a PNG), or null. */
async function newestPicture() {
    const response = await fetch('/anomalous/gallery_images?page=1&limit=40&refresh=1', { cache: 'no-store' });
    if (!response.ok) return null;
    const { images = [] } = await response.json();
    const image = images.find(item => /\.png$/i.test(item?.filename || ''));
    return image ? { filename: image.filename, subfolder: image.subfolder || '' } : null;
}

/** A button comparing the newest picture with the canvas (the gallery's and the activity page's). */
export function newestCompareButton(className) {
    const node = button(className, `⇄ ${t('compareNewest')}`, async () => {
        node.disabled = true;
        try {
            const image = await newestPicture();
            if (image) openParamCompare({ image, label: t('compareNewestSide') }, { canvas: true });
            else showWorkbenchToast(t('compareNoPicture'));
        } catch (_) {
            showWorkbenchToast(t('compareNoPicture'));
        } finally {
            node.disabled = false;
        }
    });
    node.title = t('compareNewestHint');
    return node;
}

// ---- A pick among pictures (the gallery, a workflow's pictures): the first waits for a second one or another side. ----

const pickKey = image => `${image.subfolder || ''}\n${image.filename}`;

export const isComparePicked = (owner, image) => owner.comparePick && pickKey(owner.comparePick) === pickKey(image);

function clearPick(owner) {
    owner.comparePick = null;
    document.querySelectorAll('.is-compare-picked').forEach(card => card.classList.remove('is-compare-picked'));
    owner.comparePickBar?.remove();
    owner.comparePickBar = null;
}

/** The bar under the pictures: what is picked, then the canvas and any `others` ({ label, side }) to compare it with. */
function showPickBar(owner, host, others, focus) {
    owner.comparePickBar?.remove();
    const image = owner.comparePick;
    const bar = el('div', 'anomalous-compare-bar');
    const sideButton = (label, side) => button('anomalous-compare-bar-btn', label, () => {
        clearPick(owner);
        openParamCompare({ image }, side, { focus });
    });
    bar.append(
        el('span', 'anomalous-compare-bar-text', t('comparePicked', { name: image.filename })),
        sideButton(t('compareWithCanvas'), { canvas: true }),
        ...others.map(({ label, side }) => sideButton(label, side)),
        button('anomalous-compare-bar-btn is-quiet', t('dialogCancel'), () => clearPick(owner)),
    );
    host?.append(bar);
    owner.comparePickBar = bar;
}

/**
 * The ⇄ of a picture's card: the first press picks it, a second picture's opens the comparison.
 * `host`: where the bar goes (the gallery by default); `others`: more sides the bar offers;
 * `focus`: the workflow's focus values, for pictures of one workflow.
 */
export function pressCompare(owner, image, card, { host = owner.galleryPanel, others = [], focus = null } = {}) {
    if (isComparePicked(owner, image)) {
        clearPick(owner);
        return;
    }
    if (owner.comparePick) {
        const first = owner.comparePick;
        clearPick(owner);
        openParamCompare({ image: first }, { image }, { focus });
        return;
    }
    owner.comparePick = { filename: image.filename, subfolder: image.subfolder || '' };
    card.classList.add('is-compare-picked');
    showPickBar(owner, host, others, focus);
}