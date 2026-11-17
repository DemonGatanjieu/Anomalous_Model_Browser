/**
 * A task the user started, waiting for an AI (ui_ai_workbench.js), as three steps in the order they are
 * done, each with its picture (ui_ai_art.js): say what you want in the message box at the foot of the
 * column (or not yet), copy the line for the AI with the one big button, paste it in the AI app. The line itself, which names the AI's tools,
 * stays folded under the button. What was sent shows under it and the AI gets it when it takes the
 * task; under that, the switch for a desktop notification when the AI waits for them (ui_ai_notify.js).
 * Until an AI has ever come, connecting comes first: an app that does not know AMB yet can do nothing
 * with the line. With no task at all, the welcome page stands in for it (welcomePage).
 */

import { translate as t } from './locales.js';
import { connectHint } from './ui_ai_connect.js';
import { art } from './ui_ai_art.js';
import { copyText } from './ui_dialog.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { notifyLine } from './ui_ai_notify.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function step(number, name, title, sub, done = false) {
    const item = el('li', `anomalous-ai-waiting-step${done ? ' is-done' : ''}`);
    const mark = el('span', 'anomalous-ai-waiting-step-mark');
    mark.append(done ? icon('check', 16) : el('span', '', String(number)));
    const words = el('span', 'anomalous-ai-waiting-step-words');
    words.append(el('span', 'anomalous-ai-waiting-step-title', title), el('span', 'anomalous-ai-waiting-step-sub', sub));
    item.append(mark, art(name, 'anomalous-ai-waiting-step-art'), words);
    return item;
}

/** The big button copying `sentence`, saying so when it did. */
function copyButton(sentence) {
    const label = t('aiWaitingCopy');
    const copy = iconButton('anomalous-ai-waiting-copy', 'copy', label, async () => {
        const done = await copyText(sentence);
        copy.lastChild.textContent = t(done ? 'aiCopied' : 'aiCallNotCopied');
        copy.classList.toggle('is-done', done);
        setTimeout(() => {
            copy.lastChild.textContent = label;
            copy.classList.remove('is-done');
        }, 1800);
    });
    return copy;
}

/** The waiting task's page. `ctx`: {connected (an AI has come before), ready (the user's steps so far, drawn)}. */
export function waitingView(task, ctx) {
    const view = el('div', 'anomalous-ai-waiting');
    const sentence = task.title ? t('aiHandSentence', { task: task.title }) : t('aiWaitingSentence');
    const said = ctx.ready.length > 0;
    const steps = el('ol', 'anomalous-ai-waiting-steps');
    steps.append(step(1, 'write', t('aiWaitingStep1'), t(said ? 'aiWaitingStep1Done' : 'aiWaitingStep1Sub'), said),
        step(2, 'copy', t('aiWaitingStep2'), t('aiWaitingStep2Sub')), step(3, 'paste', t('aiWaitingStep3'), t('aiWaitingStep3Sub')));
    const line = el('details', 'anomalous-ai-waiting-sentence');
    line.append(el('summary', '', t('aiWaitingSeeSentence')), el('p', '', sentence));
    view.append(...(ctx.connected ? [] : [connectHint(task.title)]), // the steps have their pictures
        el('div', 'anomalous-ai-waiting-title', t('aiWaitingSay')), steps, copyButton(sentence), line);
    const notify = notifyLine(); // they leave for the AI app now: a word when it waits for them here
    if (notify) view.append(notify);
    if (ctx.ready.length) {
        const done = el('section', 'anomalous-ai-ready-done');
        done.append(el('div', 'anomalous-ai-ready-label', t('aiWaitingReadyDone', { count: ctx.ready.length })), ...ctx.ready);
        view.append(done);
    }
    return view;
}

/** The page with no task yet: what it is for; `onNew` starts one. */
export function welcomePage(onNew) {
    const box = el('div', 'anomalous-ai-welcome');
    const picture = el('img', 'anomalous-ai-welcome-art');
    picture.src = new URL('../assets/ai_tasks_empty.webp', import.meta.url).href;
    picture.alt = '';
    box.append(picture, el('h2', 'anomalous-ai-welcome-title', t('aiWelcomeTitle')), el('p', 'anomalous-ai-welcome-body', t('aiWelcomeBody')),
        iconButton('anomalous-ai-new-task', 'plus', t('aiNewTask'), onNew, { title: t('aiNewTaskHint') }), connectHint());
    return box;
}
