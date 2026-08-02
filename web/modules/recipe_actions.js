import { api } from '../../../scripts/api.js';
import { app } from '../../../scripts/app.js';
import { applyRecipeWidgetChanges } from './recipe_parser.js';

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function nodeType(node) {
    return String(node?.type || node?.class_type || '').trim();
}

function savedNodeRecords(workflow) {
    return Array.isArray(workflow?.nodes) ? workflow.nodes.filter((node) => node && node.id !== undefined) : [];
}

function linkRecords(workflow) {
    if (Array.isArray(workflow?.links)) return workflow.links.filter(Array.isArray);
    if (workflow?.links && typeof workflow.links === 'object') return Object.values(workflow.links).filter(Boolean);
    return [];
}

function graphNode(graph, id) {
    return graph?.getNodeById?.(id)
        || graph?._nodes?.find((node) => String(node?.id) === String(id))
        || null;
}

function nextNodeId(graph, usedIds) {
    let max = 0;
    for (const node of graph?._nodes || []) max = Math.max(max, Number(node?.id) || 0);
    for (const id of usedIds) max = Math.max(max, Number(id) || 0);
    return max + 1;
}

function liveBounds(graph) {
    const nodes = (graph?._nodes || []).filter(Boolean);
    if (!nodes.length) return null;
    return nodes.reduce((bounds, node) => {
        const x = Number(node.pos?.[0]) || 0;
        const y = Number(node.pos?.[1]) || 0;
        const width = Number(node.size?.[0]) || 220;
        const height = Number(node.size?.[1]) || 120;
        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x + width);
        bounds.maxY = Math.max(bounds.maxY, y + height);
        return bounds;
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function savedBounds(nodes) {
    if (!nodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return nodes.reduce((bounds, node) => {
        const x = Number(node.pos?.[0]) || 0;
        const y = Number(node.pos?.[1]) || 0;
        const width = Number(node.size?.[0]) || 220;
        const height = Number(node.size?.[1]) || 120;
        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x + width);
        bounds.maxY = Math.max(bounds.maxY, y + height);
        return bounds;
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function instantiateNode(nodeData) {
    const type = nodeType(nodeData);
    const creator = globalThis.LiteGraph?.createNode;
    if (typeof creator !== 'function' || !type) return null;
    const node = creator.call(globalThis.LiteGraph, type);
    if (!node) return null;
    node.configure?.(cloneJson(nodeData));
    return node;
}

function connectLink(link, idMap, graph) {
    if (!Array.isArray(link) || link.length < 5) return false;
    const origin = graphNode(graph, idMap.get(String(link[1])));
    const target = graphNode(graph, idMap.get(String(link[3])));
    if (!origin || !target) return false;
    const result = origin.connect?.(Number(link[2]), target, Number(link[4]));
    return Boolean(result);
}

/** Merge one serialized workflow into the live graph as one rollback-able action. */
export function appendRecipeToCanvas(recipe) {
    const graph = app.graph;
    const savedNodes = savedNodeRecords(recipe?.workflow);
    const savedLinks = linkRecords(recipe?.workflow);
    if (!graph || !savedNodes.length) throw new Error('recipe_append_empty');
    if (typeof globalThis.LiteGraph?.createNode !== 'function') throw new Error('recipe_append_unsupported');

    const idMap = new Map();
    const inserted = [];
    const existingIds = new Set((graph._nodes || []).map((node) => String(node?.id)));
    let id = nextNodeId(graph, savedNodes.map((node) => node.id));
    const sourceBounds = savedBounds(savedNodes);
    const targetBounds = liveBounds(graph);
    const offsetX = targetBounds ? targetBounds.maxX + 140 - sourceBounds.minX : 40 - sourceBounds.minX;
    const offsetY = targetBounds ? targetBounds.minY - sourceBounds.minY : 40 - sourceBounds.minY;

    graph.beforeChange?.();
    try {
        for (const nodeData of savedNodes) {
            const node = instantiateNode(nodeData);
            if (!node) {
                const error = new Error(`Missing node type: ${nodeType(nodeData)}`);
                error.code = 'recipe_append_missing_node';
                throw error;
            }
            while (existingIds.has(String(id))) id += 1;
            const oldId = String(nodeData.id);
            idMap.set(oldId, id);
            node.id = id;
            existingIds.add(String(id));
            const x = Number(nodeData.pos?.[0]) || 0;
            const y = Number(nodeData.pos?.[1]) || 0;
            node.pos = [x + offsetX, y + offsetY];
            graph.add(node);
            inserted.push(node);
            id += 1;
        }

        for (const link of savedLinks) {
            if (!connectLink(link, idMap, graph)) {
                const error = new Error('Invalid link in recipe');
                error.code = 'recipe_append_invalid_link';
                throw error;
            }
        }
        graph.change?.();
        graph.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        app.canvas?.selectNodes?.(inserted);
        app.canvas?.selectItems?.(inserted);
        return { nodes: inserted.length, links: savedLinks.length };
    } catch (error) {
        for (const node of inserted) graph.remove?.(node);
        graph.change?.();
        graph.setDirtyCanvas?.(true, true);
        throw error;
    } finally {
        graph.afterChange?.();
    }
}

function missingNodeTypes(recipe) {
    const registry = globalThis.LiteGraph?.registered_node_types;
    if (!registry) return [];
    return [...new Set(savedNodeRecords(recipe?.workflow)
        .map((node) => nodeType(node))
        .filter((type) => type && !registry[type]))];
}

function primitive(value) {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function validateOverrides(recipe, changes) {
    const pinned = new Map((recipe?.params?.pinned || []).map((item) => [item?.key, item]));
    for (const change of changes || []) {
        const allowed = pinned.get(change?.key);
        if (!allowed || !primitive(change.value) || !primitive(allowed.value)) throw new Error('recipe_quick_queue_invalid_override');
        if (typeof change.value !== typeof allowed.value && !(typeof change.value === 'number' && typeof allowed.value === 'number')) {
            throw new Error('recipe_quick_queue_invalid_override');
        }
    }
}

/** Convert a cloned workflow through the host's normal API-prompt path. */
export async function buildRecipePrompt(recipe, changes = []) {
    const missing = missingNodeTypes(recipe);
    if (missing.length) {
        const error = new Error(`Missing node types: ${missing.slice(0, 12).join(', ')}`);
        error.code = 'recipe_quick_queue_missing_nodes';
        throw error;
    }
    validateOverrides(recipe, changes);
    if (typeof app.graphToPrompt !== 'function') throw new Error('recipe_quick_queue_unsupported');
    const workflow = cloneJson(recipe.workflow);
    const params = cloneJson(recipe.params || {});
    applyRecipeWidgetChanges(params, workflow, changes);
    const GraphClass = globalThis.LiteGraph?.LGraph || app.graph?.constructor;
    if (typeof GraphClass !== 'function') throw new Error('recipe_quick_queue_unsupported');
    const temporaryGraph = new GraphClass();
    try {
        temporaryGraph.configure(workflow);
        const prompt = await app.graphToPrompt(temporaryGraph);
        if (!prompt || typeof prompt !== 'object' || !Object.keys(prompt).length) throw new Error('recipe_quick_queue_empty_prompt');
        return prompt;
    } finally {
        temporaryGraph.clear?.();
    }
}

/** Queue an ephemeral recipe prompt without loading or modifying the current canvas. */
export async function quickQueueRecipe(recipe, changes = []) {
    const prompt = await buildRecipePrompt(recipe, changes);
    if (typeof api?.queuePrompt !== 'function') throw new Error('recipe_quick_queue_unsupported');
    return api.queuePrompt(0, prompt, { trigger_source: 'anomalous_recipe' });
}
