/**
 * What the AI's card over the canvas says (ui_ai_float.js places and shows it): the tag's first line by
 * what goes on (ai_float_state.js floatState), as the strip over the workbench's message box says it
 * (ui_ai_now.js): a pause, a step waiting for an OK (Allow, No, a fact or two of what it would do), a
 * run (its bar and stop, ui_ai_run_live.js; its progress moves them alone), a call and what it is about,
 * the AI thinking between two calls with its last step, a quiet AI, a task waiting for one, the end with
 * what it made. Then the first open question: a pick of one among few or a line answered here (the
 * half-typed words shared with the workbench, ui_ai_panel.js draftField, surface 'float'), else a way to
 * the workbench; and the one line to the AI (POST .../message, as the workbench's message box).
 * `ctx`: { open() (the workbench on this task), refresh() (read the task again), closeSay(), says (task
 * id -> the line half typed), saying() (the head's button follows) }.
 */

import { resolveLocale, translate as t } from './locales.js';
import { stepDetail, toolKey } from './ai_task_view.js';
import { postTask } from './ai_task_cache.js';
import { floatOutcome } from './ai_float_state.js';
import { decideGate } from './ui_ai_gate.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { questionText } from './ui_ai_now.js';
import { progressWords, stopButton } from './ui_ai_run_live.js';
import { draftField, noteTyping, optionDetail, optionLabel, sendAnswer } from './ui_ai_panel.js';

const GATE_LINES = 2;
const SAID_MS = 2500;
const SAY_MAX = 1000;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, run, title = '') {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = run;
    if (title) node.title = title;
    return node;
}

function row(className, ...parts) {
    const line = el('div', className);
    line.append(...parts);
    return line;
}

const words = (text, className = 'anomalous-ai-float-words') => Object.assign(el('span', className, text), { title: text });

/** A head button of the card: an icon, its words as tooltip and label. */
export const floatTool = (name, label, run, { title = '', extra = '' } = {}) =>
    iconButton(`anomalous-ai-float-btn${extra}`, name, label, run, { iconOnly: true, size: 15, title });

/** The folded line's few words after the task's name. */
export function brief(view) {
    if (view.kind === 'run') {
        const { words: where, share } = progressWords({ state: 'submitting', ...view.step.progress });
        return share === null ? where : `${Math.round(share * 100)}%`;
    }
    if (view.kind === 'tool') return t(toolKey(view.step.tool));
    if (view.kind === 'gate' || view.kind === 'ask') return t('aiState_asks');
    if (view.kind === 'halt') return t(view.step.pause ? 'aiState_paused' : 'aiState_halted');
    return t(view.kind === 'thinking' ? 'aiState_live' : `aiState_${view.kind}`); // waiting, idle, done, error
}

function gateLine(task, gate, ctx) {
    const line = row('anomalous-ai-float-line is-gate', row('anomalous-ai-float-row', icon('shield', 14), words(t('aiNowGate', { what: t(toolKey(gate.tool)) }))));
    for (const fact of (gate.gate?.lines || []).slice(0, GATE_LINES)) {
        const label = t(`aiGateArg_${fact.label}`);
        line.append(words(`${label === `aiGateArg_${fact.label}` ? fact.label : label}${t('wordColon')}${fact.value}`, 'anomalous-ai-float-fact'));
    }
    const note = el('div', 'anomalous-ai-float-error');
    const actions = el('div', 'anomalous-ai-float-actions');
    const answer = decision => async () => {
        actions.querySelectorAll('button').forEach((node) => { node.disabled = true; }); // one answer
        try {
            await decideGate(task.id, gate.id, { decision });
            ctx.refresh();
        } catch (error) {
            note.textContent = error.message;
            actions.querySelectorAll('button').forEach((node) => { node.disabled = false; });
        }
    };
    actions.append(button('anomalous-ai-float-allow', t('aiGateAllow'), answer('allow')), button('anomalous-ai-float-deny', t('aiGateDeny'), answer('deny')),
        button('anomalous-ai-float-link', t('aiFloatSee'), ctx.open));
    line.append(actions, note);
    return line;
}

