/**
 * The Workflows page's Saves view: every canvas's saves in a part of its own, open or not, so those of a
 * closed tab or a deleted file are as near as any. A part folds; open, it shows each save with what it
 * changed and the pictures it made, and runs them, the whole group in order or one save alone. A save
 * can become a workflow card, the one thing it becomes (AD-023). What changes the canvas is done by the
 * bar under it (ui_snapshot_bar.js).
 */

import { translate as t } from './locales.js';
import { keepImageAsRecipe } from './recipe_save.js';
import { changeKind, runTotal } from './snapshot_plan.js';
import { runSaves, seedMode, watchSeedMode } from './snapshot_run.js';
import { findGroup, listGroups, onSavesChange, readWorkflow, removeGroup, removeSave } from './snapshot_store.js';
import { anomalousConfirm } from './ui_dialog.js';
import { showGalleryViewer } from './ui_gallery_viewer.js';
import { openPopupMenu } from './ui_popup_menu.js';
import { appendText, button } from './ui_recipe_detail_dom.js';
import { backTo, openSave, runsBox, saveWords, seedSwitch, shownKey, tabOfGroup } from './ui_snapshot_bar.js';

const PICTURES_SHOWN = 40; // of a save, the newest

const said = new Map(); // a group's key -> what its part last said: {text, bad}

function thumbUrl(picture) {
    const query = new URLSearchParams({ filename: picture.filename, subfolder: picture.subfolder });
    return picture.type === 'output' ? `/anomalous/output_thumbnail?${query}` : `/view?${query}&type=${picture.type}&preview=webp;60`;
}

function image(url, className) {
    const node = document.createElement('img');
    node.alt = '';
    node.loading = 'lazy';
    node.src = url;
    node.className = className;
    return node;
}

/** What a part's line says: the last word, else how many of its runs are left. */
function showLine(part) {
    if (!part.line) return;
    const word = said.get(part.item.key);
    part.line.textContent = word?.text || (part.left ? t('savesRunsLeft', { count: part.left }) : '');
    part.line.classList.toggle('is-bad', Boolean(word?.bad));
}

function say(owner, key, text = '', bad = false) {
    said.set(key, { text, bad });
    showLine(owner.savesParts.get(key) || {});
}

function fail(owner, key, error) {
    console.warn('[AMB] Saves:', error);
    say(owner, key, t('snapshotRefused', { why: String(error?.message || error).slice(0, 200) }), true);
}

async function run(owner, group, saves, seeds) {
    say(owner, group.key);
    const queued = await runSaves(group, saves, seeds, (text, bad) => say(owner, group.key, text, bad));
    if (queued) say(owner, group.key);
}

/** A new workflow card from `save`, the newest picture it saved as its cover. */
async function keep(owner, key, save) {
    try {
        const cover = [...save.pictures].reverse().find(picture => picture.type === 'output') || null;
        const kept = await keepImageAsRecipe(cover, { workflow: await readWorkflow(key, save.id) });
        say(owner, key, t(kept.existed ? 'snapshotKeptBefore' : 'snapshotKeptCard', { name: kept.name }));
    } catch (error) {
        fail(owner, key, error);
    }
}

/** Does `change` on the canvas, which comes to the front for it. */
async function toCanvas(owner, key, change) {
    try {
        await change();
        owner.close();
    } catch (error) {
        fail(owner, key, error);
    }
}

function saveMenu(owner, anchor, item, save, at) {
    const { key } = item;
    openPopupMenu(anchor, [
        ...(tabOfGroup(item) ? [{ label: t('snapshotGoBack'), run: () => void toCanvas(owner, key, () => backTo(item, save)) }] : []),
        { label: t('snapshotOpenTab'), run: () => void toCanvas(owner, key, () => openSave(item, save)) },
        { label: t('snapshotRemove'), danger: true, run: async () => {
            if (!await anomalousConfirm(t('snapshotRemoveConfirm', { number: at + 1 }), t('snapshotTitle'))) return;
            await removeSave(key, save.id).catch(error => fail(owner, key, error));
        } },
    ]);
}

