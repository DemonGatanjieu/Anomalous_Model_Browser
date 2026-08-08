/**
 * Read-only helpers for turning the live LiteGraph canvas into a compact
 * Workflow Recipe summary.  The saved workflow itself remains authoritative:
 * an unfamiliar custom node must never prevent a recipe from being saved.
 */

const MAX_UPSTREAM_NODES = 96;
const MAX_SUMMARY_NODES = 120;
const MAX_WIDGETS_PER_NODE = 16;
const MAX_WIDGET_TEXT = 320;
const MAX_PINNED_VALUE_JSON = 2400;
const MAX_PARAMETER_CHOICES = 5000;
const SENSITIVE_WIDGET_NAME = /(?:api.?key|access.?token|auth|password|passwd|secret|credential)/i;
const SUPPORTED_PROMPT_NODE_TYPES = new Set([
    'cliptextencode',
]);
const SUPPORTED_PROMPT_CONSUMERS = new Map([
    ['ksampler', { positive: 'positive', negative: 'negative' }],
    ['ksampleradvanced', { positive: 'positive', negative: 'negative' }],
    ['cfgguider', { positive: 'positive', negative: 'negative' }],
    ['basicguider', { conditioning: 'positive' }],
    ['dualcfgguider', { cond1: 'positive', cond2: 'positive', negative: 'negative' }],
]);
const SUPPORTED_CONDITIONING_PASSTHROUGH = new Set([
    'conditioningaverage',
    'conditioningcombine',
    'conditioningconcat',
    'conditioningmultiply',
    'conditioningsetarea',
    'conditioningsetareapercentage',
    'conditioningsetareastrength',
    'conditioningsetmask',
    'conditioningsettimesteprange',
    'conditioningzeroout',
]);

function nodeType(node) {
    return String(node?.type || node?.comfyClass || '');
}

function normaliseName(value) {
    return String(value || '').trim().toLowerCase();
}

export function isSupportedPromptNodeType(value) {
    return SUPPORTED_PROMPT_NODE_TYPES.has(normaliseName(value));
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

function clonePinnableValue(value) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        if (typeof value === 'string' && value.length > MAX_PINNED_VALUE_JSON) return null;
        return value;
    }
    try {
        const encoded = JSON.stringify(value);
        if (!encoded || encoded.length > MAX_PINNED_VALUE_JSON) return null;
        return JSON.parse(encoded);
    } catch (error) {
        return null;
    }
}

