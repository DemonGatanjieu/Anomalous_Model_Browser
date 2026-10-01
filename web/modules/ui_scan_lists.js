/**
 * The scan page's model lists: the last scan's result (what each model got, why Civitai had
 * nothing) and the models still unmatched or not scanned, from GET /anomalous/scan_summary.
 * Every row opens its model; rows offer "scan" / "look up again" and a Civitai search.
 * The page passes what the buttons do (`actions`); this module only renders.
 */

import { translate as t } from './locales.js';
import { dayLabel, timeLabel } from './activity_log.js';
import { countsLine, fileOutcome, isPending, reasonText, scanScope, STATUS_MARKS } from './scan_results.js';
import { typeLabel } from './ui_model_types.js';

const SHOWN_ROWS = 100; // more behind "show all"
const RESULT_ROWS = 8;

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

/** Opens a listed model's detail; its back button returns to `onBack` (the scan page). */
export async function openListedModel(owner, item, onBack) {
    const params = new URLSearchParams({ type: item.type, path_idx: item.path_idx, rel: item.rel });
    const data = await fetch(`/anomalous/scan_model?${params}`).then(res => res.json()).catch(() => ({}));
    if (!data.model) {
        alert(t('scanModelGone', { name: item.filename }));
        return;
    }
    owner.hideAllPanels();
    owner.historyStack = [];
    owner.currentType = data.model.type;
    owner.currentPathIdx = data.model.path_idx;
    owner.currentSubfolder = data.model.subfolder || '/';
    owner.currentDetailModel = data.model;
    owner.recipeModelReturn = onBack; // set after hideAllPanels, which clears it
    owner.showDetail(data.model);
}

/** Civitai's model search for a file name, to find a model by hand. */
function searchCivitai(item) {
    const query = item.filename.replace(/\.safetensors$/i, '').replace(/[_-]+/g, ' ');
    window.open(`https://civitai.com/search/models?query=${encodeURIComponent(query)}`, '_blank', 'noopener');
}

function where(item) {
    const folder = item.rel.includes('/') ? item.rel.slice(0, item.rel.lastIndexOf('/')) : '';
    return [item.type ? typeLabel({ type: item.type }) : '', folder].filter(Boolean).join(' · ');
}

/** One model: mark, file name, where it is, what about it, and its buttons. */
function row(item, detail, buttons, mark = '') {
    const line = el('div', `anomalous-scan-row${item.status ? ` is-${item.status}` : ''}`);
    if (mark) line.append(el('span', 'anomalous-scan-row-mark', mark));
    const copy = el('div', 'anomalous-scan-row-copy');
    const name = el('strong', 'anomalous-scan-row-name', item.filename);
    name.title = item.rel;
    copy.append(name, el('small', 'anomalous-scan-row-where', where(item)));
    if (detail) copy.append(el('small', 'anomalous-scan-row-detail', detail));
    const actions = el('div', 'anomalous-scan-row-actions');
    for (const [label, onClick, disabled] of buttons) {
        const node = button('anomalous-scan-row-btn', label, onClick);
        node.disabled = Boolean(disabled);
        actions.append(node);
    }
    line.append(copy, actions);
    return line;
}

/** Buttons for an unmatched model. */
function unmatchedButtons(item, actions) {
    return [
        [t('scanRowOpen'), () => actions.open(item)],
        ...(actions.offline ? [] : [[t('scanRowRetry'), () => actions.scan([item], { retry: true }), actions.busy]]),
        [t('scanRowSearch'), () => searchCivitai(item)],
    ];
}

/** Rows into `list`, the first `limit`, then a button for the rest. */
function fillRows(list, items, render, limit) {
    const shown = items.slice(0, limit);
    list.replaceChildren(...shown.map(render));
    if (items.length > shown.length) {
        list.append(button('anomalous-scan-more', t('scanShowAll', { count: items.length }), () => fillRows(list, items, render, Infinity)));
    }
}

