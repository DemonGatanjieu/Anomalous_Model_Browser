/**
 * A task's privacy settings (api/ai_privacy.py): kept from the AI are its pictures and prompts, and the names
 * of models nobody chose for. The head (ui_ai_task_head.js) has one button for every task saying which settings
 * are in use (the recommended ones, changed, or off); it opens Privacy Overview (ui_ai_privacy_overview.js),
 * where they are set (POST /anomalous/ai_tasks/{id} {privacy}). What the AI saw before stays seen. Beside it,
 * when the task's AI app reads the disk by itself, a ⓘ says what the settings cannot keep from it.
 * While model names are kept, the AI speaks of "[M1]": modelTokens() says which model each is, for the ⋯.
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { openPrivacyOverview } from './ui_ai_privacy_overview.js';

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

/** The model tokens of `task` and the model each stands for (its `sealed`), a line each; '' when it has none. */
export function modelTokens(task) {
    return Object.entries(task.sealed || {}).filter(([token]) => token.startsWith('[M'))
        .map(([token, text]) => `${token}  ${String(text).replace(/^([\w-]+):\d+:/, '$1 / ')}`).join('\n');
}


/** Opens Privacy Overview (`ui_ai_privacy_overview.js`) for `task`. */
export function openTaskPrivacy(task, changed) {
    return openPrivacyOverview(task, {
        onTogglePrivacy: nextOn => setPrivacy(task, nextOn, changed),
        onChanged: changed,
    });
}

/** The head's button: which privacy settings `task` uses, opening Privacy Overview; with the ⓘ for an app that reads the disk. */
export function privacyButton(task, changed) {
    const level = task.private !== true ? 'off' : task.privacy_models !== false ? 'on' : 'custom';
    const wrap = el('span', 'anomalous-ai-privacy-wrap');
    const chip = el('button', `anomalous-ai-tool anomalous-ai-privacy is-${level}`);
    chip.type = 'button';
    chip.title = t(`aiPrivacyBtnHint_${level}`);
    chip.append(icon(level === 'off' ? 'shield' : 'lock', 15), el('span', '', t(`aiPrivacyBtn_${level}`)));
    chip.onclick = () => void openTaskPrivacy(task, changed);
    wrap.append(chip);
    if (task.private === true && task.reads_disk) {
        const words = t('aiPrivacyReach', { app: task.client || 'AI' });
        wrap.append(iconButton('anomalous-ai-privacy-reach', 'info', t('aiPrivacyReachShort'),
            () => void anomalousAlert(words, t('aiPrivacyReachShort')), { iconOnly: true, size: 14, title: words }));
    }
    return wrap;
}
