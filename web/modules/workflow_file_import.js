/**
 * Files dropped on the Workflows page (ui_recipe_drop.js keeps them as recipes), as rules without DOM:
 * what kind each file is, the workflow a .json holds (ComfyUI's own file, or a recipe AMB keeps, its
 * name, tags and notes coming along), the name a recipe gets, and what one toast says of a drop. A run's
 * API-format prompt has no canvas to keep: it is told apart, so the page can say why it was not kept.
 */

import { promptTitle } from './prompt_composition.js';

const KINDS = { json: 'json', png: 'image', webp: 'image', zip: 'zip' };
const IMAGE_TYPES = { 'image/png': 'image', 'image/webp': 'image' };
const MAX_NAME = 120; // api/recipe_constants.py MAX_NAME_LENGTH

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const words = value => (typeof value === 'string' ? value.trim() : '');

/** 'json' | 'image' (a picture ComfyUI may have saved its workflow in) | 'zip' (a recipe package) | 'unsupported'. */
export function classifyDroppedWorkflowFile(fileName, mimeType = '') {
    const extension = /\.([a-z0-9]+)$/i.exec(String(fileName || ''))?.[1]?.toLowerCase();
    return KINDS[extension] || IMAGE_TYPES[String(mimeType || '').toLowerCase()] || 'unsupported';
}

/** `workflow` without the key of the saves it belonged to (recipe_parser.js withoutSaves); nothing else changes. */
export function stripSavesKey(workflow) {
    if (!isObject(workflow?.extra) || !('anomalous_saves' in workflow.extra)) return workflow;
    const { anomalous_saves: _, ...extra } = workflow.extra;
    return { ...workflow, extra };
}

/** A run as ComfyUI queues it: {"<node id>": {class_type, inputs}}, no canvas. */
const isApiPrompt = value => isObject(value) && !Array.isArray(value.nodes) && Object.keys(value).length > 0
    && Object.values(value).every(node => isObject(node) && typeof node.class_type === 'string' && isObject(node.inputs));

/**
 * The workflow in a dropped .json's `text`: { ok: true, workflow, name, tags, notes }, or { ok: false,
 * reason: 'invalid_json' | 'not_workflow' | 'api_only' }. A recipe AMB keeps ({ workflow, name, tags,
 * notes }) gives its own name, tags and notes.
 */
export function parseDroppedWorkflowJson(text) {
    let data;
    try {
        data = JSON.parse(String(text ?? ''));
    } catch {
        return { ok: false, reason: 'invalid_json' };
    }
    if (isObject(data) && Array.isArray(data.nodes)) return { ok: true, workflow: stripSavesKey(data), name: '', tags: [], notes: '' };
    if (isObject(data) && isObject(data.workflow) && Array.isArray(data.workflow.nodes)) {
        const tags = Array.isArray(data.tags) ? data.tags.map(words).filter(Boolean) : [];
        return { ok: true, workflow: stripSavesKey(data.workflow), name: words(data.name), tags: [...new Set(tags)], notes: words(data.notes) };
    }
    return { ok: false, reason: isApiPrompt(data) || isApiPrompt(data?.prompt) ? 'api_only' : 'not_workflow' };
}

/** The recipe's name: the recipe's own, else the file's without its extension, else its prompt's first words, else `fallback`. */
export function deriveDroppedRecipeName({ fileName = '', explicitName = '', promptPositive = '', fallback = '' } = {}) {
    const stem = String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.(json|png|webp)$/i, '').trim();
    return ([explicitName, stem, promptTitle(words(promptPositive)), fallback].map(words).find(Boolean) || '').slice(0, MAX_NAME);
}

/**
 * What a drop did, for its toast: `results` [{ name, reason }] (no reason: kept; `shown`: a package that
 * opened its own window, counted in neither). Returns { saved: [names], skipped: [{ name, reason }] }.
 */
export function buildDropSummary(results) {
    const saved = [];
    const skipped = [];
    for (const result of results || []) {
        if (result?.shown) continue;
        if (result?.reason) skipped.push({ name: String(result.name || ''), reason: result.reason });
        else saved.push(String(result?.name || ''));
    }
    return { saved, skipped };
}
