/**
 * The AI workbench's message box (ui_ai_workbench.js keeps it at the foot of a task's column, in
 * view as the timeline scrolls): where the user writes to the AI on that task. Over the input
 * what the message carries (ui_ai_tray.js: pictures to mark up or leave out, what "@" names);
 * beside it the gallery (ui_ai_gallery_pick.js) and the materials picker, each lit with how many
 * it gave; pictures dropped on it or pasted (ui_ai_drop.js); the input grows with what is typed
 * (Enter sends, Shift+Enter breaks the line), with "@" to point at things and "/" for commands
 * (ui_ai_mention.js). The words and what is attached
 * go to `onSend(text, refs)`, words optional when something is attached; the AI gets them the
 * next time it asks (get_answers), which the hint says, and says to ask in the AI app once the
 * task ended. Made once per task, so half-typed text survives the task's redraws. newStepsPill
 * is the "new steps below" button over it.
 */

import { translate as t } from './locales.js';
import { mentions } from './ui_ai_mention.js';
import { galleryPicker } from './ui_ai_gallery_pick.js';
import { takePictures } from './ui_ai_drop.js';
import { icon, iconButton } from './ui_ai_icons.js';

const MAX_REFS = 12; // api/ai_message_refs.py
const MAX_PICTURES = 8; // a message's pictures, as ai_pictures.py hands them
const MAX_HEIGHT = 168; // the input grows up to about seven lines, then scrolls
const NEAR_BOTTOM = 60;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** A button beside the input, with the number of what it gave on its corner. */
function sideTool(className, name, label, run) {
    const node = iconButton(`anomalous-ai-message-tool ${className}`, name, label, run, { iconOnly: true, size: 17 });
    const count = el('span', 'anomalous-ai-message-tool-count');
    node.append(count);
    node.setCount = (value) => {
        count.textContent = value ? String(value) : '';
        node.classList.toggle('has-items', value > 0);
    };
    return node;
}

/**
 * The box; `source`: {task(), commands(), mark(image, sent), openMaterials()} for "@", "/", the
 * tray's ✎ and the materials button. With them, `box.refs` attaches things from outside (the
 * "Put ready" page's gallery) and `box.setMaterials(count)` shows how many materials are picked.
 */
export function messageBox(onSend, source) {
    const box = el('div', 'anomalous-ai-message');
    const tray = el('div', 'anomalous-ai-tray');
    tray.hidden = true;
    const line = el('div', 'anomalous-ai-message-line');
    const field = el('textarea', 'anomalous-ai-message-input');
    field.rows = 1;
    field.maxLength = 2000;
    field.placeholder = t('aiMessagePlaceholder');
    const note = el('div', 'anomalous-ai-message-hint');
    const send = el('button', 'anomalous-ai-panel-send', t('aiMessageSend'));
    send.type = 'button';
    let at = null; // "@" and "/" (made once the box is in place)
    const fit = () => {
        field.style.height = 'auto';
        field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT)}px`;
    };
    send.onclick = async () => {
        const text = field.value.trim();
        const refs = at?.refs() || [];
        if (!text && !refs.length) return;
        send.disabled = true;
        try {
            await onSend(text, refs);
            field.value = '';
            fit();
            at?.clear();
        } catch (error) {
            note.textContent = error.message;
        } finally {
            send.disabled = false;
        }
    };
    field.addEventListener('keydown', (event) => {
        event.stopPropagation(); // typing here is not the browser's shortcuts
        if (at?.keydown(event)) return;
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            send.click();
        }
    });
    field.addEventListener('input', fit);
    line.append(field, send);
    box.append(tray, line, note);
    if (source) {
        at = mentions(field, box, source, tray);
        const room = () => Math.min(MAX_PICTURES - at.pictures(), MAX_REFS - at.count());
        const pics = sideTool('anomalous-ai-message-pics', 'image', t('aiPicsButton'), () => picker.toggle());
        pics.setAttribute('aria-expanded', 'false');
        const picker = galleryPicker(box, room, (items) => {
            for (const item of items) at.add(item);
            field.focus();
        }, pics);
        const materials = sideTool('anomalous-ai-message-materials', 'sparkle', t('aiMessageMaterials'), () => source.openMaterials());
        const counted = () => pics.setCount(at.pictures());
        box.addEventListener('anomalous-refs', counted);
        field.addEventListener('input', counted);
        line.prepend(pics, materials);
        takePictures(box, field, { add: item => at.add(item), room, say: (text) => { note.textContent = text; } });
        box.refs = { add: item => at.add(item), remove: id => at.remove(id), has: id => at.has(id), room }; // for ui_ai_ready.js's gallery
        box.setMaterials = count => materials.setCount(count);
    }
    box.note = note;
    return box;
}

/** The hint for where the task stands; quieter while the AI is not working on it. While a task
 * waits for an AI (`status` "waiting"), what is sent waits with it. */
export function updateMessageBox(box, ended, status, materials = 0) {
    box.classList.toggle('is-quiet', !['live', 'asks', 'waiting'].includes(status));
    box.note.textContent = t(ended ? 'aiMessageEnded' : status === 'waiting' ? 'aiMessageWaiting' : 'aiMessageHint');
    box.setMaterials?.(materials);
}

/**
 * "New steps below" over the message box, for a timeline in `scroller`: shown by `show()` when
 * steps came in while the user read further up, gone once they are at the bottom; a click takes
 * them there.
 */
export function newStepsPill(scroller) {
    const pill = el('button', 'anomalous-ai-new-steps');
    pill.type = 'button';
    pill.hidden = true;
    pill.append(icon('chevronDown', 14), el('span', '', t('aiNewSteps')));
    pill.onclick = () => scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    const atBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM;
    const seen = () => {
        if (!pill.isConnected) scroller.removeEventListener('scroll', seen); // another task's view by now
        else if (atBottom()) pill.hidden = true;
    };
    scroller.addEventListener('scroll', seen, { passive: true });
    pill.show = () => { if (!atBottom()) pill.hidden = false; };
    return pill;
}
