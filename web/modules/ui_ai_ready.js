/**
 * A task the user started, waiting for an AI (ui_ai_workbench.js), on one page: the sentence that
 * has the AI take it leads, with its Copy button, and stays in view at the top while the page
 * scrolls, so it is at hand after picking things. Under it what may be put ready first, all of it
 * optional and folded until opened: what to do (a line that names the task, which the sentence then
 * carries) and pictures from the gallery for the message box at the foot of the column (to mark
 * up, write about and send there); what is ready so far (the user's own steps, drawn by the
 * workbench) shows when there is some; the card for an AI not connected yet comes last. The AI
 * gets what is ready when it takes the task. Which folds are open is kept per task while the page
 * is open.
 */

import { translate as t } from './locales.js';
import { art, connectHint, copyLine } from './ui_ai_connect.js';
import { pictureGrid } from './ui_ai_gallery_pick.js';
import { icon } from './ui_ai_icons.js';

const opened = new Map(); // task id -> the names of its open folds

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

/** A fold: a row to press (icon, words, what it holds so far) that opens `body()` under it, made at the first open. */
function fold(taskId, name, iconName, label, body) {
    const open = opened.get(taskId) || new Set();
    opened.set(taskId, open);
    const part = el('section', 'anomalous-ai-ready-fold');
    const head = el('button', 'anomalous-ai-ready-fold-head');
    head.type = 'button';
    const status = el('span', 'anomalous-ai-ready-fold-status');
    head.append(icon(iconName, 16), el('span', 'anomalous-ai-ready-fold-label', label), status,
        icon('chevronDown', 15, 'anomalous-ai-ready-fold-arrow'));
    let inner = null;
    const draw = () => {
        const shown = open.has(name);
        part.classList.toggle('is-open', shown);
        head.setAttribute('aria-expanded', String(shown));
        if (shown && !inner) part.append(inner = body());
        if (inner) inner.hidden = !shown;
    };
    head.onclick = () => {
        if (!open.delete(name)) open.add(name);
        draw();
        if (open.has(name)) inner.querySelector('input')?.focus();
    };
    part.append(head);
    part.status = (text) => { status.textContent = text; };
    draw();
    return part;
}

/** What to do, in a line that names the task (`rename(title)`); Enter or leaving the line keeps it. */
function wishLine(task, rename) {
    const box = el('div', 'anomalous-ai-ready-fold-body');
    const field = el('label', 'anomalous-ai-waiting-field');
    const wish = el('input', 'anomalous-ai-waiting-wish');
    wish.placeholder = t('aiWaitingWish');
    wish.value = task.title || '';
    wish.setAttribute('aria-label', t('aiWaitingWish'));
    wish.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter' && !event.isComposing) wish.blur();
    });
    wish.addEventListener('blur', () => {
        if (wish.value.trim() !== (task.title || '')) void rename(wish.value.trim());
    });
    field.append(icon('pencil', 16), wish);
    box.append(field, el('p', 'anomalous-ai-ready-note', t('aiWaitingWishNote')));
    return box;
}

/** The gallery as a big grid whose pictures go onto the message box `box` (and come off it again). */
function pictureFold(box) {
    const body = el('div', 'anomalous-ai-ready-fold-body');
    const pictures = pictureGrid({
        picked: id => Boolean(box.refs?.has(id)),
        pick: (item) => {
            if (box.refs.has(item.id)) box.refs.remove(item.id);
            else if (box.refs.room() > 0) box.refs.add(item);
        },
    });
    body.append(el('p', 'anomalous-ai-ready-note', t('aiReadyPictures')), pictures.search, pictures.grid);
    body.mark = pictures.mark;
    body.stop = pictures.stop;
    return body;
}

/**
 * The waiting task's page. `ctx`: {rename(title), message (the task's message box), materials
 * (how many are picked), ready (the user's steps so far, drawn)}.
 */
export function waitingView(task, ctx) {
    const view = el('div', 'anomalous-ai-waiting');
    const hero = el('div', 'anomalous-ai-waiting-hero');
    const words = el('div', 'anomalous-ai-waiting-words');
    words.append(el('div', 'anomalous-ai-waiting-title', t('aiWaitingTitle')), el('p', 'anomalous-ai-waiting-body', t('aiWaitingBody')));
    hero.append(art('waiting', 'anomalous-ai-waiting-art'), words);

    const say = el('div', 'anomalous-ai-waiting-say');
    const sentence = task.title ? t('aiHandSentence', { task: task.title }) : t('aiWaitingSentence');
    say.append(el('div', 'anomalous-ai-waiting-say-label', t('aiWaitingSay')),
        copyLine(sentence, { code: false, label: t('aiConnectCopySentence') }));

    const box = ctx.message;
    let grid = null;
    const wish = fold(task.id, 'wish', 'pencil', t('aiWaitingStepWish'), () => wishLine(task, ctx.rename));
    wish.status(task.title || t('aiReadyOptional'));
    const pictures = fold(task.id, 'pictures', 'image', t('aiReadyPicturesTitle'), () => {
        grid = pictureFold(box);
        grid.mark();
        return grid;
    });
    const count = () => {
        const picked = box.refs?.pictures?.() || 0;
        pictures.status(picked ? t('aiReadyPicked', { count: picked }) : t('aiReadyOptional'));
    };
    // The box outlives this page (it moves back under the timeline): the fold follows its pictures while shown.
    const follow = () => {
        if (!view.isConnected) {
            box.removeEventListener('anomalous-refs', follow);
            grid?.stop();
            return;
        }
        count();
        grid?.mark();
    };
    box.addEventListener('anomalous-refs', follow);
    count();

    const optional = el('div', 'anomalous-ai-ready-parts');
    optional.append(el('div', 'anomalous-ai-ready-label', t('aiReadyFirst')), wish, pictures);
    if (ctx.materials) optional.append(el('div', 'anomalous-ai-ready-note', t('aiWaitingMaterialsCount', { count: ctx.materials })));
    if (ctx.ready.length) {
        const done = el('section', 'anomalous-ai-ready-done');
        done.append(el('div', 'anomalous-ai-ready-label', t('aiWaitingReadyDone', { count: ctx.ready.length })), ...ctx.ready);
        optional.append(done);
    }
    view.append(hero, say, optional, connectHint(task.title));
    return view;
}
