/**
 * Prompt boxes on the live canvas: which text boxes of a node take a prompt, and whether
 * that prompt is positive or negative. A prompt box is a multiline STRING input by the
 * node's own definition (ComfyUI's object_info), whatever the box is called. Its role is
 * the box's name when the node's author named it positive / negative; otherwise it comes
 * from the wiring: the node's outputs are followed down to an input named positive or
 * negative (a guider's single conditioning input counts as positive). No DOM here.
 */

const POSITIVE_NAME = /^(positive|positive_prompt|text_positive|正面|正向|正面提示词|正向提示词)$/i;
const NEGATIVE_NAME = /^(negative|negative_prompt|text_negative|负面|反向|负面提示词|反向提示词)$/i;
const MAX_HOPS = 16;

/** 'positive' | 'negative' | '' for a box (or serialized widget) name that says so itself. */
export function promptNameRole(name) {
    const trimmed = String(name || '').trim();
    if (POSITIVE_NAME.test(trimmed)) return 'positive';
    if (NEGATIVE_NAME.test(trimmed)) return 'negative';
    return '';
}

function definition(type) {
    return globalThis.LiteGraph?.registered_node_types?.[type]?.nodeData || null;
}

function inputSpec(nodeData, name) {
    const input = nodeData?.input || {};
    return input.required?.[name] || input.optional?.[name] || null;
}

const isMultilineString = (spec) => Array.isArray(spec) && spec[0] === 'STRING' && Boolean(spec[1]?.multiline);

/** Whether nodes of this type have a prompt box (by their definition). */
export function typeTakesPrompt(type) {
    const input = definition(type)?.input || {};
    return [...Object.values(input.required || {}), ...Object.values(input.optional || {})].some(isMultilineString);
}

export function isPromptBox(node, widget) {
    const nodeData = node?.constructor?.nodeData || definition(node?.type);
    return typeof widget?.value === 'string' && isMultilineString(inputSpec(nodeData, widget.name));
}

function downstream(node, graph) {
    const found = [];
    for (const output of node.outputs || []) {
        for (const linkId of output.links || []) {
            const link = graph.getLink?.(linkId) ?? graph.links?.[linkId];
            const target = link && graph.getNodeById(link.target_id);
            if (target) found.push({ target, input: String(target.inputs?.[link.target_slot]?.name || '') });
        }
    }
    return found;
}

/**
 * Where a node's output ends up: { role: 'positive' | 'negative' | 'both' | '', samplers }
 * with the ids of the nodes whose positive / negative input it reaches.
 */
export function wiredRole(node, graph = node?.graph) {
    const roles = new Set();
    const samplers = new Set();
    if (!node || !graph) return { role: '', samplers };
    const seen = new Set([node.id]);
    let frontier = [node];
    for (let hop = 0; hop < MAX_HOPS && frontier.length; hop++) {
        const next = [];
        for (const current of frontier) {
            for (const { target, input } of downstream(current, graph)) {
                const guider = /guider/i.test(target.type) && /^(conditioning|cond\d*)$/i.test(input);
                const role = /positive/i.test(input) || guider ? 'positive' : /negative/i.test(input) ? 'negative' : '';
                if (role) {
                    roles.add(role);
                    samplers.add(target.id);
                } else if (!seen.has(target.id)) {
                    seen.add(target.id);
                    next.push(target);
                }
            }
        }
        frontier = next;
    }
    return { role: roles.size === 2 ? 'both' : [...roles][0] || '', samplers };
}

/** A node's prompt boxes: [{ index, widget, name, role }], role '' when nothing tells. */
export function promptBoxes(node) {
    const boxes = (node?.widgets || []).flatMap((widget, index) => (
        isPromptBox(node, widget) ? [{ index, widget, name: widget.name, role: '' }] : []
    ));
    let wired = null;
    for (const box of boxes) {
        box.role = promptNameRole(box.name) || (wired ||= wiredRole(node)).role;
    }
    return boxes;
}

/** The text of a prompt envelope ({ positive, negative, singleText, primaryRole }) for a box of `role`. */
export function textForRole(envelope, role) {
    if (role === 'negative') return envelope.negative || '';
    if (role === 'positive' || role === 'both') return envelope.positive || '';
    return envelope.primaryRole === 'negative' ? envelope.negative : (envelope.positive || envelope.singleText || envelope.negative || '');
}

/**
 * What filling `node` with an envelope writes: [{ index, value, role }]. With `box` (one of
 * the node's boxes, chosen by the user) only that box, with the text of its role, or the
 * envelope's main text when the envelope has none of that role. Without it: every box that
 * has text of its own role; a node with one box of unknown role takes the main text.
 */
export function planPromptFill(node, envelope, box = null) {
    if (box) {
        const value = textForRole(envelope, box.role) || textForRole(envelope, '');
        return value ? [{ index: box.index, value, role: box.role }] : [];
    }
    const boxes = promptBoxes(node);
    const known = boxes.filter(item => item.role && textForRole(envelope, item.role));
    if (known.length) return known.map(item => ({ index: item.index, value: textForRole(envelope, item.role), role: item.role }));
    if (boxes.length === 1 && !boxes[0].role) {
        const value = textForRole(envelope, '');
        return value ? [{ index: boxes[0].index, value, role: '' }] : [];
    }
    return [];
}

/**
 * The one box on another node that takes the opposite role for the same sampler as
 * `node`'s output, or null (none, or more than one).
 */
export function partnerBox(node, role, graph = node?.graph) {
    if (!graph || (role !== 'positive' && role !== 'negative')) return null;
    const { samplers } = wiredRole(node, graph);
    if (!samplers.size) return null;
    const wanted = role === 'positive' ? 'negative' : 'positive';
    const found = [];
    for (const other of graph._nodes || []) {
        if (other === node) continue;
        const boxes = promptBoxes(other).filter(box => box.role === wanted);
        if (!boxes.length) continue;
        const reach = wiredRole(other, graph).samplers;
        if ([...reach].some(id => samplers.has(id))) found.push(...boxes.map(box => ({ node: other, box })));
    }
    return found.length === 1 ? found[0] : null;
}
