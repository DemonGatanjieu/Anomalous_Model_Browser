/** Pure ordering and value helpers for the Workflow Recipe parameter view. */

import { translate } from './locales.js';

const t = (key, params) => translate(key, params);

export function topologicalSortNodes(workflowNodes, workflowLinks) {
    const inDegree = new Map();
    const adj = new Map();
    const allIds = new Set();
    
    for (const node of workflowNodes) {
        const id = String(node.id);
        allIds.add(id);
        inDegree.set(id, 0);
        adj.set(id, []);
    }
    
    const rawLinks = workflowLinks;
    const linksArray = Array.isArray(rawLinks) ? rawLinks : (rawLinks && typeof rawLinks === 'object' ? Object.values(rawLinks) : []);
    
    for (const link of linksArray) {
        if (!Array.isArray(link) || link.length < 4) continue;
        const originId = String(link[1]);
        const targetId = String(link[3]);
        if (allIds.has(originId) && allIds.has(targetId)) {
            adj.get(originId).push(targetId);
            inDegree.set(targetId, inDegree.get(targetId) + 1);
        }
    }
    
    const queue = [];
    for (const [id, deg] of inDegree.entries()) {
        if (deg === 0) queue.push(id);
    }
    
    const sorted = [];
    while (queue.length > 0) {
        const u = queue.shift();
        sorted.push(u);
        for (const v of adj.get(u)) {
            inDegree.set(v, inDegree.get(v) - 1);
            if (inDegree.get(v) === 0) queue.push(v);
        }
    }
    
    for (const id of allIds) {
        if (inDegree.get(id) > 0) sorted.push(id);
    }
    
    return sorted;
}

export function parameterNodeOrder(recipe) {
    const summaries = Array.isArray(recipe?.params?.nodes) ? recipe.params.nodes : [];
    const workflowNodes = Array.isArray(recipe?.workflow?.nodes) ? recipe.workflow.nodes : [];
    const byId = new Map(workflowNodes.map((node) => [String(node?.id), node]));
    const summaryById = new Map(summaries.map((node) => [String(node?.id), node]));
    const orderedIds = topologicalSortNodes(workflowNodes, recipe?.workflow?.links);
    const result = [];
    const seen = new Set();
    for (const id of orderedIds) {
        const summary = summaryById.get(id);
        const workflowNode = byId.get(id);
        if (summary || workflowNode) {
            result.push({ summary: summary || { id, type: workflowNode?.type, title: workflowNode?.title, widgets: [] }, workflowNode });
            seen.add(id);
        }
    }
    for (const summary of summaries) {
        const id = String(summary?.id);
        if (!seen.has(id)) result.push({ summary, workflowNode: byId.get(id) });
    }
    return result;
}

export function isVolatileParameter(node, widget, index) {
    const widgetName = String(widget?.name || '').toLowerCase();
    if (/(^|[_\s-])(seed|noise_seed|random_seed|variation_seed|last_seed)([_\s-]|$)/i.test(widgetName)) return true;
    const nodeType = String(node?.type || '').toLowerCase();
    if (nodeType === 'ksampler') return index === 0;
    if (nodeType === 'ksampleradvanced') return index === 1;
    return false;
}

export function cloneJson(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return null; }
}

export function editorValueText(value) {
    if (typeof value === 'string') return value;
    if (value === undefined) return '';
    try { return JSON.stringify(value); } catch (error) { return String(value); }
}

export function parseEditorValue(raw, original) {
    if (typeof original === 'number') {
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new Error('invalid number');
        return value;
    }
    if (typeof original === 'boolean') {
        if (raw !== 'true' && raw !== 'false') throw new Error('invalid boolean');
        return raw === 'true';
    }
    if (original !== null && typeof original === 'object') return JSON.parse(raw);
    return raw;
}

export function promptRoleLabel(role) {
    return t({
        positive: 'recipePromptRolePositive',
        negative: 'recipePromptRoleNegative',
        both: 'recipePromptRoleBoth',
        ignored: 'recipePromptRoleIgnored',
        unknown: 'recipePromptRoleUnknown',
    }[role] || 'recipePromptRoleUnknown');
}

export function formatRecipeResolution(res) {
    if (!res) return '';
    if (typeof res === 'string' || typeof res === 'number') return String(res);
    if (Array.isArray(res) && res.length >= 2) return `${res[0]}x${res[1]}`;
    if (typeof res === 'object') {
        const w = res.width ?? res.w ?? res.x;
        const h = res.height ?? res.h ?? res.y;
        if (w && h) return `${w}x${h}`;
    }
    return '';
}

