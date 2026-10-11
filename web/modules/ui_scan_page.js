/**
 * The scan page (GET /anomalous/scan_summary): how many models are matched on Civitai,
 * unmatched or not scanned, without the components a drawing model loads (VAE, text
 * encoders…), which have a card of their own saying that not being on Civitai is no fault.
 * Then the scan itself: one button, "pick models to scan" beside it (ui_scan_picker.js; the
 * picks are named under it, and cleared the button scans everything again), and what this
 * scan will do in the summary's counts. Under it the settings, unfolded in place
 * (ui_scan_settings.js), progress in the page and the last scan in one card. Each count, the
 * components and the last scan open their list as a page of its own (ui_scan_lists.js) with a
 * way back. New models whose header looks like no drawing model are asked about (don't scan
 * them, scan them, see them); models set to "don't scan" have a list of their own.
 * Scans run through scan_runner.js; the progress box is scan_progress.js's panel,
 * hosted here while the page is shown.
 */

import { translate as t } from './locales.js';
import { isScanRunning, startScan, targetsForItems } from './scan_runner.js';
import { setScanProgressHost } from './scan_progress.js';
import { openListedModel, renderLastScan, renderListPage } from './ui_scan_lists.js';
import { openScanPicker, pickKey, picksLine } from './ui_scan_picker.js';
import { renderScanSettings, scanOptions as options } from './ui_scan_settings.js';

const SHOWN_PICKS = 12; // picked models named on the page; the rest are counted
// The view shown: '' the page itself, or a list: 'new' | 'unmatched' | 'skipped' | 'result'
// | 'notdrawing' | 'excluded' | 'components'. `scroll`: where to put a list shown again after a
// model's Back. `settingsOpen`: the settings card is unfolded.
const pageState = { view: '', scroll: 0, settingsOpen: false };

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

