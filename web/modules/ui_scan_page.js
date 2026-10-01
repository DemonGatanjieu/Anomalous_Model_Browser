/**
 * The scan page: how many models are matched on Civitai, unmatched or new
 * (GET /anomalous/scan_summary), one button to scan, one to look unmatched models up
 * again, progress in the page, and the rarer choices folded under "Advanced".
 * Scans run through scan_runner.js; the progress box is scan_progress.js's panel,
 * hosted here while the page is shown.
 */

import { translate as t } from './locales.js';
import { isScanRunning, startScan } from './scan_runner.js';
import { setScanProgressHost } from './scan_progress.js';

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

function stat(value, label, tone) {
    const box = el('div', `anomalous-scan-stat${tone ? ` is-${tone}` : ''}`);
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

async function run(owner, panel, extra = {}) {
    if (options.scope === 'picked' && !extra.retryUnmatched && pickedCount() === 0) {
        alert(t('scanPageNothingPicked'));
        return;
    }
    const selection = options.scope === 'picked' && !extra.retryUnmatched ? options.selection : null;
    const started = startScan(owner, { ...options, ...extra, selection });
    renderScanPage(owner, panel); // buttons show "scanning"
    await started;
    options.physicalRename = false;
    options.forceOverwrite = false;
    if (panel.isConnected && panel.style.display !== 'none') renderScanPage(owner, panel);
}

/** Renders the page into `panel` (again after each scan, so the counts are fresh). */
export async function renderScanPage(owner, panel) {
    const token = (panel._scanRender = (panel._scanRender || 0) + 1);
    const [summary, config] = await Promise.all([fetchJson('/anomalous/scan_summary'), fetchJson('/anomalous/config')]);
    if (token !== panel._scanRender) return;

    const page = el('div', 'anomalous-scan-page');
    page.append(el('h1', 'anomalous-scan-title', t('scanPageTitle')), el('p', 'anomalous-scan-lead', t('scanPageLead')));

    const stats = el('div', 'anomalous-scan-stats');
    stats.append(
        stat(summary?.total, t('scanPageTotal')),
        stat(summary?.matched, t('scanPageMatched'), 'ok'),
        stat(summary?.unmatched, t('scanPageUnmatched'), summary?.unmatched ? 'warn' : ''),
        stat(summary?.new, t('scanPageNew'), summary?.new ? 'new' : ''),
    );
    page.append(stats);
    if (!summary) page.append(el('p', 'anomalous-scan-muted', t('scanPageSummaryFailed')));

    const busy = isScanRunning();
    const actions = el('div', 'anomalous-scan-actions');
    const picked = options.scope === 'picked';
    const label = busy ? t('scanPageScanning')
        : picked ? t('scanPageScanPicked', { count: pickedCount() })
            : summary?.new ? t('scanPageScanNew', { count: summary.new })
                : t('scanPageScanAgain');
    const primary = button('anomalous-scan-primary', label, () => run(owner, panel));
    primary.disabled = busy;
    actions.append(primary);
    if (summary?.unmatched && !options.offline) {
        const retry = button('anomalous-scan-secondary', t('scanPageRetry', { count: summary.unmatched }), () => run(owner, panel, { retryUnmatched: true }));
        retry.disabled = busy;
        actions.append(retry);
    }
    page.append(actions);
    const hint = picked ? t('scanPageHintPicked')
        : summary?.unmatched && !options.offline ? t('scanPageHintRetry') : t('scanPageHint');
    page.append(el('p', 'anomalous-scan-muted', hint));

    const progressHost = el('div', 'anomalous-scan-progress-host');
    page.append(progressHost, renderAdvanced(owner, panel, Boolean(config?.has_api_key)));
    panel.replaceChildren(page);
    setScanProgressHost(progressHost);
    // A scan that ends elsewhere (a card's radar, another tab) refreshes the counts too.
    owner.onScanFinished = () => {
        if (panel.isConnected && panel.style.display !== 'none') renderScanPage(owner, panel);
    };
}

/** The rail's scan button and Home's "Scan model folders": an image-side tool page. */
export function openScanPage(owner) {
    owner.enterToolPage?.('scan');
    owner.hideAllPanels();
    owner.scanPanel.style.display = 'flex';
    renderScanPage(owner, owner.scanPanel);
}

/** Leaving the page: the progress box floats again. */
export function leaveScanPage() {
    setScanProgressHost(null);
}
