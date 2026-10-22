/**
 * The AI workbench's task column (ui_ai_workbench.js draws the rest): its head, "New task" and
 * the ways in (connect an AI, the gates), which AI came last and when, quick filters by where a
 * task stands (working, asking the user, failed) with their counts, and the tasks by day, each
 * with an icon for where it stands. The filter is this column's own; the rest comes in `view`.
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
    const meta = [summary.client, timeLabel(summary.updated), t('aiStepCount', { count: summary.steps })].filter(Boolean);
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
 * Draws the column into `box`. `view`: { tasks, selected, onPick(summary), onNew(), onFold() }.
 */
export function renderTaskList(box, view) {
    const head = el('div', 'anomalous-ai-tasks-head');
    head.append(el('span', 'anomalous-ai-tasks-title', t('aiTasks')), el('span', 'anomalous-ai-tasks-count', t('aiTaskCount', { count: view.tasks.length })),
        iconButton('anomalous-ai-fold', 'chevronLeft', t('aiTasksCollapse'), view.onFold, { iconOnly: true }));
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
