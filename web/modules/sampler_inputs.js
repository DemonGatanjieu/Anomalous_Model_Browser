/**
 * The part of a workflow that makes a sampler's model and prompts (what a combo kept from an
 * output image holds): every node upstream of a sampler's model / positive / negative /
 * conditioning inputs — model and CLIP loaders, LoRA chains, CLIP skip and model patches, the
 * prompt nodes — but not the sampler itself, nor anything reached only through an image,
 * latent or mask (image loaders, sizes, VAE decoding). A sampler is a node with a model input
 * and a positive or conditioning input (KSampler, KSampler Advanced, CFG / Basic guiders).
 * No DOM; `graph` is a LiteGraph graph (or anything with nodes and getLink / links).
 */

const FEEDS = new Set(['model', 'positive', 'negative', 'conditioning']);
const CUT = new Set(['IMAGE', 'LATENT', 'MASK']);

const inputNames = node => (node.inputs || []).map(input => input?.name);

/** Whether `node` is a sampler (or a guider) whose model and prompts a combo keeps. */
export function isSampler(node) {
    const names = inputNames(node);
    return names.includes('model') && (names.includes('positive') || names.includes('conditioning'));
}

/** The nodes upstream of the samplers' model and prompt inputs, in the graph's order. */
export function samplerSideNodes(graph) {
    const nodes = graph?._nodes || graph?.nodes || [];
    const byId = new Map(nodes.map(node => [node.id, node]));
    const linkOf = id => graph.getLink?.(id) ?? graph.links?.[id] ?? null;
    const samplers = new Set(nodes.filter(isSampler).map(node => node.id));
    const kept = new Set();
    const waiting = [];
    const follow = (input) => {
        if (input?.link == null) return;
        const link = linkOf(input.link);
        if (!link || CUT.has(String(link.type ?? input.type ?? '').toUpperCase())) return;
        waiting.push(link.origin_id);
    };
    for (const id of samplers) {
        for (const input of byId.get(id).inputs || []) if (FEEDS.has(input?.name)) follow(input);
    }
    while (waiting.length) {
        const id = waiting.pop();
        if (kept.has(id) || samplers.has(id) || !byId.has(id)) continue;
        kept.add(id);
        for (const input of byId.get(id).inputs || []) follow(input);
    }
    return nodes.filter(node => kept.has(node.id));
}
