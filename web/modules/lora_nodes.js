/**
 * The LoRA nodes a combo (搭配) puts its LoRAs in: ComfyUI's own (one LoRA loader per LoRA, in a
 * chain), rgthree's Power Lora Loader (one node, a row per LoRA) or Easy-Use's LoRA stack (rows
 * of up to ten per stack node, applied to the model by Easy Apply LoraStack). A third-party one
 * is offered only where its node pack is installed. Also the Power Lora Loader's rows, which are
 * no drop-downs: read and made again for combos saved from canvas nodes (combo_structure.js), and
 * shown to Model Check as drop-down-like boxes (model_check.js). No imports, so it is tested on its own (LiteGraph is read from globalThis).
 */

export const POWER_LORA = 'Power Lora Loader (rgthree)';
const EASY_STACK = 'easy loraStack';
const EASY_APPLY = 'easy loraStackApply';
const EASY_ROWS = 10; // an Easy-Use stack node holds this many LoRAs; more go in a second stack feeding it

export const LORA_NODES = Object.freeze([
    { id: 'core', labelKey: 'comboLoraNodeCore', hintKey: 'comboLoraNodeCoreHint', types: [] },
    { id: 'rgthree', labelKey: 'comboLoraNodeRgthree', hintKey: 'comboLoraNodeRgthreeHint', types: [POWER_LORA], pack: 'rgthree-comfy' },
    { id: 'easy', labelKey: 'comboLoraNodeEasy', hintKey: 'comboLoraNodeEasyHint', types: [EASY_STACK, EASY_APPLY], pack: 'ComfyUI-Easy-Use' },
]);

const registered = () => globalThis.LiteGraph?.registered_node_types || {};

/** The combo's LoRA node by its id; ComfyUI's own for none or an unknown one. */
export function loraNodeKind(id) {
    return LORA_NODES.find(kind => kind.id === id) || LORA_NODES[0];
}

export function isInstalled(kind) {
    return kind.types.every(type => registered()[type]);
}

/** The LoRA nodes this ComfyUI can make, ComfyUI's own first. */
export function installedLoraNodes() {
    return LORA_NODES.filter(isInstalled);
}

// ComfyUI's LoRA files, as its own LoRA loader lists them.
const loraList = () => {
    const list = registered().LoraLoader?.nodeData?.input?.required?.lora_name?.[0];
    return Array.isArray(list) ? list.filter(value => typeof value === 'string') : [];
};

/** ComfyUI's own spelling of a LoRA path (folders with \ on Windows), from its LoRA loader's list. */
export function nativeLora(path) {
    const wanted = String(path ?? '').replace(/\\/g, '/');
    return loraList().find(value => value.replace(/\\/g, '/') === wanted) ?? path;
}

const inputIndex = (node, name) => (node.inputs || []).findIndex(input => input?.name === name);

function setWidget(node, name, value) {
    const widget = node.widgets?.find(entry => entry.name === name);
    if (!widget) return;
    widget.value = value;
    widget.callback?.(value, globalThis.app?.canvas, node, null, null);
}

function fitHeight(node) {
    const computed = node.computeSize?.();
    if (computed && Array.isArray(node.size)) node.size[1] = Math.max(node.size[1], computed[1]);
}

/** Power Lora Loader: one row per LoRA (on, strength 1), the model and CLIP through it. */
function powerLora({ add, source, clipSlot, loras, relX }) {
    const node = add(POWER_LORA, relX, 0);
    for (const path of loras) node.addNewLoraWidget?.(nativeLora(path));
    fitHeight(node);
    source.connect(0, node, inputIndex(node, 'model'));
    if (clipSlot !== null) source.connect(clipSlot, node, inputIndex(node, 'clip'));
    return { last: node, clipSlot: clipSlot === null ? null : 1, relX };
}

