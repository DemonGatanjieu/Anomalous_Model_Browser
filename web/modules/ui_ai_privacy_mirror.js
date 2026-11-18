/**
 * The Privacy overview's side-by-side view of the hidden prompts (ui_ai_privacy_overview.js): each prompt as
 * the user wrote it (ai_privacy_view.js promptMirror) twice, slot for slot in the same order and the same
 * width: on the left what stays here (a word let through is a dashed gap), on the right what the AI reads
 * (a hidden word is a locked gap). Pressing a slot on either side picks it on both. "Let the AI read them"
 * splits the picked hidden words out of their tokens (partsShowingTags, POST privacy_rules split_prompt);
 * "Hide them again" seals picked words that went through (seal_message_phrase: the AI has read them, it
 * gets a token from now on). Words never move: a prompt keeps its order whichever side a word is on.
 * "Show meanings" (prompt_gloss.js, as in one column) writes each word's meaning under it on both sides, so
 * the slots stay as wide as each other; on the AI's side a hidden word's meaning is masked like the word.
 */

import { translate as t } from './locales.js';
import { partsShowingTags, promptMirror } from './ai_privacy_view.js';
import { fetchGlosses, glossOf, pageGlossLang } from './prompt_gloss.js';
import { icon } from './ui_ai_icons.js';
import { postPrivacyRule } from './ui_ai_privacy_adjust.js';
import { eyeBadge, lockBadge, trow } from './ui_ai_privacy_rows.js';
import { anomalousAlert } from './ui_dialog.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function slotButton(slot, side) {
    const node = el('button', `anomalous-ai-priv-slot is-${slot.shown ? 'shown' : 'hidden'}`);
    node.type = 'button';
    const masked = side === 'right' && !slot.shown; // the AI's side: a locked gap as wide as the word
    node.title = t(slot.shown ? (side === 'left' ? 'aiPrivacySlotLetHint' : 'aiPrivacySlotShownHint') : (side === 'left' ? 'aiPrivacySlotHiddenHint' : 'aiPrivacySlotMaskedHint'), { token: slot.token || '' });
    const main = el('span', 'anomalous-ai-priv-slot-main');
    main.append(icon(slot.shown ? 'eye' : 'lock', 11), el('span', masked ? 'anomalous-ai-priv-slot-text is-masked' : 'anomalous-ai-priv-slot-text', slot.text));
    node.append(main, el('span', masked ? 'anomalous-ai-priv-slot-gloss is-masked' : 'anomalous-ai-priv-slot-gloss'));
    return node;
}

/** The row's "Show meanings" button (null when the page needs none or all are known); meanings known show at once. */
function meaningsButton(row, pairs) {
    const lang = pageGlossLang();
    if (!lang) return null;
    const show = () => pairs.forEach((pair, index) => {
        const meaning = glossOf(row.slots[index].text, lang) || '';
        for (const node of pair) node.lastChild.textContent = meaning;
    });
    show();
    if (!row.slots.some(slot => glossOf(slot.text, lang) === undefined)) return null;
    const ask = el('button', 'anomalous-ai-link anomalous-ai-priv-gloss-ask', t('aiTagsMeaning'));
    ask.type = 'button';
    ask.title = t('aiTagsMeaningHint');
    ask.onclick = async () => {
        ask.disabled = true;
        ask.textContent = t('aiTagsMeaningLoading');
        const ok = await fetchGlosses(row.slots.map(slot => slot.text), lang);
        show();
        if (ok) ask.remove();
        else {
            ask.disabled = false;
            ask.textContent = t('aiTagsMeaningFailed');
        }
    };
    return ask;
}

/** Lets the picked hidden slots through: one split per token holding some of them. */
async function letThrough(task, slots) {
    const byToken = new Map();
    for (const slot of slots) byToken.set(slot.token, [...(byToken.get(slot.token) || []), slot]);
    for (const [token, picked] of byToken) {
        const own = String(task.sealed?.[token] ?? '');
        const parts = picked.some(slot => slot.index < 0) ? [{ text: own, hide: false }] : partsShowingTags(own, new Set(picked.map(slot => slot.index)));
        await postPrivacyRule(task, { action: 'split_prompt', token, parts });
    }
}

