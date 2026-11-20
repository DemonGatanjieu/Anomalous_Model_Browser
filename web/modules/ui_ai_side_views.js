/**
 * The AI workbench's side column shows one view at a time, picked by the switch at the top right
 * of the window (its title bar, on the AI page only), as an app's side panel is: the three used most named
 * (panels, materials, results), the rest in "More" (a menu, each with a line of what it is; the button takes
 * the name of the one shown); counts are quiet, a dot says something new waits. The views: the stage (the AI's panels, ui_ai_side.js), the
 * shape of a run at full size (ui_ai_run_map.js; the newest run, or one picked from the list or
 * from its step in the timeline), the task's decisions (ui_ai_decisions.js), what the task gives its
 * AI (ui_ai_given.js; its "Add materials" and the message box's "+" open the picker's window,
 * ui_ai_toolbox.js), what the task made (ui_ai_outputs.js), or the ready-made ways the AI may use
 * (ui_ai_blocks.js).
 * Picking the view that is shown closes the column. Each view keeps its own pane, so going back
 * finds it as it was: a scrolled stage. The column is a
 * card of its own beside the timeline; its left edge drags it wider or narrower (kept on this
 * browser, the timeline keeps room; the whole gap beside the card catches the pointer, and the
 * arrow keys move it when focused), a double click there puts the usual width back.
 *
 * `side` is the workbench's stage state (ui_ai_side.js): `view`, `mapStep`, `hidden`, `tab`.
 */

import { resolveLocale, translate as t } from './locales.js';
import { emptyState } from './ui_ai_art.js';
import { timeLabel } from './activity_log.js';
import { icon } from './ui_ai_icons.js';
import { openPopupMenu } from './ui_popup_menu.js';
import { runMapBox } from './ui_ai_run_map.js';
import { openToolbox, syncToolboxTask } from './ui_ai_toolbox.js';
import { renderGivenView } from './ui_ai_given.js';
import { panelSteps, renderStage, sideHead } from './ui_ai_side.js';
import { renderDecisionsView } from './ui_ai_decisions.js';
import { renderOutputsView } from './ui_ai_outputs.js';
import { readBlocksAhead, renderBlocksView } from './ui_ai_blocks.js';

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
    stage: ['chat', 'aiStage'], toolbox: ['box', 'aiToolbox'], outputs: ['image', 'aiSideOutputs'],
    map: ['nodes', 'aiSideMap'], decisions: ['checks', 'aiSideDecisions'], blocks: ['blocks', 'aiSideBlocks'],
};
const MORE = ['map', 'decisions', 'blocks']; // looked at now and then: in "More"


function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** The runs of `task` whose shape was read, oldest first. */
export const mappedRuns = task => (task?.steps || []).filter(step => step.map?.boxes?.length);

/**
 * The switch: a button per view used most and "More" for the rest, lit for the one shown (`shown`: the column is
 * on screen); `badges`: stage {count, unread}, asking question count, toolbox material count, outputs unseen count.
 * A count says how many there are, quietly; a dot that something waits (a question, an unread panel, new results).
 * `onPick(view)`.
 */
export function sideSwitch(side, shown, badges, onPick) {
    const bar = el('div', 'anomalous-ai-side-switch');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', t('aiSideSwitch'));
    for (const [view, [name, label]] of Object.entries(VIEWS)) {
        if (MORE.includes(view)) continue;
        const on = shown && side.view === view;
        const stage = view === 'stage';
        const unread = stage && badges.stage.unread;
        const count = stage ? badges.stage.count : view === 'toolbox' ? badges.toolbox : 0;
        const fresh = view === 'outputs' ? badges.outputs : 0;
        const node = el('button', `anomalous-ai-side-btn${on ? ' is-on' : ''}${stage && badges.asking ? ' is-asking' : ''}${unread ? ' is-unread' : ''}${fresh ? ' is-new' : ''}`);
        node.type = 'button';
        const description = [t(label), stage && count ? t('aiStagePanels', { count }) : '', unread ? t('aiStageUnread') : '',
            fresh ? t('aiSideNew', { count: fresh }) : ''].filter(Boolean).join(' · ');
        node.title = on ? `${description} · ${t('aiSideHide')}` : description;
        node.setAttribute('aria-label', description);
        node.setAttribute('aria-pressed', String(on));
        node.append(icon(name, 15), el('span', 'anomalous-ai-side-btn-label', t(label)));
        if (count) node.append(el('span', 'anomalous-ai-side-btn-count', count));
        node.onclick = () => onPick(view);
        bar.append(node);
    }
    bar.append(moreButton(side, shown, onPick));
    return bar;
}

/** "More": a menu of the views looked at now and then; while one of them is shown, the button bears its name. */
function moreButton(side, shown, onPick) {
    const current = shown && MORE.includes(side.view) ? side.view : '';
    const node = el('button', `anomalous-ai-side-btn is-more${current ? ' is-on' : ''}`);
    node.type = 'button';
    node.setAttribute('aria-haspopup', 'menu');
    node.title = current ? `${t(VIEWS[current][1])} · ${t('aiSideMoreHint')}` : t('aiSideMoreHint');
    node.append(icon(current ? VIEWS[current][0] : 'blocks', 15), el('span', 'anomalous-ai-side-btn-label', t(current ? VIEWS[current][1] : 'aiSideMore')),
        icon('chevronDown', 12));
    node.onclick = () => openPopupMenu(node, MORE.map(view => ({
        label: t(VIEWS[view][1]), note: t(`${VIEWS[view][1]}Note`), checked: view === current, run: () => onPick(view),
    })));
    return node;
}

