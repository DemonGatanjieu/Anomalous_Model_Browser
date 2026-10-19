/**
 * The current-node panel's parameters: every saved set of values for the node's type
 * (node_parameter_sets.js: materials and recipes, merged), as cards or side by side. A card
 * shows the picture made with its values (or the one they were kept from) and says where they
 * came from: a workflow's parameter set (Open shows it there), a kept picture (open it), or
 * saved here, with the day. Then each value it would change as a picture (numbers as two bars,
 * choices as old → new) and what stays and why (seeds, model files, choices this computer does
 * not have); "Show all" lists the equal values too. ⇄ compares the whole workflow with the
 * canvas; one press puts the changes in (the receipt undoes it); saved values (not a
 * recipe's) can be deleted. Side by side: the current values and every set in columns, the
 * ones a set would change marked. "Save these values" keeps the node's values for the next
 * node of its kind. On top, one line on where the node's values came from: the set last put
 * in here (marked on its card too) and what changed since, with a way to put them back; or,
 * without that, the set the values match or come closest to.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { showApplyReceipt } from './ui_apply_receipt.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { openParamCompare } from './ui_param_compare.js';
import {
    appliedState, applyParameterChanges, closestSet, deleteSavedValues, isAppliedEntry, loadParameterSets, loadSetPictures,
    parameterRows, rememberApplied, restoreApplied, saveNodeParameters,
} from './node_parameter_sets.js';

const SEARCH_FROM = 6; // entries before a search box is worth showing
const VIEW_KEY = 'anomalous_node_params_view'; // 'cards' | 'table', this browser's choice
const ROLE_KEYS = { positive: 'recipePromptRolePositive', negative: 'recipePromptRoleNegative', both: 'recipePromptRoleBoth' };
const KEEP_KEYS = { seed: 'currentNodeKeepSeed', model: 'currentNodeKeepModel', missing: 'currentNodeKeepMissing' };
const SHOWN_SINCE = 3; // changes named in the line on top; the rest are counted
const ICONS = {
    workflow: '<rect x="3" y="4" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/><path d="M6.5 10v4a3 3 0 0 0 3 3H14"/>',
    picture: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/>',
    saved: '<path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/>',
    lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5v4h4"/><path d="M12 8v4.5l3 2"/>',
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

function icon(name) {
    const span = el('span', 'anomalous-node-param-icon');
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`; // static markup only
    return span;
}

const brief = (value) => {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ') : JSON.stringify(value) ?? '';
    return text.length > 48 ? `${text.slice(0, 47)}…` : text;
};

/** "10月3日" (with the year when it is not this one); '' without a time. */
function dayOf(stamp) {
    if (!stamp) return '';
    const date = new Date(stamp < 1e12 ? stamp * 1000 : stamp);
    if (Number.isNaN(date.getTime())) return '';
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "今天 10:32", or the day and the time. */
function whenOf(stamp) {
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) return '';
    const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return date.toDateString() === new Date().toDateString() ? t('currentNodeToday', { time }) : `${dayOf(stamp)} ${time}`;
}

/** "cfg 5 → 6、步数 15 → 20 等 2 项". */
function changesText(changes, from, to) {
    const named = changes.slice(0, SHOWN_SINCE).map(change => `${change.label} ${brief(change[from])} → ${brief(change[to])}`);
    const text = named.join(t('modelSourceListSep'));
    return changes.length > SHOWN_SINCE ? `${text} ${t('currentNodeAppliedMore', { count: changes.length - SHOWN_SINCE })}` : text;
}

const outputQuery = image => new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '' });

