/**
 * The home page's "What the AI did lately" (ui_home.js through ui_ai_workbench.js): the last few
 * tasks with their cover and counts, put above the recent activity; nothing when there are none.
 * `fetchTasks()` gives the summaries, `open(summary, newestId)` opens one on the AI workbench.
 */

import { translate as t } from './locales.js';
import { timeLabel } from './activity_log.js';
import { picturePreview, taskCounts, taskState } from './ai_task_view.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

export function drawRecentAiTasks(owner, container, { fetchTasks, open }) {
    fetchTasks().then((tasks) => {
        if (!tasks.length || !container.isConnected) return;
        const section = el('section', 'anomalous-home-recent anomalous-ai-recent');
        const head = el('div', 'anomalous-home-recent-head');
        head.append(el('span', 'anomalous-home-recent-title', t('aiRecent')), button('anomalous-home-link', t('activityViewAll'), () => owner.goTo('ai')));
        const list = el('div', 'anomalous-ai-recent-list');
        for (const summary of tasks) {
            const row = button(`anomalous-ai-recent-row is-${taskState(summary)}`, '', () => open(summary, tasks[0].id));
            if (summary.cover) {
                const image = el('img', 'anomalous-ai-recent-cover');
                image.loading = 'lazy';
                image.src = picturePreview(summary.cover);
                image.alt = '';
                row.append(image);
            }
            const text = el('span', 'anomalous-ai-recent-text');
            const counts = taskCounts(summary).map(item => t(item.key, item.values));
            text.append(el('span', 'anomalous-ai-recent-title', summary.title || t('aiUntitled')),
                el('span', 'anomalous-ai-recent-meta', [summary.client, timeLabel(summary.updated), ...counts].join(' · ')));
            row.append(text);
            list.append(row);
        }
        section.append(head, list);
        const recent = container.querySelector('.anomalous-home-recent');
        if (recent) recent.before(section);
        else container.append(section);
    }).catch(() => { /* the home page works without it */ });
}
