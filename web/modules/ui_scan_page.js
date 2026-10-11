/**
 * The scan page (GET /anomalous/scan_summary), quieter the further down. First the scan card:
 * a band of pictures (an empty frame for each model not scanned yet, then covers the scans
 * brought), what is left to do in one line, the scan button,
 * "pick models to scan" (ui_scan_picker.js; the picks are named in the card, and cleared the
 * button scans everything again), online or offline, and what this scan will do in one sentence
 * (the full counts unfold). Progress shows under it. Then the models' state as a bar with a chip
 * per state (not found and not scanned open their list), and a chip for the components a
 * drawing model loads (VAE, text encoders…), which are not in the counts since many are not on
 * Civitai, with quiet links to the models set to "don't scan" and the files in other formats.
 * Then, only when there is something, what needs a look: damaged files, new models that look
 * like no drawing model (don't scan them, scan them, see them). Then the settings (ui_scan_settings.js) and the last scan in one line.
 * Lists are pages of their own (ui_scan_lists.js) with a way back. Scans run through
 * scan_runner.js; the progress box is scan_progress.js's panel, hosted here while the page is shown.
 */

import { translate as t } from './locales.js';
import { isScanRunning, startScan, targetsForItems } from './scan_runner.js';
import { setScanProgressHost } from './scan_progress.js';
import { scanIcon } from './scan_icons.js';
import { openListedModel, renderLastScan, renderListPage } from './ui_scan_lists.js';
import { openScanPicker, pickKey, picksLine } from './ui_scan_picker.js';
import { renderScanSettings, scanOptions as options } from './ui_scan_settings.js';

const SHOWN_PICKS = 12; // picked models named on the page; the rest are counted
const BAND_TILES = 48; // pictures put in the scan card's band (as many as fit show)
// The view shown: '' the page itself, or a list: 'new' | 'unmatched' | 'skipped' | 'result'
// | 'notdrawing' | 'excluded' | 'components'. `scroll`: where to put a list shown again after a
// model's Back. `factsOpen`, `moreOpen`: the scan's full counts, the rarer settings unfolded.
const pageState = { view: '', scroll: 0, factsOpen: false, moreOpen: false };

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

/** The counts without the components (they have their own chip). */
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

/**
 * The band on top of the scan card, what a scan is for in a picture: an empty frame for each
 * model not scanned yet (`waiting`), then the covers scans brought, the newest models first.
 * The frames breathe while a scan runs. Null when there is neither.
 */
function coverBand(covers, waiting, busy) {
    const frames = Math.min(waiting, BAND_TILES);
    if (!frames && !covers.length) return null;
    const band = el('div', `anomalous-scan-band${busy ? ' is-busy' : ''}`);
    band.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < frames; index++) {
        const frame = el('span', 'anomalous-scan-band-tile is-empty');
        frame.style.animationDelay = `${(index % 12) * 90}ms`; // a wave along the row
        band.append(frame);
    }
    for (const cover of covers.slice(0, BAND_TILES - frames)) {
        const img = el('img', 'anomalous-scan-band-tile');
        img.alt = '';
        img.loading = 'lazy';
        img.title = cover.name;
        img.src = `${cover.preview_url}&variant=${/\.(mp4|webm|mov)(?:&|$)/i.test(cover.preview_url) ? 'poster' : 'card'}`;
        img.onerror = () => img.remove();
        band.append(img);
    }
    return band;
}

/**
 * What a scan of every model does this time, in the summary's counts and the current settings:
 * one sentence, and the lines (each saying how many of its models are components) when unfolded.
 */
