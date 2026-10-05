/**
 * Where a LoRA loader goes into a workflow, and putting it there (Current node's "Insert LoRA"
 * and the MCP add_lora). A LoRA patches the model line (MODEL) and, when its file also trains
 * the text encoder, the CLIP line. The two lines may come from one node (a checkpoint, a full
 * LoRA loader) or from two (a UNet loader and its own CLIP loader). Every link moved keeps
 * going, now through the LoRA. Slots are found by declared type, never by index or name.
 */

const MAIN_LOADER = /checkpointloader|unetloader|unetloadergguf|diffusionmodelloader/i;
const BYPASSED = 4;

function normalizeSlotType(type) {
    return String(type ?? '').trim().toUpperCase();
}

function findSlotIndex(slots, requiredType) {
    const wanted = normalizeSlotType(requiredType);
    return Array.isArray(slots)
        ? slots.findIndex(slot => normalizeSlotType(slot?.type) === wanted)
        : -1;
}

function getGraphLink(graph, linkId) {
    if (linkId === null || linkId === undefined) return null;
    return graph?.getLink?.(linkId) || graph?.links?.[linkId] || graph?._links?.[linkId] || null;
}

function getGraphNode(graph, nodeId) {
    if (graph?.getNodeById) return graph.getNodeById(nodeId) || null;
    return Array.isArray(graph?._nodes)
        ? graph._nodes.find(node => node?.id === nodeId) || null
        : null;
}

/** The nodes an output feeds: [{ targetNode, targetSlot }]. */
function outputLinks(graph, node, slot) {
    return (node.outputs?.[slot]?.links || [])
        .map(id => getGraphLink(graph, id))
        .filter(Boolean)
        .map(link => ({ targetNode: getGraphNode(graph, link.target_id), targetSlot: link.target_slot }))
        .filter(link => link.targetNode);
}

/** The output an input is connected to: { node, slot }, or null. */
function inputSource(graph, node, slot) {
    const link = getGraphLink(graph, node.inputs?.[slot]?.link);
    const origin = link && getGraphNode(graph, link.origin_id);
    return origin ? { node: origin, slot: link.origin_slot } : null;
}

/** Follows `type` from `node` through the LoRA loaders chained after it: the last of them. */
export function chainEnd(graph, node, type) {
    let end = node;
    for (let hop = 0; hop < 20; hop++) {
        const slot = findSlotIndex(end.outputs, type);
        const targets = slot < 0 ? [] : outputLinks(graph, end, slot);
        if (targets.length !== 1 || !/lora/i.test(targets[0].targetNode.type || '')) break;
        end = targets[0].targetNode;
    }
    return end;
}

/** The workflow's main model loaders (checkpoint, UNet), bypassed ones left out. */
export function mainModelLoaders(graph) {
    return (graph?._nodes || []).filter(node => MAIN_LOADER.test(node.type || '') && node.mode !== BYPASSED);
}

/** The canvas's one CLIP source (a loader taking no MODEL or CLIP), past its LoRAs; null unless exactly one. */
function soleClipEnd(graph) {
    const sources = (graph?._nodes || []).filter(node => node.mode !== BYPASSED && findSlotIndex(node.outputs, 'CLIP') >= 0
        && findSlotIndex(node.inputs, 'CLIP') < 0 && findSlotIndex(node.inputs, 'MODEL') < 0);
    if (sources.length !== 1) return null;
    const end = chainEnd(graph, sources[0], 'CLIP');
    return { node: end, slot: findSlotIndex(end.outputs, 'CLIP') };
}

/**
 * The CLIP that goes through a LoRA inserted before `anchor`: its own CLIP input, or, for a
 * sampler (none), the CLIP inputs of the prompt nodes wired into it when one source feeds them all.
 */
function clipBefore(graph, anchor) {
    const own = findSlotIndex(anchor.inputs, 'CLIP');
    if (own >= 0) {
        const source = inputSource(graph, anchor, own);
        return source && { ...source, links: [{ targetNode: anchor, targetSlot: own }] };
    }
    const prompts = new Set((anchor.inputs || []).map((_input, index) => inputSource(graph, anchor, index)?.node)
        .filter(node => node && findSlotIndex(node.inputs, 'CLIP') >= 0));
    const links = [];
    const sources = new Map();
    for (const node of prompts) {
        const slot = findSlotIndex(node.inputs, 'CLIP');
        const source = inputSource(graph, node, slot);
        if (!source) continue;
        sources.set(`${source.node.id}:${source.slot}`, source);
        links.push({ targetNode: node, targetSlot: slot });
    }
    return sources.size === 1 ? { ...[...sources.values()][0], links } : null;
}

function unsupported(direction, code) {
    return { supported: false, direction, code, outputs: [], clip: false };
}

/**
 * Where a LoRA loader goes before or after `anchorNode`: { supported, code, direction,
 * outputs, clip }. Each of `outputs` ({ node, slot, type, links }) feeds the LoRA's input of
 * `type`, and its `links` ({ targetNode, targetSlot }) then come from the LoRA's output.
 * After: every link of the anchor's MODEL output; with `textEncoder`, also every link of its
 * CLIP output, or of the canvas's one CLIP source when it has none (a UNet loader).
 * Before: only the anchor's own MODEL input; with `textEncoder`, the CLIP from clipBefore.
 * `clip` says whether the CLIP line goes through (a full LoRA loader, else a model-only one).
 */
