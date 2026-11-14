/**
 * The AI workbench's task column (ui_ai_workbench.js draws the rest): its head, "New task" and
 * the ways in (connect an AI, the gates), which AI came last and when, quick filters by where a
 * task stands (working, asking the user, failed) with their counts, and the tasks by day, each
 * with an icon for where it stands and a ⋯ (ui_ai_task_menu.js) that shows on the task the pointer
 * is on. All tasks show by family, those going on from a task under it (ai_task_view.taskFamilies);
 * a filter's show alone. The filter is this column's own; the rest comes in `view`.
 * Drawn again (every few seconds while the page shows), only the rows that changed are made anew.
 * The column folds away from a button at the top left of the window (listToggle); folded, it stays
 * laid out out of sight, and the pointer on that button, or moving left onto the page's left edge,
 * slides it over the page at once to pick a task from.
 */

import { translate as t } from './locales.js';
import { dayLabel, timeLabel } from './activity_log.js';
import { taskCounts, taskFamilies, taskState } from './ai_task_view.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { openConnectGuide } from './ui_ai_connect.js';
import { openGates } from './ui_ai_gate.js';
import { syncRows } from './sync_rows.js';
import { taskTitle } from './ai_task_title.js';

const STATE_ICONS = { waiting: 'sparkle', idle: 'pulse', live: 'pulse', asks: 'question', error: 'alert', done: 'check', halted: 'stop' };
const FILTERS = { all: () => true, live: state => ['live', 'waiting', 'idle'].includes(state), asks: state => state === 'asks', error: state => state === 'error' };

let filter = 'all';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** The icon of a task's state, in its colour. */
export function stateIcon(status, size = 13) {
    const mark = el('span', `anomalous-ai-state-icon is-${status}`);
    mark.append(icon(STATE_ICONS[status] || 'check', size));
    mark.title = t(`aiState_${status}`);
    return mark;
}

/** `place`: where it stands in the list: `size` of its family, `follows` when no family shows that, `day` when not the heading's. */
function taskRow(summary, view, place) {
    const status = taskState(summary);
    const row = el('button', `anomalous-ai-task-row is-${status}${summary.id === view.selected ? ' is-current' : ''}`);
    row.type = 'button';
    row.onclick = () => view.onPick(summary);
    row.onpointerenter = () => view.onHover?.(summary);
    row.onpointerleave = () => view.onLeave?.();
    const top = el('div', 'anomalous-ai-task-row-top');
    const name = el('span', 'anomalous-ai-task-row-title', taskTitle(summary));
    name.title = name.textContent; // a follow-up stands one step in: its name is cut off sooner
    top.append(stateIcon(status), name);
    if (place.size > 1) top.append(el('span', 'anomalous-ai-task-family', t('aiTaskFamily', { count: place.size })));
    if (status === 'live') top.append(el('span', 'anomalous-ai-live-dot'));
    const when = [place.day, timeLabel(summary.updated)].filter(Boolean).join(' ');
    const meta = [place.follows ? t('aiTaskFollows') : '', summary.client, when, t('aiStepCount', { count: summary.steps })].filter(Boolean);
    row.append(top, el('div', 'anomalous-ai-task-row-meta', meta.join(' · ')));
    const counts = taskCounts(summary);
    if (counts.length) row.append(el('div', 'anomalous-ai-task-row-counts', counts.map(item => t(item.key, item.values)).join(' · ')));
    return row;
}

/** A task's row with its ⋯ beside it: a button cannot hold a button. */
function taskItem(summary, view, place) {
    const item = el('div', `anomalous-ai-task-item${place.child ? ' is-child' : ''}${summary.id === view.selected ? ' is-current' : ''}`);
    const more = el('button', 'anomalous-ai-task-more', '⋯');
    more.type = 'button';
    more.title = t('notebookMore');
    more.onclick = () => view.onMenu(more, summary);
    item.append(taskRow(summary, view, place), more);
    return item;
}

/** Which AI came last, and when: from the newest task an AI worked on. */
function lastVisit(tasks) {
    const latest = tasks.find(task => task.client);
    const box = el('div', `anomalous-ai-visit${latest ? ' is-known' : ''}`);
    box.append(el('span', 'anomalous-ai-visit-dot'),
        el('span', 'anomalous-ai-visit-text', latest ? t('aiLastVisit', { client: latest.client, when: `${dayLabel(latest.updated)} ${timeLabel(latest.updated)}` }) : t('aiNoVisit')));
    return box;
}

function listHead(count) {
    const head = el('div', 'anomalous-ai-tasks-head');
    head.append(el('span', 'anomalous-ai-tasks-title', t('aiTasks')), el('span', 'anomalous-ai-tasks-count', t('aiTaskCount', { count })));
    return head;
}

function listActions(box, tasks) {
    const actions = el('div', 'anomalous-ai-tasks-actions');
    const ways = el('div', 'anomalous-ai-tasks-ways');
    ways.append(iconButton('anomalous-ai-way', 'plug', t('aiConnect'), openConnectGuide, { title: t('aiConnectHint') }),
        iconButton('anomalous-ai-way', 'shield', t('aiGates'), openGates, { title: t('aiGatesHint') }));
    actions.append(iconButton('anomalous-ai-new-task', 'plus', t('aiNewTask'), () => box.aiView.onNew(), { title: t('aiNewTaskHint') }), ways, lastVisit(tasks));
    return actions;
}

