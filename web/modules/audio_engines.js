import { AUDIO_NODE_TARGETS } from './audio_node_targets.js';

/**
 * Speech engines the audio studio can manage. Anomalous never bundles an engine:
 * each one is a separate ComfyUI node pack, detected at runtime. A missing engine
 * only changes what the audio page shows; nothing else depends on it.
 *
 * Every engine's voices are normalised into the same "voice group" shape so the
 * studio cards, sidebar and Script Director share one implementation:
 *   { engine, group, character, folder, has_main, node_value, total_slices,
 *     slices: [{ engine, emotion, is_main, text, audio_url, syntax_tag, tag_usable, relative_path? }] }
 * `node_value` is what goes into the node's voice widget (F5-TTS: the main voice
 * file; GPT-SoVITS: the character name).
 */
export const AUDIO_ENGINES = Object.freeze([
    Object.freeze({
        id: 'f5',
        label: 'F5-TTS',
        pack: 'ComfyUI-F5-TTS',
        probeNode: 'F5TTSAudio',
        repoUrl: 'https://github.com/niknah/ComfyUI-F5-TTS',
        managerSearch: 'F5-TTS',
        descKey: 'audioEngineF5Desc',
    }),
    Object.freeze({
        id: 'gpt_sovits',
        label: 'GPT-SoVITS',
        pack: 'Anomalous_TTS',
        probeNode: 'AnomalousTTS_CharacterSpeech',
        // Not published yet: the install card explains instead of linking.
        repoUrl: '',
        managerSearch: 'Anomalous TTS',
        descKey: 'audioEngineGptSovitsDesc',
    }),
]);

const STORAGE_KEY = 'anomalous_audio_engine';

export function engineById(id) {
    return AUDIO_ENGINES.find(engine => engine.id === id) || null;
}

/** Node labels an engine writes into, for "works with …" lines. */
export function engineTargetLabels(id) {
    return AUDIO_NODE_TARGETS.filter(target => target.engine === id && target.takes === 'character')
        .flatMap(target => target.typeLabels || target.types);
}

export function getStoredEngine() {
    try { return localStorage.getItem(STORAGE_KEY) || null; } catch (_) { return null; }
}

export function setStoredEngine(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch (_) { /* session-only choice */ }
}

/** Stored choice if it exists, else the first installed engine, else the first engine. */
export function pickEngine(statuses, stored = getStoredEngine()) {
    if (stored && engineById(stored)) return stored;
    return AUDIO_ENGINES.find(engine => statuses?.[engine.id]?.installed)?.id || AUDIO_ENGINES[0].id;
}

// ---------- normalisation ----------

function f5Groups(characters) {
    return (characters || []).map(group => ({
        ...group,
        engine: 'f5',
        node_value: group.main_relative_path || null,
        slices: (group.slices || []).map(slice => ({ ...slice, engine: 'f5' })),
    }));
}

export function ttsAudioUrl(name, path) {
    return `/anomalous_tts/audio?character=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}`;
}

function ttsSlice(name, emotion, ref, isMain) {
    return {
        engine: 'gpt_sovits',
        id: `${name}:${emotion}`,
        character: name,
        emotion,
        is_main: isMain,
        filename: String(ref.audio || '').split('/').pop(),
        relative_path: ref.audio || '',
        text: ref.text || '',
        synthesis_text: ref.text || '',
        language: ref.language || '',
        source: ref.source || '',
        syntax_tag: `{${emotion}}`,
        tag_usable: true,
        audio_url: ref.audio ? ttsAudioUrl(name, ref.audio) : '',
    };
}

