/**
 * The AI workbench's side column shows one view at a time, picked by the switch at the top right
 * of the window (its title bar, on the AI page only), as an app's side panel is: the stage (the AI's panels, ui_ai_side.js), the
 * shape of a run at full size (ui_ai_run_map.js; the newest run, or one picked from the list or
 * from its step in the timeline), the task's decisions (ui_ai_decisions.js), the materials
 * picker (ui_ai_toolbox.js) docked there, or what the task made (ui_ai_outputs.js).
 * Picking the view that is shown closes the column. Each view keeps its own pane, so going back
 * finds it as it was: a scrolled stage, materials picked but not handed over yet. The column is a
 * card of its own beside the timeline; its left edge drags it wider or narrower (kept on this
 * browser, the timeline keeps room; the whole gap beside the card catches the pointer, and the
 * arrow keys move it when focused), a double click there puts the usual width back.
 *
 * `side` is the workbench's stage state (ui_ai_side.js): `view`, `mapStep`, `hidden`, `tab`.
 */

import { translate as t } from './locales.js';
import { timeLabel } from './activity_log.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { runMapBox } from './ui_ai_run_map.js';
import { closeToolbox, openToolbox, setToolboxHost, toolboxOpenFor } from './ui_ai_toolbox.js';
import { openQuestions, panelSteps, renderStage, sideHead, tabBar } from './ui_ai_side.js';
import { renderDecisionsView } from './ui_ai_decisions.js';
import { renderOutputsView } from './ui_ai_outputs.js';

const WIDTH_KEY = 'anomalous.aiSideWidth';
const WIDTH = { min: 340, start: 440 };
const KEY_STEP = 32; // px an arrow key moves the column's edge
export const TIMELINE_MIN = 380; // what the timeline keeps beside the column

/** The column's width: as the user dragged it, or the usual one. */
export function sideWidth() {
    try {
        const kept = Number(localStorage.getItem(WIDTH_KEY));
        return kept >= WIDTH.min ? kept : WIDTH.start;
    } catch (_) {
        return WIDTH.start;
    }
}

