/**
 * The first-run setup on Home (开始使用): while no model has been scanned yet, a card above the
 * task cards with four steps and "Set up for me": check that Civitai answers (GET
 * /anomalous/civitai_check; a proxy is often needed, else scan offline), the optional Civitai
 * key (ui_scan_settings.js), a scan of every model (scan_runner.js; the card shows how far it
 * is) and the tour. Never a popup: it shows on Home only, "Later" hides it in this browser, and
 * Home's "New here?" line brings it back. Its state lives here, so Home drawn again (another
 * visit, the language) keeps where it was.
 */

import { translate as t } from './locales.js';
import { isScanRunning, startScan } from './scan_runner.js';
import { resultLine } from './scan_results.js';
import { saveApiKey } from './ui_scan_settings.js';
import { startSpotlightTour } from './ui_spotlight_tour.js';

const HIDDEN_KEY = 'anomalous_first_run_hidden';
const POLL_MS = 2000;

const state = {
    net: 'idle', // idle | checking | ok | fail
    netError: '',
    netMs: 0,
    keyRefused: false,
    hasKey: false,
    scan: 'idle', // idle | running | done | failed
    progress: null, // { current, total } while scanning
    result: null,
    counts: null, // { total, waiting }
    shown: false, // this page session: keep showing it (a step was taken, or it was asked for)
};
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
    const [summary, config] = await Promise.all([getJson('/anomalous/scan_summary'), getJson('/anomalous/config').catch(() => ({}))]);
    if ((summary.matched || 0) + (summary.unmatched || 0) > 0) return false; // scanned with an older version
    state.counts = { total: summary.total || 0, waiting: summary.new || 0 };
    state.hasKey = Boolean(config.has_api_key);
    return true;
}

async function refreshCounts() {
    try {
        const summary = await getJson('/anomalous/scan_summary');
        state.counts = { total: summary.total || 0, waiting: summary.new || 0 };
    } catch { /* keep the last counts */ }
}

function step(icon, title, body, aside, extra = null) {
    const row = el('div', 'anomalous-first-run-step');
    const copy = el('div', 'anomalous-first-run-copy');
    copy.append(el('span', 'anomalous-first-run-step-title', title), el('span', 'anomalous-first-run-step-body', body));
    if (extra) copy.append(extra);
    row.append(el('span', 'anomalous-first-run-icon', icon), copy, aside);
    return row;
}

const pill = (text, tone = '') => el('span', `anomalous-first-run-pill${tone ? ` is-${tone}` : ''}`, text);
const small = (label, onClick) => button('anomalous-first-run-btn', label, onClick);

function actions(...nodes) {
    const box = el('div', 'anomalous-first-run-aside');
    box.append(...nodes);
    return box;
}

function netStep() {
    const body = state.net === 'fail' ? t('firstRunNetFail', { error: state.netError || '—' }) : t('firstRunNetBody');
    const aside = state.net === 'checking' ? actions(pill(t('firstRunNetChecking')))
        : state.net === 'ok' ? actions(pill(t('firstRunNetOk', { ms: state.netMs }), 'ok'))
            : state.net === 'fail' ? actions(pill(t('firstRunNetDown'), 'bad'), small(t('firstRunRetry'), () => void checkNet()),
                small(t('firstRunScanOffline'), () => void runScan(true)))
                : actions(small(t('firstRunCheck'), () => void checkNet()));
    return step('🌐', t('firstRunNetTitle'), body, aside);
}

function keyStep() {
    const body = state.keyRefused ? t('firstRunKeyRefused') : t('firstRunKeyBody');
    const label = state.hasKey ? t('firstRunKeyChange') : t('firstRunKeySet');
    const aside = actions(...(state.hasKey && !state.keyRefused ? [pill(t('firstRunKeyHas'), 'ok')] : []), small(label, () => void setKey()));
    return step('🔑', t('firstRunKeyTitle'), body, aside);
}

function scanStep() {
    const total = state.counts?.total || 0;
    if (state.scan === 'idle' && !total) return step('📦', t('firstRunScanTitle'), t('firstRunScanNone'), actions());
    if (state.scan === 'running') {
        const bar = el('div', 'anomalous-first-run-track');
        bar.append(el('div', 'anomalous-first-run-fill'));
        const line = el('span', 'anomalous-first-run-count');
        const row = step('📦', t('firstRunScanTitle'), t('firstRunScanRunning'), actions(line), bar);
        row.classList.add('is-current');
        paintProgress(row);
        return row;
    }
    if (state.scan === 'done') {
        return step('📦', t('firstRunScanTitle'), resultLine(state.result) || t('firstRunScanDoneBody'), actions(pill(t('firstRunScanDone'), 'ok')));
    }
    const waiting = state.counts?.waiting || 0;
    const body = state.scan === 'failed' ? t('firstRunScanFailed') : waiting ? t('firstRunScanBody', { count: waiting }) : t('firstRunScanNothingNew');
    return step('📦', t('firstRunScanTitle'), body, actions(small(t(state.scan === 'failed' ? 'firstRunRetry' : 'firstRunScanStart'), () => void runScan(false))));
}

