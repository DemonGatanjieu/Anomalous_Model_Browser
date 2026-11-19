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
import { addMark, backTo, canvasSaveStatus, openSave, peekCanvasSave, revealCanvasBar, runsBox, saveWords, seedSwitch, shownKey, tabOfGroup } from './ui_snapshot_bar.js';

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

/**
 * While the main button is held on a button of the list, nothing in it moves: a new picture would put
 * another under the pointer and the press would be no click. What comes meanwhile waits in
 * owner.savesHeld, a group's key to how it stands, and shows after the press.
 */
function holdStill(owner, event) {
    if (event.button !== 0 || owner.savesHeld || !event.target.closest('button')) return;
    owner.savesHeld = new Map();
    const ended = new AbortController();
    const release = () => {
        ended.abort();
        setTimeout(() => { // the click comes right after pointerup
            const held = owner.savesHeld;
            owner.savesHeld = null;
            for (const [key, group] of held) groupChanged(owner, key, group);
        });
    };
    for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, release, { capture: true, signal: ended.signal });
}

function bindSaveButton(owner, actions, label) {
    const saveBtn = button(actions, label, 'anomalous-wf-save');
    saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try {
            const added = await addMark();
            if (added?.key) owner.savesOpen.add(added.key);
        } finally {
            if (saveBtn.isConnected) saveBtn.disabled = false;
        }
    };
}

function drawGuide(owner, status) {
    const guide = owner.savesGuide;
    if (!guide) return;
    const name = status.title || t('savesGuideUnnamed');
    const copy = document.createElement('div');
    copy.className = 'anomalous-saves-guide-copy';
    const actions = document.createElement('div');
    actions.className = 'anomalous-saves-guide-actions';
    guide.classList.toggle('is-empty', !status.hasCanvas && !status.count);
    if (!status.hasCanvas && !status.count) {
        appendText(copy, 'div', t('savesGuideEmptyCanvas'), 'anomalous-saves-guide-title');
        appendText(copy, 'div', t('savesGuideEmptyDesc'), 'anomalous-saves-guide-desc');
        button(actions, t('savesPickWorkflow'), 'anomalous-wf-save').onclick = () => owner.goTo?.('recipes');
    } else if (!status.count) {
        appendText(copy, 'div', t('savesGuideNoSaves', { name }), 'anomalous-saves-guide-title');
        appendText(copy, 'div', t('savesGuideNoSavesDesc'), 'anomalous-saves-guide-desc');
        bindSaveButton(owner, actions, t('savesGuideSaveFirst'));
    } else {
        appendText(copy, 'div', t('savesGuideHasSaves', { name, count: status.count }), 'anomalous-saves-guide-title');
        appendText(copy, 'div', t('savesGuideHasSavesDesc'), 'anomalous-saves-guide-desc');
        bindSaveButton(owner, actions, t('savesGuideSaveNext'));
        button(actions, t('savesGuideToCanvas'), 'anomalous-wf-filter').onclick = () => revealCanvasBar(owner);
    }
    guide.replaceChildren(copy, actions);
}

async function refreshGuide(owner) {
    const token = owner.savesGuideSeq = (owner.savesGuideSeq || 0) + 1;
    const status = await canvasSaveStatus();
    if (token !== owner.savesGuideSeq || !owner.savesListOn) return;
    drawGuide(owner, status);
}

function primeSaves(owner) {
    const peek = peekCanvasSave();
    drawGuide(owner, peek.status);
    const items = [owner.savesGuide];
    const targetKey = owner.savesWanted || peek.status.key;
    if (peek.group?.saves?.length && (!targetKey || peek.group.key === targetKey)) {
        const saves = peek.group.saves;
        const item = {
            key: peek.group.key,
            title: peek.group.title || peek.status.title || '',
            path: peek.group.path || '',
            count: saves.length,
            updated: Math.max(...saves.map(save => save.at || 0), Math.floor(Date.now() / 1000)),
            cover: saves.flatMap(save => save.pictures || []).at(-1) || null,
        };
        const part = { item, box: document.createElement('section') };
        part.box.className = 'anomalous-saves-part';
        owner.savesOpen.add(item.key);
        drawPart(owner, part, peek.group);
        owner.savesParts.set(item.key, part);
        items.push(part.box);
    }
    owner.savesList.replaceChildren(...items);
    fillLines(owner.savesList);
}