/** Easy-Use: stacks of up to ten rows (a later stack feeds the one before), then Apply LoraStack on the model. */
function easyStack({ add, source, clipSlot, loras, relX, step }) {
    const chunks = [];
    for (let at = 0; at < loras.length; at += EASY_ROWS) chunks.push(loras.slice(at, at + EASY_ROWS));
    let y = 0;
    const stacks = chunks.map((chunk) => {
        const stack = add(EASY_STACK, relX, y);
        setWidget(stack, 'toggle', true);
        setWidget(stack, 'mode', 'simple');
        setWidget(stack, 'num_loras', chunk.length);
        chunk.forEach((path, row) => setWidget(stack, `lora_${row + 1}_name`, nativeLora(path)));
        fitHeight(stack);
        y += (stack.size?.[1] || 400) + 60;
        return stack;
    });
    stacks.slice(1).forEach((stack, index) => stack.connect(0, stacks[index], inputIndex(stacks[index], 'optional_lora_stack')));
    const apply = add(EASY_APPLY, relX + step, 0);
    stacks[0].connect(0, apply, inputIndex(apply, 'lora_stack'));
    source.connect(0, apply, inputIndex(apply, 'model'));
    if (clipSlot !== null) source.connect(clipSlot, apply, inputIndex(apply, 'optional_clip'));
    return { last: apply, clipSlot: clipSlot === null ? null : 1, relX: relX + step };
}

/**
 * Puts `loras` (paths in the loras folder) after `source`, a loader giving MODEL first and, unless
 * `clipSlot` is null (a UNet), CLIP at `clipSlot`, as `kind`'s nodes made by `add(type, relX,
 * relY)` from `relX` on, `step` apart. `setPath(node, path)` fills a ComfyUI LoRA loader.
 * Returns { last, clipSlot, relX }: the node (and its CLIP output) the prompts take, and the
 * place of the last node made.
 */
export function chainLoras(kind, { add, source, clipSlot, loras, relX, step, setPath }) {
    if (!loras.length) return { last: source, clipSlot, relX: relX - step };
    if (kind.id === 'rgthree') return powerLora({ add, source, clipSlot, loras, relX });
    if (kind.id === 'easy') return easyStack({ add, source, clipSlot, loras, relX, step });
    let last = source;
    let x = relX - step;
    for (const path of loras) {
        x += step;
        const node = add(clipSlot === null ? 'LoraLoaderModelOnly' : 'LoraLoader', x, 0);
        setPath(node, path);
        last.connect(0, node, 0);
        if (clipSlot !== null) last.connect(clipSlot, node, 1); // a checkpoint loader and a LoraLoader both give CLIP second
        last = node;
    }
    return { last, clipSlot, relX: x };
}

/** A Power Lora Loader's rows in order: [{ on, lora, strength, strengthTwo }] (lora null when none chosen). */
export function powerLoraRows(node) {
    if (node?.type !== POWER_LORA) return [];
    return (node.widgets || []).filter(widget => /^lora_\d+$/.test(widget.name || '') && widget.value && typeof widget.value === 'object')
        .map(({ value }) => ({ on: value.on !== false, lora: typeof value.lora === 'string' ? value.lora : null,
            strength: Number.isFinite(value.strength) ? value.strength : 1,
            strengthTwo: Number.isFinite(value.strengthTwo) ? value.strengthTwo : null }));
}

/**
 * A Power Lora Loader's switched-on rows with a LoRA, as boxes Model Check and the model picker
 * read like a drop-down: { name, type: 'combo', value (the row's LoRA), options.values (ComfyUI's
 * LoRA list) }. Setting the value changes only the row's LoRA; what Model Check notes on a box
 * (anomalous_replaced) is kept on the row, so it lasts from one check to the next.
 */
export function powerLoraRowBoxes(node) {
    if (node?.type !== POWER_LORA) return [];
    const values = loraList();
    return (node.widgets || []).filter(row => /^lora_\d+$/.test(row.name || '') && typeof row.value?.lora === 'string' && row.value.on !== false)
        .map(row => ({
            name: row.name,
            type: 'combo',
            options: { values },
            get value() { return row.value?.lora ?? null; },
            set value(lora) { row.value = { ...row.value, lora }; },
            get anomalous_replaced() { return row.anomalous_replaced; },
            set anomalous_replaced(note) { row.anomalous_replaced = note; },
        }));
}

/** Makes `rows` on a new Power Lora Loader; they are named lora_1, lora_2… in that order. */
export function addPowerLoraRows(node, rows) {
    for (const row of rows) {
        const widget = node.addNewLoraWidget?.();
        if (widget) widget.value = { ...row };
    }
    fitHeight(node);
}
