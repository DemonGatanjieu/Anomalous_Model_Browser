/**
 * Tells the run record (api/usage_ledger.py) which nodes and models a workflow holds when it is
 * opened, and which the open tabs hold just before a Tidy check: a workflow opened, or a node put
 * on the canvas, counts as use even when it is never run. One post per distinct workflow content
 * and page load.
 */

import { app } from "../../../scripts/app.js";

const MODEL_FILE = /\.(safetensors|ckpt|pt|pth|bin|sft|gguf)$/i;
const posted = new Set();

/** { types, models } a workflow (ComfyUI's saved form) holds, its subgraphs' nodes included. */
export function workflowUses(workflow) {
    const types = new Set();
    const models = new Set();
    const subgraphs = workflow?.definitions?.subgraphs || [];
    const subgraphIds = new Set(subgraphs.map(graph => graph?.id));
    for (const graph of [workflow, ...subgraphs]) {
        for (const node of graph?.nodes || []) {
            if (typeof node?.type === 'string' && node.type && !subgraphIds.has(node.type)) types.add(node.type);
            const stack = [node?.widgets_values];
            while (stack.length) {
                const value = stack.pop();
                if (typeof value === 'string') {
                    if (MODEL_FILE.test(value.trim())) models.add(value.replace(/\\/g, '/').trim().toLowerCase());
                } else if (value && typeof value === 'object') {
                    stack.push(...Object.values(value));
                }
            }
        }
    }
    return { types: [...types].sort(), models: [...models].sort() };
}

async function note(workflow) {
    const uses = workflowUses(workflow);
    const body = JSON.stringify(uses);
    if ((!uses.types.length && !uses.models.length) || posted.has(body)) return;
    posted.add(body);
    try {
        const response = await fetch('/anomalous/usage/opened', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (!response.ok) posted.delete(body); // another device looking on: nothing is noted from there
    } catch (error) {
        posted.delete(body);
        console.warn('[AMB] Could not note the opened workflow.', error);
    }
}

/** Notes every workflow ComfyUI opens (the one restored at startup too). */
export function watchOpenedWorkflows() {
    const load = app.loadGraphData;
    if (typeof load !== 'function') return;
    app.loadGraphData = async function (...args) {
        const result = await load.apply(this, args);
        note(app.graph?.serialize?.());
        return result;
    };
}

/** Notes what the open tabs hold now (the canvas as it is, nodes put on it included). */
export async function noteOpenWorkflows() {
    const tabs = app.extensionManager?.workflow?.openWorkflows || [];
    await Promise.all([app.graph?.serialize?.(), ...tabs.map(tab => tab?.activeState)].filter(Boolean).map(note));
}
