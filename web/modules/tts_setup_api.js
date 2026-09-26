import { invalidateEngineCache } from './audio_engines.js';

/**
 * GPT-SoVITS setup and import through the Anomalous_TTS node (interface v4, §5.2–5.3).
 * The node owns every file: the storage place, pretrained files and imported
 * characters. This module only calls its API and holds the pure rules the import
 * form needs; it has no DOM.
 */

export const UPLOAD_CHUNK = 8 * 1024 * 1024; // under ComfyUI's default 100 MB request limit

const IMPORT_KINDS = {
    '.ckpt': 'gpt', '.pth': 'sovits',
    '.wav': 'audio', '.flac': 'audio', '.ogg': 'audio', '.mp3': 'audio',
    '.txt': 'text', '.lab': 'text', '.list': 'text',
};
// GPT-SoVITS annotation line: path|speaker|LANG|text (same rule as the node's characters.read_list).
const LIST_LINE = /^[^|]+\|[^|]*\|([A-Za-z_]+)\|(.+)$/;
const FORBIDDEN_IN_EMOTION = /[{}[\]]/;
// GPT-SoVITS reference clips must be 3–10 s (the node refuses others as a main voice).
export const REF_MIN_SEC = 3;
export const REF_MAX_SEC = 10;
const EPOCH = { gpt: /-e(\d+)/i, sovits: /_e(\d+)(?:_s(\d+))?/i };

/** gpt | sovits | audio | text | null — the node checks again; this only avoids uploading unusable files. */
export function importKind(name) {
    const dot = String(name || '').lastIndexOf('.');
    return dot < 0 ? null : IMPORT_KINDS[String(name).slice(dot).toLowerCase()] || null;
}

