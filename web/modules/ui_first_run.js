/**
 * The first-run card on Home (开始使用): while no model has been scanned yet, a card above the task cards
 * with one button, "Scan my models" (what it shows: first_run_state.js). The press asks Civitai first
 * (GET /anomalous/civitai_check) and, when it answers, scans every model (scan_runner.js; the card shows
 * how far it is). Only when Civitai does not answer does a strip offer an offline scan, a retry or the
 * proxy (Settings → Models & Network). The Civitai key is set on the scan page and in Settings; a key
 * Civitai refuses does not stop the scan, a note says so. Never a popup: it shows on Home only, "Later"
 * hides it in this browser, and Home's "New here?" line brings it back. Its state lives here, so Home
 * drawn again (another visit, the language) keeps where it was.
 *
 * The review console shows the card as a new user meets it (previewFirstRun): sample folders in memory;
 * its buttons scan nothing and "Later" ends the preview without hiding the real card.
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

const HIDDEN_KEY = 'anomalous_first_run_hidden';
const POLL_MS = 2000;
// The review console's card: 42 models never scanned; Civitai not answering in time.
const PREVIEWS = {
    idle: { phase: 'idle', counts: { total: 42, waiting: 42 } },
    offline_choice: { phase: 'offline_choice', counts: { total: 42, waiting: 42 }, netFailure: 'timeout' },
};

const state = {
    phase: 'idle', // first_run_state.js
    netFailure: '',
    netError: '',
    keyRefused: false,
    offline: false,
    progress: null, // { current, total } while scanning
    result: null,
    counts: null, // { total, waiting }
    shown: false, // this page session: keep showing it (a scan was started, or it was asked for)
};
let preview = null; // { mode, onEnd, ...a card state } while the review console shows the card
let card = null; // the drawn card; replaced on each draw
let owner = null;

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

/** Whether the card belongs on Home: nothing scanned yet (one walk of the folders, only then). */
async function wanted() {
    if (state.shown) return true;
    if (readHidden()) return false;
    const last = await getJson('/anomalous/last_scan').catch(() => ({}));
    if (last && Object.keys(last).length) return false;
    const summary = await getJson('/anomalous/scan_summary');
    if ((summary.matched || 0) + (summary.unmatched || 0) > 0) return false; // scanned with an older version
    state.counts = { total: summary.total || 0, waiting: summary.new || 0 };
    return true;
}

async function refreshCounts() {
    try {
        const summary = await getJson('/anomalous/scan_summary');
        state.counts = { total: summary.total || 0, waiting: summary.new || 0 };
    } catch { /* keep the last counts */ }
}

/** The running scan's bar and count, in place (no redraw). */
function paintProgress() {
    if (!card) return;
    const { current = 0, total = 0 } = state.progress || {};
    card.querySelector('.anomalous-first-run-track')?.classList.toggle('is-waiting', !total);
    const fill = card.querySelector('.anomalous-first-run-fill');
    if (fill) fill.style.width = total ? `${Math.min(100, Math.round((current / total) * 100))}%` : '';
    const count = card.querySelector('.anomalous-first-run-count');
    if (count) count.textContent = total ? `${Math.min(current, total)} / ${total}` : t('firstRunScanPreparing');
}

function progressRow() {
    const row = el('div', 'anomalous-first-run-progress');
    const track = el('div', 'anomalous-first-run-track');
    track.append(el('div', 'anomalous-first-run-fill'));
    row.append(track, el('span', 'anomalous-first-run-count'));
    return row;
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
        button('anomalous-first-run-btn', t('firstRunProxySettings'), () => openSettingsPage(owner, { tab: 'models', section: 'network' })),
    );
    strip.append(el('p', 'anomalous-first-run-fallback-text', t(view.fallbackKey, { why: failure ? failureWords(failure) : error || '—' })), ways);
    return strip;
}

/** Civitai refused the key: the scan went on; where to set another. */
function keyNote() {
    const note = el('p', 'anomalous-first-run-note');
    note.append(t('firstRunKeyRefusedNote'), ' ', button('anomalous-first-run-link', t('firstRunKeyFix'), () => owner?.openScanPage()));
    return note;
}

const PRIMARY = {
    import: () => pickModelFiles(owner),
    scan: () => void scanWithCheck(),
    retry: () => void ((preview || state).offline ? runScan(true) : scanWithCheck()),
};

