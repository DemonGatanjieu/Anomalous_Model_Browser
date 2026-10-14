/**
 * The Tidy tab's "Not used lately" part (api/model_usage.py): models and node packs by when they
 * were last used (the run record, outputs and saved workflows). Run on a press (it reads every
 * output and saved workflow); the answer is kept in `owner.modelUsage` while the tab is redrawn.
 * Two pages: models, picked here, go to the Recycle Bin (model_placement.js); node packs are only
 * listed, each with a way into ComfyUI Manager, which disables or removes them. Packs that also
 * add to the page are set apart: their nodes going unused does not say the pack is. A pack the
 * user says they still use ("I still use it") leaves the groups for a list of its own.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { checkUsage, keepPack, recycleModel } from './model_placement.js';
import { formatSize } from './ui_model_download.js';
import { noteOpenWorkflows } from './usage_notes.js';

const DAY = 24 * 3600;
const NEVER_DAYS = 30; // "never used" only for what has been here this long
const SHOWN = 100; // rows drawn at most; the rest is counted
const FILTERS = [['30', 'tidyUsage30'], ['90', 'tidyUsage90'], ['never', 'tidyUsageNever']];
// ComfyUI lists the Manager's commands even without the Manager; its own routes tell it is there,
// and which one: the Manager 4 (ComfyUI's own command) or 3 (the command its script adds, whose
// node list has a search box this page can fill).
const MANAGERS = [
    ['/api/v2/manager/version', ['Comfy.Manager.CustomNodesManager.ShowCustomNodesMenu'], null],
    ['/api/manager/version', ['Comfy.Manager.CustomNodesManager.ToggleVisibility', 'Comfy.Manager.CustomNodesManager.ShowLegacyCustomNodesMenu'], 'input.cn-manager-keywords'],
];
const SEARCH_WAIT_MS = 6000;

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
    owner.modelUsage ||= { data: null, filter: '90', page: 'models', picked: new Set(), running: false, error: false };
    return owner.modelUsage;
}

const keyOf = (item) => `${item.type}|${item.root}|${item.rel}`;
const daysSince = (seconds, now) => Math.floor((now - seconds) / DAY);
const threshold = (filter) => (filter === 'never' ? NEVER_DAYS : Number(filter)) * DAY;

/** Whether `item` ({last_used, saved, added}) is listed under `filter` ('30' | '90' | 'never'), as
 * of `now`: idle since its last use or its arrival, whichever is later; nothing new is judged. */
export function notUsedSince(item, filter, now) {
    const since = Math.max(item.last_used || 0, item.added || 0);
    if (now - since < threshold(filter)) return false;
    return filter !== 'never' || (!item.last_used && !item.saved);
}

function when(item, now) {
    if (!item.last_used) return t('tidyUsageNoOutput');
    const date = new Date(item.last_used * 1000).toLocaleDateString();
    return t('tidyUsageLast', { date, days: daysSince(item.last_used, now) });
}

