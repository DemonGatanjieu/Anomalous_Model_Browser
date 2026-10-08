/**
 * The models page's Tidy tab (`owner.modelView === 'tidy'`): two steps, each a list of cards
 * with the model's cover and name. Step 1, models in a folder whose loader cannot read them:
 * from (red) → to (green), one plain reason, "Move there" (the place can be changed). Step 2,
 * identical files side by side: the copy to keep is marked (the one in the folder that fits,
 * changeable by clicking another), "Recycle the extra copies". Models that load where they
 * are anyway, or an extra copy of a file in the right folder (step 2 has it), are not listed
 * in step 1. Nothing changes without a press; after one the tab checks again
 * and keeps a note of what was done (`owner.modelTidy.notes`). model_placement.js does the
 * requests.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { checkPlacement, moveModel, recycleModel, tidyMisplaced } from './model_placement.js';
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
const folderOf = (rel) => String(rel).split('/').slice(0, -1).join('/');
const kindName = (kind) => t(`importKind_${kind}`);
const loaderName = (kind) => t(`tidyLoader_${kind}`);
const place = (kind, rel) => [kindName(kind), folderOf(rel)].filter(Boolean).join(' / ');

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

/** Opens the tab, fresh (no notes from last time). */
export function showModelTidy(owner) {
    Object.assign(state(owner), { notes: [], deep: false });
    owner.modelView = 'tidy';
    owner.goTo?.('models');
    owner.loadModels();
}

/** After a move or a removal: ComfyUI's lists, then the folders and this tab again. */
async function changed(owner, note) {
    state(owner).notes.push(note);
    try {
        await app.refreshComboInNodes?.();
    } catch (error) {
        console.warn('[AMB] Tidy: could not reload the model lists.', error);
    }
    owner.loadFolders?.();
}

/** A model's cover (a video's still frame), or a placeholder. */
function cover(item, className = 'anomalous-tidy-cover') {
    const box = el('div', className);
    if (item.preview_url) {
        const image = el('img');
        image.loading = 'lazy';
        image.alt = '';
        image.src = `${item.preview_url}&variant=${/\.(mp4|webm|mov|avi)(&|$)/i.test(item.preview_url) ? 'poster' : 'card'}`;
        box.append(image);
    } else {
        box.append(el('span', 'anomalous-tidy-cover-none', t('noPreview')));
    }
    return box;
}

function title(item) {
    const line = el('div', 'anomalous-tidy-name');
    line.append(el('strong', '', item.name));
    if (item.version) line.append(el('span', 'anomalous-card-version anomalous-tidy-version', item.version));
    return line;
}

function misplacedCard(owner, item, folders) {
    const card = el('div', 'anomalous-tidy-card');
    const body = el('div', 'anomalous-tidy-body');
    body.append(title(item), el('div', 'anomalous-tidy-file', `${fileName(item.rel)} · ${formatSize(item.size)}`));

    const roots = (folders?.types?.[item.kind] || []).filter(root => root.exists);
    let root = roots.find(entry => entry.index === item.to.root) || roots[0] || { index: item.to.root, path: '' };
    let rel = item.to.rel;
    const route = el('div', 'anomalous-tidy-route');
    const to = el('span', 'anomalous-tidy-place is-to', place(item.kind, rel));
    route.append(el('span', 'anomalous-tidy-place is-from', place(item.type, item.rel)), el('span', 'anomalous-tidy-arrow', '→'), to);
    body.append(route, el('div', 'anomalous-tidy-why', t(`tidyWhy_${item.kind}`) === `tidyWhy_${item.kind}`
        ? t('tidyBreaks', { loader: loaderName(item.type), right: loaderName(item.kind) })
        : t(`tidyWhy_${item.kind}`, { loader: loaderName(item.type), right: loaderName(item.kind) })));

    // Where exactly: folded behind "Change place".
    const where = el('div', 'anomalous-tidy-where');
    where.hidden = true;
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
        where.append(select);
    }
    const input = el('input', 'anomalous-download-rel');
    input.type = 'text';
    input.spellcheck = false;
    input.value = rel;
    const full = el('div', 'anomalous-download-path');
    const showPath = () => {
        rel = input.value.trim().replace(/\\/g, '/');
        to.textContent = place(item.kind, rel);
        full.textContent = root.path ? joinPath(root.path, rel) : rel;
    };
    input.oninput = showPath;
    showPath();
    where.append(input, full);

    const failure = el('div', 'anomalous-download-note is-bad');
    failure.hidden = true;
    const actions = el('div', 'anomalous-tidy-actions');
    const go = button('anomalous-scan-primary anomalous-scan-small-btn', t('tidyMove'), async () => {
        go.disabled = true;
        failure.hidden = true;
        try {
            const moved = await moveModel(item, { type: item.kind, root: root.index, rel });
            const notes = [t('tidyMoved', { name: item.name, path: place(moved.type, moved.rel) })];
            if (loaderName(item.type) !== loaderName(item.kind)) notes.push(t('tidyMovedHint', { from: loaderName(item.type), to: loaderName(item.kind) }));
            if (moved.left?.length) notes.push(t('tidyLeft', { count: moved.left.length }));
            await changed(owner, notes.join(' '));
        } catch (error) {
            go.disabled = false;
            failure.textContent = errorText(error);
            failure.hidden = false;
        }
    });
    const change = button('anomalous-download-rules', t('tidyChangePlace'), () => {
        where.hidden = !where.hidden;
        if (!where.hidden) input.focus();
    });
    actions.append(go, change);
    body.append(where, actions, failure);
    card.append(cover(item), body);
    return card;
}

