import { t } from './interface_settings.js';
import { anomalousAlert } from './ui_dialog.js';
import { splitSegmentAt, usableEmotions } from './audio_script.js';
import { speakerColor } from './ui_script_cast.js';

/**
 * The Script Director's line cards. A click picks a card (Ctrl / ⌘ adds, Shift a run; the
 * director keeps what is picked), a double-click or ✎ edits its text in place (Enter or a click
 * elsewhere keeps it, Esc puts it back), the name on a card opens a menu of characters to read
 * it (all the picked cards when it is one of them), and its emotion chips are its character's.
 * A line set to read in its own way shows a tag with what it set (ui_script_tune.js).
 * The director owns the lines; a card only calls back (`ctx`, see renderLineCard).
 */

const SPEAKER_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
let openMenu = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const btn = el('button', className, label);
    btn.type = 'button';
    if (title) {
        btn.title = title;
        btn.setAttribute('aria-label', title);
    }
    btn.onclick = onClick;
    return btn;
}

export const emotionLabel = emotion => (emotion === 'main' ? t('scriptDirectorMainEmotion') : emotion);

function closeSpeakerMenu() {
    openMenu?.();
    openMenu = null;
}

/** The characters to read a line, under its name chip; `choose(key)`. */
function openSpeakerMenu(anchor, groups, current, choose) {
    closeSpeakerMenu();
    const menu = el('div', 'anomalous-sd-speaker-menu');
    menu.setAttribute('role', 'menu'); // the browser's Esc leaves an open menu alone
    for (const group of groups) {
        const item = button(`anomalous-sd-speaker-item${group.group === current ? ' is-current' : ''}`, '', () => {
            closeSpeakerMenu();
            choose(group.group);
        });
        item.setAttribute('role', 'menuitem');
        const dot = el('span', 'anomalous-sd-speaker-dot');
        dot.style.background = speakerColor(group.group, groups);
        item.append(dot, el('span', '', group.character));
        menu.append(item);
    }
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.round(rect.left)}px`;
    menu.style.top = `${Math.round(rect.bottom + 4)}px`;
    document.body.append(menu);
    const away = (e) => { if (!menu.contains(e.target) && e.target !== anchor) closeSpeakerMenu(); };
    const escape = (e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        closeSpeakerMenu();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', escape, true);
    openMenu = () => {
        menu.remove();
        window.removeEventListener('pointerdown', away, true);
        window.removeEventListener('keydown', escape, true);
    };
}

/** The text in place: a box to type in while editing, plain text otherwise. */
function lineText(line, index, ctx) {
    if (ctx.editing !== index) {
        const shown = el('div', `anomalous-sd-line-words${line.text.trim() ? '' : ' is-empty'}`, line.text.trim() || t('scriptDirectorEmptyLine'));
        shown.title = t('scriptDirectorEditHint');
        shown.addEventListener('dblclick', () => ctx.onEdit(index));
        return { node: shown };
    }
    const box = el('textarea', 'anomalous-sd-line-text');
    box.rows = 1;
    box.value = line.text;
    const before = line.text;
    box.oninput = () => ctx.onText(index, box.value);
    box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            box.blur();
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            ctx.onText(index, before);
            box.value = before;
            box.blur();
        }
    });
    requestAnimationFrame(() => {
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
    });
    return { node: box, box };
}

/**
 * One card. `ctx`: `groups`, `speakerOf(line)`, `picked` (Set), `listenIndex`, `editing` (index
 * or null), `showSpeakers`, `showChips`, `count`, `canListen`, `canRetake`, `tuneText(line)`, and the calls back:
 * `onPick(index, event)`, `onEdit(index | null)`, `onText(index, text)`, `onSplit(index, a, b)`,
 * `onMerge(index)`, `onDelete(index)`, `onSpeaker(index, key)`, `onEmotion()`, `onListen(index)`,
 * `onRetake(index)`, `onPreview(line, slices, button)`, `isPreviewing(button)`.
 */
export function renderLineCard(line, index, ctx) {
    const speaker = ctx.speakerOf(line);
    const emotions = usableEmotions(speaker);
    const slices = new Map((speaker?.slices || []).map(slice => [slice.emotion, slice]));
    const classes = ['anomalous-sd-line-card'];
    if (index === ctx.listenIndex) classes.push('is-listen');
    if (ctx.picked.has(index)) classes.push('is-picked');
    if (ctx.editing === index) classes.push('is-editing');
    const card = el('div', classes.join(' '));
    card.addEventListener('click', (e) => {
        if (!e.target.closest('button, textarea')) ctx.onPick(index, e);
    });
    if (ctx.showSpeakers) {
        card.classList.add('has-speaker');
        card.style.setProperty('--speaker', speakerColor(speaker?.group, ctx.groups));
    }

    const { node: text, box } = lineText(line, index, ctx);
    const head = el('div', 'anomalous-sd-line-head');
    head.append(el('span', 'anomalous-sd-line-no', `#${index + 1}`));
    if (ctx.showSpeakers) {
        const chip = button('anomalous-sd-speaker', `${speaker?.character || '?'} ▾`, () => {
            openSpeakerMenu(chip, ctx.groups, speaker?.group, key => ctx.onSpeaker(index, key));
        }, t('scriptDirectorSpeakerMenu'));
        chip.style.setProperty('--speaker', speakerColor(speaker?.group, ctx.groups));
        head.append(chip);
    }
    const tune = ctx.tuneText?.(line);
    if (tune) {
        const tag = el('span', 'anomalous-sd-line-tune', tune);
        tag.title = t('scriptCardTuneHint');
        head.append(tag);
    }
    if (box) {
        // Done editing: this card goes back to plain text in place, so a click on another card still lands.
        box.addEventListener('blur', () => {
            if (ctx.editing !== index) return;
            ctx.onEdit(null, true);
            card.replaceWith(renderLineCard(line, index, { ...ctx, editing: null }));
        });
        // Split at the caret: the button keeps the box's focus and caret.
        const split = button('anomalous-sd-icon-btn', '✂', async () => {
            const parts = splitSegmentAt(box.value, box.selectionStart);
            if (!parts) {
                await anomalousAlert(t('scriptDirectorSplitHint'));
                box.focus();
                return;
            }
            ctx.onSplit(index, parts[0], parts[1]);
        }, t('scriptDirectorSplitAtCaret'));
        split.addEventListener('mousedown', e => e.preventDefault());
        head.append(split);
    } else {
        head.append(button('anomalous-sd-icon-btn is-edit', '✎', () => ctx.onEdit(index), t('scriptDirectorEditLine')));
    }
    if (index < ctx.count - 1) {
        // Merge keeps this card's emotion and character: one card = one segment spoken with one voice.
        head.append(button('anomalous-sd-icon-btn is-edit', '↧', () => ctx.onMerge(index), t('scriptDirectorMergeNext')));
    }
    if (ctx.canListen) {
        head.append(button('anomalous-sd-icon-btn anomalous-sd-line-play', '▶', () => ctx.onListen(index), t('scriptDirectorListenLine')));
    }
    if (ctx.canRetake) {
        const retake = button('anomalous-sd-icon-btn', '↻', () => ctx.onRetake(index), t('scriptRunRetakeLine'));
        if (line.take > 1) retake.append(el('span', 'anomalous-sd-take-no', String(line.take)));
        head.append(retake);
    }
    head.append(button('anomalous-sd-icon-btn is-edit is-danger', '×', () => ctx.onDelete(index), t('scriptDirectorDeleteLine')));

    if (!ctx.showChips) {
        card.append(head, text);
        return card;
    }
    const chips = el('div', 'anomalous-sd-emotion-row');
    // The reference clip of the chosen emotion: how this voice sounds, not this line's result.
    const reference = button('anomalous-sd-ref-btn', '', () => ctx.onPreview(line, slices, reference),
        t('scriptDirectorPreviewEmotion', { emotion: emotionLabel(line.emotion) }));
    reference.innerHTML = SPEAKER_ICON;
    // A choice this character cannot voice stays visible (and blocks the bundle) instead of being silently reset.
    const choices = emotions.includes(line.emotion) ? emotions : [...emotions, line.emotion];
    for (const emotion of choices) {
        const chip = button('anomalous-sd-emotion-chip', emotionLabel(emotion), () => {
            line.emotion = emotion;
            chips.querySelectorAll('.anomalous-sd-emotion-chip').forEach(item => item.classList.toggle('active', item === chip));
            reference.title = t('scriptDirectorPreviewEmotion', { emotion: emotionLabel(emotion) });
            reference.setAttribute('aria-label', reference.title);
            reference.disabled = !slices.get(emotion)?.audio_url;
            ctx.onEmotion(reference);
        });
        chip.classList.toggle('active', line.emotion === emotion);
        chip.classList.toggle('is-main', emotion === 'main');
        if (!emotions.includes(emotion)) {
            chip.classList.add('is-missing');
            chip.title = t('scriptDirectorEmotionMissing');
        }
        const sample = slices.get(emotion);
        if (sample?.text) chip.title = sample.text;
        chips.appendChild(chip);
    }
    reference.disabled = !slices.get(line.emotion)?.audio_url;
    chips.appendChild(reference);

    card.append(head, text, chips);
    return card;
}