/** The entry's picture: the newest made with its values, else the one it was kept from; null for none. */
function pictureOf(entry, pictures) {
    for (const source of entry.sources) {
        const made = source.signature && pictures[source.signature]?.newest;
        if (made) return { thumb: `/anomalous/output_thumbnail?${outputQuery(made)}`, full: `/view?${outputQuery(made)}&type=output`, title: made.filename };
    }
    for (const source of entry.sources) {
        if (source.preview) return { thumb: source.preview, full: source.image ? `/view?${outputQuery(source.image)}&type=output` : source.preview, title: source.image?.filename || source.label };
        if (source.image) return { thumb: `/anomalous/output_thumbnail?${outputQuery(source.image)}`, full: `/view?${outputQuery(source.image)}&type=output`, title: source.image.filename };
    }
    return null;
}

/** Shows a recipe's details on one of its parameter sets. */
function openSet(owner, source) {
    // Opening goes to the Workflows page at once (which forgets any state to return to), then reads the recipe.
    const opening = owner.openRecipeByFilename(source.recipeFile);
    owner.recipeReturnState = { activeTab: 'set', filename: source.setFile };
    return opening;
}

/** Compares the whole workflow behind the entry with the canvas: a recipe set's, else the kept picture's. */
async function compareWithCanvas(entry) {
    const set = entry.sources.find(source => source.kind === 'recipe' && source.setFile);
    if (!set) {
        const kept = entry.sources.find(source => source.image);
        openParamCompare({ image: { ...kept.image, type: 'output' } }, { canvas: true });
        return;
    }
    try {
        const response = await fetch(`/anomalous/parameters?recipe_filename=${encodeURIComponent(set.recipeFile)}`, { cache: 'no-store' });
        const notebooks = response.ok ? (await response.json()).notebooks || [] : [];
        const workflow = notebooks.find(notebook => notebook.filename === set.setFile)?.data?.workflow;
        if (!workflow) throw new Error('no workflow');
        openParamCompare({ workflow, label: set.setName || entry.name }, { canvas: true });
    } catch (error) {
        showWorkbenchToast(t('currentNodeCompareFailed'));
    }
}

/** One line on where the values came from: an icon, what, the day, and a way to open it. */
function sourceLine(source, pictures, owner) {
    const line = el('div', 'anomalous-node-param-from');
    let text;
    let open = null;
    if (source.kind === 'recipe') {
        line.append(icon('workflow'));
        text = t('currentNodeFromSet', { recipe: source.label });
        const count = pictures[source.signature]?.count;
        if (count) text += ` · ${t('currentNodeSetPictures', { count })}`;
        if (source.setFile && source.recipeFile) open = button('anomalous-node-param-link', t('currentNodeOpenSet'), () => openSet(owner, source));
    } else if (source.image) {
        line.append(icon('picture'));
        text = t('currentNodeFromPicture', { name: source.image.filename.replace(/\.[^.]+$/, '') });
        open = button('anomalous-node-param-link', t('currentNodeSeePicture'), () => owner.showGalleryViewer?.(`/view?${outputQuery(source.image)}&type=output`));
    } else {
        line.append(icon('saved'));
        text = source.origin === 'canvas_node' ? t('currentNodeFromHere') : source.label;
    }
    const day = dayOf(source.timestamp);
    line.append(el('span', 'anomalous-node-param-from-text', day ? `${text} · ${day}` : text));
    if (open) line.append(open);
    return line;
}

