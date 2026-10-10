/**
 * Key parameters: the node values the user stars to keep in view (a sampler's cfg, a LoRA's
 * strength), by node type and widget name, so a star holds in every workflow. Kept in a
 * hidden ComfyUI setting, which follows the user's ComfyUI profile. Starred in the comparison
 * window (ui_param_compare.js), which shows them first, as the parameter sets do
 * (ui_param_set_keys.js).
 */

import { app } from '../../../scripts/app.js';

export const KEY_PARAMS_SETTING_ID = 'Anomalous.ModelBrowser.KeyParameters';
const MAX_KEYS = 40;
const listeners = new Set();
const keyOf = (type, widget) => `${type}\n${widget}`;

/** The setting's entry for registerExtension: hidden from ComfyUI's settings dialog. */
export function keyParamsSetting() {
    return { id: KEY_PARAMS_SETTING_ID, name: 'Anomalous key parameters', type: 'hidden', defaultValue: [] };
}

function stored() {
    try {
        const value = app.extensionManager?.setting?.get(KEY_PARAMS_SETTING_ID);
        return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
    } catch (_) {
        return [];
    }
}

/** A predicate (type, widget name) → starred, read once: pass it to compareParams. */
export function keyParamTest() {
    const keys = new Set(stored());
    return (type, widget) => keys.has(keyOf(type, widget));
}

/** Stars or unstars a widget of a node type; listeners hear of it once it is saved. */
export async function toggleKeyParam(type, widget) {
    const key = keyOf(type, widget);
    const keys = stored();
    const next = keys.includes(key) ? keys.filter(item => item !== key) : [...keys, key].slice(-MAX_KEYS);
    await app.extensionManager?.setting?.set(KEY_PARAMS_SETTING_ID, next);
    for (const listener of listeners) listener();
}

/** Calls `listener` after each star change; returns the function that stops it. */
export function onKeyParamsChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}