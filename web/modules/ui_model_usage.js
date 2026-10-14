/**
 * The Tidy tab's "Not used lately" part (api/model_usage.py): models and node packs by when the
 * outputs last used them. Run on a press (it reads every output and saved workflow); the answer
 * is kept in `owner.modelUsage` while the tab is redrawn. Models picked here go to the Recycle
 * Bin (model_placement.js); node packs are only listed, ComfyUI Manager disables or removes them.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { checkUsage, recycleModel } from './model_placement.js';
import { formatSize } from './ui_model_download.js';

const DAY = 24 * 3600;
const SHOWN = 100; // rows drawn at most; the rest is counted
const FILTERS = [['30', 'tidyUsage30'], ['90', 'tidyUsage90'], ['never', 'tidyUsageNever']];
// ComfyUI lists the Manager's commands even without the Manager; its own routes tell it is there,
// and which one: the Manager 4 (ComfyUI's own command) or 3 (the command its script adds).
const MANAGERS = [
    ['/api/v2/manager/version', ['Comfy.Manager.CustomNodesManager.ShowCustomNodesMenu']],
    ['/api/manager/version', ['Comfy.Manager.CustomNodesManager.ToggleVisibility', 'Comfy.Manager.CustomNodesManager.ShowLegacyCustomNodesMenu']],
];

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

function state(owner) {
    owner.modelUsage ||= { data: null, filter: '90', picked: new Set(), running: false, error: false };
    return owner.modelUsage;
}

const keyOf = (item) => `${item.type}|${item.root}|${item.rel}`;

/** Whether `item` ({last_used, saved}) is listed under `filter` ('30' | '90' | 'never'), as of `now`. */
export function notUsedSince(item, filter, now) {
    if (filter === 'never') return !item.last_used && !item.saved;
    return !item.last_used || now - item.last_used >= Number(filter) * DAY;
}

function when(item, now) {
    if (!item.last_used) return t('tidyUsageNoOutput');
    const date = new Date(item.last_used * 1000).toLocaleDateString();
    return t('tidyUsageLast', { date, days: Math.floor((now - item.last_used) / DAY) });
}

