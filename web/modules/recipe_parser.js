/**
 * Read-only helpers for turning the live LiteGraph canvas into a compact
 * Workflow Recipe summary.  The saved workflow itself remains authoritative:
 * an unfamiliar custom node must never prevent a recipe from being saved.
 */

const MAX_UPSTREAM_NODES = 96;
const MAX_SUMMARY_NODES = 120;
const MAX_WIDGETS_PER_NODE = 16;
const MAX_WIDGET_TEXT = 320;
const SENSITIVE_WIDGET_NAME = /(?:api.?key|access.?token|auth|password|passwd|secret|credential)/i;

function nodeType(node) {
    return String(node?.type || node?.comfyClass || '');
}

function normaliseName(value) {
    return String(value || '').trim().toLowerCase();
}

function widgetValue(node, names, fallbackIndex = -1) {
    const wanted = new Set(names.map(normaliseName));
    const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
    const named = widgets.find((widget) => wanted.has(normaliseName(widget?.name)));
    if (named && named.value !== undefined && named.value !== null) return named.value;

    if (fallbackIndex >= 0) {
        const fallback = widgets[fallbackIndex]?.value;
        if (fallback !== undefined && fallback !== null) return fallback;
        const serialised = node?.widgets_values?.[fallbackIndex];
        if (serialised !== undefined && serialised !== null) return serialised;
    }
    return null;
}

function textValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function summariseWidgetValue(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > MAX_WIDGET_TEXT ? `${trimmed.slice(0, MAX_WIDGET_TEXT - 1)}…` : trimmed;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value) && value.length <= 12 && value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
        return value.map((item) => typeof item === 'string' && item.length > 80 ? `${item.slice(0, 79)}…` : item);
    }
    return null;
}

function extractGenericNodeSummary(node) {
    const widgets = [];
    for (const [index, widget] of (node?.widgets || []).entries()) {
        const name = textValue(widget?.name) || `widget_${index + 1}`;
        if (SENSITIVE_WIDGET_NAME.test(name) || normaliseName(widget?.type) === 'button') continue;
        const value = summariseWidgetValue(widget?.value);
        if (value === null || value === '') continue;
        widgets.push({ name, value });
        if (widgets.length >= MAX_WIDGETS_PER_NODE) break;
    }

    const nodeData = node?.constructor?.nodeData || {};
    return {
        id: node?.id ?? null,
        type: nodeType(node) || 'Unknown',
        title: textValue(node?.title) || null,
        category: textValue(nodeData.category || node?.category) || null,
        module: textValue(nodeData.python_module || nodeData.module) || null,
        widgets,
        widgetCount: Array.isArray(node?.widgets) ? node.widgets.length : 0,
    };
}

function buildNodeIndex(graph) {
    return new Map((graph?._nodes || []).filter(Boolean).map((node) => [node.id, node]));
}

function linkOriginId(link) {
    if (Array.isArray(link)) return link[1];
    return link?.origin_id;
}

function findLink(graph, linkId) {
    if (linkId === null || linkId === undefined) return null;
    const links = graph?.links;
    if (Array.isArray(links)) return links.find((link) => Array.isArray(link) && link[0] === linkId) || null;
    return links?.[linkId] || null;
}

function inputLinkOrigin(graph, node, inputNames) {
    const wanted = new Set(inputNames.map(normaliseName));
    const input = (node?.inputs || []).find((item) => wanted.has(normaliseName(item?.name)));
    const link = findLink(graph, input?.link);
    return linkOriginId(link);
}

function collectPromptTexts(graph, startNodeId, nodeIndex) {
    const queue = [startNodeId];
    const visited = new Set();
    const prompts = [];

    while (queue.length && visited.size < MAX_UPSTREAM_NODES) {
        const nodeId = queue.shift();
        if (nodeId === null || nodeId === undefined || visited.has(nodeId)) continue;
        visited.add(nodeId);
        const node = nodeIndex.get(nodeId);
        if (!node) continue;

        if (/cliptextencode/i.test(nodeType(node))) {
            const prompt = textValue(widgetValue(node, ['text', 'prompt'], 0));
            if (prompt && !prompts.includes(prompt)) prompts.push(prompt);
            continue;
        }

        for (const input of node.inputs || []) {
            const originId = linkOriginId(findLink(graph, input?.link));
            if (originId !== null && originId !== undefined && !visited.has(originId)) {
                queue.push(originId);
            }
        }
    }
    return prompts;
}

function appendUnique(target, values) {
    for (const value of values) {
        if (value && !target.includes(value)) target.push(value);
    }
}

