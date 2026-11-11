/**
 * The user's word on a finished run (api/ai_run_control.py set_verdict), under its pictures: turned
 * out well, or not; a click again takes it back. Under "not quite right", what is off, a click each
 * (the hands, too dark, the framing…): an AI that is not sent the pictures goes by it. It goes to
 * the AI as their message.
 * POST /anomalous/ai_tasks/{task}/runs/{step}/verdict {verdict: good | bad | null, issues}; the task's
 * update draws it chosen.
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { icon } from './ui_ai_icons.js';

const ISSUES = ['hands', 'face', 'body', 'composition', 'dark', 'bright', 'blurry', 'style', 'subject', 'extra']; // ai_run_control.ISSUES

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function pick(className, chosen, title) {
    const node = el('button', `anomalous-ai-verdict-pick ${className}${chosen ? ' is-chosen' : ''}`);
    node.type = 'button';
    node.setAttribute('aria-pressed', String(chosen));
    if (title) node.title = title;
    return node;
}

/** The buttons of run `step` in task `taskId`, what the user chose marked. */
export function verdictRow(step, taskId) {
    const row = el('div', 'anomalous-ai-verdict');
    const send = async (word) => {
        row.querySelectorAll('button').forEach(item => { item.disabled = true; });
        try {
            const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(step.id)}/verdict`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(word),
            });
            const answer = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(answer.error || response.statusText);
        } catch (error) {
            row.querySelectorAll('button').forEach(item => { item.disabled = false; });
            await anomalousAlert(error.message);
        }
    };
    row.append(el('span', 'anomalous-ai-verdict-ask', t(step.verdict ? 'aiVerdictKept' : 'aiVerdictAsk')));
    for (const verdict of ['good', 'bad']) {
        const chosen = step.verdict === verdict;
        const node = pick(`is-${verdict}`, chosen, t(chosen ? 'aiVerdictTakeBack' : `aiVerdictHint_${verdict}`));
        node.append(icon(verdict === 'good' ? 'check' : 'close', 13), el('span', '', t(`aiVerdict_${verdict}`)));
        node.onclick = () => void send({ verdict: chosen ? null : verdict });
        row.append(node);
    }
    if (step.verdict === 'bad') {
        const said = new Set(step.issues || []);
        const issues = el('div', 'anomalous-ai-verdict-issues');
        issues.append(el('span', 'anomalous-ai-verdict-ask', t('aiIssuesAsk')));
        for (const name of ISSUES) {
            const node = pick('is-issue', said.has(name));
            node.textContent = t(`aiIssue_${name}`);
            node.onclick = () => void send({ verdict: 'bad', issues: ISSUES.filter(item => (item === name) !== said.has(item)) });
            issues.append(node);
        }
        row.append(issues);
    }
    return row;
}
