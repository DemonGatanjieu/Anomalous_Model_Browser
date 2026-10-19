/**
 * What the canvas's quick search (ui_quick_search.js) looks through, and how it matches: the
 * models a loader node can take (GET /anomalous/quick_index), the combos and the saved
 * prompts, each read when the bar opens and kept a minute. `searchQuick` is the matching
 * itself: every word typed must appear in an item's name, file, base model, trigger words or
 * text; names that start with the words come first. No DOM.
 */

// The loader node each model type goes on the canvas with (ui_grid.js applyModelToCanvas).
export const MODEL_LOADERS = Object.freeze({
    checkpoints: 'CheckpointLoaderSimple',
    loras: 'LoraLoader',
    unet: 'UNETLoader',
    diffusion_models: 'UNETLoader',
    vae: 'VAELoader',
    clip: 'CLIPLoader',
    controlnet: 'ControlNetLoader',
});
export const KINDS = Object.freeze(['combo', 'model', 'prompt']);
const KEEP_MS = 60 * 1000;
const PER_KIND = 8;

const stem = name => String(name || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
const lower = value => String(value || '').toLowerCase();

/** The words of `query`, lower case. */
export const queryTerms = query => lower(query).split(/\s+/).filter(Boolean);

/** A model (GET /anomalous/quick_index) as a search item. */
export function modelItem(model) {
    const title = model.name || model.civitai_name || stem(model.filename);
    return {
        kind: 'model',
        key: `model|${model.type}|${model.subfolder}|${model.filename}`,
        title,
        type: model.type,
        detail: [model.base, model.subfolder].filter(Boolean).join(' · '),
        thumb: model.preview_url || '',
        haystack: lower([title, model.civitai_name, model.filename, model.subfolder, model.base, ...(model.words || [])].join(' ')),
        data: model,
    };
}

/** A combo (GET /anomalous/notebooks) as a search item; `detail` and `thumb` come from the caller. */
export function comboItem(note, { detail = '', thumb = '', text = '' } = {}) {
    return {
        kind: 'combo',
        key: `combo|${note.filename}`,
        title: note.name,
        detail,
        thumb,
        haystack: lower([note.name, detail, text].join(' ')),
        data: note,
    };
}

/** A saved prompt card ({ id, title, content, role }) as a search item. */
export function promptItem(card) {
    return {
        kind: 'prompt',
        key: `prompt|${card.id}`,
        title: card.title,
        detail: card.content.replace(/\s+/g, ' ').slice(0, 90),
        role: card.role,
        haystack: lower([card.title, card.content].join(' ')),
        data: card,
    };
}

/** 0: the title starts with the words, 1: the title holds them, 2: elsewhere. */
function rank(item, terms) {
    const title = lower(item.title);
    if (title.startsWith(terms.join(' '))) return 0;
    return terms.every(term => title.includes(term)) ? 1 : 2;
}

/**
 * The items matching `query` among `items`, grouped by kind in KINDS' order (only `kind` when
 * given), at most `perKind` of each. With no words: the combos only, as they are.
 */
export function searchQuick(items, query, { kind = '', perKind = PER_KIND } = {}) {
    const terms = queryTerms(query);
    const wanted = kind ? [kind] : KINDS;
    const groups = [];
    for (const each of wanted) {
        let found = items.filter(item => item.kind === each);
        if (terms.length) {
            found = found.filter(item => terms.every(term => item.haystack.includes(term)))
                .map((item, index) => ({ item, index, rank: rank(item, terms) }))
                .sort((a, b) => a.rank - b.rank || a.index - b.index)
                .map(entry => entry.item);
        } else if (!kind && each !== 'combo') {
            found = [];
        }
        if (found.length) groups.push({ kind: each, items: found.slice(0, perKind), more: Math.max(0, found.length - perKind) });
    }
    return groups;
}

let cache = null; // { at, models, combos, prompts }

/** The kept lists when younger than a minute, else null. */
export function cachedSources(now = Date.now()) {
    return cache && now - cache.at < KEEP_MS ? cache : null;
}

export function keepSources(sources, now = Date.now()) {
    cache = { ...sources, at: now };
    return cache;
}

/** The models a loader node can take, as search items. */
export async function loadModelItems(signal) {
    const response = await fetch('/anomalous/quick_index', { signal });
    if (!response.ok) throw new Error(`quick index ${response.status}`);
    const { models = [] } = await response.json();
    return models.filter(model => MODEL_LOADERS[model.type]).map(modelItem);
}
