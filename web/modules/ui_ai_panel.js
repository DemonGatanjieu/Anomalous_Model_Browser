/**
 * A panel the AI drew in its task (api/ai_panels.py), drawn here from its blocks: headings,
 * text, pictures (a row, a grid or side by side to compare, with marks), the slider, picks and
 * the diagram (ui_ai_stage.js), the user's models as cards with their covers, tables, lists,
 * settings, a progress bar, and questions: buttons (one pick or several), picks and a line of
 * text, whose answers (or a skip) go back to the server for the AI to read, each with a pill
 * saying whether the AI has it yet (ui_ai_delivery.js). Only
 * text is ever written into the page (textContent); the blocks were checked by the server and
 * are checked again by their shape here. Also the toast when the AI shows a panel while the
 * user is elsewhere.
 */

import { translate as t } from './locales.js';
import { timeLabel } from './activity_log.js';
import { outputUrl, isVideo } from './ai_task_view.js';
import { addMarks, diagram, picks, slider } from './ui_ai_stage.js';
import { runMapBox } from './ui_ai_run_map.js';
import { decoratePicture, gonePicture } from './ui_ai_images.js';
import { deliveryState } from './ui_ai_delivery.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, onClick, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

const list = value => (Array.isArray(value) ? value : []);

/** An answer to one of a panel's questions ({step, block, choice | text | skip}), as the AI will read it. */
export async function sendAnswer(taskId, body) {
    const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(taskId)}/answer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
}

/** What became of an answer: skipped (said so), and whether the AI has it yet. */
function answerNote(answer) {
    const box = el('div', 'anomalous-ai-panel-answer');
    if (answer.skipped) box.append(el('div', 'anomalous-ai-panel-typed is-skipped', t('aiPanelSkipped')));
    box.append(deliveryState(answer, 'aiPanelSeen'));
    return box;
}

/** Leaves a question unanswered on purpose; the AI hears that it was skipped. */
function skipButton(ctx, block, note) {
    const node = button('anomalous-ai-panel-skip', t('aiPanelSkip'), async () => {
        node.disabled = true;
        try {
            await sendAnswer(ctx.taskId, { step: ctx.stepId, block: block.id, skip: true });
            ctx.changed();
        } catch (error) {
            note.textContent = error.message;
            node.disabled = false;
        }
    });
    return node;
}

function picture(item, ctx, className) {
    const box = el('figure', className);
    if (item.gone) {
        box.append(gonePicture(item));
        if (item.caption) box.append(el('figcaption', '', item.caption));
        return box;
    }
    const open = button('anomalous-ai-panel-picture', '', () => ctx.openPicture(outputUrl(item), isVideo(item)), t('aiOpenPicture'));
    const media = el(isVideo(item) ? 'video' : 'img');
    media.src = outputUrl(item);
    if (media.tagName === 'IMG') {
        media.loading = 'lazy';
        media.alt = item.caption || item.filename;
    } else {
        media.muted = true;
        media.preload = 'metadata';
    }
    open.append(media);
    const frame = el('div', 'anomalous-ai-panel-frame');
    frame.append(open);
    box.append(decoratePicture(frame, item, ctx.owner));
    if (item.caption) box.append(el('figcaption', '', item.caption));
    if (Array.isArray(item.marks) && item.marks.length) {
        box.classList.add('has-marks');
        addMarks(open, media, item.marks, box);
    }
    return box;
}

function images(block, ctx) {
    const layout = ['row', 'grid', 'compare'].includes(block.layout) ? block.layout : 'row';
    const box = el('div', `anomalous-ai-panel-images is-${layout}`);
    box.append(...list(block.items).map(item => picture(item, ctx, 'anomalous-ai-panel-figure')));
    return box;
}

function models(block, ctx) {
    const box = el('div', 'anomalous-ai-panel-models');
    for (const item of list(block.items)) {
        const card = button('anomalous-ai-panel-model', '', () => ctx.openModel(item), t('aiOpenModel'));
        const cover = el('span', 'anomalous-ai-panel-model-cover');
        if (item.cover) {
            const image = el('img');
            image.loading = 'lazy';
            image.src = `${item.cover}${item.cover.includes('?') ? '&' : '?'}variant=card`;
            image.alt = '';
            cover.append(image);
        }
        const text = el('span', 'anomalous-ai-panel-model-text');
        text.append(el('span', 'anomalous-ai-panel-model-name', String(item.name || '').replace(/\.[^.]+$/, '')));
        if (item.note) text.append(el('span', 'anomalous-ai-panel-model-note', item.note));
        card.append(cover, text);
        box.append(card);
    }
    return box;
}

