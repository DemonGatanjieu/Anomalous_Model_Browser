/**
 * The AI workbench page: what AI apps did through Anomalous's MCP endpoint (api/ai_tasks.py).
 * The tasks on the left, newest first; on the right one task: its title and counts, what it
 * made (pictures, models, combos, sounds) as a strip on top, then its steps as a timeline,
 * reads folded into one row, each step with what it made and where that leads (the picture
 * in the viewer, the model's page, the combo, the canvas change found or undone). A task the
 * AI is still working on grows by itself ("anomalous.ai_task" events) and says so at the foot.
 * A panel the AI drew (show_panel) is shown on the stage, the column on the right (ui_ai_side.js),
 * with a line in the timeline that brings it there; its questions are answered there, and when it
 * comes while the user is elsewhere a toast says so. The task list can be folded away.
 * Under the timeline the user can write to the AI on that task; the message waits until the AI
 * asks (get_answers), and says whether it has. The list groups the tasks by day, each with
 * an icon for where it stands.
 * In a narrow window the list and the task take turns. The rules are in ai_task_view.js.
 * Also the home page's "What the AI did lately" and the rail entry's dot for news.
 */

import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { translate as t } from './locales.js';
import { dayLabel, fetchActivity, timeLabel } from './activity_log.js';
import { canUndo, undoEntry } from './canvas_undo.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { messageBox, updateMessageBox } from './ui_ai_message.js';
import { hidePanelToast, panelToast } from './ui_ai_panel.js';
import { focusPanel, openQuestions, panelLine, panelSteps, renderStage, stageNews, tabBar } from './ui_ai_side.js';
import { connectGuide, openConnectGuide } from './ui_ai_connect.js';
import { drawRecentAiTasks } from './ui_ai_recent.js';
import { locateNode, openModel, resultLinks, shared, strip } from './ui_ai_results.js';
import {
    duration, groupSteps, lookTools, stepDetail, taskCounts, taskResults, taskState, toolKey,
} from './ai_task_view.js';

const NARROW_PX = 720;
const STAGE_FROM = 760; // the room the timeline and the stage need side by side
const COLLAPSED_KEY = 'anomalous_ai_tasks_collapsed';
const STATE_ICONS = { waiting: '…', live: '●', asks: '?', error: '!', done: '✓' };
const RECENT_COUNT = 3;