/**
 * The side-by-side rows of `task`'s hidden `prompts`: { left, right } nodes, one row each per prompt, the left
 * one badged with its token, the right one with an eye.
 * `noteFor(token, named)` draws the note field of an active token under the left row (`named`: the row holds
 * more than one token, so the field says which); `onApplied()` redraws.
 */
export function promptMirrors(task, prompts, { noteFor, onApplied }) {
    const left = [];
    const right = [];
    promptMirror(task, prompts).forEach((row) => {
        const picked = new Set();
        const pairs = row.slots.map(slot => [slotButton(slot, 'left'), slotButton(slot, 'right')]);
        const leftBody = el('div', 'anomalous-ai-priv-trow-stack');
        const rightBody = el('div', 'anomalous-ai-priv-trow-stack');
        const leftRow = trow(lockBadge(row.token), leftBody);
        const rightRow = trow(eyeBadge(), rightBody);
        leftRow.classList.add('anomalous-ai-priv-mirror', 'is-left');
        rightRow.classList.add('anomalous-ai-priv-mirror', 'is-right');
        const leftSlots = el('div', 'anomalous-ai-priv-slots');
        const rightSlots = el('div', 'anomalous-ai-priv-slots');
        leftSlots.append(...pairs.map(pair => pair[0]));
        rightSlots.append(...pairs.map(pair => pair[1]));

        const bar = el('div', 'anomalous-ai-priv-letbar');
        bar.hidden = true;
        const warn = el('div', 'anomalous-ai-priv-letbar-warn', t('aiPrivacySplitWarn'));
        const count = el('span', 'anomalous-ai-priv-letbar-count');
        const clear = el('button', 'anomalous-ai-tool', t('aiPrivacyAdjustCancel'));
        const hide = el('button', 'anomalous-ai-tool', t('aiPrivacyHideAgain'));
        const show = el('button', 'anomalous-ai-tool is-primary', t('aiPrivacyLetThroughApply'));
        for (const button of [clear, hide, show]) button.type = 'button';
        bar.append(warn, count, clear, hide, show);
        const chosen = () => [...picked].map(index => row.slots[index]);
        const sync = () => {
            pairs.forEach(([a, b], index) => { a.classList.toggle('is-picked', picked.has(index)); b.classList.toggle('is-picked', picked.has(index)); });
            const hidden = chosen().filter(slot => !slot.shown).length;
            const shown = chosen().filter(slot => slot.shown).length;
            bar.hidden = !picked.size;
            warn.hidden = !hidden;
            show.hidden = !hidden;
            hide.hidden = !shown;
            count.textContent = t('aiPrivacyPickedTags', { count: picked.size });
        };
        pairs.forEach((pair, index) => {
            for (const node of pair) {
                node.onclick = () => {
                    if (picked.has(index)) picked.delete(index);
                    else picked.add(index);
                    sync();
                };
            }
        });
        clear.onclick = () => { picked.clear(); sync(); };
        const run = async (button, work) => {
            button.disabled = true;
            try {
                await work();
                onApplied();
            } catch (error) {
                button.disabled = false;
                await anomalousAlert(error.message);
            }
        };
        show.onclick = () => void run(show, () => letThrough(task, chosen().filter(slot => !slot.shown)));
        hide.onclick = () => void run(hide, async () => {
            for (const slot of chosen().filter(item => item.shown && item.text.length >= 2)) {
                await postPrivacyRule(task, { action: 'seal_message_phrase', phrase: slot.text });
            }
        });
        const ask = meaningsButton(row, pairs);
        leftBody.append(leftSlots, ...(ask ? [ask] : []), bar);
        const tokens = [...new Set(row.slots.filter(slot => !slot.shown).map(slot => slot.token))];
        for (const token of tokens) leftBody.append(noteFor(token, tokens.length > 1));
        rightBody.append(rightSlots);
        left.push(leftRow);
        right.push(rightRow);
    });
    return { left, right };
}