function wholeScanFacts(summary, refresh) {
    const box = el('div', 'anomalous-scan-scope-facts');
    const online = !options.offline;
    const force = online && options.forceOverwrite;
    const parts = { total: 0, matched: 0, unmatched: 0, new: 0, pending: 0, ...summary.components };
    const lookup = online ? summary.new + summary.pending : summary.new;
    const sentence = force ? t('scanHeroForce', { count: summary.total })
        : !lookup ? t('scanScopeNothingNew')
            : online ? t('scanHeroLookup', { count: lookup }) : t('scanHeroInfer', { count: lookup });
    const line = el('p', 'anomalous-scan-hero-sentence', sentence);
    line.append(button('anomalous-pick-link', t(pageState.factsOpen ? 'scanHeroLess' : 'scanHeroMore'), () => {
        pageState.factsOpen = !pageState.factsOpen;
        refresh();
    }));
    box.append(line);
    if (!pageState.factsOpen) return box;
    const lines = force ? [['scanScopeForce', summary.total, parts.total], ['scanScopeExcluded', summary.excluded, 0]] : [
        [online ? 'scanScopeLookup' : 'scanScopeInfer', lookup, online ? parts.new + parts.pending : parts.new],
        ['scanScopeMatched', summary.matched, parts.matched],
        ['scanScopeNotFound', summary.unmatched - summary.pending, parts.unmatched - parts.pending],
        ['scanScopeWaiting', online ? 0 : summary.pending, parts.pending],
        ['scanScopeExcluded', summary.excluded, 0],
    ];
    const list = el('ul', 'anomalous-scan-scope-list');
    for (const [key, count, ofParts] of lines) {
        if (count) list.append(el('li', '', t(key, { count: count.toLocaleString(), parts: ofParts ? t('scanScopeWithParts', { count: ofParts }) : '' })));
    }
    box.append(list, el('small', 'anomalous-scan-setting-help', t('scanPageScopeAllHelp')));
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

/** Online or offline: two buttons side by side, each with its icon. */
function modeSwitch(refresh) {
    const box = el('div', 'anomalous-scan-mode');
    box.setAttribute('role', 'radiogroup');
    for (const [offline, icon, key] of [[false, 'online', 'scanModeOnline'], [true, 'offline', 'scanModeOffline']]) {
        const choice = button(`anomalous-scan-mode-btn${options.offline === offline ? ' is-on' : ''}`, undefined, () => {
            options.offline = offline;
            refresh();
        });
        choice.setAttribute('role', 'radio');
        choice.setAttribute('aria-checked', String(options.offline === offline));
        choice.title = t(offline ? 'scanPageOfflineHelp' : 'scanModeOnlineHelp');
        choice.append(scanIcon(icon), el('span', '', t(key)));
        box.append(choice);
    }
    return box;
}

/** The scan card: the band of pictures, what is left in one line, the buttons, and what this scan will do. */
function scanCard(owner, panel, summary, busy) {
    const refresh = () => go(owner, panel, '');
    const picked = options.picked.length;
    const counts = mainCounts(summary);
    // An online scan also looks up the models earlier scans could not ask Civitai about.
    const waiting = summary.new + (options.offline ? 0 : summary.pending);
    const label = busy ? t('scanPageScanning')
        : picked ? t('scanPageScanPicked', { count: picked })
            : waiting ? t(options.offline ? 'scanPageScanNewOffline' : 'scanPageScanNew', { count: waiting })
                : t('scanPageScanAgain');
    const primary = button('anomalous-scan-primary', undefined, () => run(owner, panel));
    primary.append(scanIcon('scan'), el('span', '', label));
    primary.disabled = busy;
    const pick = button('anomalous-scan-secondary', undefined, () => openScanPicker(options.picked, (next) => {
        options.picked = next;
        refresh();
    }));
    pick.append(scanIcon('pick'), el('span', '', t(picked ? 'scanPickChange' : 'scanPagePickModels')));
    const actions = el('div', 'anomalous-scan-actions');
    actions.append(primary, pick);
    if (picked) {
        actions.append(button('anomalous-pick-link', t('scanPickBackToAll'), () => {
            options.picked = [];
            refresh();
        }));
    }
    actions.append(modeSwitch(refresh));

    const body = el('div', 'anomalous-scan-hero-body');
    body.append(el('div', 'anomalous-scan-hero-title', busy ? t('scanPageScanning') : picked ? t('scanHeroPicked', { count: picked })
        : waiting ? t('scanHeroWaiting', { count: waiting }) : t('scanHeroDone')),
    el('div', 'anomalous-scan-hero-sub', t('scanHeroFound', { matched: counts.matched, total: counts.total })), actions,
    picked ? pickedFacts(summary, refresh) : wholeScanFacts(summary, refresh));
    // The two switches that change files say so where the scan starts.
    if (!options.offline && options.physicalRename) body.append(el('p', 'anomalous-scan-hero-warn', t('scanHeroRenames')));
    if (!options.offline && options.forceOverwrite) body.append(el('p', 'anomalous-scan-hero-warn', t('scanHeroFetchesAll')));

    const card = el('section', 'anomalous-scan-card anomalous-scan-hero');
    const band = coverBand(summary.covers || [], counts.new, busy);
    if (band) card.append(band);
    card.append(body);
    return card;
}

/**
 * The models' state: a bar of found / not found / not scanned, a chip for each, the components'
 * chip, and under them quiet links to the models left out (set to "don't scan", other formats).
 */
function stateRow(summary, open) {
    const counts = mainCounts(summary);
    const box = el('section', 'anomalous-scan-state');
    const bar = el('div', 'anomalous-scan-bar');
    for (const [tone, count] of [['ok', counts.matched], [counts.warn ? 'warn' : 'plain', counts.unmatched], ['new', counts.new]]) {
        if (!count) continue;
        const part = el('span', `anomalous-scan-bar-part is-${tone}`);
        part.style.flexGrow = String(count); // the share of the models
        bar.append(part);
    }
    const chip = (tone, label, count, onClick) => {
        const node = el(onClick ? 'button' : 'span', `anomalous-scan-state-chip is-${tone}`);
        if (onClick) {
            node.type = 'button';
            node.onclick = onClick;
            node.title = t('scanPageShowList');
        }
        node.append(el('span', 'anomalous-scan-state-dot'), el('span', '', label), el('strong', '', String(count)));
        if (onClick) node.append(scanIcon('next'));
        return node;
    };
    const chips = el('div', 'anomalous-scan-state-chips');
    chips.append(chip('ok', t('scanPageMatched'), counts.matched),
        chip(counts.warn ? 'warn' : 'plain', t('scanPageUnmatched'), counts.unmatched, counts.unmatched ? open('unmatched') : null),
        chip('new', t('scanPageNew'), counts.new, counts.new ? open('new') : null));
    const parts = summary.components;
    if (parts?.total) {
        const node = button('anomalous-scan-state-chip anomalous-scan-parts-chip', undefined, open('components'));
        node.title = t('scanPartsNote');
        node.append(scanIcon('parts'), el('span', '', t('scanPartsChip', { count: parts.total })), scanIcon('info'));
        chips.append(node);
    }
    box.append(el('h2', 'anomalous-scan-section-title', t('scanStateTitle')), bar, chips);
    const notes = el('div', 'anomalous-scan-state-notes');
    for (const [count, icon, key, view] of [[summary.excluded, 'excluded', 'scanPageExcludedNote', 'excluded'], [summary.skipped, 'file', 'scanPageSkippedNote', 'skipped']]) {
        if (!count) continue;
        const link = button('anomalous-scan-quiet-link', undefined, open(view));
        link.append(scanIcon(icon), el('span', '', t(key, { count })));
        notes.append(link);
    }
    if (notes.childElementCount) box.append(notes);
    return box;
}

/** What needs a look, one row each; null when nothing does. */
function attention(owner, panel, summary, open) {
    const rows = [];
    const line = (icon, text, tone, onClick, extra = []) => {
        const row = el(onClick ? 'button' : 'div', `anomalous-scan-attn${tone ? ` is-${tone}` : ''}`);
        if (onClick) {
            row.type = 'button';
            row.onclick = onClick;
        }
        row.append(scanIcon(icon), el('span', 'anomalous-scan-attn-text', text), ...extra, ...(onClick ? [scanIcon('next')] : []));
        rows.push(row);
    };
    if (summary.damaged) line('damaged', t('scanPageDamagedNote', { count: summary.damaged }), 'danger', open('unmatched'));
    const notDrawing = (summary.new_models || []).filter(item => item.not_drawing);
    if (notDrawing.length) {
        line('voice', t('scanPageNotDrawing', { count: notDrawing.length }), '', null, [
            button('anomalous-scan-secondary anomalous-scan-small-btn', t('scanPageSkipThem'), () => setChoice(owner, panel, notDrawing, 'skip')),
            button('anomalous-scan-secondary anomalous-scan-small-btn', t('scanPageScanThem'), () => setChoice(owner, panel, notDrawing, 'scan')),
            button('anomalous-pick-link', t('scanPageSeeThem'), open('notdrawing')),
        ]);
    }
    if (!rows.length) return null;
    const box = el('section', 'anomalous-scan-attention');
    const list = el('div', 'anomalous-scan-card anomalous-scan-attn-list');
    list.append(...rows);
    box.append(el('h2', 'anomalous-scan-section-title', t('scanAttentionTitle')), list);
    return box;
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

/** The scan page itself, from the scan card down to the last scan. */
function mainPage(owner, panel, { summary, config, last }, busy, progressHost) {
    const page = el('div', 'anomalous-scan-page');
    const about = el('details', 'anomalous-scan-about');
    about.append(el('summary', '', t('scanPageAboutLink')), el('p', 'anomalous-scan-lead', t('scanPageLead')),
        el('p', 'anomalous-scan-lead', t('scanPageBackground')));
    const head = el('div', 'anomalous-scan-head');
    head.append(el('h1', 'anomalous-scan-title', t('scanPageTitle')), el('p', 'anomalous-scan-lead', t('scanPageLeadShort')), about);
    page.append(head);
    if (!summary) {
        page.append(el('p', 'anomalous-scan-muted', t('scanPageSummaryFailed')), progressHost);
        return page;
    }
    const open = view => () => go(owner, panel, view);
    page.append(scanCard(owner, panel, summary, busy), progressHost, stateRow(summary, open));
    const look = attention(owner, panel, summary, open);
    if (look) page.append(look);
    page.append(renderScanSettings(Boolean(config?.has_api_key), {
        moreOpen: pageState.moreOpen,
        onMore: (isOpen) => { pageState.moreOpen = isOpen; },
        onChange: () => go(owner, panel, ''),
        onKey: () => renderScanPage(owner, panel),
    }));
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