/** The running scan's bar and count, in place (no redraw). */
function paintProgress(row = card?.querySelector('.anomalous-first-run-step.is-current')) {
    if (!row) return;
    const { current = 0, total = 0 } = state.progress || {};
    const fill = row.querySelector('.anomalous-first-run-fill');
    const track = row.querySelector('.anomalous-first-run-track');
    track?.classList.toggle('is-waiting', !total);
    if (fill) fill.style.width = total ? `${Math.min(100, Math.round((current / total) * 100))}%` : '';
    const count = row.querySelector('.anomalous-first-run-count');
    if (count) count.textContent = total ? `${Math.min(current, total)} / ${total}` : t('firstRunScanPreparing');
}

function tourStep() {
    return step('🧭', t('firstRunTourTitle'), t('firstRunTourBody'), actions(small(t('firstRunTourStart'), () => startSpotlightTour(owner))));
}

function draw() {
    if (!card?.isConnected) return;
    const fresh = el('section', 'anomalous-first-run');
    fresh.setAttribute('aria-label', t('firstRunTitle'));
    const head = el('div', 'anomalous-first-run-head');
    const copy = el('div', 'anomalous-first-run-headcopy');
    copy.append(el('h2', 'anomalous-first-run-title', t('firstRunTitle')), el('p', 'anomalous-first-run-lead', t('firstRunLead')));
    head.append(copy, button('anomalous-first-run-later', t(state.scan === 'done' ? 'firstRunDone' : 'firstRunLater'), hide));
    const steps = el('div', 'anomalous-first-run-steps');
    steps.append(netStep(), keyStep(), scanStep(), tourStep());
    fresh.append(head, steps);
    if (state.scan !== 'done') {
        const foot = el('div', 'anomalous-first-run-foot');
        const go = button('anomalous-first-run-go', t('firstRunGo'), () => void setUp());
        go.disabled = state.scan === 'running' || state.net === 'checking';
        foot.append(go, el('span', 'anomalous-first-run-note', t('firstRunGoNote')));
        fresh.append(foot);
    }
    card.replaceWith(fresh);
    card = fresh;
}

function hide() {
    writeHidden(true);
    state.shown = false;
    card?.remove();
    card = null;
}

async function checkNet() {
    state.shown = true;
    state.net = 'checking';
    draw();
    try {
        const answer = await getJson('/anomalous/civitai_check');
        state.net = answer.reachable ? 'ok' : 'fail';
        state.netError = answer.error || '';
        state.netMs = answer.ms || 0;
        state.keyRefused = answer.key === 'refused';
    } catch (error) {
        state.net = 'fail';
        state.netError = String(error.message || error);
    }
    draw();
}

async function setKey() {
    state.shown = true;
    if (!await saveApiKey()) return;
    state.hasKey = Boolean((await getJson('/anomalous/config').catch(() => ({}))).has_api_key);
    state.keyRefused = false;
    draw();
}

async function followProgress() {
    while (state.scan === 'running') {
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
    if (state.scan === 'running' || isScanRunning()) return;
    state.shown = true;
    state.scan = 'running';
    state.progress = null;
    draw();
    void followProgress();
    // Never renames files or fetches everything again, whatever the scan page was set to last.
    const result = await startScan(owner, { offline, virtualRename: true, physicalRename: false, forceOverwrite: false, autoFix: true });
    state.scan = result ? 'done' : 'failed';
    state.result = result;
    if (!result) await refreshCounts();
    draw();
}

/** "Set up for me": the network, then the scan, then the tour; stops where it needs a choice. */
async function setUp() {
    if (state.net !== 'ok') await checkNet();
    if (state.net !== 'ok') return; // the step says what to do: retry with a proxy, or scan offline
    await runScan(false);
    if (state.scan === 'done' && owner?.modal?.classList.contains('visible')) startSpotlightTour(owner);
}

/** Puts the card before `before` on Home's `page` when it is wanted. */
export async function renderFirstRun(browser, page, before) {
    owner = browser;
    let show = false;
    try {
        show = await wanted();
    } catch (error) {
        console.warn('[AMB] First-run setup: could not read the scan state.', error);
    }
    if (!show || !page.isConnected || !before.isConnected) return;
    card = el('section', 'anomalous-first-run');
    page.insertBefore(card, before);
    draw();
}

/** Home's "New here?" link: the card again, even when hidden or after a scan. */
export async function showFirstRun(browser, page, before) {
    writeHidden(false);
    state.shown = true;
    if (!state.counts) await refreshCounts();
    if (!state.hasKey) state.hasKey = Boolean((await getJson('/anomalous/config').catch(() => ({}))).has_api_key);
    if (card?.isConnected) {
        card.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
    }
    await renderFirstRun(browser, page, before);
    card?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