/** A value the entry would change: numbers as two bars (now, then), other values as old → new. */
function changeRow(row) {
    const line = el('div', 'anomalous-node-param-row is-change');
    line.title = `${row.label}: ${typeof row.to === 'string' ? row.to : JSON.stringify(row.to)}`;
    line.append(el('span', 'anomalous-node-param-label', row.label));
    const numbers = typeof row.from === 'number' && typeof row.to === 'number' && Number.isFinite(row.from) && Number.isFinite(row.to);
    if (numbers) {
        const largest = Math.max(Math.abs(row.from), Math.abs(row.to)) || 1;
        const bars = el('span', 'anomalous-node-param-bars');
        for (const [value, kind] of [[row.from, 'is-now'], [row.to, 'is-then']]) {
            const bar = el('span', `anomalous-node-param-bar ${kind}`);
            bar.style.width = `${Math.max(3, (Math.abs(value) / largest) * 100)}%`; // the value's share of the larger one
            bars.append(bar);
        }
        const values = el('span', 'anomalous-node-param-nums');
        values.append(el('span', 'is-now', brief(row.from)), el('span', '', ' → '), el('strong', '', brief(row.to)),
            el('span', 'anomalous-node-param-trend', row.to > row.from ? '↑' : '↓'));
        line.append(bars, values);
    } else {
        const values = el('span', 'anomalous-node-param-swap');
        values.append(el('span', 'anomalous-node-param-pill is-now', brief(row.from)), el('span', '', '→'), el('span', 'anomalous-node-param-pill is-then', brief(row.to)));
        line.append(values);
    }
    return line;
}

/** A value that stays (with why) or is the same already: dim, on one line. */
function quietRow(row) {
    const line = el('div', `anomalous-node-param-row is-${row.status === 'same' ? 'same' : 'kept'}`);
    line.append(el('span', 'anomalous-node-param-label', row.label));
    const value = el('span', 'anomalous-node-param-quiet');
    if (row.status !== 'same') value.append(icon('lock'));
    value.append(document.createTextNode(row.status === 'same' ? brief(row.to) : `${brief(row.to)} · ${t(KEEP_KEYS[row.status])}`));
    line.append(value);
    line.title = `${row.label}: ${typeof row.to === 'string' ? row.to : JSON.stringify(row.to)}`;
    return line;
}

/** Puts `made` into the node; with `entry` (and its `rows`), remembers it as the set last put in, until undone. */
function applyChanges(node, made, receiptHost, redraw, entry = null, rows = []) {
    try {
        const result = applyParameterChanges(app, node, made);
        const previous = entry ? rememberApplied(app, node, entry, rows) : null;
        showApplyReceipt(receiptHost, {
            undo() {
                result.undo();
                if (entry) restoreApplied(app, node, previous);
                redraw();
            },
        }, node);
        redraw();
    } catch (error) {
        showWorkbenchToast(t(error.message) === error.message ? t('materialApplyFailed') : t(error.message));
    }
}

