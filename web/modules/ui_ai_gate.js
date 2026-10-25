/**
 * Gates on the AI workbench (api/ai_gates.py): the card under a step that waits for the user's OK
 * (what the AI wants to do; Allow, No with a reason for the AI, and "from now on, go ahead"), what
 * the user answered, and the Gates window where each kind of action is set to go ahead, ask first
 * or never (changing the canvas, using the GPU, downloading, going online, moving model files), whether a new
 * task works in a canvas tab of its own (api/ai_task_canvas.py), which tools AI apps are offered
 * (all, the daily set for a small model, or on demand: a few and the rest through a directory), and whether the AI waits for a run or the user tells it
 * when the run is done (ui_ai_call.js).
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { aiWindow } from './ui_ai_connect.js';

export const GATES = ['canvas', 'gpu', 'download', 'network', 'files'];
const POLICIES = ['auto', 'ask', 'never'];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

async function post(url, body) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
}

/** The user's answer to a step waiting at a gate: {decision: allow | deny, text?, remember?}. */
export function decideGate(taskId, stepId, answer) {
    return post(`/anomalous/ai_tasks/${encodeURIComponent(taskId)}/gate`, { step: stepId, ...answer });
}

/** What the user answered, or the card to answer with, under a step that has a gate; null otherwise. */
export function gateCard(step, taskId, changed) {
    const asked = step.gate;
    if (!asked || (!asked.lines && !asked.decision)) return null;
    if (step.state !== 'asking') {
        if (!asked.decision || asked.earlier) return null;
        const words = asked.decision === 'allow'
            ? t(step.state === 'allowed' ? 'aiGateAllowedLater' : 'aiGateAllowed')
            : t('aiGateDenied') + (asked.text ? `：${asked.text}` : '');
        return el('div', `anomalous-ai-gate-answer is-${asked.decision}`, words);
    }
    const card = el('div', 'anomalous-ai-gate');
    card.append(el('div', 'anomalous-ai-gate-title', t(`aiGateQ_${asked.gate}`)),
        el('div', 'anomalous-ai-gate-why', t(`aiGateWhy_${asked.gate}`)));
    if (asked.lines?.length) {
        const lines = el('dl', 'anomalous-ai-gate-lines');
        for (const line of asked.lines) {
            const label = t(`aiGateArg_${line.label}`);
            lines.append(el('dt', '', label === `aiGateArg_${line.label}` ? line.label : label), el('dd', '', line.value));
        }
        card.append(lines);
    }
    const reason = el('input', 'anomalous-ai-gate-reason');
    reason.placeholder = t('aiGateReason');
    reason.addEventListener('keydown', event => event.stopPropagation());
    const remember = el('label', 'anomalous-ai-gate-remember');
    const box = el('input');
    box.type = 'checkbox';
    remember.append(box, el('span', '', t('aiGateRemember', { gate: t(`aiGate_${asked.gate}`) })));
    const answer = async (decision) => {
        card.querySelectorAll('button').forEach((item) => { item.disabled = true; });
        try {
            await decideGate(taskId, step.id, { decision, text: reason.value.trim(), remember: box.checked });
        } catch (error) {
            await anomalousAlert(error.message);
        }
        changed();
    };
    const actions = el('div', 'anomalous-ai-gate-actions');
    actions.append(button('anomalous-ai-gate-allow', t('aiGateAllow'), () => answer('allow')),
        button('anomalous-ai-gate-deny', t('aiGateDeny'), () => answer('deny')), remember);
    card.append(reason, actions);
    if (asked.timed_out) card.append(el('div', 'anomalous-ai-gate-note', t('aiGateLate')));
    return card;
}

/** A row of the Gates window: a setting, its words and its choices; `save(choice)` posts it and gives what is kept. */
function choiceRow(key, choices, current, labelOf, save) {
    const row = el('div', 'anomalous-ai-gates-row');
    const words = el('div', 'anomalous-ai-gates-words');
    words.append(el('div', 'anomalous-ai-gates-name', t(`aiGate_${key}`)), el('div', 'anomalous-ai-gates-tools', t(`aiGateWhy_${key}`)));
    const choice = el('div', 'anomalous-ai-gates-choice');
    choice.setAttribute('role', 'radiogroup');
    let kept = current;
    const draw = () => choice.querySelectorAll('button').forEach((item, at) => item.classList.toggle('is-on', choices[at] === kept));
    for (const value of choices) {
        const option = button('anomalous-ai-gates-option', labelOf(value), async () => {
            try {
                kept = await save(value);
            } catch (error) {
                await anomalousAlert(error.message);
                return;
            }
            draw();
        });
        option.setAttribute('role', 'radio');
        choice.append(option);
    }
    draw();
    row.append(words, choice);
    return row;
}

/** The Gates window: each kind of action the AI may do (goes ahead, asks or never), where it works, which tools it gets. */
export async function openGates() {
    const body = el('div', 'anomalous-ai-gates');
    body.append(el('p', 'anomalous-ai-gates-intro', t('aiGatesIntro')));
    let known = {};
    try {
        known = await (await fetch('/anomalous/ai_gates')).json();
    } catch (_) { /* drawn with nothing chosen; a change still saves */ }
    const save = async change => post('/anomalous/ai_gates', change);
    for (const gate of GATES) {
        body.append(choiceRow(gate, POLICIES, known.policies?.[gate], policy => t(`aiPolicy_${policy}`),
            async policy => (await save({ gate, policy })).policies[gate]));
    }
    body.append(choiceRow('canvasTab', ['new', 'current'], known.canvas_tab || 'new', mode => t(`aiCanvasTab_${mode}`),
        async mode => (await save({ canvas_tab: mode })).canvas_tab),
    choiceRow('tools', ['daily', 'full'], known.tools || 'full', set => t(`aiToolSet_${set}`),
        async set => (await save({ tools: set })).tools),
    choiceRow('answerWait', [60, 180, 600], known.answer_wait || 180, seconds => t(`aiAnswerWait_${seconds}`),
        async seconds => (await save({ answer_wait: seconds })).answer_wait),
    choiceRow('runs', ['call', 'wait'], known.runs || 'call', mode => t(`aiRunWait_${mode}`),
        async mode => (await save({ runs: mode })).runs),
    el('p', 'anomalous-ai-gates-note', t('aiGatesNote')));
    aiWindow(t('aiGates'), body);
}
