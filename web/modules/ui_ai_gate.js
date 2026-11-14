/**
 * Gates on the AI workbench (api/ai_gates.py): the card under a step that waits for the user's OK
 * (what the AI wants to do; Allow, No, a reason for the AI folded until asked for, and "from now
 * on, go ahead"), what
 * the user answered, and the Gates window where each kind of action is set to go ahead, ask first
 * or never (changing the canvas, using the GPU, downloading, going online, moving model files), safety levels
 * (careful, balanced, free) that set them together with node/route rules, blueprint auto-build and timeout behavior,
 * whether a new task works in a canvas tab of its own (api/ai_task_canvas.py), how long the AI waits for the
 * user's answer and what happens when nobody answers, and whether the AI waits for a run or the user tells it when the run is done
 * (ui_ai_call.js). The window shows the level first; the single settings are folded under it (open while the level is
 * custom, or as the user left the fold in this browser), each with two lines of its words until pressed. "Restore every
 * default" sets the window back to a new install's.
 */

import { translate as t } from './locales.js';
import { anomalousAlert, anomalousConfirm } from './ui_dialog.js';
import { aiWindow } from './ui_ai_connect.js';
import { darkroomPart } from './ui_ai_darkroom.js';
import { icon } from './ui_ai_icons.js';

export const GATES = ['canvas', 'gpu', 'download', 'network', 'files'];
const POLICIES = ['auto', 'ask', 'never'];
const LEVELS = ['careful', 'balanced', 'free'];
const LEVEL_VALUES = new Set([...LEVELS, 'custom']);
const EACH_KEY = 'anomalous_ai_gates_each'; // the single settings left unfolded, in this browser

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
            : t('aiGateDenied') + (asked.text ? `${t('wordColon')}${asked.text}` : '');
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
    reason.hidden = true; // a reason is optional: the line opens from "say how to change it"
    reason.addEventListener('keydown', event => event.stopPropagation());
    const why = button('anomalous-ai-panel-own', '', () => {
        reason.hidden = false;
        why.remove();
        reason.focus();
    });
    why.append(icon('pencil', 13), el('span', '', t('aiGateSayWhy')));
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
        button('anomalous-ai-gate-deny', t('aiGateDeny'), () => answer('deny')), why, remember);
    card.append(reason, actions);
    if (asked.timed_out) card.append(el('div', 'anomalous-ai-gate-note', t('aiGateLate')));
    return card;
}

/** Top row of the Gates window: three safety levels, none lit when `current` is custom. */
function levelRow(current, apply) {
    const row = el('div', 'anomalous-ai-gates-row anomalous-ai-gates-level');
    row.append(el('div', 'anomalous-ai-gates-name', t('aiLevel')));
    const choice = el('div', 'anomalous-ai-gates-choice');
    choice.setAttribute('role', 'radiogroup');
    const note = el('div', 'anomalous-ai-gates-tools');
    let kept = current;
    const draw = () => {
        choice.querySelectorAll('button').forEach((item, at) => {
            const on = LEVELS[at] === kept;
            item.classList.toggle('is-on', on);
            item.setAttribute('aria-checked', String(on));
        });
        note.textContent = LEVEL_VALUES.has(kept) ? t(`aiLevelWhy_${kept}`) : '';
        note.classList.toggle('is-custom', kept === 'custom');
    };
    for (const value of LEVELS) {
        const option = button('anomalous-ai-gates-option', t(`aiLevel_${value}`), () => apply(value));
        option.setAttribute('role', 'radio');
        option.dataset.level = value;
        choice.append(option);
    }
    draw();
    row.append(choice, note);
    return {
        row,
        set(next) {
            kept = next;
            draw();
        },
    };
}

