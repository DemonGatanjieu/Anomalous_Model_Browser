/**
 * The list the "Run my preset" sheet builds (ui_ai_preset_sheet.js): which presets of a saved workflow run,
 * in the order pressed, each so many times; what of a run is kept for "the same again" (this browser) and
 * still stands; the print of a canvas's nodes that tells which saved workflow it is (api/ai_starters.py
 * shape), and what a canvas would run with, to tell whether someone changed it since.
 */

export const OWN = ''; // a pick's `file` for the settings the workflow opens with
export const MAX_EACH = 9;
export const MAX_TOTAL = 50;

const count = value => Math.min(MAX_EACH, Math.max(1, Math.round(Number(value)) || 1));

/** `picks` ([{file, times}]) without `file`, or with it at the end to run once. */
export function toggled(picks, file) {
    return picks.some(pick => pick.file === file) ? picks.filter(pick => pick.file !== file) : [...picks, { file, times: 1 }];
}

/** `picks` with `file` running `times` times (1 to MAX_EACH). */
export function withTimes(picks, file, times) {
    return picks.map(pick => (pick.file === file ? { ...pick, times: count(times) } : pick));
}

export const total = picks => picks.reduce((sum, pick) => sum + pick.times, 0);

/**
 * A run kept before (`kept`: {workflow, picks, close}) as it can run now: {workflow, picks, close} with the
 * saved workflow of `workflows` and the picks still saved under it; null when the workflow is gone, nothing
 * of the picks is left or they are more than a run takes.
 */
export function still(kept, workflows) {
    const workflow = workflows.find(item => item.file === kept?.workflow);
    if (!workflow || !Array.isArray(kept.picks)) return null;
    const saved = new Set([OWN, ...workflow.presets.map(preset => preset.file)]);
    const picks = [];
    for (const pick of kept.picks) {
        if (!saved.has(pick?.file)) continue;
        saved.delete(pick.file); // each once
        picks.push({ file: pick.file, times: count(pick.times) });
    }
    return picks.length && total(picks) <= MAX_TOTAL ? { workflow, picks, close: kept.close !== false } : null;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});

function crc32(text) {
    let value = 0xFFFFFFFF;
    for (const byte of new TextEncoder().encode(text)) value = CRC[(value ^ byte) & 0xFF] ^ (value >>> 8);
    return (value ^ 0xFFFFFFFF) >>> 0;
}

/** The print of `nodes` (a canvas as it serializes): a saved workflow's `shape` when they are its nodes. */
export function shapeOf(nodes) {
    const list = (nodes || []).filter(node => node && typeof node === 'object');
    let mix = 0;
    for (const node of list) mix = (mix + crc32(`${node.id}:${node.type}`)) % 0x100000000;
    return list.length ? `${list.length}:${mix.toString(16).padStart(8, '0')}` : '';
}

/** What canvas `state` would run with: every node's values, whether it is on and what feeds it; where the nodes lie is not in it. */
export function valuesOf(state) {
    const nodes = (state?.nodes || []).map(node => [String(node.id), node.type, node.mode ?? 0, node.widgets_values ?? null,
        (node.inputs || []).map(input => input.link ?? null)]);
    return JSON.stringify(nodes.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}
