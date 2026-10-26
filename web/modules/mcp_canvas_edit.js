/**
 * The page side of the MCP tools that build a workflow (api/mcp_canvas_edit.py): add a node or a
 * group of them, wire an output to an input, set a node's values, remove nodes, and open a new workflow tab,
 * blank or built from a workflow in ComfyUI's API form. Each runs through mcp_bridge.js's
 * `recorded`, so it is one Ctrl+Z step, lands in the activity log as the AI's and shows under
 * its step in the AI workbench. Everything is checked before the canvas changes; answers give
 * the node ids, inputs and outputs the next call needs, and the inputs still unwired with what
 * fits them (mcp_canvas_brief.js). canvas_build.js does the arithmetic. fill_slots puts
 * run_workflow's blanks in (mcp_fill.js), on a tab open_workflow opened from that saved workflow.
 */

import { app } from '../../../scripts/app.js';
import { recordCanvasStep } from './canvas_history.js';
import { apiLinks, freeSpot, layered, placedBlock, typesFit, valuePlan } from './canvas_build.js';
import { fedBy, linkOf, sockets, unwired } from './mcp_canvas_brief.js';
import { fillPlan, valuesPlan } from './mcp_fill.js';
import { translate as t } from './locales.js';
import { setWidgetValue } from './ui_node_model_picker.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { addWires, applyWires, groupWires, pairWires, reachesOutput, validateWires } from './canvas_wiring.js';
import { workflowKey } from './canvas_undo.js';
import { placeRoles } from './canvas_roles.js';

const BLANK = { last_node_id: 0, last_link_id: 0, nodes: [], links: [], groups: [], config: {}, extra: {}, version: 0.4 };

