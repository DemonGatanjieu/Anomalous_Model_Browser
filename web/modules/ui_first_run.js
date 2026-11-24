/**
 * The first-run welcome card & scan dock (ui_home.js): while no model has been scanned yet, opens as
 * a centered welcome overlay inside the AMB window ("Scan my models", optional collapsible Civitai Key
 * input for red/gated covers, and an offline / retry / proxy strip only when Civitai does not answer).
 * Once scanning starts, it tucks into a compact bottom-right progress pill inside the window so Home
 * and the other pages remain usable; if a finished scan had no key and missed covers, it offers a
 * 1-click "Add key & rescan" jump back to the dialog with the key box open.
 *
 * The review console rehearses four states (`idle`, `offline_choice`, `running`, `done_missing_covers`)
 * strictly in browser memory: never writes localStorage or calls save_config/scan on the server.
 */

import { translate as t } from './locales.js';
import { describeFirstRun } from './first_run_state.js';
import { failureWords } from './net_failure.js';
import { isScanRunning, startScan } from './scan_runner.js';
import { resultLine } from './scan_results.js';
import { startSpotlightTour } from './ui_spotlight_tour.js';
import { pickModelFiles } from './ui_model_import.js';
import { openSettingsPage } from './ui_settings_page.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { comfyDialogOpen } from './ui_key_guard.js';

const HIDDEN_KEY = 'anomalous_first_run_hidden';
const POLL_MS = 2000;
const PREVIEWS = {
    idle: { phase: 'idle', counts: { total: 42, waiting: 42 }, hasKey: false },
    offline_choice: { phase: 'offline_choice', counts: { total: 42, waiting: 42 }, netFailure: 'timeout', hasKey: false },
    running: { phase: 'running', counts: { total: 42, waiting: 42 }, progress: { current: 18, total: 42 } },
    done_missing_covers: {
        phase: 'done', counts: { total: 42, waiting: 0 }, hasKey: false, offline: false,
        result: { counts: { matched: 28, inferred: 9, covers: 23, covers_missed: 5 } },
    },
};

const initialState = () => ({
    phase: 'idle', // first_run_state.js
    netFailure: '',
    netError: '',
    keyRefused: false,
    hasKey: false,
    keyOpen: false,
    keyFeedback: null, // { ok: boolean, key: string, params?: object }
    offline: false,
    progress: null, // { current, total } while scanning
    result: null,
    counts: null, // { total, waiting }
    shown: false, // this page session: keep showing it (a scan started, or requested from footer)
});
const state = initialState();
let preview = null; // { mode, onEnd, keyOpen, keyFeedback, ...cardState }
let host = null; // #anomalous-first-run-host mounted inside #anomalous-container
let owner = null;
let escapeBound = false;
let langBound = false;

function readHidden() {
    try {
        return localStorage.getItem(HIDDEN_KEY) === '1';
    } catch {
        return false;
    }
}

function writeHidden(hidden) {
    try {
        if (hidden) localStorage.setItem(HIDDEN_KEY, '1');
        else localStorage.removeItem(HIDDEN_KEY);
    } catch { /* this session only */ }
}

async function getJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

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

const activeState = () => preview || state;
const containerOf = (browser) => browser?.modal?.querySelector('#anomalous-container') || browser?.modal || document.body;

/** Whether the welcome overlay belongings on startup: nothing scanned yet and not previously hidden. */
async function wanted() {
    if (state.shown) return true;
    if (readHidden()) return false;
    const last = await getJson('/anomalous/last_scan').catch(() => ({}));
    if (last && Object.keys(last).length) return false;
    const [summary, config] = await Promise.all([getJson('/anomalous/scan_summary'), getJson('/anomalous/config').catch(() => ({}))]);
    if ((summary.matched || 0) + (summary.unmatched || 0) > 0) return false;
    state.counts = { total: summary.total || 0, waiting: summary.new || 0 };
    state.hasKey = Boolean(config.has_api_key);
    return true;
}