function duplicateCard(owner, group) {
    const card = el('div', 'anomalous-tidy-card is-group');
    let keep = group.files.find(file => file.fits) || group.files[0];
    const copies = el('div', 'anomalous-tidy-copies');
    const draw = () => copies.replaceChildren(...group.files.map(file => {
        const copy = button(`anomalous-tidy-copy${file === keep ? ' is-kept' : ''}`, '', () => {
            keep = file;
            draw();
        });
        copy.setAttribute('aria-pressed', String(file === keep));
        copy.append(cover(file, 'anomalous-tidy-cover is-small'),
            el('span', 'anomalous-tidy-copy-place', place(file.type, file.rel)),
            el('span', 'anomalous-tidy-copy-file', fileName(file.rel)),
            el('span', `anomalous-tidy-copy-tag${file === keep ? ' is-kept' : ''}`, t(file === keep ? 'tidyKeep' : 'tidyExtra')));
        return copy;
    }));
    draw();
    const body = el('div', 'anomalous-tidy-body');
    body.append(title(group.files[0]),
        el('div', 'anomalous-tidy-file', t('tidyDupGroup', { count: group.files.length, size: formatSize(group.size) })),
        el('div', 'anomalous-tidy-why', t('tidyDupWhy')), copies);
    const failure = el('div', 'anomalous-download-note is-bad');
    failure.hidden = true;
    const go = button('anomalous-scan-primary anomalous-scan-small-btn', t('tidyRecycleExtra', { count: group.files.length - 1 }), async () => {
        const extra = group.files.filter(file => file !== keep);
        if (!confirm(t('tidyRecycleConfirm', { count: extra.length, size: formatSize(group.size * extra.length), keep: place(keep.type, keep.rel) }))) return;
        go.disabled = true;
        failure.hidden = true;
        try {
            for (const file of extra) await recycleModel(file);
            await changed(owner, t('tidyRecycled', { count: extra.length, size: formatSize(group.size * extra.length) }));
        } catch (error) {
            go.disabled = false;
            failure.textContent = errorText(error);
            failure.hidden = false;
        }
    });
    const actions = el('div', 'anomalous-tidy-actions');
    actions.append(go);
    body.append(actions, failure);
    card.append(body);
    return card;
}

function step(number, titleKey, count) {
    const head = el('div', 'anomalous-tidy-step');
    head.append(el('span', 'anomalous-tidy-step-number', String(number)), el('h3', '', t(titleKey, { count })));
    return head;
}

/** Draws the tab into the models grid (after the page's tabs). */
export function renderModelTidyView(owner, grid) {
    const view = state(owner);
    view.controller?.abort();
    const controller = new AbortController();
    view.controller = controller;
    const section = el('section', 'anomalous-tidy');
    section.append(el('p', 'anomalous-tidy-lead', t('tidyLead')));
    for (const note of view.notes) section.append(el('div', 'anomalous-tidy-note', note));
    const body = el('div', 'anomalous-tidy-list');
    body.append(el('div', 'anomalous-download-text', t(view.deep ? 'tidyDeepRunning' : 'tidyLoading')));
    section.append(body);
    grid.appendChild(section);

    Promise.all([checkPlacement(view.deep, controller.signal), fetchImportFolders().catch(() => null)]).then(([data, folders]) => {
        if (controller.signal.aborted || !section.isConnected) return;
        const misplaced = tidyMisplaced(data);
        const parts = [];
        if (!misplaced.length && !data.duplicates.length) {
            const done = el('div', 'anomalous-tidy-done');
            done.append(el('strong', '', t('tidyAllGood')), el('span', '', t('tidyChecked', { count: data.checked })));
            parts.push(done);
        }
        if (misplaced.length) {
            parts.push(step(1, 'tidyStepMisplaced', misplaced.length), ...misplaced.map(item => misplacedCard(owner, item, folders)));
        }
        if (data.duplicates.length) {
            parts.push(step(misplaced.length ? 2 : 1, 'tidyStepDuplicates', data.duplicates.length), ...data.duplicates.map(group => duplicateCard(owner, group)));
        }
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
