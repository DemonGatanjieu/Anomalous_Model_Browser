/**
 * The rules of the reference audio editor (ui_audio_tts_editor.js), without DOM: a character's
 * voices (the main voice and each emotion), each with one main reference (its tone and way of
 * speaking) and auxiliary references (Anomalous_TTS interface 18: their timbre is averaged in,
 * SoVITS v1 / v2 / v2Pro only), the reference lines fixed here, and how all of it goes back into
 * the character's anomalous_tts.json, keeping every field the editor does not know.
 *
 * A voice: `{ key, name, main, aux, kept, filename, touched }`. `name` is 'main' for the main
 * voice; `main` the clip (null on the main voice: the node picks one itself); `kept` the rest
 * of its settings entry; `filename` an emotion found from a file name (`X.开心.wav`), written
 * into the settings only once it is changed (`touched`).
 */

export const AUX_FORMAT = 18;
export const AUX_VERSIONS = new Set(['v1', 'v2', 'v2Pro', 'v2ProPlus']);
export const REF_MIN_SEC = 3;
export const REF_MAX_SEC = 10;
export const LINE_LIMIT = 500;
export const MAIN = 'main';
const FORBIDDEN_IN_NAME = /[{}[\]]/;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function own(spec) {
    const { audio, aux, ...rest } = isObject(spec) ? spec : {};
    return rest;
}

function auxList(spec) {
    return Array.isArray(spec?.aux) ? [...new Set(spec.aux.filter(path => typeof path === 'string' && path))] : [];
}

/**
 * The voices and the fixed lines from the saved settings and the node's view of them (`detail`:
 * the character's `reference` and `emotions` as resolved). `lineFixes` (interface 18): a line a
 * voice kept in its own `text` becomes that clip's fixed line, so every clip has one line,
 * unless it is the line the clip's files give anyway (`found`).
 */
export function readVoices(settings, detail, { lineFixes = false, found = new Map() } = {}) {
    const fixes = new Map();
    if (lineFixes && isObject(settings?.lines)) {
        for (const [path, text] of Object.entries(settings.lines)) if (typeof text === 'string' && text.trim()) fixes.set(path, text);
    }
    const voice = (key, name, spec, extra = {}) => {
        const kept = own(spec);
        const main = typeof spec?.audio === 'string' && spec.audio ? spec.audio : null;
        if (lineFixes && typeof kept.text === 'string') {
            const text = kept.text.trim();
            if (text && main && !fixes.has(main) && found.get(main)?.trim() !== text) fixes.set(main, text);
            delete kept.text;
        }
        return { key, name, main, aux: auxList(spec).filter(path => path !== main), kept, filename: false, touched: false, ...extra };
    };
    const voices = [voice('main', MAIN, settings?.reference)];
    const saved = isObject(settings?.emotions) ? settings.emotions : {};
    for (const [name, spec] of Object.entries(saved)) {
        if (name.trim() && name.trim() !== MAIN) voices.push(voice(`e:${name}`, name, spec));
    }
    const named = isObject(detail?.emotions) ? detail.emotions : {};
    for (const name of Object.keys(named).sort()) {
        const ref = named[name];
        if (ref?.source !== 'filename' || voices.some(item => item.name === name)) continue;
        voices.push(voice(`e:${name}`, name, { audio: ref.audio }, { filename: true }));
    }
    return { voices, fixes };
}

/** What `audio` is to `voice`: 'main', 'aux' or null. */
export function roleOf(voice, audio) {
    if (!voice) return null;
    if (voice.main === audio) return 'main';
    return voice.aux.includes(audio) ? 'aux' : null;
}

/** `audio` becomes the voice's main reference (and no longer one of its auxiliary ones). */
export function setMain(voice, audio) {
    voice.main = audio;
    voice.aux = voice.aux.filter(path => path !== audio);
    voice.touched = true;
}

/** The main voice back to the node's own pick. */
export function clearMain(voice) {
    if (voice.name !== MAIN) return;
    voice.main = null;
    voice.touched = true;
}

export function toggleAux(voice, audio) {
    if (voice.main === audio) return;
    voice.aux = voice.aux.includes(audio) ? voice.aux.filter(path => path !== audio) : [...voice.aux, audio];
    voice.touched = true;
}

/** Where else `audio` is used: `[{ name, role }]` for the voices other than `except`. */
export function usesOf(voices, audio, except = null) {
    const out = [];
    for (const voice of voices) {
        if (voice === except) continue;
        const role = roleOf(voice, audio);
        if (role) out.push({ name: voice.name, role });
    }
    return out;
}

