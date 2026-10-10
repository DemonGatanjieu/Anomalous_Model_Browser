/**
 * Prompt Studio's saved prompts: the prompt-kind material files, two cards each at most (its
 * positive and its negative text), and saving a new one. The list is asked for every time;
 * a prompt's text is read once, since a saved prompt's text never changes (only its name).
 */

import { materialPromptText } from './material_prompt_data.js';
import { categorizePromptSnippet } from './prompt_composition.js';
import { jsonResponse } from './ui_dom.js';

const texts = new Map(); // `${filename}|${timestamp}` -> { positive, negative }

async function promptText(item, signal) {
    const key = `${item.filename}|${item.timestamp || 0}`;
    if (!texts.has(key)) {
        const response = await fetch(`/anomalous/material_full?include_workflow=0&filename=${encodeURIComponent(item.filename)}`, { signal });
        const payload = await jsonResponse(response, 'material load failed');
        if (payload.status !== 'success') throw new Error('materialDetailLoadError');
        texts.set(key, materialPromptText(payload));
    }
    return texts.get(key);
}

/** Every saved prompt as cards { id, filename, title, content, role }, newest first. */
export async function loadPromptSourceCards(signal) {
    const cards = [];
    const seen = new Set();
    let page = 1;
    let pages = 1;
    do {
        signal.throwIfAborted();
        const response = await fetch(`/anomalous/materials?category=prompts&limit=100&page=${page}`, { signal });
        const payload = await jsonResponse(response, 'materialLoadError');
        if (payload.status !== 'success' || !Array.isArray(payload.materials)) throw new Error('materialLoadError');
        pages = Number(payload.pages) || 1;
        for (const item of payload.materials) {
            if (seen.has(item.filename)) continue;
            seen.add(item.filename);
            const prompts = await promptText(item, signal);
            for (const role of ['positive', 'negative']) {
                const content = prompts[role]?.trim();
                if (content) cards.push({ id: `mat_${role}_${item.filename}`, filename: item.filename, title: item.name || item.filename, content, role });
            }
        }
        page++;
    } while (page <= pages);
    signal.throwIfAborted();
    return cards;
}

/**
 * Saves `content` as a prompt of `role` named `name`. Returns { status: 'saved', filename }
 * or { status: 'duplicate', name } when the same prompt is saved already.
 */
export async function savePromptCard({ name, content, role }) {
    const negative = role === 'negative';
    const text = content.trim();
    const response = await fetch('/anomalous/save_prompt_plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name,
            tags: [],
            plan: {
                version: 2,
                positive: negative ? '' : text,
                negative: negative ? text : '',
                parts: [{
                    name, role, enabled: true,
                    category: negative ? 'base' : categorizePromptSnippet(text),
                    positive: negative ? '' : text,
                    negative: negative ? text : '',
                }],
            },
        }),
    });
    if (response.status === 409) {
        const duplicate = await response.json();
        return { status: 'duplicate', name: duplicate.name || name };
    }
    const payload = await jsonResponse(response, 'prompt save failed');
    if (payload.status !== 'success') throw new Error('prompt save failed');
    return { status: 'saved', filename: payload.filename };
}