function entryCard(node, entry, ctx) {
    const rows = parameterRows(node, entry.values);
    const made = rows.filter(row => row.status === 'change');
    const kept = rows.filter(row => row.status !== 'change' && row.status !== 'same');
    const same = rows.filter(row => row.status === 'same');
    const key = JSON.stringify(entry.values);
    const card = el('div', 'anomalous-node-param');

    const top = el('div', 'anomalous-node-param-top');
    const picture = pictureOf(entry, ctx.pictures);
    if (picture) {
        const thumb = button('anomalous-node-param-thumb', undefined, () => ctx.owner.showGalleryViewer?.(picture.full));
        thumb.title = picture.title;
        const img = el('img');
        img.alt = '';
        img.loading = 'lazy';
        img.src = picture.thumb;
        img.onerror = () => thumb.replaceChildren(icon('picture'));
        thumb.append(img);
        top.append(thumb);
    } else {
        top.append(el('span', 'anomalous-node-param-thumb is-empty'));
        top.lastChild.append(icon(entry.sources.some(source => source.kind === 'recipe') ? 'workflow' : 'saved'));
    }
    const main = el('div', 'anomalous-node-param-main');
    const head = el('div', 'anomalous-node-param-head');
    head.append(el('strong', 'anomalous-node-param-name', entry.name));
    if (ROLE_KEYS[entry.role]) head.append(el('span', `anomalous-node-param-role is-${entry.role}`, t(ROLE_KEYS[entry.role])));
    if (isAppliedEntry(entry, ctx.applied?.record)) head.append(el('span', 'anomalous-node-param-last', t('currentNodeLastBadge')));
    main.append(head);
    const seen = new Set();
    for (const source of entry.sources) {
        const id = `${source.kind}|${source.setFile || source.filename || source.label}`;
        if (seen.has(id)) continue;
        seen.add(id);
        main.append(sourceLine(source, ctx.pictures, ctx.owner));
    }
    top.append(main);
    card.append(top);

    const list = el('div', 'anomalous-node-param-rows');
    list.append(...made.map(changeRow));
    const open = ctx.expanded.has(key);
    if (open) list.append(...kept.map(quietRow), ...same.map(quietRow));
    else if (kept.length) {
        const line = el('div', 'anomalous-node-param-row is-kept');
        const text = el('span', 'anomalous-node-param-quiet');
        const parts = [...new Set(kept.map(row => row.status))].map(status => t('currentNodeKeptPart', {
            names: kept.filter(row => row.status === status).map(row => row.label).join(t('modelSourceListSep')), why: t(KEEP_KEYS[status]),
        }));
        text.append(icon('lock'), document.createTextNode(t('currentNodeKeptLine', { names: parts.join(t('currentNodeKeptSep')) })));
        line.append(text);
        list.append(line);
    }
    if (!made.length && !open) list.append(el('p', 'anomalous-node-muted', t('currentNodeSame')));
    card.append(list);

    const actions = el('div', 'anomalous-node-param-actions');
    if (same.length || kept.length) {
        actions.append(button('anomalous-node-param-more', open ? t('currentNodeShowLess') : t('currentNodeShowAll', { count: rows.length }), () => {
            if (open) ctx.expanded.delete(key);
            else ctx.expanded.add(key);
            ctx.redraw();
        }));
    }
    actions.append(el('span', 'anomalous-node-param-gap'));
    if (entry.sources.some(source => (source.kind === 'recipe' && source.setFile) || source.image)) {
        const compare = button('anomalous-node-param-secondary', t('currentNodeCompare'), () => compareWithCanvas(entry));
        compare.title = t('currentNodeCompareHint');
        actions.append(compare);
    }
    // Values saved here or kept from images can be deleted; a recipe's sets belong to the recipe.
    const saved = [...new Set(entry.sources.filter(source => source.kind === 'material' && source.filename).map(source => source.filename))];
    if (saved.length) actions.append(button('anomalous-node-param-delete', t('currentNodeDelete'), () => ctx.remove(entry, saved)));
    const apply = button('anomalous-node-param-apply', made.length ? t('currentNodeApply', { count: made.length }) : t('currentNodeSame'),
        () => applyChanges(node, made, ctx.section, ctx.redraw, entry, rows));
    apply.disabled = !made.length;
    actions.append(apply);
    card.append(actions);
    return card;
}

/**
 * Side by side: a column for now and for each set, a row per value any set would change (first)
 * or keeps as it is (seeds and the like, after).
 */
