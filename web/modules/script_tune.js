/**
 * How each line of a voice-over is read (no DOM): its language, speed and mode. A line follows
 * its character unless it was set for itself (`line.tune`, only the fields set); the character's
 * values in this script come from the Script Director's run section (its saved defaults, changed
 * here for this script). Anomalous_TTS interface 17 reads a line's own values from tags in the
 * script, `[lang:ja][speed:1.2][preset:lively]`, over every other setting.
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

/** Sets `field` on each line, or with `value` undefined lets the lines follow their character again. */
export function setLineTune(lines, field, value) {
    for (const line of lines) {
        if (!line) continue;
        const own = { ...ownTune(line) };
        if (value === undefined) delete own[field];
        else own[field] = value;
        if (Object.keys(own).length) line.tune = own;
        else delete line.tune;
    }
}

/** Lets the lines follow their character in everything again. */
export function clearLineTune(lines) {
    for (const line of lines) if (line) delete line.tune;
}

/**
 * The tags a line needs for the node to read it with `values`: the language unless it is auto
 * (the node never reads a character's saved language itself), the speed when it is not the one
 * the node takes from the character's own settings (`stored.speed`), the mode unless it is Auto.
 */
export function tuneTags(values, stored) {
    let tags = '';
    if (values.language && values.language !== 'auto') tags += `[lang:${values.language}]`;
    if (typeof values.speed === 'number' && values.speed !== stored?.speed) tags += `[speed:${Math.round(values.speed * 100) / 100}]`;
    if (values.preset) tags += `[preset:${values.preset}]`;
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
const LANGUAGE = { ja: 'ja', jp: 'ja', zh: 'zh', cn: 'zh', en: 'en', 日语: 'ja', 中文: 'zh', 英语: 'en' };

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
    return { field, value: raw };
}

/** "1, 3, 5" from line indexes (0-based in, 1-based out). */
export function lineNumbers(indexes) {
    return indexes.map(index => index + 1).join(', ');
}
