/**
 * A workflow laid on a graph of its own, off the canvas, to be read (an output image's
 * workflow kept as a recipe or a combo). ComfyUI's frontend keeps widget values by the root
 * graph's id, node and name, and a workflow saved from the open canvas carries the canvas's
 * id: configured under that id, the detached graph would share the canvas's widget values and
 * write its own onto them. So the copy gets an id of its own. No DOM.
 */

/** A random version-4 UUID; `crypto.randomUUID` exists only on https or this computer. */
function freshId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `workflow` (UI JSON, left untouched) on a new LiteGraph graph with an id of its own. */
export function detachedGraph(workflow) {
    const copy = JSON.parse(JSON.stringify(workflow));
    copy.id = freshId();
    const graph = new globalThis.LiteGraph.LGraph();
    graph.configure(copy);
    return graph;
}