function runLine(task, run, ctx) {
    const said = words('');
    const percent = el('b', 'anomalous-ai-float-percent');
    const top = row('anomalous-ai-float-row', el('span', 'anomalous-ai-float-pulse'), said, percent);
    if (run.prompt_ids?.length) top.append(stopButton(task.id, run.id, ctx.refresh, true, Boolean(run.stop || run.progress?.stopping)));
    const fill = el('span', 'anomalous-ai-float-fill');
    const bar = row('anomalous-ai-float-bar', fill);
    const line = row('anomalous-ai-float-line is-run', top, bar);
    line.update = (step) => { // a run's progress moves these alone
        const { words: where, share } = progressWords({ state: 'submitting', ...step.progress });
        said.textContent = `${t('aiNowRun')} · ${where}`;
        said.title = said.textContent;
        percent.textContent = share === null ? '' : `${Math.round(share * 100)}%`;
        bar.classList.toggle('is-waiting', share === null);
        fill.style.width = share === null ? '' : `${Math.round(share * 100)}%`;
    };
    return line;
}

function endLine(task, view, ctx) {
    const outcome = floatOutcome(task);
    const counts = [outcome.images && t('aiCountImages', { count: outcome.images }), outcome.canvas && t('aiCountCanvas', { count: outcome.canvas })].filter(Boolean);
    return row(`anomalous-ai-float-line is-${view.kind}`,
        row('anomalous-ai-float-row', icon(view.kind === 'error' ? 'alert' : 'check', 14), words(t(`aiState_${view.kind}`)),
            button('anomalous-ai-float-results', t('aiFloatResults'), ctx.open)),
        ...(counts.length ? [words(counts.join(' · '), 'anomalous-ai-float-sub')] : []));
}

/** The tag's first line for `view` (floatState); null while only a question waits (its card says it). */
export function lineView(task, view, ctx) {
    const step = view.step;
    const plain = (kind, lead, text, sub = '') => row(`anomalous-ai-float-line is-${kind}`, row('anomalous-ai-float-row', lead, words(text)),
        ...(sub ? [words(sub, 'anomalous-ai-float-sub')] : []));
    if (view.kind === 'halt') {
        const said = step.pause ? (step.delivered ? 'aiPausedKnown' : 'aiPausedWaiting') : step.delivered ? 'aiHaltedKnown' : 'aiHaltedWaiting';
        return row(`anomalous-ai-float-line is-halt${step.pause ? ' is-pause' : ''}`,
            row('anomalous-ai-float-row', icon(step.pause ? 'pause' : 'stop', 14), el('span', 'anomalous-ai-float-words is-wrap', t(said))));
    }
    if (view.kind === 'gate') return gateLine(task, step, ctx);
    if (view.kind === 'run') return runLine(task, step, ctx);
    if (view.kind === 'tool') return plain('tool', el('span', 'anomalous-ai-float-pulse'), t(toolKey(step.tool)), task.private ? '' : stepDetail(step));
    if (view.kind === 'thinking') return plain('thinking', el('span', 'anomalous-ai-float-pulse is-soft'), t('aiFloatThinking'), step ? t('aiFloatLast', { what: t(toolKey(step.tool)) }) : '');
    if (view.kind === 'idle') return plain('idle', icon('clock', 14), t('aiFloatQuiet'));
    if (view.kind === 'waiting') return plain('waiting', icon('clock', 14), t('aiState_waiting'), t('aiFloatWaitingHint'));
    if (view.kind === 'done' || view.kind === 'error') return endLine(task, view, ctx);
    return null;
}

/** What `lineView` draws from: the line is made again only when this changed (a run's progress does not). */
export const lineKey = (task, view) => JSON.stringify([resolveLocale(), task.id, view.kind, view.step?.id, view.step?.tool, view.step?.summary,
    view.step?.pause, view.step?.delivered, view.step?.gate?.lines, view.kind === 'run' && [Boolean(view.step.prompt_ids?.length),
        Boolean(view.step.stop || view.step.progress?.stopping)], Boolean(task.ended) && floatOutcome(task)]);

