// Shared by Node Assistant and Material Library. No node creation or link edits.
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function selectedMaterialNode(app) {
    const nodes = Object.values(app.canvas?.selected_nodes || {});
    if (nodes.length !== 1 || !nodes[0]) return null;
    const node = nodes[0];
    const graph = app.graph?.getNodeById(node.id) === node ? app.graph : (node.graph || app.canvas?.graph || app.graph);
    return graph?.getNodeById(node.id) === node ? node : null;
}

function volatile(node, widget, index) {
    return /(^|[_\s-])(seed|noise_seed|random_seed|variation_seed|last_seed)([_\s-]|$)/i.test(widget?.name || '')
        || (node.type === 'KSampler' && index === 0) || (node.type === 'KSamplerAdvanced' && index === 1);
}

function hashesFor(graph, id) {
    return Object.fromEntries(Object.entries(graph.extra?.anomalous_hashes || {}).filter(([key]) => key.startsWith(`${id}_`)));
}

function replaceHashes(graph, id, records) {
    if (!Object.keys(records).length && !graph.extra?.anomalous_hashes) return;
    graph.extra ||= {};
    graph.extra.anomalous_hashes ||= {};
    for (const key of Object.keys(graph.extra.anomalous_hashes)) if (key.startsWith(`${id}_`)) delete graph.extra.anomalous_hashes[key];
    Object.assign(graph.extra.anomalous_hashes, clone(records));
}

export function applyNodeMaterialValues(app, node, entries, options = {}) {
    const graph = app.graph?.getNodeById(node?.id) === node ? app.graph : (node?.graph || app.canvas?.graph || app.graph);
    if (!node || graph?.getNodeById(node.id) !== node || !Array.isArray(node.widgets)) throw new Error('materialTargetChanged');
    const changes = entries.filter(({ index }) => !volatile(node, node.widgets[index], index));
    if (!changes.length) throw new Error('materialNoCompatibleValues');
    for (const { index, value } of changes) {
        const widget = node.widgets[index];
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('materialNoCompatibleValues');
        if (!Number.isInteger(index) || !widget || value === undefined) throw new Error('materialNoCompatibleValues');
        const choices = typeof widget.options?.values === 'function' ? widget.options.values() : widget.options?.values;
        if (Array.isArray(choices) && !choices.includes(value)) throw new Error('materialValueUnavailable');
        if (widget.value != null && (typeof widget.value !== typeof value || Array.isArray(widget.value) !== Array.isArray(value))) throw new Error('materialNoCompatibleValues');
    }
    const previous = node.widgets.map(widget => clone(widget.value));
    const serialized = clone(node.widgets_values);
    const hadExtra = Object.hasOwn(graph, 'extra');
    const hadHashes = !!graph.extra && Object.hasOwn(graph.extra, 'anomalous_hashes');
    const oldHashes = clone(hashesFor(graph, node.id));
    const transportsHashes = options.sourceNodeId !== undefined;
    const mapped = {};
    if (transportsHashes) {
        const prefix = `${options.sourceNodeId}_`;
        for (const [key, value] of Object.entries(options.workflowHashes || {})) {
            if (key.startsWith(prefix)) mapped[`${node.id}_${key.slice(prefix.length)}`] = clone(value);
        }
    }
    const notify = () => {
        graph.change?.();
        graph.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        if (typeof globalThis.CustomEvent === 'function') {
            globalThis.window?.dispatchEvent(new CustomEvent('graphChanged'));
        }
    };
    const restore = () => {
        node.widgets.forEach((widget, index) => { widget.value = clone(previous[index]); });
        if (serialized === undefined) delete node.widgets_values;
        else node.widgets_values = clone(serialized);
        if (transportsHashes) {
            replaceHashes(graph, node.id, oldHashes);
            if (!hadHashes && graph.extra?.anomalous_hashes && !Object.keys(graph.extra.anomalous_hashes).length) delete graph.extra.anomalous_hashes;
            if (!hadExtra && graph.extra && !Object.keys(graph.extra).length) delete graph.extra;
        }
    };
    graph.beforeChange?.();
    try {
        for (const { index, value } of changes) {
            const widget = node.widgets[index];
            widget.value = clone(value);
            if (Array.isArray(node.widgets_values)) node.widgets_values[index] = clone(value);
            widget.callback?.call(widget, widget.value, app.canvas, node);
            node.onWidgetChanged?.(index, widget.value, previous[index], widget);
        }
        if (transportsHashes) replaceHashes(graph, node.id, mapped);
        notify();
    } catch (error) {
        restore();
        notify();
        throw error;
    } finally { graph.afterChange?.(); }
    const appliedSerialized = clone(node.widgets_values);
    const applied = node.widgets.map(widget => clone(widget.value));
    const appliedHashes = clone(hashesFor(graph, node.id));
    let undone = false;
    return {
        widgets: changes.length,
        undo() {
            if (undone || app.graph !== graph || graph.getNodeById(node.id) !== node
                || !same(node.widgets.map(widget => widget.value), applied)
                || !same(node.widgets_values, appliedSerialized)
                || !same(hashesFor(graph, node.id), appliedHashes)) throw new Error('materialUndoChanged');
            graph.beforeChange?.();
            try { restore(); notify(); undone = true; }
            finally { graph.afterChange?.(); }
        },
    };
}

export function applyMaterialBlock(app, node, block, workflowHashes) {
    if (node?.type !== block?.type || !Array.isArray(block.widgets_values)
        || block.widgets_values.length > (node.widgets?.length || 0)) throw new Error('materialNoCompatibleValues');
    return applyNodeMaterialValues(app, node, block.widgets_values.map((value, index) => ({ index, value })),
        { sourceNodeId: block.node_id, workflowHashes });
}

export function promptWidgetTargets(node) {
    const promptNameRegex = /^(text|text_g|text_l|prompt|positive|negative|caption|string|value|文本|提示词|正面|负面|正向|反向|正面提示词|负面提示词|正向提示词|反向提示词|描述|内容)$/i;
    return (node?.widgets || []).flatMap((widget, index) => {
        if (!widget) return [];
        const name = String(widget.name || '');
        const label = String(widget.label || '');
        const isNotCombo = !widget.options?.values || !Array.isArray(widget.options.values);
        const matchesName = promptNameRegex.test(name) || promptNameRegex.test(label) || widget.type === 'customtext' || widget.type === 'text' || !!widget.options?.multiline;
        return typeof widget.value === 'string' && matchesName && isNotCombo ? [{ index, name: name || label || 'text' }] : [];
    });
}
