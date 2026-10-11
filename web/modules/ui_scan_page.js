/**
 * The scan page: how many models are matched on Civitai, unmatched or not scanned
 * (GET /anomalous/scan_summary), one button to scan, how the next scan goes, progress in
 * the page and the last scan in one card. Each count and the last scan open their list
 * as a page of its own (ui_scan_lists.js), the settings card the settings page; each
 * has a way back. The settings page says, in the summary's counts, what a scan of all models
 * will do, or lists the models picked in ui_scan_picker.js. New models whose header looks like no drawing model are asked about
 * (don't scan them, scan them, see them); models set to "don't scan" have a list of their own.
 * Scans run through scan_runner.js; the progress box is scan_progress.js's panel,
 * hosted here while the page is shown.
 */

import { translate as t } from './locales.js';
import { isScanRunning, startScan, targetsForItems } from './scan_runner.js';
import { setScanProgressHost } from './scan_progress.js';
import { openListedModel, renderLastScan, renderListPage } from './ui_scan_lists.js';
import { openScanPicker, pickKey, picksLine } from './ui_scan_picker.js';

// Choices kept while the browser is open. The two risky ones go back off after each scan.
const options = {
    scope: 'all', // 'all' | 'picked'
    picked: [], // the picker's items
    offline: false,
    virtualRename: true,
    physicalRename: false,
    forceOverwrite: false,
    autoFix: true,
};
const SHOWN_PICKS = 12; // picked models named on the settings page; the rest are counted
// The view shown: '' the page itself, 'settings', or a list: 'new' | 'unmatched' | 'skipped' | 'result'
// | 'notdrawing' | 'excluded'.
// `scroll`: where to put a list shown again after a model's Back.
const pageState = { view: '', scroll: 0 };

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

/** One setting: what it is and does on the left, its switch on the right; `tag` warns beside the title. */
function toggle(key, titleKey, helpKey, { tag = '', onChange = null } = {}) {
    const row = el('label', 'anomalous-scan-setting');
    const copy = el('span', 'anomalous-scan-setting-copy');
    const title = el('span', 'anomalous-scan-setting-title', t(titleKey));
    if (tag) title.append(el('span', 'anomalous-scan-tag', t(tag)));
    copy.append(title, el('small', 'anomalous-scan-setting-help', t(helpKey)));
    const input = el('input', 'anomalous-scan-switch');
    input.type = 'checkbox';
    input.checked = Boolean(options[key]);
    input.onchange = () => {
        options[key] = input.checked;
        onChange?.();
    };
    row.append(copy, input);
    return row;
}

/** A titled card of the settings page. */
function group(title, ...children) {
    const box = el('section', 'anomalous-scan-card anomalous-scan-group');
    box.append(el('h3', 'anomalous-scan-group-title', title), ...children);
    return box;
}

/** How the next scan will go, in short words; `true` marks the ones that change files or take long. */
function currentChoices(hasKey) {
    const online = !options.offline;
    return [
        [options.scope === 'picked' ? t('scanChipPicked', { count: options.picked.length }) : t('scanPageScopeAll')],
        [t(online ? 'scanChipOnline' : 'scanPageOffline')],
        online && options.virtualRename && [t('scanChipDisplayName')],
        online && options.physicalRename && [t('scanChipFileRename'), true],
        online && options.forceOverwrite && [t('scanChipForce'), true],
        options.autoFix && [t('scanChipAutoFix')],
        [t(hasKey ? 'scanChipKeyOn' : 'scanChipKeyOff')],
    ].filter(Boolean);
}

/** The scan page's card for the settings: how the next scan goes, and a way to change it. */
function settingsCard(owner, panel, hasKey) {
    const card = button('anomalous-scan-card anomalous-scan-settings-card', undefined, () => go(owner, panel, 'settings'));
    const head = el('span', 'anomalous-scan-settings-head');
    head.append(el('span', 'anomalous-scan-card-title', t('scanSettingsTitle')), el('span', 'anomalous-scan-settings-change', t('scanSettingsChange')));
    const chips = el('span', 'anomalous-scan-chips');
    for (const [text, warn] of currentChoices(hasKey)) chips.append(el('span', `anomalous-scan-chip${warn ? ' is-warn' : ''}`, text));
    card.append(head, chips);
    return card;
}

