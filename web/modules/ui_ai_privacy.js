/**
 * Privacy mode in a task's header (api/ai_privacy.py): a switch that keeps the task's pictures from
 * the AI. On, it says so ("🔒 Private"); off, it is a quiet lock. Pressing it turns it the other way
 * (POST /anomalous/ai_tasks/{id} {privacy}); what the AI saw before it was turned on stays seen,
 * as its hint says.
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

/** The switch for `task` (its `private` from the task route); `changed()` after it was turned. */
export function privacyToggle(task, changed) {
    const on = task.private === true;
    const chip = el('button', `anomalous-ai-tool anomalous-ai-privacy${on ? ' is-on' : ' is-icon'}`);
    chip.type = 'button';
    chip.title = t(on ? 'aiPrivacyHint_on' : 'aiPrivacyHint_off');
    chip.setAttribute('aria-pressed', String(on));
    chip.setAttribute('aria-label', t('aiPrivacy'));
    chip.append(icon('lock', 15));
    if (on) chip.append(el('span', '', t('aiPrivacy')));
    chip.onclick = async () => {
        chip.disabled = true;
        try {
            const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(task.id)}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ privacy: !on }),
            });
            if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText);
        } catch (error) {
            chip.disabled = false;
            await anomalousAlert(error.message);
            return;
        }
        changed();
    };
    return chip;
}
