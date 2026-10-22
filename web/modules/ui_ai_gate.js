/**
 * Gates on the AI workbench (api/ai_gates.py): the card under a step that waits for the user's OK
 * (what the AI wants to do; Allow, No with a reason for the AI, and "from now on, go ahead"), what
 * the user answered, and the Gates window where each kind of action is set to go ahead, ask first
 * or never (changing the canvas, using the GPU, downloading, going online).
 */

import { translate as t } from './locales.js';
import { anomalousAlert } from './ui_dialog.js';
import { aiWindow } from './ui_ai_connect.js';

export const GATES = ['canvas', 'gpu', 'download', 'network'];
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
        for (const line of asked.lines) lines.append(el('dt', '', line.label), el('dd', '', line.value));
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
            await post(`/anomalous/ai_tasks/${encodeURIComponent(taskId)}/gate`,
                { step: step.id, decision, text: reason.value.trim(), remember: box.checked });
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

/** The Gates window: each kind of action the AI may do, and whether it goes ahead, asks or never. */
export async function openGates() {
    const body = el('div', 'anomalous-ai-gates');
    body.append(el('p', 'anomalous-ai-gates-intro', t('aiGatesIntro')));
    let policies = {};
    try {
        policies = (await (await fetch('/anomalous/ai_gates')).json()).policies || {};
    } catch (_) { /* drawn with nothing chosen; a change still saves */ }
    for (const gate of GATES) {
        const row = el('div', 'anomalous-ai-gates-row');
        const words = el('div', 'anomalous-ai-gates-words');
        words.append(el('div', 'anomalous-ai-gates-name', t(`aiGate_${gate}`)), el('div', 'anomalous-ai-gates-tools', t(`aiGateWhy_${gate}`)));
        const choice = el('div', 'anomalous-ai-gates-choice');
        choice.setAttribute('role', 'radiogroup');
        for (const policy of POLICIES) {
            const option = button(`anomalous-ai-gates-option${policies[gate] === policy ? ' is-on' : ''}`, t(`aiPolicy_${policy}`), async () => {
                try {
                    policies = (await post('/anomalous/ai_gates', { gate, policy })).policies;
                } catch (error) {
                    await anomalousAlert(error.message);
                    return;
                }
                choice.querySelectorAll('button').forEach((item, at) => item.classList.toggle('is-on', POLICIES[at] === policies[gate]));
            });
            option.setAttribute('role', 'radio');
            choice.append(option);
        }
        row.append(words, choice);
        body.append(row);
    }
    body.append(el('p', 'anomalous-ai-gates-note', t('aiGatesNote')));
    aiWindow(t('aiGates'), body);
}
