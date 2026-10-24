/**
 * The AI workbench page: what AI apps did through Anomalous's MCP endpoint (api/ai_tasks.py).
 * The tasks on the left, newest first; on the right one task: its title and counts, a line
 * counting what it made that opens the Results view (ui_ai_outputs.js), then its steps as a timeline,
 * the AI's work in a row folded into one (ui_ai_chain.js), each step with what it made and where that leads (the picture
 * in the viewer, the model's page, the combo, the canvas change found or undone). A task the
 * AI is still working on grows by itself ("anomalous.ai_task" events) and says so at the foot.
 * The column on the right shows one view, picked by the switch at the top right
 * in the window's title bar (ui_ai_side_views.js): the stage with the panels the AI drew (ui_ai_side.js; a line in the
 * timeline brings it there, its questions are answered there, a toast says so while the user is
 * elsewhere), a run's shape at full size, the materials picker, or what the task made. The header stays on top while
 * the timeline scrolls. The task list folds from the title bar's button and peeks from it.
 * Under a task's title, the task it goes on from and those going on from it (ui_ai_task_links.js).
 * A step's words are ui_ai_step_body.js's; a decision the AI records shows as a card and the
 * side column's "Decisions" view lists all of the task's (ui_ai_decisions.js).
 * A task opens at its newest step and stays there as steps come in while the user reads at the
 * foot; read further up, it stays put and a button over the message box leads down (ui_ai_newest.js).
 * Under the timeline the user can write to the AI on that task; the message waits until the AI
 * asks (get_answers) or runs its next step, and says whether it has. The list groups the tasks
 * by day, each with an icon for where it stands.
 * In a narrow window the list and the task take turns. The rules are in ai_task_view.js.
 * Also the home page's "What the AI did lately" and the rail entry's dot for news.
 */

import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { translate as t } from './locales.js';
import { dayLabel, fetchActivity, timeLabel } from './activity_log.js';
import { canUndo } from './canvas_undo.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { messageBox, updateMessageBox } from './ui_ai_message.js';
import { atFoot, newestButton } from './ui_ai_newest.js';
import { nowStrip } from './ui_ai_now.js';
import { taskCommands } from './ui_ai_commands.js';
import { hidePanelToast, panelToast } from './ui_ai_panel.js';
import { bringStage, focusPanel, openQuestions, panelLine, panelSteps, stageBadge, stageNews, tabBar } from './ui_ai_side.js';
import { connectHint } from './ui_ai_connect.js';
import { waitingView } from './ui_ai_ready.js';
import { gateCard } from './ui_ai_gate.js';
import { iconButton } from './ui_ai_icons.js';
import { listToggle, renderTaskList, stateIcon } from './ui_ai_task_list.js';
import { flowMap } from './ui_ai_flow.js';
import { drawRecentAiTasks } from './ui_ai_recent.js';
import { locateNode, openModel, resultLinks, shared, updateRunProgress } from './ui_ai_results.js';
import { drawOutputsLine, newOutputs } from './ui_ai_outputs.js';
import { compareBar, setMarker } from './ui_ai_images.js';
import { openMarker } from './ui_ai_marker.js';
import { toolboxCount } from './ui_ai_toolbox.js';
import { stepBody } from './ui_ai_step_body.js';
import { chainRow, looksRow, undoChanges } from './ui_ai_chain.js';
import { taskLinks } from './ui_ai_task_links.js';
import { TIMELINE_MIN, connectSide, drawSide, pickView, sideShown, sideSwitch, sideWidth, viewLabel } from './ui_ai_side_views.js';
import { executionStatus } from './ui_ai_status.js';
import { canvasControls } from './ui_ai_task_canvas.js';
import {
    activityIds, duration, groupSteps, stepDetail, taskCounts, taskResults, taskState, toolKey,
} from './ai_task_view.js';

const NARROW_PX = 720;
const SHORT_PX = 880; // a window this low (not maximised) keeps the task's head to one line
const COLLAPSED_KEY = 'anomalous_ai_tasks_collapsed';
const RECENT_COUNT = 3;

