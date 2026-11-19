/**
 * A task the user started, waiting for an AI (ui_ai_workbench.js), as three steps in the order they are
 * done, each with its picture (ui_ai_art.js): say what you want in the message box at the foot of the
 * column (or not yet), copy the line for the AI with the one big button, paste it in the AI app.
 * The sentence itself stays visible right below so the user can read or select it at a glance, along
 * with what was handed in (`task.about`, exported as `aboutStrip` so the timeline keeps it too) and what
 * was already prepared (`ctx.ready`); if no AI has ever connected yet, connecting comes first and the
 * button copies the full first-time sentence (`sentenceForAi`). With no task at all, welcomePage stands in.
 */

import { translate as t } from './locales.js';
import { connectHint, sentenceForAi } from './ui_ai_connect.js';
import { art } from './ui_ai_art.js';
import { copyText } from './ui_dialog.js';
import { icon, iconButton } from './ui_ai_icons.js';
import { notifyLine } from './ui_ai_notify.js';

const ABOUT_ICONS = { model: 'models', image: 'image', workflow: 'workflows', combo: 'combos', canvas: 'nodes' };
const QUICK_STARTERS = [
    ['private', 'lock'],
    ['picture', 'image'],
    ['say', 'pencil'],
    ['canvas', 'nodes'],
];

function quickStarterBar(onPickStarter) {
    if (!onPickStarter) return null;
    const row = el('div', 'anomalous-ai-ready-quick');
    row.append(el('span', 'anomalous-ai-ready-quick-label', t('aiComposerQuickLabel')));
    const pills = el('div', 'anomalous-ai-ready-quick-pills');
    for (const [id, iconName] of QUICK_STARTERS) {
        const pill = iconButton('anomalous-ai-ready-quick-pill', iconName, t(`aiStart_${id}_title`), () => onPickStarter(id), { size: 13 });
        pills.append(pill);
    }
    row.append(pills);
    return row;
}

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

/** A visible strip of what was handed to the task (`task.about`: models, images, workflows, combos, canvas). */
export function aboutStrip(about, _privateTask = false) {
    const items = (about || []).filter(item => item && typeof item === 'object');
    if (!items.length) return null;
    const box = el('div', 'anomalous-ai-ready-about');
    box.append(el('span', 'anomalous-ai-ready-about-label', t('aiWaitingAboutHead')));
    const chips = el('div', 'anomalous-ai-ready-about-chips');
    for (const item of items) {
        const chip = el('span', 'anomalous-ai-ready-about-chip');
        const name = item.label || item.name || item.image || item.tab || item.model_id || '';
        const kind = t(`aiAboutKind_${item.type || 'model'}`);
        chip.append(icon(ABOUT_ICONS[item.type] || 'models', 13), el('span', 'anomalous-ai-ready-about-kind', kind),
            el('span', 'anomalous-ai-ready-about-name', name));
        if (name) chip.title = name;
        chips.append(chip);
    }
    box.append(chips);
    return box;
}

/** The waiting task's page. `ctx`: {connected (an AI has come before), ready (the user's steps so far, drawn)}. */
export function waitingView(task, ctx) {
    const view = el('div', 'anomalous-ai-waiting');
    const sentence = !ctx.connected
        ? sentenceForAi(task.title || '')
        : (task.title ? t('aiHandSentence', { task: task.title }) : t('aiWaitingSentence'));
    const about = aboutStrip(task.about, task.private === true);
    const said = ctx.ready.length > 0 || Boolean(about);
    const steps = el('ol', 'anomalous-ai-waiting-steps');
    steps.append(step(1, 'write', t('aiWaitingStep1'), t(said ? 'aiWaitingStep1Done' : 'aiWaitingStep1Sub'), said),
        step(2, 'copy', t('aiWaitingStep2'), t('aiWaitingStep2Sub')), step(3, 'paste', t('aiWaitingStep3'), t('aiWaitingStep3Sub')));
    const line = el('div', 'anomalous-ai-waiting-sentence');
    line.append(el('div', 'anomalous-ai-waiting-sentence-label', t('aiWaitingSentenceLabel')),
        el('p', 'anomalous-ai-waiting-sentence-body', sentence));
    view.append(...(ctx.connected ? [] : [connectHint(task.title)]),
        el('div', 'anomalous-ai-waiting-title', t('aiWaitingSay')), steps, copyButton(sentence), line);
    const notify = notifyLine();
    if (notify) view.append(notify);
    const quick = !task.title && !ctx.ready.length && !about ? quickStarterBar(ctx.onPickStarter) : null;
    if (quick) view.append(quick);
    const preparedCount = ctx.ready.length + (about ? 1 : 0);
    if (preparedCount) {
        const done = el('section', 'anomalous-ai-ready-done');
        done.append(el('div', 'anomalous-ai-ready-label', t('aiWaitingReadyDone', { count: preparedCount })),
            ...(about ? [about] : []), ...ctx.ready);
        view.append(done);
    }
    return view;
}

/** The page with no task yet: what it is for; `onNew` starts one, `onPickStarter` opens a template mode. */
export function welcomePage(onNew, onPickStarter = null) {
    const box = el('div', 'anomalous-ai-welcome');
    const picture = el('img', 'anomalous-ai-welcome-art');
    picture.src = new URL('../assets/ai_tasks_empty.webp', import.meta.url).href;
    picture.alt = '';
    const quick = quickStarterBar(onPickStarter);
    box.append(picture, el('h2', 'anomalous-ai-welcome-title', t('aiWelcomeTitle')), el('p', 'anomalous-ai-welcome-body', t('aiWelcomeBody')),
        iconButton('anomalous-ai-new-task', 'plus', t('aiNewTask'), onNew, { title: t('aiNewTaskHint') }),
        ...(quick ? [quick] : []), connectHint());
    return box;
}
