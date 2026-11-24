/**
 * The review console's blank sandbox (ui_review_console.js): AMB as a new user meets it, with nothing of this
 * computer's, kept in this page's memory only. While it is on:
 * - every request the page makes under /anomalous/ goes to review_sandbox_data.js's server in memory: a read it
 *   knows nothing about is answered empty, a change it does not stand in for is refused with a toast and never
 *   sent, uploads too; Civitai's API is not asked about its fingerprints;
 * - AMB's own keys in this browser's storage are read and written in memory, the first-visit ones not there yet
 *   (theme and language stay the real switches the console puts back);
 * - the canvas in front is a tab of the sandbox's (a blank one, then the shared workflow), its model boxes list
 *   the sandbox's files, and ComfyUI's refresh of those lists is the sandbox's;
 * - the pages forget what they kept of the real library (downloads, the first-run card, the Civitai answer, Tidy's
 *   count, quick search, the canvas bar) and AMB's window starts again from Home.
 * Leaving (here, Reset, ×, the page going away) waits for a scan the sandbox started, closes its tab, puts each
 * of these back and lets the pages read the real library again.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import {
    answerRequest, createSandbox, downloadsRunning, isWorkflowStorageKey, resetProgress, sandboxModelValues, scanRunning, setLibrary, setNetwork,
    shareDemoWorkflow,
} from './review_sandbox_data.js';
import { SHARED_COVER, demoWorkflow } from './review_sandbox_workflow.js';
import { modelBoxes } from './model_check.js';
import { inferModelFolderTypes } from './model_policies.js';
import { downloadsActive, resetDownloadMemory } from './model_download.js';
import { forgetTidyCount } from './model_placement.js';
import { forgetSources } from './quick_search_data.js';
import { forgetCivitaiAnswer } from './scan_connection.js';
import { isScanRunning } from './scan_runner.js';
import { resetFirstRun } from './ui_first_run.js';
import { setPageTipSandbox } from './ui_page_tip.js';
import { checkOpenWorkflow, clearDoctorBanner } from './ui_doctor_banner.js';
import { closeCopy, showTab } from './mcp_task_tab.js';
import { tabName } from './mcp_canvas_edit.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const MODEL_FILE = /\.(safetensors|ckpt|pt|bin|pth|sft|gguf)$/i;
const KEEP_REAL = new Set(['anomalous_lang', 'anomalous_theme', 'anomalous_theme_abyssal_scarlet']);
// What a new user's browser does not have yet (prefixes): not there in the sandbox until it writes them.
const FRESH = ['anomalous_first_run_hidden', 'anomalous_page_tips_seen', 'anomalous_check_on_open', 'anomalous_model_scope', 'anomalous_download_root_'];
const EMPTY_GRAPH = { last_node_id: 0, last_link_id: 0, nodes: [], links: [], groups: [], config: {}, extra: {}, version: 0.4 };
const BLOCK_TOAST_MS = 3000;
const SETTLE_MS = 8000;

const live = {
    sandbox: null,
    leaving: false,
    getBrowser: () => null,
    onChange: null,
    real: null,          // what the sandbox stood in for: { fetch, storage, open, send, refresh, load }
    overlay: new Map(),  // localStorage keys kept in memory (AMB keys + ComfyUI workflow tabs/drafts)
    sessionOverlay: new Map(), // sessionStorage keys for ComfyUI's per-tab workflow pointers
    uploads: new WeakSet(),
    tab: null,           // { path, back, snapshot (one-tab ComfyUI), shared }
    opening: false,
    unknown: new Set(),
    blockedAt: 0,
    chip: null,
    cover: null,
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const store = () => app.extensionManager?.workflow || null;
const owner = () => live.getBrowser();
const changed = () => live.onChange?.();

// ---------------------------------------------------------------- what the sandbox stands in for

const sandboxKey = key => typeof key === 'string' && key.startsWith('anomalous_') && !KEEP_REAL.has(key);

function storageOverlay(storage, key) {
    if (storage === window.localStorage) {
        if (live.sandbox && sandboxKey(key)) return { map: live.overlay, fresh: true };
        if (isWorkflowStorageKey(key)) return { map: live.overlay, fresh: false };
    } else if (storage === window.sessionStorage && isWorkflowStorageKey(key)) {
        return { map: live.sessionOverlay, fresh: false };
    }
    return null;
}

function holdStorage(real) {
    const proto = Storage.prototype;
    Object.assign(real, { getItem: proto.getItem, setItem: proto.setItem, removeItem: proto.removeItem });
    proto.getItem = function (key) {
        const target = storageOverlay(this, key);
        if (!target) return real.getItem.call(this, key);
        if (target.map.has(key)) return target.map.get(key);
        return target.fresh && FRESH.some(prefix => key.startsWith(prefix)) ? null : real.getItem.call(this, key);
    };
    proto.setItem = function (key, value) {
        const target = storageOverlay(this, key);
        if (!target) return real.setItem.call(this, key, value);
        target.map.set(key, String(value));
    };
    proto.removeItem = function (key) {
        const target = storageOverlay(this, key);
        if (!target) return real.removeItem.call(this, key);
        target.map.set(key, null);
    };
}

const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ownRoute = url => url.origin === window.location.origin && url.pathname.startsWith('/anomalous/');

function refused() {
    const now = Date.now();
    if (now - live.blockedAt > BLOCK_TOAST_MS) showWorkbenchToast(t('reviewSandboxBlocked'));
    live.blockedAt = now;
}

async function bodyOf(input, init) {
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
    if (typeof raw !== 'string') return null; // a form or a file: nothing the sandbox reads
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function sandboxFetch(input, init) {
    const real = live.real.fetch;
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (!live.sandbox || !ownRoute(url)) {
        // The sandbox's made-up fingerprints never go out to Civitai.
        if (live.sandbox && /(^|\.)civitai\.(com|red)$/.test(url.hostname) && url.pathname.startsWith('/api/')) return respond({ error: 'Not found' }, 404);
        return real.call(window, input, init);
    }
    if (init?.signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const answer = answerRequest(live.sandbox, { method, path: url.pathname, query: url.searchParams, body: await bodyOf(input, init), now: Date.now() });
    if (answer.pass) return real.call(window, input, init);
    if (answer.blocked) {
        refused();
        return respond({ status: 'error', error: 'sandbox', message: t('reviewSandboxBlocked') }, 403);
    }
    if (answer.fallback && !live.unknown.has(url.pathname)) {
        live.unknown.add(url.pathname);
        console.info(`[AMB] Sandbox: no stand-in for GET ${url.pathname}, answered empty.`);
    }
    return respond(answer.body, answer.status);
}

function holdUploads(real) {
    const proto = XMLHttpRequest.prototype;
    Object.assign(real, { open: proto.open, send: proto.send });
    proto.open = function (method, url, ...rest) {
        if (ownRoute(new URL(String(url), window.location.href))) live.uploads.add(this);
        else live.uploads.delete(this);
        return real.open.call(this, method, url, ...rest);
    };
    proto.send = function (body) {
        if (!live.sandbox || !live.uploads.has(this)) return real.send.call(this, body);
        refused();
        setTimeout(() => this.dispatchEvent(new ProgressEvent('error')), 0);
    };
}

const sandboxTabInFront = () => Boolean(live.tab || live.opening)
    && (live.opening || live.tab.snapshot !== null || store()?.activeWorkflow?.path === live.tab.path);

/** The model boxes of the sandbox's tab list the sandbox's files. Each box gets a list of its own: the one it
 * had is shared by every node of its type, in the user's tabs too. */