/** A row of the Gates window: a setting, its words and its choices; `save(choice)` posts it and gives what is kept. */
function choiceRow(key, choices, current, labelOf, save) {
    const row = el('div', 'anomalous-ai-gates-row');
    const words = el('div', 'anomalous-ai-gates-words');
    const why = el('div', 'anomalous-ai-gates-tools', t(`aiGateWhy_${key}`));
    why.title = why.textContent; // two lines show; a press shows all of it
    why.onclick = () => why.classList.toggle('is-open');
    words.append(el('div', 'anomalous-ai-gates-name', t(`aiGate_${key}`)), why);
    const choice = el('div', 'anomalous-ai-gates-choice');
    choice.setAttribute('role', 'radiogroup');
    let kept = current;
    const draw = () => choice.querySelectorAll('button').forEach((item, at) => {
        const on = choices[at] === kept;
        item.classList.toggle('is-on', on);
        item.setAttribute('aria-checked', String(on));
    });
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

/** The Gates window: safety levels, each kind of action the AI may do, where it works, which tools it gets. */
export async function openGates() {
    const body = el('div', 'anomalous-ai-gates');
    body.append(el('p', 'anomalous-ai-gates-intro', t('aiGatesIntro')));
    let known = {};
    let loaded = false;
    try {
        known = await (await fetch('/anomalous/ai_gates')).json();
        loaded = true;
    } catch (_) { /* drawn with nothing chosen; a change still saves */ }
    const rows = el('div', 'anomalous-ai-gates-rows');
    const drawRows = (data) => {
        let top = null;
        const save = async (change) => {
            const next = await post('/anomalous/ai_gates', change);
            if (!loaded) {
                loaded = true;
                drawRows(next);
            } else {
                top?.set(next.level);
            }
            return next;
        };
        const applyLevel = async (value) => {
            const hadFocus = top.row.contains(document.activeElement);
            const buttons = [...top.row.querySelectorAll('button')];
            buttons.forEach((item) => { item.disabled = true; });
            let next;
            try {
                next = await post('/anomalous/ai_gates', { level: value });
            } catch (error) {
                buttons.forEach((item) => { item.disabled = false; });
                await anomalousAlert(error.message);
                return;
            }
            loaded = true;
            drawRows(next);
            if (hadFocus) rows.querySelector(`[data-level="${value}"]`)?.focus();
        };
        top = levelRow(data.level, applyLevel);
        const list = [];
        for (const gate of GATES) {
            list.push(choiceRow(gate, POLICIES, data.policies?.[gate], policy => t(`aiPolicy_${policy}`),
                async policy => (await save({ gate, policy })).policies[gate]));
        }
        list.push(
            choiceRow('canvasTab', ['new', 'current'], data.canvas_tab || 'new', mode => t(`aiCanvasTab_${mode}`),
                async mode => (await save({ canvas_tab: mode })).canvas_tab),
            choiceRow('privacy', [false, true], data.privacy === true, on => t(`aiPrivacyDefault_${on}`),
                async on => (await save({ privacy: on })).privacy),
            choiceRow('privacyModels', [true, false], data.privacy_models !== false, on => t(`aiPrivacyModels_${on}`),
                async on => (await save({ privacy_models: on })).privacy_models),
            choiceRow('answerWait', [60, 180, 600], data.answer_wait || 180, seconds => t(`aiAnswerWait_${seconds}`),
                async seconds => (await save({ answer_wait: seconds })).answer_wait),
            choiceRow('noAnswer', ['stop', 'recommended'], data.no_answer || 'stop', mode => t(`aiNoAnswer_${mode}`),
                async mode => (await save({ no_answer: mode })).no_answer),
            choiceRow('runs', ['call', 'wait'], data.runs || 'call', mode => t(`aiRunWait_${mode}`),
                async mode => (await save({ runs: mode })).runs),
            choiceRow('nodes', ['any', 'ways'], data.nodes || 'any', mode => t(`aiNodeRule_${mode}`),
                async mode => (await save({ nodes: mode })).nodes),
            choiceRow('route', ['allow', 'ask'], data.routes || 'allow', mode => t(`aiRouteRule_${mode}`),
                async mode => (await save({ routes: mode })).routes),
        );
        const each = el('details', 'anomalous-ai-gates-each');
        const head = el('summary', '', t('aiGatesEach', { count: list.length }));
        head.onclick = () => { // before it folds or unfolds
            try { localStorage.setItem(EACH_KEY, each.open ? '0' : '1'); } catch (_) { /* this viewer's convenience */ }
        };
        let left = false;
        try { left = localStorage.getItem(EACH_KEY) === '1'; } catch (_) { /* folded */ }
        each.open = data.level === 'custom' || left;
        each.append(head, ...list);
        rows.replaceChildren(top.row, each);
    };
    drawRows(known);
    const reset = button('anomalous-ai-link', t('aiGatesReset'), async () => {
        if (!await anomalousConfirm(t('aiGatesResetConfirm'), t('aiGatesReset'))) return;
        try {
            drawRows(await post('/anomalous/ai_gates', { reset: true }));
            loaded = true;
        } catch (error) {
            await anomalousAlert(error.message);
        }
    });
    const foot = el('div', 'anomalous-ai-gates-foot');
    foot.append(el('p', 'anomalous-ai-gates-note', t('aiGatesNote')), reset);
    body.append(rows, darkroomPart(), foot);
    aiWindow(t('aiGates'), body);
}
