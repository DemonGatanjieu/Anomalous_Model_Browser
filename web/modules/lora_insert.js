/**
 * Several LoRAs into a workflow at once (the model picker's Insert LoRA), as one of the LoRA nodes
 * of lora_nodes.js: ComfyUI's own in a chain, or the one node a third-party stack goes through.
 * All or nothing. No imports of ComfyUI, so it is tested on its own (LiteGraph is read from globalThis).
 */

import { placeNodes, planLoraInsertion, removeSpliced, spliceLora } from './graph_splice.js';
import { fillLoraHead } from './lora_nodes.js';

function make(type) {
    const node = globalThis.LiteGraph.createNode(type);
    if (!node) throw new Error(`ComfyUI cannot make ${type}.`);
    return node;
}

/**
 * Puts `loras` (paths in order) before or after `anchorNode` and returns the new nodes.
 * `textEncoder`: whether any of them trains it. It holds for them all, so the CLIP line runs
 * unbroken through a chain. `setPath(node, path)` fills a ComfyUI LoRA loader on the canvas.
 */
export function insertLoras({ graph, anchorNode, direction, kind, loras, textEncoder, setPath }) {
    const spliced = [];
    const beside = [];
    const splice = (anchor, type) => {
        const plan = planLoraInsertion(graph, anchor, direction, { textEncoder });
        if (!plan.supported) throw new Error(plan.code);
        const insertedNode = make(type ?? (plan.clip ? 'LoraLoader' : 'LoraLoaderModelOnly'));
        spliceLora({ graph, plan, anchorNode: anchor, insertedNode });
        spliced.push({ graph, plan, insertedNode });
        return insertedNode;
    };
    const add = (type) => {
        const node = make(type);
        graph.add(node);
        beside.push(node);
        return node;
    };
    try {
        if (kind.head) {
            fillLoraHead(kind, splice(anchorNode, kind.head), loras, add);
        } else {
            let anchor = anchorNode;
            for (const path of loras) {
                const node = splice(anchor);
                setPath(node, path);
                if (direction === 'after') anchor = node; // before: the next goes between this one and the anchor
            }
        }
    } catch (error) {
        beside.forEach(node => graph.remove(node));
        spliced.reverse().forEach(removeSpliced);
        throw error;
    }
    const nodes = [...beside, ...spliced.map(item => item.insertedNode)];
    placeNodes(graph, anchorNode, nodes, direction);
    return nodes;
}