export function planLoraInsertion(graph, anchorNode, direction, { textEncoder = true } = {}) {
    if (!graph || !anchorNode) return unsupported(direction, 'missing_graph_or_node');
    const outputs = [];
    if (direction === 'after') {
        const slot = findSlotIndex(anchorNode.outputs, 'MODEL');
        if (slot < 0) return unsupported(direction, 'missing_chain_outputs');
        outputs.push({ node: anchorNode, slot, type: 'MODEL', links: outputLinks(graph, anchorNode, slot) });
        if (textEncoder) {
            const own = findSlotIndex(anchorNode.outputs, 'CLIP');
            const clip = own >= 0 ? { node: anchorNode, slot: own } : soleClipEnd(graph);
            if (clip) outputs.push({ ...clip, type: 'CLIP', links: outputLinks(graph, clip.node, clip.slot) });
        }
    } else if (direction === 'before') {
        const slot = findSlotIndex(anchorNode.inputs, 'MODEL');
        if (slot < 0) return unsupported(direction, 'missing_chain_inputs');
        const source = inputSource(graph, anchorNode, slot);
        if (!source) return unsupported(direction, 'unconnected_chain_inputs');
        outputs.push({ ...source, type: 'MODEL', links: [{ targetNode: anchorNode, targetSlot: slot }] });
        const clip = textEncoder ? clipBefore(graph, anchorNode) : null;
        if (clip) outputs.push({ ...clip, type: 'CLIP' });
    } else {
        return unsupported(direction, 'invalid_direction');
    }
    return { supported: true, direction, code: 'ready', outputs, clip: outputs.length > 1 };
}

/** Whether a LoRA can go before / after the node (the model line decides). */
export function loraInsertionCapabilities(graph, anchorNode) {
    return {
        before: planLoraInsertion(graph, anchorNode, 'before', { textEncoder: false }),
        after: planLoraInsertion(graph, anchorNode, 'after', { textEncoder: false }),
    };
}

function assertInsertedNodeSlots(insertedNode, types) {
    const slots = {};
    for (const type of types) {
        const input = findSlotIndex(insertedNode?.inputs, type);
        const output = findSlotIndex(insertedNode?.outputs, type);
        if (input < 0 || output < 0) {
            const error = new Error(`Inserted node does not expose ${type} input/output slots.`);
            error.code = 'inserted_node_missing_chain_slots';
            throw error;
        }
        slots[type] = { input, output };
    }
    return slots;
}

function connectOrThrow(originNode, originSlot, targetNode, targetSlot, type) {
    const link = originNode?.connect?.(originSlot, targetNode, targetSlot);
    if (!link) {
        const error = new Error(`Failed to connect ${type} while inserting the model node.`);
        error.code = 'connection_failed';
        error.channelType = type;
        throw error;
    }
}

function restoreConnections(originalConnections) {
    for (const connection of originalConnections) {
        connection.originNode?.connect?.(
            connection.originSlot,
            connection.targetNode,
            connection.targetSlot,
        );
    }
}

function placeInsertedNode(graph, anchorNode, insertedNode, direction) {
    const anchorX = Number(anchorNode?.pos?.[0]) || 0;
    const anchorY = Number(anchorNode?.pos?.[1]) || 0;
    const anchorWidth = Number(anchorNode?.size?.[0]) || 220;
    const insertedWidth = Number(insertedNode?.size?.[0]) || 220;
    const horizontalGap = 90;
    let x = direction === 'before'
        ? anchorX - insertedWidth - horizontalGap
        : anchorX + anchorWidth + horizontalGap;
    let y = anchorY;

    const overlaps = (candidateX, candidateY) => (graph?._nodes || []).some(node => {
        if (!node || node === anchorNode || node === insertedNode) return false;
        const nodeX = Number(node.pos?.[0]) || 0;
        const nodeY = Number(node.pos?.[1]) || 0;
        const nodeWidth = Number(node.size?.[0]) || 220;
        const nodeHeight = Number(node.size?.[1]) || 120;
        const insertedHeight = Number(insertedNode?.size?.[1]) || 120;
        return candidateX < nodeX + nodeWidth + 20
            && candidateX + insertedWidth + 20 > nodeX
            && candidateY < nodeY + nodeHeight + 20
            && candidateY + insertedHeight + 20 > nodeY;
    });

    for (const offset of [0, 80, -80, 160, -160, 240, -240]) {
        if (!overlaps(x, anchorY + offset)) {
            y = anchorY + offset;
            break;
        }
    }
    insertedNode.pos = [x, y];
}

/**
 * Puts `insertedNode` (a LoRA loader of the plan's kind) where `plan` (planLoraInsertion) says,
 * as one graph change. All or nothing: on a failed connection the node goes and the original
 * links come back.
 */
export function spliceLora({ graph, plan, anchorNode, insertedNode }) {
    const slots = assertInsertedNodeSlots(insertedNode, plan.outputs.map(output => output.type));
    const original = plan.outputs.flatMap(output => output.links.map(link => ({ originNode: output.node, originSlot: output.slot, ...link })));
    let added = false;
    graph.beforeChange?.(anchorNode);
    try {
        graph.add(insertedNode);
        added = true;
        placeInsertedNode(graph, anchorNode, insertedNode, plan.direction);
        for (const output of plan.outputs) {
            const { input, output: out } = slots[output.type];
            connectOrThrow(output.node, output.slot, insertedNode, input, output.type);
            for (const link of output.links) connectOrThrow(insertedNode, out, link.targetNode, link.targetSlot, output.type);
        }
        return insertedNode;
    } catch (error) {
        if (added) graph.remove?.(insertedNode);
        restoreConnections(original);
        throw error;
    } finally {
        graph.afterChange?.(anchorNode);
        graph.change?.();
        graph.setDirtyCanvas?.(true, true);
    }
}
