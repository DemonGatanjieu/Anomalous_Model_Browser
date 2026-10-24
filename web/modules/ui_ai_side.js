/**
 * The AI workbench's stage (展台): the column on the right where the panels the AI draws are
 * shown (ui_ai_panel.js), so they stay in view however many steps come after them. Like the
 * timeline it reads from the top down: the task's panels in the order they came, each with its
 * step number, the newest at the bottom. A new or updated latest panel follows to the bottom
 * while the user is there; otherwise a "See latest ↓" button says it changed. A panel's card in
 * the timeline (what it holds, "Show on the right") brings the stage to that panel, and says so
 * while that panel is in view on the stage. A new panel opens the column on the stage, even after the user
 * closed it or was on another view, unless they turned that off in its head (kept on this browser).
 * In a window too narrow for three columns, the timeline and the side column take turns behind
 * two tabs: a panel that asks something brings the stage forward, another lights its tab.
 * The stage is one of the side column's views (ui_ai_side_views.js).
 *
 * `stage` is the workbench's `{ taskId, latestKey, latestPanel, atBottom, focus, tab, view, mapStep, unseen, placed, hidden, lit,
 * outputsSeen }` (`outputsSeen`: ui_ai_outputs.js newOutputs).
 */

import { translate as t } from './locales.js';
import { panelGist, panelPassed } from './ai_task_view.js';
import { renderPanel } from './ui_ai_panel.js';
import { icon, iconButton } from './ui_ai_icons.js';

export const QUESTIONS = ['choices', 'input', 'picks'];
const BOTTOM_PX = 60;
const AUTO_KEY = 'anomalous_ai_stage_auto';
const inView = new Set(); // the panels in view on the stage now: their cards in the timeline say so

/** Whether a new panel opens the column (the user's choice on this browser; on unless they turned it off). */
function autoOpen() {
    try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch (_) { return true; }
}

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
 * What changed on the stage since the last look, updating `stage`: `{ arrived, asking, fresh }` -
 * `arrived` the latest panel when it is new or updated, `asking` its open questions, `fresh`
 * whether it is a new panel (the AI changing one, a progress bar, does not count).
 */
export function stageNews(task, stage) {
    const steps = panelSteps(task);
    const latest = steps.at(-1);
    const latestKey = JSON.stringify(latest?.panel || null);
    if (stage.taskId !== task?.id) {
        Object.assign(stage, { taskId: task?.id, latestKey, latestPanel: latest?.id, atBottom: true, focus: null, unseen: false, placed: false,
            hidden: false, view: 'stage', mapStep: null, lit: false, outputsSeen: null });
        return { arrived: null, asking: 0, fresh: false };
    }
    const arrived = latestKey !== stage.latestKey ? latest : null;
    const fresh = Boolean(arrived) && arrived.id !== stage.latestPanel;
    Object.assign(stage, { latestKey, latestPanel: latest?.id });
    if (arrived && !stage.atBottom) stage.unseen = true;
    return { arrived, asking: arrived ? openQuestions(arrived) : 0, fresh };
}

/**
 * Brings the stage forward for `news` (stageNews): a panel that asks shows it (in a narrow window
 * `tabbed`, its tab comes forward); a new one opens the column on the stage at its newest panel
 * when the user lets it, lighting the tab of a narrow window instead of taking it.
 */
export function bringStage(stage, news, tabbed) {
    const open = news.fresh && autoOpen();
    if (news.asking || open) stage.view = 'stage';
    if (open) Object.assign(stage, { hidden: false, atBottom: true });
    if (news.asking || (open && !tabbed)) stage.tab = 'stage';
    else if (open) stage.lit = stage.tab !== 'stage';
}

/** The switch in the stage's head: whether a new panel opens the column. */
function autoSwitch() {
    const on = autoOpen();
    const node = button(`anomalous-ai-stage-auto${on ? ' is-on' : ''}`, '', () => {
        const now = !node.classList.contains('is-on');
        try { localStorage.setItem(AUTO_KEY, now ? '1' : '0'); } catch (_) { /* only this time */ }
        node.classList.toggle('is-on', now);
        node.setAttribute('aria-checked', String(now));
    }, t('aiStageAutoTip'));
    node.setAttribute('role', 'switch');
    node.setAttribute('aria-checked', String(on));
    node.append(el('span', 'anomalous-ai-stage-auto-track'), el('span', 'anomalous-ai-stage-auto-label', t('aiStageAuto')));
    return node;
}

/** The head of a side column view: its title, `more` beside it, × to close the column. */
export function sideHead(title, close, ...more) {
    const box = el('div', 'anomalous-ai-stage-head');
    box.append(el('span', 'anomalous-ai-stage-title', title), ...more, el('span', 'anomalous-ai-gap'),
        button('anomalous-ai-stage-close', '×', close, t('aiSideHide')));
    box.lastChild.setAttribute('aria-label', t('aiSideHide'));
    return box;
}

/** The stage goes to panel `panelId` (from its line in the timeline). */
export function focusPanel(stage, panelId) {
    stage.hidden = false;
    stage.focus = panelId;
    stage.view = 'stage';
    stage.tab = 'stage';
}