async function refreshCountsAndKey() {
    const [summary, config] = await Promise.all([
        getJson('/anomalous/scan_summary').catch(() => null),
        getJson('/anomalous/config').catch(() => null),
    ]);
    if (summary) state.counts = { total: summary.total || 0, waiting: summary.new || 0 };
    if (config && 'has_api_key' in config) state.hasKey = Boolean(config.has_api_key);
}

/** The running scan's bar and count, updated in place. */
function paintProgress() {
    if (!host) return;
    const { current = 0, total = 0 } = activeState().progress || {};
    host.querySelector('.anomalous-first-run-track')?.classList.toggle('is-waiting', !total);
    const fill = host.querySelector('.anomalous-first-run-fill');
    if (fill) fill.style.width = total ? `${Math.min(100, Math.round((current / total) * 100))}%` : '';
    const count = host.querySelector('.anomalous-first-run-count');
    if (count) count.textContent = total ? `${Math.min(current, total)} / ${total}` : t('firstRunScanPreparing');
}

function progressRow() {
    const row = el('div', 'anomalous-first-run-progress');
    const track = el('div', 'anomalous-first-run-track');
    track.append(el('div', 'anomalous-first-run-fill'));
    row.append(track, el('span', 'anomalous-first-run-count'));
    return row;
}

/** Collapsible optional Civitai Key input right inside the welcome dialog. */
function keyFoldout(shown, view) {
    const details = el('details', 'anomalous-first-run-key');
    details.open = Boolean(shown.keyOpen);
    const summary = el('summary', 'anomalous-first-run-key-summary', t(view.hasKey ? 'firstRunKeySummarySaved' : 'firstRunKeySummary'));
    details.ontoggle = () => { shown.keyOpen = details.open; };

    const body = el('div', 'anomalous-first-run-key-body');
    const row = el('div', 'anomalous-first-run-key-row');
    const input = el('input', 'anomalous-first-run-key-input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = t('firstRunKeyPlaceholder');
    input.setAttribute('aria-label', t('firstRunKeyPlaceholder'));

    const status = el('small', 'anomalous-first-run-key-status');
    const renderFeedback = () => {
        const fb = shown.keyFeedback;
        status.textContent = fb ? t(fb.key, fb.params) : '';
        status.classList.toggle('is-bad', Boolean(fb && !fb.ok));
        status.hidden = !fb;
    };
    renderFeedback();

    const toggle = button('anomalous-first-run-btn', t('firstRunKeyShow'), () => {
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        toggle.textContent = t(showing ? 'firstRunKeyShow' : 'firstRunKeyHide');
    });
    const saveBtn = button('anomalous-first-run-btn is-strong', t('firstRunKeySave'), () => void saveInlineKey());

    const saveInlineKey = async () => {
        const trimmed = input.value.trim();
        if (preview) {
            preview.hasKey = Boolean(trimmed);
            preview.keyOpen = true;
            preview.keyFeedback = { ok: true, key: 'firstRunPreviewKeySaved' };
            summary.textContent = t(preview.hasKey ? 'firstRunKeySummarySaved' : 'firstRunKeySummary');
            renderFeedback();
            return;
        }
        saveBtn.disabled = true;
        try {
            const res = await fetch('/anomalous/save_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: trimmed }),
            });
            const data = await res.json();
            if (!res.ok || data.status !== 'ok') throw new Error(data.message || `HTTP ${res.status}`);
            state.hasKey = Boolean(trimmed);
            state.keyRefused = false;
            state.keyOpen = true;
            state.keyFeedback = { ok: true, key: trimmed ? 'firstRunKeySaved' : 'firstRunKeyCleared' };
            summary.textContent = t(state.hasKey ? 'firstRunKeySummarySaved' : 'firstRunKeySummary');
            renderFeedback();
        } catch (error) {
            state.keyFeedback = { ok: false, key: 'firstRunKeySaveFailed', params: { error: String(error.message || error) } };
            renderFeedback();
        } finally {
            if (saveBtn.isConnected) saveBtn.disabled = false;
        }
    };

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            void saveInlineKey();
        } else if (event.key !== 'Escape') {
            event.stopPropagation();
        }
    });

    row.append(input, toggle, saveBtn);
    body.append(el('p', 'anomalous-first-run-key-help', t('firstRunKeyInlineHelp')), row, status);
    details.append(summary, body);
    return details;
}