function draw() {
    if (!card?.isConnected) return;
    const shown = preview || state;
    const view = describeFirstRun(shown);
    const fresh = el('section', 'anomalous-first-run');
    fresh.setAttribute('aria-label', t(view.titleKey));
    const head = el('div', 'anomalous-first-run-head');
    const copy = el('div', 'anomalous-first-run-headcopy');
    const body = (view.kind === 'done' && resultLine(shown.result)) || t(view.bodyKey, view.bodyParams);
    copy.append(el('h2', 'anomalous-first-run-title', t(view.titleKey)), el('p', 'anomalous-first-run-lead', body));
    head.append(copy, button('anomalous-first-run-later', t(view.dismissKey), hide));
    fresh.append(head);
    if (view.kind === 'running') fresh.append(progressRow());
    if (view.showFallback) fresh.append(fallbackStrip(view));
    const foot = el('div', 'anomalous-first-run-foot');
    if (view.primaryAction !== 'none') {
        const go = button('anomalous-first-run-go', t(view.primaryLabelKey), PRIMARY[view.primaryAction]);
        go.disabled = view.primaryDisabled;
        foot.append(go);
    }
    if (view.pillKey) foot.append(el('span', 'anomalous-first-run-pill is-ok', t(view.pillKey)));
    if (view.showOfflineScan) foot.append(button('anomalous-first-run-btn', t('firstRunScanOffline'), () => void runScan(true)));
    // After the scan a button; before it a quiet link (the tour never starts by itself).
    if (view.showTourLink) {
        foot.append(button(view.kind === 'done' ? 'anomalous-first-run-btn' : 'anomalous-first-run-link', t('firstRunTourQuick'), () => startSpotlightTour(owner)));
    }
    if (foot.childElementCount) fresh.append(foot);
    if (view.keyWarning) fresh.append(keyNote());
    card.replaceWith(fresh);
    card = fresh;
    if (view.kind === 'running') paintProgress();
}

function hide() {
    if (preview) {
        const { onEnd } = preview;
        clearFirstRunPreview();
        return onEnd?.(); // the console's pill goes out
    }
    writeHidden(true);
    state.shown = false;
    card?.remove();
    card = null;
}

/** A press in the review console's card: nothing is scanned. */
const rehearsed = () => showWorkbenchToast(t('firstRunPreviewNoScan'));

/** "Scan my models": Civitai first; when it answers, the scan; when not, the strip with the ways on. */
async function scanWithCheck() {
    if (preview) return rehearsed();
    if (state.phase === 'checking' || state.phase === 'running' || isScanRunning()) return;
    Object.assign(state, { shown: true, phase: 'checking', netFailure: '', netError: '', keyRefused: false });
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
        } catch { /* the next poll tries again */ }
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
}

/** Scans every model (offline: from the files only); the card follows it. */
async function runScan(offline) {
    if (preview) return rehearsed();
    if (state.phase === 'running' || isScanRunning()) return;
    Object.assign(state, { shown: true, phase: 'running', offline, progress: null });
    draw();
    void followProgress();
    // Never renames files or fetches everything again, whatever the scan page was set to last.
    const result = await startScan(owner, { offline, virtualRename: true, physicalRename: false, forceOverwrite: false, autoFix: true });
    state.phase = result ? 'done' : 'failed';
    state.result = result;
    if (!result) await refreshCounts();
    draw();
}

/** The card on `page` before `before`, drawn (the one already there is kept). */
function mount(page, before) {
    if (card?.parentNode !== page) {
        card = el('section', 'anomalous-first-run');
        page.insertBefore(card, before);
    }
    draw();
}

/** Puts the card before `before` on Home's `page` when it is wanted. */
export async function renderFirstRun(browser, page, before) {
    owner = browser;
    let show = Boolean(preview);
    if (!show) {
        try {
            show = await wanted();
        } catch (error) {
            console.warn('[AMB] First-run card: could not read the scan state.', error);
        }
    }
    if (!(show || preview) || !page.isConnected || !before.isConnected) return;
    mount(page, before);
}

/** Home's "New here?" link: the card again, even when hidden or after a scan. */
export async function showFirstRun(browser, page, before) {
    writeHidden(false);
    state.shown = true;
    if (!state.counts) await refreshCounts();
    if (card?.isConnected) {
        card.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
    }
    await renderFirstRun(browser, page, before);
    card?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** The review console: the card as a new user meets it ('idle'), or as Civitai not answering leaves it
 * ('offline_choice'), on Home; `onEnd()` when the card's own "Later" ends the preview. */
export function previewFirstRun(browser, mode = 'idle', onEnd = null) {
    owner = browser;
    preview = { mode, onEnd, ...PREVIEWS[mode] };
    const home = browser.homePanel;
    if (card?.isConnected && home?.contains(card) && home.style.display !== 'none' && browser.modal?.classList.contains('visible')) draw();
    else browser.show({ page: 'home' }); // Home drawn anew puts the card in (renderFirstRun)
}

/** The preview ends; the real card comes back where it belongs, else the card goes. */
export function clearFirstRunPreview() {
    if (!preview) return;
    preview = null;
    if (!card?.isConnected) return;
    const page = card.parentElement;
    const before = page.querySelector(':scope > .anomalous-home-mains');
    card.remove();
    card = null;
    if (before) void renderFirstRun(owner, page, before);
}

export const firstRunPreviewMode = () => preview?.mode || null;