function table(block) {
    const wrap = el('div', 'anomalous-ai-panel-table-wrap');
    const node = el('table', 'anomalous-ai-panel-table');
    if (list(block.columns).length) {
        const thead = el('thead');
        const head = el('tr');
        head.append(...block.columns.map(column => el('th', '', column)));
        thead.append(head);
        node.append(thead);
    }
    const body = el('tbody');
    for (const row of list(block.rows)) {
        const line = el('tr');
        line.append(...list(row).map(cell => el('td', '', cell)));
        body.append(line);
    }
    node.append(body);
    wrap.append(node);
    return wrap;
}

function params(block) {
    const box = el('dl', 'anomalous-ai-panel-params');
    for (const item of list(block.items)) box.append(el('dt', '', item.label), el('dd', '', item.value));
    return box;
}

/** A bar of the AI's numbers; grey, with when it wrote them, once the task went past them (`ctx.passed`). */
function progress(block, ctx) {
    const box = el('div', `anomalous-ai-panel-progress${ctx.passed ? ' is-passed' : ''}`);
    const top = Number(block.max) > 0 ? Number(block.max) : 100;
    const value = Math.max(0, Math.min(Number(block.value) || 0, top));
    const head = el('div', 'anomalous-ai-panel-progress-head');
    head.append(el('span', '', block.label || ''), el('span', '', `${Math.round((value / top) * 100)}%`));
    const bar = el('div', 'anomalous-ai-panel-progress-bar');
    const fill = el('span');
    fill.style.width = `${(value / top) * 100}%`;
    bar.append(fill);
    box.append(head, bar);
    if (ctx.passed) box.append(el('div', 'anomalous-ai-panel-progress-note', t('aiPanelProgressOld', { time: timeLabel(ctx.passed) })));
    return box;
}

/** An answer none of the options is: a line under them. */
function otherLine(ctx, block, options) {
    const line = el('div', 'anomalous-ai-panel-input is-other');
    const field = el('input');
    field.type = 'text';
    field.maxLength = 2000;
    field.placeholder = t('aiPanelOther');
    const go = button('anomalous-ai-panel-send', t('aiPanelSend'), async () => {
        if (!field.value.trim()) return;
        go.disabled = true;
        options.querySelectorAll('button').forEach(node => { node.disabled = true; });
        try {
            await sendAnswer(ctx.taskId, { step: ctx.stepId, block: block.id, text: field.value });
            ctx.changed();
        } catch (error) {
            go.disabled = false;
            options.querySelectorAll('button').forEach(node => { node.disabled = false; });
            field.setCustomValidity(error.message);
            field.reportValidity();
        }
    });
    field.addEventListener('keydown', (event) => {
        event.stopPropagation(); // typing here is not the browser's shortcuts
        if (event.key === 'Enter' && !event.isComposing) go.click();
    });
    field.addEventListener('input', () => field.setCustomValidity(''));
    line.append(field, go);
    return line;
}

function choices(block, ctx) {
    const box = el('div', 'anomalous-ai-panel-ask');
    if (block.question) box.append(el('div', 'anomalous-ai-panel-question', block.question));
    const answer = ctx.answers[block.id];
    const options = el('div', 'anomalous-ai-panel-options');
    const note = el('div', 'anomalous-ai-panel-error');
    const picked = new Set(answer?.choice || []);
    const submit = async (ids) => {
        options.querySelectorAll('button').forEach(node => { node.disabled = true; });
        try {
            await sendAnswer(ctx.taskId, { step: ctx.stepId, block: block.id, choice: ids });
        } catch (error) {
            note.textContent = error.message;
            options.querySelectorAll('button').forEach(node => { node.disabled = false; });
            return;
        }
        ctx.changed();
    };
    for (const option of list(block.options)) {
        const node = button(`anomalous-ai-panel-option${picked.has(option.id) ? ' is-picked' : ''}`, '', () => {
            if (!block.multiple) return void submit([option.id]);
            node.classList.toggle('is-picked');
            confirm.disabled = !options.querySelector('.anomalous-ai-panel-option.is-picked');
        });
        node.dataset.id = option.id;
        if (option.recommended) {
            node.classList.add('is-recommended');
            node.append(el('span', 'anomalous-ai-panel-option-badge', t('aiPanelRecommended')));
        }
        node.append(el('span', 'anomalous-ai-panel-option-label', option.label));
        if (option.detail) node.append(el('span', 'anomalous-ai-panel-option-detail', option.detail));
        node.disabled = Boolean(answer) || ctx.closed;
        options.append(node);
    }
    box.append(options);
    const confirm = button('anomalous-ai-panel-send', t('aiPanelSend'), () => {
        submit([...options.querySelectorAll('.anomalous-ai-panel-option.is-picked')].map(node => node.dataset.id));
    });
    confirm.disabled = true;
    if (block.multiple && !answer && !ctx.closed) box.append(confirm);
    if (answer?.text) box.append(el('div', 'anomalous-ai-panel-typed', answer.text));
    else if (block.other && !answer && !ctx.closed) box.append(otherLine(ctx, block, options));
    if (!answer && !ctx.closed) box.append(skipButton(ctx, block, note));
    box.append(note);
    if (answer) box.append(answerNote(answer));
    return box;
}

