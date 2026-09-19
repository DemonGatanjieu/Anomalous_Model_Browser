import { loadMaterialPrompts } from './material_prompt_data.js';
import { categorizePromptSnippet } from './prompt_composition.js';
import { jsonResponse } from './ui_dom.js';

// A complete snapshot is required before replacing library-owned cards.
export async function loadPromptSourceCards(signal) {
    const cards = [];
    const filenames = new Set();
    let page = 1;
    let pages = 1;
    do {
        signal.throwIfAborted();
        const response = await fetch(`/anomalous/materials?category=prompts&limit=100&page=${page}`, { signal });
        const payload = await jsonResponse(response, 'materialLoadError');
        if (payload.status !== 'success' || !Array.isArray(payload.materials)) throw new Error('materialLoadError');
        pages = Number(payload.pages) || 1;
        for (const item of payload.materials) {
            signal.throwIfAborted();
            if (filenames.has(item.filename)) continue;
            filenames.add(item.filename);
            const prompts = await loadMaterialPrompts(item.filename, signal);
            for (const role of ['positive', 'negative']) {
                const content = prompts[role]?.trim();
                if (!content) continue;
                cards.push({
                    id: `mat_${role}_${item.filename}`, filename: item.filename,
                    title: item.name || item.filename, content, role,
                    category: role === 'negative' ? 'base' : categorizePromptSnippet(content),
                    persisted: true, sourceKind: 'material',
                });
            }
        }
        page++;
    } while (page <= pages);
    signal.throwIfAborted();
    return cards;
}

export function mergePromptSourceCards(existing, incoming) {
    const oldIds = new Set(existing.filter(card => card.sourceKind === 'material').map(card => card.id));
    const local = existing.filter(card => card.sourceKind !== 'material');
    const unique = [...new Map(incoming.map(card => [card.id, card])).values()];
    const added = unique.filter(card => !oldIds.has(card.id)).length;
    existing.splice(0, existing.length, ...local, ...unique);
    return added;
}
