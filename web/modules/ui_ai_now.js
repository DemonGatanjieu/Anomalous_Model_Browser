/**
 * What the task needs or does now, over its message box (ui_ai_message.js, in the workbench's dock),
 * so the user follows it from the foot of the page: a step waiting at a gate (Allow, No, see the
 * step), a run going (where it stands, a thin bar, stop), the AI busy with a tool; and the newest
 * question nobody answered yet (one the user half answered stays in front), to answer there: a pick of one as buttons that
 * send at a press (and a line of one's own, folded, when the AI allows it), a line of text, or the
 * way to the stage for the rest (several picks, pictures to pick); "let the AI decide" sits in its
 * head. When none of that is there, the lines to paste into the
 * AI's chat once it has stopped (ui_ai_call.js), in the same place. Drawn again as
 * the task changes; a question's card only when another question comes, keeping what was half
 * typed in it (ui_ai_panel.js draftField).
 */

import { translate as t } from './locales.js';
import { taskStatus } from './ai_task_status.js';
import { toolKey } from './ai_task_view.js';
import { icon } from './ui_ai_icons.js';
import { progressWords, stopButton } from './ui_ai_run_live.js';
import { panelSteps, QUESTIONS } from './ui_ai_side.js';
import { draftField, hasDraft, optionLabel, ownWords, sendAnswer } from './ui_ai_panel.js';
import { decideGate } from './ui_ai_gate.js';
import { callRow } from './ui_ai_call.js';

const RUNNING = ['submitting', 'queued', 'running'];
const MAX_OPTIONS = 6;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, run, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = run;
    if (title) node.title = title;
    return node;
}

/** The questions nobody answered yet, the newest panel's first: [{step, block}]. */
function openAsks(task) {
    const out = [];
    for (const step of [...panelSteps(task)].reverse()) {
        if (step.panel.closed) continue;
        for (const block of step.panel.blocks || []) {
            if (QUESTIONS.includes(block?.type) && !(step.answers || {})[block.id]) out.push({ step, block });
        }
    }
    return out;
}

/** The line of what goes on: a gate's question, a run, a tool; null when nothing does. */
function statusLine(task, ctx) {
    const gate = (task.steps || []).findLast(step => step.state === 'asking' && step.gate);
    if (gate) {
        const line = el('div', 'anomalous-ai-now-line is-gate');
        const answer = decision => async () => {
            line.querySelectorAll('button').forEach((node) => { node.disabled = true; });
            try {
                await decideGate(task.id, gate.id, { decision });
            } finally {
                ctx.refresh();
            }
        };
        line.append(icon('shield', 15), el('span', 'anomalous-ai-now-words', t('aiNowGate', { what: t(toolKey(gate.tool)) })),
            button('anomalous-ai-now-allow', t('aiGateAllow'), answer('allow')), button('anomalous-ai-now-deny', t('aiGateDeny'), answer('deny')),
            button('anomalous-ai-link', t('aiNowSee'), () => ctx.showStep(gate.id)));
        return line;
    }
    const status = taskStatus(task);
    if (status.run && RUNNING.includes(status.state)) {
        const { words, share } = progressWords({ state: 'submitting', ...status.run.progress });
        const line = el('div', 'anomalous-ai-now-line is-run');
        const bar = el('span', `anomalous-ai-now-bar${share === null ? ' is-waiting' : ''}`);
        const fill = el('span', 'anomalous-ai-now-fill');
        if (share !== null) fill.style.width = `${Math.round(share * 100)}%`;
        bar.append(fill);
        line.append(el('span', 'anomalous-ai-now-pulse'), el('span', 'anomalous-ai-now-words', `${t('aiNowRun')} · ${words}`),
            ...(share !== null ? [el('b', 'anomalous-ai-now-percent', `${Math.round(share * 100)}%`)] : []), bar);
        if (status.run.prompt_ids?.length) line.append(stopButton(task.id, status.run.id, ctx.refresh, true, Boolean(status.run.stop || status.run.progress?.stopping)));
        return line;
    }
    if (status.state === 'tool') {
        const line = el('div', 'anomalous-ai-now-line is-tool');
        line.append(el('span', 'anomalous-ai-now-pulse'), el('span', 'anomalous-ai-now-words', t('aiNowTool', { what: t(toolKey(status.active.tool)) })));
        return line;
    }
    return null;
}

