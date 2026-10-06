/**
 * The rules of combo structures (combo_structure.js) that need no canvas: which drop-down lists
 * model files and from which models folder, where a saved link end goes on a node's ports, which
 * node types are missing, and how a structure is named and compared. No imports, so it is tested
 * on its own (LiteGraph is read from globalThis when there).
 */

export const STRUCTURE_VERSION = 1;
export const STRUCTURED = 'nodes';
const MODEL_FILE = /\.(safetensors|ckpt|pt|pth|bin|sft|gguf)$/i;
export const NONE = /^\s*(none)?\s*$/i;
// ComfyUI's older names for the same folders, and which folder wins when several list the files.
const FOLDER_ALIAS = { clip: 'text_encoders', unet: 'diffusion_models' };
const FOLDER_ORDER = ['checkpoints', 'diffusion_models', 'loras', 'vae', 'text_encoders', 'controlnet', 'clip_vision',
    'upscale_models', 'embeddings', 'style_models', 'gligen', 'vae_approx'];

export const slashes = (value) => String(value ?? '').replace(/\\/g, '/');
export const optionValues = (widget) => {
    const values = widget?.options?.values;
    try {
        return Array.isArray(values) ? values : typeof values === 'function' ? values() || [] : [];
    } catch {
        return [];
    }
};

/** Whether a box is a drop-down of model files. */
export function isModelWidget(widget) {
    if (widget?.type !== 'combo') return false;
    return MODEL_FILE.test(String(widget.value ?? '')) || optionValues(widget).some(value => typeof value === 'string' && MODEL_FILE.test(value));
}

/** Whether the box's value comes from a link (a box turned into an input). */
export function fedByLink(node, widget) {
    return (node.inputs || []).some(input => input.widget?.name === widget.name && input.link != null);
}

/**
 * The models folder a drop-down lists: the one whose files hold all its model-file options,
 * by `lists` (Map folder -> Set of '/' paths). Several: the usual folder first. '' when none does.
 */
export function folderFor(options, current, lists) {
    // Built-in choices beside the files (a VAE loader's "pixel_space", "taesd") are no files.
    const files = options.filter(value => typeof value === 'string' && MODEL_FILE.test(value)).map(slashes);
    const wanted = files.length ? files : (current && !NONE.test(current) ? [slashes(current)] : []);
    if (!wanted.length) return '';
    const fits = [...new Set([...lists].filter(([, set]) => wanted.every(file => set.has(file))).map(([name]) => FOLDER_ALIAS[name] || name))];
    const rank = (name) => (FOLDER_ORDER.includes(name) ? FOLDER_ORDER.indexOf(name) : FOLDER_ORDER.length);
    return fits.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0] || '';
}

/** The node pack a node type comes from ('' for ComfyUI's own), for "missing node pack" messages. */
export function packOf(type) {
    const module = String(globalThis.LiteGraph?.registered_node_types?.[type]?.nodeData?.python_module || '');
    return module.startsWith('custom_nodes.') ? module.slice('custom_nodes.'.length).split('.')[0] : '';
}

/** The node types of a structure this ComfyUI does not have: [{ type, pack }]. */
export function missingTypes(structure) {
    const known = globalThis.LiteGraph?.registered_node_types || {};
    const seen = new Set();
    return (structure?.nodes || []).filter(item => !known[item.type] && !seen.has(item.type) && seen.add(item.type))
        .map(item => ({ type: item.type, pack: item.pack || '' }));
}

/** The slot index on `ports` a saved link end names: same name and type, else its old place, else the one port of that type. */
export function findPort(ports, name, index, type) {
    const fits = (port) => !type || !port?.type || String(port.type) === type || port.type === '*' || type === '*';
    const byName = (ports || []).findIndex(port => port?.name === name && fits(port));
    if (name && byName >= 0) return byName;
    if (ports?.[index] && fits(ports[index]) && (!name || !ports.some(port => port?.name === name))) return index;
    const ofType = (ports || []).flatMap((port, at) => (String(port?.type) === type ? [at] : []));
    return ofType.length === 1 ? ofType[0] : -1;
}

/** A short line for a structure: its nodes by name, repeats counted, e.g. "UNet加载器 + CLIP文本编码 ×2 + 加载LoRA ×4". */
export function structureSummary(structure) {
    const counts = new Map();
    for (const item of structure?.nodes || []) {
        const name = item.title || item.name || item.type;
        counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(' + ');
}

/**
 * `ids` in the order things flow through `edges` ([from, to]): a loader before what it feeds,
 * LoRAs along their chain. Ties keep their given order; anything in a loop comes last as given.
 */
export function chainOrder(ids, edges) {
    const known = new Set(ids);
    const waiting = new Map(ids.map(id => [id, 0]));
    const next = new Map(ids.map(id => [id, []]));
    for (const [from, to] of edges) {
        if (!known.has(from) || !known.has(to) || from === to) continue;
        next.get(from).push(to);
        waiting.set(to, waiting.get(to) + 1);
    }
    const order = [];
    const done = new Set();
    while (order.length < ids.length) {
        const ready = ids.find(id => !done.has(id) && waiting.get(id) === 0);
        if (ready === undefined) break;
        done.add(ready);
        order.push(ready);
        for (const to of next.get(ready)) waiting.set(to, waiting.get(to) - 1);
    }
    return [...order, ...ids.filter(id => !done.has(id))];
}

/** Two structures with the same nodes, boxes and links (for "a new combo like this one"). */
export function structureKey(structure) {
    return JSON.stringify([(structure?.nodes || []).map(item => item.type), (structure?.links || []).map(link => [link.from, link.fromName, link.to, link.toName]),
        (structure?.slots || []).map(slot => [slot.node, slot.widget])]);
}
