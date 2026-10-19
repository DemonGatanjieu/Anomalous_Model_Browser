/**
 * Voice-over with several characters (the cast): each character's colour, its place in the voice
 * list, the same on the list (ui_audio_sidebar.js) and on the line cards (ui_script_cards.js); and
 * picking lines, a click, Ctrl / ⌘ to add or take one away, Shift for a run, for the side panel
 * to change (ui_script_tune.js: who reads them and how) or for a card's name menu.
 */

const COLORS = ['#5b9cf6', '#ef7ea5', '#3fbf91', '#e3a33b', '#a487f5', '#4fc2d4', '#ee8656', '#94c252'];

/** A character's colour by its place in `groups` (the voice list, the same order everywhere). */
export function speakerColor(key, groups) {
    const index = groups.findIndex(group => group.group === key);
    return COLORS[Math.max(0, index) % COLORS.length];
}

/** The lines picked after a click on line `index`; `anchor` is the line a Shift run starts from. */
export function pickLines(picked, index, { ctrlKey = false, metaKey = false, shiftKey = false } = {}, anchor = null) {
    if (ctrlKey || metaKey) {
        const next = new Set(picked);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
    }
    if (shiftKey && anchor !== null) {
        const next = new Set();
        for (let at = Math.min(anchor, index); at <= Math.max(anchor, index); at += 1) next.add(at);
        return next;
    }
    return new Set([index]);
}