function pictures(box, save) {
    const newest = [...save.pictures].reverse().slice(0, PICTURES_SHOWN);
    if (!newest.length) return;
    const list = appendText(box, 'div', '', 'anomalous-saves-pictures');
    for (const picture of newest) {
        const query = new URLSearchParams({ filename: picture.filename, subfolder: picture.subfolder, type: picture.type });
        const open = button(list, '', 'anomalous-saves-picture');
        open.onclick = () => showGalleryViewer(`/view?${query}`);
        open.append(image(thumbUrl(picture), ''));
    }
    if (save.pictures.length > newest.length) appendText(box, 'div', t('snapshotMorePictures', { shown: newest.length, total: save.pictures.length }), 'anomalous-saves-words');
}

function saveRow(owner, item, group, save, at) {
    const box = document.createElement('div');
    box.className = 'anomalous-saves-save';
    const row = appendText(box, 'div', '', 'anomalous-saves-save-row');
    appendText(row, 'span', String(at + 1), 'anomalous-saves-number');
    row.append(runsBox(group.key, save));
    const when = new Date(save.at * 1000).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const kind = at === 0 ? '' : ` · ${t(`snapshotKind_${changeKind(save.changes)}`)}`;
    const words = appendText(row, 'div', `${when}${kind}${save.pictures.length || save.running ? '' : ` · ${t('snapshotNoPictures')}`}`, 'anomalous-saves-words');
    if (at > 0 && save.changes.length) words.append('\n', saveWords(save, at));
    const go = button(row, t('savesRunOne'), 'anomalous-wf-filter');
    go.title = t('savesRunOneHint', { count: save.count });
    go.onclick = () => void run(owner, group, [save], 'random');
    button(row, t('snapshotKeepCard'), 'anomalous-wf-filter').onclick = () => void keep(owner, group.key, save);
    const more = button(row, '⋯', 'anomalous-wf-icon-btn');
    more.title = t('notebookMore');
    more.onclick = () => saveMenu(owner, more, item, save, at);
    pictures(box, save);
    return box;
}

function foldButton(owner, part, open) {
    const { item } = part;
    const name = item.title || t('recipeUntitled');
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'anomalous-saves-fold';
    fold.title = name;
    fold.setAttribute('aria-expanded', String(open));
    appendText(fold, 'span', open ? '▾' : '▸', 'anomalous-saves-mark');
    if (item.cover) fold.append(image(thumbUrl(item.cover), 'anomalous-saves-cover'));
    else appendText(fold, 'span', '', 'anomalous-saves-cover');
    appendText(fold, 'span', name, 'anomalous-saves-name');
    const canvas = tabOfGroup(item);
    appendText(fold, 'span', t(canvas ? 'savesListCanvasOpen' : 'savesListCanvasClosed'), `anomalous-saves-tag${canvas ? ' is-open' : ''}`);
    const when = new Date(item.updated * 1000).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    appendText(fold, 'span', `${t('savesListCount', { count: item.count })} · ${when}`, 'anomalous-saves-meta');
    fold.onclick = () => {
        if (open) owner.savesOpen.delete(item.key);
        else owner.savesOpen.add(item.key);
        void (open ? drawPart(owner, part, null) : openPart(owner, part));
    };
    return fold;
}

/** `part` as `group` stands, or folded with none. */
function drawPart(owner, part, group) {
    const { box, item } = part;
    const head = document.createElement('div');
    head.className = 'anomalous-saves-head';
    head.append(foldButton(owner, part, Boolean(group)));
    part.left = group?.saves.reduce((sum, save) => sum + save.running, 0) || 0;
    part.line = null;
    if (!group) return void box.replaceChildren(head);
    head.append(seedSwitch());
    const go = button(head, t('snapshotRun', { count: runTotal(group.saves) }), 'anomalous-snapshot-run');
    go.onclick = () => void run(owner, group, group.saves, seedMode());
    const remove = button(head, t('savesListRemove'), 'anomalous-wf-filter');
    remove.onclick = async () => {
        if (!await anomalousConfirm(t('savesListRemoveConfirm', { name: item.title || t('recipeUntitled'), count: item.count }))) return;
        await removeGroup(item.key).catch(error => fail(owner, item.key, error));
    };
    part.line = document.createElement('div');
    part.line.className = 'anomalous-saves-status';
    showLine(part);
    box.replaceChildren(head, part.line, ...group.saves.map((save, at) => saveRow(owner, item, group, save, at)));
}

