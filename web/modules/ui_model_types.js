/**
 * The models page's type bar: one chip per models folder (Checkpoint, LoRA, …) with its
 * model count, first in the grid. A chip lists that whole folder, subfolders included; a
 * folder picked in the list narrows the grid to that folder alone, shown as a crumb whose
 * ✕ leads back to the whole type.
 *
 * `owner.modelScope` is what the grid lists: `{type, path_idx}` for a chip, plus
 * `subfolder` for a list folder. `currentType/PathIdx/Subfolder` stay "where the model at
 * hand lives", which the editor, the scanner and "add to canvas" read (see focusModel).
 */

import { translate as t } from './locales.js';

const SCOPE_KEY = 'anomalous_model_scope';

// Folder names ComfyUI registers → what people call them.
const TYPE_NAMES = {
    checkpoints: 'Checkpoint', loras: 'LoRA', vae: 'VAE', controlnet: 'ControlNet',
    unet: 'UNet', diffusion_models: 'Diffusion', clip: 'CLIP', text_encoders: 'Text Encoder',
    clip_vision: 'CLIP Vision', embeddings: 'Embedding', upscale_models: 'Upscale',
    hypernetworks: 'Hypernetwork', style_models: 'Style', gligen: 'GLIGEN', photomaker: 'PhotoMaker',
};

export function typeLabel(group) {
    const [, base, suffix = ''] = String(group.label || group.type).match(/^(.*?)( \(\d+\))?$/);
    return (TYPE_NAMES[base] || base) + suffix;
}

const modelCount = group => Object.values(group.folders || {}).reduce((sum, folder) => sum + (folder.model_count || 0), 0);
const sameGroup = (group, scope) => Boolean(scope) && group.type === scope.type && group.path_idx === scope.path_idx;

function readSaved() {
    try {
        return JSON.parse(localStorage.getItem(SCOPE_KEY) || 'null');
    } catch {
        return null;
    }
}

function showType(owner, group) {
    owner.modelScope = { type: group.type, path_idx: group.path_idx };
    owner.currentType = group.type;
    owner.currentPathIdx = group.path_idx;
    owner.currentSubfolder = '/';
    try {
        localStorage.setItem(SCOPE_KEY, JSON.stringify(owner.modelScope));
    } catch { /* remembering the chip is a convenience */ }
}

function openType(owner, group) {
    showType(owner, group);
    owner.renderSidebar();
    owner.loadModels();
}

/** After the folders load: keeps a scope whose folder still exists, else the remembered chip or the first with models. */
export function settleModelScope(owner) {
    const groups = owner.foldersData || [];
    if (!groups.length) return;
    if (owner.firstLoadDone && groups.some(group => sameGroup(group, owner.modelScope))) return;
    owner.firstLoadDone = true;
    const saved = readSaved();
    const group = groups.find(item => sameGroup(item, saved) && modelCount(item) > 0)
        || groups.find(item => modelCount(item) > 0)
        || groups[0];
    showType(owner, group);
}

/** Where the grid's models come from. */
export function modelListUrl(owner) {
    const scope = owner.modelScope;
    if (scope && !scope.subfolder) {
        return `/anomalous/type_models?${new URLSearchParams({ type: scope.type, path_idx: scope.path_idx })}`;
    }
    const params = scope
        ? { type: scope.type, path_idx: scope.path_idx, subfolder: scope.subfolder }
        : { type: owner.currentType, path_idx: owner.currentPathIdx, subfolder: owner.currentSubfolder };
    return `/anomalous/models?${new URLSearchParams(params)}`;
}

/** A card's model becomes the model at hand: the editor, the scanner and "add to canvas" read its folder. */
export function focusModel(owner, model) {
    owner.currentType = model.type || owner.currentType;
    owner.currentPathIdx = model.path_idx ?? owner.currentPathIdx;
    owner.currentSubfolder = model.subfolder ? `/${model.subfolder}` : '/';
}

/** The chip bar, the grid's first child (it spans the whole row). `listed`: models the grid just got. */
export function renderTypeBar(owner, listed) {
    const bar = document.createElement('div');
    bar.className = 'anomalous-model-types';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', t('modelTypesLabel'));
    const scope = owner.modelScope;
    const groups = owner.foldersData || [];
    for (const group of groups) {
        const active = sameGroup(group, scope);
        const whole = active && !scope.subfolder;
        // The folder counts date from the last folder load; the listed type counts what it shows.
        const count = whole ? listed : modelCount(group);
        if (!count && !active) continue;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'anomalous-model-type-chip';
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-pressed', String(whole));
        const name = document.createElement('span');
        name.textContent = typeLabel(group);
        const number = document.createElement('span');
        number.className = 'anomalous-model-type-count';
        number.textContent = String(count);
        chip.append(name, number);
        chip.onclick = () => { if (!whole) openType(owner, group); };
        bar.appendChild(chip);
    }
    const group = scope?.subfolder && groups.find(item => sameGroup(item, scope));
    if (group) {
        const crumb = document.createElement('button');
        crumb.type = 'button';
        crumb.className = 'anomalous-model-type-crumb';
        crumb.title = t('modelTypesCrumbHint', { type: typeLabel(group) });
        const name = document.createElement('span');
        name.textContent = scope.subfolder === '/'
            ? t('modelTypesRoot')
            : scope.subfolder.split('/').filter(Boolean).pop();
        const close = document.createElement('span');
        close.className = 'anomalous-model-type-crumb-x';
        close.textContent = '✕';
        crumb.append(name, close);
        crumb.onclick = () => openType(owner, group);
        bar.appendChild(crumb);
    }
    return bar;
}