function entryTable(node, entries, ctx) {
    const sets = entries.map(entry => ({ entry, rows: new Map(parameterRows(node, entry.values).map(row => [row.index, row])) }));
    const changed = index => sets.some(set => set.rows.get(index)?.status === 'change');
    const indexes = [...new Set(sets.flatMap(set => [...set.rows.values()].filter(row => row.status !== 'same').map(row => row.index)))]
        .sort((a, b) => (changed(b) - changed(a)) || a - b);
    const wrap = el('div', 'anomalous-node-param-table-wrap');
    const table = el('table', 'anomalous-node-param-table');
    const head = el('tr');
    head.append(el('th', ''), el('th', 'is-now', t('currentNodeNow')));
    for (const { entry } of sets) {
        const cell = el('th');
        const picture = pictureOf(entry, ctx.pictures);
        const thumb = picture ? button('anomalous-node-param-table-thumb', undefined, () => ctx.owner.showGalleryViewer?.(picture.full))
            : el('span', 'anomalous-node-param-table-thumb is-empty');
        if (picture) {
            const img = el('img');
            img.alt = '';
            img.loading = 'lazy';
            img.src = picture.thumb;
            thumb.append(img);
        }
        cell.append(thumb, el('span', 'anomalous-node-param-table-name', entry.name));
        if (isAppliedEntry(entry, ctx.applied?.record)) cell.append(el('span', 'anomalous-node-param-last', t('currentNodeLastBadge')));
        cell.title = entry.name;
        head.append(cell);
    }
    table.append(head);
    for (const index of indexes) {
        const widget = node.widgets?.[index];
        const tr = el('tr');
        tr.append(el('td', 'anomalous-node-param-label', widget?.label || widget?.name || `#${index}`), el('td', 'is-now', brief(widget?.value)));
        for (const { rows } of sets) {
            const row = rows.get(index);
            const cell = el('td', row ? `is-${row.status}` : 'is-none', row ? brief(row.to) : '—');
            if (row && row.status !== 'change' && row.status !== 'same') cell.title = t(KEEP_KEYS[row.status]);
            tr.append(cell);
        }
        table.append(tr);
    }
    const foot = el('tr', 'anomalous-node-param-table-foot');
    foot.append(el('td'), el('td'));
    for (const { entry, rows } of sets) {
        const made = [...rows.values()].filter(row => row.status === 'change');
        const cell = el('td');
        const apply = button('anomalous-node-param-apply', made.length ? t('currentNodeApplyShort', { count: made.length }) : t('currentNodeSame'),
            () => applyChanges(node, made, ctx.section, ctx.redraw, entry, [...rows.values()]));
        apply.disabled = !made.length;
        apply.title = entry.name;
        cell.append(apply);
        foot.append(cell);
    }
    table.append(foot);
    wrap.append(table);
    if (!indexes.length) wrap.append(el('p', 'anomalous-node-muted', t('currentNodeAllSame')));
    return wrap;
}

/**
 * The line on top: the set last put into this node and what changed since (Put back puts
 * those back); without one, the set the values match or come closest to. Null for neither.
 */
function historyLine(node, entries, ctx) {
    const line = el('div', 'anomalous-node-param-history');
    line.append(icon('history'));
    const state = ctx.applied;
    if (state) {
        const { record, changed } = state;
        line.append(el('span', 'anomalous-node-param-history-main', t('currentNodeAppliedLast', { name: record.name, when: whenOf(record.at) })));
        line.append(el('span', `anomalous-node-param-history-note${changed.length ? '' : ' is-same'}`,
            changed.length ? t('currentNodeAppliedChanged', { changes: changesText(changed, 'from', 'to') }) : t('currentNodeAppliedSame')));
        if (changed.length) {
            const back = changed.map(change => ({ index: change.index, label: change.label, from: change.to, to: change.from, keep: '' }));
            line.append(button('anomalous-node-param-link', t('currentNodeAppliedRestore'), () => applyChanges(node, back, ctx.section, ctx.redraw)));
        }
        return line;
    }
    const near = closestSet(node, entries);
    if (!near) return null;
    const text = near.changes.length
        ? t('currentNodeClosest', { name: near.entry.name, changes: changesText(near.changes, 'from', 'to') })
        : t('currentNodeMatches', { name: near.entry.name }) + (near.others ? t('currentNodeMatchesMore', { count: near.others }) : '');
    line.append(el('span', 'anomalous-node-param-history-main', text));
    return line;
}

function readView() {
    try { return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards'; } catch { return 'cards'; }
}

function keepView(view) {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* the choice is only a convenience */ }
}

