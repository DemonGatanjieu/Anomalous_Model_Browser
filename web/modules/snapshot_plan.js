/**
 * The saves bar's rules (ui_snapshot_bar.js draws it): how many runs the marks make, which seed each
 * run gets and how a mark is compiled. A seed is any number widget with ComfyUI's control_after_generate beside it, a
 * third party's as well, in subgraphs too. "random": every run a new seed in each. "locked": one seed
 * per round, the same in every mark, so marks compare from the same noise; a fixed seed alone would
 * send the same prompt again, and ComfyUI answers that from its cache with no new picture. Pure.
 */

export const MAX_COUNT = 16; // runs of one mark
export const MAX_RUNS = 64; // of a whole queue
const SEED_TOP = 1125899906842624; // ComfyUI's own widest seed

function* nodesOf(graph) {
    for (const node of graph?._nodes || []) {
        yield node;
        if (node.subgraph) yield* nodesOf(node.subgraph);
    }
}

/** The seed widgets of `graph`, at every level. */
export function seedWidgets(graph) {
    const found = [];
    for (const node of nodesOf(graph)) {
        for (const widget of node.widgets || []) {
            if (typeof widget.value === 'number' && widget.linkedWidgets?.some(item => item.name === 'control_after_generate')) found.push(widget);
        }
    }
    return found;
}

/** A seed in `widget`'s range. */
function randomFor(widget, random) {
    const low = Math.max(0, Number(widget.options?.min) || 0);
    const high = Math.min(SEED_TOP, Number(widget.options?.max) || SEED_TOP);
    return low + Math.floor(random() * (high - low));
}

/** Writes this run's seeds: `seed` in every widget, or with none a new one in each. */
export function applySeeds(graph, seed = null, random = Math.random) {
    for (const widget of seedWidgets(graph)) widget.value = seed ?? randomFor(widget, random);
}

/** A seed to start a locked queue from, leaving room for its rounds. */
export const baseSeed = (random = Math.random) => Math.floor(random() * (SEED_TOP - MAX_COUNT));

/**
 * What ComfyUI would queue for `graph`, a graph off the canvas. A plugin may put its own
 * app.graphToPrompt in front of ComfyUI's and leave the graph out (ComfyUI-Manager does), and ComfyUI
 * then compiles the canvas: a result that is not `graph`'s is made again by ComfyUI's own method, past them.
 */
export async function compiled(app, graph) {
    const made = await app.graphToPrompt(graph);
    return made.workflow?.id === graph.id ? made : Object.getPrototypeOf(app).graphToPrompt.call(app, graph);
}

/** The seeds of `mark`'s runs in order: null for a new one each time. */
export const seedsOf = (mark, mode, base) => Array.from({ length: mark.count }, (_, round) => (mode === 'locked' ? base + round : null));

export const runTotal = marks => marks.reduce((sum, mark) => sum + mark.count, 0);

/** What a save changes from the one before: nothing ('same'), only 'values', or the 'nodes' themselves. */
export function changeKind(changes) {
    if (!changes.length) return 'same';
    return changes.some(change => change.kind !== 'changed') ? 'nodes' : 'values';
}

/** What the user typed as a mark's runs, within what a mark takes. */
export const runCount = value => Math.max(1, Math.min(MAX_COUNT, Math.floor(Number(value)) || 1));