/** Socket details when a node was added without wiring; wired receipts already say what changed. */
function shape(g, node) {
    return {
        inputs: sockets(node).map(input => ({
            name: input.name, type: String(input.type), ...(input.link != null ? { from_node: linkOf(g, input.link)?.origin_id } : {}),
        })),
        outputs: (node.outputs || []).map((output, slot) => ({ slot, name: output.name, type: String(output.type) })),
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

function inputSlot(node, input) {
    const slot = (node.inputs || []).findIndex(item => item.name === input);
    if (slot < 0) throw new Error(`Node ${node.id} (${node.type}) has no input ${input}; it has: ${sockets(node).map(item => item.name).join(', ') || 'none'}.`);
    return slot;
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
export function tabName(name) {
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

/**
 * `make()` again after ComfyUI's lists were read anew, when a value was not among a drop-down's
 * choices: a file that has just appeared (a picture Anomalous put in the input folder to repaint).
 */
async function withFreshChoices(make) {
    try {
        return make();
    } catch (error) {
        if (!/has no choice/.test(error.message) || typeof app.refreshComboInNodes !== 'function') throw error;
        await app.refreshComboInNodes();
        return make();
    }
}

/** The canvas-building actions, given mcp_bridge.js's own helpers. */
export function canvasEditActions({ recorded, nodeById }) {
    function addNode({ type, title, values, near_node_id: nearId, replace = false, ...wiring }, getOwner) {
        return recorded(getOwner, 'mcpDidNode', async (g) => {
            const key = workflowKey(app), before = JSON.stringify(g.serialize());
            const { node, plan } = await withFreshChoices(() => {
                const made = newNode(String(type));
                return { node: made, plan: valuePlan(made, values) };
            });
            if ((app.canvas?.graph || app.graph) !== g || workflowKey(app) !== key || JSON.stringify(g.serialize()) !== before) {
                throw new Error('The canvas changed while preparing the node. Nothing added; read get_situation again.');
            }
            if (title) node.title = String(title).slice(0, 120);
            const nearBy = nearId ?? wiring.insert_after ?? wiring.wire_from?.[0] ?? wiring.wire_to?.[0];
            const near = nearBy != null ? nodeById(nearBy) : null;
            const wires = validateWires(g, addWires(g, node, wiring), replace);
            let connections;
            g.beforeChange?.();
            try {
                node.pos = freeSpot(node, (g._nodes || []), near);
                connections = applyWires(g, wires, node, () => apply(node, plan));
            } finally { g.afterChange?.(); }
            g.setDirtyCanvas?.(true, true);
            recordCanvasStep(app);
            return { node_id: node.id, type: node.type, connections, reaches_output: reachesOutput(g, node),
                ...unwired(g), ...(!connections.length ? shape(g, node) : {}),
                toast: { name: node.title || node.type } };
        });
    }

    /** A group of new nodes in API form, wired among themselves, to the canvas ("#12", or a block's roles: canvas_roles.js) and by wire_to, as one block and one Ctrl+Z step. */
    function addNodes({ nodes: asked, near_node_id: nearId, replace = false }, getOwner) {
        return recorded(getOwner, 'mcpDidNodes', async (g) => {
            const nodes = placeRoles(g, asked, nearId);
            const key = workflowKey(app), before = JSON.stringify(g.serialize());
            const built = await withFreshChoices(() => prepare(nodes));
            if ((app.canvas?.graph || app.graph) !== g || workflowKey(app) !== key || JSON.stringify(g.serialize()) !== before) {
                throw new Error('The canvas changed while preparing the nodes. Nothing added; read get_situation again.');
            }
            const wires = validateWires(g, groupWires(g, built.made, nodes), replace);
            const keyOf = new Map(Object.entries(built.made).map(([name, node]) => [node, name]));
            const inside = wires.filter(p => keyOf.has(p.from) && keyOf.has(p.to)).map(p => ({ from: keyOf.get(p.from), to: keyOf.get(p.to) }));
            const spots = placedBlock(built.made, inside, g._nodes || [], nearId != null ? nodeById(nearId) : null);
            const added = Object.values(built.made);
            let connections;
            g.beforeChange?.();
            try {
                for (const [name, node] of Object.entries(built.made)) node.pos = spots[name];
                connections = applyWires(g, wires, added, () => Object.entries(built.made).forEach(([name, node]) => apply(node, built.plans[name])));
            } finally { g.afterChange?.(); }
            g.setDirtyCanvas?.(true, true);
            recordCanvasStep(app);
            const spliced = connections.filter(link => link.replaced_from != null);
            return {
                nodes: Object.fromEntries(Object.entries(built.made).map(([name, node]) => [name, node.id])), wired: connections.length,
                ...(spliced.length ? { spliced } : {}), reaches_output: added.every(node => reachesOutput(g, node)),
                ...unwired(g), toast: { count: added.length },
            };
        });
    }

    function connectNodes({ from_node_id: fromId, output, to_node_id: toId, input, replace }, getOwner) {
        return recorded(getOwner, 'mcpDidWire', (g) => {
            const from = nodeById(fromId);
            const to = nodeById(toId);
            const plan = validateWires(g, pairWires(from, to, { output, input }), replace ?? (input != null && output != null));
            let connections;
            g.beforeChange?.();
            try {
                connections = applyWires(g, plan);
            } finally {
                g.afterChange?.();
            }
            g.setDirtyCanvas?.(true, true);
            recordCanvasStep(app);
            return {
                connections, reaches_output: reachesOutput(g, from),
                ...unwired(g), toast: { from: from.title || from.type, to: to.title || to.type },
            };
        });
    }

    /** One node's settings (node_id), or settings by name for whichever nodes have them (mcp_fill.js valuesPlan). */
    function setValues({ node_id: nodeId, values }, getOwner) {
        return recorded(getOwner, 'mcpDidValues', async (g) => {
            const plans = await withFreshChoices(() => (nodeId != null
                ? [{ node: nodeById(nodeId), plan: valuePlan(nodeById(nodeId), values) }] : valuesPlan(g, values)));
            const count = plans.reduce((sum, { plan }) => sum + plan.length, 0);
            if (!count) throw new Error('values is empty: {setting name: value}.');
            g.beforeChange?.();
            for (const { node, plan } of plans) {
                apply(node, plan);
                if (app.lastNodeErrors?.[node.id]) delete app.lastNodeErrors[node.id];
            }
            g.afterChange?.();
            g.setDirtyCanvas?.(true, true);
            recordCanvasStep(app);
            return {
                set: Object.fromEntries(plans.map(({ node, plan }) => [node.id, Object.fromEntries(plan.map(([widget]) => [widget.name, widget.value]))])),
                toast: { count },
            };
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
            return { removed: nodes.map(node => ({ node_id: node.id, type: node.type })), ...unwired(g), toast: { count: nodes.length } };
        });
    }

    async function newWorkflow({ name, nodes }, getOwner) {
        const built = nodes ? await withFreshChoices(() => prepare(nodes)) : null; // nothing opens unless all of it fits
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
        if (g) g.extra = { ...(g.extra || {}), anomalous_saved: filename }; // run_workflow with this workflow reuses the tab
        return { opened: tab, node_count: (g?._nodes || []).length, note: 'describe_canvas shows its nodes; add_node, connect_nodes and set_values change it.' };
    }

    /** run_workflow's blanks (api/mcp_fill.py); `needs_open` when the canvas is not saved workflow `filename`. */
    async function fillSlots({ filename, ...wanted }, getOwner) {
        const g = app.canvas?.graph || app.graph;
        if (!g) throw new Error('No workflow is open in ComfyUI.');
        if (filename && g.extra?.anomalous_saved !== filename) return { needs_open: true };
        const { plans, set } = await withFreshChoices(() => fillPlan(g, wanted));
        if (!plans.length) return { set };
        return recorded(getOwner, 'mcpDidFill', (graph) => {
            graph.beforeChange?.();
            for (const { node, plan } of plans) apply(node, plan);
            graph.afterChange?.();
            graph.setDirtyCanvas?.(true, true);
            recordCanvasStep(app);
            return { set, toast: { count: plans.length } };
        });
    }

    return {
        add_node: addNode, add_nodes: addNodes, connect_nodes: connectNodes, set_values: setValues, remove_nodes: removeNodes,
        new_workflow: newWorkflow, open_workflow: openWorkflow, fill_slots: fillSlots,
    };
}
