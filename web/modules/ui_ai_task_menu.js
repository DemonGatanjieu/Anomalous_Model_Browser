/**
 * The ⋯ of a task, in its head and on its row in the list: what is done to a task now and then (rename
 * it, say what it goes on from, keep its pictures from the AI, remove it), out of the way of the tools
 * used while it runs; and, for every task, the desktop notification when the AI waits (ui_ai_notify.js).
 */

import { translate as t } from './locales.js';
import { forgetTask } from './ai_task_cache.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { notifyState, toggleNotify } from './ui_ai_notify.js';
import { modelTokens, setPrivacy } from './ui_ai_privacy.js';
import { openSent } from './ui_ai_sent.js';
import { pickTaskLink } from './ui_ai_task_links.js';
import { openPopupMenu } from './ui_popup_menu.js';
import { taskTitle } from './ai_task_title.js';

/**
 * What the menu of `task` does. `tasks`: the list's summaries; `post(id, body)` writes to the task,
 * `refresh()` draws the page again, `removed()` lets go of a removed task, before that.
 */
export function menuActions(task, { tasks, post, refresh, removed }) {
    return { tasks, changed: () => void refresh(), rename: async () => {
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

/** The menu of `task` (its full record) under `anchor`; the rest from menuActions. */
export function openTaskMenu(anchor, task, { tasks, rename, remove, changed }) {
    const place = anchor.getBoundingClientRect(); // the head is drawn anew every few seconds: the button may be another by the time a row is chosen
    openPopupMenu(anchor, [
        { label: t('aiRename'), run: rename },
        ...(task.links?.from ? [] : [{ label: t('aiTaskLink'), title: t('aiTaskLinkHint'), run: () => pickTaskLink(place, task, tasks, changed) }]),
        { label: t(task.private ? 'aiPrivacyTurnOff' : 'aiPrivacyTurnOn'), title: t(task.private ? 'aiPrivacyHint_on' : 'aiPrivacyHint_off'),
            run: () => void setPrivacy(task, !task.private, changed) },
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