/** What a scan of every model does this time, in the summary's counts and the current settings. */
function wholeScanFacts(summary) {
    const box = el('div', 'anomalous-scan-scope-facts');
    if (summary) {
        const online = !options.offline;
        const force = online && options.forceOverwrite;
        const pending = online ? summary.pending : 0;
        const lookup = online ? summary.new + pending : summary.new;
        const lines = force ? [['scanScopeForce', summary.total], ['scanScopeExcluded', summary.excluded]] : [
            [online ? 'scanScopeLookup' : 'scanScopeInfer', lookup],
            ['scanScopeNothingNew', lookup ? 0 : 1],
            ['scanScopeMatched', summary.matched],
            ['scanScopeNotFound', summary.unmatched - summary.pending],
            ['scanScopeWaiting', online ? 0 : summary.pending],
            ['scanScopeExcluded', summary.excluded],
        ];
        const list = el('ul', 'anomalous-scan-scope-list');
        for (const [key, count] of lines) {
            if (count) list.append(el('li', '', t(key, { count: count.toLocaleString() })));
        }
        box.append(el('strong', 'anomalous-scan-scope-total', t('scanScopeTotal', { count: summary.total.toLocaleString() })), list);
    }
    box.append(el('small', 'anomalous-scan-setting-help', t('scanPageScopeAllHelp')));
    return box;
}

/** The picks: how many and how big, their names (each with a ✕), a way to pick, and a word on the found ones. */
function pickedFacts(summary, refresh) {
    const box = el('div', 'anomalous-scan-pick');
    const head = el('div', 'anomalous-scan-pick-head');
    head.append(el('span', 'anomalous-scan-pick-count', picksLine(options.picked)),
        button('anomalous-scan-secondary anomalous-scan-small-btn', t(options.picked.length ? 'scanPickChange' : 'scanPagePickModels'), () => openScanPicker(options.picked, (next) => {
            options.picked = next;
            refresh();
        })));
    if (options.picked.length) {
        head.append(button('anomalous-pick-link', t('scanPickClear'), () => {
            options.picked = [];
            refresh();
        }));
    }
    box.append(head);
    if (!options.picked.length) return box;
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

/** The settings as a page of their own, like the lists: back, then one card per question. */
function settingsPage(owner, panel, { summary, hasKey }, progressHost) {
    const refresh = () => go(owner, panel, 'settings');
    const page = el('div', 'anomalous-scan-page');
    page.append(button('anomalous-scan-back', t('scanBack'), () => go(owner, panel, '')),
        el('h1', 'anomalous-scan-title', t('scanSettingsTitle')), el('p', 'anomalous-scan-lead', t('scanSettingsLead')), progressHost);

    // Which models: two choices side by side; "picked" shows the picker.
    const segment = el('div', 'anomalous-scan-segment');
    segment.setAttribute('role', 'radiogroup');
    for (const [value, label] of [['all', t('scanPageScopeAll')], ['picked', t('scanPageScopePicked')]]) {
        const choice = button('anomalous-scan-segment-btn', label, () => {
            options.scope = value;
            refresh();
        });
        choice.setAttribute('role', 'radio');
        choice.setAttribute('aria-checked', String(options.scope === value));
        segment.append(choice);
    }
    const scopeNote = options.scope === 'picked' ? pickedFacts(summary, refresh) : wholeScanFacts(summary);

    // What only an online scan does: under its own heading, faded while scanning offline.
    const online = el('div', `anomalous-scan-online${options.offline ? ' is-disabled' : ''}`);
    online.append(
        el('div', 'anomalous-scan-subtitle', t(options.offline ? 'scanPageOnlineOff' : 'scanPageOnline')),
        toggle('virtualRename', 'scanPageDisplayName', 'scanPageDisplayNameHelp'),
        toggle('physicalRename', 'scanPageFileRename', 'scanPageFileRenameHelp', { tag: 'scanPageTagFiles' }),
        toggle('forceOverwrite', 'scanPageForce', 'scanPageForceHelp', { tag: 'scanPageTagSlow', onChange: refresh }),
    );

    const key = el('div', 'anomalous-scan-setting');
    const keyCopy = el('span', 'anomalous-scan-setting-copy');
    const keyTitle = el('span', 'anomalous-scan-setting-title', t('scanPageApiKey'));
    keyTitle.append(el('span', `anomalous-scan-tag ${hasKey ? 'is-on' : 'is-off'}`, t(hasKey ? 'scanPageApiKeyOn' : 'scanPageApiKeyOff')));
    keyCopy.append(keyTitle, el('small', 'anomalous-scan-setting-help', t('scanPageApiKeyHelp')));
    key.append(keyCopy, button('anomalous-scan-secondary anomalous-scan-small-btn', t('scanPageApiKeySet'), async () => {
        if (await saveApiKey()) renderScanPage(owner, panel);
    }));

    page.append(
        group(t('scanPageScope'), segment, scopeNote),
        group(t('scanPageHow'), toggle('offline', 'scanPageOffline', 'scanPageOfflineHelp', { onChange: refresh }), online),
        group(t('scanPageAfter'), toggle('autoFix', 'scanPageAutoFix', 'scanPageAutoFixHelp')),
        group(t('scanPageAccount'), key),
    );
    return page;
}

/** Asks for the Civitai key and saves it; true when saved (also Model Check's downloads). */
export async function saveApiKey() {
    const value = prompt(t('scanPageApiKeyPrompt'), '');
    if (value === null) return false;
    try {
        const res = await fetch('/anomalous/save_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: value.trim() }),
        });
        const data = await res.json();
        if (data.status !== 'ok') throw new Error(data.message || `HTTP ${res.status}`);
        alert(t(value.trim() ? 'scanPageApiKeySaved' : 'scanPageApiKeyCleared'));
        return true;
    } catch (error) {
        alert(t('scanPageApiKeyFailed', { error: String(error.message || error) }));
        return false;
    }
}

