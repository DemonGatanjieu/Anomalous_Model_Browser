import { nodeType, normaliseName, textValue, widgetValue } from './recipe_widgets.js';

const MAX_HOPS = 8;
const REROUTES = new Set(['reroute', 'reroute (rgthree)', 'rerouteprimitive']);
const NON_STATIC_TYPE = /wildcard|random|dynamic|concat|combine|join|merge|replace|regex|format|template|llm|gpt|ollama|gemini|claude|openai|translate|load|file|csv|list|switch|select|index|batch|split|tagger|wd14|florence|joycaption|clip|ksampler|lora|checkpoint|vae/i;

const ports = (node, key) => Array.isArray(node?.[key]) ? node[key] : [];

function textLink(node) {
    const inputs = ports(node, 'inputs');
    const named = inputs.find(port => normaliseName(port?.name) === 'text');
    if (named) return named.link;
    const strings = inputs.filter(port => normaliseName(port?.type) === 'string');
    return strings.length === 1 ? strings[0].link : null;
}

export function hasLinkedPromptText(node) {
    return textLink(node) != null;
}

export function promptNodeIndex(nodes) {
    return new Map((nodes || []).filter(node => node?.id != null).map(node => [String(node.id), node]));
}

function findLink(links, linkId) {
    if (Array.isArray(links)) {
        return links.find(link => String(Array.isArray(link) ? link[0] : link?.id) === String(linkId));
    }
    if (links instanceof Map) return links.get(linkId) ?? links.get(String(linkId));
    return links?.[linkId];
}

function sourceText(source, live) {
    if (!live) {
        const widgets = source.widgets_values;
        return Array.isArray(widgets) && widgets.length === 1 ? textValue(widgets[0]) : '';
    }
    const widgets = ports(source, 'widgets').filter(widget =>
        widget && normaliseName(widget.type) !== 'button' && normaliseName(widget.name) !== 'control_after_generate'
    );
    if (widgets.length !== 1 || normaliseName(widgets[0].type) === 'combo') return '';
    return textValue(widgets[0].value);
}

function linkedText(links, node, linkId, nodeIndex, live = false) {
    const visited = new Set([String(node.id)]);
    for (let hop = 0; hop < MAX_HOPS; hop++) {
        if (typeof linkId !== 'string' && !Number.isInteger(linkId)) return '';
        const link = findLink(links, linkId);
        const [originId, originSlot] = Array.isArray(link) ? link.slice(1, 3) : [link?.origin_id, link?.origin_slot];
        if (originId == null || !Number.isInteger(originSlot) || originSlot < 0) return '';
        const key = String(originId);
        const source = nodeIndex.get(key);
        if (!source || visited.has(key) || source.mode === 2 || source.mode === 4) return '';
        visited.add(key);
        const inbound = ports(source, 'inputs').filter(port => port?.link != null);
        const type = normaliseName(nodeType(source));
        if (REROUTES.has(type)) {
            if (inbound.length !== 1) return '';
            linkId = inbound[0].link;
            continue;
        }
        if (!type || inbound.length || NON_STATIC_TYPE.test(type)) return '';
        const outputType = ports(source, 'outputs')[originSlot]?.type;
        if (outputType != null && !['string', '*'].includes(normaliseName(outputType))) return '';
        return sourceText(source, live);
    }
    return '';
}

function serverText(node, serverResolvedMap) {
    const key = String(node?.id);
    return serverResolvedMap && Object.hasOwn(serverResolvedMap, key) ? textValue(serverResolvedMap[key]) : '';
}

export function resolveWorkflowPromptText(workflow, node, nodeIndex = null, serverResolvedMap = null) {
    const linkId = textLink(node);
    const own = linkId == null ? ports(node, 'widgets_values').map(textValue).find(Boolean) : '';
    if (own) return own;
    return serverText(node, serverResolvedMap) || (linkId != null
        ? linkedText(workflow?.links, node, linkId, nodeIndex ?? promptNodeIndex(workflow?.nodes))
        : '');
}

export function resolveGraphPromptText(graph, node, nodeIndex = null, serverResolvedMap = null) {
    const linkId = textLink(node);
    if (linkId == null) return textValue(widgetValue(node, ['text', 'prompt'], 0)) || serverText(node, serverResolvedMap);
    return serverText(node, serverResolvedMap)
        || linkedText(graph?.links, node, linkId, nodeIndex ?? promptNodeIndex(graph?._nodes), true);
}
