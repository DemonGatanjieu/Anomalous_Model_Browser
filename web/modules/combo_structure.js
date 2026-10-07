/**
 * A combo's node structure (搭配的节点结构): the nodes picked on the canvas and the links between
 * them, with the boxes a combo fills in (slots). No DOM.
 *
 * Every picked node is kept but a subgraph (a graph of its own, left out with its links). Every
 * box of a kept node is stored by its name, not its position, and put back untouched; the slots
 * are its model drop-downs (a drop-down listing model files) and text boxes (a multiline text box
 * by its own definition, prompt_boxes.js), one node may hold several, each model slot with the
 * models folder its drop-down lists (not guessed from names). A box fed by a link is no slot, and
 * a node without slots is put back exactly as saved. A link coming in from a node that was not
 * picked cannot be kept; its input is remembered (`open`) to say it needs wiring. Putting a
 * structure back makes the nodes first, restores the other boxes in their order (a count box adds
 * its rows), then fills the slots by name, then links; whatever cannot be found is reported,
 * never guessed.
 *
 * A combo with a structure: data = { kind: 'nodes', structure: { version, nodes, links, slots,
 * open: [{ node, name, type }] }, values: { slotId: value }, covers: { slotId: url } }.
 */

import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';
import { promptBoxes } from './prompt_boxes.js';
import {
    NONE, STRUCTURE_VERSION, chainOrder, findPort, folderFor, fedByLink, isModelWidget, missingTypes, optionValues, packOf, slashes,
} from './combo_slots.js';

let folderLists = null;

/** ComfyUI's model folders and their files (GET /models, /models/<folder>), read once per page. */
async function loadFolderLists() {
    if (folderLists) return folderLists;
    const names = await (await api.fetchApi('/models')).json();
    const lists = new Map();
    await Promise.all((Array.isArray(names) ? names : []).map(async (name) => {
        try {
            const files = await (await api.fetchApi(`/models/${encodeURIComponent(name)}`)).json();
            if (Array.isArray(files)) lists.set(name, new Set(files.map(slashes)));
        } catch { /* a folder that cannot be listed fits nothing */ }
    }));
    folderLists = lists;
    return lists;
}

const storable = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

/**
 * The structure of the picked canvas nodes: { structure, values, dropped } — `dropped` the
 * picked subgraphs. Null structure when nothing else was picked.
 */
export async function captureStructure(picked, { labelFor } = {}) {
    const lists = await loadFolderLists();
    const kept = [];
    const dropped = [];
    for (const node of picked) {
        if (node.isSubgraphNode?.()) dropped.push(node);
        else kept.push({ node, models: (node.widgets || []).filter(isModelWidget), texts: promptBoxes(node) });
    }
    if (!kept.length) return { structure: null, values: {}, dropped };
    const graph = picked[0]?.graph || app.graph;
    const linkOf = (input) => (input.link != null ? (graph.getLink?.(input.link) ?? graph.links?.[input.link]) : null);
    // In the order things flow (loaders, then LoRAs from the model outwards), so the numbers read along the chain.
    const byId = new Map(kept.map(item => [item.node.id, item]));
    const edges = kept.flatMap(({ node }) => (node.inputs || []).map(linkOf).filter(Boolean).map(link => [link.origin_id, node.id]));
    kept.splice(0, kept.length, ...chainOrder([...byId.keys()], edges).map(id => byId.get(id)));

    const left = Math.min(...kept.map(({ node }) => node.pos?.[0] || 0));
    const top = Math.min(...kept.map(({ node }) => node.pos?.[1] || 0));
    const keys = new Map(kept.map(({ node }, index) => [node.id, `n${index + 1}`]));
    const nodes = [];
    const slots = [];
    const values = {};
    const counts = {};
    for (const { node, models, texts } of kept) {
        const key = keys.get(node.id);
        const definitionTitle = globalThis.LiteGraph?.registered_node_types?.[node.type]?.title;
        nodes.push({
            key, type: node.type, pack: packOf(node.type), name: node.title || node.type, // as the canvas shows it
            title: node.title && node.title !== definitionTitle ? node.title : '',
            pos: [Math.round((node.pos?.[0] || 0) - left), Math.round((node.pos?.[1] || 0) - top)],
            size: Array.isArray(node.size) ? [Math.round(node.size[0]), Math.round(node.size[1])] : null,
            widgets: (node.widgets || []).filter(widget => widget.name && widget.type !== 'button' && storable(widget.value))
                .map(widget => [widget.name, widget.value]),
        });
        for (const widget of models) {
            if (fedByLink(node, widget)) continue;
            const folder = folderFor(optionValues(widget), widget.value, lists);
            counts[folder] = (counts[folder] || 0) + 1;
            const id = `s${slots.length + 1}`;
            slots.push({ id, node: key, widget: widget.name, kind: 'model', folder,
                optional: optionValues(widget).some(value => typeof value === 'string' && NONE.test(value)),
                label: labelFor?.({ kind: 'model', folder, index: counts[folder], widget: widget.name }) || widget.name });
            values[id] = String(widget.value ?? '');
        }
        for (const box of texts) {
            if (fedByLink(node, box.widget)) continue;
            const id = `s${slots.length + 1}`;
            slots.push({ id, node: key, widget: box.name, kind: 'text', role: box.role === 'both' ? '' : box.role,
                label: labelFor?.({ kind: 'text', role: box.role, widget: box.name }) || box.name });
            values[id] = String(box.widget.value ?? '');
        }
    }
    // Model folders appear more than once: number them all ("LoRA 1", "LoRA 2"); a single one keeps its plain name.
    for (const slot of slots) {
        if (slot.kind === 'model' && counts[slot.folder] === 1) {
            slot.label = labelFor?.({ kind: 'model', folder: slot.folder, index: 0, widget: slot.widget }) || slot.label;
        }
    }

    const links = [];
    const open = [];
    for (const { node } of kept) {
        (node.inputs || []).forEach((input, slot) => {
            const link = linkOf(input);
            if (!link) return;
            if (!keys.has(link.origin_id)) {
                // A box turned into an input keeps its saved value; any other input waits for a wire.
                if (!input.widget) open.push({ node: keys.get(node.id), name: input.name || '', type: String(link.type ?? input.type ?? '') });
                return;
            }
            const origin = graph.getNodeById(link.origin_id);
            const output = origin?.outputs?.[link.origin_slot];
            links.push({
                from: keys.get(link.origin_id), fromSlot: link.origin_slot, fromName: output?.name || '',
                to: keys.get(node.id), toSlot: slot, toName: input.name || '', type: String(link.type ?? output?.type ?? ''),
            });
        });
    }
    return { structure: { version: STRUCTURE_VERSION, nodes, links, slots, open }, values, dropped };
}

