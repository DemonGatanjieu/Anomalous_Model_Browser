/**
 * Downloading the models the open workflow is missing, behind Model Check's "Download"
 * (api/model_download.py does the downloading; ui_model_download.js shows it, and
 * download_places.js says where a file goes). No DOM.
 *
 * When a download ends, the model lists reload, every node still
 * naming that model gets the file (one Ctrl+Z step each), and the files of the batch are
 * scanned for their information and covers once nothing is downloading.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { applyModelFix, checkWorkflowModels } from './model_check.js';
import { destinationFor, expandFolder } from './download_places.js';
import { inferModelFolderTypes } from './model_policies.js';
import { startScan, targetsForItems } from './scan_runner.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const POLL_MS = 1000;
const ROOT_KEY = 'anomalous_download_root_';
const ACTIVE = new Set(['queued', 'running', 'verifying']);

const slashes = (value) => String(value || '').replace(/\\/g, '/');
const fileName = (value) => slashes(value).split('/').pop();

const jobs = new Map(); // id -> latest status
const listeners = new Set();
const lookups = new Map(); // lookup key -> result
let pollTimer = 0;
let batch = [];
let scanOwner = null;

async function json(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || `HTTP ${response.status}`);
        error.code = data.error || 'http';
        throw error;
    }
    return data;
}

const post = (url, body) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Where downloads go: { place: 'workflow' | 'folder', folder }. */
export const fetchDownloadSettings = () => json('/anomalous/download/settings');
export const saveDownloadSettings = (changes) => post('/anomalous/download/settings', changes);

/** The link a shared workflow keeps for a model: AMB's, else ComfyUI's own (`properties.models`). */
export function workflowLink(entry) {
    const value = entry.value;
    const kept = app.graph?.extra?.anomalous_model_sources || {};
    const saved = kept[value] || kept[slashes(value)] || kept[fileName(value)] || kept[`${entry.node.id}_${value}`];
    const url = typeof saved === 'string' ? saved : saved?.url;
    if (url) return url;
    const name = fileName(value).toLowerCase();
    const native = [
        ...(entry.node.properties?.models || []),
        ...(app.extensionManager?.workflow?.activeWorkflow?.activeState?.models || []),
    ];
    return native.find(model => String(model?.name || '').split(/[\\/]/).pop().toLowerCase() === name)?.url || '';
}

const lookupKey = (item) => `${item.hash}|${item.url}|${item.value}|${item.mirror}`;

/** Whether Hugging Face files come from its mirror: as set, else for a Chinese interface. */
export function hfMirrorOn(settings) {
    return typeof settings?.hf_mirror === 'boolean' ? settings.hf_mirror : window.anomalous_browser_lang === 'zh';
}

/**
 * Where each entry can be downloaded from: { found: Map entry -> { found, source, size, sha256,
 * base_model, page, type, roots, reason… }, settings }. Sources are asked once per page load
 * (a network failure again next time); the model folders (free space, subfolders) every time.
 */
export async function lookupDownloads(entries) {
    const settings = await fetchDownloadSettings().catch(() => ({ place: 'workflow', folder: 'Downloads', hf_mirror: null }));
    const mirror = hfMirrorOn(settings);
    const items = entries.map((entry, index) => {
        const item = { key: String(index), hash: entry.record?.hash || '', url: workflowLink(entry), value: entry.value, mirror };
        return { ...item, types: inferModelFolderTypes(entry.node, entry.widget), known: lookups.has(lookupKey(item)) };
    });
    const data = await post('/anomalous/download/lookup', { items, hf_mirror: mirror });
    const found = new Map();
    for (const result of data.results || []) {
        const item = items.find(candidate => candidate.key === result.key);
        if (!item) continue;
        let info = item.known ? lookups.get(lookupKey(item)) : result;
        // A name alone is looked up too (ComfyUI-Manager's model list); a network failure is asked again.
        if (!item.known && result.reason !== 'network') lookups.set(lookupKey(item), result);
        if (!info) continue;
        info = { ...info, type: result.type, roots: data.roots?.[result.type] || [], link: item.url };
        found.set(entries[Number(item.key)], info);
    }
    return { found, settings };
}