/** Appends the parameters section for `node` to `container` and loads its entries. */
export function renderNodeParameters(node, container, owner) {
    const section = el('section', 'anomalous-node-section anomalous-node-params');
    const head = el('div', 'anomalous-node-section-head');
    const views = el('div', 'anomalous-node-param-views');
    views.setAttribute('role', 'radiogroup');
    const search = el('input', 'anomalous-node-param-search');
    search.type = 'search';
    search.placeholder = t('currentNodeSearch');
    search.hidden = true;
    const list = el('div', 'anomalous-node-param-list');
    list.append(el('p', 'anomalous-node-muted', t('loading')));
    section.append(head, search, list);
    container.append(section);

    let entries = [];
    let view = readView();
    const ctx = { owner, section, pictures: {}, expanded: new Set(), applied: null, redraw: () => draw(), remove: (entry, files) => remove(entry, files) };
    const paintViews = () => {
        views.hidden = entries.length < 2;
        views.replaceChildren(...[['cards', 'currentNodeViewCards'], ['table', 'currentNodeViewTable']].map(([name, label]) => {
            const choice = button(`anomalous-node-param-view${view === name ? ' is-on' : ''}`, t(label), () => {
                view = name;
                keepView(name);
                draw();
            });
            choice.setAttribute('role', 'radio');
            choice.setAttribute('aria-checked', String(view === name));
            return choice;
        }));
    };
    const draw = () => {
        ctx.applied = appliedState(app, node);
        const query = search.value.trim().toLowerCase();
        const shown = entries.filter(entry => !query
            || `${entry.name} ${entry.sources.map(source => `${source.label} ${source.image?.filename || ''}`).join(' ')}`.toLowerCase().includes(query));
        search.hidden = entries.length < SEARCH_FROM;
        paintViews();
        const history = historyLine(node, entries, ctx);
        const top = history ? [history] : [];
        if (!shown.length) list.replaceChildren(...top, el('p', 'anomalous-node-muted', t(entries.length ? 'currentNodeNoMatch' : 'currentNodeNoSets')));
        else if (view === 'table' && entries.length >= 2) list.replaceChildren(...top, entryTable(node, shown, ctx));
        else list.replaceChildren(...top, ...shown.map(entry => entryCard(node, entry, ctx)));
    };
    search.oninput = draw;

    const load = async () => {
        const run = (section._load = (section._load || 0) + 1);
        try {
            const loaded = await loadParameterSets(node.type);
            if (run !== section._load || !section.isConnected) return;
            entries = loaded;
            draw();
            // The pictures made with the sets' values come after: one pass over the recent outputs.
            const pictures = await loadSetPictures(loaded);
            if (run !== section._load || !section.isConnected || !Object.keys(pictures).length) return;
            ctx.pictures = pictures;
            draw();
        } catch (error) {
            if (run === section._load) list.replaceChildren(el('p', 'anomalous-node-muted is-error', t('currentNodeLoadFailed')));
        }
    };

    const remove = async (entry, filenames) => {
        if (!await anomalousConfirm(t('currentNodeDeleteConfirm', { name: entry.name }), t('currentNodeDelete'), { okLabel: t('currentNodeDelete') })) return;
        try {
            for (const filename of filenames) await deleteSavedValues(filename);
        } catch (error) {
            showWorkbenchToast(t('currentNodeDeleteFailed'));
        }
        if (section.isConnected) load();
    };

    const save = async () => {
        const name = await anomalousPrompt(t('currentNodeSaveName'), node.title || node.type, t('currentNodeSave'));
        if (name === null) return;
        try {
            const result = await saveNodeParameters(node, name || node.title || node.type);
            showWorkbenchToast(t(result.status === 'duplicate' ? 'currentNodeSavedBefore' : 'currentNodeSaved', { name: result.name }));
            if (section.isConnected) load();
        } catch (error) {
            showWorkbenchToast(t('currentNodeSaveFailed'));
        }
    };
    const tools = el('div', 'anomalous-node-param-tools');
    tools.append(views, button('anomalous-node-section-btn', t('currentNodeSave'), save));
    head.append(el('h3', '', t('currentNodeParams')), tools);
    views.hidden = true;
    load();
}