/** Civitai did not answer: why, and the three ways on. */
function fallbackStrip(view) {
    const { failure, error } = view.fallback;
    const strip = el('div', 'anomalous-first-run-fallback');
    strip.setAttribute('role', 'status');
    const ways = el('div', 'anomalous-first-run-ways');
    ways.append(
        button('anomalous-first-run-btn is-strong', t('firstRunScanOffline'), () => void runScan(true)),
        button('anomalous-first-run-btn', t('firstRunRetry'), () => void scanWithCheck()),
        button('anomalous-first-run-btn', t('firstRunProxySettings'), () => {
            hideForNavigation();
            openSettingsPage(owner, { tab: 'models', section: 'network' });
        }),
    );
    strip.append(el('p', 'anomalous-first-run-fallback-text', t(view.fallbackKey, { why: failure ? failureWords(failure) : error || '—' })), ways);
    return strip;
}

/** Civitai refused the key: scan goes on; inline way to open key input or scan page. */
function keyNote() {
    const note = el('p', 'anomalous-first-run-note');
    note.append(t('firstRunKeyRefusedNote'), ' ', button('anomalous-first-run-link', t('firstRunKeyFix'), () => {
        hideForNavigation();
        owner?.openScanPage();
    }));
    return note;
}

const PRIMARY = {
    import: () => {
        hideForNavigation();
        void pickModelFiles(owner);
    },
    scan: () => void scanWithCheck(),
    retry: () => void (activeState().offline ? runScan(true) : scanWithCheck()),
};

function drawDialog(shown, view) {
    const card = el('div', 'anomalous-first-run-dialog');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'anomalous-first-run-title');

    const closeBtn = button('anomalous-first-run-close', '×', hide);
    closeBtn.setAttribute('aria-label', t(view.dismissKey));
    const emblem = el('img', 'anomalous-first-run-emblem');
    emblem.src = new URL('../assets/home_models.webp', import.meta.url).href;
    emblem.alt = '';
    emblem.width = 56;
    emblem.height = 56;

    const title = el('h2', 'anomalous-first-run-title', t(view.titleKey));
    title.id = 'anomalous-first-run-title';
    const lead = el('p', 'anomalous-first-run-lead', t(view.bodyKey, view.bodyParams));
    card.append(closeBtn, emblem, title, lead);

    if (view.primaryAction !== 'none') {
        const go = button('anomalous-first-run-go', t(view.primaryLabelKey), PRIMARY[view.primaryAction]);
        go.disabled = view.primaryDisabled;
        card.append(go);
    }
    if (view.showOfflineScan) {
        const off = button('anomalous-first-run-btn is-strong anomalous-first-run-secondary-wide', t('firstRunScanOffline'), () => void runScan(true));
        card.append(off);
    }
    if (view.showFallback) card.append(fallbackStrip(view));
    if (view.showKeyFoldout) card.append(keyFoldout(shown, view));
    if (view.keyWarning) card.append(keyNote());

    const foot = el('div', 'anomalous-first-run-foot');
    if (view.showTourLink) {
        foot.append(button('anomalous-first-run-link', t('firstRunTourQuick'), () => {
            hideForNavigation();
            startSpotlightTour(owner);
        }));
    }
    foot.append(button('anomalous-first-run-later', t(view.dismissKey), hide));
    card.append(foot);
    return card;
}