function notify() {
    for (const listener of listeners) {
        try { listener(jobs); } catch (error) { console.warn('[AMB] Download: a listener failed.', error); }
    }
}

/** Calls `listener(jobs)` whenever a download moves on; returns the way to stop. */
export function watchDownloads(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** The newest download of a workflow value (its model), if any. */
export function downloadFor(value) {
    let latest = null;
    for (const job of jobs.values()) if (job.value === value) latest = job;
    return latest;
}

/** The models folder of a type a download goes to unless changed: the one picked last, else
 * the first that exists (ComfyUI also lists folders that do not, such as output/loras). */
export function defaultRoot(type, roots = []) {
    const existing = roots.filter(root => root.exists);
    const usable = existing.length ? existing : roots.slice(0, 1);
    let index = -1;
    try { index = Number(localStorage.getItem(ROOT_KEY + type) ?? -1); } catch { /* the first one */ }
    return usable.find(root => root.index === index) || usable[0] || null;
}

export function rememberRoot(type, index) {
    try { localStorage.setItem(ROOT_KEY + type, String(index)); } catch { /* not kept */ }
}

/**
 * For AI apps (MCP download_missing_models): starts the download of every missing model of the
 * open workflow whose source is certain (or of those named in `names`), where the download
 * settings put it. Returns what started and why the others did not.
 */
export async function downloadMissing(owner, names = []) {
    const wanted = new Set((names || []).map(name => fileName(name).toLowerCase()));
    const entries = (await checkWorkflowModels()).filter(entry => entry.state === 'missing'
        && (!wanted.size || wanted.has(fileName(entry.value).toLowerCase())));
    const once = [...new Map(entries.map(entry => [entry.value, entry])).values()]; // one per model
    const { found, settings } = once.length ? await lookupDownloads(once) : { found: new Map(), settings: null };
    const started = [];
    const notStarted = [];
    for (const entry of once) {
        const info = found.get(entry);
        if (ACTIVE.has(downloadFor(entry.value)?.state)) {
            notStarted.push({ model: entry.value, reason: 'already downloading' });
        } else if (!info?.found) {
            notStarted.push({ model: entry.value, reason: info?.reason || (entry.record?.hash || workflowLink(entry) ? 'not_found' : 'no_source') });
        } else if (info.by_name) {
            // Only a file of the same name: the user decides (download_model with this url, if they agree).
            notStarted.push({ model: entry.value, reason: 'same name only (ComfyUI-Manager model list); the workflow has no fingerprint to check it',
                url: info.download_url, list_name: info.list_name || '' });
        } else {
            const root = defaultRoot(info.type, info.roots);
            const rel = destinationFor(entry, info, settings, root?.subfolders || []);
            try {
                await startDownload(owner, entry, info, { root: root?.index ?? 0, rel });
                started.push({ model: entry.value, to: rel, models_folder: root?.path || '', size: info.size || null,
                    source: info.mirror ? 'huggingface (mirror)' : info.source, page: info.page || '', checked: Boolean(info.sha256 || entry.record?.hash) });
            } catch (error) {
                notStarted.push({ model: entry.value, reason: error.code || String(error.message || error) });
            }
        }
    }
    return { started, not_started: notStarted };
}

/**
 * For AI apps (MCP download_model): downloads one model named by a Civitai / Hugging Face /
 * GitHub file link or a Civitai hash into the `type` folder: `folder` (relative) when given,
 * else the download settings' folder ({base} filled in); `name` (the site's when empty).
 */
export async function downloadFrom(owner, { url = '', hash = '', type = '', folder = null, name = '' }) {
    const settings = await fetchDownloadSettings();
    const data = await post('/anomalous/download/lookup', {
        items: [{ key: '0', hash: String(hash || ''), url: String(url || ''), value: String(name || ''), types: [String(type)] }],
        hf_mirror: hfMirrorOn(settings),
    });
    const result = data.results?.[0] || {};
    if (!result.type) throw new Error(`"${type}" is not a model folder type of this ComfyUI (loras, checkpoints, vae…).`);
    if (!result.found) throw new Error(`No file to download: ${result.reason || 'not_found'}.`);
    const info = { ...result, roots: data.roots?.[result.type] || [] };
    const root = defaultRoot(info.type, info.roots);
    const file = fileName(name || info.file_name);
    const dir = folder !== null && folder !== undefined
        ? slashes(folder).split('/').filter(Boolean).join('/')
        : expandFolder(settings.folder ?? 'Downloads', info.base_model, root?.subfolders || []);
    const rel = dir ? `${dir}/${file}` : file;
    const job = await startDownload(owner, { value: '', record: { hash: String(hash || '') } }, info, { root: root?.index ?? 0, rel });
    return { started: true, id: job.id, to: rel, models_folder: root?.path || '', size: info.size || null,
        source: info.mirror ? 'huggingface (mirror)' : info.source, model: [info.model_name, info.version_name].filter(Boolean).join(' — '),
        base_model: info.base_model || '', checked: Boolean(info.sha256 || hash) };
}

export const downloadsActive = () => [...jobs.values()].some(job => ACTIVE.has(job.state));
export const doneCount = () => [...jobs.values()].filter(job => job.state === 'done').length;

/** Takes in the downloads already running (started before the page reloaded). */
export async function syncDownloads(owner) {
    const latest = (await json('/anomalous/download/status')).jobs || [];
    for (const job of latest) if (!jobs.has(job.id)) jobs.set(job.id, job);
    if (downloadsActive()) {
        scanOwner = scanOwner || owner;
        poll();
    }
}

/** Starts (or continues) one download; `choice` = { root, rel }. Rejects with `.code` when refused. */
export async function startDownload(owner, entry, info, choice) {
    scanOwner = owner;
    const job = await post('/anomalous/download/start', {
        key: entry.value, value: entry.value, download_url: info.download_url, type: info.type,
        root: choice.root, rel: choice.rel, size: info.size || 0, sha256: info.sha256 || '',
        hash: entry.record?.hash || '', source: info.source, page: info.page || '',
    });
    jobs.set(job.id, job);
    notify();
    poll();
    return job;
}

export async function cancelDownload(id) {
    const job = await post('/anomalous/download/cancel', { id });
    jobs.set(job.id, job);
    notify();
}

function poll() {
    if (pollTimer) return;
    pollTimer = setTimeout(async () => {
        pollTimer = 0;
        let latest = [];
        try {
            latest = (await json('/anomalous/download/status')).jobs || [];
        } catch (error) {
            console.warn('[AMB] Download: status failed.', error);
        }
        for (const job of latest) {
            const before = jobs.get(job.id);
            jobs.set(job.id, job);
            if (job.state === 'done' && before && before.state !== 'done') await afterDownload(job);
        }
        notify();
        if (downloadsActive()) poll();
        else scanBatch();
    }, POLL_MS);
}

/** ComfyUI's drop-downs (the server already cleared its file-list caches). */
async function reloadModelLists() {
    try {
        await app.refreshComboInNodes?.();
    } catch (error) {
        console.warn('[AMB] Download: could not reload the model lists.', error);
    }
}

/** Puts the new file into every node still naming the model it was downloaded for. */
async function afterDownload(job) {
    await reloadModelLists();
    const rel = slashes(job.rel);
    let put = 0;
    for (const node of app.graph?._nodes || []) {
        for (const widget of node.widgets || []) {
            if (widget.type !== 'combo' || widget.value !== job.value) continue;
            const target = (widget.options?.values || []).find(value => typeof value === 'string' && slashes(value) === rel);
            // Same place as the workflow says: nothing changes, ComfyUI's missing mark goes.
            if (target && applyModelFix({ node, widget, value: job.value }, target) && target !== job.value) put += 1;
        }
    }
    showWorkbenchToast(t(put ? 'downloadDonePutIn' : 'downloadDone', { name: job.file }));
    batch.push({ type: job.type, path_idx: job.root, rel, filename: job.file });
}

/** The downloaded files' information and covers: one scan of the whole batch. */
async function scanBatch() {
    if (!batch.length || !scanOwner) return;
    const items = batch;
    batch = [];
    await startScan(scanOwner, { targets: targetsForItems(items) });
}