/** What the run record can vouch for under `filter`: a line, a warning while it is younger than that. */
function ledgerNote(since, filter, now) {
    if (!since) return el('div', 'anomalous-usage-ledger is-short', t('tidyUsageLedgerNone'));
    const values = { date: new Date(since * 1000).toLocaleDateString(), days: daysSince(since, now) };
    const short = now - since < threshold(filter);
    return el('div', `anomalous-usage-ledger${short ? ' is-short' : ''}`, t(short ? 'tidyUsageLedgerShort' : 'tidyUsageLedger', values));
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

function packRow(owner, item, now) {
    const row = el('div', 'anomalous-usage-row is-pack');
    const body = el('div', 'anomalous-usage-body');
    const facts = [item.nodes ? t('tidyUsageNodes', { count: item.nodes }) : t('tidyUsageNoNodes')];
    if (item.added) facts.push(t('tidyUsageInstalled', { days: daysSince(item.added, now) }));
    body.append(el('strong', 'anomalous-usage-pack', item.name), el('div', 'anomalous-tidy-file', facts.join(' · ')));
    if (item.nodes) body.append(el('div', 'anomalous-usage-when', when(item, now)));
    if (item.saved) body.append(el('div', 'anomalous-usage-saved', t('tidyUsageSaved', { count: item.saved })));
    if (item.feeds?.length) body.append(el('div', 'anomalous-usage-saved', t('tidyUsageFeeds', { packs: item.feeds.join(', ') })));
    const actions = el('div', 'anomalous-usage-actions');
    const mark = button('anomalous-scan-row-btn', t(item.kept ? 'tidyUsageUnkeep' : 'tidyUsageKeep'), async () => {
        mark.disabled = true;
        try {
            await keepPack(item.name, !item.kept);
            item.kept = !item.kept;
            owner.loadModels();
        } catch (error) {
            console.warn('[AMB] Tidy: could not mark a node pack.', error);
            alert(t('tidyUsageKeepFailed'));
            mark.disabled = false;
        }
    });
    actions.append(mark);
    if (!item.kept) actions.append(button('anomalous-scan-row-btn', t('tidyUsageFind'), () => openManager(owner, item)));
    row.append(body, actions);
    return row;
}

/** The installed Manager: { ids: commands opening its node pack list, search: its search box } or null. */
async function findManager() {
    for (const [url, ids, search] of MANAGERS) {
        try {
            if ((await fetch(url)).ok) return { ids, search };
        } catch (_) { /* not this Manager version */ }
    }
    return null;
}

/** Types `words` into the Manager's search box once its node list shows; false when it never does. */
async function searchManager(selector, words) {
    const until = Date.now() + SEARCH_WAIT_MS;
    while (Date.now() < until) {
        const box = [...document.querySelectorAll(selector)].find(node => node.offsetParent !== null);
        if (box) {
            box.value = words;
            box.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    return false;
}

/** ComfyUI Manager's node pack list, searched for `pack` where the Manager allows it (its name
 * is also copied, to paste where it does not); the browser steps aside for it. */
async function openManager(owner, pack) {
    const manager = await findManager();
    if (!manager) {
        alert(t('tidyUsageNoManager'));
        return;
    }
    try {
        await navigator.clipboard?.writeText(pack.name);
    } catch (_) { /* no clipboard here: the name is on the page */ }
    const commands = app.extensionManager?.command;
    owner.close?.();
    for (const id of manager.ids) {
        try {
            if (commands?.commands?.some?.(command => command.id === id) === false) continue;
            await commands.execute(id);
            if (manager.search) await searchManager(manager.search, pack.words || pack.name);
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
        await noteOpenWorkflows();
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

function chip(label, pressed, onClick) {
    const node = button('anomalous-model-base-chip', label, onClick);
    node.setAttribute('aria-pressed', String(pressed));
    return node;
}

function modelsPage(view, onRecycled) {
    const { models, now } = view.data;
    const page = document.createDocumentFragment();
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

    if (!listed.length) page.append(el('div', 'anomalous-tidy-done', t('tidyUsageNone')));
    else {
        page.append(...listed.slice(0, SHOWN).map(item => modelRow(view, item, now, drawFoot)));
        if (listed.length > SHOWN) {
            const rest = listed.slice(SHOWN);
            page.append(el('div', 'anomalous-tidy-file', t('tidyUsageMore', { count: rest.length, size: formatSize(rest.reduce((sum, item) => sum + item.size, 0)) })));
        }
        page.append(foot);
    }
    return page;
}

function packsPage(owner, view) {
    const { packs, now } = view.data;
    const page = document.createDocumentFragment();
    const idle = packs.filter(item => item.nodes && !item.kept && notUsedSince(item, view.filter, now));
    const group = (titleKey, leadKey, items) => {
        const head = el('div', 'anomalous-tidy-step');
        head.append(el('h3', '', t(titleKey)));
        page.append(head, el('p', 'anomalous-tidy-why', t(leadKey)), ...items.map(item => packRow(owner, item, now)));
    };
    const nodesOnly = idle.filter(item => !item.web);
    page.append(el('p', 'anomalous-tidy-why', t('tidyUsagePacksLead')));
    if (!nodesOnly.length) page.append(el('div', 'anomalous-tidy-done', t('tidyUsagePacksNone')));
    else page.append(...nodesOnly.map(item => packRow(owner, item, now)));
    const withPage = idle.filter(item => item.web);
    if (withPage.length) group('tidyUsageUiPacks', 'tidyUsageUiPacksLead', withPage);
    const pageOnly = packs.filter(item => !item.nodes && !item.kept);
    if (pageOnly.length) group('tidyUsagePageOnly', 'tidyUsagePageOnlyLead', pageOnly);
    const kept = packs.filter(item => item.kept);
    if (kept.length) group('tidyUsageKept', 'tidyUsageKeptLead', kept);
    return page;
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

    const { models, packs, seen, now, ledger_since: since } = view.data;
    const redraw = () => owner.loadModels();
    const counted = (list) => list.filter(item => notUsedSince(item, view.filter, now)).length;
    const pages = el('div', 'anomalous-usage-filters');
    pages.append(
        chip(`${t('tidyUsageModels')} ${counted(models)}`, view.page === 'models', () => { view.page = 'models'; redraw(); }),
        chip(`${t('tidyUsagePacks')} ${counted(packs.filter(item => item.nodes && !item.web && !item.kept))}`, view.page === 'packs', () => { view.page = 'packs'; redraw(); }));
    const filters = el('div', 'anomalous-usage-filters');
    for (const [value, key] of FILTERS) {
        filters.append(chip(t(key), view.filter === value, () => { view.filter = value; redraw(); }));
    }
    filters.append(button('anomalous-scan-row-btn', t('tidyUsageAgain'), () => run(owner)));
    section.append(pages, filters, ledgerNote(since, view.filter, now),
        el('div', 'anomalous-tidy-file', t(seen.capped ? 'tidyUsageSeenCapped' : 'tidyUsageSeen', { outputs: seen.outputs, saved: seen.saved })),
        view.page === 'packs' ? packsPage(owner, view) : modelsPage(view, onRecycled));
    return section;
}
