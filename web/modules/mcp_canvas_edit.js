/**
 * The page side of the MCP tools that build a workflow (api/mcp_canvas_edit.py): add a node,
 * wire an output to an input, set a node's values, remove nodes, and open a new workflow tab,
 * blank or built from a workflow in ComfyUI's API form. Each runs through mcp_bridge.js's
 * `recorded`, so it is one Ctrl+Z step, lands in the activity log as the AI's and shows under
 * its step in the AI workbench. Everything is checked before the canvas changes; answers give
 * the node ids, inputs and outputs the next call needs. canvas_build.js does the arithmetic.
 */

import { app } from '../../../scripts/app.js';
import { recordCanvasStep } from './canvas_history.js';
import { apiLinks, freeSpot, layered, typesFit, valuePlan } from './canvas_build.js';
import { translate as t } from './locales.js';
import { setWidgetValue } from './ui_node_model_picker.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';

const BLANK = { last_node_id: 0, last_link_id: 0, nodes: [], links: [], groups: [], config: {}, extra: {}, version: 0.4 };

const linkOf = (g, id) => g.getLink?.(id) ?? g.links?.get?.(id) ?? g.links?.[id] ?? null;
const sockets = node => (node.inputs || []).filter(input => !input.widget);

/** A node as the AI wires it: its inputs (with what feeds them), outputs and settings. */
function shape(g, node) {
    const settings = {};
    for (const widget of node.widgets || []) {
        if (!widget?.name || widget.type === 'button') continue;
        settings[widget.name] = typeof widget.value === 'string' ? widget.value.slice(0, 200) : widget.value;
    }
    return {
        node_id: node.id, type: node.type, title: node.title,
        inputs: sockets(node).map(input => ({
            name: input.name, type: String(input.type), ...(input.link != null ? { from_node: linkOf(g, input.link)?.origin_id } : {}),
        })),
        outputs: (node.outputs || []).map((output, slot) => ({ slot, name: output.name, type: String(output.type) })),
        settings,
    };
}

function newNode(type) {
    if (!LiteGraph.registered_node_types?.[type]) throw new Error(`ComfyUI has no node type ${type}; find_nodes looks them up.`);
    const node = LiteGraph.createNode(type);
    if (!node) throw new Error(`ComfyUI could not make a ${type} node.`);
    return node;
}

/** Writes checked values the way the user would, so ComfyUI and other extensions notice. */
function apply(node, plan) {
    for (const [widget, value] of plan) {
        const old = widget.value;
        setWidgetValue(node, widget, value);
        widget.callback?.(value, app.canvas, node, app.canvas?.graph_mouse, null);
        node.onWidgetChanged?.(widget.name, value, old, widget);
    }
}

function outputSlot(node, output) {
    const outputs = node.outputs || [];
    if (Number.isInteger(output) && outputs[output]) return output;
    const name = String(output ?? '').toLowerCase();
    let slot = outputs.findIndex(item => String(item.name).toLowerCase() === name);
    if (slot < 0) {
        const typed = outputs.flatMap((item, index) => (String(item.type).toLowerCase() === name ? [index] : []));
        slot = typed.length === 1 ? typed[0] : -1;
    }
    if (slot < 0) throw new Error(`Node ${node.id} (${node.type}) has no output ${output}; it has: ${outputs.map((item, i) => `${i} ${item.name}`).join(', ') || 'none'}.`);
    return slot;
}

function inputSlot(node, input) {
    const slot = (node.inputs || []).findIndex(item => item.name === input);
    if (slot < 0) throw new Error(`Node ${node.id} (${node.type}) has no input ${input}; it has: ${sockets(node).map(item => item.name).join(', ') || 'none'}.`);
    return slot;
}

