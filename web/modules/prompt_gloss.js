/**
 * The meaning under each tag in Prompt Studio, in a language the user picks. Tags without one
 * yet are sent to the translation service (translation_service.js) a line each, in batches of
 * a few hundred characters; a batch whose answer does not come back line for line asks tag by
 * tag. Meanings are kept for the session, per language. Tags that are not English have none.
 * No DOM here.
 */

import { needsEnglish, translatePromptText } from './translation_service.js';
import { tagWeight } from './prompt_tags.js';

/** Languages a meaning can be shown in: the translation code and the language's own name. */
export const GLOSS_LANGUAGES = [
    ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['ja', '日本語'], ['ko', '한국어'], ['ru', 'Русский'],
    ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'],
];

const BATCH_CHARS = 800;
const MAX_KEPT = 3000;
const meanings = new Map(); // `${lang}:${tag words, lower case}` -> meaning
const coreOf = tag => tagWeight(tag).core.trim();
const keyOf = (core, lang) => `${lang}:${core.toLowerCase()}`;

/** The meaning of `tag` in `lang`: a string, '' when it needs none, undefined when not known yet. */
export function glossOf(tag, lang) {
    const core = coreOf(tag);
    if (!core || needsEnglish(core)) return '';
    return meanings.get(keyOf(core, lang));
}

function keep(core, lang, meaning) {
    if (meanings.size >= MAX_KEPT) meanings.delete(meanings.keys().next().value);
    meanings.set(keyOf(core, lang), meaning.trim());
}

async function askOneByOne(cores, lang, signal) {
    for (const core of cores) {
        const result = await translatePromptText(core, { targetLang: lang, signal });
        if (!result.ok) return false;
        keep(core, lang, result.translated);
    }
    return true;
}

/** Looks up the tags with no meaning in `lang` yet; false when the service could not be reached. */
export async function fetchGlosses(tags, lang, signal) {
    const wanted = [...new Set(tags.map(coreOf))].filter(core => glossOf(core, lang) === undefined);
    let batch = [];
    let size = 0;
    const flush = async () => {
        if (!batch.length) return true;
        const cores = batch;
        batch = [];
        size = 0;
        const result = await translatePromptText(cores.join('\n'), { targetLang: lang, signal });
        if (!result.ok) return false;
        const lines = result.translated.split(/\r?\n/);
        if (lines.length !== cores.length) return askOneByOne(cores, lang, signal);
        cores.forEach((core, index) => keep(core, lang, lines[index]));
        return true;
    };
    for (const core of wanted) {
        if (size + core.length > BATCH_CHARS && !await flush()) return false;
        batch.push(core);
        size += core.length + 1;
    }
    return flush();
}