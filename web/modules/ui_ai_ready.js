/**
 * A task the user started, waiting for an AI (ui_ai_workbench.js), on one page with one thing to
 * do: send the AI the sentence, with its Copy button. What to say first, and pictures, go in the
 * message box at the foot of the column, as its words there say; what was sent shows under the
 * sentence and the AI gets it when it takes the task. Until an AI has ever come, connecting comes
 * first: an app that does not know AMB yet can do nothing with the sentence. With no task at all,
 * the welcome page stands in for it (welcomePage).
 */

import { translate as t } from './locales.js';
import { art, connectHint, copyLine } from './ui_ai_connect.js';
import { iconButton } from './ui_ai_icons.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** The waiting task's page. `ctx`: {connected (an AI has come before), ready (the user's steps so far, drawn)}. */
export function waitingView(task, ctx) {
    const view = el('div', 'anomalous-ai-waiting');
    const sentence = task.title ? t('aiHandSentence', { task: task.title }) : t('aiWaitingSentence');
    view.append(ctx.connected ? art('waiting', 'anomalous-ai-waiting-art') : connectHint(task.title),
        el('div', 'anomalous-ai-waiting-title', t('aiWaitingSay')),
        el('p', 'anomalous-ai-waiting-body', t('aiWaitingBody')),
        copyLine(sentence, { code: false, label: t('aiConnectCopySentence') }));
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
