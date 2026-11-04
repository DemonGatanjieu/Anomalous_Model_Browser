/**
 * The ⋯ in a task's head: what is done to a task now and then (rename it, say what it goes on from, keep
 * its pictures from the AI, remove it), out of the way of the tools used while it runs.
 */

import { translate as t } from './locales.js';
import { setPrivacy } from './ui_ai_privacy.js';
import { pickTaskLink } from './ui_ai_task_links.js';
import { openPopupMenu } from './ui_popup_menu.js';

/** The button for `task`. `tasks`: the list's summaries; `rename()`, `remove()`, `changed()` as the head does them. */
export function taskMenu(task, { tasks, rename, remove, changed }) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'anomalous-ai-tool is-icon';
    more.textContent = '⋯';
    more.title = t('notebookMore');
    more.onclick = () => openPopupMenu(more, [
        { label: t('aiRename'), run: rename },
        ...(task.links?.from ? [] : [{ label: t('aiTaskLink'), title: t('aiTaskLinkHint'), run: () => pickTaskLink(more, task, tasks, changed) }]),
        { label: t(task.private ? 'aiPrivacyTurnOff' : 'aiPrivacyTurnOn'), title: t(task.private ? 'aiPrivacyHint_on' : 'aiPrivacyHint_off'),
            run: () => void setPrivacy(task, !task.private, changed) },
        { label: t('aiRemove'), danger: true, run: remove },
    ]);
    return more;
}