export const VIEWS = {
    stage: ['panel', 'aiStage'], map: ['nodes', 'aiSideMap'], decisions: ['pin', 'aiSideDecisions'], toolbox: ['sparkle', 'aiToolbox'], outputs: ['tray', 'aiSideOutputs'],
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** The runs of `task` whose shape was read, oldest first. */
export const mappedRuns = task => (task?.steps || []).filter(step => step.map?.boxes?.length);

/** The view's name, for the tab of a narrow window. */
export const viewLabel = view => t((VIEWS[view] || VIEWS.stage)[1]);

/**
 * The switch: a button per view, lit for the one shown (`shown`: the column is on screen);
 * `badges`: stage {count, unread}, asking question count, toolbox material count, outputs unseen count. `onPick(view)`.
 */
export function sideSwitch(side, shown, badges, onPick) {
    const bar = el('div', 'anomalous-ai-side-switch');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', t('aiSideSwitch'));
    for (const [view, [name, label]] of Object.entries(VIEWS)) {
        const on = shown && side.view === view;
        const stage = view === 'stage';
        const unread = stage && badges.stage.unread;
        const count = stage ? badges.stage.count : badges[view];
        const node = el('button', `anomalous-ai-side-btn${on ? ' is-on' : ''}${stage && badges.asking ? ' is-asking' : ''}${unread ? ' is-unread' : ''}`);
        node.type = 'button';
        const description = [t(label), stage && count ? t('aiStagePanels', { count }) : '', unread ? t('aiStageUnread') : ''].filter(Boolean).join(' · ');
        node.title = on ? `${description} · ${t('aiSideHide')}` : description;
        if (stage) node.setAttribute('aria-label', description);
        node.setAttribute('aria-pressed', String(on));
        node.append(icon(name, 15), el('span', 'anomalous-ai-side-btn-label', t(label)));
        if (count) node.append(el('span', `anomalous-ai-side-btn-count${stage ? ' is-total' : ''}`, count));
        node.onclick = () => onPick(view);
        bar.append(node);
    }
    return bar;
}

/**
 * The switch was pressed on `view`: shows it, or closes the column when it is what is shown.
 * The materials view opens the picker first when it is not open (it comes in through its host).
 */
export function pickView(side, view, shown, task, redraw, changed) {
    if (shown && side.view === view && side.tab === 'stage') {
        side.hidden = true;
        side.tab = 'timeline';
    } else if (view === 'toolbox' && !toolboxOpenFor(task.id)) {
        void openToolbox(task, changed);
        return;
    } else {
        Object.assign(side, { view, hidden: false, tab: 'stage', asked: view === 'stage' });
    }
    redraw();
}

/** Whether the column is on screen: not closed, and its view has something (the stage: panels, or
 * the user asked for it, and sees it is empty; the picker: open). */
export function sideShown(side, task) {
    if (side.view === 'toolbox' && !toolboxOpenFor(task.id)) side.view = 'stage';
    return !side.hidden && (side.view !== 'stage' || panelSteps(task).length > 0 || Boolean(side.asked));
}

/** The grip on the column's left edge: drag to resize (the timeline keeps its room), double click for the usual width. */
function grip(box) {
    const node = el('div', 'anomalous-ai-side-grip');
    node.setAttribute('role', 'separator');
    node.setAttribute('aria-orientation', 'vertical');
    node.tabIndex = 0;
    node.title = t('aiSideResize');
    const page = box.closest('.anomalous-ai');
    const set = (width, keep) => {
        const list = page.querySelector('.anomalous-ai-tasks');
        const used = list && getComputedStyle(list).position !== 'absolute' ? list.offsetWidth : 0;
        const room = Math.max(WIDTH.min, page.clientWidth - used - TIMELINE_MIN);
        const fit = Math.round(Math.max(WIDTH.min, Math.min(width, room)));
        page.style.setProperty('--ai-side-w', `${fit}px`);
        try {
            if (keep) localStorage.setItem(WIDTH_KEY, String(fit));
        } catch (_) { /* only not kept */ }
    };
    page?.style.setProperty('--ai-side-w', `${sideWidth()}px`);
    node.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        node.setPointerCapture(event.pointerId);
        node.classList.add('is-dragging');
        document.body.classList.add('anomalous-ai-resizing');
        const right = box.getBoundingClientRect().right;
        const move = moved => set(right - moved.clientX, false);
        const stop = (ended) => {
            node.removeEventListener('pointermove', move);
            node.classList.remove('is-dragging');
            document.body.classList.remove('anomalous-ai-resizing');
            set(right - ended.clientX, true);
        };
        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', stop, { once: true });
        node.addEventListener('pointercancel', stop, { once: true });
    });
    node.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        event.stopPropagation(); // not the browser's own arrow keys
        const now = parseFloat(page.style.getPropertyValue('--ai-side-w')) || sideWidth();
        set(now + (event.key === 'ArrowLeft' ? KEY_STEP : -KEY_STEP), true);
    });
    node.addEventListener('dblclick', () => {
        try { localStorage.removeItem(WIDTH_KEY); } catch (_) { /* nothing kept */ }
        set(WIDTH.start, false);
    });
    return node;
}

/** The side column's panes into `box` (once): the narrow window's tabs, the grip, then one pane per view. */
function sidePanes(box) {
    if (!box.querySelector(':scope > .anomalous-ai-side-pane')) {
        box.replaceChildren(el('div', 'anomalous-ai-tabs'), grip(box), ...Object.keys(VIEWS).map(view => {
            const pane = el('div', `anomalous-ai-side-pane is-${view}`);
            pane.dataset.view = view;
            return pane;
        }));
    }
    return Object.fromEntries([...box.querySelectorAll(':scope > .anomalous-ai-side-pane')].map(pane => [pane.dataset.view, pane]));
}

/**
 * A run's shape at full size into `pane`: the run `side.mapStep` (null: the newest, following
 * new runs), a list to pick another. `ctx`: {locateNode, numberOf, close}. Drawn again only
 * when what it shows changed, so a scrolled diagram stays while the AI works.
 */
