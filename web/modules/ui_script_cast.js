/**
 * Voice-over with several characters (the cast): each character's colour, its place in the voice
 * list, the same on the list (ui_audio_sidebar.js) and on the line cards; the speaker chip of a
 * line card; and picking lines, a click, Ctrl / ⌘ to add or take one away, Shift for a run, to
 * give to a character from the list (ui_script_director.js castScriptCharacter).
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

/** Who reads a line, on its card. */
export function speakerChip(group, color) {
    const chip = document.createElement('span');
    chip.className = 'anomalous-sd-speaker';
    chip.textContent = group?.character || '?';
    chip.style.setProperty('--speaker', color);
    return chip;
}