async function fetchJson(url) {
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

/** A count; with `onClick` it opens the list of those models. */
function stat(value, label, tone, onClick) {
    const box = el(onClick ? 'button' : 'div', `anomalous-scan-stat${tone ? ` is-${tone}` : ''}`);
    if (onClick) {
        box.type = 'button';
        box.onclick = onClick;
        box.title = t('scanPageShowList');
    }
    box.append(el('strong', 'anomalous-scan-stat-value', value ?? '–'), el('span', 'anomalous-scan-stat-label', label));
    return box;
}

/** The counts without the components (they have their own card). */
function mainCounts(summary) {
    const parts = summary.components || { total: 0, matched: 0, unmatched: 0, new: 0 };
    const unmatched = (summary.unmatched_models || []).filter(item => !item.component);
    return {
        total: summary.total - parts.total, matched: summary.matched - parts.matched,
        unmatched: summary.unmatched - parts.unmatched, new: summary.new - parts.new,
        // Not on Civitai is no fault (the fingerprint is kept): only damaged files and lookups still to do warn.
        warn: unmatched.some(item => item.reason === 'damaged' || item.reason === 'offline' || item.reason === 'network'),
    };
}

/** The components (VAE, text encoders…): their counts, that missing on Civitai is fine, and a way to their list. */
function componentsCard(summary, open) {
    const parts = summary?.components;
    if (!parts?.total) return null;
    const card = button('anomalous-scan-card anomalous-scan-parts', undefined, open);
    const head = el('span', 'anomalous-scan-parts-head');
    head.append(el('span', 'anomalous-scan-card-title', t('scanPartsTitle')), el('span', 'anomalous-scan-parts-kinds', t('scanPartsKinds')),
        el('span', 'anomalous-scan-settings-change', t('scanPartsOpen')));
    const counts = [t('scanPartsTotal', { count: parts.total }),
        parts.matched && t('scanPartsMatched', { count: parts.matched }),
        parts.unmatched && t('scanPartsUnmatched', { count: parts.unmatched }),
        parts.new && t('scanPartsNew', { count: parts.new })].filter(Boolean).join(' · ');
    card.append(head, el('span', 'anomalous-scan-parts-counts', counts), el('span', 'anomalous-scan-parts-note', t('scanPartsNote')));
    return card;
}

/**
 * What a scan of every model does this time, in the summary's counts and the current settings;
 * a line says how many of its models are components (the counts above leave them out).
 */
function wholeScanFacts(summary) {
    const box = el('div', 'anomalous-scan-scope-facts');
    if (summary) {
        const online = !options.offline;
        const force = online && options.forceOverwrite;
        const parts = { total: 0, matched: 0, unmatched: 0, new: 0, pending: 0, ...summary.components };
        const lookup = online ? summary.new + summary.pending : summary.new;
        const lines = force ? [['scanScopeForce', summary.total, parts.total], ['scanScopeExcluded', summary.excluded, 0]] : [
            [online ? 'scanScopeLookup' : 'scanScopeInfer', lookup, online ? parts.new + parts.pending : parts.new],
            ['scanScopeNothingNew', lookup ? 0 : 1, 0],
            ['scanScopeMatched', summary.matched, parts.matched],
            ['scanScopeNotFound', summary.unmatched - summary.pending, parts.unmatched - parts.pending],
            ['scanScopeWaiting', online ? 0 : summary.pending, parts.pending],
            ['scanScopeExcluded', summary.excluded, 0],
        ];
        const list = el('ul', 'anomalous-scan-scope-list');
        for (const [key, count, ofParts] of lines) {
            if (count) list.append(el('li', '', t(key, { count: count.toLocaleString(), parts: ofParts ? t('scanScopeWithParts', { count: ofParts }) : '' })));
        }
        box.append(list);
    }
    box.append(el('small', 'anomalous-scan-setting-help', t('scanPageScopeAllHelp')));
    return box;
}

/** The picks: how many and how big, their names (each with a ✕), and a word on the found ones. */
function pickedFacts(summary, refresh) {
    const box = el('div', 'anomalous-scan-pick');
    box.append(el('span', 'anomalous-scan-pick-count', picksLine(options.picked)));
    const names = el('div', 'anomalous-scan-pick-names');
    for (const item of options.picked.slice(0, SHOWN_PICKS)) {
        const chip = el('span', 'anomalous-scan-pick-name');
        chip.title = item.rel;
        const remove = button('anomalous-scan-pick-remove', '✕', () => {
            options.picked = options.picked.filter(each => each !== item);
            refresh();
        });
        remove.title = t('scanPickRemove');
        chip.append(el('span', '', item.name), remove);
        names.append(chip);
    }
    if (options.picked.length > SHOWN_PICKS) names.append(el('span', 'anomalous-scan-pick-more', t('scanPickMore', { count: options.picked.length - SHOWN_PICKS })));
    box.append(names);
    // Found ones are read from their record again, not looked up, unless fetching again is on.
    if (summary && !(options.forceOverwrite && !options.offline)) {
        const open = new Set([...summary.new_models, ...summary.unmatched_models, ...summary.excluded_models].map(pickKey));
        const found = options.picked.filter(item => !open.has(pickKey(item))).length;
        if (found) box.append(el('small', 'anomalous-scan-setting-help', t('scanPickFoundNote', { count: found })));
    }
    return box;
}

/** The scan: its button, picking models beside it, and what it will do. */
function scanCard(owner, panel, summary, busy) {
    const refresh = () => go(owner, panel, '');
    const picked = options.picked.length;
    // An online scan also looks up the models earlier scans could not ask Civitai about.
    const waiting = (summary?.new || 0) + (options.offline ? 0 : summary?.pending || 0);
    const label = busy ? t('scanPageScanning')
        : picked ? t('scanPageScanPicked', { count: picked })
            : waiting ? t(options.offline ? 'scanPageScanNewOffline' : 'scanPageScanNew', { count: waiting })
                : t('scanPageScanAgain');
    const primary = button('anomalous-scan-primary', label, () => run(owner, panel));
    primary.disabled = busy;
    const pick = button('anomalous-scan-secondary', t(picked ? 'scanPickChange' : 'scanPagePickModels'), () => openScanPicker(options.picked, (next) => {
        options.picked = next;
        refresh();
    }));
    const actions = el('div', 'anomalous-scan-actions');
    actions.append(primary, pick);
    if (picked) {
        actions.append(button('anomalous-pick-link', t('scanPickBackToAll'), () => {
            options.picked = [];
            refresh();
        }));
    }
    const card = el('section', 'anomalous-scan-card anomalous-scan-run');
    card.append(actions, picked ? pickedFacts(summary, refresh) : wholeScanFacts(summary), el('p', 'anomalous-scan-muted', t('scanPageBackground')));
    return card;
}

/** A scan from this page: every model, the picks, or `extra.targets` (a list's models; `retryUnmatched` to look them up again). */
async function run(owner, panel, extra = {}) {
    const whole = !extra.targets;
    if (whole && options.forceOverwrite && !confirm(t('scanPageForceConfirm'))) return;
    const targets = whole && options.picked.length ? targetsForItems(options.picked) : extra.targets;
    const started = startScan(owner, { ...options, ...extra, targets });
    renderScanPage(owner, panel); // buttons show "scanning"
    await started;
    if (whole) {
        options.physicalRename = false;
        options.forceOverwrite = false;
    }
    if (panel.isConnected && panel.style.display !== 'none') renderScanPage(owner, panel);
}

/** Saves "don't scan" ('skip'), "scan" or no choice ('') for `items`, then reads the page again. */
async function setChoice(owner, panel, items, choice) {
    try {
        const res = await fetch('/anomalous/scan_choice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targets: targetsForItems(items), choice }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.status !== 'success') throw new Error(data.message || `HTTP ${res.status}`);
        if (data.failed?.length) alert(t('scanChoiceFailed', { count: data.failed.length }));
    } catch (error) {
        console.error('Could not save the scan choice:', error);
        alert(t('scanChoiceFailed', { count: items.length }));
    }
    renderScanPage(owner, panel);
}

/** The question about new models that look like no drawing model: don't scan them, scan them, or see them. */
function notDrawingCard(owner, panel, items, see) {
    const card = el('section', 'anomalous-scan-card anomalous-scan-ask');
    const buttons = el('div', 'anomalous-scan-ask-actions');
    buttons.append(
        button('anomalous-scan-secondary anomalous-scan-small-btn', t('scanPageSkipThem'), () => setChoice(owner, panel, items, 'skip')),
        button('anomalous-scan-secondary anomalous-scan-small-btn', t('scanPageScanThem'), () => setChoice(owner, panel, items, 'scan')),
        button('anomalous-scan-small-btn anomalous-scan-ask-see', t('scanPageSeeThem'), see),
    );
    card.append(el('p', 'anomalous-scan-ask-text', t('scanPageNotDrawing', { count: items.length })), buttons);
    return card;
}

/** To another view of the page ('' is the scan page itself), with what was read last. */
function go(owner, panel, view) {
    pageState.view = view;
    if (panel._scanData) paint(owner, panel, panel._scanData);
    else renderScanPage(owner, panel);
}

/** What the list pages' buttons do. */
function listActions(owner, panel, busy) {
    return {
        busy,
        offline: options.offline,
        back: () => go(owner, panel, ''),
        // The model's Back returns to this list where it was.
        open: (item) => {
            const view = pageState.view;
            const scroll = panel.scrollTop;
            openListedModel(owner, item, () => openScanPage(owner, view, scroll));
        },
        scan: (items, { retry = false } = {}) => run(owner, panel, { targets: targetsForItems(items), retryUnmatched: retry }),
        choose: (items, choice) => setChoice(owner, panel, items, choice),
    };
}

/** The scan page itself: what a scan is, the counts (each opening its list), the components, the scan, its settings, the last scan. */
function mainPage(owner, panel, { summary, config, last }, busy, progressHost) {
    const page = el('div', 'anomalous-scan-page');
    page.append(el('h1', 'anomalous-scan-title', t('scanPageTitle')), el('p', 'anomalous-scan-lead', t('scanPageLead')));

    const open = view => () => go(owner, panel, view);
    const counts = summary ? mainCounts(summary) : {};
    const stats = el('div', 'anomalous-scan-stats');
    stats.append(
        stat(counts.total, t('scanPageTotal')),
        stat(counts.matched, t('scanPageMatched'), 'ok'),
        stat(counts.unmatched, t('scanPageUnmatched'), counts.warn ? 'warn' : '', counts.unmatched ? open('unmatched') : null),
        stat(counts.new, t('scanPageNew'), counts.new ? 'new' : '', counts.new ? open('new') : null),
    );
    page.append(stats);
    const parts = componentsCard(summary, open('components'));
    if (parts) page.append(parts);
    if (summary?.damaged) page.append(button('anomalous-scan-damaged-note', t('scanPageDamagedNote', { count: summary.damaged }), open('unmatched')));
    const notDrawing = (summary?.new_models || []).filter(item => item.not_drawing);
    if (notDrawing.length) page.append(notDrawingCard(owner, panel, notDrawing, open('notdrawing')));
    if (summary?.excluded) page.append(button('anomalous-scan-skipped-note', t('scanPageExcludedNote', { count: summary.excluded }), open('excluded')));
    if (summary?.skipped) page.append(button('anomalous-scan-skipped-note', t('scanPageSkippedNote', { count: summary.skipped }), open('skipped')));
    if (!summary) page.append(el('p', 'anomalous-scan-muted', t('scanPageSummaryFailed')));

    page.append(scanCard(owner, panel, summary, busy), renderScanSettings(Boolean(config?.has_api_key), {
        open: pageState.settingsOpen,
        onFold: (isOpen) => { pageState.settingsOpen = isOpen; },
        onChange: () => go(owner, panel, ''),
        onKey: () => renderScanPage(owner, panel),
    }), progressHost);

    const result = renderLastScan(last, open('result'));
    if (result) page.append(result);
    return page;
}

/** Puts the current view into `panel`; a view shown again keeps where it was scrolled. */
function paint(owner, panel, data) {
    const view = pageState.view;
    const top = pageState.scroll || (panel._scanView === view ? panel.scrollTop : 0);
    pageState.scroll = 0;
    const busy = isScanRunning();
    const progressHost = el('div', 'anomalous-scan-progress-host');
    const page = view ? renderListPage(view, data.summary, data.last, listActions(owner, panel, busy), progressHost)
        : mainPage(owner, panel, data, busy, progressHost);
    panel.replaceChildren(page);
    panel._scanView = view;
    panel.scrollTop = top;
    setScanProgressHost(progressHost);
}

/** Renders the page into `panel` (again after each scan, so the counts are fresh). */
export async function renderScanPage(owner, panel) {
    const token = (panel._scanRender = (panel._scanRender || 0) + 1);
    const [summary, config, last] = await Promise.all([
        fetchJson('/anomalous/scan_summary'), fetchJson('/anomalous/config'), fetchJson('/anomalous/last_scan'),
    ]);
    if (token !== panel._scanRender) return;
    // Closed or left meanwhile: the progress box keeps floating instead of hiding in the page.
    if (panel.style.display === 'none' || !owner.modal?.classList.contains('visible')) return;
    panel._scanData = { summary, config, last };
    paint(owner, panel, panel._scanData);
    // A scan that ends elsewhere (a card's radar, another tab) refreshes the counts too.
    owner.onScanFinished = () => {
        if (panel.isConnected && panel.style.display !== 'none') renderScanPage(owner, panel);
    };
}

/**
 * The rail's scan button, Home's "Scan model folders" and Model Check: the scan page itself.
 * `view` opens one of its lists instead ('result' after a scan, a list on a model's Back),
 * scrolled to `scroll`.
 */
export function openScanPage(owner, view = '', scroll = 0) {
    pageState.view = view;
    pageState.scroll = scroll;
    owner.scanPanel._scanView = null; // opened afresh: from the top unless `scroll`
    owner.enterToolPage?.('scan');
    owner.hideAllPanels();
    owner.scanPanel.style.display = 'flex';
    renderScanPage(owner, owner.scanPanel);
}

/** Leaving the page: the progress box floats again. */
export function leaveScanPage() {
    setScanProgressHost(null);
}