export function setSavesView(owner, on) {
    if (!owner.savesList) {
        owner.savesList = document.createElement('div');
        owner.savesList.className = 'anomalous-wf-list anomalous-saves-list';
        owner.savesList.addEventListener('pointerdown', event => holdStill(owner, event));
        owner.recipeView.append(owner.savesList);
        new ResizeObserver(() => fillLines(owner.savesList)).observe(owner.savesList);
    }
    if (!owner.savesGuide) {
        owner.savesGuide = document.createElement('section');
        owner.savesGuide.className = 'anomalous-saves-guide';
    }
    if (on) closeSaveGallery(owner);
    owner.savesListOn = on;
    owner.savesToggle.textContent = t(on ? 'savesListBack' : 'savesListToggle');
    owner.recipeView.classList.toggle('is-saves', on);
    if (on && shownKey()) owner.savesOpen.add(shownKey());
    if (on && owner.savesWanted) owner.savesOpen.add(owner.savesWanted);
    if (on && (!owner.savesList.childElementCount || (owner.savesWanted && !owner.savesParts.get(owner.savesWanted)?.line))) {
        primeSaves(owner);
    }
}

/** The view as the saves stand now, when it is on. */
export async function refreshSaves(owner) {
    const wanted = owner.savesWanted;
    owner.savesWanted = '';
    if (wanted) {
        owner.savesOpen.add(wanted);
        setSavesView(owner, true);
    }
    if (!owner.savesListOn) return;
    const list = owner.savesList;
    const reading = owner.savesReading = {};
    try {
        const preKeys = [...owner.savesOpen];
        const [groups, status, ...prefetched] = await Promise.all([
            listGroups(),
            canvasSaveStatus(),
            ...preKeys.map(key => findGroup(key, '').catch(() => null)),
        ]);
        if (reading !== owner.savesReading) return;
        const openGroups = new Map(preKeys.map((key, index) => [key, prefetched[index]]));
        const missing = groups.map(item => item.key).filter(key => owner.savesOpen.has(key) && !openGroups.has(key));
        if (missing.length) {
            const loaded = await Promise.all(missing.map(key => findGroup(key, '').catch(() => null)));
            if (reading !== owner.savesReading) return;
            missing.forEach((key, index) => openGroups.set(key, loaded[index]));
        }
        refused.clear();
        drawGuide(owner, status);
        owner.savesParts = new Map(groups.map(item => [item.key, { item, box: document.createElement('section') }]));
        const parts = [...owner.savesParts.values()];
        for (const part of parts) {
            part.box.className = 'anomalous-saves-part';
            const loaded = owner.savesOpen.has(part.item.key) ? openGroups.get(part.item.key) : null;
            drawPart(owner, part, loaded || null);
        }
        const items = [owner.savesGuide, ...parts.map(part => part.box)];
        if (!groups.length) {
            const empty = document.createElement('p');
            empty.className = 'anomalous-recipe-empty';
            empty.textContent = t('savesListEmpty');
            items.push(empty);
        }
        list.replaceChildren(...items);
        fillLines(list);
        sayCount(owner);
        const wantedBox = owner.savesParts.get(wanted)?.box;
        if (wantedBox) {
            const boxRect = wantedBox.getBoundingClientRect();
            const listRect = list.getBoundingClientRect();
            if (boxRect.top < listRect.top || boxRect.bottom > listRect.bottom) wantedBox.scrollIntoView({ block: 'nearest' });
        }
    } catch (error) {
        console.error('Could not list the saves:', error);
        drawGuide(owner, await canvasSaveStatus().catch(() => ({ hasCanvas: false, title: '', key: '', count: 0 })));
        list.replaceChildren(owner.savesGuide);
        appendText(list, 'p', t('savesListFailed'), 'anomalous-recipe-empty');
    }
}

/** A group changed: its part shows it; a new one or one gone changes the list. */
function groupChanged(owner, key, group) {
    if (!owner.savesListOn) return;
    if (owner.savesHeld) return void owner.savesHeld.set(key, group);
    const part = owner.savesParts.get(key);
    if (!part || !group) {
        if (!part && group) owner.savesOpen.add(key);
        return void refreshSaves(owner);
    }
    part.item.count = group.saves.length;
    sayCount(owner);
    part.item.cover = group.saves.flatMap(save => save.pictures).at(-1) || null;
    if (owner.savesOpen.has(key)) drawPart(owner, part, group);
    else drawPart(owner, part, null);
    void refreshGuide(owner);
}

/** The Saves view opened for `key` (or the current canvas's saves): highlights Saves in the rail. */
export function showSaves(key = '') {
    this.savesWanted = key || shownKey() || '';
    this.show({ page: 'saves' });
}

/** The bar's button between the workflow cards and the saves. */
export function savesToggle(owner) {
    owner.savesOpen = new Set();
    owner.savesParts = new Map();
    owner.savesHeld = null;
    owner.savesToggle = document.createElement('button');
    owner.savesToggle.type = 'button';
    owner.savesToggle.className = 'anomalous-wf-filter anomalous-wf-saves-toggle';
    owner.savesToggle.textContent = t('savesListToggle');
    owner.savesToggle.onclick = () => {
        setSavesView(owner, !owner.savesListOn);
        owner.markWorkspace?.(owner.savesListOn ? 'saves' : 'recipes');
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
