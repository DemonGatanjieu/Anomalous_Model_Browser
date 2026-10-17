/**
 * Anomalous_TTS generation presets (its interface 16, docs/INTERFACE.md §5.4): the presets
 * file (default preset, rules per pair of languages, the built-in presets' numbers, presets
 * made here as custom_<id>) and a character's own settings (`defaults.preset`,
 * `defaults.by_language`). Calls and pure helpers only; ui_tts_presets.js,
 * ui_tts_preset_switch.js, ui_tts_tuning.js and ui_script_run.js draw them.
 */

export const PRESETS_FORMAT = 16; // the node interface with presets
export const BUILTIN = ['stable', 'standard', 'lively'];
export const SAMPLING = ['top_k', 'top_p', 'temperature', 'repetition_penalty'];
export const LANGS = ['ja', 'zh', 'en'];
export const CROSS = 'cross';
export const MAX_CUSTOM = 20; // the node's limits for presets made here
export const LABEL_LENGTH = 24;
// [min, max, step]: the node's own input ranges.
export const PARAM_RANGES = { top_k: [1, 100, 1], top_p: [0.05, 1, 0.05], temperature: [0.05, 2, 0.05], repetition_penalty: [1, 2, 0.05], speed: [0.5, 2, 0.05] };

async function readJson(resp) {
    if (!resp.ok) {
        const message = await resp.text().catch(() => '');
        throw new Error(message || `HTTP ${resp.status}`);
    }
    return resp.json();
}

/** `{default, presets, labels, builtin, languages, cross, file}`; `presets` lists the built-in ones first. */
export async function loadPresets() {
    return readJson(await fetch('/anomalous_tts/presets'));
}

export async function savePresets(data) {
    return readJson(await fetch('/anomalous_tts/presets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presets: data }),
    }));
}

export const isBuiltin = name => BUILTIN.includes(name);

/** A preset's shown name: a built-in one translated, one made here as it was named. */
export function presetLabel(labels, name, t) {
    return isBuiltin(name) ? t(`ttsPreset_${name}`) : (labels?.[name] || name);
}

/** A key for a new preset. Never one used before, so a character still naming a deleted preset does not pick up the new one. */
export function newPresetId(names, now = Date.now()) {
    let id = `custom_${now.toString(36)}`;
    for (let n = 1; names.includes(id); n += 1) id = `custom_${(now + n).toString(36)}`;
    return id;
}

/**
 * Where a mode sits between steady (0) and lively (100): more candidates (`top_k`, 5 to 50 on a
 * log scale) and more randomness (`temperature`, 0.6 to 1.4) count half each; a `top_p` under 1
 * narrows it. Built in: steady 28, standard 49, lively 70.
 */
export function liveliness({ top_k: topK, top_p: topP, temperature }) {
    const clamp = value => Math.min(1, Math.max(0, value));
    const candidates = clamp(Math.log(topK / 5) / Math.log(10));
    const randomness = clamp((temperature - 0.6) / 0.8);
    return Math.round(100 * ((candidates + randomness) / 2) * (0.5 + topP / 2));
}

/** How a mode compares with the one it is measured against: about / steadier / muchSteadier / livelier / muchLivelier. */
export function compareFeel(base, values) {
    const shift = liveliness(values) - liveliness(base);
    if (Math.abs(shift) < 4) return 'about';
    const much = Math.abs(shift) >= 25 ? 'much' : '';
    const word = shift < 0 ? 'Steadier' : 'Livelier';
    return much ? `much${word}` : word.toLowerCase();
}

// A line to listen to the modes with, in the character's language.
export const SAMPLE_LINES = {
    ja: '先生、おはようございます！今日も一緒に頑張りましょうね。',
    zh: '老师，早上好！今天也一起加油吧。',
    en: 'Good morning, teacher! Let\'s do our best today, too.',
};

/** The first sentence of a script for listening: tags left out, at most 40 characters; '' when there is none. */
export function firstSentence(speech) {
    const text = String(speech || '').replace(/\{[^}]*\}|\[[^\]]*\]/g, '').trim();
    const sentence = /^[\s\S]*?[。！？!?.](?=\s|$|[^.])/.exec(text)?.[0] || text.split('\n')[0];
    return sentence.trim().slice(0, 40);
}