/** A scan from this page. `extra`: { retryUnmatched } for every unmatched model, or
 * { targets, retryUnmatched } for the models of a list row or a whole list. */
async function run(owner, panel, extra = {}) {
    const whole = !extra.retryUnmatched && !extra.targets;
    if (whole && options.scope === 'picked' && !options.picked.length) {
        alert(t('scanPageNothingPicked'));
        return;
    }
    if (whole && options.forceOverwrite && !confirm(t('scanPageForceConfirm'))) return;
    const targets = whole && options.scope === 'picked' ? targetsForItems(options.picked) : extra.targets;
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
        retryAll: () => run(owner, panel, { retryUnmatched: true }),
    };
}

/** The scan page itself: what a scan is, the counts (each opening its list), one button, the last scan. */
function mainPage(owner, panel, { summary, config, last }, busy, progressHost) {
    const page = el('div', 'anomalous-scan-page');
    page.append(el('h1', 'anomalous-scan-title', t('scanPageTitle')), el('p', 'anomalous-scan-lead', t('scanPageLead')));

    const open = view => () => go(owner, panel, view);
    const stats = el('div', 'anomalous-scan-stats');
    stats.append(
        stat(summary?.total, t('scanPageTotal')),
        stat(summary?.matched, t('scanPageMatched'), 'ok'),
        // Not on Civitai is no fault (the fingerprint is kept): only damaged files and lookups still to do warn.
        stat(summary?.unmatched, t('scanPageUnmatched'), summary?.damaged || summary?.pending ? 'warn' : '', summary?.unmatched ? open('unmatched') : null),
        stat(summary?.new, t('scanPageNew'), summary?.new ? 'new' : '', summary?.new ? open('new') : null),
    );
    page.append(stats);
    if (summary?.damaged) page.append(button('anomalous-scan-damaged-note', t('scanPageDamagedNote', { count: summary.damaged }), open('unmatched')));
    const notDrawing = (summary?.new_models || []).filter(item => item.not_drawing);
    if (notDrawing.length) page.append(notDrawingCard(owner, panel, notDrawing, open('notdrawing')));
    if (summary?.excluded) page.append(button('anomalous-scan-skipped-note', t('scanPageExcludedNote', { count: summary.excluded }), open('excluded')));
    if (summary?.skipped) page.append(button('anomalous-scan-skipped-note', t('scanPageSkippedNote', { count: summary.skipped }), open('skipped')));
    if (!summary) page.append(el('p', 'anomalous-scan-muted', t('scanPageSummaryFailed')));

    const actions = el('div', 'anomalous-scan-actions');
    const picked = options.scope === 'picked';
    // An online scan also looks up the models earlier scans could not ask Civitai about.
    const waiting = (summary?.new || 0) + (options.offline ? 0 : summary?.pending || 0);
    const label = busy ? t('scanPageScanning')
        : picked ? t('scanPageScanPicked', { count: options.picked.length })
            : waiting ? t(options.offline ? 'scanPageScanNewOffline' : 'scanPageScanNew', { count: waiting })
                : t('scanPageScanAgain');
    const primary = button('anomalous-scan-primary', label, () => run(owner, panel));
    primary.disabled = busy;
    actions.append(primary);
    page.append(actions);
    const hint = picked ? t('scanPageHintPicked') : t(options.offline ? 'scanPageHintOffline' : 'scanPageHint');
    page.append(el('p', 'anomalous-scan-muted', hint), settingsCard(owner, panel, Boolean(config?.has_api_key)), progressHost);

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
    const page = view === 'settings' ? settingsPage(owner, panel, { summary: data.summary, hasKey: Boolean(data.config?.has_api_key) }, progressHost)
        : view ? renderListPage(view, data.summary, data.last, listActions(owner, panel, busy), progressHost)
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