const state = {
    owner: null,
    panel: null,
    page: null,
    tasks: [],
    selected: null,   // task id shown
    pinned: false,    // the user picked it: a new task of the AI does not take its place
    view: null,       // the shown task's parts kept between redraws (renderTask)
    stage: { taskId: null, latestKey: null, atBottom: true, focus: null, tab: 'timeline', view: 'stage', mapStep: null, unseen: false, hidden: false, outputsSeen: null }, // ui_ai_side.js
    numbers: new Map(), // step id -> its number in the timeline (the stage shows it)
    tasksCollapsed: (() => { try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch (_) { return false; } })(),
    task: null,       // its full record
    entries: shared.entries, // activity entries of its canvas steps, for undo and locate (ui_ai_results.js)
    narrowView: 'list',
    refreshTimer: null,
    request: 0,       // newer navigation/refresh invalidates older responses
    observer: null,
    bar: null,        // the ticked pictures' compare bar (ui_ai_images.js), made once
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

function renderList(box) {
    renderTaskList(box, {
        tasks: state.tasks, selected: state.selected, onNew: newTask,
        // Picking the newest task follows the AI again; an older one stays put.
        onPick: (summary) => { state.pinned = summary.id !== state.tasks[0]?.id; void select(summary.id); },
    });
}

// ---------------------------------------------------------------- one task

/** One step of the timeline; `number` is its place in the task (the dot shows it). */
function stepRow(step, number) {
    const running = step.state === 'running';
    const row = el('div', `anomalous-ai-step is-${step.kind}${step.ok ? '' : ' is-failed'}${running ? ' is-running' : ''}${step.state === 'asking' ? ' is-asking' : ''}`);
    row.dataset.stepIds = step.id;
    row.append(el('span', 'anomalous-ai-step-dot', number));
    const body = el('div', 'anomalous-ai-step-body');
    const line = el('div', 'anomalous-ai-step-line');
    line.append(el('span', 'anomalous-ai-kind', t(`aiKind_${step.kind}`)), el('span', 'anomalous-ai-step-title', t(toolKey(step.tool))));
    const detail = ['panel', 'outside'].includes(step.kind) || step.tool === 'user_activity' ? '' : stepDetail(step); // their body says it
    if (detail) {
        const text = el('span', 'anomalous-ai-step-detail', detail);
        text.title = detail;
        line.append(text);
    }
    body.append(line, ...stepBody(step, { taskId: state.task?.id, owner: state.owner, entries: state.entries, numberOf: id => state.numbers.get(id) }));
    const other = step.reply_to || step.replied;
    if (other) {
        body.append(iconButton(`anomalous-ai-reply-link${step.replied ? ' is-replied' : ''}`, step.replied ? 'chat' : 'undo',
            t(step.replied ? 'aiReplied' : 'aiReplyTo', { number: state.numbers.get(other) ?? '' }), () => showStep(state.view.timeline, other)));
    }
    if (step.kind === 'panel' && state.task) {
        body.append(panelLine(step, () => showOnStage(step.panel.id)));
    }
    const gate = state.task && gateCard(step, state.task.id, () => void refresh());
    if (gate) body.append(gate);
    if (step.error && !gate) body.append(el('div', 'anomalous-ai-step-error', step.error));
    if (step.state === 'cancelled') body.append(el('div', 'anomalous-ai-step-cancelled', t(step.stop === 'user' ? 'aiRunCancelledByYou' : 'aiRunCancelledByAi')));
    if (running && step.kind !== 'run') body.append(el('div', 'anomalous-ai-step-running', t('aiStepRunning')));
    const links = resultLinks(step, renderTask);
    if (links) body.append(links);
    const when = el('div', 'anomalous-ai-step-when');
    when.append(el('span', '', timeLabel(step.at)));
    const took = duration(step.ms);
    if (took) when.append(el('span', '', say(took)));
    row.append(body, when);
    return row;
}

async function undoAll(task) {
    if (await undoChanges(task.steps, state.entries, t('aiUndoAll'), 'aiUndoAllConfirm')) renderTask();
}

function renderTask() {
    const box = state.page?.querySelector('.anomalous-ai-task');
    if (!box) return;
    const task = state.task;
    if (!task) {
        box.replaceChildren(el('div', 'anomalous-ai-empty-task', state.tasks.length ? t('aiPickTask') : ''));
        state.owner?.headerTools?.replaceChildren();
        return;
    }
    const keepBottom = atFoot(box);
    const keepTop = box.scrollTop;
    const summary = state.tasks.find(item => item.id === task.id) || {};
    const status = taskState(summary);
    // The task's parts stay in the page between redraws (the AI's steps come in all the time):
    // only what changed is drawn again, so a scrolled strip or diagram and half-typed text stay.
    let view = state.view;
    const fresh = !view || view.taskId !== task.id || !box.contains(view.timeline);
    if (fresh) {
        view = state.view = {
            taskId: task.id, header: el('div', 'anomalous-ai-task-head'), flow: el('div', 'anomalous-ai-flow-holder'),
            made: el('div', 'anomalous-ai-made-holder'),
            timeline: el('div', 'anomalous-ai-timeline'),
            message: messageBox(async (text, refs) => {
                await postTask(task.id, { text, refs }, 'message');
                await refresh();
                box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); // what one sent, in view
            }, { task: () => state.task, commands: () => taskCommands({ task: () => state.task, undo: () => undoAll(state.task), newTask,
                side: view => pickView(state.stage, view, false, state.task, renderTask, refresh), changed: refresh }),
            mark: (image, sent) => openMarker(image, task.id, () => { sent(); void refresh(); }),
            openMaterials: () => pickView(state.stage, 'toolbox', false, state.task, renderTask, () => void refresh()) }),
            seen: (task.steps || []).length, newest: newestButton(box), now: nowStrip(), dock: el('div', 'anomalous-ai-dock'),
        };
        view.tabs = el('div', 'anomalous-ai-tabs');
        view.dock.append(view.newest, view.now, view.message); // at the foot of the column, in view while the timeline scrolls
        box.replaceChildren(view.tabs, view.header, view.flow, view.made, view.timeline, view.dock);
    }
    // A new panel opens the stage; in a narrow window only one that asks something takes its tab.
    const news = stageNews(task, state.stage);
    bringStage(state.stage, news, state.page.classList.contains('is-tabbed') || state.page.classList.contains('is-narrow'));
    const asking = panelSteps(task).reduce((sum, step) => sum + openQuestions(step), 0);
    const tabs = tabBar(state.stage, asking, pickTab, viewLabel(state.stage.view));
    view.tabs.replaceWith(tabs);
    view.tabs = tabs;
    const header = view.header;
    const titleLine = el('div', 'anomalous-ai-task-title-line');
    titleLine.append(button('anomalous-ai-back', `‹ ${t('aiAllTasks')}`, () => { state.narrowView = 'list'; layout(); }),
        el('h2', 'anomalous-ai-task-title', task.title || t('aiUntitled')), stateChip(status));
    const tools = el('div', 'anomalous-ai-task-tools');
    tools.append(executionStatus(task, refresh), canvasControls(task, () => void refresh(), () => state.owner?.close?.()));
    if (taskResults(task).canvas.some(result => state.entries.has(result.activity) && canUndo(app, state.entries.get(result.activity)))) {
        tools.append(iconButton('anomalous-ai-tool', 'undo', t('aiUndoAll'), () => undoAll(task)));
    }
    tools.append(iconButton('anomalous-ai-tool is-icon', 'pencil', t('aiRename'), async () => {
        const title = await anomalousPrompt(t('aiRenamePrompt'), task.title || '', t('aiRename'));
        if (title === null || title === undefined) return;
        await postTask(task.id, { title }).catch(error => anomalousAlert(error.message));
        await refresh();
    }, { iconOnly: true }), iconButton('anomalous-ai-tool is-icon is-danger', 'trash', t('aiRemove'), async () => {
        if (!await anomalousConfirm(t('aiRemoveConfirm'), t('aiRemove'))) return;
        await postTask(task.id, { remove: true }).catch(error => anomalousAlert(error.message));
        state.selected = null;
        state.task = null;
        state.narrowView = 'list';
        await refresh();
    }, { iconOnly: true }));
    const shown = sideShown(state.stage, task) && !(state.page.classList.contains('is-tabbed') && state.stage.tab !== 'stage');
    titleLine.append(tools);
    const unseen = newOutputs(state.stage, task, shown && state.stage.view === 'outputs');
    state.owner?.headerTools?.replaceChildren(sideSwitch(state.stage, shown, { stage: stageBadge(task, state.stage, shown && state.stage.view === 'stage'), asking, toolbox: toolboxCount(task), outputs: unseen },
        view => pickView(state.stage, view, shown, task, renderTask, () => void refresh())));
    const meta = [task.client, `${dayLabel(task.started)} ${timeLabel(task.started)}`, t('aiStepCount', { count: (task.steps || []).length }),
        ...taskCounts(summary).map(say)].filter(Boolean);
    header.replaceChildren(titleLine, el('div', 'anomalous-ai-task-meta', meta.join(' · ')),
        taskLinks(task, state.tasks, { open: (id) => { state.pinned = true; void select(id); }, changed: refresh }));

    const flow = flowMap(task, stepId => showStep(view.timeline, stepId));
    view.flow.replaceChildren(...(flow ? [flow] : []));

    drawOutputsLine(view.made, task, () => pickView(state.stage, 'outputs', false, state.task, renderTask, () => void refresh()));

    // Numbered in the order they happened, so the timeline reads 1, 2, 3 from the top.
    const items = groupSteps(task.steps);
    const rows = items.map((item, at) => {
        if (item.type === 'looks') return { key: JSON.stringify(['looks', at, item.steps]), make: () => looksRow(item.steps, at + 1) };
        if (item.type === 'step') return { key: JSON.stringify(['step', at, item.step, undoable(item.step)]), make: () => stepRow(item.step, at + 1) };
        const live = at === items.length - 1 && !task.ended; // the AI may still add to it
        return { key: JSON.stringify(['chain', at, item.steps, item.steps.map(undoable), live]),
            make: () => chainRow(item.steps, at + 1, { entries: state.entries, stepRow, changed: renderTask, live }) };
    });
    state.numbers = new Map(items.flatMap((item, at) => (item.type === 'step' ? [item.step] : item.steps).map(step => [step.id, at + 1])));
    // A task the user started waits for an AI: how to get one on it, and a page to put things
    // ready for it meanwhile (their own steps are drawn there; its gallery feeds the message box).
    const preparing = Boolean(task.waiting) && items.every(item => item.type === 'step' && item.step.kind === 'user');
    if (preparing) {
        const materials = toolboxCount(task);
        rows.splice(0, rows.length, { key: JSON.stringify(['waiting', task.title, task.steps, materials]), make: () => waitingView(task, {
            rename: async (title) => {
                await postTask(task.id, { title }).catch(error => anomalousAlert(error.message));
                await refresh();
            },
            message: view.message, materials, ready: items.map((item, at) => stepRow(item.step, at + 1)),
        }) });
    } else if (!items.length) rows.push({ key: 'empty', make: () => el('div', 'anomalous-ai-empty-task', t('aiNoSteps')) });
    syncRows(view.timeline, rows);
    updateMessageBox(view.message, Boolean(task.ended), preparing ? 'waiting' : status, toolboxCount(task));
    view.now.update(task, { refresh: () => void refresh(), showStep: id => showStep(view.timeline, id),
        openStage: () => pickView(state.stage, 'stage', false, task, renderTask, () => void refresh()) });
    view.timeline.classList.toggle('is-waiting', preparing);
    // Opened, at its newest step (a page being prepared, at its top); read at the foot, kept there.
    if (!view.newest.jumping) box.scrollTop = fresh && preparing ? 0 : fresh || keepBottom ? box.scrollHeight : keepTop;
    view.newest.arrived((task.steps || []).slice(view.seen).filter(step => step.kind !== 'user').length);
    view.seen = (task.steps || []).length;
    drawStage(task, news.arrived);
}

