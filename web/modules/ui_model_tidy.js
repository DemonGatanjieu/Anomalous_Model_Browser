/**
 * The models page's Tidy view (`owner.modelView === 'tidy'`, opened from the type bar's chip):
 * models whose header says they belong in another folder — what they are, why it matters
 * (the folder's loader cannot read them, or they load there all the same), where they go
 * (changeable) and "Move there" — and groups of identical files, each copy with "Recycle".
 * Nothing changes without a press; after one the view checks again and keeps a note of what
 * was done (`owner.modelTidy.notes`). model_placement.js does the requests.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { checkPlacement, moveModel, recycleModel } from './model_placement.js';
import { fetchImportFolders } from './model_import.js';
import { formatSize, joinPath } from './ui_model_download.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

const fileName = (rel) => String(rel).split('/').pop();
const kindName = (kind) => t(`importKind_${kind}`);
const loaderName = (kind) => t(`tidyLoader_${kind}`);

function errorText(error) {
    for (const key of [`importError_${error.code}`, `downloadError_${error.code}`]) {
        const text = t(key);
        if (text !== key) return text;
    }
    return error.message && error.code === 'unknown' ? error.message : t('importError_unknown');
}

function state(owner) {
    owner.modelTidy ||= { notes: [], deep: false, controller: null };
    return owner.modelTidy;
}

/** Opens the view on the Models page, fresh (no notes from last time). */
export function showModelTidy(owner) {
    Object.assign(state(owner), { notes: [], deep: false });
    owner.modelView = 'tidy';
    owner.goTo?.('models');
    owner.loadModels();
}

/** After a move or a removal: ComfyUI's lists, then the folders and this view again. */
async function changed(owner, note) {
    state(owner).notes.push(note);
    try {
        await app.refreshComboInNodes?.();
    } catch (error) {
        console.warn('[AMB] Tidy: could not reload the model lists.', error);
    }
    owner.loadFolders?.();
}

function misplacedRow(owner, item, folders) {
    const row = el('div', 'anomalous-download-item anomalous-tidy-row');
    const head = el('div', 'anomalous-download-head');
    head.append(el('strong', 'anomalous-download-name', fileName(item.rel)), el('span', 'anomalous-download-facts', formatSize(item.size)));
    row.append(head);
    row.append(el('div', 'anomalous-download-note', t('tidyNow', { path: `${kindName(item.type)} / ${item.rel}` })));
    row.append(el('div', 'anomalous-tidy-is', [t('tidyIs', { kind: kindName(item.kind) }), item.base].filter(Boolean).join(' · ')));
    row.append(el('div', `anomalous-download-note${item.works ? '' : ' is-warn'}`, item.works
        ? t('tidyWorks') : t('tidyBreaks', { loader: loaderName(item.type), right: loaderName(item.kind) })));

    const roots = (folders?.types?.[item.kind] || []).filter(root => root.exists);
    let root = roots.find(entry => entry.index === item.to.root) || roots[0] || { index: item.to.root, path: '' };
    const line = el('label', 'anomalous-download-where');
    line.append(el('span', 'anomalous-download-label', t('tidyMoveTo')));
    if (roots.length > 1) {
        const select = el('select', 'anomalous-download-root');
        for (const entry of roots) {
            const option = el('option', '', entry.path);
            option.value = String(entry.index);
            select.append(option);
        }
        select.value = String(root.index);
        select.onchange = () => {
            root = roots.find(entry => String(entry.index) === select.value) || root;
            showPath();
        };
        line.append(select);
    }
    const input = el('input', 'anomalous-download-rel');
    input.type = 'text';
    input.spellcheck = false;
    input.value = item.to.rel;
    const full = el('div', 'anomalous-download-path');
    const showPath = () => { full.textContent = root.path ? joinPath(root.path, input.value.trim()) : input.value.trim(); };
    input.oninput = showPath;
    showPath();
    const failure = el('div', 'anomalous-download-note is-bad');
    failure.hidden = true;
    const go = button('anomalous-scan-row-btn is-main', t('tidyMove'), async () => {
        go.disabled = true;
        failure.hidden = true;
        try {
            const moved = await moveModel(item, { type: item.kind, root: root.index, rel: input.value.trim().replace(/\\/g, '/') });
            const notes = [t('tidyMoved', { name: fileName(item.rel), path: `${kindName(moved.type)} / ${moved.rel}` })];
            if (loaderName(item.type) !== loaderName(item.kind)) notes.push(t('tidyMovedHint', { from: loaderName(item.type), to: loaderName(item.kind) }));
            if (moved.left?.length) notes.push(t('tidyLeft', { count: moved.left.length }));
            await changed(owner, notes.join(' '));
        } catch (error) {
            go.disabled = false;
            failure.textContent = errorText(error);
            failure.hidden = false;
        }
    });
    line.append(input, go);
    row.append(line, full, failure);
    return row;
}

