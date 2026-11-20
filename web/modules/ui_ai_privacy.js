/**
 * A task's privacy settings (api/ai_privacy.py): kept from the AI are its pictures and prompts, and the names
 * of models nobody chose for. The head (ui_ai_task_head.js) has one button for every task, in two parts: which
 * settings are in use (the recommended ones, changed, or off), and "What the AI got ›" so it reads as a button (the
 * words go while the side column is open); the first private task shows a bubble under it until the user says Got
 * it or presses it (ui_ai_tour.js firstHint). It opens Privacy Overview (ui_ai_privacy_overview.js),
 * where they are set (POST /anomalous/ai_tasks/{id} {privacy}). What the AI saw before stays seen. Beside it,
 * when the task's AI app reads the disk by itself, a ⓘ says what the settings cannot keep from it.
 * While model names are kept, the AI speaks of "[M1]": the conversation shows the model instead (ui_ai_sealed_veil.js).
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { openPrivacyOverview } from './ui_ai_privacy_overview.js';
import { firstHint } from './ui_ai_tour.js';

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
    const chip = el('button', `anomalous-ai-privacy is-${level}`);
    chip.type = 'button';
    chip.title = t(`aiPrivacyBtnHint_${level}`);
    const state = el('span', 'anomalous-ai-privacy-state');
    state.append(icon(level === 'off' ? 'shield' : 'lock', 15), el('span', '', t(`aiPrivacyBtn_${level}`)));
    const go = el('span', 'anomalous-ai-privacy-go');
    go.append(el('span', 'anomalous-ai-privacy-go-words', t('aiPrivacyBtnGo')), icon('chevronRight', 13));
    chip.append(state, go);
    const anchor = el('span', 'anomalous-ai-privacy-anchor'); // the bubble hangs from the button, not the ⓘ beside it
    anchor.append(chip);
    wrap.append(anchor);
    // The head is drawn again on each change: the bubble of the one before goes with it.
    document.querySelector('.anomalous-ai-first-hint[data-hint="privacy"]')?.remove();
    const bubble = task.private === true ? firstHint('privacy', t('aiFirstPrivacy')) : null;
    if (bubble) {
        bubble.classList.add('is-bubble');
        anchor.append(bubble);
    }
    chip.onclick = () => {
        bubble?.querySelector('.anomalous-ai-first-hint-done')?.click(); // pressed it: no need to say so again
        void openTaskPrivacy(task, changed);
    };
    if (task.private === true && task.reads_disk) {
        const words = t('aiPrivacyReach', { app: task.client || 'AI' });
        wrap.append(iconButton('anomalous-ai-privacy-reach', 'info', t('aiPrivacyReachShort'),
            () => void anomalousAlert(words, t('aiPrivacyReachShort')), { iconOnly: true, size: 14, title: words }));
    }
    return wrap;
}
