/**
 * The Chinese meaning under each tag in Prompt Studio. Tags without one yet are sent to the
 * translation service (translation_service.js) a line each, in batches of a few hundred
 * characters; a batch whose answer does not come back line for line asks tag by tag. Meanings
 * are kept for the session. Chinese tags have none. No DOM here.
 */

import { hasChinese, translatePromptText } from './translation_service.js';
import { tagWeight } from './prompt_tags.js';

const BATCH_CHARS = 800;
const MAX_KEPT = 3000;
const meanings = new Map(); // tag words, lower case -> meaning
const coreOf = tag => tagWeight(tag).core.trim();

/** The meaning of `tag`: a string, '' when it needs none, undefined when not known yet. */
export function glossOf(tag) {
    const core = coreOf(tag);
    if (!core || hasChinese(core)) return '';
    return meanings.get(core.toLowerCase());
}

function keep(core, meaning) {
    if (meanings.size >= MAX_KEPT) meanings.delete(meanings.keys().next().value);
    meanings.set(core.toLowerCase(), meaning.trim());
}

async function askOneByOne(cores, signal) {
    for (const core of cores) {
        const result = await translatePromptText(core, { targetLang: 'zh-CN', signal });
        if (!result.ok) return false;
        keep(core, result.translated);
    }
    return true;
}

/** Looks up the tags with no meaning yet; false when the service could not be reached. */
export async function fetchGlosses(tags, signal) {
    const wanted = [...new Set(tags.map(coreOf))].filter(core => glossOf(core) === undefined);
    let batch = [];
    let size = 0;
    const flush = async () => {
        if (!batch.length) return true;
        const cores = batch;
        batch = [];
        size = 0;
        const result = await translatePromptText(cores.join('\n'), { targetLang: 'zh-CN', signal });
        if (!result.ok) return false;
        const lines = result.translated.split(/\r?\n/);
        if (lines.length !== cores.length) return askOneByOne(cores, signal);
        cores.forEach((core, index) => keep(core, lines[index]));
        return true;
    };
    for (const core of wanted) {
        if (size + core.length > BATCH_CHARS && !await flush()) return false;
        batch.push(core);
        size += core.length + 1;
    }
    return flush();
}
