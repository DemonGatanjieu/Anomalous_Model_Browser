/**
 * Where a task stands among others (api/ai_task_links.py), under its title in the AI workbench:
 * "goes on from «…»" and "goes on in «…»", each leading to that task; the first has × to take the
 * link off. A task that goes on from none has "Goes on from…" to pick the one it continues (a short
 * list of the latest tasks; Esc or a click elsewhere closes it).
 */

import { translate as t } from './locales.js';
import { dayLabel, timeLabel } from './activity_log.js';
import { icon } from './ui_ai_icons.js';
import { anomalousAlert } from './ui_dialog.js';

const PICKS = 12;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, children, onClick, title) {
    const node = el('button', className);
    node.type = 'button';
    node.append(...children);
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

async function link(taskId, parent) {
    const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(taskId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: parent }),
    });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(answer.error || `HTTP ${response.status}`);
}

/** The list to pick the task `task` goes on from, under `anchor`. */
function pickMenu(anchor, task, tasks, changed) {
    anchor.parentElement.querySelector('.anomalous-ai-task-links-menu')?.remove();
    const menu = el('div', 'anomalous-ai-task-links-menu');
    menu.dataset.anomalousEscape = '1'; // Esc closes this list, not the browser
    menu.setAttribute('role', 'listbox');
    menu.append(el('div', 'anomalous-ai-task-links-menu-head', t('aiTaskLinkPick')));
    const later = new Set((task.links?.next || []).map(item => item.id));
    const choices = tasks.filter(item => item.id !== task.id && !later.has(item.id)).slice(0, PICKS);
    const close = () => {
        menu.remove();
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', escape);
    };
    const outside = (event) => { if (!menu.contains(event.target) && event.target !== anchor) close(); };
    const escape = (event) => { if (event.key === 'Escape') setTimeout(close); }; // after the browser's Esc saw the mark
    for (const item of choices) {
        menu.append(button('anomalous-ai-task-links-pick', [el('span', 'anomalous-ai-task-links-pick-title', item.title || t('aiUntitled')),
            el('span', 'anomalous-ai-task-links-pick-when', `${dayLabel(item.updated)} ${timeLabel(item.updated)}`)], async () => {
            close();
            try {
                await link(task.id, item.id);
            } catch (error) {
                await anomalousAlert(error.message);
            }
            changed();
        }));
    }
    if (!choices.length) menu.append(el('div', 'anomalous-ai-task-links-menu-head', t('aiTaskLinkNone')));
    anchor.after(menu);
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
    document.addEventListener('keydown', escape);
}

/** The links of `task` (its `links` from the server). `tasks`: the list's summaries; `ctx`: {open(id), changed()}. */
export function taskLinks(task, tasks, ctx) {
    const row = el('div', 'anomalous-ai-task-links');
    const from = task.links?.from;
    if (from) {
        const chip = el('span', 'anomalous-ai-task-link is-from');
        chip.append(button('anomalous-ai-task-link-go', [icon('undo', 13), el('span', '', t('aiTaskFrom', { title: from.title || t('aiUntitled') }))], () => ctx.open(from.id)),
            button('anomalous-ai-task-link-x', [icon('close', 11)], async () => {
                try {
                    await link(task.id, null);
                } catch (error) {
                    await anomalousAlert(error.message);
                }
                ctx.changed();
            }, t('aiTaskUnlink')));
        row.append(chip);
    } else {
        const add = button('anomalous-ai-task-link is-add', [icon('plus', 12), el('span', '', t('aiTaskLink'))], () => pickMenu(add, task, tasks, ctx.changed), t('aiTaskLinkHint'));
        row.append(add);
    }
    for (const item of task.links?.next || []) {
        row.append(button('anomalous-ai-task-link is-next', [icon('arrowRight', 13), el('span', '', t('aiTaskNext', { title: item.title || t('aiUntitled') }))], () => ctx.open(item.id)));
    }
    return row;
}