function syncModelBoxes() {
    for (const node of app.graph?._nodes || []) {
        for (const widget of modelBoxes(node)) {
            if (widget.type !== 'combo' || !widget.options) continue;
            const values = Array.isArray(widget.options.values) ? widget.options.values : [];
            if (!MODEL_FILE.test(String(widget.value)) && !values.some(value => MODEL_FILE.test(String(value)))) continue;
            const types = inferModelFolderTypes(node, widget);
            if (types.length) widget.options.values = sandboxModelValues(live.sandbox, types);
        }
    }
    app.graph?.setDirtyCanvas?.(true, true);
}

/** The sandbox's tab, opened or brought back: its boxes list the sandbox's files, then Model Check's bar checks it. */
function afterSandboxLoad() {
    syncModelBoxes();
    checkOpenWorkflow(owner()).catch(error => console.warn('[AMB] Sandbox: checking its workflow failed.', error));
}

function holdCanvas(real) {
    Object.assign(real, { refresh: app.refreshComboInNodes, load: app.loadGraphData });
    app.refreshComboInNodes = async () => {
        if (live.sandbox && sandboxTabInFront()) syncModelBoxes();
    };
    const load = real.load;
    app.loadGraphData = async function (...args) {
        const result = await load.apply(this, args);
        if (live.sandbox && sandboxTabInFront()) afterSandboxLoad();
        return result;
    };
}

