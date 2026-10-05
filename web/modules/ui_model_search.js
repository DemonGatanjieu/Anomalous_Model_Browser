/**
 * The models page's search, in the header where it is seen, instead of inside the folder list.
 * It narrows the grid of the type being shown to the models whose name, file name, folder,
 * trigger words, base model or notes hold every word typed (ui_grid.js applies it through
 * `owner.modelQuery`); Esc or the field's ✕ clears it. Shown on the models page only (CSS,
 * by the shell's `data-page`).
 */

import { translate as t } from './locales.js';

const WAIT_MS = 180;

/** Whether a listed model matches every word of `query` (any case). */
export function matchesModelQuery(model, query) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const meta = model?.metadata || {};
    const text = [
        model?.filename, model?.subfolder, meta.custom_name, meta.name, meta.baseModel, meta.custom_notes,
        ...(Array.isArray(meta.trainedWords) ? meta.trainedWords : []),
    ].filter(Boolean).join('\n').toLowerCase();
    return words.every(word => text.includes(word));
}

/** Back from a model's page to the grid, where the results are. */
function leaveDetail(owner) {
    if (!owner.currentDetailModel) return;
    owner.stopMediaInContainer?.(owner.detailPanel);
    owner.detailPanel.replaceChildren();
    owner.detailPanel.style.display = 'none';
    owner.currentDetailModel = null;
    owner.grid.style.display = 'grid';
}

export function createModelSearch(owner) {
    const box = document.createElement('label');
    box.className = 'anomalous-model-search';
    const icon = document.createElement('span');
    icon.className = 'anomalous-model-search-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '⌕';
    const input = document.createElement('input');
    input.type = 'search';
    input.spellcheck = false;
    input.placeholder = t('modelSearchPlaceholder');
    input.setAttribute('aria-label', t('modelSearchPlaceholder'));
    let timer = 0;
    const apply = () => {
        clearTimeout(timer);
        const query = input.value.trim();
        if (query === (owner.modelQuery || '')) return;
        owner.modelQuery = query;
        leaveDetail(owner);
        owner.loadModels();
    };
    input.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(apply, WAIT_MS);
    };
    input.onkeydown = (event) => {
        if (event.key === 'Enter') apply();
        if (event.key === 'Escape' && input.value) {
            event.stopPropagation(); // clears the search, does not close the browser
            input.value = '';
            apply();
        }
    };
    box.append(icon, input);
    owner.modelSearchInput = input;
    return box;
}
