/**
 * How each line of a voice-over is read (no DOM): its language, speed and tone, in three layers
 * changed for this script, the most particular first: the line (`line.tune`), its character,
 * the whole script; then the character's usual (saved) values, then the defaults. Each layer
 * holds only the fields set on it, and a field set to what it would get anyway is dropped, so
 * "where it comes from" always names the layer that decided it (`from`: 'line', 'character',
 * 'script', 'usual' or 'default'). Anomalous_TTS interface 17 reads a line's own values from tags
 * in the script, `[lang:ja][speed:1.2][preset:lively]` (`auto` goes back to detecting / the
 * presets), over every other setting; the whole script's go through the node's inputs.
 */

export const TUNE_FIELDS = ['language', 'speed', 'preset'];
export const LINE_TAGS_FORMAT = 17; // the node interface that reads [lang:…] [speed:…] [preset:…]
export const AUTO_MODE = '';        // the mode that lets the presets decide

/** What a line set for itself: only those fields. */
export function ownTune(line) {
    return line?.tune && typeof line.tune === 'object' ? line.tune : {};
}

export function hasOwnTune(line) {
    const own = ownTune(line);
    return TUNE_FIELDS.some(field => own[field] !== undefined);
}

/** A line's values: its own over its character's (`character`: `{ language, speed, preset }`). */
export function lineValues(line, character) {
    const own = ownTune(line);
    return Object.fromEntries(TUNE_FIELDS.map(field => [field, own[field] ?? character?.[field]]));
}

/** `own[field] = value`, or no entry when `value` is undefined or what the layer below gives (`inherited`). */
export function setOwn(own, field, value, inherited) {
    if (value === undefined || value === inherited) delete own[field];
    else own[field] = value;
}

/**
 * Sets `field` on each line, or with `value` undefined (or what its character reads it with,
 * `inheritedOf(line)`) lets it follow its character again.
 */
export function setLineTune(lines, field, value, inheritedOf = () => undefined) {
    for (const line of lines) {
        if (!line) continue;
        const own = { ...ownTune(line) };
        setOwn(own, field, value, inheritedOf(line));
        if (Object.keys(own).length) line.tune = own;
        else delete line.tune;
    }
}

/** The whole script's values: what was changed for it, else the defaults (`base`). */
export function scriptLayer(script, base) {
    const values = {};
    const from = {};
    for (const field of TUNE_FIELDS) {
        const own = script?.[field] !== undefined;
        values[field] = own ? script[field] : base[field];
        from[field] = own ? 'script' : 'default';
    }
    return { values, from };
}

/**
 * A character's values in this script: changed for it here (`cast`), else for the whole script,
 * else its usual ones (`stored`; 'usual' only where they differ from `base`).
 */
export function characterLayer(cast, script, stored, base) {
    const values = {};
    const from = {};
    for (const field of TUNE_FIELDS) {
        if (cast?.[field] !== undefined) [values[field], from[field]] = [cast[field], 'character'];
        else if (script?.[field] !== undefined) [values[field], from[field]] = [script[field], 'script'];
        else [values[field], from[field]] = [stored[field], stored[field] === base[field] ? 'default' : 'usual'];
    }
    return { values, from };
}

/** A line's values over its character's layer (`character`: `{ values, from }`). */
export function lineLayer(line, character) {
    const own = ownTune(line);
    const values = {};
    const from = {};
    for (const field of TUNE_FIELDS) {
        const mine = own[field] !== undefined;
        values[field] = mine ? own[field] : character.values[field];
        from[field] = mine ? 'line' : character.from[field];
    }
    return { values, from };
}

/** Lets the lines follow their character in everything again. */
export function clearLineTune(lines) {
    for (const line of lines) if (line) delete line.tune;
}

/**
 * The tags a line needs for the node to read it with `values` where it would read it with `node`
 * by itself (its inputs, the character's own settings): each field that differs. A language or
 * tone back to auto is `[lang:auto]` / `[preset:auto]`; missing `node` fields are auto.
 */
export function tuneTags(values, node = {}) {
    const nodeLanguage = node.language ?? 'auto';
    const nodePreset = node.preset ?? AUTO_MODE;
    let tags = '';
    if (values.language && values.language !== nodeLanguage) tags += `[lang:${values.language}]`;
    if (typeof values.speed === 'number' && values.speed !== node.speed) tags += `[speed:${Math.round(values.speed * 100) / 100}]`;
    if ((values.preset ?? AUTO_MODE) !== nodePreset) tags += `[preset:${values.preset || 'auto'}]`;
    return tags;
}

/**
 * The one value `field` has on all of `lines` (`valuesOf(line)`): `{ value, mixed }`; `own`:
 * whether every line set it for itself, `some` whether any did.
 */
export function sharedValue(lines, field, valuesOf) {
    const values = lines.map(line => valuesOf(line)[field]);
    const owned = lines.filter(line => ownTune(line)[field] !== undefined).length;
    return {
        value: values[0],
        mixed: values.some(value => value !== values[0]),
        own: lines.length > 0 && owned === lines.length,
        some: owned > 0,
    };
}

const TAG = /^\s*(speed|语速|preset|预设|lang|language|语言)\s*[:：]\s*(\S+)\s*$/i;
const FIELD = { speed: 'speed', 语速: 'speed', preset: 'preset', 预设: 'preset', lang: 'language', language: 'language', 语言: 'language' };
const LANGUAGE = { ja: 'ja', jp: 'ja', zh: 'zh', cn: 'zh', en: 'en', 日语: 'ja', 中文: 'zh', 英语: 'en', auto: 'auto', 自动: 'auto' };

/** `[speed:1.2]`'s inside -> `{ field: 'speed', value: 1.2 }`; null when it is no line setting (a name). */
export function readTuneTag(content) {
    const match = TAG.exec(String(content || ''));
    if (!match) return null;
    const field = FIELD[match[1].toLowerCase()];
    const raw = match[2];
    if (field === 'speed') {
        const value = Number(raw);
        return Number.isFinite(value) ? { field, value } : { field, value: undefined };
    }
    if (field === 'language') return { field, value: LANGUAGE[raw.toLowerCase()] };
    return { field, value: raw.toLowerCase() === 'auto' ? AUTO_MODE : raw };
}

/** "1, 3, 5" from line indexes (0-based in, 1-based out). */
export function lineNumbers(indexes) {
    return indexes.map(index => index + 1).join(', ');
}
