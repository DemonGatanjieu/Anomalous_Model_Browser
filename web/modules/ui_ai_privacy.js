/**
 * Privacy mode of a task (api/ai_privacy.py): it keeps the task's pictures from the AI. It is turned on
 * from the ⋯ in the task's head (ui_ai_task_menu.js); while on, a chip there says so ("🔒 Private") and
 * turns it off (POST /anomalous/ai_tasks/{id} {privacy}). What the AI saw before stays seen, as the hint says.
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { icon } from './ui_ai_icons.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Turns `task`'s privacy mode to `on`; `changed()` after it was turned. */
export async function setPrivacy(task, on, changed) {
    try {
        const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ privacy: on }),
        });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText);
    } catch (error) {
        await anomalousAlert(error.message);
        return;
    }
    changed();
}

/** What says that `task` is private, and turns it off. */
export function privacyChip(task, changed) {
    const chip = el('button', 'anomalous-ai-tool anomalous-ai-privacy is-on');
    chip.type = 'button';
    chip.title = t('aiPrivacyHint_on');
    chip.append(icon('lock', 15), el('span', '', t('aiPrivacy')));
    chip.onclick = () => void setPrivacy(task, false, changed);
    return chip;
}