function duplicateGroup(owner, group) {
    const box = el('div', 'anomalous-download-item anomalous-tidy-row');
    box.append(el('div', 'anomalous-download-head', t('tidyDupGroup', { count: group.files.length, size: formatSize(group.size) })));
    for (const file of group.files) {
        const line = el('div', 'anomalous-tidy-copy');
        line.append(el('span', 'anomalous-tidy-copy-path', `${kindName(file.type)} / ${file.rel}`));
        const failure = el('span', 'anomalous-download-text is-bad');
        const recycle = button('anomalous-scan-row-btn', t('tidyRecycle'), async () => {
            if (!confirm(t('tidyRecycleConfirm', { name: fileName(file.rel), count: group.files.length - 1 }))) return;
            recycle.disabled = true;
            try {
                await recycleModel(file);
                await changed(owner, t('tidyRecycled', { name: fileName(file.rel) }));
            } catch (error) {
                recycle.disabled = false;
                failure.textContent = errorText(error);
            }
        });
        line.append(recycle, failure);
        box.append(line);
    }
    return box;
}

/** Draws the view into the models grid (after the type bar). */
export function renderModelTidyView(owner, grid) {
    const view = state(owner);
    view.controller?.abort();
    const controller = new AbortController();
    view.controller = controller;
    const section = el('section', 'anomalous-tidy');
    section.append(el('h2', 'anomalous-msrc-title', t('tidyTitle')), el('p', 'anomalous-msrc-lead', t('tidyLead')));
    for (const note of view.notes) section.append(el('div', 'anomalous-tidy-note', note));
    const body = el('div', 'anomalous-tidy-body');
    body.append(el('div', 'anomalous-download-text', t(view.deep ? 'tidyDeepRunning' : 'tidyLoading')));
    section.append(body);
    grid.appendChild(section);

    Promise.all([checkPlacement(view.deep, controller.signal), fetchImportFolders().catch(() => null)]).then(([data, folders]) => {
        if (controller.signal.aborted || !section.isConnected) return;
        const parts = [];
        parts.push(el('h3', 'anomalous-tidy-heading', data.misplaced.length ? t('tidyMisplacedTitle', { count: data.misplaced.length }) : t('tidyMisplacedNone')));
        // The ones that fail to load first.
        const misplaced = [...data.misplaced].sort((a, b) => Number(a.works) - Number(b.works));
        parts.push(...misplaced.map(item => misplacedRow(owner, item, folders)));
        parts.push(el('h3', 'anomalous-tidy-heading', data.duplicates.length ? t('tidyDupTitle', { count: data.duplicates.length }) : t('tidyDupNone')));
        parts.push(...data.duplicates.map(group => duplicateGroup(owner, group)));
        if (data.unchecked?.groups) {
            const more = el('div', 'anomalous-tidy-unchecked');
            more.append(el('span', 'anomalous-download-note', t('tidyUnchecked', { groups: data.unchecked.groups, size: formatSize(data.unchecked.bytes) })),
                button('anomalous-scan-row-btn', t('tidyDeep'), () => {
                    view.deep = true;
                    owner.loadModels();
                }));
            parts.push(more);
        }
        body.replaceChildren(...parts);
    }).catch((error) => {
        if (controller.signal.aborted) return;
        console.warn('[AMB] Tidy: the check failed.', error);
        body.replaceChildren(el('div', 'anomalous-download-text is-bad', t('tidyFailed')));
    });
}
