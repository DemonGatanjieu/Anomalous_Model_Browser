/**
 * Settings → Node packs: the node packs not used lately (usage_view.js runs the check). Packs
 * are only listed, each with a way into ComfyUI Manager, which disables or removes them. Packs
 * that also add to the page are set apart: their nodes going unused does not say the pack is.
 * A pack the user says they still use ("I still use it") leaves the groups for a list of its own.
 */

import { app } from "../../../scripts/app.js";
import { translate as t } from './locales.js';
import { keepPack } from './model_placement.js';
import { button, daysSince, el, lastUsed, notUsedSince, usageSection } from './usage_view.js';

// ComfyUI lists the Manager's commands even without the Manager; its own routes tell it is there,
// and which one: the Manager 4 (ComfyUI's own command) or 3 (the command its script adds, whose
// node list has a search box this page can fill).
const MANAGERS = [
    ['/api/v2/manager/version', ['Comfy.Manager.CustomNodesManager.ShowCustomNodesMenu'], null],
    ['/api/manager/version', ['Comfy.Manager.CustomNodesManager.ToggleVisibility', 'Comfy.Manager.CustomNodesManager.ShowLegacyCustomNodesMenu'], 'input.cn-manager-keywords'],
];
const SEARCH_WAIT_MS = 6000;

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
export async function openManager(owner, pack) {
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

function packRow(owner, item, now, redraw) {
    const row = el('div', 'anomalous-usage-row is-pack');
    const body = el('div', 'anomalous-usage-body');
    const facts = [item.nodes ? t('tidyUsageNodes', { count: item.nodes }) : t('tidyUsageNoNodes')];
    if (item.added) facts.push(t('tidyUsageInstalled', { days: daysSince(item.added, now) }));
    body.append(el('strong', 'anomalous-usage-pack', item.name), el('div', 'anomalous-tidy-file', facts.join(' · ')));
    if (item.nodes) body.append(el('div', 'anomalous-usage-when', lastUsed(item, now)));
    if (item.saved) body.append(el('div', 'anomalous-usage-saved', t('tidyUsageSaved', { count: item.saved })));
    if (item.feeds?.length) body.append(el('div', 'anomalous-usage-saved', t('tidyUsageFeeds', { packs: item.feeds.join(', ') })));
    const actions = el('div', 'anomalous-usage-actions');
    const mark = button('anomalous-scan-row-btn', t(item.kept ? 'tidyUsageUnkeep' : 'tidyUsageKeep'), async () => {
        mark.disabled = true;
        try {
            await keepPack(item.name, !item.kept);
            item.kept = !item.kept;
            redraw();
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

function packGroups(owner, section, view, redraw) {
    const { packs, now } = view.data;
    const rows = (items) => items.map(item => packRow(owner, item, now, redraw));
    const group = (titleKey, leadKey, items) => {
        const head = el('div', 'anomalous-tidy-step');
        head.append(el('h3', '', t(titleKey)));
        section.append(head, el('p', 'anomalous-tidy-why', t(leadKey)), ...rows(items));
    };
    const idle = packs.filter(item => item.nodes && !item.kept && notUsedSince(item, view.filter, now));
    const nodesOnly = idle.filter(item => !item.web);
    section.append(el('p', 'anomalous-tidy-why', t('tidyUsagePacksLead')));
    if (!nodesOnly.length) section.append(el('div', 'anomalous-tidy-done', t('tidyUsagePacksNone')));
    else section.append(...rows(nodesOnly));
    const withPage = idle.filter(item => item.web);
    if (withPage.length) group('tidyUsageUiPacks', 'tidyUsageUiPacksLead', withPage);
    const pageOnly = packs.filter(item => !item.nodes && !item.kept);
    if (pageOnly.length) group('tidyUsagePageOnly', 'tidyUsagePageOnlyLead', pageOnly);
    const kept = packs.filter(item => item.kept);
    if (kept.length) group('tidyUsageKept', 'tidyUsageKeptLead', kept);
}

/** Settings → Node packs; `redraw()` draws the settings page again. */
export function renderPackUsage(owner, redraw) {
    return usageSection(owner, {
        titleKey: 'tidyUsagePacksTitle', leadKey: 'tidyUsageLead', redraw,
        body: (section, view) => packGroups(owner, section, view, redraw),
    });
}
