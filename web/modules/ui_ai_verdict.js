/**
 * The user's word on a finished run (api/ai_run_control.py set_verdict), under its pictures: turned
 * out well, or not; a click again takes it back. It goes to the AI as their message.
 * POST /anomalous/ai_tasks/{task}/runs/{step}/verdict {verdict: good | bad | null}; the task's update
 * draws it chosen.
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

/** The two buttons of run `step` in task `taskId`, the one the user chose marked. */
export function verdictRow(step, taskId) {
    const row = el('div', 'anomalous-ai-verdict');
    row.append(el('span', 'anomalous-ai-verdict-ask', t(step.verdict ? 'aiVerdictKept' : 'aiVerdictAsk')));
    for (const verdict of ['good', 'bad']) {
        const chosen = step.verdict === verdict;
        const node = el('button', `anomalous-ai-verdict-pick is-${verdict}${chosen ? ' is-chosen' : ''}`);
        node.type = 'button';
        node.setAttribute('aria-pressed', String(chosen));
        node.title = t(chosen ? 'aiVerdictTakeBack' : `aiVerdictHint_${verdict}`);
        node.append(icon(verdict === 'good' ? 'check' : 'close', 13), el('span', '', t(`aiVerdict_${verdict}`)));
        node.onclick = async () => {
            row.querySelectorAll('button').forEach(item => { item.disabled = true; });
            try {
                const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(step.id)}/verdict`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict: chosen ? null : verdict }),
                });
                const answer = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(answer.error || response.statusText);
            } catch (error) {
                row.querySelectorAll('button').forEach(item => { item.disabled = false; });
                await anomalousAlert(error.message);
            }
        };
        row.append(node);
    }
    return row;
}
