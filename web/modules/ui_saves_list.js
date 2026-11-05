/**
 * The Workflows page's Saves view: every canvas's saves in a part of its own, open or not, so those of a
 * closed tab or a deleted file are as near as any. A part folds; open, it shows each save as a card, what
 * it changed beside the pictures it made (ui_saves_pictures.js), and runs them, the whole group in order
 * or one save alone. A save can become a workflow card, the one thing it becomes (AD-023). What changes
 * the canvas is done by the bar under it (ui_snapshot_bar.js).
 */

import { diffSnapshots, snapshotGraph } from './activity_diff.js';
import { readDetached } from './detached_graph.js';
import { translate as t } from './locales.js';
import { keepImageAsRecipe } from './recipe_save.js';
import { changeKind, runTotal } from './snapshot_plan.js';
import { runSaves, seedMode, watchSeedMode } from './snapshot_run.js';
import { findGroup, listGroups, onSavesChange, readWorkflow, removeGroup, removeSave } from './snapshot_store.js';
import { anomalousConfirm } from './ui_dialog.js';
import { settle } from './ui_dom.js';
import { openPopupMenu } from './ui_popup_menu.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { appendText, button } from './ui_recipe_detail_dom.js';
import { closeSaveGallery, fillLines, image, openSaveGallery, pictureLine, thumbUrl } from './ui_saves_pictures.js';
import { backTo, openSave, runsBox, saveWords, seedSwitch, shownKey, tabOfGroup } from './ui_snapshot_bar.js';

const refused = new Map(); // a group's key -> why its part's last try did not go

/** A part's line, there only while something went wrong: nothing else moves its saves down. */
function showLine(part) {
    if (part.line) part.line.textContent = refused.get(part.item.key) || '';
}

function refuse(owner, key, text = '') {
    refused.set(key, text);
    showLine(owner.savesParts.get(key) || {});
}

function fail(owner, key, error) {
    console.warn('[AMB] Saves:', error);
    refuse(owner, key, t('snapshotRefused', { why: String(error?.message || error).slice(0, 200) }));
}

/** How it goes shows on the saves themselves, as their runs are noted. */
async function run(owner, group, saves, seeds) {
    refuse(owner, group.key);
    await runSaves(group, saves, seeds, (text, bad) => { if (bad) refuse(owner, group.key, text); });
}