/** The first open question (ai_float_state.js pickFloatAsk): answered here when `inline`, else in the workbench. */
export function askView(task, { step, block, inline, more }, ctx) {
    const box = el('div', 'anomalous-ai-float-ask');
    const head = row('anomalous-ai-float-ask-head', icon('question', 14), words(questionText(step, block), 'anomalous-ai-float-question'));
    const answers = el('div', 'anomalous-ai-float-answers');
    const note = el('div', 'anomalous-ai-float-error');
    const send = async (body) => {
        const nodes = [...box.querySelectorAll('button, input')];
        nodes.forEach((node) => { node.disabled = true; }); // one answer
        try {
            await sendAnswer(task.id, { step: step.id, block: block.id, ...body });
            ctx.refresh();
        } catch (error) {
            note.textContent = error.message;
            nodes.forEach((node) => { node.disabled = false; });
            box.querySelector('.is-picked')?.classList.remove('is-picked');
        }
    };
    if (inline) {
        const skip = button('anomalous-ai-float-skip', '', () => void send({ skip: true }));
        skip.append(icon('sparkle', 12), el('span', '', t('aiPanelSkip')));
        head.append(skip);
    }
    if (inline === 'choices') {
        for (const option of block.options) {
            const chip = button(`anomalous-ai-float-option${option.recommended ? ' is-recommended' : ''}`, '', () => {
                chip.classList.add('is-picked'); // which one goes shows at once
                void send({ choice: [option.id] });
            }, optionDetail(option) || '');
            if (option.recommended) chip.append(el('span', 'anomalous-ai-float-option-tag', t('aiPanelRecommended')));
            chip.append(el('span', 'anomalous-ai-float-option-label', optionLabel(option)));
            answers.append(chip);
        }
    } else if (inline === 'input') {
        const field = el('input', 'anomalous-ai-float-field');
        field.type = 'text';
        field.placeholder = block.placeholder || t('aiNowAnswerHere');
        draftField(field, task.id, step.id, block.id, 'float'); // the same half-typed words as the workbench's
        const go = button('anomalous-ai-float-go', t('aiPanelSend'), () => { if (field.value.trim()) void send({ text: field.value.trim() }); });
        field.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter' && !event.isComposing) go.click();
        });
        answers.append(field, go);
    } else {
        answers.append(button('anomalous-ai-float-option is-main', t('aiFloatToWorkbench'), ctx.open));
    }
    if (more) answers.append(button('anomalous-ai-float-link', t('aiNowMore', { count: more }), ctx.open));
    box.append(head, answers, note);
    return box;
}

/** The one line to the AI on `task`: Enter sends, Esc folds it; what was half typed stays in `ctx.says`. */
export function sayView(task, ctx) {
    const box = el('div', 'anomalous-ai-float-say');
    const field = el('input', 'anomalous-ai-float-field');
    field.type = 'text';
    field.maxLength = SAY_MAX;
    field.placeholder = t('aiFloatSayHere');
    field.setAttribute('aria-label', t('aiFloatSay'));
    field.value = ctx.says.get(task.id) || '';
    const said = el('span', 'anomalous-ai-float-said');
    let timer = 0;
    const send = async () => {
        const text = field.value.trim();
        if (!text || field.disabled) return;
        field.disabled = go.disabled = true;
        try {
            await postTask(task.id, { text, refs: [] }, 'message');
            ctx.says.delete(task.id);
            field.value = '';
            said.textContent = t('aiFloatSent');
            clearTimeout(timer);
            timer = setTimeout(() => { said.textContent = ''; }, SAID_MS);
            ctx.refresh();
        } catch (error) {
            said.textContent = error.message;
        } finally {
            field.disabled = go.disabled = false;
            if (field.isConnected) field.focus();
            ctx.saying();
        }
    };
    const go = floatTool('arrowRight', t('aiPanelSend'), () => void send(), { extra: ' is-send' });
    field.addEventListener('input', () => {
        if (field.value) ctx.says.set(task.id, field.value);
        else ctx.says.delete(task.id);
        noteTyping(task.id);
        ctx.saying();
    });
    field.addEventListener('keydown', (event) => {
        event.stopPropagation(); // Space, R, Ctrl+Enter… typed here are not the canvas's
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            void send();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            ctx.closeSay();
        }
    });
    box.append(field, go, said);
    return box;
}
