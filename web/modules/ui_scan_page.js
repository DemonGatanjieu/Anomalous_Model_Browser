/**
 * The scan page: how many models are matched on Civitai, unmatched or not scanned
 * (GET /anomalous/scan_summary), one button to scan, progress in the page, the last scan
 * in one card, and the rarer choices folded under "Advanced". Each count, and the last
 * scan, opens its list as a page of its own (ui_scan_lists.js) with a way back.
 * Scans run through scan_runner.js; the progress box is scan_progress.js's panel,
 * hosted here while the page is shown.
 */

import { translate as t } from './locales.js';
import { isScanRunning, startScan, targetsForItems } from './scan_runner.js';
import { setScanProgressHost } from './scan_progress.js';
import { openListedModel, renderLastScan, renderListPage } from './ui_scan_lists.js';

// Choices kept while the browser is open. The two risky ones go back off after each scan.
const options = {
    scope: 'all', // 'all' | 'picked'
    selection: new Map(),
    offline: false,
    virtualRename: true,
    physicalRename: false,
    forceOverwrite: false,
    autoFix: true,
};
// The view shown: '' the page itself, or a list: 'new' | 'unmatched' | 'skipped' | 'result'.
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

function pickedCount() {
    let count = 0;
    for (const files of options.selection.values()) count += files.size;
    return count;
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

/** One switch row of the advanced section. */
function toggle(key, titleKey, helpKey, { warn = false, disabled = false } = {}) {
    const row = el('label', `anomalous-scan-option${warn ? ' is-warn' : ''}`);
    const input = el('input');
    input.type = 'checkbox';
    input.checked = Boolean(options[key]);
    input.disabled = disabled;
    input.onchange = () => { options[key] = input.checked; };
    const copy = el('span', 'anomalous-scan-option-copy');
    copy.append(el('strong', '', t(titleKey)), el('small', '', t(helpKey)));
    row.append(input, copy);
    return row;
}

function renderAdvanced(owner, panel, hasKey) {
    const details = el('details', 'anomalous-scan-advanced');
    details.open = Boolean(panel._scanAdvancedOpen);
    details.ontoggle = () => { panel._scanAdvancedOpen = details.open; };
    details.append(el('summary', '', t('scanPageAdvanced')));

    const scope = el('div', 'anomalous-scan-scope');
    const radio = (value, label) => {
        const row = el('label', 'anomalous-scan-scope-choice');
        const input = el('input');
        input.type = 'radio';
        input.name = 'anomalous-scan-scope';
        input.checked = options.scope === value;
        input.onchange = () => { options.scope = value; renderScanPage(owner, panel); };
        row.append(input, el('span', '', label));
        return row;
    };
    scope.append(el('div', 'anomalous-scan-group-title', t('scanPageScope')),
        radio('all', t('scanPageScopeAll')), radio('picked', t('scanPageScopePicked')));
    if (options.scope === 'picked') {
        const pick = el('div', 'anomalous-scan-pick');
        pick.append(
            button('anomalous-scan-secondary', t('scanPagePickModels'), () => owner._openAdvancedModelSelector(options.selection, (next) => {
                options.selection = next;
                renderScanPage(owner, panel);
            })),
            el('span', 'anomalous-scan-muted', t('scanPagePickedCount', { count: pickedCount() })),
        );
        scope.append(pick);
    }

    const offline = toggle('offline', 'scanPageOffline', 'scanPageOfflineHelp');
    const online = el('div', 'anomalous-scan-online');
    online.append(
        toggle('virtualRename', 'scanPageDisplayName', 'scanPageDisplayNameHelp'),
        toggle('physicalRename', 'scanPageFileRename', 'scanPageFileRenameHelp', { warn: true }),
        toggle('forceOverwrite', 'scanPageForce', 'scanPageForceHelp', { warn: true }),
    );
    online.classList.toggle('is-disabled', options.offline);
    offline.querySelector('input').addEventListener('change', () => renderScanPage(owner, panel));

    const key = el('div', 'anomalous-scan-key');
    const keyCopy = el('span', 'anomalous-scan-option-copy');
    keyCopy.append(el('strong', '', `${t('scanPageApiKey')} · ${t(hasKey ? 'scanPageApiKeyOn' : 'scanPageApiKeyOff')}`),
        el('small', '', t('scanPageApiKeyHelp')));
    key.append(keyCopy, button('anomalous-scan-secondary', t('scanPageApiKeySet'), async () => {
        if (await saveApiKey()) renderScanPage(owner, panel);
    }));

    details.append(scope, el('div', 'anomalous-scan-group-title', t('scanPageHow')), offline, online,
        toggle('autoFix', 'scanPageAutoFix', 'scanPageAutoFixHelp'), key);
    return details;
}

/** Asks for the key and saves it; true when saved. */
async function saveApiKey() {
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
    if (whole && options.scope === 'picked' && pickedCount() === 0) {
        alert(t('scanPageNothingPicked'));
        return;
    }
    if (whole && options.forceOverwrite && !confirm(t('scanPageForceConfirm'))) return;
    const selection = whole && options.scope === 'picked' ? options.selection : null;
    const started = startScan(owner, { ...options, ...extra, selection });
    renderScanPage(owner, panel); // buttons show "scanning"
    await started;
    if (whole) {
        options.physicalRename = false;
        options.forceOverwrite = false;
    }
    if (panel.isConnected && panel.style.display !== 'none') renderScanPage(owner, panel);
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
        stat(summary?.unmatched, t('scanPageUnmatched'), summary?.unmatched ? 'warn' : '', summary?.unmatched ? open('unmatched') : null),
        stat(summary?.new, t('scanPageNew'), summary?.new ? 'new' : '', summary?.new ? open('new') : null),
    );
    page.append(stats);
    if (summary?.skipped) page.append(button('anomalous-scan-skipped-note', t('scanPageSkippedNote', { count: summary.skipped }), open('skipped')));
    if (!summary) page.append(el('p', 'anomalous-scan-muted', t('scanPageSummaryFailed')));

    const actions = el('div', 'anomalous-scan-actions');
    const picked = options.scope === 'picked';
    // An online scan also looks up the models earlier scans could not ask Civitai about.
    const waiting = (summary?.new || 0) + (options.offline ? 0 : summary?.pending || 0);
    const label = busy ? t('scanPageScanning')
        : picked ? t('scanPageScanPicked', { count: pickedCount() })
            : waiting ? t(options.offline ? 'scanPageScanNewOffline' : 'scanPageScanNew', { count: waiting })
                : t('scanPageScanAgain');
    const primary = button('anomalous-scan-primary', label, () => run(owner, panel));
    primary.disabled = busy;
    actions.append(primary);
    page.append(actions);
    const hint = picked ? t('scanPageHintPicked') : t(options.offline ? 'scanPageHintOffline' : 'scanPageHint');
    page.append(el('p', 'anomalous-scan-muted', hint), progressHost);

    const result = renderLastScan(last, open('result'));
    if (result) page.append(result);
    page.append(renderAdvanced(owner, panel, Boolean(config?.has_api_key)));
    return page;
}

/** Puts the current view into `panel`; a view shown again keeps where it was scrolled. */
function paint(owner, panel, data) {
    const view = pageState.view;
    const top = pageState.scroll || (panel._scanView === view ? panel.scrollTop : 0);
    pageState.scroll = 0;
    const busy = isScanRunning();
    const progressHost = el('div', 'anomalous-scan-progress-host');
    const page = view
        ? renderListPage(view, data.summary, data.last, listActions(owner, panel, busy), progressHost)
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