/** A new workflow card from `save`, the newest picture it saved as its cover. */
async function keep(owner, key, save) {
    try {
        const cover = [...save.pictures].reverse().find(picture => picture.type === 'output') || null;
        const kept = await keepImageAsRecipe(cover, { workflow: await readWorkflow(key, save.id) });
        showWorkbenchToast(t(kept.existed ? 'snapshotKeptBefore' : 'snapshotKeptCard', { name: kept.name }));
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

/** What the pictures of the save at `at` are called, where they are shown together. */
const placeOf = (item, at) => ({ key: item.key, name: item.title || t('recipeUntitled'), number: at + 1 });

/** Removes the save at `at`; the one after it then says what it changes from the one before that. */
async function remove(group, at) {
    const { key, saves } = group;
    const [before, after] = [saves[at - 1], saves[at + 1]];
    const changes = before && after ? diffSnapshots(readDetached(await readWorkflow(key, before.id), snapshotGraph), readDetached(await readWorkflow(key, after.id), snapshotGraph)) : null;
    await removeSave(key, saves[at].id, changes);
}

function saveMenu(owner, anchor, item, group, at) {
    const { key } = item;
    const save = group.saves[at];
    openPopupMenu(anchor, [
        ...(save.pictures.length ? [{ label: t('savesPicturesAll', { count: save.pictures.length }), run: () => openSaveGallery(owner, placeOf(item, at), save) }] : []),
        ...(tabOfGroup(item) ? [{ label: t('snapshotGoBack'), run: () => void toCanvas(owner, key, () => backTo(item, save)) }] : []),
        { label: t('snapshotOpenTab'), run: () => void toCanvas(owner, key, () => openSave(item, save)) },
        { label: t('snapshotRemove'), danger: true, run: async () => {
            if (!await anomalousConfirm(t('snapshotRemoveConfirm', { number: at + 1 }), t('snapshotTitle'))) return;
            await remove(group, at).catch(error => fail(owner, key, error));
        } },
    ]);
}

function saveRow(owner, item, group, save, at) {
    const box = document.createElement('div');
    box.className = 'anomalous-saves-save';
    box.dataset.key = save.id;
    const info = appendText(box, 'div', '', 'anomalous-saves-info');
    const top = appendText(info, 'div', '', 'anomalous-saves-top');
    appendText(top, 'span', String(at + 1), 'anomalous-saves-number');
    const when = new Date(save.at * 1000).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const kind = at === 0 ? '' : ` · ${t(`snapshotKind_${changeKind(save.changes)}`)}`;
    const left = save.running ? ` · ${t('savesRunning', { count: save.running })}` : '';
    appendText(top, 'span', `${when}${kind}${left}`, 'anomalous-saves-when');
    if (at > 0 && save.changes.length) appendText(info, 'div', saveWords(save, at), 'anomalous-saves-words').title = saveWords(save, at);
    const tools = appendText(info, 'div', '', 'anomalous-saves-tools');
    const go = button(tools, t('savesRunOne'), 'anomalous-wf-filter');
    go.title = t('savesRunOneHint', { count: save.count });
    go.onclick = () => void run(owner, group, [save], 'random');
    tools.append(runsBox(group.key, save));
    appendText(tools, 'span', t('savesRunTimes'), 'anomalous-saves-times');
    button(tools, t('snapshotKeepCard'), 'anomalous-wf-filter').onclick = () => void keep(owner, group.key, save);
    const more = button(tools, '⋯', 'anomalous-wf-icon-btn');
    more.title = t('notebookMore');
    more.onclick = event => saveMenu(owner, event.currentTarget, item, group, at);
    pictureLine(owner, box, save, placeOf(item, at));
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
    part.line = null;
    if (!group) return void settle(box, [head]);
    head.append(seedSwitch());
    const go = button(head, t('snapshotRun', { count: runTotal(group.saves) }), 'anomalous-snapshot-run');
    go.onclick = () => void run(owner, group, group.saves, seedMode());
    const remove = button(head, t('savesListRemove'), 'anomalous-wf-filter');
    remove.onclick = async () => {
        if (!await anomalousConfirm(t('savesListRemoveConfirm', { name: item.title || t('recipeUntitled'), count: item.count }))) return;
        await removeGroup(item.key).catch(error => fail(owner, item.key, error));
    };
    const line = document.createElement('div');
    line.className = 'anomalous-saves-status';
    const cards = document.createElement('div');
    cards.className = 'anomalous-saves-cards';
    cards.append(...group.saves.map((save, at) => saveRow(owner, item, group, save, at)));
    settle(box, [head, line, cards]);
    part.line = box.querySelector('.anomalous-saves-status');
    showLine(part);
    fillLines(box);
}

async function openPart(owner, part) {
    try {
        drawPart(owner, part, await findGroup(part.item.key, ''));
    } catch (error) {
        console.warn('[AMB] Saves:', error);
    }
}

/** How many there are, beside the way back to the cards. */
function sayCount(owner) {
    const parts = [...owner.savesParts.values()];
    owner.savesTitle.textContent = t('savesListTitle', { canvases: parts.length, saves: parts.reduce((sum, part) => sum + part.item.count, 0) });
}

function setView(owner, on) {
    if (!owner.savesList) {
        owner.savesList = document.createElement('div');
        owner.savesList.className = 'anomalous-wf-list anomalous-saves-list';
        owner.recipeView.append(owner.savesList);
        new ResizeObserver(() => fillLines(owner.savesList)).observe(owner.savesList);
    }
    owner.savesListOn = on;
    owner.savesToggle.textContent = t(on ? 'savesListBack' : 'savesListToggle');
    owner.recipeView.classList.toggle('is-saves', on);
    if (on && shownKey()) owner.savesOpen.add(shownKey());
}

/** The view as the saves stand now, when it is on. */
export async function refreshSaves(owner) {
    const wanted = owner.savesWanted;
    owner.savesWanted = '';
    if (wanted) {
        closeSaveGallery(owner);
        setView(owner, true);
        owner.savesOpen.add(wanted);
    }
    if (!owner.savesListOn) return;
    const list = owner.savesList;
    const reading = owner.savesReading = {};
    try {
        const groups = await listGroups();
        if (reading !== owner.savesReading) return;
        refused.clear();
        owner.savesParts = new Map(groups.map(item => [item.key, { item, box: document.createElement('section') }]));
        const parts = [...owner.savesParts.values()];
        for (const part of parts) {
            part.box.className = 'anomalous-saves-part';
            drawPart(owner, part, null);
        }
        list.replaceChildren(...parts.map(part => part.box));
        if (!groups.length) appendText(list, 'p', t('savesListEmpty'), 'anomalous-recipe-empty');
        sayCount(owner);
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
    sayCount(owner);
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
    owner.savesTitle = document.createElement('span');
    owner.savesTitle.className = 'anomalous-saves-title';
    onSavesChange((key, group) => groupChanged(owner, key, group));
    watchSeedMode(() => {
        for (const part of owner.savesParts.values()) {
            if (owner.savesOpen.has(part.item.key)) void openPart(owner, part);
        }
    });
    return owner.savesToggle;
}