function input(block, ctx) {
    const box = el('div', 'anomalous-ai-panel-ask');
    box.append(el('div', 'anomalous-ai-panel-question', block.question));
    const answer = ctx.answers[block.id];
    if (answer) {
        if (!answer.skipped) box.append(el('div', 'anomalous-ai-panel-typed', answer.text));
        box.append(answerNote(answer));
        return box;
    }
    const line = el('div', 'anomalous-ai-panel-input');
    const field = el('input');
    field.type = 'text';
    field.maxLength = 2000;
    field.placeholder = block.placeholder || t('aiPanelTypeHere');
    field.disabled = ctx.closed;
    const note = el('div', 'anomalous-ai-panel-error');
    const go = button('anomalous-ai-panel-send', t('aiPanelSend'), async () => {
        if (!field.value.trim()) return;
        go.disabled = true;
        try {
            await sendAnswer(ctx.taskId, { step: ctx.stepId, block: block.id, text: field.value });
            ctx.changed();
        } catch (error) {
            note.textContent = error.message;
            go.disabled = false;
        }
    });
    go.disabled = ctx.closed;
    field.addEventListener('keydown', (event) => {
        event.stopPropagation(); // typing here is not the browser's shortcuts
        if (event.key === 'Enter') go.click();
    });
    line.append(field, go);
    box.append(line);
    if (!ctx.closed) box.append(skipButton(ctx, block, note));
    box.append(note);
    return box;
}

const DRAW = {
    heading: block => el('h3', 'anomalous-ai-panel-heading', block.text),
    text: block => el('p', `anomalous-ai-panel-text is-${['muted', 'tip', 'warning'].includes(block.tone) ? block.tone : 'normal'}`, block.text),
    images,
    models,
    table,
    list: (block) => {
        const node = el(block.ordered ? 'ol' : 'ul', 'anomalous-ai-panel-list');
        node.append(...list(block.items).map(item => el('li', '', item)));
        return node;
    },
    params,
    choices,
    input,
    progress,
    divider: () => el('hr', 'anomalous-ai-panel-divider'),
    slider,
    diagram,
    run_map: (block, ctx) => runMapBox(ctx.stepOf?.(block.step), ctx, true) || el('p', 'anomalous-ai-panel-text', t('aiMapGone')),
    picks: (block, ctx) => picks(block, {
        ...ctx,
        send: async (ids, note) => {
            try {
                await sendAnswer(ctx.taskId, { step: ctx.stepId, block: block.id, choice: ids });
                ctx.changed();
            } catch (error) {
                note.textContent = error.message;
            }
        },
    }),
};

/**
 * The panel of a panel step. `ctx`: `{ taskId, owner, openPicture(url, video), openModel(item),
 * locateNode(id), stepOf(id), changed(), passed }` (changed: an answer went in, draw the task again;
 * stepOf: the task's step of that id, for a run_map block; passed: when the AI wrote its progress
 * bars if the task went past them since, else 0).
 */
export function renderPanel(step, ctx) {
    const panel = step.panel || {};
    const card = el('div', `anomalous-ai-panel${panel.closed ? ' is-closed' : ''}`);
    card.append(el('div', 'anomalous-ai-panel-title', panel.title || ''));
    const blockCtx = { ...ctx, stepId: step.id, answers: step.answers || {}, closed: Boolean(panel.closed) };
    for (const block of list(panel.blocks)) {
        const draw = DRAW[block?.type];
        if (draw) card.append(draw(block, blockCtx));
    }
    const asks = list(panel.blocks).some(block => ['choices', 'input', 'picks'].includes(block?.type));
    if (asks) card.append(el('div', 'anomalous-ai-panel-foot', t(panel.closed ? 'aiPanelClosed' : 'aiPanelHow')));
    return card;
}

let toast = null;

/** Takes the toast away (the user opened the workbench). */
export function hidePanelToast() {
    toast?.remove();
    toast = null;
}

/** A small card while the browser is elsewhere: the AI shows a panel (and maybe asks). */
export function panelToast(owner, title, asks) {
    toast?.remove();
    toast = el('div', 'anomalous-ai-toast');
    toast.setAttribute('role', 'status');
    const text = el('div', 'anomalous-ai-toast-text');
    text.append(el('span', 'anomalous-ai-toast-lead', t(asks ? 'aiToastAsks' : 'aiToastShows')), el('span', 'anomalous-ai-toast-title', title));
    const open = button('anomalous-ai-toast-open', t('aiToastOpen'), () => {
        toast?.remove();
        toast = null;
        owner.show?.();
        owner.goTo?.('ai');
    });
    const close = button('anomalous-ai-toast-close', '×', () => { toast?.remove(); toast = null; }, t('close'));
    toast.append(text, open, close);
    document.body.append(toast);
    if (!asks) setTimeout(() => { if (toast?.isConnected) toast.remove(); }, 12000);
}