/**
 * The timeline's card for a panel step: what it holds (an icon, its title, a line of what is in
 * it), whether it waits for you, and the button to it, which says "on the right now" while the
 * panel is in view on the stage. The whole card opens it too.
 */
export function panelLine(step, onOpen) {
    const asks = openQuestions(step);
    const gist = panelGist(step.panel);
    const line = el('div', `anomalous-ai-panel-line${asks ? ' is-asking' : ''}${inView.has(step.panel.id) ? ' is-shown' : ''}`);
    line.dataset.panelId = step.panel.id;
    line.title = t('aiStageOpen');
    line.onclick = onOpen;
    const words = el('span', 'anomalous-ai-panel-line-words');
    words.append(el('span', 'anomalous-ai-panel-line-title', step.panel.title || t('aiStage')));
    if (gist.parts.length) words.append(el('span', 'anomalous-ai-panel-line-gist', gist.parts.map(part => t(part.key, part.values)).join(' · ')));
    line.append(icon(gist.icon, 18, 'anomalous-ai-panel-line-icon'), words);
    if (asks) line.append(el('span', 'anomalous-ai-panel-line-asks', t('aiState_asks')));
    const here = el('span', 'anomalous-ai-panel-line-here');
    here.append(el('span', 'anomalous-ai-panel-line-dot'), el('span', '', t('aiStageHere')));
    line.append(iconButton('anomalous-ai-side-open', 'sidebar', t('aiStageGo'), (event) => {
        event.stopPropagation(); // the card's own click would open it a second time
        onOpen();
    }, { size: 14 }), here);
    return line;
}

/** The cards in the timeline of `page` say which panels are in view on the stage. */
function markInView(page) {
    page?.querySelectorAll('.anomalous-ai-panel-line[data-panel-id]').forEach(line => line.classList.toggle('is-shown', inView.has(line.dataset.panelId)));
}

/** The two tabs of a narrow window: the timeline and the side column's view `label` (lit while a question waits or a new panel is unseen). */
export function tabBar(stage, asks, onPick, label = t('aiStage')) {
    const bar = el('div', 'anomalous-ai-tabs');
    for (const id of ['timeline', 'stage']) {
        const lit = id === 'stage' && (asks || (stage.lit && stage.tab !== 'stage'));
        const tab = button(`anomalous-ai-tab${stage.tab === id ? ' is-on' : ''}${lit ? ' is-asking' : ''}`, id === 'stage' ? label : t('aiTimeline'), () => {
            if (id === 'stage') stage.lit = false;
            onPick(id);
        });
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
 * step's number in the timeline) and `close()`. A panel is drawn again only when it changed, so
 * its scroll and half-typed answers stay while the AI works.
 */
export function renderStage(box, task, stage, ctx, arrived = null) {
    const steps = panelSteps(task);
    const asks = steps.reduce((sum, item) => sum + openQuestions(item), 0);
    let head = box.querySelector(':scope > .anomalous-ai-stage-head');
    let body = box.querySelector(':scope > .anomalous-ai-stage-body');
    const fresh = !body || box.dataset.taskId !== task.id;
    if (fresh) {
        head = el('div', 'anomalous-ai-stage-head');
        body = el('div', 'anomalous-ai-stage-body');
        box.dataset.taskId = task.id;
        box.replaceChildren(head, body);
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
        box.inView?.disconnect();
        inView.clear();
        box.inView = typeof IntersectionObserver === 'function' ? new IntersectionObserver((seen) => {
            for (const entry of seen) inView[entry.isIntersecting ? 'add' : 'delete'](entry.target.dataset.panelId);
            markInView(box.closest('.anomalous-ai'));
        }, { root: body, threshold: 0.3 }) : null;
    }
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
    parts.push(autoSwitch(), close);
    head.replaceChildren(...parts);

    // The panels, oldest first; only the ones that changed are drawn again.
    steps.forEach((step, at) => {
        // An AI's progress bar the task went past is old numbers, drawn as such (ui_ai_panel.js).
        const passed = (step.panel.blocks || []).some(block => block?.type === 'progress') ? panelPassed(task, step) : 0;
        const key = JSON.stringify([step.panel, step.answers, passed]);
        const there = body.children[at];
        if (there?.dataset.panelKey === key) return;
        const item = el('section', 'anomalous-ai-stage-item');
        item.dataset.panelKey = key;
        item.dataset.panelId = step.panel.id;
        item.append(el('div', 'anomalous-ai-stage-item-step', t('aiStageStep', { number: ctx.numberOf(step.id) })), renderPanel(step, { ...ctx, passed }));
        if (there) {
            box.inView?.unobserve(there);
            there.replaceWith(item);
        } else body.append(item);
        box.inView?.observe(item);
    });
    while (body.children.length > steps.length) {
        box.inView?.unobserve(body.lastElementChild);
        inView.delete(body.lastElementChild.dataset.panelId);
        body.lastElementChild.remove();
    }

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
