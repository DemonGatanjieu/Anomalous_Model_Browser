/**
 * Anomalous_TTS generation presets (its interface 16, docs/INTERFACE.md §5.4): the presets
 * file (default preset, rules per pair of languages, the three presets' numbers) and a
 * character's own settings (`defaults.preset`, `defaults.by_language`). Calls and pure
 * helpers only; ui_tts_presets.js and ui_tts_tuning.js draw them.
 */

export const PRESETS_FORMAT = 16; // the node interface with presets
export const PRESET_NAMES = ['stable', 'standard', 'lively'];
export const SAMPLING = ['top_k', 'top_p', 'temperature', 'repetition_penalty'];
export const LANGS = ['ja', 'zh', 'en'];
export const CROSS = 'cross';

async function readJson(resp) {
    if (!resp.ok) {
        const message = await resp.text().catch(() => '');
        throw new Error(message || `HTTP ${resp.status}`);
    }
    return resp.json();
}

/** `{default, presets, builtin, languages, cross, file}`. */
export async function loadPresets() {
    return readJson(await fetch('/anomalous_tts/presets'));
}

export async function savePresets(data) {
    return readJson(await fetch('/anomalous_tts/presets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presets: data }),
    }));
}

/** Rows for the language table: every "reference>spoken" pair the characters can meet, sorted. */
export function languagePairs(groups, rules = {}) {
    const refs = new Set((groups || []).map(group => group.raw?.reference?.language || group.language).filter(lang => LANGS.includes(lang)));
    const pairs = new Set(Object.keys(rules).filter(pair => pair !== CROSS));
    for (const ref of refs) for (const lang of LANGS) if (lang !== ref) pairs.add(`${ref}>${lang}`);
    const order = pair => pair.split('>').map(code => LANGS.indexOf(code));
    return [...pairs].sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1]);
}

/**
 * The presets file from the dialog's state: only what differs from the built-in values
 * (a preset's changed numbers, the language rules that differ from the "other pairs" one).
 */
export function presetsFile(view, { defaultName, numbers = {}, rules = {}, cross }) {
    const presets = {};
    for (const name of PRESET_NAMES) {
        const changed = {};
        for (const key of SAMPLING) {
            const value = numbers[name]?.[key] ?? view.presets[name][key];
            if (value !== view.builtin[name][key]) changed[key] = value;
        }
        if (Object.keys(changed).length) presets[name] = changed;
    }
    const languages = {};
    for (const [pair, name] of Object.entries(rules)) if (name && name !== cross) languages[pair] = name;
    if (cross !== 'stable') languages[CROSS] = cross;
    const out = { format: 1, default: defaultName };
    if (Object.keys(presets).length) out.presets = presets;
    if (Object.keys(languages).length) out.languages = languages;
    return out;
}

/** The preset a line falls back to without the character's own settings (layers 1 and 3 of §5.4). */
export function generalPreset(view, refLang, lang) {
    if (!refLang || refLang === lang) return view.default;
    return view.languages[`${refLang}>${lang}`] || view.cross;
}

/**
 * A character's own settings as dialog rows: `all` (the `defaults` block) and one per language,
 * each `{preset: '' | name, numbers: {key: value}, speed: number | null}` ('' = follow the general one).
 */
export function tuningRows(settings) {
    const defaults = settings?.defaults && typeof settings.defaults === 'object' ? settings.defaults : {};
    const row = block => ({
        preset: PRESET_NAMES.includes(block?.preset) ? block.preset : '',
        numbers: Object.fromEntries(SAMPLING.filter(key => typeof block?.[key] === 'number').map(key => [key, block[key]])),
        speed: typeof block?.speed === 'number' ? block.speed : null,
    });
    const byLanguage = defaults.by_language && typeof defaults.by_language === 'object' ? defaults.by_language : {};
    return { all: row(defaults), ...Object.fromEntries(LANGS.map(lang => [lang, row(byLanguage[lang])])) };
}

/** The character settings with `rows` written in; every other field (and `defaults.language`) is kept. */
export function mergeTuning(settings, rows) {
    const next = { ...(settings || {}), format: 1 };
    const kept = next.defaults && typeof next.defaults === 'object' ? next.defaults : {};
    const write = (target, row) => {
        delete target.preset;
        delete target.speed;
        for (const key of SAMPLING) delete target[key];
        if (row.preset) target.preset = row.preset;
        for (const [key, value] of Object.entries(row.numbers || {})) target[key] = value;
        if (typeof row.speed === 'number') target.speed = row.speed;
        return target;
    };
    const defaults = write({ ...kept }, rows.all);
    const byLanguage = {};
    for (const lang of LANGS) {
        const block = write({ ...(kept.by_language?.[lang] || {}) }, rows[lang]);
        if (Object.keys(block).length) byLanguage[lang] = block;
    }
    if (Object.keys(byLanguage).length) defaults.by_language = byLanguage; else delete defaults.by_language;
    if (Object.keys(defaults).length) next.defaults = defaults; else delete next.defaults;
    return next;
}
