/**
 * The review console's blank sandbox, as data: a pretend AMB server held in this page's memory, which
 * review_sandbox.js puts between the page and the real one. Its library is empty or holds one model; Civitai
 * answers or does not; a scan and a download move on by the clock; the workflow someone shared
 * (review_sandbox_workflow.js) is on the Workflows page once added. `answerRequest` is the one way in: a route it
 * knows answers from memory, a read it leaves alone goes on to the server, and any other change is refused, never
 * sent. No DOM and no window: tests/review_sandbox.mjs drives it in Node.
 */

import { DOWNLOADED_LORA, LIBRARY_MODEL, RECIPE_FILE, SANDBOX_HASHES, sharedRecipe, sourceFor } from './review_sandbox_workflow.js';

export const SANDBOX_TYPES = ['checkpoints', 'loras', 'vae'];
export const LIBRARIES = ['empty', 'one'];
export const NETWORKS = ['online', 'offline'];

// A scan: preparing, then the files one by one, done at 3 s (the pages poll every 2 s and see each part).
const PREPARE_MS = 700;
const SCAN_DONE_MS = 3000;
// A download: queued, received, checked, done at 3 s.
const QUEUED_MS = 300;
const RECEIVED_MS = 2400;
const DOWNLOAD_DONE_MS = 3000;
const ACTIVE = new Set(['queued', 'running', 'verifying']);
const FREE_BYTES = 512 * 1024 ** 3;
const MIB = 1024 * 1024;
const MODEL_FILE = /\.(safetensors|ckpt|pt|bin|pth|sft|gguf)$/i;

const slashes = value => String(value ?? '').replace(/\\/g, '/');
const baseName = value => slashes(value).split('/').pop();
const folderOf = rel => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const copy = value => JSON.parse(JSON.stringify(value));
const REPLY = Symbol('reply');
const reply = (body, status = 200) => ({ [REPLY]: true, status, body });

function model(template, rel = template.rel) {
    return {
        type: template.type, path_idx: 0, rel, size: template.size, cover: template.cover || '',
        coverAfterScan: template.coverAfterScan || '', known: Boolean(template.known), scanned: '', meta: copy(template.meta),
    };
}

function fill(sandbox) {
    sandbox.models = sandbox.library === 'one' ? [model(LIBRARY_MODEL)] : [];
    sandbox.scan = null;
    sandbox.lastScan = {};
    sandbox.jobs = new Map();
}

/** A sandbox as a new user meets it: `library` 'empty' | 'one', `network` 'online' | 'offline'. */
export function createSandbox({ library = 'one', network = 'online' } = {}) {
    const sandbox = {
        library: LIBRARIES.includes(library) ? library : 'one', network: NETWORKS.includes(network) ? network : 'online',
        hasKey: false, shared: null, runs: 0, downloadSettings: { place: 'workflow', folder: '{base}', hf_mirror: null },
    };
    fill(sandbox);
    return sandbox;
}

/** Another library: its models as at the start, nothing scanned or downloaded. */
export function setLibrary(sandbox, library) {
    if (!LIBRARIES.includes(library)) throw new Error(`unknown library ${library}`);
    sandbox.library = library;
    fill(sandbox);
}

export function setNetwork(sandbox, network) {
    if (!NETWORKS.includes(network)) throw new Error(`unknown network ${network}`);
    sandbox.network = network;
}

/** Back to the start of the library and network chosen: no scan, no download, no key, notes gone. */
export function resetProgress(sandbox) {
    fill(sandbox);
    sandbox.hasKey = false;
    sandbox.downloadSettings = { place: 'workflow', folder: '{base}', hf_mirror: null };
}

/** The shared workflow on the Workflows page too: `name`, `notes` in the page's language, `thumbnail` a data URL. */
export function shareDemoWorkflow(sandbox, { name, notes = '', thumbnail = null }) {
    sandbox.shared = { name: String(name), notes: String(notes), thumbnail };
}

