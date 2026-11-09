/**
 * The flow over an AI task: the stages of the work its steps went through, in the order they
 * came (models, combo, prompt, canvas, run, pictures, voice, library: action_catalog.py's), each
 * saying whether it is done, running, waiting for the user or failed; a job sheet's run says how far
 * it is. A stage leads to its first step in the timeline (`goTo(stepId)`). The stages come from
 * ai_task_view.js flowStages. With a blueprint (a plan card) a second line lays out what the AI means
 * to do, done steps lit, the coming ones dashed (planFlow), whether the user was asked or not.
 */

import { resolveLocale, translate as t } from './locales.js';
import { flowStages, planFlow } from './ai_task_view.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function chip(state, words, first, goTo) {
    const node = el('button', `anomalous-ai-flow-stage is-${state}`);
    node.type = 'button';
    node.title = t(`aiFlowState_${state}`);
    node.append(el('span', 'anomalous-ai-flow-mark'), el('span', 'anomalous-ai-flow-words', words));
    node.onclick = () => goTo(first);
    return node;
}

function row(className, parts) {
    const line = el('div', className);
    parts.forEach((part, at) => {
        if (at) line.append(el('span', 'anomalous-ai-flow-arrow', '›'));
        line.append(part);
    });
    return line;
}

const MODEL_CHARS = 22; // a model's name on a blueprint step, the rest on hover

// A block's title is in both languages ({zh, en}, api/blocks): the one the window shows.
const words = value => (typeof value === 'string' ? value : (resolveLocale() === 'zh' ? value?.zh : value?.en) || value?.en || value?.zh || '');

/** The blueprint's line: its steps as chips, ahead of time too. */
function planRow(plan, goTo) {
    const parts = plan.items.map((item) => {
        const model = item.model && item.model.length > MODEL_CHARS ? `${item.model.slice(0, MODEL_CHARS - 1)}…` : item.model;
        const node = chip(item.state, item.key ? t(item.key) : [words(item.title), model].filter(Boolean).join(' · '), item.first, goTo);
        if (model !== item.model) node.title += `
${item.model}`; // the whole name where it was cut
        return node;
    });
    const line = row('anomalous-ai-flow-plan', parts);
    const label = el('button', 'anomalous-ai-flow-label', t(`aiFlowPlan_${plan.state}`));
    label.type = 'button';
    label.onclick = () => goTo(plan.card);
    line.prepend(label);
    return line;
}

export function flowMap(task, goTo) {
    const stages = flowStages(task);
    const plan = planFlow(task);
    if (!stages.length && !plan) return null;
    const box = el('div', 'anomalous-ai-flow');
    box.setAttribute('aria-label', t('aiFlow'));
    const done = stages.map((item) => {
        const node = chip(item.state, item.sheet ? t('aiFlowSheet', item.sheet) : t(`aiStage_${item.stage}`), item.first, goTo);
        if (item.count > 1 && !item.sheet) node.append(el('span', 'anomalous-ai-flow-count', `×${item.count}`));
        return node;
    });
    if (done.length) box.append(row('anomalous-ai-flow-done', done));
    if (plan) box.append(planRow(plan, goTo));
    return box;
}