/** Brings a step's row into view (from the flow), marked for a moment; a folded chain opens to it. */
function showStep(timeline, stepId) {
    const has = item => item.dataset.stepIds.split(' ').includes(stepId);
    const chain = [...timeline.children].find(has);
    chain?.reveal?.();
    const row = [...timeline.querySelectorAll('[data-step-ids]')].findLast(has);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('is-flash');
    setTimeout(() => row.classList.remove('is-flash'), 1600);
}

/** The side column beside the timeline: the view picked (ui_ai_side_views.js). */
function drawStage(task, arrived = null) {
    const box = state.page?.querySelector('.anomalous-ai-stage');
    if (!box) return;
    state.page.classList.toggle('has-stage', sideShown(state.stage, task));
    drawSide(box, task, state.stage, {
        taskId: task.id,
        owner: state.owner,
        openPicture: (url, video) => state.owner?.showGalleryViewer?.(url, video),
        openModel,
        locateNode: id => locateNode(id, null),
        stepOf: id => task.steps.find(item => item.id === id),
        changed: () => void refresh(),
        numberOf: id => state.numbers.get(id) || '',
        showCanvas: () => state.owner?.close?.(),
        close: () => {
            state.stage.hidden = true;
            state.stage.tab = 'timeline';
            renderTask();
        },
    }, pickTab, arrived);
    layout();
}

