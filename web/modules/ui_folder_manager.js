/**
 * Model folders, a view of the settings page: how the models are grouped (by ComfyUI's
 * model types or by the folders on disk), which groups show on the Models page and in
 * what order. Folders that are off are neither read nor scanned. Each change is saved at
 * once (POST /anomalous/save_config) and the folder list reloads shortly after.
 */

import { translate } from './locales.js';
import { typeLabel, isCommonModelType } from './ui_model_types.js';

const t = (key, params) => translate(key, params);
const RELOAD_DELAY_MS = 500;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    if (title) {
        node.title = title;
        node.setAttribute('aria-label', title);
    }
    return node;
}

async function postConfig(body) {
    const res = await fetch('/anomalous/save_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status === 'error') throw new Error(data.message || `HTTP ${res.status}`);
}

/**
 * Renders the view into `page` (an emptied settings page). `onBack` returns to the
 * settings. The list lives in this view only; the browser's folder list is reloaded.
 */
export async function renderFolderPage(owner, page, onBack) {
    const state = { mode: 'abstract', items: [], error: '' };
    let reloadTimer = null;

    const reloadFolders = () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
            owner.firstLoadDone = false;
            owner.loadFolders?.();
        }, RELOAD_DELAY_MS);
    };

    const save = async () => {
        const key = state.mode === 'physical' ? 'physical_folders_config' : 'folder_types_config';
        try {
            await postConfig({ [key]: state.items.map(({ type, visible }) => ({ type, visible })) });
            state.error = '';
            reloadFolders();
        } catch (error) {
            state.error = t('foldersSaveFailed', { error: error.message });
        }
        draw();
    };

    const load = async () => {
        try {
            const data = await (await fetch('/anomalous/all_folder_types')).json();
            state.mode = data.folder_view_mode === 'physical' ? 'physical' : 'abstract';
            // Shown ones first, in their saved order; the rest after.
            const items = data.folder_types || [];
            state.items = [...items.filter(item => item.visible), ...items.filter(item => !item.visible)];
            state.error = '';
        } catch (error) {
            state.error = t('foldersLoadFailed');
        }
        draw();
    };

    const setMode = async (mode) => {
        if (mode === state.mode) return;
        try {
            await postConfig({ folder_view_mode: mode });
            owner.expandedFolders?.clear();
            reloadFolders();
            await load();
        } catch (error) {
            state.error = t('foldersSaveFailed', { error: error.message });
            draw();
        }
    };

    const move = (item, step) => {
        const shown = state.items.filter(entry => entry.visible);
        const at = shown.indexOf(item);
        const other = shown[at + step];
        if (!other) return;
        const a = state.items.indexOf(item);
        const b = state.items.indexOf(other);
        [state.items[a], state.items[b]] = [state.items[b], state.items[a]];
        save();
    };

    const toggle = (item, on) => {
        item.visible = on;
        // A folder switched on joins the end of the shown ones; one switched off leaves them.
        state.items.splice(state.items.indexOf(item), 1);
        const lastShown = state.items.reduce((last, entry, index) => (entry.visible ? index : last), -1);
        state.items.splice(on ? lastShown + 1 : state.items.length, 0, item);
        save();
    };

    const row = (item, { first = false, last = false } = {}) => {
        const line = el('div', 'anomalous-scan-setting anomalous-folder-row');
        const copy = el('span', 'anomalous-scan-setting-copy');
        const name = typeLabel({ type: item.type });
        copy.append(el('span', 'anomalous-scan-setting-title', name));
        if (name !== item.type) copy.append(el('code', 'anomalous-folder-raw', item.type));
        const controls = el('span', 'anomalous-folder-controls');
        if (item.visible) {
            const up = button('anomalous-folder-move', '↑', () => move(item, -1), t('foldersMoveUp'));
            const down = button('anomalous-folder-move', '↓', () => move(item, 1), t('foldersMoveDown'));
            up.disabled = first;
            down.disabled = last;
            controls.append(up, down);
        }
        const input = el('input', 'anomalous-scan-switch');
        input.type = 'checkbox';
        input.checked = item.visible;
        input.setAttribute('aria-label', name);
        input.onchange = () => toggle(item, input.checked);
        controls.append(input);
        line.append(copy, controls);
        return line;
    };

    const group = (titleKey, ...children) => {
        const box = el('section', 'anomalous-scan-card anomalous-scan-group');
        box.append(el('h3', 'anomalous-scan-group-title', t(titleKey)), ...children);
        return box;
    };

    const modeChoices = () => {
        const segment = el('div', 'anomalous-scan-segment');
        segment.setAttribute('role', 'radiogroup');
        for (const [value, key] of [['abstract', 'foldersByType'], ['physical', 'foldersByDisk']]) {
            const choice = button('anomalous-scan-segment-btn', t(key), () => setMode(value));
            choice.setAttribute('role', 'radio');
            choice.setAttribute('aria-checked', String(state.mode === value));
            segment.append(choice);
        }
        return segment;
    };

    function draw() {
        const shown = state.items.filter(item => item.visible);
        const hidden = state.items.filter(item => !item.visible);
        // By type, ComfyUI registers many folders few people use: they wait behind a fold.
        const usual = state.mode === 'physical' ? hidden : hidden.filter(item => isCommonModelType(item.type));
        const rare = state.mode === 'physical' ? [] : hidden.filter(item => !isCommonModelType(item.type));

        const groupingHelp = el('small', 'anomalous-scan-setting-help', t(state.mode === 'physical' ? 'foldersByDiskHelp' : 'foldersByTypeHelp'));
        const shownRows = shown.length
            ? shown.map((item, index) => row(item, { first: index === 0, last: index === shown.length - 1 }))
            : [el('p', 'anomalous-scan-muted', t('foldersNoneShown'))];
        const hiddenRows = usual.map(item => row(item));
        if (rare.length) {
            const fold = el('details', 'anomalous-folder-rare');
            fold.append(el('summary', '', t('foldersRare', { count: rare.length })), ...rare.map(item => row(item)));
            hiddenRows.push(fold);
        }
        page.replaceChildren(
            button('anomalous-scan-back', t('foldersBack'), onBack),
            el('h1', 'anomalous-scan-title', t('sidebarManageFolders')),
            el('p', 'anomalous-scan-lead', t('foldersLead')),
            ...(state.error ? [el('p', 'anomalous-scan-note is-error', state.error)] : []),
            group('foldersGrouping', modeChoices(), groupingHelp),
            group('foldersShown', ...shownRows),
            ...(hiddenRows.length ? [group('foldersHidden', ...hiddenRows)] : []),
        );
    }

    page.replaceChildren(button('anomalous-scan-back', t('foldersBack'), onBack), el('p', 'anomalous-scan-muted', t('audioLoading')));
    await load();
}