function cover(item) {
    const box = el('div', 'anomalous-tidy-cover is-small');
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

function modelRow(view, item, now, redrawFoot) {
    const row = el('label', 'anomalous-usage-row');
    const pick = el('input');
    pick.type = 'checkbox';
    pick.checked = view.picked.has(keyOf(item));
    pick.onchange = () => {
        if (pick.checked) view.picked.add(keyOf(item));
        else view.picked.delete(keyOf(item));
        redrawFoot();
    };
    const body = el('div', 'anomalous-usage-body');
    const name = el('div', 'anomalous-tidy-name');
    name.append(el('strong', '', item.name));
    if (item.version) name.append(el('span', 'anomalous-card-version anomalous-tidy-version', item.version));
    body.append(name, el('div', 'anomalous-tidy-file', `${item.type} / ${item.rel} · ${formatSize(item.size)}`),
        el('div', 'anomalous-usage-when', when(item, now)));
    if (item.saved) body.append(el('div', 'anomalous-usage-saved', t('tidyUsageSaved', { count: item.saved })));
    row.append(pick, cover(item), body);
    return row;
}

function packRow(item, now) {
    const row = el('div', 'anomalous-usage-row is-pack');
    const body = el('div', 'anomalous-usage-body');
    body.append(el('strong', 'anomalous-usage-pack', item.name), el('div', 'anomalous-tidy-file', t('tidyUsageNodes', { count: item.nodes })),
        el('div', 'anomalous-usage-when', when(item, now)));
    if (item.saved) body.append(el('div', 'anomalous-usage-saved', t('tidyUsageSaved', { count: item.saved })));
    row.append(body);
    return row;
}

/** The commands that open the installed Manager's node pack list; null without a Manager. */
async function managerCommands() {
    for (const [url, ids] of MANAGERS) {
        try {
            if ((await fetch(url)).ok) return ids;
        } catch (_) { /* not this Manager version */ }
    }
    return null;
}

/** ComfyUI Manager's node pack list, where packs are disabled or removed; the browser steps aside for it. */
async function openManager(owner) {
    const ids = await managerCommands();
    if (!ids) {
        alert(t('tidyUsageNoManager'));
        return;
    }
    const commands = app.extensionManager?.command;
    owner.close?.();
    for (const id of ids) {
        try {
            if (commands?.commands?.some?.(command => command.id === id) === false) continue;
            await commands.execute(id);
            return;
        } catch (_) { /* not this ComfyUI's command: the next one */ }
    }
    alert(t('tidyUsageNoManager'));
}

async function run(owner) {
    const view = state(owner);
    view.running = true;
    view.error = false;
    owner.loadModels();
    try {
        view.data = await checkUsage();
        view.picked.clear();
    } catch (error) {
        console.warn('[AMB] Tidy: the usage check failed.', error);
        view.error = true;
    } finally {
        view.running = false;
        owner.loadModels();
    }
}

/** The part under the Tidy tab's checks; `onRecycled(note)` after models went to the Recycle Bin. */
export function renderUsageSection(owner, onRecycled) {
    const view = state(owner);
    const section = el('div', 'anomalous-usage');
    const head = el('div', 'anomalous-tidy-step');
    head.append(el('h3', '', t('tidyUsageTitle')));
    section.append(head, el('p', 'anomalous-tidy-why', t('tidyUsageLead')));
    if (view.running) {
        section.append(el('div', 'anomalous-download-text', t('tidyUsageRunning')));
        return section;
    }
    if (view.error) section.append(el('div', 'anomalous-download-text is-bad', t('tidyUsageFailed')));
    if (!view.data) {
        section.append(button('anomalous-scan-primary anomalous-scan-small-btn', t('tidyUsageRun'), () => run(owner)));
        return section;
    }

    const { models, packs, seen, now } = view.data;
    const chips = el('div', 'anomalous-usage-filters');
    for (const [value, key] of FILTERS) {
        const count = models.filter(item => notUsedSince(item, value, now)).length;
        const chip = button('anomalous-model-base-chip', `${t(key)} ${count}`, () => {
            view.filter = value;
            owner.loadModels();
        });
        chip.setAttribute('aria-pressed', String(view.filter === value));
        chips.append(chip);
    }
    chips.append(button('anomalous-scan-row-btn', t('tidyUsageAgain'), () => run(owner)));
    section.append(chips, el('div', 'anomalous-tidy-file', t(seen.capped ? 'tidyUsageSeenCapped' : 'tidyUsageSeen', { outputs: seen.outputs, saved: seen.saved })));

    const listed = models.filter(item => notUsedSince(item, view.filter, now)).sort((a, b) => b.size - a.size);
    const foot = el('div', 'anomalous-usage-foot');
    const recycle = button('anomalous-scan-primary anomalous-scan-small-btn', t('tidyUsageRecycle'), async () => {
        const picked = listed.filter(item => view.picked.has(keyOf(item)));
        const size = picked.reduce((sum, item) => sum + item.size, 0);
        if (!picked.length || !confirm(t('tidyUsageConfirm', { count: picked.length, size: formatSize(size) }))) return;
        recycle.disabled = true;
        const gone = [];
        try {
            for (const item of picked) {
                await recycleModel(item);
                gone.push(keyOf(item));
            }
        } catch (error) {
            console.warn('[AMB] Tidy: could not recycle a model.', error);
            alert(t('tidyUsageRecycleFailed'));
        }
        view.data.models = models.filter(item => !gone.includes(keyOf(item)));
        view.picked.clear();
        onRecycled(t('tidyUsageRecycled', { count: gone.length, size: formatSize(picked.filter(item => gone.includes(keyOf(item))).reduce((sum, item) => sum + item.size, 0)) }));
    });
    const summary = el('span', 'anomalous-download-note');
    const drawFoot = () => {
        const picked = listed.filter(item => view.picked.has(keyOf(item)));
        summary.textContent = picked.length
            ? t('tidyUsagePicked', { count: picked.length, size: formatSize(picked.reduce((sum, item) => sum + item.size, 0)) })
            : t('tidyUsagePickHint');
        recycle.disabled = !picked.length;
    };
    drawFoot();
    foot.append(summary, recycle);

    if (!listed.length) section.append(el('div', 'anomalous-tidy-done', t('tidyUsageNone')));
    else {
        section.append(...listed.slice(0, SHOWN).map(item => modelRow(view, item, now, drawFoot)));
        if (listed.length > SHOWN) {
            const rest = listed.slice(SHOWN);
            section.append(el('div', 'anomalous-tidy-file', t('tidyUsageMore', { count: rest.length, size: formatSize(rest.reduce((sum, item) => sum + item.size, 0)) })));
        }
        section.append(foot);
    }

    const packHead = el('div', 'anomalous-tidy-step');
    packHead.append(el('h3', '', t('tidyUsagePacks')));
    const packsListed = packs.filter(item => notUsedSince(item, view.filter, now));
    section.append(packHead, el('p', 'anomalous-tidy-why', t('tidyUsagePacksLead')),
        button('anomalous-scan-secondary anomalous-scan-small-btn', t('tidyUsageManager'), () => openManager(owner)));
    if (!packsListed.length) section.append(el('div', 'anomalous-tidy-done', t('tidyUsagePacksNone')));
    else section.append(...packsListed.map(item => packRow(item, now)));
    return section;
}