async function openPart(owner, part) {
    try {
        drawPart(owner, part, await findGroup(part.item.key, ''));
    } catch (error) {
        console.warn('[AMB] Saves:', error);
    }
}

function setView(owner, on) {
    if (!owner.savesList) {
        owner.savesList = document.createElement('div');
        owner.savesList.className = 'anomalous-wf-list anomalous-saves-list';
        owner.recipeView.append(owner.savesList);
    }
    owner.savesListOn = on;
    owner.savesToggle.classList.toggle('is-on', on);
    owner.recipeView.classList.toggle('is-saves', on);
    if (on && shownKey()) owner.savesOpen.add(shownKey());
}

/** The view as the saves stand now, when it is on. */
export async function refreshSaves(owner) {
    const wanted = owner.savesWanted;
    owner.savesWanted = '';
    if (wanted) {
        setView(owner, true);
        owner.savesOpen.add(wanted);
    }
    if (!owner.savesListOn) return;
    const list = owner.savesList;
    const reading = owner.savesReading = {};
    try {
        const groups = await listGroups();
        if (reading !== owner.savesReading) return;
        said.clear();
        owner.savesParts = new Map(groups.map(item => [item.key, { item, box: document.createElement('section') }]));
        const parts = [...owner.savesParts.values()];
        for (const part of parts) {
            part.box.className = 'anomalous-saves-part';
            drawPart(owner, part, null);
        }
        list.replaceChildren(...parts.map(part => part.box));
        if (!groups.length) appendText(list, 'p', t('savesListEmpty'), 'anomalous-recipe-empty');
        await Promise.all(parts.filter(part => owner.savesOpen.has(part.item.key)).map(part => openPart(owner, part)));
        owner.savesParts.get(wanted)?.box.scrollIntoView({ block: 'start' });
    } catch (error) {
        console.error('Could not list the saves:', error);
        list.replaceChildren();
        appendText(list, 'p', t('savesListFailed'), 'anomalous-recipe-empty');
    }
}

/** A group changed: its part shows it; a new one or one gone changes the list. */
function groupChanged(owner, key, group) {
    if (!owner.savesListOn) return;
    const part = owner.savesParts.get(key);
    if (!part || !group) return void refreshSaves(owner);
    part.item.count = group.saves.length;
    part.item.cover = group.saves.flatMap(save => save.pictures).at(-1) || null;
    if (owner.savesOpen.has(key)) drawPart(owner, part, group);
    else drawPart(owner, part, null);
}

/** The Workflows page with `key`'s part open: the bar's way here. */
export function showSaves(key) {
    this.savesWanted = key;
    this.show({ page: 'recipes' });
}

/** The bar's button between the workflow cards and the saves. */
export function savesToggle(owner) {
    owner.savesOpen = new Set();
    owner.savesParts = new Map();
    owner.savesToggle = document.createElement('button');
    owner.savesToggle.type = 'button';
    owner.savesToggle.className = 'anomalous-wf-filter anomalous-wf-saves-toggle';
    owner.savesToggle.textContent = t('savesListToggle');
    owner.savesToggle.onclick = () => {
        setView(owner, !owner.savesListOn);
        // Back on the cards: one kept here may be new to them.
        void (owner.savesListOn ? refreshSaves(owner) : owner.refreshRecipes());
    };
    onSavesChange((key, group) => groupChanged(owner, key, group));
    watchSeedMode(() => {
        for (const part of owner.savesParts.values()) {
            if (owner.savesOpen.has(part.item.key)) void openPart(owner, part);
        }
    });
    return owner.savesToggle;
}
