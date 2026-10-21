/**
 * The AI workbench's stage (展台): the column on the right where the panels the AI draws are
 * shown (ui_ai_panel.js), so they stay in view however many steps come after them. Like the
 * timeline it reads from the top down: the task's panels in the order they came, each with its
 * step number, the newest at the bottom. A new or updated latest panel follows to the bottom
 * while the user is there; otherwise a "See latest ↓" button says it changed. A panel's line in the timeline
 * brings the stage to that panel. In a window too narrow for three columns, the timeline and the
 * stage take turns behind two tabs, and a panel that asks something brings the stage forward.
 *
 * `stage` is the workbench's `{ taskId, latestKey, atBottom, focus, tab, unseen, placed, hidden }`.
 */

import { translate as t } from './locales.js';
import { renderPanel } from './ui_ai_panel.js';

const QUESTIONS = ['choices', 'input', 'picks'];
const BOTTOM_PX = 60;

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
 * What changed on the stage since the last look, updating `stage`: `{ arrived, asking }` -
 * `arrived` the latest panel when it is new or updated, `asking` its open questions.
 */
export function stageNews(task, stage) {
    const steps = panelSteps(task);
    const latest = steps.at(-1);
    const latestKey = JSON.stringify(latest?.panel || null);
    if (stage.taskId !== task?.id) {
        Object.assign(stage, { taskId: task?.id, latestKey, atBottom: true, focus: null, unseen: false, placed: false, hidden: false });
        return { arrived: null, asking: 0 };
    }
    const arrived = latestKey !== stage.latestKey ? latest : null;
    stage.latestKey = latestKey;
    if (arrived && !stage.atBottom) stage.unseen = true;
    return { arrived, asking: arrived ? openQuestions(arrived) : 0 };
}

/** The stage goes to panel `panelId` (from its line in the timeline). */
export function focusPanel(stage, panelId) {
    stage.hidden = false;
    stage.focus = panelId;
    stage.tab = 'stage';
}

/** The timeline's line for a panel step: its title, whether it waits for you, and the way to it. */
export function panelLine(step, onOpen) {
    const asks = openQuestions(step);
    const line = button(`anomalous-ai-panel-line${asks ? ' is-asking' : ''}`, '', onOpen, t('aiStageOpen'));
    line.append(el('span', 'anomalous-ai-panel-line-title', step.panel.title || ''));
    if (asks) line.append(el('span', 'anomalous-ai-panel-line-asks', t('aiState_asks')));
    line.append(el('span', 'anomalous-ai-panel-line-go', t('aiStageGo')));
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

function scrollToItem(body, item, smooth = true) {
    if (!item) return;
    const top = item.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8;
    body.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}

function scrollToLatest(body, stage) {
    if (!body.isConnected || !body.clientHeight) return;
    body.scrollTop = body.scrollHeight;
    stage.atBottom = true;
    stage.unseen = false;
    stage.placed = true;
    body.parentElement.querySelector('.anomalous-ai-stage-new')?.remove();
}

/**
 * The stage into `box` for `task`. `ctx`: what ui_ai_panel.js needs, `numberOf(stepId)` (the
 * step's number in the timeline) and `tab(id)`. A panel is drawn again only when it changed, so
 * its scroll and half-typed answers stay while the AI works.
 */
export function renderStage(box, task, stage, ctx, arrived = null) {
    const steps = panelSteps(task);
    const asks = steps.reduce((sum, item) => sum + openQuestions(item), 0);
    let tabs = box.querySelector(':scope > .anomalous-ai-tabs');
    let head = box.querySelector(':scope > .anomalous-ai-stage-head');
    let body = box.querySelector(':scope > .anomalous-ai-stage-body');
    const fresh = !body || box.dataset.taskId !== task.id;
    if (fresh) {
        tabs = el('div', 'anomalous-ai-tabs');
        head = el('div', 'anomalous-ai-stage-head');
        body = el('div', 'anomalous-ai-stage-body');
        box.dataset.taskId = task.id;
        box.replaceChildren(tabs, head, body);
        body.addEventListener('scroll', () => {
            stage.atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < BOTTOM_PX;
            if (stage.atBottom && stage.unseen) {
                stage.unseen = false;
                head.querySelector('.anomalous-ai-stage-new')?.remove();
            }
        });
        // Images can grow a panel after the first layout. Follow only while reading the latest.
        body.addEventListener('load', () => {
            if (stage.atBottom && !stage.focus) scrollToLatest(body, stage);
        }, true);
    }
    const newTabs = tabBar(stage, asks, ctx.tab);
    tabs.replaceWith(newTabs);
    const parts = [el('span', 'anomalous-ai-stage-title', t('aiStage')), el('span', 'anomalous-ai-stage-count', t('aiStagePanels', { count: steps.length }))];
    if (asks) parts.push(el('span', 'anomalous-ai-state is-asks', t('aiCountAsks', { count: asks })));
    parts.push(el('span', 'anomalous-ai-gap'));
    if (stage.unseen) {
        parts.push(button('anomalous-ai-stage-new', t('aiStageNew'), () => {
            scrollToLatest(body, stage);
        }));
    }
    const close = button('anomalous-ai-stage-close', '×', ctx.close, t('aiStageHide'));
    close.setAttribute('aria-label', t('aiStageHide'));
    parts.push(close);
    head.replaceChildren(...parts);

    // The panels, oldest first; only the ones that changed are drawn again.
    steps.forEach((step, at) => {
        const key = JSON.stringify([step.panel, step.answers]);
        const there = body.children[at];
        if (there?.dataset.panelKey === key) return;
        const item = el('section', 'anomalous-ai-stage-item');
        item.dataset.panelKey = key;
        item.dataset.panelId = step.panel.id;
        item.append(el('div', 'anomalous-ai-stage-item-step', t('aiStageStep', { number: ctx.numberOf(step.id) })), renderPanel(step, ctx));
        if (there) there.replaceWith(item);
        else body.append(item);
    });
    while (body.children.length > steps.length) body.lastElementChild.remove();

    const find = id => [...body.children].find(item => item.dataset.panelId === id);
    if (stage.focus) {
        const item = find(stage.focus);
        stage.focus = null;
        stage.placed = true;
        stage.atBottom = false;
        requestAnimationFrame(() => {
            scrollToItem(body, item);
            item?.classList.remove('is-flash');
            void item?.offsetWidth; // restart the flash
            item?.classList.add('is-flash');
        });
    } else if (arrived && stage.atBottom) {
        requestAnimationFrame(() => {
            if (stage.atBottom) scrollToLatest(body, stage);
        });
    }
    // A task's stage starts at its newest panel, as a conversation does: once it is first seen
    // (in a narrow window it may sit behind its tab until then).
    if (!stage.placed) {
        requestAnimationFrame(() => {
            if (stage.placed || !body.clientHeight) return;
            scrollToLatest(body, stage);
        });
    }
}