function stateChip(status) {
    const chip = el('span', `anomalous-ai-state is-${status}`);
    chip.append(stateIcon(status, 12), el('span', '', t(`aiState_${status}`)));
    return chip;
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
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, from: state.task?.id }), // goes on from the task shown
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

/** The title bar's list button: folds or shows the task list (in a narrow window, goes to it and back). */
function toggleTasks() {
    if (state.page?.classList.contains('is-narrow')) {
        state.narrowView = state.narrowView === 'list' && state.selected ? 'task' : 'list';
        return layout();
    }
    const folded = !state.tasksCollapsed;
    state.tasksCollapsed = folded;
    try { localStorage.setItem(COLLAPSED_KEY, folded ? '1' : '0'); } catch (_) { /* this viewer's convenience */ }
    layout();
}

/** Which canvas changes of a step can be undone now (part of when its row is drawn again). */
function undoable(step) {
    return (step.results || []).filter(result => result.type === 'canvas')
        .map(result => [state.entries.get(result.activity) || null, state.entries.has(result.activity) && canUndo(app, state.entries.get(result.activity))]);
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
    const wanted = new Set(activityIds(task));
    const kept = new Map([...state.entries].filter(([id]) => wanted.has(id)));
    if (wanted.size && [...wanted].some(id => !kept.has(id))) {
        const entries = await fetchActivity({ limit: 500 });
        for (const entry of entries) if (wanted.has(entry.id)) kept.set(entry.id, entry);
    }
    return kept;
}

