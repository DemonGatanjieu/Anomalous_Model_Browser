/**
 * The models page's base model filter: which family a model is listed under (its scanned base
 * model, else what its header tells, named as download_places.js names base model folders, so
 * "SDXL 1.0" and "SDXL" are one) and how many of each a list has. No DOM.
 */

import { baseFolder } from './download_places.js';

/** The base model family a model is listed under; '' when not known. */
export function baseFamily(model) {
    const meta = model?.metadata || {};
    const base = String(meta.baseModel || meta.base_guess || '').trim();
    return /^(unknown|other)?$/i.test(base) ? '' : baseFolder(base);
}

/** [[family, count]] of `models`, most first, the unknown ones last. */
export function countBases(models) {
    const counts = new Map();
    for (const model of models || []) {
        const family = baseFamily(model);
        counts.set(family, (counts.get(family) || 0) + 1);
    }
    return [...counts].sort((a, b) => Number(a[0] === '') - Number(b[0] === '') || b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Whether a model is listed under `family` (null: every model). */
export const inFamily = (model, family) => family === null || family === undefined || baseFamily(model) === family;