/** Whether `node` is fed, through any number of nodes, by node `id`. */
function fedBy(g, node, id, seen = new Set()) {
    for (const input of node.inputs || []) {
        const origin = input.link != null ? linkOf(g, input.link)?.origin_id : null;
        if (origin == null || seen.has(String(origin))) continue;
        if (String(origin) === String(id)) return true;
        seen.add(String(origin));
        const upstream = g.getNodeById?.(origin);
        if (upstream && fedBy(g, upstream, id, seen)) return true;
    }
    return false;
}

function wire(g, from, slot, to, target) {
    if (from === to || fedBy(g, from, to.id)) {
        throw new Error(`Node ${to.id} already feeds node ${from.id}; wiring it back would make a loop ComfyUI cannot run.`);
    }
    const given = from.outputs[slot].type;
    const wanted = to.inputs[target].type;
    if (!typesFit(given, wanted)) {
        throw new Error(`Output ${from.outputs[slot].name} of node ${from.id} gives ${given}; input ${to.inputs[target].name} of node ${to.id} takes ${wanted}.`);
    }
    if (!from.connect(slot, to, target)) throw new Error(`ComfyUI refused to wire node ${from.id} to node ${to.id}.`);
}

/** A new tab's name: the AI's words and the time, so it never opens a saved workflow of that name. */
function tabName(name) {
    const words = String(name || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'AI workflow';
    const now = new Date();
    return `${words} ${[now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join('')}`;
}

/** The nodes of an API-form workflow, made and checked off the canvas: {key: node}, plans and links. */
function prepare(nodes) {
    const made = {};
    const plans = {};
    const links = apiLinks(nodes);
    for (const [key, spec] of Object.entries(nodes)) {
        const node = newNode(String(spec?.class_type || ''));
        if (spec?._meta?.title) node.title = String(spec._meta.title).slice(0, 120);
        const values = Object.fromEntries(Object.entries(spec?.inputs || {}).filter(([, value]) => !Array.isArray(value)));
        try {
            plans[key] = valuePlan(node, values);
        } catch (error) {
            throw new Error(`Node ${key}: ${error.message}`);
        }
        made[key] = node;
    }
    for (const link of links) {
        const from = made[link.from];
        const to = made[link.to];
        if (!from.outputs?.[link.slot]) throw new Error(`Node ${link.from} (${from.type}) has no output ${link.slot}.`);
        const target = (to.inputs || []).findIndex(item => item.name === link.input);
        if (target < 0) throw new Error(`Node ${link.to} (${to.type}) has no input ${link.input}.`);
        if (!typesFit(from.outputs[link.slot].type, to.inputs[target].type)) {
            throw new Error(`Node ${link.from}'s output ${link.slot} (${from.outputs[link.slot].type}) cannot feed ${link.input} of node ${link.to} (${to.inputs[target].type}).`);
        }
    }
    return { made, plans, links };
}

/** The canvas-building actions, given mcp_bridge.js's own helpers. */
export function canvasEditActions({ recorded, nodeById }) {
    function addNode({ type, title, values, near_node_id: nearId }, getOwner) {
        return recorded(getOwner, 'mcpDidNode', (g) => {
            const node = newNode(String(type));
            if (title) node.title = String(title).slice(0, 120);
            const plan = valuePlan(node, values);
            const near = nearId != null ? nodeById(nearId) : null;
            g.beforeChange?.();
            node.pos = freeSpot(node, (g._nodes || []), near);
            g.add(node);
            apply(node, plan);
            g.afterChange?.();
            g.setDirtyCanvas?.(true, true);
            recordCanvasStep(app);
            return { ...shape(g, node), toast: { name: node.title || node.type } };
        });
    }

    function connectNodes({ from_node_id: fromId, output, to_node_id: toId, input }, getOwner) {
        return recorded(getOwner, 'mcpDidWire', (g) => {
            const from = nodeById(fromId);
            const to = nodeById(toId);
            const slot = outputSlot(from, output);
            const target = inputSlot(to, input);
            const was = to.inputs[target].link != null ? linkOf(g, to.inputs[target].link)?.origin_id : null;
            g.beforeChange?.();
            try {
                wire(g, from, slot, to, target);
            } finally {
                g.afterChange?.();
            }
            g.setDirtyCanvas?.(true, true);
            recordCanvasStep(app);
            return {
                from_node: from.id, output: from.outputs[slot].name, to_node: to.id, input: to.inputs[target].name,
                ...(was != null && was !== from.id ? { replaced_link_from: was } : {}),
                toast: { from: from.title || from.type, to: to.title || to.type },
            };
        });
    }

    function setValues({ node_id: nodeId, values }, getOwner) {
        return recorded(getOwner, 'mcpDidValues', (g) => {
            const node = nodeById(nodeId);
            const plan = valuePlan(node, values);
            if (!plan.length) throw new Error('values is empty: {setting name: value}.');
            g.beforeChange?.(node);
            apply(node, plan);
            g.afterChange?.(node);
            if (app.lastNodeErrors?.[node.id]) delete app.lastNodeErrors[node.id];
            g.setDirtyCanvas?.(true, true);
            recordCanvasStep(app);
            return { node_id: node.id, set: Object.fromEntries(plan.map(([widget]) => [widget.name, widget.value])), toast: { count: plan.length } };
        });
    }

    function removeNodes({ node_ids: ids }, getOwner) {
        return recorded(getOwner, 'mcpDidRemove', (g) => {
            const nodes = [...new Set(ids)].map(nodeById);
            g.beforeChange?.();
            for (const node of nodes) g.remove(node);
            g.afterChange?.();
            g.setDirtyCanvas?.(true, true);
            recordCanvasStep(app);
            return { removed: nodes.map(node => ({ node_id: node.id, type: node.type })), toast: { count: nodes.length } };
        });
    }

    async function newWorkflow({ name, nodes }, getOwner) {
        const built = nodes ? prepare(nodes) : null; // nothing opens unless all of it fits
        const tab = tabName(name);
        getOwner()?.flushCanvasActivity?.(); // what was pending belongs to the tab being left
        await app.loadGraphData(structuredClone(BLANK), true, true, tab);
        if (!built) {
            showWorkbenchToast(t('mcpDidWorkflow', { name: tab }));
            return { opened: tab, nodes: {}, note: 'A blank workflow tab; add_node and connect_nodes build it.' };
        }
        return recorded(getOwner, 'mcpDidWorkflow', (g) => {
            const spots = layered(built.made, built.links);
            g.beforeChange?.();
            for (const [key, node] of Object.entries(built.made)) {
                node.pos = spots[key];
                g.add(node);
                apply(node, built.plans[key]);
            }
            for (const link of built.links) {
                const to = built.made[link.to];
                wire(g, built.made[link.from], link.slot, to, inputSlot(to, link.input));
            }
            g.afterChange?.();
            g.setDirtyCanvas?.(true, true);
            recordCanvasStep(app);
            return { opened: tab, nodes: Object.fromEntries(Object.entries(built.made).map(([key, node]) => [key, node.id])), toast: { name: tab } };
        });
    }

    /** One of the user's saved workflows (a recipe), in a new tab named after it; the open one stays. */
    async function openWorkflow({ filename, name }, getOwner) {
        const response = await fetch(`/anomalous/recipe_full?filename=${encodeURIComponent(filename || '')}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.data?.workflow) throw new Error(`The saved workflow ${name} could not be read.`);
        const tab = tabName(name);
        getOwner()?.flushCanvasActivity?.();
        await app.loadGraphData(structuredClone(payload.data.workflow), true, true, tab);
        showWorkbenchToast(t('mcpDidOpenWorkflow', { name }));
        const g = app.canvas?.graph || app.graph;
        return { opened: tab, node_count: (g?._nodes || []).length, note: 'describe_canvas shows its nodes; add_node, connect_nodes and set_values change it.' };
    }

    return {
        add_node: addNode, connect_nodes: connectNodes, set_values: setValues, remove_nodes: removeNodes,
        new_workflow: newWorkflow, open_workflow: openWorkflow,
    };
}
