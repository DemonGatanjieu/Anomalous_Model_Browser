import { TTS_NODE_CLASS } from './audio_script.js';

/**
 * The speech engine the audio page manages: GPT-SoVITS through the Anomalous_TTS
 * node pack. Anomalous never bundles it; it is detected at runtime, and a missing
 * pack only changes what the audio page shows.
 *
 * Characters are normalised into "voice groups" that the studio cards, sidebar
 * and Script Director share:
 *   { group, character, language, has_main, node_value, total_slices, raw,
 *     slices: [{ emotion, is_main, text, audio_url, syntax_tag, relative_path }] }
 * `node_value` is what goes into the node's `character` widget.
 */
export const TTS_ENGINE = Object.freeze({
    label: 'GPT-SoVITS',
    pack: 'Anomalous_TTS',
    repoUrl: 'https://github.com/DemonGatanjieu/Anomalous_TTS',
    managerSearch: 'Anomalous TTS',
});

/** The voice group (and audio-page filter value) of a GPT-SoVITS character. */
export function voiceGroupKey(name) {
    return `gpt_sovits:${name}`;
}

// ---------- normalisation ----------

export function ttsAudioUrl(name, path) {
    return `/anomalous_tts/audio?character=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}`;
}

function ttsSlice(name, emotion, ref, isMain) {
    return {
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
        audio_url: ref.audio ? ttsAudioUrl(name, ref.audio) : '',
    };
}

/** Anomalous_TTS `GET /anomalous_tts/characters` → voice groups (docs: the node repo's docs/INTERFACE.md). */
export function gptSovitsGroups(payload) {
    return (payload?.characters || []).filter(item => item && typeof item.name === 'string').map(item => {
        const name = item.name;
        const slices = [];
        if (item.reference?.audio) slices.push(ttsSlice(name, 'main', item.reference, true));
        for (const [emotion, ref] of Object.entries(item.emotions || {})) {
            if (emotion !== 'main' && ref?.audio) slices.push(ttsSlice(name, emotion, ref, false));
        }
        return {
            group: voiceGroupKey(name),
            character: name,
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
let installCache = null; // { at, promise } — node pack presence
let loadCache = null; // { at, promise } — the character list
let rescanNext = false;

async function getJson(url, signal) {
    const resp = await fetch(url, { signal });
    const data = await resp.json().catch(() => null);
    return { ok: resp.ok, status: resp.status, data };
}

/**
 * Each clip's line as the node finds it (a `Map` path -> line; clips without one are left
 * out), or null when the node is older than interface 14 and cannot tell.
 */
export async function fetchReferenceLines(name, signal) {
    const { ok, data } = await getJson(`/anomalous_tts/reference_lines?character=${encodeURIComponent(name)}`, signal);
    return ok && data?.lines && typeof data.lines === 'object' ? new Map(Object.entries(data.lines)) : null;
}

/** Installed = ComfyUI knows the node class (`/object_info/<class>` is `{}` otherwise). */
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

async function loadGroups() {
    // The node caches its folder scan; `refresh=1` makes it look at the disk again.
    const url = rescanNext ? '/anomalous_tts/characters?refresh=1' : '/anomalous_tts/characters';
    rescanNext = false;
    const { ok, status, data } = await getJson(url);
    if (!ok || !data) throw new Error(`HTTP ${status}`);
    return gptSovitsGroups(data);
}

/**
 * Forget cached engine data. `rescan: true` (the Refresh button) also asks the
 * node to re-read its folders instead of answering from its own cache.
 */
export function invalidateEngineCache({ rescan = false } = {}) {
    loadCache = null;
    installCache = null;
    statusCache = null;
    if (rescan) rescanNext = true;
}

let statusCache = null; // { at, promise } — GPT-SoVITS setup status

/**
 * The GPT-SoVITS node's setup status (libraries, pretrained files, packages; interface v3),
 * or null for a node that predates it (no `/anomalous_tts/status`). Cached like loadVoices;
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
 * { installed, groups, error }: the GPT-SoVITS characters, none while the node pack
 * is missing. Concurrent callers (studio + sidebar) share one request.
 */
export function loadVoices() {
    if (fresh(loadCache)) return loadCache.promise;
    const promise = loadVoicesNow();
    loadCache = { at: Date.now(), promise };
    // A failure must not stick for a minute.
    promise.then(result => { if (result.error && loadCache?.promise === promise) loadCache = null; });
    return promise;
}

async function loadVoicesNow() {
    const installed = await isTtsInstalled();
    if (!installed) return { installed, groups: [], error: '' };
    try {
        return { installed, groups: await loadGroups(), error: '' };
    } catch (e) {
        return { installed, groups: [], error: e.message || String(e) };
    }
}

/** Whether ComfyUI has the Anomalous_TTS node. Cached like loadVoices. */
export function isTtsInstalled() {
    if (fresh(installCache)) return installCache.promise;
    const promise = isNodeInstalled(TTS_NODE_CLASS);
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