async function request(url, { method = 'POST', body, raw, signal, keepalive } = {}) {
    const headers = raw ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : undefined;
    const resp = await fetch(url, {
        method, signal, keepalive, headers,
        body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { /* plain-text error message */ }
    if (!resp.ok) {
        const error = new Error(data?.error || text || `HTTP ${resp.status}`);
        error.status = resp.status;
        error.data = data;
        throw error;
    }
    return data;
}

// ---------- storage place, pretrained files ----------

/** Make `path` the storage place; `move` moves the current characters there (in the background). */
export async function changeStorage(path, move) {
    const status = await request('/anomalous_tts/storage', { body: { path, move } });
    invalidateEngineCache();
    return status;
}

/** Stop reading an earlier storage place; its files stay. */
export async function forgetLibrary(path) {
    const status = await request('/anomalous_tts/libraries', { body: { path, remove: true } });
    invalidateEngineCache();
    return status;
}

/** Use (or stop using) a GPT-SoVITS package as a pretrained source. Returns the new status. */
export async function changePretrainedSource(path, remove = false) {
    const status = await request('/anomalous_tts/pretrained/source', { body: { path, remove } });
    invalidateEngineCache();
    return status;
}

/** Start background downloads; progress shows up in the status. */
export async function startPretrainedDownload(ids) {
    await request('/anomalous_tts/pretrained/download', { body: { ids } });
    invalidateEngineCache();
}

export function browseFolder(path, signal) {
    return request(`/anomalous_tts/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`, { method: 'GET', signal });
}

// ---------- import ----------

/**
 * Upload one browser File in chunks. `onStart(id)` gets the upload id at once so the
 * caller can discard it if the form is closed; a 409 resumes from what the node has.
 */
export async function uploadFile(file, { library, signal, onStart, onProgress } = {}) {
    const { upload } = await request('/anomalous_tts/import/upload', { body: { name: file.name, size: file.size, library }, signal });
    onStart?.(upload);
    let offset = 0;
    while (offset < file.size) {
        try {
            const { received } = await request(`/anomalous_tts/import/upload?upload=${upload}&offset=${offset}`, {
                raw: file.slice(offset, offset + UPLOAD_CHUNK), signal,
            });
            offset = received;
        } catch (e) {
            if (e.status !== 409 || !Number.isInteger(e.data?.received)) throw e;
            offset = e.data.received;
        }
        onProgress?.(offset / file.size);
    }
    return upload;
}

export function inspectImport(files, signal) {
    return request('/anomalous_tts/import/inspect', { body: { files }, signal });
}

/** Not tied to the form's AbortSignal: closing the form must not pretend to cancel a write. */
export async function commitImport(body) {
    const result = await request('/anomalous_tts/import/commit', { body });
    invalidateEngineCache();
    return result.character;
}

/** Fire and forget; `keepalive` lets it finish while the page is closing. */
export function discardUploads(ids) {
    if (!ids.length) return;
    request('/anomalous_tts/import/discard', { body: { uploads: ids }, keepalive: true }).catch(() => {});
}

/**
 * The commit request for the import form. `rows` are in file order:
 * { spec: {upload}|{path}, kind, emotion, text }. `language` '' = let the node decide.
 */
export function buildImportBody({ target = null, library = '', character = '', rows, referenceIndex = null, language = '' }) {
    const settings = {};
    if (language) settings.language = language;
    const main = referenceIndex !== null ? rows[referenceIndex] : null;
    if (main?.kind === 'audio') {
        settings.reference = { file: referenceIndex };
        if (main.text) settings.reference.text = main.text;
        if (language) settings.reference.language = language;
    }
    const emotions = {};
    rows.forEach((row, index) => {
        if (row.kind !== 'audio' || index === referenceIndex || !row.emotion) return;
        emotions[row.emotion] = { file: index };
        if (row.text) emotions[row.emotion].text = row.text;
    });
    if (Object.keys(emotions).length) settings.emotions = emotions;
    const body = { files: rows.map(row => row.spec), settings };
    if (target) body.target = target;
    else Object.assign(body, { library, character });
    return body;
}

/** Training epoch in a weight file name (`X-e15.ckpt`, `X_e16_s224.pth`), or -1. */
export function weightEpoch(name, kind) {
    const m = EPOCH[kind]?.exec(String(name || ''));
    return m ? Number(m[1]) * 1e6 + Number(m[2] || 0) : -1;
}

/**
 * A form holds one GPT and one SoVITS weight. From files added together, keep the
 * latest epoch of each kind. Returns { skip: Set of indexes, kept: [{ kind, name, others }] }.
 */
export function pickWeights(items) {
    const skip = new Set();
    const kept = [];
    for (const kind of ['gpt', 'sovits']) {
        const candidates = items.map((item, index) => ({ ...item, index })).filter(item => item.kind === kind);
        if (candidates.length < 2) continue;
        const best = candidates.reduce((a, b) => (weightEpoch(b.name, kind) > weightEpoch(a.name, kind) ? b : a));
        candidates.forEach(item => { if (item !== best) skip.add(item.index); });
        kept.push({ kind, name: best.name, others: candidates.length - 1 });
    }
    return { skip, kept };
}

/** Does a new character name clash with existing ones? exact | variant (`name/…` versions) | null. */
export function nameConflict(name, existing) {
    const wanted = String(name || '').trim();
    if (!wanted) return null;
    if (existing.includes(wanted)) return { kind: 'exact', name: wanted };
    const variants = existing.filter(other => other.startsWith(`${wanted}/`));
    return variants.length ? { kind: 'variant', name: wanted, variants } : null;
}

export function usableAsReference(seconds) {
    return seconds === undefined || (seconds >= REF_MIN_SEC && seconds <= REF_MAX_SEC);
}

/**
 * First reason the form cannot be sent, as [locale key, params], or null. Rows may
 * carry the node's inspect result (`supported`, `version`) for SoVITS weights.
 */
export function importProblem({ target = null, character = '', rows, uploading = 0, conflict = null }) {
    if (!rows.length) return ['ttsImportNoFiles', {}];
    if (uploading) return ['ttsImportStillUploading', { count: uploading }];
    if (!target) {
        if (!character.trim()) return ['ttsImportNameMissing', {}];
        if (conflict?.kind === 'exact') return ['ttsImportNameTaken', { name: conflict.name }];
        if (conflict?.kind === 'variant') return ['ttsImportNameTakenVariant', { name: conflict.name, variants: conflict.variants.join('、') }];
        if (!rows.some(row => row.kind === 'gpt') || !rows.some(row => row.kind === 'sovits')) return ['ttsImportWeightsMissing', {}];
    }
    const unsupported = rows.find(row => row.kind === 'sovits' && row.supported === false);
    if (unsupported) return ['ttsImportUnsupportedBlock', { file: unsupported.name, version: unsupported.version || '?' }];
    const seen = new Set();
    for (const row of rows) {
        if (row.kind !== 'audio' || !row.emotion) continue;
        if (row.emotion === 'main' || FORBIDDEN_IN_EMOTION.test(row.emotion)) return ['ttsEditorNameInvalid', { name: row.emotion }];
        if (seen.has(row.emotion)) return ['ttsEditorNameDuplicate', { name: row.emotion }];
        seen.add(row.emotion);
    }
    return null;
}

/**
 * The line for `clipName` from a text file dropped on that clip's text box: a GPT-SoVITS
 * annotation file is searched by file name (then without the emotion part, like the node);
 * any other text file is the line itself. null = an annotation file without this clip.
 */
export function textFromFile(content, clipName) {
    const text = String(content || '').trim(); // trim() also drops a BOM
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length || !LIST_LINE.test(lines[0])) return text;
    const table = new Map();
    for (const line of lines) {
        const m = LIST_LINE.exec(line);
        const file = line.split('|', 1)[0].replace(/\\/g, '/').split('/').pop().toLowerCase();
        if (m && !table.has(file)) table.set(file, m[2].trim());
    }
    const name = String(clipName || '').toLowerCase();
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    return table.get(name) ?? table.get(`${stem.split('.')[0]}${ext}`) ?? null;
}

/**
 * Pretrained files worth a reminder dot: missing ones that the characters in the
 * studio will actually load (the shared ones, English for mixed-in words, v2Pro's
 * speaker model, plus their languages; a character with no known language counts
 * as every language). No characters, no reminder: an empty studio is only about
 * importing. `due` is false once every such file was dismissed with "don't remind
 * me"; a newly needed one (say, the first Chinese character) brings the dot back.
 */
export function pretrainedReminder(status, languages, dismissed = []) {
    const langs = new Set(languages || []);
    if (!langs.size) return { items: [], size: 0, due: false };
    const needed = (item) => ['all', 'en', 'v2pro'].includes(item.needed_for) || langs.has(item.needed_for) || langs.has('');
    const items = (status?.pretrained || []).filter(item => (item.state === 'missing' || item.state === 'error') && needed(item));
    const seen = new Set(dismissed);
    return { items, size: items.reduce((sum, item) => sum + (item.size || 0), 0), due: items.some(item => !seen.has(item.id)) };
}

/** Required pretrained files still missing for a character in `language` ('' = not chosen yet). */
export function missingForLanguage(status, language) {
    return (status?.pretrained || []).filter(item => item.required && item.state !== 'ok'
        && (item.needed_for === 'all' || (language && item.needed_for === language)));
}

/** Summary for the setup card: what still needs doing. */
export function setupSummary(status) {
    const characters = (status?.libraries || []).reduce((sum, lib) => sum + (lib.characters || 0), 0);
    const missing = (status?.pretrained || []).filter(item => item.state !== 'ok');
    const packages = Object.values(status?.dependencies || {}).reduce((sum, dep) => sum + (dep.missing?.length || 0), 0);
    const downloading = missing.some(item => item.state === 'queued' || item.state === 'downloading');
    const moving = status?.move?.state === 'moving';
    const requiredMissing = missing.filter(item => item.required).length;
    return { characters, missing: missing.length, requiredMissing, packages, downloading, moving,
        ready: characters > 0 && requiredMissing === 0 && packages === 0 && !moving };
}