/** What can be changed of the presets file, from `loadPresets()`; `presetsFile` writes it back. */
export function stateFromView(view) {
    return { defaultName: view.default, rules: { ...view.languages }, cross: view.cross, numbers: structuredClone(view.presets), labels: { ...view.labels } };
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
 * The presets file from the settings group's state: of a built-in preset only the numbers that
 * differ from the built-in ones, a preset made here whole with its name, and the language rules
 * that differ from the "other pairs" one.
 */
export function presetsFile(view, { defaultName, numbers = {}, labels = {}, rules = {}, cross }) {
    const presets = {};
    for (const [name, values] of Object.entries(numbers)) {
        const block = isBuiltin(name) ? {} : { label: labels[name] };
        for (const key of SAMPLING) if (!isBuiltin(name) || values[key] !== view.builtin[name][key]) block[key] = values[key];
        if (Object.keys(block).length) presets[name] = block;
    }
    const languages = {};
    for (const [pair, name] of Object.entries(rules)) if (name && name !== cross) languages[pair] = name;
    if (cross !== 'stable') languages[CROSS] = cross;
    const out = { format: 1, default: defaultName };
    if (Object.keys(presets).length) out.presets = presets;
    if (Object.keys(languages).length) out.languages = languages;
    return out;
}

/** Where the general settings and the characters use preset `name`: `{general: [...], characters: [...]}`. */
export function presetUses(state, name, groups) {
    const general = [];
    if (state.defaultName === name) general.push('default');
    for (const [pair, value] of Object.entries(state.rules)) if (value === name) general.push(pair);
    if (state.cross === name) general.push(CROSS);
    const characters = [];
    for (const group of groups || []) {
        const defaults = group.raw?.settings?.defaults;
        if (!defaults || typeof defaults !== 'object') continue;
        const blocks = [defaults, ...Object.values(defaults.by_language || {})];
        if (blocks.some(block => block?.preset === name)) characters.push(group.raw?.name || group.character);
    }
    return { general, characters };
}

/** Take preset `name` out of the state; what used it goes back to the general setting (characters naming it do so by themselves). */
export function removePreset(state, name) {
    delete state.numbers[name];
    delete state.labels[name];
    for (const [pair, value] of Object.entries(state.rules)) if (value === name) delete state.rules[pair];
    if (state.cross === name) state.cross = 'stable';
    if (state.defaultName === name) state.defaultName = 'standard';
}

/** The preset a line falls back to without the character's own settings (layers 1 and 3 of §5.4). */
export function generalPreset(view, refLang, lang) {
    if (!refLang || refLang === lang) return view.default;
    return view.languages[`${refLang}>${lang}`] || view.cross;
}

/**
 * What a character's lines are sampled with for one dialog row (`all` = in its own language),
 * next to what the general presets alone give: layers 1 to 4 of §5.4. A preset deleted since is skipped.
 */
export function lineTuning(view, rows, refLang, key) {
    const lang = key === 'all' ? refLang : key;
    const preset = name => view.presets[name] || {};
    const general = { ...preset(generalPreset(view, refLang, lang)), speed: 1 };
    const values = { ...preset(view.default), speed: 1 };
    const apply = row => {
        Object.assign(values, preset(row.preset), row.numbers);
        if (typeof row.speed === 'number') values.speed = row.speed;
    };
    apply(rows.all);
    if (refLang && lang !== refLang) Object.assign(values, preset(generalPreset(view, refLang, lang)));
    if (key !== 'all') apply(rows[key]);
    return { values, general };
}

/**
 * A character's own settings as dialog rows: `all` (the `defaults` block) and one per language,
 * each `{preset: '' | name, numbers: {key: value}, speed: number | null}` ('' = follow the general one).
 */
export function tuningRows(settings) {
    const defaults = settings?.defaults && typeof settings.defaults === 'object' ? settings.defaults : {};
    const row = block => ({
        preset: typeof block?.preset === 'string' ? block.preset : '',
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
