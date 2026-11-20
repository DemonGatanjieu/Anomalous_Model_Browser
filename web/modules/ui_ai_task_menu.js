/**
 * The ⋯ of a task, in its head and on its row in the list: what is done to a task now and then (rename
 * it, start a task that goes on from it, say what it goes on from, what was sent to its AI, remove it), out of the way of the tools used
 * while it runs; and, for every task, the desktop notification when the AI waits (ui_ai_notify.js). The
 * head puts its own items first (`extra`, ui_ai_task_head.js); privacy has its own button there.
 */

import { translate as t } from './locales.js';
import { forgetTask } from './ai_task_cache.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { notifyState, toggleNotify } from './ui_ai_notify.js';
import { modelTokens } from './ui_ai_privacy.js';
import { openSent } from './ui_ai_sent.js';
import { pickTaskLink } from './ui_ai_task_links.js';
import { openPopupMenu } from './ui_popup_menu.js';
import { taskTitle } from './ai_task_title.js';

/**
 * What the menu of `task` does. `tasks`: the list's summaries; `post(id, body)` writes to the task,
 * `refresh()` draws the page again, `removed()` lets go of a removed task, before that; `followUp()` starts a task
 * going on from it (its privacy as it is: ai_tasks.INHERITED) and shows that one.
 */
export function menuActions(task, { tasks, post, refresh, removed, followUp }) {
    return { tasks, followUp, changed: () => void refresh(), rename: async () => {
        const named = await anomalousPrompt(t('aiRenamePrompt'), task.title ? taskTitle(task) : '', t('aiRename'));
        if (named === null || named === undefined) return;
        await post(task.id, { title: named }).catch(error => anomalousAlert(error.message));
        await refresh();
    }, remove: async () => {
        if (!await anomalousConfirm(t('aiRemoveConfirm'), t('aiRemove'))) return;
        await post(task.id, { remove: true }).catch(error => anomalousAlert(error.message));
        forgetTask(task.id);
        removed();
        await refresh();
    } };
}

/** The menu of `task` (its full record) under `anchor`; the rest from menuActions, `extra` (the head's) first. */
export function openTaskMenu(anchor, task, { tasks, rename, remove, changed, followUp, extra = [] }) {
    const place = anchor.getBoundingClientRect(); // the head is drawn anew every few seconds: the button may be another by the time a row is chosen
    openPopupMenu(anchor, [
        ...extra,
        ...(extra.length ? [{ heading: t('aiTaskMenuTask') }] : []),
        { label: t('aiRename'), run: rename },
        // A task an AI never took is replaced by the next one started: nothing to go on from yet.
        ...(followUp && task.steps?.length ? [{ label: t('aiTaskFollowUp'), note: t('aiTaskFollowUpNote'), run: followUp }] : []),
        ...(task.links?.from ? [] : [{ label: t('aiTaskLink'), title: t('aiTaskLinkHint'), run: () => pickTaskLink(place, task, tasks, changed) }]),
        ...(task.private || Object.keys(task.sealed || {}).length ? [{ label: t('aiSent'), title: t('aiSentHint'), run: () => void openSent(task) }] : []),
        ...(modelTokens(task) ? [{ label: t('aiModelTokens'), title: t('aiModelTokensHint'),
            run: () => void anomalousAlert(modelTokens(task), t('aiModelTokens')) }] : []),
        ...(notifyState() === 'none' ? [] : [{ label: t(notifyState() === 'on' ? 'aiNotifyTurnOff' : 'aiNotifyTurnOn'), title: t('aiNotifyHint'),
            run: () => void toggleNotify() }]),
        { label: t('aiRemove'), danger: true, run: remove },
    ]);
}

/** The button in the head of `task`. */
export function taskMenu(task, actions) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'anomalous-ai-tool is-icon anomalous-ai-task-menu';
    more.textContent = '⋯';
    more.title = t('notebookMore');
    more.onclick = () => openTaskMenu(more, task, actions);
    return more;
}
