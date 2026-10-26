/**
 * A panel the AI drew in its task (api/ai_panels.py), drawn here from its blocks: headings,
 * text, pictures (a row, a grid or side by side to compare, with marks), the slider, picks and
 * the diagram (ui_ai_stage.js), the user's models as cards with their covers, tables, lists,
 * settings, a progress bar, and questions: buttons (one pick or several), picks and a line of
 * text, whose answers (or "let the AI decide") go back to the server for the AI to read, each
 * with a pill saying whether the AI has it yet (ui_ai_delivery.js). A question says that one
 * press sends; a line of one's own beside the options stays folded until asked for. Only
 * text is ever written into the page (textContent); the blocks were checked by the server and
 * are checked again by their shape here. Also the toast when the AI shows a panel while the
 * user is elsewhere.
 */

import { translate as t } from './locales.js';
import { timeLabel } from './activity_log.js';
import { outputUrl, isVideo } from './ai_task_view.js';
import { addMarks, diagram, picks, slider } from './ui_ai_stage.js';
import { runMapBox } from './ui_ai_run_map.js';
import { decoratePicture, gonePicture, showPicture } from './ui_ai_images.js';
import { deliveryState } from './ui_ai_delivery.js';
import { icon } from './ui_ai_icons.js';

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

/** An answer to one of a panel's questions ({step, block, choice | text | skip}), as the AI will read it; what was half typed there goes. */
export async function sendAnswer(taskId, body) {
    const response = await fetch(`/anomalous/ai_tasks/${encodeURIComponent(taskId)}/answer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    drafts.delete(draftKey(taskId, body.step, body.block));
    return data;
}

const drafts = new Map(); // question -> what the user half typed in its line, while this page is open
const draftKey = (taskId, stepId, blockId) => JSON.stringify([taskId, stepId, blockId]);

/** Whether the user half typed an answer to question `blockId` of step `stepId`. */
export function hasDraft(taskId, stepId, blockId) {
    return drafts.has(draftKey(taskId, stepId, blockId));
}

/**
 * `field` as the answer line to question `blockId` of step `stepId`: drawn again (an answer or a
 * new question came, the AI read one), it keeps what the user half typed there, and the focus
 * when it had it; each key tells the server they are typing.
 */
export function draftField(field, taskId, stepId, blockId, surface = 'stage') {
    const key = draftKey(taskId, stepId, blockId);
    field.dataset.draft = key;
    field.dataset.draftSurface = surface;
    field.value = drafts.get(key) || '';
    const previous = document.activeElement;
    if (previous?.dataset?.draft === key && previous.dataset.draftSurface === surface) {
        const { selectionStart, selectionEnd, selectionDirection } = previous;
        requestAnimationFrame(() => {
            if (!field.isConnected || previous.isConnected || (document.activeElement && document.activeElement !== document.body)) return;
            field.focus();
            field.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
        });
    }
    field.addEventListener('input', () => {
        if (field.value) drafts.set(key, field.value);
        else drafts.delete(key);
        // Both the stage and the bottom strip can show this question at once.
        document.querySelectorAll('input[data-draft], textarea[data-draft]').forEach((peer) => {
            if (peer !== field && peer.dataset.draft === key) peer.value = field.value;
        });
        noteTyping(taskId);
    });
}

const TYPING_EVERY_MS = 5000;
let typed = { taskId: '', at: 0 };

/** The user is typing an answer or a message on task `taskId`: the AI waits on for it (api/ai_answer_wait.py); told at most every few seconds. */
export function noteTyping(taskId) {
    const now = Date.now();
    if (!taskId || (typed.taskId === taskId && now - typed.at < TYPING_EVERY_MS)) return;
    typed = { taskId, at: now };
    fetch(`/anomalous/ai_tasks/${encodeURIComponent(taskId)}/typing`, { method: 'POST' }).catch(() => {});
}

/** What became of an answer: skipped (said so), and whether the AI has it yet. */
function answerNote(answer) {
    const box = el('div', 'anomalous-ai-panel-answer');
    if (answer.skipped) box.append(el('div', 'anomalous-ai-panel-typed is-skipped', t('aiPanelSkipped')));
    if (answer.recommended_on_timeout) box.append(el('div', 'anomalous-ai-panel-typed is-skipped', t('aiPanelTimedOut')));
    box.append(deliveryState(answer, 'aiPanelSeen'));
    return box;
}

/** Leaves the question to the AI: it hears the user left it to its own judgement. */
function skipButton(ctx, block, note) {
    const node = button('anomalous-ai-panel-skip', '', async () => {
        node.disabled = true;
        try {
            await sendAnswer(ctx.taskId, { step: ctx.stepId, block: block.id, skip: true });
            ctx.changed();
        } catch (error) {
            note.textContent = error.message;
            node.disabled = false;
        }
    });
    node.append(icon('sparkle', 13), el('span', '', t('aiPanelSkip')));
    return node;
}

/**
 * A question's head: the question, and on the right "let the AI decide" while it is open. A
 * question without words of its own is the panel's title (ask_user's): the button goes up there.
 */
function askHead(question, skip, ctx) {
    if (!question && skip && ctx.titleRow && !ctx.titleRow.querySelector('.anomalous-ai-panel-skip')) {
        ctx.titleRow.append(skip);
        return document.createDocumentFragment();
    }
    const head = el('div', 'anomalous-ai-panel-ask-head');
    head.append(el('div', 'anomalous-ai-panel-question', question || ''));
    if (skip) head.append(skip);
    return head;
}

/** A line of one's own, folded: "None of these, I'll say it" opens `open()` (the line) in its place, its field focused; `unfolded` (something half typed in it): the line at once. */
export function ownWords(className, open, unfolded = false) {
    if (unfolded) return open();
    const node = button(className, '', () => {
        const line = open();
        node.replaceWith(line);
        line.querySelector('input')?.focus();
    });
    node.append(icon('pencil', 13), el('span', '', t('aiPanelOwnWords')));
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
    if (media.tagName === 'IMG') {
        media.loading = 'lazy';
        media.alt = item.caption || item.filename;
        showPicture(media, item);
    } else {
        media.src = outputUrl(item);
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

/** The user's repaint area beside the one the AI proposes (api/ai_repaint.py): pictures Anomalous drew in the task's marks folder. */
function area(block, ctx) {
    const box = el('div', 'anomalous-ai-panel-images is-compare');
    for (const [side, words] of [['yours', 'aiRepaintYours'], ['ai', 'aiRepaintAi']]) {
        const url = `/anomalous/ai_tasks/${encodeURIComponent(ctx.taskId)}/marks/${encodeURIComponent(block[side])}`;
        const figure = el('figure', 'anomalous-ai-panel-figure');
        const open = button('anomalous-ai-panel-picture', '', () => ctx.openPicture(url, false), t('aiOpenPicture'));
        const image = el('img');
        image.loading = 'lazy';
        image.alt = t(words);
        image.src = url;
        open.append(image);
        const edge = side === 'ai' && (block.grow || block.feather) ? ` · ${t('aiRepaintEdge', { grow: block.grow, feather: block.feather })}` : '';
        figure.append(open, el('figcaption', '', t(words) + edge));
        box.append(figure);
    }
    return box;
}

/** An option's words: Anomalous's own options name a word of the page (label_key), the AI's are plain labels. */
export function optionLabel(option) {
    return option.label_key ? t(option.label_key) : option.label;
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
    draftField(field, ctx.taskId, ctx.stepId, block.id);
    line.append(field, go);
    return line;
}

function choices(block, ctx) {
    const box = el('div', 'anomalous-ai-panel-ask');
    const answer = ctx.answers[block.id];
    const open = !answer && !ctx.closed;
    const note = el('div', 'anomalous-ai-panel-error');
    box.append(askHead(block.question, open && skipButton(ctx, block, note), ctx));
    if (open) box.append(el('div', 'anomalous-ai-panel-hint', t(block.multiple ? 'aiPanelHintSome' : 'aiPanelHintOne')));
    const options = el('div', `anomalous-ai-panel-options${block.multiple ? ' is-multiple' : ''}`);
    const picked = new Set(answer?.choice || []);
    const submit = async (ids) => {
        options.querySelectorAll('button').forEach(node => { node.disabled = true; });
        options.classList.add('is-sending');
        try {
            await sendAnswer(ctx.taskId, { step: ctx.stepId, block: block.id, choice: ids });
        } catch (error) {
            note.textContent = error.message;
            options.classList.remove('is-sending');
            options.querySelectorAll('button').forEach((node) => {
                node.disabled = false;
                if (!block.multiple) node.classList.remove('is-picked');
            });
            return;
        }
        ctx.changed();
    };
    for (const option of list(block.options)) {
        const node = button(`anomalous-ai-panel-option${picked.has(option.id) ? ' is-picked' : ''}`, '', () => {
            node.classList.toggle('is-picked', block.multiple ? undefined : true); // which one goes shows at once
            if (!block.multiple) return void submit([option.id]);
            confirm.disabled = !options.querySelector('.anomalous-ai-panel-option.is-picked');
        });
        node.dataset.id = option.id;
        const words = el('span', 'anomalous-ai-panel-option-text');
        if (option.recommended) {
            node.classList.add('is-recommended');
            words.append(el('span', 'anomalous-ai-panel-option-badge', t('aiPanelRecommended')));
        }
        words.append(el('span', 'anomalous-ai-panel-option-label', optionLabel(option)));
        if (option.detail) words.append(el('span', 'anomalous-ai-panel-option-detail', option.detail));
        node.append(words, icon(block.multiple ? 'check' : 'arrowRight', 15, 'anomalous-ai-panel-option-go'));
        node.disabled = !open;
        options.append(node);
    }
    box.append(options);
    const confirm = button('anomalous-ai-panel-send', t('aiPanelSend'), () => {
        submit([...options.querySelectorAll('.anomalous-ai-panel-option.is-picked')].map(node => node.dataset.id));
    });
    confirm.disabled = true;
    if (block.multiple && open) box.append(confirm);
    if (answer?.text) box.append(el('div', 'anomalous-ai-panel-typed', answer.text));
    else if (block.other && open) box.append(ownWords('anomalous-ai-panel-own', () => otherLine(ctx, block, options), hasDraft(ctx.taskId, ctx.stepId, block.id)));
    box.append(note);
    if (answer) box.append(answerNote(answer));
    return box;
}

function input(block, ctx) {
    const box = el('div', 'anomalous-ai-panel-ask');
    const answer = ctx.answers[block.id];
    const note = el('div', 'anomalous-ai-panel-error');
    box.append(askHead(block.question, !answer && !ctx.closed && skipButton(ctx, block, note), ctx));
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
    draftField(field, ctx.taskId, ctx.stepId, block.id);
    field.addEventListener('keydown', (event) => {
        event.stopPropagation(); // typing here is not the browser's shortcuts
        if (event.key === 'Enter' && !event.isComposing) go.click();
    });
    line.append(field, go);
    box.append(line, note);
    return box;
}

const DRAW = {
    heading: block => el('h3', 'anomalous-ai-panel-heading', block.text),
    text: block => el('p', `anomalous-ai-panel-text is-${['muted', 'tip', 'warning'].includes(block.tone) ? block.tone : 'normal'}`, block.text),
    images,
    area,
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
    const titleRow = el('div', 'anomalous-ai-panel-title-row');
    titleRow.append(el('div', 'anomalous-ai-panel-title', panel.title || ''));
    card.append(titleRow);
    const blockCtx = { ...ctx, stepId: step.id, answers: step.answers || {}, closed: Boolean(panel.closed), titleRow };
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