/** A clip fits as a main reference unless its known length is outside 3~10 s. */
export function fitsMain(seconds) {
    return !(seconds > 0) || (seconds >= REF_MIN_SEC && seconds <= REF_MAX_SEC);
}

/** An emotion name that can be used: '' or the locale key of what is wrong with it. */
export function nameProblem(name, voices, self = null) {
    const clean = String(name || '').trim();
    if (!clean) return 'ttsRefsNameMissing';
    if (clean === MAIN || FORBIDDEN_IN_NAME.test(clean)) return 'ttsEditorNameInvalid';
    if (voices.some(voice => voice !== self && voice.name === clean)) return 'ttsEditorNameDuplicate';
    return '';
}

/** The first thing that keeps the voices from being saved, as `{ key, values }`, or null. */
export function voicesProblem(voices, audioList) {
    const files = new Set(audioList);
    const seen = new Set();
    for (const voice of voices) {
        if (voice.name !== MAIN) {
            if (seen.has(voice.name)) return { key: 'ttsEditorNameDuplicate', values: { name: voice.name } };
            seen.add(voice.name);
            if (!voice.main) return { key: 'ttsRefsNoMain', values: { name: voice.name } };
        }
        for (const path of [voice.main, ...voice.aux]) {
            if (path && !files.has(path)) return { key: 'ttsEditorUnknownAudio', values: { file: path } };
        }
    }
    return null;
}

/**
 * The settings to save: the previous ones with the voices and the fixed lines written in.
 * `aux` / `lines`: the node reads them (interface 18); without, they are left as they were.
 */
export function writeSettings(previous, voices, fixes, { aux = false, lines = false } = {}) {
    const next = { ...(isObject(previous) ? previous : {}), format: 1 };
    const entry = (voice) => {
        const out = { ...voice.kept };
        if (voice.main) out.audio = voice.main;
        if (aux && voice.aux.length) out.aux = [...voice.aux];
        return out;
    };
    const main = voices.find(voice => voice.name === MAIN);
    const reference = main ? entry(main) : {};
    if (!aux && Array.isArray(previous?.reference?.aux)) reference.aux = previous.reference.aux;
    if (Object.keys(reference).length) next.reference = reference; else delete next.reference;

    const emotions = {};
    const before = isObject(previous?.emotions) ? previous.emotions : {};
    for (const voice of voices) {
        if (voice.name === MAIN || !voice.main || (voice.filename && !voice.touched)) continue;
        emotions[voice.name] = entry(voice);
        if (!aux && Array.isArray(before[voice.name]?.aux)) emotions[voice.name].aux = before[voice.name].aux;
    }
    if (Object.keys(emotions).length) next.emotions = emotions; else delete next.emotions;

    if (lines) {
        const table = {};
        for (const [path, text] of fixes) if (text.trim()) table[path] = text.trim().slice(0, LINE_LIMIT);
        if (Object.keys(table).length) next.lines = table; else delete next.lines;
    }
    return next;
}

/**
 * The clips the list shows, best first for the voice picked: its main reference, its
 * auxiliary ones, then the others in folder order. `filter`: 'all' | 'here' (this voice) |
 * 'used' (any voice) | 'noline'; `query` matches the path or the line.
 */
export function listClips(audioList, { voice, voices, lineOf, filter = 'all', query = '' }) {
    const words = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = path => words.every(word => path.toLowerCase().includes(word) || lineOf(path).toLowerCase().includes(word));
    const keep = {
        all: () => true,
        here: path => Boolean(roleOf(voice, path)),
        used: path => voices.some(item => roleOf(item, path)),
        noline: path => !lineOf(path),
    }[filter] || (() => true);
    const rank = (path) => {
        const role = roleOf(voice, path);
        return role === 'main' ? 0 : role === 'aux' ? 1 : 2;
    };
    return audioList.filter(path => keep(path) && matches(path))
        .map((path, at) => ({ path, at, rank: rank(path) }))
        .sort((a, b) => a.rank - b.rank || a.at - b.at)
        .map(item => item.path);
}

/** "1 main, 2 aux" for a voice tab, as `{ key, values }`. */
export function voiceCount(voice) {
    if (!voice.main) return { key: voice.aux.length ? 'ttsRefsCountAutoAux' : 'ttsRefsCountAuto', values: { aux: voice.aux.length } };
    return { key: voice.aux.length ? 'ttsRefsCountAux' : 'ttsRefsCountMain', values: { aux: voice.aux.length } };
}