export function renderMapView(pane, task, side, ctx) {
    const runs = mappedRuns(task);
    const run = runs.find(step => step.id === side.mapStep) || runs.at(-1);
    const key = JSON.stringify([task.id, run?.id, run?.map, run?.changes, runs.length]);
    if (pane.dataset.key === key) return;
    pane.dataset.key = key;
    const more = [];
    if (runs.length > 1) {
        const pick = el('select', 'anomalous-ai-side-map-pick');
        pick.setAttribute('aria-label', t('aiSideMapPick'));
        for (const step of [...runs].reverse()) {
            const option = el('option', '', t('aiSideMapRun', { number: ctx.numberOf(step.id), time: timeLabel(step.at) }));
            option.value = step.id;
            option.selected = step.id === run.id;
            pick.append(option);
        }
        pick.onchange = () => {
            side.mapStep = pick.value === runs.at(-1).id ? null : pick.value;
            renderMapView(pane, task, side, ctx);
        };
        more.push(pick);
    }
    const body = el('div', 'anomalous-ai-stage-body anomalous-ai-side-map');
    body.append(run ? runMapBox(run, ctx, true) : el('div', 'anomalous-ai-stage-empty', t('aiSideMapNone')));
    pane.replaceChildren(sideHead(t('aiSideMap'), ctx.close, ...more), body);
}

/**
 * The column into `box` for `task`: the view picked, the narrow window's tab (`pickTab`), the
 * stage drawn while there are panels, the run's shape while it is the view. `ctx`: the stage's
 * (ui_ai_side.js renderStage) with `close()`. A picker left from another task is put away.
 */
export function drawSide(box, task, side, ctx, pickTab, arrived = null) {
    const panes = sidePanes(box);
    if (panes.toolbox.dataset.task && panes.toolbox.dataset.task !== task.id) closeToolbox();
    for (const [view, pane] of Object.entries(panes)) pane.hidden = view !== side.view;
    const asks = panelSteps(task).reduce((sum, step) => sum + openQuestions(step), 0);
    box.querySelector(':scope > .anomalous-ai-tabs').replaceWith(tabBar(side, asks, pickTab, viewLabel(side.view)));
    if (panelSteps(task).length) renderStage(panes.stage, task, side, ctx, arrived);
    else {
        const body = el('div', 'anomalous-ai-stage-body');
        body.append(el('div', 'anomalous-ai-stage-empty', t('aiStageNone')));
        panes.stage.replaceChildren(sideHead(t('aiStage'), ctx.close), body);
    }
    if (side.view === 'map') renderMapView(panes.map, task, side, ctx);
    if (side.view === 'decisions') renderDecisionsView(panes.decisions, task, ctx);
    if (side.view === 'outputs') renderOutputsView(panes.outputs, task, ctx);
}

/**
 * Once: the materials picker docks in the column while the AI page is shown (else on the right of
 * the screen). `page`: {side, task(), box() (the column, or null when the page is not shown),
 * redraw()}. Returns how a run's step shows its shape there at full size.
 */
export function connectSide(page) {
    setToolboxHost((body, expand) => {
        const box = page.box();
        const task = page.task();
        if (!box || !task) return null;
        const pane = sidePanes(box).toolbox;
        const top = el('div', 'anomalous-tb-dock-head');
        top.append(icon('sparkle', 16), el('div', 'anomalous-tb-dock-title', t('aiToolboxTitle')),
            iconButton('anomalous-tb-dock-btn', 'expand', t('aiTbExpand'), expand, { iconOnly: true }),
            iconButton('anomalous-tb-dock-btn', 'close', t('close'), closeToolbox, { iconOnly: true }));
        pane.replaceChildren(top, body);
        pane.dataset.task = task.id;
        Object.assign(page.side, { view: 'toolbox', hidden: false, tab: 'stage' });
        queueMicrotask(page.redraw); // the picker is open by then
        return () => {
            pane.replaceChildren();
            delete pane.dataset.task;
            if (page.side.view === 'toolbox') page.side.view = 'stage';
            queueMicrotask(page.redraw);
        };
    });
    return (stepId) => {
        const newest = mappedRuns(page.task()).at(-1)?.id;
        Object.assign(page.side, { view: 'map', mapStep: stepId === newest ? null : stepId, hidden: false, tab: 'stage' });
        page.redraw();
    };
}