async function select(id) {
    const request = ++state.request;
    state.selected = id;
    state.narrowView = 'task';
    state.page?.querySelectorAll('.anomalous-ai-task-row').forEach(row => row.classList.remove('is-current'));
    renderList(state.page.querySelector('.anomalous-ai-tasks'));
    layout();
    const task = await fetchTask(id).catch(() => null);
    if (state.selected !== id || request !== state.request) return;
    const entries = task ? await loadEntries(task).catch(() => new Map()) : new Map();
    if (state.selected !== id || request !== state.request) return;
    state.task = task;
    shared.entries = state.entries = entries;
    shared.taskId = task?.id || null;
    renderTask();
}

/** Pictures on the AI page can be marked for the task shown (ui_ai_marker.js). */
setMarker(image => state.task && openMarker(image, state.task.id, () => void refresh()));

/** The materials picker docks in the side column while this page is shown; a run's step opens its shape there. */
shared.openMap = connectSide({
    side: state.stage, task: () => state.task, redraw: () => renderTask(),
    box: () => (visible() && state.page?.querySelector('.anomalous-ai-stage')) || null,
});

// ---------------------------------------------------------------- the page

function layout() {
    const page = state.page;
    if (!page) return;
    const width = page.clientWidth;
    const narrow = width > 0 && width < NARROW_PX;
    const folded = state.tasksCollapsed && !narrow;
    page.classList.toggle('is-narrow', narrow);
    page.classList.toggle('is-short', page.clientHeight > 0 && page.clientHeight < SHORT_PX);
    page.classList.toggle('shows-task', narrow && state.narrowView === 'task' && Boolean(state.selected));
    page.classList.toggle('tasks-collapsed', folded);
    // Three columns when there is room; else the timeline and the stage take turns behind tabs.
    const room = width - (narrow || folded ? 0 : 260);
    const tabbed = page.classList.contains('has-stage') && (narrow || room < sideWidth() + TIMELINE_MIN);
    page.classList.toggle('is-tabbed', tabbed);
    page.classList.toggle('shows-stage', tabbed && state.stage.tab === 'stage');
}

function emptyPage() {
    const box = el('div', 'anomalous-ai-welcome');
    const picture = el('img', 'anomalous-ai-welcome-art');
    picture.src = new URL('../assets/ai_tasks_empty.webp', import.meta.url).href;
    picture.alt = '';
    box.append(picture, el('h2', 'anomalous-ai-welcome-title', t('aiWelcomeTitle')), el('p', 'anomalous-ai-welcome-body', t('aiWelcomeBody')),
        iconButton('anomalous-ai-new-task', 'plus', t('aiNewTask'), newTask, { title: t('aiNewTaskHint') }), connectHint());
    return box;
}