/** Anomalous_TTS `GET /anomalous_tts/characters` → voice groups (docs: claude/anomalous-tts-interface.md). */
export function gptSovitsGroups(payload) {
    return (payload?.characters || []).filter(item => item && typeof item.name === 'string').map(item => {
        const name = item.name;
        const slices = [];
        if (item.reference?.audio) slices.push(ttsSlice(name, 'main', item.reference, true));
        for (const [emotion, ref] of Object.entries(item.emotions || {})) {
            if (emotion !== 'main' && ref?.audio) slices.push(ttsSlice(name, emotion, ref, false));
        }
        return {
            engine: 'gpt_sovits',
            group: `gpt_sovits:${name}`,
            character: name,
            folder: 'GPT-SoVITS',
            language: item.language || '',
            aliases: Array.isArray(item.aliases) ? item.aliases : [],
            error: item.error || item.settings_error || '',
            has_main: Boolean(item.reference?.audio) && !item.error,
            node_value: name,
            total_slices: slices.length,
            slices,
            raw: item,
        };
    }).sort((a, b) => (b.has_main - a.has_main) || a.character.localeCompare(b.character));
}

// ---------- detection + loading ----------
//
// Switching to the audio domain, clicking a sidebar entry or saving a setting all
// re-render the studio and the sidebar. They must not hit the server each time:
// `/object_info/<class>` makes ComfyUI rebuild that node's inputs (a folder scan),
// and a character list can be large. So both results are kept until something
// says they are stale: the Refresh button, a save, an added voice, or MAX_AGE_MS.

const MAX_AGE_MS = 60_000;
let installCache = null; // { at, promise } — node pack presence, per page session
const loadCache = new Map(); // engineId -> { at, promise }
let rescanNext = false;

async function getJson(url, signal) {
    const resp = await fetch(url, { signal });
    const data = await resp.json().catch(() => null);
    return { ok: resp.ok, status: resp.status, data };
}

/** Installed = ComfyUI knows the engine's node class (`/object_info/<class>` is `{}` otherwise). */
async function isNodeInstalled(nodeClass) {
    try {
        const { ok, data } = await getJson(`/object_info/${encodeURIComponent(nodeClass)}`);
        return ok && Boolean(data && data[nodeClass]);
    } catch (_) {
        return false;
    }
}

function fresh(entry) {
    return entry && Date.now() - entry.at < MAX_AGE_MS;
}

async function loadGroups(engineId) {
    if (engineId === 'f5') {
        const { ok, status, data } = await getJson('/anomalous/audio_voices');
        if (!ok || !data?.success) throw new Error(data?.error || `HTTP ${status}`);
        return f5Groups(data.characters);
    }
    // The node caches its folder scan; `refresh=1` makes it look at the disk again.
    const url = rescanNext ? '/anomalous_tts/characters?refresh=1' : '/anomalous_tts/characters';
    rescanNext = false;
    const { ok, status, data } = await getJson(url);
    if (!ok || !data) throw new Error(`HTTP ${status}`);
    return gptSovitsGroups(data);
}

/**
 * Forget cached engine data. `rescan: true` (the Refresh button) also asks the
 * GPT-SoVITS node to re-read its folders instead of answering from its own cache.
 */
export function invalidateEngineCache({ rescan = false } = {}) {
    loadCache.clear();
    installCache = null;
    statusCache = null;
    if (rescan) rescanNext = true;
}

let statusCache = null; // { at, promise } — GPT-SoVITS setup status

/**
 * The GPT-SoVITS node's setup status (libraries, pretrained files, packages; interface v3),
 * or null for a node that predates it (no `/anomalous_tts/status`). Cached like loadEngine;
 * `force` skips the cache (download progress polling).
 */
export function loadGptSovitsStatus({ force = false } = {}) {
    if (!force && fresh(statusCache)) return statusCache.promise;
    const promise = getJson('/anomalous_tts/status').then(({ ok, status, data }) => {
        if (status === 404) return null;
        if (!ok || !data) throw new Error(`HTTP ${status}`);
        return data;
    });
    statusCache = { at: Date.now(), promise };
    promise.catch(() => { if (statusCache?.promise === promise) statusCache = null; });
    return promise;
}

