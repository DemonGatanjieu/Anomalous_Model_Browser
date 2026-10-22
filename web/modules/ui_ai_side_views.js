/**
 * The AI workbench's side column shows one view at a time, picked by the switch at the top right
 * of the window (its title bar, on the AI page only), as an app's side panel is: the stage (the AI's panels, ui_ai_side.js), the
 * shape of a run at full size (ui_ai_run_map.js; the newest run, or one picked from the list or
 * from its step in the timeline), or the materials picker (ui_ai_toolbox.js) docked there.
 * Picking the view that is shown closes the column. Each view keeps its own pane, so going back
 * finds it as it was: a scrolled stage, materials picked but not handed over yet.
 *
 * `side` is the workbench's stage state (ui_ai_side.js): `view`, `mapStep`, `hidden`, `tab`.
 */

import { translate as t } from './locales.js';
import { timeLabel } from './activity_log.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { runMapBox } from './ui_ai_run_map.js';
import { closeToolbox, openToolbox, setToolboxHost, toolboxOpenFor } from './ui_ai_toolbox.js';
import { openQuestions, panelSteps, renderStage, tabBar } from './ui_ai_side.js';

export const VIEWS = { stage: ['panel', 'aiStage'], map: ['nodes', 'aiSideMap'], toolbox: ['sparkle', 'aiToolbox'] };

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
 * `badges` {stage, toolbox} are open questions and materials. `onPick(view)`.
 */
export function sideSwitch(side, shown, badges, onPick) {
    const bar = el('div', 'anomalous-ai-side-switch');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', t('aiSideSwitch'));
    for (const [view, [name, label]] of Object.entries(VIEWS)) {
        const on = shown && side.view === view;
        const node = el('button', `anomalous-ai-side-btn${on ? ' is-on' : ''}${view === 'stage' && badges.stage ? ' is-asking' : ''}`);
        node.type = 'button';
        node.title = t(on ? 'aiSideHide' : label);
        node.setAttribute('aria-pressed', String(on));
        node.append(icon(name, 15), el('span', 'anomalous-ai-side-btn-label', t(label)));
        if (badges[view]) node.append(el('span', 'anomalous-ai-side-btn-count', badges[view]));
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
        Object.assign(side, { view, hidden: false, tab: 'stage' });
    }
    redraw();
}

/** Whether the column is on screen: not closed, and its view has something (the stage: panels; the picker: open). */
export function sideShown(side, task) {
    if (side.view === 'toolbox' && !toolboxOpenFor(task.id)) side.view = 'stage';
    return !side.hidden && (side.view !== 'stage' || panelSteps(task).length > 0);
}

/** The side column's panes into `box` (once): the narrow window's tabs, then one pane per view. */
function sidePanes(box) {
    if (!box.querySelector(':scope > .anomalous-ai-side-pane')) {
        box.replaceChildren(el('div', 'anomalous-ai-tabs'), ...Object.keys(VIEWS).map(view => {
            const pane = el('div', `anomalous-ai-side-pane is-${view}`);
            pane.dataset.view = view;
            return pane;
        }));
    }
    return Object.fromEntries([...box.querySelectorAll(':scope > .anomalous-ai-side-pane')].map(pane => [pane.dataset.view, pane]));
}

function head(title, close, ...more) {
    const box = el('div', 'anomalous-ai-stage-head');
    const shut = el('button', 'anomalous-ai-stage-close', '×');
    shut.type = 'button';
    shut.title = t('aiSideHide');
    shut.setAttribute('aria-label', t('aiSideHide'));
    shut.onclick = close;
    box.append(el('span', 'anomalous-ai-stage-title', title), ...more, el('span', 'anomalous-ai-gap'), shut);
    return box;
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
    pane.replaceChildren(head(t('aiSideMap'), ctx.close, ...more), body);
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
    else panes.stage.replaceChildren();
    if (side.view === 'map') renderMapView(panes.map, task, side, ctx);
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
