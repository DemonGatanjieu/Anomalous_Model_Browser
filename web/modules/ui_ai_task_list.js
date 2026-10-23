/**
 * The AI workbench's task column (ui_ai_workbench.js draws the rest): its head, "New task" and
 * the ways in (connect an AI, the gates), which AI came last and when, quick filters by where a
 * task stands (working, asking the user, failed) with their counts, and the tasks by day, each
 * with an icon for where it stands. The filter is this column's own; the rest comes in `view`.
 * The column folds away from a button at the top left of the window (listToggle); folded, the
 * pointer on that button brings it over the page for a moment to pick a task from.
 */

import { translate as t } from './locales.js';
import { dayLabel, timeLabel } from './activity_log.js';
import { taskCounts, taskState } from './ai_task_view.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { openConnectGuide } from './ui_ai_connect.js';
import { openGates } from './ui_ai_gate.js';

const STATE_ICONS = { waiting: 'sparkle', idle: 'pulse', live: 'pulse', asks: 'question', error: 'alert', done: 'check' };
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

function taskRow(summary, view) {
    const status = taskState(summary);
    const row = el('button', `anomalous-ai-task-row is-${status}${summary.id === view.selected ? ' is-current' : ''}`);
    row.type = 'button';
    row.onclick = () => view.onPick(summary);
    const top = el('div', 'anomalous-ai-task-row-top');
    top.append(stateIcon(status), el('span', 'anomalous-ai-task-row-title', summary.title || t('aiUntitled')));
    if (status === 'live') top.append(el('span', 'anomalous-ai-live-dot'));
    const meta = [summary.from ? t('aiTaskFollows') : '', summary.client, timeLabel(summary.updated), t('aiStepCount', { count: summary.steps })].filter(Boolean);
    row.append(top, el('div', 'anomalous-ai-task-row-meta', meta.join(' · ')));
    const counts = taskCounts(summary);
    if (counts.length) row.append(el('div', 'anomalous-ai-task-row-counts', counts.map(item => t(item.key, item.values)).join(' · ')));
    return row;
}

/** Which AI came last, and when: from the newest task an AI worked on. */
function lastVisit(tasks) {
    const latest = tasks.find(task => task.client);
    const box = el('div', `anomalous-ai-visit${latest ? ' is-known' : ''}`);
    box.append(el('span', 'anomalous-ai-visit-dot'),
        el('span', 'anomalous-ai-visit-text', latest ? t('aiLastVisit', { client: latest.client, when: `${dayLabel(latest.updated)} ${timeLabel(latest.updated)}` }) : t('aiNoVisit')));
    return box;
}

/**
 * Draws the column into `box`. `view`: { tasks, selected, onPick(summary), onNew() }.
 */
export function renderTaskList(box, view) {
    const head = el('div', 'anomalous-ai-tasks-head');
    head.append(el('span', 'anomalous-ai-tasks-title', t('aiTasks')), el('span', 'anomalous-ai-tasks-count', t('aiTaskCount', { count: view.tasks.length })));
    const actions = el('div', 'anomalous-ai-tasks-actions');
    const ways = el('div', 'anomalous-ai-tasks-ways');
    ways.append(iconButton('anomalous-ai-way', 'plug', t('aiConnect'), openConnectGuide, { title: t('aiConnectHint') }),
        iconButton('anomalous-ai-way', 'shield', t('aiGates'), openGates, { title: t('aiGatesHint') }));
    actions.append(iconButton('anomalous-ai-new-task', 'plus', t('aiNewTask'), view.onNew, { title: t('aiNewTaskHint') }), ways, lastVisit(view.tasks));

    const states = view.tasks.map(taskState);
    const filters = el('div', 'anomalous-ai-task-filters');
    for (const [key, test] of Object.entries(FILTERS)) {
        const count = states.filter(test).length;
        if (key !== 'all' && !count) continue;
        const chip = el('button', `anomalous-ai-task-filter is-${key}${filter === key ? ' is-on' : ''}`);
        chip.type = 'button';
        chip.append(el('span', '', t(`aiTaskFilter_${key}`)), el('span', 'anomalous-ai-task-filter-count', String(count)));
        chip.onclick = () => {
            filter = filter === key ? 'all' : key;
            renderTaskList(box, view);
        };
        filters.append(chip);
    }
    if (filter !== 'all' && !states.some(FILTERS[filter])) filter = 'all';

    const list = el('div', 'anomalous-ai-tasks-list');
    // Newest first, under a heading for each day (today, yesterday, a date).
    let day = null;
    view.tasks.forEach((summary, index) => {
        if (!FILTERS[filter](states[index])) return;
        const label = dayLabel(summary.updated);
        if (label !== day) {
            day = label;
            list.append(el('div', 'anomalous-ai-tasks-day', label));
        }
        list.append(taskRow(summary, view));
    });
    box.replaceChildren(head, actions, ...(filters.children.length > 1 ? [filters] : []), list);
}

const PEEK_LEAVE_MS = 350;
const PEEK_SLACK = 12;

/**
 * The button that shows or folds the column (`onToggle()`), for the window's title bar. While
 * the column is folded, the pointer on it brings the column over the page; it stays while the
 * pointer is anywhere in the box around the button and the column (the way down between them
 * too, however slowly it is crossed), and goes a moment after the pointer leaves that box, or
 * at once when a task is picked.
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
    node.addEventListener('pointerenter', () => {
        if (!page.classList.contains('tasks-collapsed')) return;
        clearTimeout(timer);
        timer = null;
        page.classList.add('is-peeking');
        document.addEventListener('pointermove', follow);
    });
    if (!page.dataset.peeks) {
        page.dataset.peeks = '1';
        page.addEventListener('click', (event) => { if (event.target.closest('.anomalous-ai-task-row')) page.classList.remove('is-peeking'); });
    }
    return node;
}