/** The card answering the first open question; `more`: how many others wait. */
function askCard(task, { step, block }, more, ctx) {
    const card = el('div', 'anomalous-ai-now-ask');
    const head = el('div', 'anomalous-ai-now-ask-head');
    head.append(icon('question', 15), el('span', 'anomalous-ai-now-question', block.question || step.panel.title || t('aiNowAsk')));
    if (more) head.append(button('anomalous-ai-link', t('aiNowMore', { count: more }), ctx.openStage));
    const note = el('div', 'anomalous-ai-now-error');
    const decide = button('anomalous-ai-panel-skip', '', () => send({ skip: true }, [...card.querySelectorAll('button, input')]));
    decide.append(icon('sparkle', 13), el('span', '', t('aiPanelSkip')));
    head.append(decide);
    const send = async (body, nodes) => {
        nodes.forEach((node) => { node.disabled = true; });
        try {
            await sendAnswer(task.id, { step: step.id, block: block.id, ...body });
            ctx.refresh();
        } catch (error) {
            note.textContent = error.message;
            nodes.forEach((node) => { node.disabled = false; });
            card.querySelector('.is-picked')?.classList.remove('is-picked');
        }
    };
    const answers = el('div', 'anomalous-ai-now-answers');
    const options = Array.isArray(block.options) ? block.options : [];
    const ownLine = (placeholder) => {
        const line = el('div', 'anomalous-ai-now-own');
        const field = el('input', 'anomalous-ai-now-field');
        field.placeholder = placeholder;
        const go = button('anomalous-ai-panel-send', t('aiPanelSend'), () => {
            if (field.value.trim()) void send({ text: field.value.trim() }, [field, go, ...answers.querySelectorAll('button')]);
        });
        field.addEventListener('keydown', (event) => {
            event.stopPropagation(); // typing here is not the browser's shortcuts
            if (event.key === 'Enter' && !event.isComposing) go.click();
        });
        draftField(field, task.id, step.id, block.id, 'now');
        line.append(field, go);
        return line;
    };
    let hint = '';
    if (block.type === 'choices' && !block.multiple && options.length <= MAX_OPTIONS) {
        for (const option of options) {
            const chip = button(`anomalous-ai-now-option${option.recommended ? ' is-recommended' : ''}`, '', () => {
                chip.classList.add('is-picked'); // which one goes shows at once
                void send({ choice: [option.id] }, [...card.querySelectorAll('button, input')]);
            }, option.detail || '');
            if (option.recommended) chip.append(icon('star', 12));
            chip.append(el('span', '', optionLabel(option)), icon('arrowRight', 13, 'anomalous-ai-now-option-go'));
            answers.append(chip);
        }
        if (block.other) answers.append(ownWords('anomalous-ai-panel-own', () => ownLine(t('aiNowOther')), hasDraft(task.id, step.id, block.id)));
        hint = t('aiPanelHintOne');
    } else if (block.type === 'input') {
        answers.append(ownLine(block.placeholder || t('aiNowAnswerHere')));
    } else {
        answers.append(button('anomalous-ai-now-option', t(block.type === 'picks' ? 'aiNowPick' : 'aiNowOpen'), ctx.openStage));
    }
    card.append(head, ...(hint ? [el('div', 'anomalous-ai-panel-hint', hint)] : []), answers, note);
    return card;
}

/**
 * The strip, made once per task view; `update(task, ctx)` with ctx {refresh(), openStage(),
 * showStep(id)}, kept for the next update: a run's progress coming in alone updates it with
 * `update(task)`, as it moves the run's bar on the timeline.
 */
export function nowStrip() {
    const strip = el('div', 'anomalous-ai-now');
    const line = el('div', 'anomalous-ai-now-status');
    const ask = el('div', 'anomalous-ai-now-asks');
    const call = callRow();
    strip.append(ask, line, call);
    let kept = null;
    strip.update = (task, ctx = kept) => {
        kept = ctx;
        line.replaceChildren(...[statusLine(task, ctx)].filter(Boolean));
        const asks = task.ended ? [] : openAsks(task);
        const held = asks.findIndex(({ step, block }) => hasDraft(task.id, step.id, block.id));
        if (held > 0) asks.unshift(...asks.splice(held, 1)); // a question half answered stays in front as others come
        const key = asks.length ? JSON.stringify([asks[0].step.id, asks[0].block.id, asks.length]) : '';
        if (key !== ask.dataset.key) {
            ask.dataset.key = key;
            ask.replaceChildren(...(asks.length ? [askCard(task, asks[0], asks.length - 1, ctx)] : []));
        }
        call.update(line.childNodes.length || asks.length ? null : task); // while the AI or the user has something to do, no word is needed
        strip.hidden = !line.childNodes.length && !ask.childNodes.length && call.hidden;
    };
    return strip;
}