/**
 * With no room for the column beside the timeline: the timeline and every view as tabs, with their
 * words, in place of the title bar's switch. A panel that came meanwhile lights the stage's tab.
 */
export function viewTabs(side, shown, badges, onPick, onTimeline) {
    const bar = el('div', 'anomalous-ai-tabs');
    const timeline = el('button', `anomalous-ai-side-btn${shown ? '' : ' is-on'}`);
    timeline.type = 'button';
    timeline.setAttribute('aria-pressed', String(!shown));
    timeline.append(el('span', 'anomalous-ai-side-btn-label', t('aiTimeline')));
    timeline.onclick = onTimeline;
    const views = sideSwitch(side, shown, { ...badges, asking: badges.asking || (side.lit && side.tab !== 'stage') }, (view) => {
        if (view === 'stage') side.lit = false;
        onPick(view);
    });
    bar.append(timeline, ...views.children);
    return bar;
}

let connectedPage = null; // connectSide's `page`: where the materials view and the picker get the task's message box from

/** The picker's window for `task`, on `kind` (else the one shown last); a model's own page opens from it, its Back comes back. */
function openPicker(task, changed, kind = null) {
    void openToolbox(task, changed, { kind, messageBox: connectedPage.message(), owner: connectedPage.owner(), messageBoxOf: () => connectedPage.message() });
}

/**
 * The switch was pressed on `view`: shows it, or closes the column when it is what is shown.
 * From the message box's "+" (`openKind`) the picker's window opens on that kind instead.
 */
export function pickView(side, view, shown, task, redraw, changed, openKind = null) {
    if (openKind) {
        openPicker(task, changed, openKind);
        return;
    }
    if (shown && side.view === view && side.tab === 'stage') {
        side.hidden = true;
        side.tab = 'timeline';
    } else {
        Object.assign(side, { view, hidden: false, tab: 'stage', asked: view === 'stage' });
    }
    redraw();
}

/** Whether the column is on screen: not closed, and its view has something (the stage: panels, or
 * the user asked for it, and sees it is empty). */
export function sideShown(side, task) {
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
 * The column into `box` for `task`: the view picked, the tabs of a window with no room for it
 * (`ctx.tabs()`), the stage drawn while there are panels, the run's shape while it is the view.
 * `ctx`: the stage's (ui_ai_side.js renderStage) with `close()`, `owner` and `changed()`. The picker's window
 * open on it gets the task as the page has it now.
 */
export function drawSide(box, task, side, ctx, arrived = null) {
    const panes = sidePanes(box);
    syncToolboxTask(task);
    const opened = panes.blocks.hidden && side.view === 'blocks'; // the ways are read again when the view comes up
    for (const [view, pane] of Object.entries(panes)) pane.hidden = view !== side.view;
    const tabsEl = box.querySelector(':scope > .anomalous-ai-tabs');
    if (tabsEl && (!ctx.tabsKey || tabsEl.dataset.tabsKey !== ctx.tabsKey)) {
        const nextTabs = ctx.tabs();
        nextTabs.dataset.tabsKey = ctx.tabsKey || '';
        tabsEl.replaceWith(nextTabs);
    }
    if (panelSteps(task).length) {
        delete panes.stage.dataset.emptyKey;
        renderStage(panes.stage, task, side, ctx, arrived);
    } else if (panes.stage.dataset.emptyKey !== resolveLocale()) {
        panes.stage.dataset.emptyKey = resolveLocale();
        const body = el('div', 'anomalous-ai-stage-body');
        body.append(emptyState('board', t('aiStageNone')));
        panes.stage.replaceChildren(sideHead(t('aiStage'), ctx.close), body);
    }
    if (side.view === 'map') renderMapView(panes.map, task, side, ctx);
    if (side.view === 'decisions') renderDecisionsView(panes.decisions, task, ctx);
    if (side.view === 'outputs') renderOutputsView(panes.outputs, task, ctx);
    if (side.view === 'toolbox') {
        renderGivenView(panes.toolbox, task, { close: ctx.close, owner: ctx.owner, changed: ctx.changed,
            message: () => connectedPage?.message(), openPicker: () => openPicker(task, ctx.changed) });
    }
    // The ways and skills: read again when the view comes up, drawn the first time and when what they show of the task changed.
    const shows = JSON.stringify([task.id, task.private === true, Boolean(task.ended), task.toolbox?.ways || []]);
    const draw = !panes.blocks.childElementCount || panes.blocks.dataset.shows !== shows;
    if (side.view === 'blocks' && (opened || draw)) {
        panes.blocks.dataset.shows = shows;
        renderBlocksView(panes.blocks, ctx, { fresh: opened, draw, task });
    } else readBlocksAhead();
}

/**
 * Once: `page` is {side, task(), redraw(), message() (the task's message box, whose `refs` the picker puts
 * things on and the materials view says), owner()}. Returns how a run's step shows its shape in the
 * column at full size.
 */
export function connectSide(page) {
    connectedPage = page;
    return (stepId) => {
        const newest = mappedRuns(page.task()).at(-1)?.id;
        Object.assign(page.side, { view: 'map', mapStep: stepId === newest ? null : stepId, hidden: false, tab: 'stage' });
        page.redraw();
    };
}