async function refresh() {
    if (!state.page) return;
    const request = ++state.request;
    const tasks = await fetchTasks().catch(() => null);
    if (!tasks || !state.page || request !== state.request) return;
    state.tasks = tasks;
    if (!tasks.length) {
        state.page.replaceChildren(emptyPage(), state.bar);
        state.owner?.headerTools?.replaceChildren();
        state.page.classList.add('is-empty');
        return;
    }
    if (state.page.classList.contains('is-empty') || !state.page.querySelector('.anomalous-ai-tasks')) {
        state.page.classList.remove('is-empty');
        state.page.replaceChildren(el('aside', 'anomalous-ai-tasks'), el('section', 'anomalous-ai-task'), el('section', 'anomalous-ai-stage'), state.bar);
    }
    // The newest task while the AI works on it, unless the user picked another one.
    const follow = !state.pinned && !tasks[0].ended && tasks[0].id !== state.selected
        && (tasks[0].live || tasks[0].started > (state.task?.started || 0));
    if (follow || !tasks.some(task => task.id === state.selected)) {
        state.selected = tasks[0].id;
        state.pinned = false;
        state.task = null;
    }
    renderList(state.page.querySelector('.anomalous-ai-tasks'));
    const task = await fetchTask(state.selected).catch(() => null);
    if (request !== state.request) return;
    const entries = task ? await loadEntries(task).catch(() => new Map()) : new Map();
    if (request !== state.request) return;
    state.task = task;
    shared.entries = state.entries = entries;
    shared.taskId = task?.id || null;
    renderTask();
    layout();
}

// Poll only while this view is visible: reconnects and missed websocket events must not freeze its status.
let pollTimer = null;
function pollVisible() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
        if (document.hidden || !state.page?.isConnected || !visible()
            || !state.owner?.modal?.classList.contains('visible') || state.owner.currentShellPage?.() !== 'ai') return;
        try { await refresh(); } finally { pollVisible(); }
    }, 5000);
}

/** The whole page into `panel`. */
export function renderAiWorkbench(owner, panel) {
    state.owner = owner;
    shared.owner = owner;
    state.panel = panel;
    state.bar ||= compareBar();
    if (!state.page || state.page.parentNode !== panel) {
        state.observer?.disconnect();
        state.page = el('div', 'anomalous-ai');
        panel.replaceChildren(state.page);
        if (typeof ResizeObserver === 'function') {
            state.observer = new ResizeObserver(layout);
            state.observer.observe(state.page);
        }
    }
    owner.headerLeadTools?.replaceChildren(listToggle(state.page, toggleTasks));
    owner.railNews?.('ai', false);
    hidePanelToast();
    void refresh();
    pollVisible();
}

/** Once: the server's "anomalous.ai_task" event refreshes the page, the home list and the rail's dot. */
export function watchAiTasks(owner) {
    state.owner = owner;
    shared.owner = owner;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pollVisible(); });
    api.addEventListener('anomalous.ai_task', (event) => {
        const detail = event?.detail || {};
        const onPage = () => owner.modal?.classList.contains('visible') && owner.currentShellPage?.() === 'ai' && visible();
        // A run's progress only moves its bar (every couple of seconds while it runs): no refetch.
        if (detail.progress) {
            const step = state.task?.id === detail.id && state.task.steps.find(item => item.id === detail.progress.step);
            if (step) step.progress = detail.progress;
            if (onPage() && step) {
                updateRunProgress(state.page, detail.progress);
                state.view?.header.querySelector('.anomalous-ai-execution')?.replaceWith(executionStatus(state.task, refresh));
                state.view?.now.update(state.task); // the strip over the message box says the same
            }
            return;
        }
        if (detail.panel && !onPage()) panelToast(owner, String(detail.panel), Boolean(detail.asks));
        else if (detail.gate && !onPage()) panelToast(owner, t(`aiGateQ_${detail.gate}`), true);
        clearTimeout(state.refreshTimer);
        state.refreshTimer = setTimeout(() => {
            if (onPage()) void refresh();
            else owner.railNews?.('ai', true);
            if (owner.currentShellPage?.() === 'home') owner.onActivityRecorded?.();
        }, 300);
    });
}

/** Opens task `id` on the AI page (from the activity log, the home page). */
export function openAiTask(owner, id, newest = null) {
    state.selected = id;
    state.pinned = id !== newest;
    owner.goTo('ai');
}

/** The home page's short list (ui_ai_recent.js); a row opens its task here. */
export function renderRecentAiTasks(owner, container) {
    drawRecentAiTasks(owner, container, {
        fetchTasks: () => fetchTasks(RECENT_COUNT),
        open: (summary, newest) => openAiTask(owner, summary.id, newest),
    });
}
