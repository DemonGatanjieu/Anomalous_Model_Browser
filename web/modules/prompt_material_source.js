import { loadMaterialPrompts } from './material_prompt_data.js';
import { categorizePromptSnippet } from './prompt_composition.js';
import { jsonResponse } from './ui_dom.js';

// Load every page through the same path for initial and explicit synchronization.
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
                    persisted: true,
                });
            }
        }
        page++;
    } while (page <= pages);
    signal.throwIfAborted();
    return cards;
}

export function mergePromptSourceCards(existing, incoming) {
    const keys = new Set(existing.map(card => `${card.role}\0${card.content.trim()}`));
    let added = 0;
    for (const card of incoming) {
        const key = `${card.role}\0${card.content.trim()}`;
        if (keys.has(key)) continue;
        existing.push(card);
        keys.add(key);
        added++;
    }
    return added;
}
