/**
 * The prompt box (a "prompts" block of the AI's panel, api/ai_panels.py), for a private task: the
 * user writes the prompts here, and a negative one and reference pictures (from the gallery, or
 * dropped in) when the AI asks for them. The texts stay in Anomalous; the AI gets tokens for them
 * (api/ai_sealed.py). Above the fields, what suits the canvas's model (the prompt_pose skill's words,
 * the step's prompt_advice). Answered, it shows what the user wrote beside the token the AI has.
 * ui_ai_panel.js draws it and hands it its helpers (sending, the question's head, the answer's note).
 */

import { resolveLocale, translate as t } from './locales.js';
import { galleryPicker, thumbUrl } from './ui_ai_gallery_pick.js';
import { takePictures } from './ui_ai_drop.js';

const MAX_PROMPTS = 8;
const MAX_PICTURES = 4;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    return node;
}

const words = value => (resolveLocale() === 'zh' ? value?.zh : value?.en) || value?.en || value?.zh || '';

/** A picture by its path in the output folder ("subfolder/name.png"), as a small tile. */
function tile(path, onRemove) {
    const at = path.lastIndexOf('/');
    const image = { filename: path.slice(at + 1), subfolder: at > 0 ? path.slice(0, at) : '' };
    const node = el('span', 'anomalous-ai-prompt-pic');
    const img = el('img');
    img.alt = image.filename;
    img.title = path;
    img.src = thumbUrl(image);
    node.append(img);
    if (onRemove) node.append(button('anomalous-ai-prompt-pic-remove', '×', onRemove));
    return node;
}

/** What the user handed in: each token the AI has, with the text it stands for (the task's `sealed`). */
function handedIn(answer, sealed) {
    const box = el('div', 'anomalous-ai-prompt-given');
    const line = (token, label) => {
        const row = el('div', 'anomalous-ai-prompt-given-row');
        row.append(el('code', 'anomalous-ai-prompt-token', token), el('span', 'anomalous-ai-prompt-label', label),
            el('span', 'anomalous-ai-prompt-text', sealed?.[token] || ''));
        box.append(row);
    };
    (answer.prompts || []).forEach((token, at) => line(token, t('aiPromptBoxPrompt', { n: at + 1 })));
    if (answer.negative) line(answer.negative, t('aiPromptBoxNegative'));
    if (answer.pictures?.length) {
        const row = el('div', 'anomalous-ai-prompt-given-row');
        row.append(el('span', 'anomalous-ai-prompt-label', t('aiPromptBoxPictures')));
        for (const token of answer.pictures) {
            const pic = el('span', 'anomalous-ai-prompt-given-pic');
            pic.append(el('code', 'anomalous-ai-prompt-token', token), ...(sealed?.[token] ? [tile(sealed[token])] : []));
            row.append(pic);
        }
        box.append(row);
    }
    return box;
}

/** The box for `block` of the panel; `ctx` as ui_ai_panel.js gives its blocks, plus `advice` and `sealed`. */
export function promptBox(block, ctx, { sendAnswer, askHead, skipButton, answerNote, draftField }) {
    const box = el('div', 'anomalous-ai-panel-ask anomalous-ai-prompt-box');
    const answer = ctx.answers[block.id];
    const note = el('div', 'anomalous-ai-panel-error');
    box.append(askHead(block.question || t('aiPromptBoxAsk'), !answer && !ctx.closed && skipButton(ctx, block, note), ctx));
    if (ctx.advice) box.append(el('div', 'anomalous-ai-prompt-advice', words(ctx.advice)));
    if (answer) {
        if (!answer.skipped) box.append(handedIn(answer, ctx.sealed), el('div', 'anomalous-ai-prompt-private', t('aiPromptBoxPrivate')));
        box.append(answerNote(answer));
        return box;
    }
    const fields = el('div', 'anomalous-ai-prompt-fields');
    const field = (key, placeholder, rows) => {
        const area = el('textarea', 'anomalous-ai-prompt-field');
        area.rows = rows;
        area.maxLength = 4000;
        area.placeholder = placeholder;
        area.disabled = ctx.closed;
        draftField(area, ctx.taskId, ctx.stepId, `${block.id}#${key}`);
        area.addEventListener('keydown', event => event.stopPropagation()); // typing here is not the browser's shortcuts
        return area;
    };
    const prompts = [];
    const addPrompt = () => {
        const area = field(prompts.length, t('aiPromptBoxPrompt', { n: prompts.length + 1 }), 3);
        prompts.push(area);
        fields.append(area);
        more.hidden = prompts.length >= MAX_PROMPTS;
    };
    const more = button('anomalous-ai-prompt-more', t('aiPromptBoxMore'), () => {
        addPrompt();
        prompts.at(-1).focus();
    });
    for (let at = 0; at < Math.max(1, Math.min(MAX_PROMPTS, block.count || 1)); at++) addPrompt();
    box.append(fields, more);
    const negative = block.negative ? field('negative', t('aiPromptBoxNegative'), 2) : null;
    if (negative) box.append(negative);

    const pictures = new Map(); // path -> {filename, subfolder}
    if (block.pictures) {
        const row = el('div', 'anomalous-ai-prompt-pics');
        const tray = el('div', 'anomalous-ai-prompt-tray');
        const room = () => MAX_PICTURES - pictures.size;
        const add = (item) => {
            const image = item.image || item;
            const path = [image.subfolder, image.filename].filter(Boolean).join('/');
            if (pictures.has(path) || !room()) return;
            pictures.set(path, { filename: image.filename, subfolder: image.subfolder || '' });
            const shown = tile(path, () => { pictures.delete(path); shown.remove(); });
            tray.append(shown);
        };
        const pick = button('anomalous-ai-prompt-pick', t('aiPromptBoxPick'), () => picker.toggle());
        const picker = galleryPicker(box, room, items => items.forEach(add), pick,
            { hint: 'aiPromptBoxPicsHint', full: 'aiPromptBoxPicsFull', add: 'aiPromptBoxPicsAdd' });
        takePictures(box, prompts[0], { add, room, say: (text) => { note.textContent = text; } });
        row.append(el('span', 'anomalous-ai-prompt-label', t('aiPromptBoxPictures')), tray, pick, el('span', 'anomalous-ai-prompt-hint', t('aiPromptBoxDrop')));
        box.append(row);
    }
    const send = button('anomalous-ai-panel-send', t('aiPromptBoxSend'), async () => {
        const texts = prompts.map(area => area.value.trim()).filter(Boolean);
        if (!texts.length) {
            note.textContent = t('aiPromptBoxEmpty');
            return;
        }
        send.disabled = true;
        try {
            await sendAnswer(ctx.taskId, { step: ctx.stepId, block: block.id, prompts: texts, negative: negative?.value.trim() || '', pictures: [...pictures.values()] });
            ctx.changed();
        } catch (error) {
            note.textContent = error.message;
            send.disabled = false;
        }
    });
    send.disabled = ctx.closed;
    box.append(el('div', 'anomalous-ai-prompt-private', t('aiPromptBoxPrivate')), send, note);
    return box;
}