function drawDock(shown, view) {
    const dock = el('div', 'anomalous-first-run-dock');
    dock.setAttribute('role', 'status');
    const head = el('div', 'anomalous-first-run-dock-head');
    if (view.kind === 'running') {
        head.append(el('span', 'anomalous-first-run-dock-title', t('firstRunRunningTitle')),
            el('span', 'anomalous-first-run-count'));
    } else {
        head.append(el('span', 'anomalous-first-run-pill is-ok', t(view.pillKey)));
    }
    const closeBtn = button('anomalous-first-run-close is-dock', '×', hide);
    closeBtn.setAttribute('aria-label', t(view.dismissKey));
    head.append(closeBtn);
    dock.append(head);

    if (view.kind === 'running') {
        dock.append(progressRow());
        return dock;
    }

    const summary = resultLine(shown.result) || t(view.bodyKey);
    dock.append(el('p', 'anomalous-first-run-dock-body', summary));
    if (view.suggestKey) {
        const nudge = el('div', 'anomalous-first-run-nudge');
        nudge.append(el('span', 'anomalous-first-run-nudge-text', t('firstRunMissingCoversHint')),
            button('anomalous-first-run-btn is-strong', t('firstRunMissingCoversBtn'), () => void jumpToKeyRescan()));
        dock.append(nudge);
    }
    if (view.keyWarning) dock.append(keyNote());
    if (view.showTourLink) {
        const foot = el('div', 'anomalous-first-run-dock-foot');
        foot.append(button('anomalous-first-run-link', t('firstRunTourQuick'), () => {
            hideForNavigation();
            startSpotlightTour(owner);
        }));
        dock.append(foot);
    }
    return dock;
}

function draw() {
    if (!host?.isConnected) return;
    const shown = activeState();
    const view = describeFirstRun(shown);
    const asDialog = view.presentation === 'dialog';
    host.className = asDialog ? 'anomalous-first-run-overlay' : 'anomalous-first-run-dock-wrap';
    if (asDialog) host.dataset.anomalousEscape = '1';
    else delete host.dataset.anomalousEscape;
    host.replaceChildren(asDialog ? drawDialog(shown, view) : drawDock(shown, view));
    if (view.kind === 'running') paintProgress();
    if (asDialog && shown.keyOpen) {
        const focusTarget = host.querySelector('.anomalous-first-run-key-input');
        requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
    }
}

function unmount() {
    host?.remove();
    host = null;
}

function hide() {
    if (preview) {
        const { onEnd } = preview;
        clearFirstRunPreview();
        return onEnd?.();
    }
    writeHidden(true);
    state.shown = false;
    unmount();
}

function hideForNavigation() {
    if (preview) {
        const { onEnd } = preview;
        clearFirstRunPreview();
        return onEnd?.();
    }
    state.shown = false;
    unmount();
}

function onEscape(event) {
    if (event.key !== 'Escape' || host?.dataset.anomalousEscape !== '1') return;
    if (!owner?.modal?.classList.contains('visible')) return;
    if (comfyDialogOpen()) return;
    if (document.querySelector('.anomalous-feedback-overlay, .anomalous-dialog-overlay, .anomalous-spotlight-overlay, .anomalous-workbench-overlay, .anomalous-picker-overlay, .anomalous-recipe-dialog-overlay, .anomalous-prompt-studio-overlay, .anomalous-update-guide[open], dialog[open]')) return;
    hide();
}

function mount() {
    const parent = containerOf(owner);
    if (!escapeBound) {
        escapeBound = true;
        window.addEventListener('keydown', onEscape);
    }
    if (!langBound) {
        langBound = true;
        window.addEventListener('anomalous-language-change', () => {
            if (host?.isConnected) draw();
        });
    }
    if (!host || host.parentNode !== parent) {
        unmount();
        host = el('div');
        host.id = 'anomalous-first-run-host';
        host.addEventListener('click', (event) => {
            if (event.target === host && host.dataset.anomalousEscape === '1') hide();
        });
        parent.append(host);
    }
    draw();
}