function extractGenericNodeSummary(node) {
    const widgets = [];
    for (const [index, widget] of (node?.widgets || []).entries()) {
        const name = textValue(widget?.name) || `widget_${index + 1}`;
        if (SENSITIVE_WIDGET_NAME.test(name) || normaliseName(widget?.type) === 'button') continue;
        const value = summariseWidgetValue(widget?.value);
        if (value === null || value === '') continue;
        widgets.push({ name, value, index });
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

/** Return safe, user-selectable widget values for manual key-parameter pins. */
export function extractRecipeParameterChoices(graph) {
    const choices = [];
    if (!graph || !Array.isArray(graph._nodes)) return choices;
    for (const node of graph._nodes) {
        for (const [widgetIndex, widget] of (node?.widgets || []).entries()) {
            const widgetName = textValue(widget?.name) || `widget_${widgetIndex + 1}`;
            if (SENSITIVE_WIDGET_NAME.test(widgetName) || normaliseName(widget?.type) === 'button') continue;
            const value = clonePinnableValue(widget?.value);
            if (value === null || value === '') continue;
            choices.push({
                key: `${node?.id ?? 'unknown'}:${widgetIndex}:${widgetName}`,
                nodeId: node?.id ?? null,
                nodeType: nodeType(node) || 'Unknown',
                nodeTitle: textValue(node?.title) || null,
                widgetName,
                value,
            });
            if (choices.length >= MAX_PARAMETER_CHOICES) return choices;
        }
    }
    return choices;
}

/**
 * Return editable/pinnable choices from an already saved recipe summary.
 * New summaries retain their original widget index; older recipes gracefully
 * fall back to the visible widget order.
 */
export function extractRecipeParameterChoicesFromMetadata(params, workflow = null) {
    const choices = [];
    const workflowNodes = new Map((workflow?.nodes || []).filter(Boolean).map((node) => [node.id, node]));
    for (const node of params?.nodes || []) {
        for (const [visibleIndex, widget] of (node?.widgets || []).entries()) {
            const widgetName = textValue(widget?.name) || `widget_${visibleIndex + 1}`;
            if (SENSITIVE_WIDGET_NAME.test(widgetName)) continue;
            const widgetIndex = Number.isInteger(widget?.index) ? widget.index : visibleIndex;
            const workflowValues = workflowNodes.get(node?.id)?.widgets_values;
            const fullValue = Array.isArray(workflowValues) && widgetIndex >= 0 && widgetIndex < workflowValues.length
                ? workflowValues[widgetIndex]
                : widget?.value;
            const value = clonePinnableValue(fullValue);
            if (value === null || value === '') continue;
            choices.push({
                key: `${node?.id ?? 'unknown'}:${widgetIndex}:${widgetName}`,
                nodeId: node?.id ?? null,
                nodeType: node?.type || 'Unknown',
                nodeTitle: node?.title || null,
                widgetName,
                widgetIndex,
                value,
            });
            if (choices.length >= MAX_PARAMETER_CHOICES) return choices;
        }
    }
    return choices;
}

function valuesMatch(left, right) {
    if (left === right) return true;
    try { return JSON.stringify(left) === JSON.stringify(right); } catch (error) { return false; }
}

function findSummaryWidget(params, change) {
    const node = (params?.nodes || []).find((item) => item?.id === change.nodeId);
    if (!node) return null;
    const widget = (node.widgets || []).find((item) => Number.isInteger(change.widgetIndex) && item.index === change.widgetIndex)
        || (node.widgets || []).find((item) => item.name === change.widgetName && valuesMatch(item.value, change.previousValue));
    return widget ? { node, widget } : null;
}

function syncCommonRecipeMetadata(params, change) {
    const type = normaliseName(change.nodeType);
    const widget = normaliseName(change.widgetName);
    const value = change.value;
    if (/^(checkpointloader(simple)?|unetloader)$/.test(type) && /^(ckpt_name|checkpoint|unet_name|unet|model_name)$/.test(widget)) {
        params.baseModel = textValue(value) || null;
        if (params.baseModel) params.baseModels = [params.baseModel, ...(params.baseModels || []).filter((item) => item !== params.baseModel)];
    }
    if (/lora.*loader|loader.*lora/.test(type)) {
        const loraIndex = (params.nodes || []).filter((item) => /lora.*loader|loader.*lora/i.test(item?.type || '')).findIndex((item) => item.id === change.nodeId);
        const lora = params.loras?.[loraIndex];
        if (lora) {
            if (/^(lora_name|lora|model_name)$/.test(widget)) lora.name = textValue(value);
            if (/^(strength_model|model_strength)$/.test(widget)) lora.strength_model = numberValue(value);
            if (/^(strength_clip|clip_strength)$/.test(widget)) lora.strength_clip = numberValue(value);
        }
    }
    if (/^ksampler(advanced)?$|samplercustom/.test(type)) {
        const field = { seed: 'seed', noise_seed: 'seed', steps: 'steps', cfg: 'cfg', cfg_scale: 'cfg', sampler_name: 'sampler_name', sampler: 'sampler_name', scheduler: 'scheduler', denoise: 'denoise' }[widget];
        if (field) params[field] = ['steps', 'cfg', 'denoise'].includes(field) ? numberValue(value) : value;
    }
    if (isSupportedPromptNodeType(type) && /^(text|prompt)$/.test(widget)) {
        const positive = Array.isArray(params.promptPositive) ? params.promptPositive : (params.promptPositive = []);
        const negative = Array.isArray(params.promptNegative) ? params.promptNegative : (params.promptNegative = []);
        const position = positive.findIndex((item) => item === change.previousValue);
        if (position >= 0) {
            positive[position] = textValue(value);
            return;
        }
        const negativePosition = negative.findIndex((item) => item === change.previousValue);
        if (negativePosition >= 0) {
            negative[negativePosition] = textValue(value);
            return;
        }
        const summary = (params.nodes || []).find((item) => String(item?.id) === String(change.nodeId));
        const override = params.promptRoleOverrides?.[String(change.nodeId)]?.role;
        const role = ['positive', 'negative', 'both'].includes(override) ? override : summary?.role;
        const prompt = textValue(value);
        if (!prompt) return;
        if ((role === 'positive' || role === 'both') && !positive.includes(prompt)) positive.push(prompt);
        if ((role === 'negative' || role === 'both') && !negative.includes(prompt)) negative.push(prompt);
    }
}

/**
 * Apply direct safe-widget edits to a serialized recipe without instantiating
 * its graph. Unknown nodes stay opaque; only known widget slots are touched.
 */
export function applyRecipeWidgetChanges(params, workflow, changes) {
    for (const change of changes || []) {
        const found = findSummaryWidget(params, change);
        if (!found) continue;
        const { widget } = found;
        const workflowNode = (workflow?.nodes || []).find((node) => node?.id === change.nodeId);
        let widgetIndex = Number.isInteger(change.widgetIndex) ? change.widgetIndex : widget.index;
        if (!Number.isInteger(widgetIndex) && Array.isArray(workflowNode?.widgets_values)) {
            widgetIndex = workflowNode.widgets_values.findIndex((value) => valuesMatch(value, change.previousValue));
        }
        if (!Number.isInteger(widgetIndex) || widgetIndex < 0 || !Array.isArray(workflowNode?.widgets_values)) continue;
        widget.value = change.value;
        widget.index = widgetIndex;
        workflowNode.widgets_values[widgetIndex] = change.value;
        syncCommonRecipeMetadata(params, change);
    }
    return { params, workflow };
}

function buildNodeIndex(graph) {
    return new Map((graph?._nodes || []).filter(Boolean).map((node) => [String(node.id), node]));
}

function linkOriginId(link) {
    if (Array.isArray(link)) return link[1];
    return link?.origin_id;
}

function findLink(graph, linkId) {
    if (linkId === null || linkId === undefined) return null;
    const links = graph?.links;
    if (Array.isArray(links)) return links.find((link) => Array.isArray(link) && link[0] === linkId) || null;
    if (links instanceof Map) return links.get(linkId) || links.get(String(linkId)) || null;
    return links?.[linkId] || null;
}

function inputLinkOrigins(graph, node, inputNames) {
    const wanted = new Set(inputNames.map(normaliseName));
    const origins = [];
    for (const input of node?.inputs || []) {
        if (!wanted.has(normaliseName(input?.name)) || input?.link === null || input?.link === undefined) continue;
        const origin = linkOriginId(findLink(graph, input.link));
        if (origin !== null && origin !== undefined && !origins.includes(origin)) origins.push(origin);
    }
    return origins;
}

function collectConditioningNodes(graph, startNodeId, nodeIndex) {
    const queue = [startNodeId];
    const visited = new Set();
    const clipNodes = [];

    while (queue.length && visited.size < MAX_UPSTREAM_NODES) {
        const nodeId = queue.shift();
        if (nodeId === null || nodeId === undefined || visited.has(nodeId)) continue;
        visited.add(nodeId);
        const node = nodeIndex.get(String(nodeId));
        if (!node) continue;

        if (isSupportedPromptNodeType(nodeType(node))) {
            if (!clipNodes.includes(node)) clipNodes.push(node);
            continue;
        }

        // Unknown third-party conditioning nodes are deliberately opaque.
        // Users can label their text nodes manually in the recipe detail view.
        if (!SUPPORTED_CONDITIONING_PASSTHROUGH.has(normaliseName(nodeType(node)))) continue;

        for (const input of node.inputs || []) {
            const inputType = normaliseName(input?.type);
            const inputName = normaliseName(input?.name);
            if (inputType !== 'conditioning' && !inputName.includes('conditioning')) continue;
            const originId = linkOriginId(findLink(graph, input?.link));
            if (originId !== null && originId !== undefined && !visited.has(originId)) {
                queue.push(originId);
            }
        }
    }
    return clipNodes;
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
    const positiveNodes = [];
    const negativeNodes = [];

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
        }

        const roleInputs = SUPPORTED_PROMPT_CONSUMERS.get(normaliseName(type));
        if (roleInputs) {
            for (const [inputName, role] of Object.entries(roleInputs)) {
                for (const origin of inputLinkOrigins(graph, node, [inputName])) {
                    const clips = collectConditioningNodes(graph, origin, nodeIndex);
                    const target = role === 'negative' ? negativeNodes : positiveNodes;
                    for (const clip of clips) if (!target.includes(clip)) target.push(clip);
                }
            }
        }

        if (/empty.*latent/i.test(type) && !metadata.resolution) {
            const width = numberValue(widgetValue(node, ['width'], 0));
            const height = numberValue(widgetValue(node, ['height'], 1));
            if (width && height) metadata.resolution = { width, height };
        }
    }

    for (const summary of metadata.nodes) {
        if (!isSupportedPromptNodeType(summary.type)) continue;
        const node = nodeIndex.get(String(summary.id));
        const prompt = textValue(widgetValue(node, ['text', 'prompt'], 0));
        const isPositive = positiveNodes.includes(node);
        const isNegative = negativeNodes.includes(node);

        if (isPositive && isNegative) {
            summary.role = 'both';
            summary.roleSource = 'topology';
            if (prompt) {
                appendUnique(metadata.promptPositive, [prompt]);
                appendUnique(metadata.promptNegative, [prompt]);
            }
        } else if (isPositive) {
            summary.role = 'positive';
            summary.roleSource = 'topology';
            if (prompt) appendUnique(metadata.promptPositive, [prompt]);
        } else if (isNegative) {
            summary.role = 'negative';
            summary.roleSource = 'topology';
            if (prompt) appendUnique(metadata.promptNegative, [prompt]);
        } else {
            summary.role = 'unknown';
            summary.roleSource = 'unresolved';
        }
    }
    return metadata;
}

/**
 * Capture the graph once at save time. The serialized workflow is the source
 * of truth; metadata is only a bounded presentation layer.
 */
export function captureRecipeDraft(graph) {
    const workflow = graph?.serialize?.();
    const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
    const links = Array.isArray(workflow?.links)
        ? workflow.links
        : (workflow?.links && typeof workflow.links === 'object' ? Object.values(workflow.links) : []);
    return {
        workflow,
        metadata: extractRecipeMetadata(graph),
        stats: {
            nodeCount: nodes.length,
            linkCount: links.length,
            groupCount: Array.isArray(workflow?.groups) ? workflow.groups.length : 0,
        },
    };
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