function releaseRuntime() {
    const real = live.real;
    if (!real) return;
    window.fetch = real.fetch;
    Object.assign(XMLHttpRequest.prototype, { open: real.open, send: real.send });
    Object.assign(app, { refreshComboInNodes: real.refresh, loadGraphData: real.load });
}

function releaseStorage() {
    const real = live.real;
    if (!real) return;
    Object.assign(Storage.prototype, { getItem: real.getItem, setItem: real.setItem, removeItem: real.removeItem });
    live.real = null;
    live.overlay.clear();
    live.sessionOverlay.clear();
}

// ---------------------------------------------------------------- the sandbox's canvas tab

async function openTab(graph, nameKey, shared) {
    const workflows = store();
    const before = live.tab;
    const back = before ? before.back : workflows?.activeWorkflow?.path || '';
    const snapshot = before ? before.snapshot : (workflows ? null : app.graph.serialize());
    live.opening = true;
    try {
        await app.loadGraphData(graph, true, true, tabName(t(nameKey)));
    } finally {
        live.opening = false;
    }
    live.tab = { path: workflows?.activeWorkflow?.path || '', back, snapshot, shared };
    if (before?.path && before.path !== live.tab.path) await closeCopy(before.path, live.tab.path);
}

async function closeTab() {
    const tab = live.tab;
    live.tab = null;
    if (!tab) return;
    if (tab.snapshot) {
        await app.loadGraphData(tab.snapshot, true, true);
    } else if (!await closeCopy(tab.path, tab.back) && store()?.activeWorkflow?.path === tab.path && tab.back) {
        await showTab(tab.back); // kept (saved meanwhile): at least the user's own tab in front
    }
}

// ---------------------------------------------------------------- the pages

/** What the pages kept of one library, forgotten before the other is read. */
function forgetPages() {
    resetDownloadMemory();
    resetFirstRun();
    forgetCivitaiAnswer();
    forgetTidyCount();
    forgetSources();
}

/** AMB's window from the start: folders, models and the gallery read again when next shown. */
function freshView(browser) {
    if (!browser) return;
    if (browser.detailPanel) {
        browser.stopMediaInContainer?.(browser.detailPanel);
        browser.detailPanel.replaceChildren();
    }
    browser.grid?.replaceChildren();
    Object.assign(browser, {
        firstLoadDone: false, modelScope: null, modelView: '', modelBase: null, galleryLoaded: false, foldersData: null,
        currentDetailModel: null, historyStack: [],
    });
}

/** The "sandbox, memory only" chip in AMB's window (again after a language change). */
export function markSandboxWindow() {
    live.chip?.remove();
    live.chip = null;
    const container = owner()?.modal?.querySelector('#anomalous-container');
    if (!live.sandbox || live.leaving || !container) return;
    live.chip = document.createElement('div');
    live.chip.className = 'anomalous-sandbox-chip';
    live.chip.setAttribute('role', 'status');
    live.chip.textContent = t('reviewSandboxBadge');
    container.append(live.chip);
}

function home() {
    const browser = owner();
    freshView(browser);
    browser?.show({ page: 'home' });
    markSandboxWindow();
}

/** A scan or download running (the sandbox's or the real one). */
function busy() {
    const now = Date.now();
    const running = isScanRunning() || downloadsActive() || (live.sandbox && (scanRunning(live.sandbox, now) || downloadsRunning(live.sandbox, now)));
    if (running) showWorkbenchToast(t('reviewSandboxBusy'));
    return Boolean(running);
}

async function sharedCover() {
    if (live.cover) return live.cover;
    try {
        const blob = await (await fetch(SHARED_COVER)).blob();
        live.cover = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob); // the Workflows page shows only a picture kept in the workflow
        });
    } catch (error) {
        console.warn('[AMB] Sandbox: the shared workflow\'s cover did not load.', error);
    }
    return live.cover;
}

// ---------------------------------------------------------------- the console's controls

