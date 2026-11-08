/**
 * ui_ai_plan.js
 * The plan card (蓝图) on a panel: the big steps an AI laid out for a picture (add_nodes(plan=…),
 * api/mcp_plans.py), each a ready-made way with its model. Before anything is built the user may drop
 * steps but the first, swap a step's model for one listed with it, tick "build without asking", and
 * press build, or write what to change. Answered, the card shows the steps as built (dropped ones struck
 * through) or the user's words; built without asking, a link asks again next time.
 */
import { resolveLocale, translate as t } from './locales.js';

const words = value => (resolveLocale() === 'zh' ? value?.zh : value?.en) || value?.en || value?.zh || '';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function knob(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

/** Which of `steps` the answer's plan kept, by its order: a set of their indices. */
function keptOf(steps, plan) {
    const kept = new Set();
    let at = 0;
    for (const item of plan || []) {
        while (at < steps.length && steps[at].block !== item.block) at += 1;
        if (at < steps.length) kept.add(at++);
    }
    return kept;
}

function stepRow(step, at, state) {
    const row = el('li', 'anomalous-ai-plan-step');
    row.append(el('span', 'anomalous-ai-plan-number', String(at + 1)));
    const body = el('div', 'anomalous-ai-plan-words');
    body.append(el('div', 'anomalous-ai-plan-name', words(step.title)));
    if (step.model) {
        const chosen = state.models[at] || step.model;
        const name = chosen === step.model ? step.model_name : (step.choices || []).find(item => item.model_id === chosen)?.name;
        if (state.open && (step.choices || []).length) {
            const pick = el('select', 'anomalous-ai-plan-model');
            pick.title = t('aiPlanSwap');
            for (const item of [{ model_id: step.model, name: step.model_name }, ...step.choices]) {
                const option = el('option', '', item.name);
                option.value = item.model_id;
                pick.append(option);
            }
            pick.value = chosen;
            pick.addEventListener('change', () => { state.models[at] = pick.value; });
            body.append(pick);
        } else {
            body.append(el('div', 'anomalous-ai-plan-model-name', t('aiPlanModel', { name: name || chosen })));
        }
    }
    row.append(body);
    if (state.open && at > 0) {
        row.append(knob('anomalous-ai-plan-drop', '×', () => {
            const dropped = row.classList.toggle('is-dropped');
            if (dropped) state.drop.add(at); else state.drop.delete(at);
        }));
        row.lastChild.title = t('aiPlanDrop');
    }
    if (state.dropped?.has(at)) row.classList.add('is-dropped');
    return row;
}

/** The plan card for `block` on a panel. `deps`: {sendAnswer, answerNote} of ui_ai_panel.js. */
export function planCard(block, ctx, { sendAnswer, answerNote }) {
    const answer = ctx.answers[block.id];
    const steps = block.steps || [];
    const state = { open: !answer && !ctx.closed, drop: new Set(), models: {} };
    if (answer?.plan) {
        const kept = keptOf(steps, answer.plan);
        state.dropped = new Set(steps.map((_step, at) => at).filter(at => !kept.has(at)));
        answer.plan.forEach((item, at) => {
            const index = [...kept][at];
            if (index != null && item.model) state.models[index] = item.model;
        });
    }
    const box = el('div', 'anomalous-ai-plan');
    box.append(el('p', 'anomalous-ai-plan-lead', t('aiPlanLead')));
    const list = el('ol', 'anomalous-ai-plan-steps');
    steps.forEach((step, at) => list.append(stepRow(step, at, state)));
    if (state.open) list.append(el('li', 'anomalous-ai-plan-more', t('aiPlanAdd')));
    box.append(list);
    const note = el('div', 'anomalous-ai-panel-error');
    if (answer) {
        if (answer.text) box.append(el('div', 'anomalous-ai-panel-typed', answer.text));
        else box.append(el('div', 'anomalous-ai-plan-done', t(answer.auto ? 'aiPlanBuiltAuto' : 'aiPlanBuilt')));
        if (answer.auto) {
            box.append(knob('anomalous-ai-plan-again', t('aiPlanAskAgain'), async (event) => {
                event.currentTarget.disabled = true;
                await fetch('/anomalous/ai_plans/auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto: false }) });
                event.currentTarget.textContent = t('aiPlanWillAsk');
            }));
        }
        box.append(answerNote(answer));
        return box;
    }
    if (!state.open) return box;
    const auto = el('input');
    auto.type = 'checkbox';
    const autoLine = el('label', 'anomalous-ai-plan-auto');
    autoLine.append(auto, el('span', '', t('aiPlanAuto')));
    const send = async (body, buttons) => {
        buttons.forEach((node) => { node.disabled = true; });
        try {
            await sendAnswer(ctx.taskId, { step: ctx.stepId, block: block.id, ...body });
            ctx.changed();
        } catch (error) {
            note.textContent = error.message;
            buttons.forEach((node) => { node.disabled = false; });
        }
    };
    const actions = el('div', 'anomalous-ai-plan-actions');
    const build = knob('anomalous-ai-panel-send', t('aiPlanBuild'), () => send({
        choice: ['build'], plan: { drop: [...state.drop], models: state.models }, auto: auto.checked }, [build, change]));
    const change = knob('anomalous-ai-plan-change', t('aiPlanChange'), () => {
        if (box.querySelector('.anomalous-ai-plan-why')) return;
        const line = el('div', 'anomalous-ai-panel-input anomalous-ai-plan-why');
        const field = el('input');
        field.type = 'text';
        field.maxLength = 2000;
        field.placeholder = t('aiPlanChangeHint');
        const go = knob('anomalous-ai-panel-send', t('aiPanelSend'), () => {
            if (field.value.trim()) send({ text: field.value }, [build, change, go]);
        });
        field.addEventListener('keydown', (event) => {
            event.stopPropagation(); // typing here is not the browser's shortcuts
            if (event.key === 'Enter' && !event.isComposing) go.click();
        });
        line.append(field, go);
        actions.after(line);
        field.focus();
    });
    actions.append(build, change, el('span', 'anomalous-ai-plan-where', t('aiPlanWhere')));
    box.append(autoLine, actions, note);
    return box;
}
