/**
 * The AI workbench's stage (展台): the column on the right where the panels the AI draws are
 * shown (ui_ai_panel.js), so they stay in view however many steps come after them. The timeline
 * keeps one line per panel that brings it here. The stage follows the newest panel until the
 * user goes back to an older one (‹ ›, or a panel's line); going to the newest follows again.
 * In a window too narrow for three columns, the timeline and the stage take turns behind two
 * tabs, and a panel that asks something brings the stage forward.
 *
 * `stage` is the workbench's `{ taskId, panelId, follow, tab, newest }`.
 */

import { translate as t } from './locales.js';
import { renderPanel } from './ui_ai_panel.js';

const QUESTIONS = ['choices', 'input', 'picks'];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, onClick, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

export const panelSteps = task => (task?.steps || []).filter(step => step.kind === 'panel' && step.panel);

/** How many of a panel's questions still wait for the user. */
export function openQuestions(step) {
    if (!step?.panel || step.panel.closed) return 0;
    return (step.panel.blocks || []).filter(block => QUESTIONS.includes(block?.type) && !(step.answers || {})[block.id]).length;
}

/**
 * Which panel the stage shows for `task`, updating `stage`: the newest while following, else the
 * one picked (the newest again when that one is gone). Returns `{ step, index, count, arrived }`;
 * `arrived` is a newer panel than the last call saw.
 */
export function choosePanel(task, stage) {
    const steps = panelSteps(task);
    if (stage.taskId !== task?.id) Object.assign(stage, { taskId: task?.id, panelId: null, follow: true, newest: null });
    const newest = steps.at(-1)?.panel.id ?? null;
    const arrived = Boolean(newest) && newest !== stage.newest && stage.newest !== undefined;
    stage.newest = newest;
    if (stage.follow || !steps.some(step => step.panel.id === stage.panelId)) {
        stage.panelId = newest;
        stage.follow = true;
    }
    const index = steps.findIndex(step => step.panel.id === stage.panelId);
    return { step: steps[index] || null, index, count: steps.length, arrived };
}

/** Shows panel `panelId` on the stage; the newest one means following again. */
export function pickPanel(task, stage, panelId) {
    const steps = panelSteps(task);
    stage.panelId = panelId;
    stage.follow = steps.at(-1)?.panel.id === panelId;
    stage.tab = 'stage';
}

/** The timeline's line for a panel step: its title, whether it waits for you, and the way to it. */
export function panelLine(step, shown, onOpen) {
    const asks = openQuestions(step);
    const line = button(`anomalous-ai-panel-line${shown ? ' is-shown' : ''}${asks ? ' is-asking' : ''}`, '', onOpen, t('aiStageOpen'));
    line.append(el('span', 'anomalous-ai-panel-line-title', step.panel.title || ''));
    if (asks) line.append(el('span', 'anomalous-ai-panel-line-asks', t('aiState_asks')));
    line.append(el('span', 'anomalous-ai-panel-line-go', t(shown ? 'aiStageShown' : 'aiStageGo')));
    return line;
}

/** The two tabs of a narrow window: the timeline and the stage (lit while a question waits). */
export function tabBar(stage, asks, onPick) {
    const bar = el('div', 'anomalous-ai-tabs');
    for (const id of ['timeline', 'stage']) {
        const tab = button(`anomalous-ai-tab${stage.tab === id ? ' is-on' : ''}${id === 'stage' && asks ? ' is-asking' : ''}`,
            t(id === 'stage' ? 'aiStage' : 'aiTimeline'), () => onPick(id));
        tab.setAttribute('aria-pressed', String(stage.tab === id));
        bar.append(tab);
    }
    return bar;
}

/**
 * The stage into `box` for `task`. `ctx`: what ui_ai_panel.js needs, and `pick(panelId)` /
 * `tab(id)` for the pager and the tabs. The panel is drawn again only when it changed, so its
 * scroll and half-typed answers stay while the AI works.
 */
export function renderStage(box, task, stage, ctx) {
    const { step, index, count } = choosePanel(task, stage);
    const steps = panelSteps(task);
    const asks = steps.reduce((sum, item) => sum + openQuestions(item), 0);
    let head = box.querySelector(':scope > .anomalous-ai-stage-head');
    let body = box.querySelector(':scope > .anomalous-ai-stage-body');
    let tabs = box.querySelector(':scope > .anomalous-ai-tabs');
    if (!head) {
        tabs = el('div', 'anomalous-ai-tabs');
        head = el('div', 'anomalous-ai-stage-head');
        body = el('div', 'anomalous-ai-stage-body');
        box.replaceChildren(tabs, head, body);
    }
    tabs.replaceWith(tabs = tabBar(stage, asks, ctx.tab));
    const title = el('span', 'anomalous-ai-stage-title', t('aiStage'));
    const parts = [title];
    if (step && openQuestions(step)) parts.push(el('span', 'anomalous-ai-state is-asks', t('aiState_asks')));
    parts.push(el('span', 'anomalous-ai-gap'));
    if (count > 1) {
        const back = button('anomalous-ai-pager', '‹', () => ctx.pick(steps[index - 1].panel.id), t('aiStagePrevious'));
        const next = button('anomalous-ai-pager', '›', () => ctx.pick(steps[index + 1].panel.id), t('aiStageNext'));
        back.disabled = index <= 0;
        next.disabled = index >= count - 1;
        parts.push(back, el('span', 'anomalous-ai-pager-count', t('aiStageCount', { at: index + 1, count })), next);
    }
    head.replaceChildren(...parts);
    const key = step ? JSON.stringify([step.panel, step.answers]) : 'empty';
    if (body.dataset.panelKey === key) return;
    body.dataset.panelKey = key;
    body.replaceChildren(step ? renderPanel(step, ctx) : el('div', 'anomalous-ai-stage-empty', t('aiStageEmpty')));
    body.scrollTop = 0;
}