const state = {
    owner: null,
    panel: null,
    page: null,
    tasks: [],
    selected: null,   // task id shown
    pinned: false,    // the user picked it: a new task of the AI does not take its place
    view: null,       // the shown task's parts kept between redraws (renderTask)
    stage: { taskId: null, latestKey: null, atBottom: true, focus: null, tab: 'timeline', unseen: false, hidden: false }, // ui_ai_side.js
    numbers: new Map(), // step id -> its number in the timeline (the stage shows it)
    tasksCollapsed: (() => { try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch (_) { return false; } })(),
    task: null,       // its full record
    entries: shared.entries, // activity entries of its canvas steps, for undo and locate (ui_ai_results.js)
    narrowView: 'list',
    refreshTimer: null,
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

const say = item => (item ? t(item.key, item.values) : '');
const visible = () => Boolean(state.panel?.isConnected && state.panel.style.display !== 'none');

async function getJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function postTask(id, body, action = '') {
    const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(id)}${action ? `/${action}` : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
}

const fetchTasks = (limit = 100) => getJson(`/anomalous/ai_tasks?limit=${limit}`).then(data => data.tasks || []);
const fetchTask = id => getJson(`/anomalous/ai_tasks/${encodeURIComponent(id)}`).then(data => data.task || null);

// ---------------------------------------------------------------- the list

function taskRow(summary) {
    const status = taskState(summary);
    const row = button(`anomalous-ai-task-row is-${status}${summary.id === state.selected ? ' is-current' : ''}`, '', () => {
        // Picking the newest task follows the AI again; an older one stays put.
        state.pinned = summary.id !== state.tasks[0]?.id;
        void select(summary.id);
    });
    const top = el('div', 'anomalous-ai-task-row-top');
    const icon = el('span', `anomalous-ai-state-icon is-${status}`, STATE_ICONS[status]);
    icon.title = t(`aiState_${status}`);
    top.append(icon, el('span', 'anomalous-ai-task-row-title', summary.title || t('aiUntitled')));
    if (status === 'live') top.append(el('span', 'anomalous-ai-live-dot'));
    const meta = [summary.client, timeLabel(summary.updated), t('aiStepCount', { count: summary.steps })].filter(Boolean);
    row.append(top, el('div', 'anomalous-ai-task-row-meta', meta.join(' · ')));
    const counts = taskCounts(summary);
    if (counts.length) row.append(el('div', 'anomalous-ai-task-row-counts', counts.map(say).join(' · ')));
    return row;
}

function renderList(box) {
    const head = el('div', 'anomalous-ai-tasks-head');
    head.append(el('span', 'anomalous-ai-tasks-title', t('aiTasks')), el('span', 'anomalous-ai-tasks-count', t('aiTaskCount', { count: state.tasks.length })),
        button('anomalous-ai-fold', '‹', () => foldTasks(true), t('aiTasksCollapse')));
    const actions = el('div', 'anomalous-ai-tasks-actions');
    actions.append(button('anomalous-ai-new-task', `＋ ${t('aiNewTask')}`, newTask, t('aiNewTaskHint')),
        button('anomalous-ai-link', t('aiConnect'), openConnectGuide));
    const list = el('div', 'anomalous-ai-tasks-list');
    // Newest first, under a heading for each day (today, yesterday, a date).
    let day = null;
    for (const summary of state.tasks) {
        const label = dayLabel(summary.updated);
        if (label !== day) {
            day = label;
            list.append(el('div', 'anomalous-ai-tasks-day', label));
        }
        list.append(taskRow(summary));
    }
    box.replaceChildren(head, actions, list);
}

// ---------------------------------------------------------------- one task

/** One step of the timeline; `number` is its place in the task (the dot shows it). */
function stepRow(step, number) {
    const row = el('div', `anomalous-ai-step is-${step.kind}${step.ok ? '' : ' is-failed'}`);
    row.append(el('span', 'anomalous-ai-step-dot', number));
    const body = el('div', 'anomalous-ai-step-body');
    const line = el('div', 'anomalous-ai-step-line');
    line.append(el('span', 'anomalous-ai-kind', t(`aiKind_${step.kind}`)), el('span', 'anomalous-ai-step-title', t(toolKey(step.tool))));
    const detail = step.kind === 'panel' ? '' : stepDetail(step);
    if (detail) {
        const text = el('span', 'anomalous-ai-step-detail', detail);
        text.title = detail;
        line.append(text);
    }
    body.append(line);
    if (step.kind === 'user') {
        body.append(el('div', 'anomalous-ai-user-text', step.text),
            el('div', 'anomalous-ai-user-state', t(step.delivered ? 'aiMessageSeen' : 'aiMessageWaiting')));
    } else if (step.text) {
        body.append(el('div', 'anomalous-ai-note-text', step.text));
    }
    if (step.kind === 'panel' && state.task) {
        body.append(panelLine(step, () => showOnStage(step.panel.id)));
    }
    if (step.error) body.append(el('div', 'anomalous-ai-step-error', step.error));
    if (step.state === 'running') body.append(el('div', 'anomalous-ai-step-running', t('aiRunRunning')));
    const links = resultLinks(step);
    if (links) body.append(links);
    const when = el('div', 'anomalous-ai-step-when');
    when.append(el('span', '', timeLabel(step.at)));
    const took = duration(step.ms);
    if (took) when.append(el('span', '', say(took)));
    row.append(body, when);
    return row;
}

function looksRow(steps, number) {
    const row = el('div', 'anomalous-ai-step is-look is-folded');
    row.append(el('span', 'anomalous-ai-step-dot', number));
    const body = el('div', 'anomalous-ai-step-body');
    const tools = lookTools(steps).map(({ tool, count }) => (count > 1 ? `${t(toolKey(tool))} ×${count}` : t(toolKey(tool))));
    const head = button('anomalous-ai-looks', `${t('aiLooks', { count: steps.length })}：${tools.join('、')}`, () => {
        details.hidden = !details.hidden;
        head.setAttribute('aria-expanded', String(!details.hidden));
    });
    head.setAttribute('aria-expanded', 'false');
    const details = el('div', 'anomalous-ai-looks-details');
    details.hidden = true;
    for (const step of steps) {
        const detail = stepDetail(step);
        const found = Number.isFinite(step.count) ? t('aiFound', { count: step.count }) : '';
        details.append(el('div', 'anomalous-ai-look', [timeLabel(step.at), t(toolKey(step.tool)), detail, found].filter(Boolean).join(' · ')));
    }
    body.append(head, details);
    row.append(body, el('div', 'anomalous-ai-step-when', timeLabel(steps[0].at)));
    return row;
}

async function undoAll(task) {
    const entries = taskResults(task).canvas.map(result => state.entries.get(result.activity)).filter(Boolean).reverse();
    const undoable = entries.filter(entry => canUndo(app, entry));
    if (!undoable.length || !await anomalousConfirm(t('aiUndoAllConfirm', { count: undoable.length }), t('aiUndoAll'))) return;
    for (const entry of entries) {
        if (!canUndo(app, entry)) break; // a later change of the user's is in the way: stop there
        try { undoEntry(app, entry); } catch (_) { break; }
    }
    renderTask();
}

function renderTask() {
    const box = state.page?.querySelector('.anomalous-ai-task');
    if (!box) return;
    const task = state.task;
    if (!task) {
        box.replaceChildren(el('div', 'anomalous-ai-empty-task', state.tasks.length ? t('aiPickTask') : ''));
        return;
    }
    const keepBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const keepTop = box.scrollTop;
    const summary = state.tasks.find(item => item.id === task.id) || {};
    const status = taskState(summary);
    // The task's parts stay in the page between redraws (the AI's steps come in all the time):
    // only what changed is drawn again, so a scrolled strip or diagram and half-typed text stay.
    let view = state.view;
    if (!view || view.taskId !== task.id || !box.contains(view.timeline)) {
        view = state.view = {
            taskId: task.id, header: el('div', 'anomalous-ai-task-head'), made: el('div', 'anomalous-ai-made-holder'),
            timeline: el('div', 'anomalous-ai-timeline'), madeKey: null,
            message: messageBox(async (text) => {
                await postTask(task.id, { text }, 'message');
                await refresh();
            }),
        };
        view.tabs = el('div', 'anomalous-ai-tabs');
        box.replaceChildren(view.tabs, view.header, view.made, view.timeline, view.message);
    }
    // A new panel that asks something brings the stage forward when the window is narrow.
    const news = stageNews(task, state.stage);
    if (news.asking) state.stage.tab = 'stage';
    const asking = panelSteps(task).reduce((sum, step) => sum + openQuestions(step), 0);
    const tabs = tabBar(state.stage, asking, pickTab);
    view.tabs.replaceWith(tabs);
    view.tabs = tabs;
    const header = view.header;
    const titleLine = el('div', 'anomalous-ai-task-title-line');
    titleLine.append(button('anomalous-ai-back', `‹ ${t('aiAllTasks')}`, () => { state.narrowView = 'list'; layout(); }),
        button('anomalous-ai-unfold', '›', () => foldTasks(false), t('aiTasksExpand')),
        el('h2', 'anomalous-ai-task-title', task.title || t('aiUntitled')),
        el('span', `anomalous-ai-state is-${status}`, t(`aiState_${status}`)));
    const tools = el('div', 'anomalous-ai-task-tools');
    if (state.stage.hidden && panelSteps(task).length) {
        tools.append(button('anomalous-ai-link', t('aiStageShow'), () => pickTab('stage')));
    }
    tools.append(button('anomalous-ai-link', t('aiRename'), async () => {
        const title = await anomalousPrompt(t('aiRenamePrompt'), task.title || '', t('aiRename'));
        if (title === null || title === undefined) return;
        await postTask(task.id, { title }).catch(error => anomalousAlert(error.message));
        await refresh();
    }));
    if (taskResults(task).canvas.some(result => state.entries.has(result.activity) && canUndo(app, state.entries.get(result.activity)))) {
        tools.append(button('anomalous-ai-link', t('aiUndoAll'), () => undoAll(task)));
    }
    tools.append(button('anomalous-ai-link is-danger', t('aiRemove'), async () => {
        if (!await anomalousConfirm(t('aiRemoveConfirm'), t('aiRemove'))) return;
        await postTask(task.id, { remove: true }).catch(error => anomalousAlert(error.message));
        state.selected = null;
        state.task = null;
        state.narrowView = 'list';
        await refresh();
    }));
    titleLine.append(tools);
    const meta = [task.client, `${dayLabel(task.started)} ${timeLabel(task.started)}`, t('aiStepCount', { count: (task.steps || []).length }),
        ...taskCounts(summary).map(say)].filter(Boolean);
    header.replaceChildren(titleLine, el('div', 'anomalous-ai-task-meta', meta.join(' · ')));

    const madeKey = JSON.stringify(taskResults(task));
    if (madeKey !== view.madeKey) {
        view.madeKey = madeKey;
        const made = strip(task);
        view.made.replaceChildren(...(made ? [made] : []));
    }

    // Numbered in the order they happened, so the timeline reads 1, 2, 3 from the top.
    const items = groupSteps(task.steps);
    const rows = items.map((item, at) => (item.type === 'looks'
        ? { key: JSON.stringify(['looks', at, item.steps]), make: () => looksRow(item.steps, at + 1) }
        : { key: JSON.stringify(['step', at, item.step, undoable(item.step)]), make: () => stepRow(item.step, at + 1) }));
    state.numbers = new Map(items.flatMap((item, at) => (item.type === 'looks' ? item.steps : [item.step]).map(step => [step.id, at + 1])));
    // A task the user started waits for an AI: how to get one on it.
    if (!items.length && task.waiting) rows.push({ key: `waiting:${task.title}`, make: () => waitingCard(task) });
    else if (!items.length) rows.push({ key: 'empty', make: () => el('div', 'anomalous-ai-empty-task', t('aiNoSteps')) });
    if (status === 'live') {
        // What comes next: the following number, waiting.
        const running = (task.steps || []).some(step => step.state === 'running');
        rows.push({
            key: `next:${items.length}:${running}`,
            make: () => {
                const next = el('div', 'anomalous-ai-step is-next');
                next.append(el('span', 'anomalous-ai-step-dot', items.length + 1), el('div', 'anomalous-ai-working', t(running ? 'aiRunRunning' : 'aiWorking')));
                return next;
            },
        });
    }
    syncRows(view.timeline, rows);
    updateMessageBox(view.message, Boolean(task.ended), status);
    box.scrollTop = keepBottom && status === 'live' ? box.scrollHeight : keepTop;
    drawStage(task, news.arrived);
}

/** An empty task the user started: say what to tell the AI, and how to connect one. */
function waitingCard(task) {
    const card = el('div', 'anomalous-ai-waiting');
    card.append(el('div', 'anomalous-ai-waiting-title', t('aiWaitingTitle')), el('p', 'anomalous-ai-waiting-body', t('aiWaitingBody')), connectGuide(task.title));
    return card;
}

/** The stage beside the timeline, while the task has panels. */
function drawStage(task, arrived = null) {
    const stage = state.page?.querySelector('.anomalous-ai-stage');
    if (!stage) return;
    const has = panelSteps(task).length > 0;
    state.page.classList.toggle('has-stage', has && !state.stage.hidden);
    if (!has) {
        stage.replaceChildren();
        layout();
        return;
    }
    renderStage(stage, task, state.stage, {
        taskId: task.id,
        owner: state.owner,
        openPicture: (url, video) => state.owner?.showGalleryViewer?.(url, video),
        openModel,
        locateNode: id => locateNode(id, null),
        changed: () => void refresh(),
        numberOf: id => state.numbers.get(id) || '',
        tab: pickTab,
        close: () => {
            state.stage.hidden = true;
            state.stage.tab = 'timeline';
            renderTask();
        },
    }, arrived);
    layout();
}

function showOnStage(panelId) {
    if (!state.task) return;
    focusPanel(state.stage, panelId);
    renderTask();
}

/** New task: the user starts one; the next AI app that calls takes it over. */
async function newTask() {
    const title = await anomalousPrompt(t('aiNewTaskPrompt'), '', t('aiNewTask'));
    if (title === null || title === undefined) return;
    try {
        const response = await fetch('/anomalous/ai_tasks', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
        state.selected = data.task.id;
        state.pinned = false;
        state.narrowView = 'task';
        await refresh();
    } catch (error) {
        await anomalousAlert(error.message);
    }
}

function pickTab(id) {
    if (id === 'stage') state.stage.hidden = false;
    state.stage.tab = id;
    renderTask();
}

function foldTasks(folded) {
    state.tasksCollapsed = folded;
    try { localStorage.setItem(COLLAPSED_KEY, folded ? '1' : '0'); } catch (_) { /* this viewer's convenience */ }
    layout();
}

/** Which canvas changes of a step can be undone now (part of when its row is drawn again). */
function undoable(step) {
    return (step.results || []).filter(result => result.type === 'canvas')
        .map(result => state.entries.has(result.activity) && canUndo(app, state.entries.get(result.activity)));
}

/** Rows into `parent` in this order, keeping those whose key is the same (they are not touched). */
function syncRows(parent, rows) {
    rows.forEach((row, at) => {
        const there = parent.children[at];
        if (there?.dataset.rowKey === row.key) return;
        const made = row.make();
        made.dataset.rowKey = row.key;
        if (there) there.replaceWith(made);
        else parent.append(made);
    });
    while (parent.children.length > rows.length) parent.lastElementChild.remove();
}

async function loadEntries(task) {
    const wanted = new Set(taskResults(task).canvas.map(result => result.activity));
    if (!wanted.size || [...wanted].every(id => state.entries.has(id))) return;
    const entries = await fetchActivity({ limit: 500, source: 'canvas' }).catch(() => []);
    for (const entry of entries) if (wanted.has(entry.id)) state.entries.set(entry.id, entry);
}

async function select(id) {
    state.selected = id;
    state.narrowView = 'task';
    state.page?.querySelectorAll('.anomalous-ai-task-row').forEach(row => row.classList.remove('is-current'));
    renderList(state.page.querySelector('.anomalous-ai-tasks'));
    layout();
    const task = await fetchTask(id).catch(() => null);
    if (state.selected !== id) return;
    state.task = task;
    if (task) await loadEntries(task);
    if (state.selected === id) renderTask();
}

// ---------------------------------------------------------------- the page

function layout() {
    const page = state.page;
    if (!page) return;
    const width = page.clientWidth;
    const narrow = width > 0 && width < NARROW_PX;
    const folded = state.tasksCollapsed && !narrow;
    page.classList.toggle('is-narrow', narrow);
    page.classList.toggle('shows-task', narrow && state.narrowView === 'task' && Boolean(state.selected));
    page.classList.toggle('tasks-collapsed', folded);
    // Three columns when there is room; else the timeline and the stage take turns behind tabs.
    const room = width - (narrow || folded ? 0 : 260);
    const tabbed = page.classList.contains('has-stage') && (narrow || room < STAGE_FROM);
    page.classList.toggle('is-tabbed', tabbed);
    page.classList.toggle('shows-stage', tabbed && state.stage.tab === 'stage');
}

function emptyPage() {
    const box = el('div', 'anomalous-ai-welcome');
    box.append(el('h2', 'anomalous-ai-welcome-title', t('aiWelcomeTitle')), el('p', 'anomalous-ai-welcome-body', t('aiWelcomeBody')),
        connectGuide(), button('anomalous-ai-new-task', `＋ ${t('aiNewTask')}`, newTask, t('aiNewTaskHint')));
    return box;
}

async function refresh() {
    if (!state.page) return;
    const tasks = await fetchTasks().catch(() => null);
    if (!tasks || !state.page) return;
    state.tasks = tasks;
    if (!tasks.length) {
        state.page.replaceChildren(emptyPage());
        state.page.classList.add('is-empty');
        return;
    }
    if (state.page.classList.contains('is-empty') || !state.page.querySelector('.anomalous-ai-tasks')) {
        state.page.classList.remove('is-empty');
        state.page.replaceChildren(el('aside', 'anomalous-ai-tasks'), el('section', 'anomalous-ai-task'), el('section', 'anomalous-ai-stage'));
    }
    // The newest task while the AI works on it, unless the user picked another one.
    const follow = !state.pinned && tasks[0].live && tasks[0].id !== state.selected;
    if (follow || !tasks.some(task => task.id === state.selected)) {
        state.selected = tasks[0].id;
        state.pinned = false;
        state.task = null;
    }
    renderList(state.page.querySelector('.anomalous-ai-tasks'));
    const task = await fetchTask(state.selected).catch(() => null);
    state.task = task;
    if (task) await loadEntries(task);
    renderTask();
    layout();
}

/** The whole page into `panel`. */
export function renderAiWorkbench(owner, panel) {
    state.owner = owner;
    shared.owner = owner;
    state.panel = panel;
    if (!state.page || state.page.parentNode !== panel) {
        state.page = el('div', 'anomalous-ai');
        panel.replaceChildren(state.page);
        if (typeof ResizeObserver === 'function') new ResizeObserver(layout).observe(state.page);
    }
    owner.railNews?.('ai', false);
    hidePanelToast();
    void refresh();
}

/** Once: the server's "anomalous.ai_task" event refreshes the page, the home list and the rail's dot. */
export function watchAiTasks(owner) {
    state.owner = owner;
    shared.owner = owner;
    api.addEventListener('anomalous.ai_task', (event) => {
        const detail = event?.detail || {};
        const onPage = () => owner.modal?.classList.contains('visible') && owner.currentShellPage?.() === 'ai' && visible();
        if (detail.panel && !onPage()) panelToast(owner, String(detail.panel), Boolean(detail.asks));
        clearTimeout(state.refreshTimer);
        state.refreshTimer = setTimeout(() => {
            if (onPage()) void refresh();
            else owner.railNews?.('ai', true);
            if (owner.currentShellPage?.() === 'home') owner.onActivityRecorded?.();
        }, 300);
    });
}

/** The home page's short list (ui_ai_recent.js); a row opens its task here. */
export function renderRecentAiTasks(owner, container) {
    drawRecentAiTasks(owner, container, {
        fetchTasks: () => fetchTasks(RECENT_COUNT),
        open: (summary, newest) => {
            state.selected = summary.id;
            state.pinned = summary.id !== newest;
            owner.goTo('ai');
        },
    });
}