function recipeSampler(node) {
    const type = nodeType(node);
    const isStandardSampler = /^ksampler$/i.test(type);
    const isAdvancedSampler = /^ksampleradvanced$/i.test(type);
    return {
        type,
        seed: widgetValue(node, ['seed', 'noise_seed'], (isStandardSampler || isAdvancedSampler) ? 0 : -1),
        steps: numberValue(widgetValue(node, ['steps'], (isStandardSampler || isAdvancedSampler) ? 2 : -1)),
        cfg: numberValue(widgetValue(node, ['cfg', 'cfg_scale'], (isStandardSampler || isAdvancedSampler) ? 3 : -1)),
        sampler_name: textValue(widgetValue(node, ['sampler_name', 'sampler'], (isStandardSampler || isAdvancedSampler) ? 4 : -1)) || null,
        scheduler: textValue(widgetValue(node, ['scheduler'], (isStandardSampler || isAdvancedSampler) ? 5 : -1)) || null,
        denoise: numberValue(widgetValue(node, ['denoise'], isStandardSampler ? 6 : -1)),
    };
}

function mergeSampler(metadata, sampler) {
    metadata.samplers.push(sampler);
    for (const field of ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise']) {
        if (metadata[field] === null && sampler[field] !== null && sampler[field] !== '') {
            metadata[field] = sampler[field];
        }
    }
}

/**
 * Extract a best-effort summary from the live LiteGraph graph without
 * modifying nodes, links, widgets, or graph state.
 */
export function extractRecipeMetadata(graph) {
    const metadata = {
        baseModel: null,
        baseModels: [],
        loras: [],
        promptPositive: [],
        promptNegative: [],
        nodes: [],
        nodeCount: graph?._nodes?.length || 0,
        samplers: [],
        seed: null,
        steps: null,
        cfg: null,
        sampler_name: null,
        scheduler: null,
        denoise: null,
        resolution: null,
    };
    if (!graph || !Array.isArray(graph._nodes)) return metadata;

    const nodeIndex = buildNodeIndex(graph);
    for (const node of graph._nodes) {
        const type = nodeType(node);
        if (metadata.nodes.length < MAX_SUMMARY_NODES) metadata.nodes.push(extractGenericNodeSummary(node));

        if (/^(checkpointloader(simple)?|unetloader)$/i.test(type)) {
            const model = textValue(widgetValue(
                node,
                ['ckpt_name', 'checkpoint', 'unet_name', 'unet', 'model_name'],
                0,
            ));
            if (model && !metadata.baseModels.includes(model)) metadata.baseModels.push(model);
            if (!metadata.baseModel && model) metadata.baseModel = model;
        }

        if (/lora.*loader|loader.*lora/i.test(type)) {
            const name = textValue(widgetValue(node, ['lora_name', 'lora', 'model_name'], 0));
            if (name) {
                metadata.loras.push({
                    name,
                    strength_model: numberValue(widgetValue(node, ['strength_model', 'model_strength'], 1)),
                    strength_clip: numberValue(widgetValue(node, ['strength_clip', 'clip_strength'], 2)),
                });
            }
        }

        if (/^ksampler(advanced)?$/i.test(type) || /samplercustom/i.test(type)) {
            mergeSampler(metadata, recipeSampler(node));

            const positiveOrigin = inputLinkOrigin(graph, node, ['positive', 'conditioning', 'guider']);
            const negativeOrigin = inputLinkOrigin(graph, node, ['negative']);
            appendUnique(metadata.promptPositive, collectPromptTexts(graph, positiveOrigin, nodeIndex));
            appendUnique(metadata.promptNegative, collectPromptTexts(graph, negativeOrigin, nodeIndex));
        }

        if (/empty.*latent/i.test(type) && !metadata.resolution) {
            const width = numberValue(widgetValue(node, ['width'], 0));
            const height = numberValue(widgetValue(node, ['height'], 1));
            if (width && height) metadata.resolution = { width, height };
        }
    }
    return metadata;
}

/** Capture a bounded canvas preview; the optional element makes this testable. */
export function captureCanvasThumbnail(canvasEl = null) {
    const source = canvasEl || document.getElementById('comfy-canvas-element') || document.querySelector('canvas');
    if (!source?.width || !source?.height) return null;
    try {
        const maxEdge = 720;
        const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
        const thumbnail = document.createElement('canvas');
        thumbnail.width = Math.max(1, Math.round(source.width * scale));
        thumbnail.height = Math.max(1, Math.round(source.height * scale));
        const context = thumbnail.getContext('2d');
        if (!context) return null;
        context.drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
        return thumbnail.toDataURL('image/jpeg', 0.65);
    } catch (error) {
        console.warn('Failed to capture recipe thumbnail:', error);
        return null;
    }
}