async function jumpToKeyRescan() {
    if (preview) {
        preview = { mode: 'idle', onEnd: preview.onEnd, ...PREVIEWS.idle, keyOpen: true, keyFeedback: null };
        draw();
        return;
    }
    await showFirstRun(owner, { openKey: true });
}

/** A press in the review console's card: nothing is scanned. */
const rehearsed = () => showWorkbenchToast(t('firstRunPreviewNoScan'));

/** "Scan my models": Civitai first; when it answers, scan in corner dock; when not, inline fallback strip. */
async function scanWithCheck() {
    if (preview) return rehearsed();
    if (state.phase === 'checking' || state.phase === 'running' || isScanRunning()) return;
    Object.assign(state, { shown: true, phase: 'checking', netFailure: '', netError: '', keyRefused: false, keyFeedback: null });
    draw();
    try {
        const answer = await getJson('/anomalous/civitai_check');
        if (answer.reachable) {
            state.keyRefused = answer.key === 'refused';
            return runScan(false);
        }
        state.netFailure = answer.failure || '';
        state.netError = answer.error || '';
    } catch (error) {
        state.netError = String(error.message || error);
    }
    state.phase = 'offline_choice';
    draw();
}

async function followProgress() {
    while (state.phase === 'running') {
        try {
            const status = await getJson('/anomalous/global_scan_status');
            state.progress = { current: Number(status.current) || 0, total: Number(status.total) || 0 };
            paintProgress();
        } catch { /* next poll tries again */ }
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
}

/** Scans every model (offline: files only); card docks to bottom-right during scan. */
async function runScan(offline) {
    if (preview) return rehearsed();
    if (state.phase === 'running' || isScanRunning()) return;
    Object.assign(state, { shown: true, phase: 'running', offline, progress: null, keyOpen: false, keyFeedback: null });
    mount();
    void followProgress();
    const result = await startScan(owner, { offline, virtualRename: true, physicalRename: false, forceOverwrite: false, autoFix: true });
    state.phase = result ? 'done' : 'failed';
    state.result = result;
    if (!result) await refreshCountsAndKey();
    draw();
}

/** Shows the floating welcome dialog or scan dock when wanted. */
export async function renderFirstRun(browser) {
    owner = browser;
    let show = Boolean(preview);
    if (!show) {
        try {
            show = await wanted();
        } catch (error) {
            console.warn('[AMB] First-run card: could not read the scan state.', error);
        }
    }
    if (!(show || preview)) return;
    mount();
}

/** Home footer's "First-time scan" or dock's "Add key & rescan": opens centered welcome dialog. */
export async function showFirstRun(browser, { openKey = false } = {}) {
    owner = browser;
    writeHidden(false);
    state.shown = true;
    if (state.phase !== 'checking' && state.phase !== 'running') state.phase = 'idle';
    state.keyOpen = Boolean(openKey);
    state.keyFeedback = null;
    await refreshCountsAndKey();
    mount();
}

/** Review console preview: strictly in memory, never writes localStorage or scans. */
export function previewFirstRun(browser, mode = 'idle', onEnd = null) {
    owner = browser;
    preview = { mode, onEnd, keyOpen: false, keyFeedback: null, ...PREVIEWS[mode] };
    if (!browser.modal?.classList.contains('visible')) browser.show({ page: 'home' });
    mount();
}

/** Ends preview; restores real active scan state if any, else removes host. */
export function clearFirstRunPreview() {
    if (!preview) return;
    preview = null;
    if (state.shown) mount();
    else unmount();
}

export const firstRunPreviewMode = () => preview?.mode || null;

/** Forgets this page's card (the review console's sandbox comes in or goes): shown again only as wanted. */
export function resetFirstRun() {
    preview = null;
    Object.assign(state, initialState());
    unmount();
}
