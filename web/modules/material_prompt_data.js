import { composePromptPlan } from './prompt_composition.js';
import { jsonResponse } from './ui_dom.js';


export function materialPromptText(payload) {
    const data = payload.data || {};
    if (data.kind === 'prompt_plan') return composePromptPlan(data.plan || {});
    if (['prompt_text', 'prompt_note_bundle'].includes(data.kind)) {
        return { positive: data.note?.promptEn || '', negative: '' };
    }
    const groups = payload.prompt_groups || {};
    return Object.fromEntries(['positive', 'negative'].map(role => [role,
        (Array.isArray(groups[role]) ? groups[role] : []).filter(value => typeof value === 'string' && value.trim()).join('\n'),
    ]));
}

export async function loadMaterialPrompts(filename, signal) {
    const response = await fetch(`/anomalous/material_full?include_workflow=0&filename=${encodeURIComponent(filename)}`, { signal });
    const payload = await jsonResponse(response, 'material load failed');
    if (payload.status !== 'success') throw new Error('materialDetailLoadError');
    return materialPromptText(payload);
}