/** The files the sandbox's ComfyUI lists for a model box of `types` (model_policies.js inferModelFolderTypes). */
export function sandboxModelValues(sandbox, types) {
    return sandbox.models.filter(item => types.includes(item.type)).map(item => item.rel).sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------- the library

function metadata(item) {
    const meta = item.meta;
    const known = item.known;
    return {
        name: known ? meta.name : '', description: known ? meta.description : '', notes: '',
        trainedWords: known ? [...meta.trainedWords] : [], headerWords: [], baseModel: known ? meta.baseModel : '',
        civitai_url: '', source_url: meta.source_url || '', hash: meta.hash, hash_algorithm: 'sha256', hash_scope: 'file',
        hash_source: 'sandbox', custom_name: meta.custom_name || '', custom_notes: meta.custom_notes || '', ai_note: meta.ai_note || '',
        ai_name: '', ai_about: [], version_name: known ? meta.version_name : '', base_guess: '', info_source: known ? 'civitai' : '',
        unmatched_reason: '', user_fields: [], scan_choice: '', not_drawing: false, model_id: 0, version_id: 0,
    };
}

function entry(item) {
    return {
        filename: baseName(item.rel), file_path: `models/${item.type}/${item.rel}`, size_mb: Math.round((item.size / MIB) * 100) / 100,
        size_bytes: item.size, metadata: metadata(item), preview_url: item.cover, type: item.type, path_idx: item.path_idx,
        subfolder: folderOf(item.rel),
    };
}

/** The model info resolve_paths_to_previews and find_model give: the subfolder with its leading slash. */
function located(item) {
    const folder = folderOf(item.rel);
    return { ...entry(item), subfolder: folder ? `/${folder}` : '/' };
}

const place = item => ({ type: item.type, path_idx: item.path_idx, filename: baseName(item.rel), rel: item.rel });
const named = item => item.meta.custom_name || (item.known ? item.meta.name : '') || baseName(item.rel).replace(/\.[^.]+$/, '');
const ofType = (sandbox, type, pathIdx = 0) => sandbox.models.filter(item => item.type === type && item.path_idx === pathIdx);

function folders(sandbox) {
    return {
        folders: SANDBOX_TYPES.map((type) => {
            const tree = { '/': { path: '/', name: type, has_models: false, model_count: 0 } };
            for (const item of ofType(sandbox, type)) {
                const parts = folderOf(item.rel).split('/').filter(Boolean);
                parts.forEach((name, index) => {
                    const key = `/${parts.slice(0, index + 1).join('/')}`;
                    tree[key] ||= { path: key, name, has_models: false, model_count: 0 };
                });
                const here = tree[parts.length ? `/${parts.join('/')}` : '/'];
                here.has_models = true;
                here.model_count += 1;
            }
            return { type, path_idx: 0, label: type, folders: tree };
        }),
    };
}

function inFolder(sandbox, query) {
    const folder = slashes(query.get('subfolder') || '/').replace(/^\/+|\/+$/g, '');
    const models = ofType(sandbox, query.get('type'), Number(query.get('path_idx') || 0)).filter(item => folderOf(item.rel) === folder);
    return { models: models.map(entry), total: models.length, page: 1, limit: 0 };
}

function summary(sandbox) {
    const models = sandbox.models;
    const matched = models.filter(item => item.scanned === 'online');
    const offline = models.filter(item => item.scanned === 'offline');
    const waiting = models.filter(item => !item.scanned);
    return {
        total: models.length, matched: matched.length, unmatched: offline.length, new: waiting.length, pending: offline.length,
        damaged: 0, not_drawing: 0, excluded: 0, excluded_models: [],
        unmatched_models: offline.map(item => ({ ...place(item), component: false, state: 'unmatched', reason: 'offline', base: item.meta.baseModel })),
        new_models: waiting.map(place), skipped: 0, skipped_models: [],
        components: { total: 0, matched: 0, unmatched: 0, new: 0, pending: 0 }, component_models: [],
        covers: matched.filter(item => item.cover).map(item => ({ name: named(item), preview_url: item.cover })),
    };
}

function hashIndex(sandbox) {
    const hashes = {};
    for (const item of sandbox.models) {
        const record = { hash: item.meta.hash.toUpperCase(), size: item.size };
        hashes[item.rel] = record;
        hashes[baseName(item.rel)] = record;
    }
    return hashes;
}

function resolveOne(sandbox, { hash = '', size = '', type = '' }) {
    const types = String(type).split(',').filter(Boolean);
    const pool = sandbox.models.filter(item => !types.length || types.includes(item.type));
    const wanted = String(hash).toUpperCase();
    const byHash = wanted && pool.find(item => item.meta.hash.toUpperCase() === wanted);
    if (byHash) return { found: true, type: byHash.type, filename: byHash.rel };
    const bySize = String(size) ? pool.filter(item => String(item.size) === String(size)) : [];
    if (bySize.length === 1) {
        return { found: false, confirmation_required: true, matched_by_size: true, hash_required: false, type: bySize[0].type, filename: bySize[0].rel, size: bySize[0].size };
    }
    return { found: false };
}

function findByPath(sandbox, path, types = null, exact = false) {
    const wanted = slashes(path).toLowerCase();
    const pool = sandbox.models.filter(item => !types || types.includes(item.type));
    return pool.find(item => item.rel.toLowerCase() === wanted)
        || (exact ? null : pool.find(item => baseName(item.rel).toLowerCase() === baseName(wanted))) || null;
}

function resolvePaths(sandbox, body) {
    const types = Array.isArray(body?.folder_types) ? body.folder_types : null;
    const models = {};
    for (const path of Array.isArray(body?.paths) ? body.paths : []) {
        const found = typeof path === 'string' && findByPath(sandbox, path, types, body.exact_only === true);
        if (found) models[path] = located(found);
    }
    const context = {};
    for (const request of Array.isArray(body?.context_requests) ? body.context_requests.slice(0, 16) : []) {
        const found = typeof request?.path === 'string' && findByPath(sandbox, request.path, request.folder_types || null, request.exact_only === true);
        if (found) context[request.key || request.path] = located(found);
    }
    const previews = Object.fromEntries(Object.entries(models).map(([path, info]) => [path, info.preview_url]));
    return { previews, models, context_models: context };
}

function updateMetadata(sandbox, body) {
    const folder = slashes(body?.subfolder || '/').replace(/^\/+|\/+$/g, '');
    const rel = folder ? `${folder}/${body?.filename}` : String(body?.filename || '');
    const item = sandbox.models.find(candidate => candidate.type === body?.type && candidate.rel === rel);
    if (!item) return reply({ status: 'error', message: 'Model not found' }, 404);
    for (const [field, key] of [['custom_name', 'custom_name'], ['custom_notes', 'custom_notes'], ['ai_note', 'ai_note'], ['custom_source_url', 'source_url']]) {
        if (typeof body[field] === 'string') item.meta[key] = body[field].trim();
    }
    return reply({ status: 'success' });
}

// ---------------------------------------------------------------- scans

function settle(sandbox, now) {
    const scan = sandbox.scan;
    if (scan && !scan.done && now - scan.started >= SCAN_DONE_MS) finishScan(sandbox, now);
    for (const job of sandbox.jobs.values()) advance(sandbox, job, now);
}

function startScan(sandbox, { kind, offline, targets, now }) {
    if (sandbox.scan && !sandbox.scan.done) return reply({ status: 'error', message: 'A scan is already running' }, 409);
    const picked = Array.isArray(targets) && targets.length
        ? sandbox.models.filter(item => targets.some(target => target.type === item.type && Number(target.path_idx || 0) === item.path_idx
            && folderOf(item.rel) === slashes(target.subfolder || '/').replace(/^\/+|\/+$/g, '')
            && (!target.files?.length || target.files.includes(baseName(item.rel)))))
        : sandbox.models;
    sandbox.runs += 1;
    sandbox.scan = { kind, offline: Boolean(offline), files: picked, started: now, job: `sandbox-scan-${sandbox.runs}`, done: false };
    return reply({ status: 'ok', recovered: 0, job_id: sandbox.scan.job });
}

function finishScan(sandbox, now) {
    const scan = sandbox.scan;
    scan.done = true;
    const down = !scan.offline && sandbox.network === 'offline';
    const files = scan.files.map((item) => {
        if (scan.offline || down) {
            if (item.scanned !== 'online') item.scanned = 'offline';
            return { status: 'inferred', reason: 'offline', base: item.meta.baseModel, ...place(item) };
        }
        const hadCover = Boolean(item.cover);
        Object.assign(item, { scanned: 'online', known: true, cover: item.cover || item.coverAfterScan });
        return { status: 'matched', name: item.meta.name, base: item.meta.baseModel, cover: hadCover ? 'kept' : 'new', ...place(item) };
    });
    sandbox.lastScan = {
        kind: scan.kind, options: { offline_only: scan.offline }, started: scan.started / 1000, finished: now / 1000,
        counts: {
            matched: files.filter(file => file.status === 'matched').length, inferred: files.filter(file => file.status === 'inferred').length,
            failed: 0, covers: files.filter(file => file.cover === 'new').length, covers_missed: 0, renamed: 0, unchanged: 0,
        },
        civitai_down: down, civitai_error: down ? 'timeout' : '', errors: [], files,
    };
}

/** global_scan_status (and scan_status for one model) at `now`. */
export function scanStatus(sandbox, now) {
    settle(sandbox, now);
    const scan = sandbox.scan;
    const idle = { scanning: false, interrupted: false, job_id: scan?.job || '', phase: scan ? 'done' : 'idle', total: scan?.files.length || 0, current: scan?.files.length || 0, filename: '' };
    if (!scan || scan.done) return idle;
    const total = scan.files.length;
    const elapsed = now - scan.started;
    if (elapsed < PREPARE_MS) return { ...idle, scanning: true, phase: 'preparing', current: 0 };
    const current = Math.min(total, Math.floor(((elapsed - PREPARE_MS) / (SCAN_DONE_MS - PREPARE_MS)) * total));
    return { ...idle, scanning: true, phase: 'scanning', current, filename: baseName(scan.files[Math.min(current, total - 1)]?.rel || '') };
}

export const scanRunning = (sandbox, now) => scanStatus(sandbox, now).scanning;

// ---------------------------------------------------------------- downloads

function advance(sandbox, job, now) {
    if (!ACTIVE.has(job.state)) return;
    const elapsed = now - job.started;
    if (elapsed >= DOWNLOAD_DONE_MS) return finishDownload(sandbox, job);
    if (elapsed < QUEUED_MS) return;
    job.state = elapsed < RECEIVED_MS ? 'running' : 'verifying';
    job.received = Math.min(job.total, Math.round(((elapsed - QUEUED_MS) / (RECEIVED_MS - QUEUED_MS)) * job.total));
}

function finishDownload(sandbox, job) {
    Object.assign(job, { state: 'done', received: job.total, verified: Boolean(job.sha256) });
    const template = job.sha256 === SANDBOX_HASHES.miko ? DOWNLOADED_LORA
        : { size: job.total, meta: { name: '', version_name: '', baseModel: '', hash: job.sha256, trainedWords: [], description: '' } };
    sandbox.models.push(model({ ...template, type: job.type, size: job.total || template.size }, job.rel));
}

const publicJob = job => ({
    id: job.id, key: job.key, state: job.state, error: job.error, received: job.received, total: job.total, rel: job.rel,
    type: job.type, root: job.root, value: job.value, file: baseName(job.rel), source: job.source, verified: job.verified, host: 'civitai.com',
});

function startDownload(sandbox, body, now) {
    const rel = slashes(body?.rel).split('/').filter(Boolean).join('/');
    const type = String(body?.type || '');
    if (!SANDBOX_TYPES.includes(type)) return reply({ error: 'bad_type' }, 400);
    if (!MODEL_FILE.test(rel)) return reply({ error: 'bad_name' }, 400);
    if (sandbox.models.some(item => item.type === type && item.rel.toLowerCase() === rel.toLowerCase())) return reply({ error: 'exists' }, 409);
    if ([...sandbox.jobs.values()].some(job => ACTIVE.has(job.state) && job.type === type && job.rel === rel)) return reply({ error: 'already' }, 409);
    sandbox.runs += 1;
    const job = {
        id: `sandbox${sandbox.runs}`, key: String(body.key || ''), value: String(body.value || ''), type, root: 0, rel,
        total: Number(body.size) || 0, sha256: String(body.sha256 || '').toLowerCase(), source: String(body.source || ''),
        state: 'queued', error: '', received: 0, verified: false, started: now,
    };
    sandbox.jobs.set(job.id, job);
    return reply(publicJob(job));
}

function cancelDownload(sandbox, body) {
    const job = sandbox.jobs.get(String(body?.id || ''));
    if (!job) return reply({ error: 'unknown' }, 404);
    if (ACTIVE.has(job.state)) Object.assign(job, { state: 'cancelled', error: 'cancelled' });
    return reply(publicJob(job));
}

export const downloadsRunning = (sandbox, now) => {
    settle(sandbox, now);
    return [...sandbox.jobs.values()].some(job => ACTIVE.has(job.state));
};

function lookup(sandbox, body) {
    if (!Array.isArray(body?.items)) return reply({ error: 'items must be a list' }, 400);
    const roots = {};
    const results = body.items.slice(0, 100).map((item) => {
        const type = (Array.isArray(item?.types) ? item.types : []).find(candidate => SANDBOX_TYPES.includes(candidate)) || '';
        if (type && !roots[type]) {
            const subfolders = [...new Set(ofType(sandbox, type).map(found => folderOf(found.rel)).filter(Boolean))].sort();
            roots[type] = [{ index: 0, path: `models/${type}`, exists: true, free: FREE_BYTES, subfolders }];
        }
        return { ...(item?.known ? { found: false, reason: 'known' } : sourceFor(item || {})), key: item?.key, type };
    });
    return reply({ results, roots, settings: { ...sandbox.downloadSettings }, manager_list: true });
}

/** Whether each saved model is here by its exact name (what the server checks, without hashing). */
function identities(sandbox, body) {
    const results = (Array.isArray(body?.references) ? body.references.slice(0, 128) : []).map((reference) => {
        const found = typeof reference?.saved_value === 'string' && findByPath(sandbox, reference.saved_value, null, true);
        const result = { node_id: reference?.node_id, widget_index: reference?.widget_index, saved_value: reference?.saved_value, availability: found ? 'available' : 'missing' };
        if (found) {
            result.local_path = `models/${found.type}/${found.rel}`;
            result.identity = { status: 'verified', sha256: found.meta.hash, provenance: 'local metadata', size: found.size };
        }
        return result;
    });
    return reply({ status: 'success', results });
}

// ---------------------------------------------------------------- routes

const EMPTY = {
    '/anomalous/gallery_images': { images: [], total: 0, page: 1, pages: 0, has_videos: false },
    '/anomalous/kept_images': { status: 'success', images: [] },
    '/anomalous/saves': { groups: [] },
    '/anomalous/saves/group': { group: null },
    '/anomalous/notebooks': { notebooks: [] },
    '/anomalous/notebooks/by_node_type': { combos: [] },
    '/anomalous/parameters': { notebooks: [] },
    '/anomalous/parameters/by_node_type': { groups: [] },
    '/anomalous/parameters/signatures': { sets: {} },
    '/anomalous/materials': { status: 'success', materials: [], total: 0, page: 1, pages: 1, tags: [] },
    '/anomalous/materials/by_node_type': { status: 'success', materials: [] },
    '/anomalous/activity': { entries: [] },
    '/anomalous/ai_tasks': { tasks: [] },
    '/anomalous/ai_callers': { last: null },
    '/anomalous/rail_hints': { combos: false, prompts: false, ai: false, saves: false, assistant: false, scan: false },
    '/anomalous/lora_info': { text_encoder: true },
    '/anomalous/model_covers': { custom: false, civitai: '' },
    '/anomalous/recipe_history': { status: 'success', versions: [] },
    '/anomalous/recipe_gallery': { status: 'success', fingerprint: '', match_mode: 'node-types', images: [], scanned: 0 },
    '/anomalous/recipe_parameter_gallery': { status: 'success', fingerprint: '', match_mode: 'parameters', images: [], scanned: 0 },
};

// Reads the sandbox leaves to the server: nothing in them is the user's library, and none of them changes anything.
const PASS = new Set([
    'version', 'version/releases', 'tts_version', 'tts_version/releases', 'base_models', 'all_folder_types', 'example_workflows',
    'ai_routes', 'ai_starters', 'ai_gates', 'ai_blocks', 'ai_tool_sets', 'ai_toolbox', 'ai_toolbox/favorites', 'ai_darkroom',
    'access', 'card_cache',
].map(route => `/anomalous/${route}`));

const GET = {
    '/anomalous/folders': sandbox => folders(sandbox),
    '/anomalous/type_models': (sandbox, query) => {
        const models = ofType(sandbox, query.get('type'), Number(query.get('path_idx') || 0)).map(entry);
        return { models, total: models.length };
    },
    '/anomalous/models': inFolder,
    '/anomalous/all_scan_models': sandbox => ({ models: sandbox.models.map(entry), total: sandbox.models.length, page: 1, limit: 0 }),
    '/anomalous/quick_index': sandbox => ({
        models: sandbox.models.map(item => ({
            type: item.type, path_idx: item.path_idx, subfolder: folderOf(item.rel), filename: baseName(item.rel), name: named(item),
            civitai_name: item.known ? item.meta.name : '', base: item.known ? item.meta.baseModel : '', base_guess: '', page: 0, version: 0,
            version_name: item.known ? item.meta.version_name : '', words: item.known ? [...item.meta.trainedWords] : [], preview_url: item.cover, ai_name: '',
        })),
    }),
    '/anomalous/scan_pickable': sandbox => ({
        models: sandbox.models.map(item => ({ ...place(item), size: item.size, preview_url: item.cover, metadata: metadata(item) })),
        total: sandbox.models.length, roots: SANDBOX_TYPES.map(type => ({ type, path_idx: 0, name: type, parent: 'models' })),
    }),
    '/anomalous/scan_model': (sandbox, query) => {
        const found = ofType(sandbox, query.get('type'), Number(query.get('path_idx') || 0)).find(item => item.rel === slashes(query.get('rel')));
        return found ? { model: entry(found) } : reply({ status: 'error', message: 'Model not found' }, 404);
    },
    '/anomalous/find_model': (sandbox, query) => {
        const found = findByPath(sandbox, query.get('search') || '');
        return found ? { status: 'success', model: located(found) } : { status: 'error', message: 'Model not found' };
    },
    '/anomalous/compatible_models': (sandbox, query) => {
        const types = String(query.get('target_type') || '').split(',');
        const base = query.get('base_model') || '';
        return { models: sandbox.models.filter(item => types.includes(item.type) && item.known && item.meta.baseModel === base).map(entry) };
    },
    '/anomalous/scan_summary': summary,
    '/anomalous/scan_matched': (sandbox) => {
        const models = sandbox.models.filter(item => item.scanned === 'online')
            .map(item => ({ ...place(item), state: 'matched', name: named(item), base: item.meta.baseModel }));
        return { models, total: models.length };
    },
    '/anomalous/last_scan': sandbox => sandbox.lastScan,
    '/anomalous/global_scan_status': (sandbox, query, now) => scanStatus(sandbox, now),
    '/anomalous/scan_status': (sandbox, query, now) => scanStatus(sandbox, now),
    '/anomalous/all_hashes': sandbox => ({ hashes: hashIndex(sandbox) }),
    '/anomalous/resolve_hash': (sandbox, query) => resolveOne(sandbox, Object.fromEntries(query)),
    '/anomalous/placement/check': sandbox => ({ misplaced: [], duplicates: [], shared: [], unchecked: { groups: 0, bytes: 0 }, loose: [], checked: sandbox.models.length }),
    '/anomalous/config': sandbox => ({
        has_api_key: sandbox.hasKey, has_deepl_key: false, proxy: '', sidecar_layout: 'hidden',
        folder_types_config: SANDBOX_TYPES.map(type => ({ type, visible: true })),
    }),
    '/anomalous/civitai_check': sandbox => (sandbox.network === 'online'
        ? { reachable: true, key: sandbox.hasKey ? 'set' : 'none', ms: 180, error: '', failure: '', proxy: '', host: 'civitai.com' }
        : { reachable: false, key: sandbox.hasKey ? 'set' : 'none', ms: 8000, error: 'Simulated timeout', failure: 'timeout', proxy: '', host: '' }),
    '/anomalous/recipes': sandbox => ({ recipes: sandbox.shared ? [{ filename: RECIPE_FILE, data: sharedRecipe(sandbox.shared, false) }] : [] }),
    '/anomalous/recipe_full': (sandbox, query) => (sandbox.shared && query.get('filename') === RECIPE_FILE
        ? { status: 'success', data: sharedRecipe(sandbox.shared, true) }
        : reply({ status: 'error', message: 'File not found' }, 404)),
    '/anomalous/download/settings': sandbox => ({ ...sandbox.downloadSettings }),
    '/anomalous/download/status': sandbox => ({ jobs: [...sandbox.jobs.values()].map(publicJob) }),
};

const POST = {
    '/anomalous/scan_all': (sandbox, body, query, now) => startScan(sandbox, { kind: body?.targets?.length ? 'picked' : 'all', offline: body?.offline_only, targets: body?.targets, now }),
    '/anomalous/scan': (sandbox, body, query, now) => startScan(sandbox, {
        kind: 'one', offline: body?.offline_only, now,
        targets: [{ type: query.get('type'), path_idx: query.get('path_idx'), subfolder: query.get('subfolder'), files: body?.target_files || [] }],
    }),
    '/anomalous/save_config': (sandbox, body) => {
        if (typeof body?.api_key === 'string') sandbox.hasKey = Boolean(body.api_key.trim());
        return reply({ status: 'ok' });
    },
    '/anomalous/update_metadata': updateMetadata,
    '/anomalous/resolve_hash_batch': (sandbox, body) => (Array.isArray(body?.items)
        ? reply({ results: body.items.slice(0, 256).map((item, index) => ({ key: String(item?.key ?? index), result: resolveOne(sandbox, item || {}) })) })
        : reply({ error: 'Invalid JSON body' }, 400)),
    '/anomalous/resolve_paths_to_previews': (sandbox, body) => reply(resolvePaths(sandbox, body)),
    '/anomalous/refresh_recipe_identity': identities,
    '/anomalous/download/lookup': lookup,
    '/anomalous/download/start': (sandbox, body, query, now) => startDownload(sandbox, body, now),
    '/anomalous/download/cancel': cancelDownload,
    '/anomalous/download/settings': (sandbox, body) => {
        for (const key of ['place', 'folder', 'hf_mirror']) if (body && key in body) sandbox.downloadSettings[key] = body[key];
        return reply({ ...sandbox.downloadSettings });
    },
    // Asked on their own by other pages; they only clear the server's file lists or note what was opened.
    '/anomalous/clear_cache': () => reply({ status: 'ok' }),
    '/anomalous/usage/opened': () => reply({ status: 'ok' }),
};

/**
 * What the sandbox does with one request to the server, `path` under /anomalous/: { status, body } answered from
 * memory, { pass: true } to send it on (a read with nothing of the user's), or { blocked: true } (a change the
 * sandbox does not stand in for: never sent). `fallback` marks a read it knows nothing about, answered empty.
 */
export function answerRequest(sandbox, { method = 'GET', path, query = new URLSearchParams(), body = null, now = Date.now() }) {
    settle(sandbox, now);
    const verb = String(method).toUpperCase();
    if (verb === 'GET' || verb === 'HEAD') {
        if (Object.hasOwn(GET, path)) {
            const answer = GET[path](sandbox, query, now);
            return answer[REPLY] ? answer : reply(answer);
        }
        if (Object.hasOwn(EMPTY, path)) return reply(copy(EMPTY[path]));
        if (PASS.has(path)) return { pass: true };
        return { ...reply({}), fallback: true };
    }
    if (verb === 'POST' && Object.hasOwn(POST, path)) return POST[path](sandbox, body, query, now);
    return { blocked: true };
}