/** The quick filters with their counts (`counts`: [key, count] of those to show). */
function filterChips(box, counts) {
    const filters = el('div', 'anomalous-ai-task-filters');
    for (const [key, count] of counts) {
        const chip = el('button', `anomalous-ai-task-filter is-${key}${filter === key ? ' is-on' : ''}`);
        chip.type = 'button';
        chip.append(el('span', '', t(`aiTaskFilter_${key}`)), el('span', 'anomalous-ai-task-filter-count', String(count)));
        chip.onclick = () => {
            filter = filter === key ? 'all' : key;
            renderTaskList(box, box.aiView);
        };
        filters.append(chip);
    }
    return filters;
}

/**
 * Draws the column into `box`, making anew only the rows that changed.
 * `view`: { tasks, selected, onPick(summary), onNew(), onHover(summary), onLeave(), onMenu(anchor, summary) }.
 */
export function renderTaskList(box, view) {
    box.aiView = view; // what the column's buttons act on: the latest
    const states = view.tasks.map(taskState);
    if (filter !== 'all' && !states.some(FILTERS[filter])) filter = 'all';
    const counts = Object.entries(FILTERS).map(([key, test]) => [key, states.filter(test).length]).filter(([key, count]) => key === 'all' || count);
    const latest = view.tasks.find(task => task.client);
    syncRows(box, [
        { key: `head ${view.tasks.length}`, make: () => listHead(view.tasks.length) },
        { key: JSON.stringify(['actions', latest?.client, latest?.updated]), make: () => listActions(box, view.tasks) },
        ...(counts.length > 1 ? [{ key: JSON.stringify(['filters', filter, counts]), make: () => filterChips(box, counts) }] : []),
        { key: 'list', make: () => el('div', 'anomalous-ai-tasks-list') },
    ]);
    // Newest first, under a heading for each day (today, yesterday, a date).
    const items = filter === 'all' ? taskFamilies(view.tasks)
        : view.tasks.filter((_, index) => FILTERS[filter](states[index])).map(task => ({ task, newest: task.updated, follows: Boolean(task.from) }));
    const rows = [];
    let day = null;
    for (const { task, newest, ...place } of items) {
        const label = dayLabel(newest);
        if (label !== day) {
            day = label;
            rows.push({ key: `day ${label}`, make: () => el('div', 'anomalous-ai-tasks-day', label) });
        }
        const ownDay = dayLabel(task.updated);
        const at = { ...place, day: ownDay === label ? '' : ownDay }; // a family stands under its latest day: an older task says its own
        rows.push({ key: JSON.stringify([task, task.id === view.selected, at]), make: () => taskItem(task, box.aiView, at) });
    }
    syncRows(box.querySelector(':scope > .anomalous-ai-tasks-list'), rows);
}

const PEEK_LEAVE_MS = 350;
const PEEK_SLACK = 12;
const PEEK_EDGE = 10; // px of the page's left edge that bring the column, moving left onto it

/**
 * The button that shows or folds the column (`onToggle()`), for the window's title bar. While
 * the column is folded, the pointer on it (or moving left onto the page's left edge, not coming in
 * from the rail) brings the column over the page; it stays while the pointer is anywhere in the box
 * around the button and the column (the way down between them too, however slowly it is crossed),
 * and goes a moment after the pointer leaves that box, or at once when a task is picked.
 */
export function listToggle(page, onToggle) {
    let timer = null;
    const stop = () => {
        clearTimeout(timer);
        timer = null;
        page.classList.remove('is-peeking');
        document.removeEventListener('pointermove', follow);
    };
    const node = iconButton('anomalous-ai-list-toggle', 'sidebar', t('aiTasksToggle'), () => {
        stop();
        onToggle();
    }, { iconOnly: true });
    // The box around the button and the column it brings: the pointer inside keeps it shown.
    function inside(x, y) {
        const list = page.querySelector('.anomalous-ai-tasks')?.getBoundingClientRect();
        const button = node.getBoundingClientRect();
        if (!list?.width) return false;
        return x >= Math.min(list.left, button.left) - PEEK_SLACK && x <= Math.max(list.right, button.right) + PEEK_SLACK
            && y >= Math.min(list.top, button.top) - PEEK_SLACK && y <= Math.max(list.bottom, button.bottom) + PEEK_SLACK;
    }
    function follow(event) {
        if (!page.isConnected || !node.isConnected || !page.classList.contains('is-peeking')) return stop();
        if (inside(event.clientX, event.clientY)) {
            clearTimeout(timer);
            timer = null;
        } else if (!timer) {
            timer = setTimeout(stop, PEEK_LEAVE_MS);
        }
    }
    const peek = () => {
        if (!page.classList.contains('tasks-collapsed')) return;
        clearTimeout(timer);
        timer = null;
        page.classList.add('is-peeking');
        document.addEventListener('pointermove', follow);
    };
    node.addEventListener('pointerenter', peek);
    page.peekTasks = peek; // the page's edge below calls the button drawn last
    if (!page.dataset.peeks) {
        page.dataset.peeks = '1';
        page.addEventListener('click', (event) => { if (event.target.closest('.anomalous-ai-task-row')) page.classList.remove('is-peeking'); });
        page.addEventListener('pointermove', (event) => {
            if (event.movementX >= 0 || page.classList.contains('is-peeking') || !page.classList.contains('tasks-collapsed')) return;
            if (event.clientX - page.getBoundingClientRect().left <= PEEK_EDGE) page.peekTasks?.();
        });
    }
    return node;
}
