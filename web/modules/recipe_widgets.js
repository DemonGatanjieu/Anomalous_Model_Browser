/**
 * Reading a canvas node's boxes for a workflow's summary (recipe_parser.js, recipe_loras.js): the
 * node's type, a box's value by name (else by position, live or as saved), the value as text or
 * a number, and whether it is a chosen model file.
 */

import { isPlaceholderModelValue } from './recipe_identity.js';

const MODEL_FILE_PATTERN = /\.(?:safetensors|ckpt|pt|bin|sft|gguf)$/i;

export function nodeType(node) {
    return String(node?.type || node?.comfyClass || '');
}

export function normaliseName(value) {
    return String(value || '').trim().toLowerCase();
}

export function widgetValue(node, names, fallbackIndex = -1) {
    const wanted = new Set(names.map(normaliseName));
    const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
    const named = widgets.find((widget) => wanted.has(normaliseName(widget?.name)));
    if (named && named.value !== undefined && named.value !== null) return named.value;

    if (fallbackIndex >= 0) {
        const fallback = widgets[fallbackIndex]?.value;
        if (fallback !== undefined && fallback !== null) return fallback;
        const serialised = node?.widgets_values?.[fallbackIndex];
        if (serialised !== undefined && serialised !== null) return serialised;
    }
    return null;
}

export function textValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function numberValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function isSelectedModelFile(value) {
    const text = textValue(value);
    return Boolean(text && !isPlaceholderModelValue(text) && MODEL_FILE_PATTERN.test(text));
}
