/**
 * The Workflows page's Saves view: every canvas's saves, open or not, so those of a closed tab or a
 * deleted file can be found again or cleared. Opening one goes to its tab, or with its canvas gone
 * lays its newest save on a new tab, where the group goes on (AD-023). The saves themselves are
 * worked on in the bar under the canvas (ui_snapshot_bar.js).
 */

import { translate as t } from './locales.js';
import { forgetGroup, openGroup, tabOfGroup } from './ui_snapshot_bar.js';
import { listGroups, removeGroup } from './snapshot_store.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { appendText } from './ui_recipe_detail_dom.js';

function thumbUrl(picture) {
    const query = new URLSearchParams({ filename: picture.filename, subfolder: picture.subfolder });
    return picture.type === 'output' ? `/anomalous/output_thumbnail?${query}` : `/view?${query}&type=${picture.type}&preview=webp;60`;
}

function card(owner, item) {
    const name = item.title || t('recipeUntitled');
    const box = document.createElement('article');
    box.className = 'anomalous-wf-card anomalous-saves-card';
    box.title = name;
    const cover = document.createElement('div');
    cover.className = 'anomalous-wf-cover';
    if (item.cover) {
        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.src = thumbUrl(item.cover);
        cover.append(image);
    }
    const info = document.createElement('div');
    info.className = 'anomalous-wf-info';
    appendText(info, 'h3', name, 'anomalous-wf-title');
    const when = new Date(item.updated * 1000).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const state = t(tabOfGroup(item) ? 'savesListCanvasOpen' : 'savesListCanvasClosed');
    appendText(info, 'div', `${t('savesListCount', { count: item.count })} · ${when} · ${state}`, 'anomalous-wf-meta');
    const row = document.createElement('div');
    row.className = 'anomalous-saves-row';
    const open = appendText(row, 'button', t('savesListOpen'), 'anomalous-wf-filter');
    open.type = 'button';
    open.onclick = async (event) => {
        event.stopPropagation();
        await openGroup(item);
        owner.close?.();
    };
    const remove = appendText(row, 'button', t('savesListRemove'), 'anomalous-wf-filter');
    remove.type = 'button';
    remove.onclick = async (event) => {
        event.stopPropagation();
        if (!await anomalousConfirm(t('savesListRemoveConfirm', { name, count: item.count }))) return;
        try {
            await removeGroup(item.key);
            forgetGroup(item.key);
            await refreshSaves(owner);
        } catch (error) {
            await anomalousAlert(String(error?.message || error));
        }
    };
    info.append(row);
    box.append(cover, info);
    box.onclick = () => open.click();
    return box;
}

/** The list as the saves stand now, when the view is on. */
export async function refreshSaves(owner) {
    if (!owner.savesListOn) return;
    const list = owner.savesList;
    try {
        const groups = await listGroups();
        list.replaceChildren(...groups.map(item => card(owner, item)));
        if (!groups.length) appendText(list, 'p', t('savesListEmpty'), 'anomalous-recipe-empty');
    } catch (error) {
        console.error('Could not list the saves:', error);
        list.replaceChildren();
        appendText(list, 'p', t('savesListFailed'), 'anomalous-recipe-empty');
    }
}

/** The bar's button between the workflow cards and the saves. */
export function savesToggle(owner) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'anomalous-wf-filter anomalous-wf-saves-toggle';
    toggle.textContent = t('savesListToggle');
    toggle.onclick = () => {
        if (!owner.savesList) {
            owner.savesList = document.createElement('div');
            owner.savesList.className = 'anomalous-wf-list is-grid anomalous-saves-list';
            owner.recipeView.append(owner.savesList);
        }
        owner.savesListOn = !owner.savesListOn;
        toggle.classList.toggle('is-on', owner.savesListOn);
        owner.recipeView.classList.toggle('is-saves', owner.savesListOn);
        void refreshSaves(owner);
    };
    return toggle;
}