/**
 * { installed, groups, error } for one engine. The F5-TTS library is the plugin's own
 * input/F5-TTS folder, so it is listed even when the F5-TTS node is not installed.
 * Concurrent callers (studio + sidebar) share one request.
 */
export function loadEngine(engineId) {
    const hit = loadCache.get(engineId);
    if (fresh(hit)) return hit.promise;
    const promise = loadEngineNow(engineId);
    loadCache.set(engineId, { at: Date.now(), promise });
    // A failure must not stick for a minute.
    promise.then(result => { if (result.error && loadCache.get(engineId)?.promise === promise) loadCache.delete(engineId); });
    return promise;
}

async function loadEngineNow(engineId) {
    const engine = engineById(engineId);
    if (!engine) return { installed: false, groups: [], error: 'unknown engine' };
    const installed = Boolean((await detectEngines())[engineId]?.installed);
    if (!installed && engineId !== 'f5') return { installed, groups: [], error: '' };
    try {
        return { installed, groups: await loadGroups(engineId), error: '' };
    } catch (e) {
        return { installed, groups: [], error: e.message || String(e) };
    }
}

/** Status of every engine (installed only), for the switcher badges. Cached like loadEngine. */
export function detectEngines() {
    if (fresh(installCache)) return installCache.promise;
    const promise = Promise.all(AUDIO_ENGINES.map(async engine => [engine.id, { installed: await isNodeInstalled(engine.probeNode) }]))
        .then(Object.fromEntries);
    installCache = { at: Date.now(), promise };
    return promise;
}

/**
 * One GPT-SoVITS character with its file lists (`gpt`, `sovits`, `audio`), which the
 * summary list leaves out because a folder can hold thousands of clips.
 */
export async function fetchGptSovitsCharacter(name, signal) {
    const { ok, status, data } = await getJson(`/anomalous_tts/characters?name=${encodeURIComponent(name)}`, signal);
    if (!ok || !data?.character) throw new Error(status === 404 ? `404 ${name}` : `HTTP ${status}`);
    return data.character;
}

// ---------- GPT-SoVITS settings (Anomalous writes, the node reads) ----------

/**
 * Replace a character's anomalous_tts.json through the node's API. `settings` must be the
 * full object (unknown fields preserved by the caller). Returns the refreshed group.
 */
export async function saveGptSovitsSettings(name, settings) {
    const resp = await fetch('/anomalous_tts/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character: name, settings }),
    });
    if (!resp.ok) {
        const message = await resp.text().catch(() => '');
        throw new Error(message || `HTTP ${resp.status}`);
    }
    const data = await resp.json().catch(() => ({}));
    invalidateEngineCache();
    return data.character ? gptSovitsGroups({ characters: [data.character] })[0] : null;
}

/**
 * Build the new settings for an emotion editor result without dropping fields
 * Anomalous does not know. `main` = { audio, text } | null; `emotions` = [{ name, audio, text }].
 */
export function mergeGptSovitsSettings(previous, { main, emotions }) {
    const next = { ...(previous || {}), format: 1 };
    if (main?.audio) {
        const kept = previous?.reference && typeof previous.reference === 'object' ? previous.reference : {};
        next.reference = { ...kept, audio: main.audio };
        if (main.text) next.reference.text = main.text; else delete next.reference.text;
    } else {
        delete next.reference;
    }
    const oldEmotions = previous?.emotions && typeof previous.emotions === 'object' ? previous.emotions : {};
    const out = {};
    for (const row of emotions || []) {
        const name = String(row?.name || '').trim();
        if (!name || name === 'main' || !row.audio) continue;
        const kept = oldEmotions[name] && typeof oldEmotions[name] === 'object' ? oldEmotions[name] : {};
        out[name] = { ...kept, audio: row.audio };
        if (row.text) out[name].text = row.text; else delete out[name].text;
    }
    if (Object.keys(out).length) next.emotions = out; else delete next.emotions;
    return next;
}
