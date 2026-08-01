const MODEL_CHAIN_TYPES = Object.freeze(['MODEL', 'CLIP']);

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
    return graph?.links?.[linkId] || graph?._links?.[linkId] || null;
}

function getGraphNode(graph, nodeId) {
    if (graph?.getNodeById) return graph.getNodeById(nodeId) || null;
    return Array.isArray(graph?._nodes)
        ? graph._nodes.find(node => node?.id === nodeId) || null
        : null;
}

function unsupported(direction, code, details = {}) {
    return { supported: false, direction, code, channels: [], ...details };
}

export function analyzeModelChainInsertion(graph, anchorNode, direction) {
    if (!graph || !anchorNode) {
        return unsupported(direction, 'missing_graph_or_node');
    }
    if (direction !== 'before' && direction !== 'after') {
        return unsupported(direction, 'invalid_direction');
    }

    const channels = [];
    for (const type of MODEL_CHAIN_TYPES) {
        const anchorSlot = direction === 'before'
            ? findSlotIndex(anchorNode.inputs, type)
            : findSlotIndex(anchorNode.outputs, type);
        if (anchorSlot < 0) {
            return unsupported(direction, direction === 'before' ? 'missing_chain_inputs' : 'missing_chain_outputs', { missingType: type });
        }

        if (direction === 'before') {
            const linkId = anchorNode.inputs[anchorSlot]?.link;
            const link = getGraphLink(graph, linkId);
            const sourceNode = link ? getGraphNode(graph, link.origin_id) : null;
            if (!link || !sourceNode) {
                return unsupported(direction, 'unconnected_chain_inputs', { missingType: type });
            }
            channels.push({
                type,
                anchorSlot,
                originalLinks: [{
                    originNode: sourceNode,
                    originSlot: link.origin_slot,
                    targetNode: anchorNode,
                    targetSlot: anchorSlot,
                }],
            });
            continue;
        }

        const linkIds = Array.isArray(anchorNode.outputs[anchorSlot]?.links)
            ? anchorNode.outputs[anchorSlot].links.filter(id => id !== null && id !== undefined)
            : [];
        if (linkIds.length > 1) {
            return unsupported(direction, 'ambiguous_downstream_branches', { ambiguousType: type, branchCount: linkIds.length });
        }

        const originalLinks = [];
        for (const linkId of linkIds) {
            const link = getGraphLink(graph, linkId);
            const targetNode = link ? getGraphNode(graph, link.target_id) : null;
            if (!link || !targetNode) {
                return unsupported(direction, 'invalid_downstream_link', { invalidType: type });
            }
            originalLinks.push({
                originNode: anchorNode,
                originSlot: anchorSlot,
                targetNode,
                targetSlot: link.target_slot,
            });
        }
        channels.push({ type, anchorSlot, originalLinks });
    }

    return { supported: true, direction, code: 'ready', channels };
}

export function getModelChainInsertionCapabilities(graph, anchorNode) {
    return {
        before: analyzeModelChainInsertion(graph, anchorNode, 'before'),
        after: analyzeModelChainInsertion(graph, anchorNode, 'after'),
    };
}

function assertInsertedNodeSlots(insertedNode) {
    const slots = {};
    for (const type of MODEL_CHAIN_TYPES) {
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

export function spliceModelChainNode({ graph, anchorNode, insertedNode, direction }) {
    const analysis = analyzeModelChainInsertion(graph, anchorNode, direction);
    if (!analysis.supported) {
        const error = new Error(`Model-chain insertion is not available: ${analysis.code}`);
        error.code = analysis.code;
        error.analysis = analysis;
        throw error;
    }

    const insertedSlots = assertInsertedNodeSlots(insertedNode);
    const originalConnections = analysis.channels.flatMap(channel => channel.originalLinks);
    let added = false;
    graph.beforeChange?.(anchorNode);
    try {
        graph.add(insertedNode);
        added = true;
        placeInsertedNode(graph, anchorNode, insertedNode, direction);

        for (const channel of analysis.channels) {
            const slots = insertedSlots[channel.type];
            if (direction === 'before') {
                const original = channel.originalLinks[0];
                connectOrThrow(original.originNode, original.originSlot, insertedNode, slots.input, channel.type);
                connectOrThrow(insertedNode, slots.output, anchorNode, channel.anchorSlot, channel.type);
                continue;
            }

            connectOrThrow(anchorNode, channel.anchorSlot, insertedNode, slots.input, channel.type);
            for (const original of channel.originalLinks) {
                connectOrThrow(insertedNode, slots.output, original.targetNode, original.targetSlot, channel.type);
            }
        }

        graph.afterChange?.(anchorNode);
        graph.change?.();
        graph.setDirtyCanvas?.(true, true);
        return insertedNode;
    } catch (error) {
        if (added) graph.remove?.(insertedNode);
        restoreConnections(originalConnections);
        graph.afterChange?.(anchorNode);
        graph.change?.();
        graph.setDirtyCanvas?.(true, true);
        throw error;
    }
}