/** The drop-down's own spelling of a model path (folders with \ on Windows), else the path as given. */
function nativeChoice(widget, value) {
    const wanted = slashes(value);
    return optionValues(widget).find(option => typeof option === 'string' && slashes(option) === wanted) ?? value;
}

function setBox(node, widget, value) {
    widget.value = value;
    widget.callback?.(value, app.canvas, node, app.canvas?.graph_mouse, null);
}

/**
 * Makes the structure's nodes on the canvas with `values` in its slots: { made: [{ node, relX,
 * relY }], problems: [{ kind, … }] }. Throws { code: 'missing_nodes', missing } when a node type
 * is not installed, before making anything.
 */
export function buildStructure(structure, values = {}) {
    const missing = missingTypes(structure);
    if (missing.length) {
        const error = new Error('missing_nodes');
        error.code = 'missing_nodes';
        error.missing = missing;
        throw error;
    }
    const problems = [];
    const made = new Map();
    const placed = [];
    for (const item of structure.nodes) {
        const node = globalThis.LiteGraph.createNode(item.type);
        app.graph.add(node);
        if (item.title) node.title = item.title;
        made.set(item.key, node);
        placed.push({ node, relX: item.pos?.[0] || 0, relY: item.pos?.[1] || 0 });
        const slotNames = new Set(structure.slots.filter(slot => slot.node === item.key).map(slot => slot.widget));
        for (const [name, value] of item.widgets || []) {
            if (slotNames.has(name)) continue;
            const widget = node.widgets?.find(entry => entry.name === name);
            if (widget) setBox(node, widget, value); // in order: a count box adds the boxes after it
        }
        if (Array.isArray(item.size)) node.size = [Math.max(node.size?.[0] || 0, item.size[0]), Math.max(node.size?.[1] || 0, item.size[1])];
    }
    for (const slot of structure.slots) {
        const node = made.get(slot.node);
        const widget = node?.widgets?.find(entry => entry.name === slot.widget);
        if (!widget) {
            problems.push({ kind: 'slot_missing', label: slot.label, widget: slot.widget, type: node?.title || node?.type || '' });
            continue;
        }
        const value = Object.hasOwn(values, slot.id) ? values[slot.id] : widget.value;
        setBox(node, widget, slot.kind === 'model' ? nativeChoice(widget, value) : String(value ?? ''));
    }
    for (const link of structure.links) {
        const from = made.get(link.from);
        const to = made.get(link.to);
        const out = findPort(from?.outputs, link.fromName, link.fromSlot, link.type);
        const into = findPort(to?.inputs, link.toName, link.toSlot, link.type);
        if (out < 0 || into < 0 || !from.connect(out, to, into)) {
            problems.push({ kind: 'link_missing', from: from?.title || from?.type || link.from, to: to?.title || to?.type || link.to, type: link.type });
        }
    }
    return { made: placed, problems };
}