/** The last scan: when, what, the counts, and each model it changed. Null before the first scan. */
export function renderLastScan(result, actions) {
    if (!result?.counts) return null;
    const box = el('section', 'anomalous-scan-card anomalous-scan-result');
    const seconds = Math.max(0, Math.round((result.finished || 0) - (result.started || 0)));
    const target = result.kind === 'one' ? result.files?.[0]?.filename : '';
    box.append(
        el('div', 'anomalous-scan-card-title', t('scanResultTitle', {
            when: `${dayLabel(result.finished)} ${timeLabel(result.finished)}`,
            scope: scanScope(result, target),
            duration: seconds < 60 ? t('scanSeconds', { count: seconds }) : t('scanMinutes', { count: Math.round(seconds / 60) }),
        })),
        el('div', 'anomalous-scan-result-counts', countsLine(result.counts)),
    );
    if (result.options?.offline_only) box.append(el('p', 'anomalous-scan-muted', t('scanResultOffline')));
    if (result.civitai_down) box.append(el('p', 'anomalous-scan-note is-warn', t('scanResultCivitaiDown')));
    for (const error of result.errors || []) box.append(el('p', 'anomalous-scan-note is-error', error));

    const files = result.files || [];
    if (!files.length) {
        box.append(el('p', 'anomalous-scan-muted', t('scanResultNothing', { count: result.counts.unchanged || 0 })));
        return box;
    }
    const list = el('div', 'anomalous-scan-rows');
    const render = item => row(item, fileOutcome(item),
        item.status === 'inferred' ? unmatchedButtons(item, actions) : [[t('scanRowOpen'), () => actions.open(item)]],
        STATUS_MARKS[item.status] || '');
    fillRows(list, files, render, RESULT_ROWS);
    box.append(list);
    if (result.counts.unchanged) box.append(el('p', 'anomalous-scan-muted', t('scanResultUnchanged', { count: result.counts.unchanged })));
    return box;
}

/** The models not scanned yet or unmatched, one tab each; `state.tab` remembers the open one. */
export function renderModelLists(summary, actions, state) {
    const unmatched = [...(summary?.unmatched_models || [])]
        .sort((a, b) => Number(isPending(b.reason)) - Number(isPending(a.reason)));
    const tabs = [['new', t('scanListNew', { count: summary?.new || 0 }), summary?.new_models || []],
        ['unmatched', t('scanListUnmatched', { count: summary?.unmatched || 0 }), unmatched]];
    if (!tabs.some(([, , items]) => items.length)) return null;
    if (!tabs.some(([key, , items]) => key === state.tab && items.length)) state.tab = tabs.find(([, , items]) => items.length)[0];

    const box = el('section', 'anomalous-scan-card anomalous-scan-lists');
    box.id = 'anomalous-scan-lists';
    const bar = el('div', 'anomalous-scan-tabs');
    bar.setAttribute('role', 'tablist');
    const hint = el('p', 'anomalous-scan-muted');
    const list = el('div', 'anomalous-scan-rows');
    const show = (key) => {
        state.tab = key;
        bar.querySelectorAll('button').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === key)));
        const items = tabs.find(([tabKey]) => tabKey === key)[2];
        if (key === 'new') {
            hint.textContent = t('scanListNewHint');
            fillRows(list, items, item => row(item, '', [
                [t('scanRowOpen'), () => actions.open(item)],
                [t('scanRowScan'), () => actions.scan([item]), actions.busy],
            ]), SHOWN_ROWS);
        } else {
            hint.textContent = t(actions.offline ? 'scanListUnmatchedHintOffline' : 'scanListUnmatchedHint');
            fillRows(list, items, item => row(item, [reasonText(item.reason), item.base ? `≈ ${item.base}` : ''].filter(Boolean).join(' · '),
                unmatchedButtons(item, actions), '≈'), SHOWN_ROWS);
        }
    };
    for (const [key, label, items] of tabs) {
        const tab = button('anomalous-scan-tab', label, () => show(key));
        tab.dataset.tab = key;
        tab.setAttribute('role', 'tab');
        tab.disabled = !items.length;
        bar.append(tab);
    }
    box.append(bar, hint, list);
    show(state.tab);
    return box;
}

/** A count on the page that opens its list (unmatched, not scanned). */
export function showList(page, state, key) {
    state.tab = key;
    const lists = page.querySelector('#anomalous-scan-lists');
    lists?.querySelector(`[data-tab="${key}"]`)?.click();
    lists?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