export function sandboxState() {
    const sandbox = live.sandbox;
    return {
        on: Boolean(sandbox) && !live.leaving, leaving: live.leaving, library: sandbox?.library || '', network: sandbox?.network || '',
        shared: Boolean(live.tab?.shared),
    };
}

/** Into the sandbox: `getBrowser()` gives AMB's window, `onChange()` redraws the console. False when it cannot start. */
export async function enterSandbox(getBrowser, onChange) {
    if (live.sandbox || live.leaving) return true;
    live.getBrowser = getBrowser;
    live.onChange = onChange;
    if (busy()) return false;
    live.sandbox = createSandbox();
    live.unknown.clear();
    const real = { fetch: window.fetch };
    window.fetch = sandboxFetch;
    holdStorage(real);
    holdUploads(real);
    holdCanvas(real);
    live.real = real;
    forgetPages();
    clearDoctorBanner();
    setPageTipSandbox(true);
    await window.anomalous_reload_hashes?.();
    await openTab(structuredClone(EMPTY_GRAPH), 'reviewSandboxTab', false);
    home();
    changed();
    return true;
}

/** Out of the sandbox: everything as before it, the real library read again. */
export async function exitSandbox() {
    if (!live.sandbox || live.leaving) return;
    live.leaving = true;
    markSandboxWindow();
    changed();
    // A scan the sandbox started ends in it: its last steps read the sandbox, never the user's library.
    for (let waited = 0; waited < SETTLE_MS && (isScanRunning() || scanRunning(live.sandbox, Date.now())); waited += 200) await wait(200);
    resetDownloadMemory();
    clearDoctorBanner(live.tab?.path || '');
    releaseRuntime();
    live.sandbox = null;
    try {
        try {
            await closeTab();
        } finally {
            releaseStorage();
        }
        await app.refreshComboInNodes?.();
        await window.anomalous_reload_hashes?.();
    } catch (error) {
        console.warn('[AMB] Sandbox: putting the canvas back failed.', error);
    }
    forgetPages();
    setPageTipSandbox(false);
    live.leaving = false;
    markSandboxWindow();
    const browser = owner();
    const shown = browser?.modal?.classList.contains('visible');
    freshView(browser);
    if (shown) browser.show({ page: 'home' });
    changed();
}

/** The model library: 'empty' or 'one' (as at the start: nothing scanned or downloaded). */
export async function setSandboxLibrary(library) {
    if (!live.sandbox || busy()) return;
    setLibrary(live.sandbox, library);
    await libraryChanged();
}

/** Whether Civitai answers: 'online' or 'offline'. */
export function setSandboxNetwork(network) {
    if (!live.sandbox) return;
    setNetwork(live.sandbox, network);
    forgetCivitaiAnswer();
    changed();
}

async function libraryChanged() {
    forgetPages();
    await window.anomalous_reload_hashes?.();
    if (sandboxTabInFront()) afterSandboxLoad();
    home();
    changed();
}

/** Scans, downloads, the key and notes back to the start; the shared workflow, if open, opened anew. */
export async function resetSandboxProgress() {
    if (!live.sandbox || busy()) return;
    resetProgress(live.sandbox);
    forgetPages();
    await window.anomalous_reload_hashes?.();
    if (live.tab?.shared) await openTab(demoWorkflow(), 'reviewSandboxWorkflowTab', true);
    const browser = owner();
    if (browser?.modal?.classList.contains('visible')) home();
    else freshView(browser);
    changed();
}

/** "Add a shared workflow": on the Workflows page and in a tab of its own, with one model here; again: anew. */
export async function openSharedWorkflow() {
    const sandbox = live.sandbox;
    if (!sandbox || busy()) return;
    const switched = sandbox.library !== 'one';
    if (switched) setLibrary(sandbox, 'one');
    shareDemoWorkflow(sandbox, { name: t('reviewSandboxWorkflowName'), notes: t('reviewSandboxWorkflowNotes'), thumbnail: await sharedCover() });
    resetDownloadMemory();
    forgetSources();
    if (switched) forgetPages();
    await window.anomalous_reload_hashes?.();
    const browser = owner();
    freshView(browser);
    browser?.close?.(); // the canvas and its bar in view
    await openTab(demoWorkflow(), 'reviewSandboxWorkflowTab', true);
    showWorkbenchToast(t('reviewSandboxWorkflowPlaced'));
    changed();
}
