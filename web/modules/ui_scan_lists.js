/**
 * The scan page's lists, each a page of its own behind a count on the scan page: the models
 * not scanned yet, the unmatched ones, the model files a scan never reads (other formats), and
 * each model the last scan changed (GET /anomalous/scan_summary, /anomalous/last_scan).
 * On the scan page itself the last scan is one summary card with a way to its list.
 * Every row opens its model; rows offer "scan" / "look up again" and a Civitai search.
 * The page passes what the buttons do (`actions`); this module only renders.
 */

import { translate as t } from './locales.js';
import { dayLabel, timeLabel } from './activity_log.js';
import { countsLine, fileOutcome, isPending, reasonText, scanScope, STATUS_MARKS } from './scan_results.js';
import { typeLabel } from './ui_model_types.js';

const SHOWN_ROWS = 100; // more behind "show all"

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

/** Opens a listed model's detail; its back button returns to `onBack` (the list it came from). */
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

/** "Last scan · when · what · how long". */
function resultTitle(result) {
    const seconds = Math.max(0, Math.round((result.finished || 0) - (result.started || 0)));
    const target = result.kind === 'one' ? result.files?.[0]?.filename : '';
    return t('scanResultTitle', {
        when: `${dayLabel(result.finished)} ${timeLabel(result.finished)}`,
        scope: scanScope(result, target),
        duration: seconds < 60 ? t('scanSeconds', { count: seconds }) : t('scanMinutes', { count: Math.round(seconds / 60) }),
    });
}

/** What the reader must know about a scan: offline, Civitai gone mid-way, errors. */
function resultNotes(result) {
    const notes = [];
    if (result.options?.offline_only) notes.push(el('p', 'anomalous-scan-muted', t('scanResultOffline')));
    if (result.civitai_down) notes.push(el('p', 'anomalous-scan-note is-warn', t('scanResultCivitaiDown')));
    for (const error of result.errors || []) notes.push(el('p', 'anomalous-scan-note is-error', error));
    return notes;
}

/** The last scan on the scan page: when, what, the counts, and a way to each model. Null before the first scan. */
export function renderLastScan(result, onDetails) {
    if (!result?.counts) return null;
    const box = el('section', 'anomalous-scan-card anomalous-scan-result');
    box.append(el('div', 'anomalous-scan-card-title', resultTitle(result)),
        el('div', 'anomalous-scan-result-counts', countsLine(result.counts)), ...resultNotes(result));
    const files = result.files || [];
    if (files.length) box.append(button('anomalous-scan-more', t('scanResultDetails', { count: files.length }), onDetails));
    else box.append(el('p', 'anomalous-scan-muted', t('scanResultNothing', { count: result.counts.unchanged || 0 })));
    return box;
}

/** A list's models, title, why they are here and the row for one of them. */
function listOf(view, summary, last, actions) {
    if (view === 'new') {
        const items = summary?.new_models || [];
        return {
            items,
            title: t('scanListNew', { count: items.length }),
            hint: t('scanListNewHint'),
            all: items.length ? [t('scanListScanAll', { count: items.length }), () => actions.scan(items)] : null,
            render: item => row(item, '', [
                [t('scanRowOpen'), () => actions.open(item)],
                [t('scanRowScan'), () => actions.scan([item]), actions.busy],
            ]),
        };
    }
    if (view === 'skipped') {
        const items = summary?.skipped_models || [];
        return {
            items,
            title: t('scanListSkipped', { count: items.length }),
            hint: t('scanListSkippedHint'),
            render: item => row(item, '', [[t('scanRowOpen'), () => actions.open(item)]]),
        };
    }
    if (view === 'result') {
        const items = last?.files || [];
        return {
            items,
            title: t('scanResultList'),
            render: item => row(item, fileOutcome(item),
                item.status === 'inferred' ? unmatchedButtons(item, actions) : [[t('scanRowOpen'), () => actions.open(item)]],
                STATUS_MARKS[item.status] || ''),
        };
    }
    // Unmatched: those the next online scan looks up by itself first.
    const items = [...(summary?.unmatched_models || [])]
        .sort((a, b) => Number(isPending(b.reason)) - Number(isPending(a.reason)));
    // Civitai does not know it and the file is no known image model: say what it may be.
    const guess = item => (item.base ? `≈ ${item.base}` : item.reason === 'not_found' ? t('scanReasonNotImage') : '');
    return {
        items,
        title: t('scanListUnmatched', { count: items.length }),
        hint: t(actions.offline ? 'scanListUnmatchedHintOffline' : 'scanListUnmatchedHint'),
        all: items.length && !actions.offline ? [t('scanPageRetry', { count: items.length }), actions.retryAll] : null,
        render: item => row(item, [reasonText(item.reason), guess(item)].filter(Boolean).join(' · '),
            unmatchedButtons(item, actions), '≈'),
    };
}

/**
 * One list as a page ('new' | 'unmatched' | 'skipped' | 'result'): back to the scan page, what
 * these models are and why they are here, a button for all of them, then the rows. A scan
 * started here shows its progress in `progressHost`, above the rows.
 */
export function renderListPage(view, summary, last, actions, progressHost) {
    const list = listOf(view, summary, last, actions);
    const page = el('div', 'anomalous-scan-page');
    page.append(button('anomalous-scan-back', t('scanBack'), actions.back), el('h1', 'anomalous-scan-title', list.title));
    if (view === 'result' && last?.counts) {
        page.append(el('div', 'anomalous-scan-card-title', resultTitle(last)),
            el('div', 'anomalous-scan-result-counts', countsLine(last.counts)), ...resultNotes(last));
    }
    if (list.hint) page.append(el('p', 'anomalous-scan-lead', list.hint));
    if (list.all) {
        const all = button('anomalous-scan-secondary', actions.busy ? t('scanPageScanning') : list.all[0], list.all[1]);
        all.disabled = actions.busy;
        const bar = el('div', 'anomalous-scan-actions');
        bar.append(all);
        page.append(bar);
    }
    page.append(progressHost);
    if (!list.items.length) {
        page.append(el('p', 'anomalous-scan-muted', t('scanListEmpty')));
        return page;
    }
    const card = el('section', 'anomalous-scan-card');
    const rows = el('div', 'anomalous-scan-rows');
    fillRows(rows, list.items, list.render, SHOWN_ROWS);
    card.append(rows);
    page.append(card);
    if (view === 'result' && last?.counts?.unchanged) {
        page.append(el('p', 'anomalous-scan-muted', t('scanResultUnchanged', { count: last.counts.unchanged })));
    }
    return page;
}
