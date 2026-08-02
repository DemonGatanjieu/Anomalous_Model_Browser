/** Pure, bounded semantic comparison for saved Workflow Recipes. */

const MAX_VALUE_LENGTH = 320;
const MAX_CHANGES = 160;

function cloneSafe(value) {
    if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    try {
        const encoded = JSON.stringify(value);
        if (!encoded || encoded.length > MAX_VALUE_LENGTH * 8) return '[complex value]';
        return JSON.parse(encoded);
    } catch (error) {
        return '[complex value]';
    }
}

function stable(value) {
    const cloned = cloneSafe(value);
    try { return JSON.stringify(cloned); } catch (error) { return String(cloned); }
}

export function formatDiffValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    let text;
    if (typeof value === 'string') text = value;
    else {
        try { text = JSON.stringify(value); } catch (error) { text = String(value); }
    }
    text = String(text).replace(/\s+/g, ' ').trim();
    return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}…` : text;
}

function itemKey(item, fallback) {
    if (item?.key) return String(item.key);
    const node = item?.nodeId ?? item?.node_id ?? '';
    const index = item?.widgetIndex ?? item?.widget_index ?? '';
    const name = item?.widgetName ?? item?.widget_name ?? '';
    return `${node}:${index}:${name}:${fallback}`;
}

function addMapChanges(changes, category, before, after, getKey, getValue, getLabel) {
    const left = new Map((before || []).map((item, index) => [getKey(item, index), item]));
    const right = new Map((after || []).map((item, index) => [getKey(item, index), item]));
    const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
    for (const key of keys) {
        const leftItem = left.get(key);
        const rightItem = right.get(key);
        const leftValue = leftItem === undefined ? undefined : getValue(leftItem);
        const rightValue = rightItem === undefined ? undefined : getValue(rightItem);
        const same = leftItem !== undefined && rightItem !== undefined && stable(leftValue) === stable(rightValue);
        if (same) continue;
        changes.push({
            kind: leftItem === undefined ? 'added' : rightItem === undefined ? 'removed' : 'changed',
            category,
            key,
            label: getLabel(rightItem || leftItem),
            before: cloneSafe(leftValue),
            after: cloneSafe(rightValue),
        });
    }
}

function valueAt(recipe, path, fallback = null) {
    const parts = path.split('.');
    let value = recipe;
    for (const part of parts) {
        if (!value || typeof value !== 'object') return fallback;
        value = value[part];
    }
    return value === undefined ? fallback : value;
}

function summaryValue(recipe, key) {
    const params = recipe?.params || {};
    const values = {
        baseModel: params.baseModel,
        steps: params.steps,
        cfg: params.cfg,
        sampler_name: params.sampler_name,
        scheduler: params.scheduler,
        denoise: params.denoise,
        seed: params.seed,
        resolution: params.resolution,
        nodeCount: params.nodeCount,
        loras: (params.loras || []).map((item) => ({
            name: item?.name,
            strength_model: item?.strength_model,
            strength_clip: item?.strength_clip,
        })),
    };
    return values[key];
}

function addScalarChanges(changes, category, entries) {
    for (const entry of entries) {
        const before = cloneSafe(entry.before);
        const after = cloneSafe(entry.after);
        if (stable(before) === stable(after)) continue;
        changes.push({
            kind: before === undefined || before === null ? 'added' : after === undefined || after === null ? 'removed' : 'changed',
            category,
            key: entry.key,
            label: entry.label,
            before,
            after,
        });
    }
}

function graphSummary(recipe) {
    const graph = recipe?.workflow || {};
    return {
        nodes: Array.isArray(graph.nodes) ? graph.nodes.length : null,
        links: Array.isArray(graph.links) ? graph.links.length : graph.links && typeof graph.links === 'object' ? Object.keys(graph.links).length : null,
        fingerprint: recipe?.workflow_fingerprint?.value || null,
    };
}

/** Return deterministic UI-neutral changes between two recipe records. */
export function buildRecipeDiff(beforeRecipe, afterRecipe) {
    const before = beforeRecipe || {};
    const after = afterRecipe || {};
    const changes = [];

    addScalarChanges(changes, 'pinned', [
        {
            key: 'pinned',
            label: 'Pinned parameters',
            before: (before.params?.pinned || []).map((item) => ({
                key: itemKey(item, 'pinned'),
                value: item?.value,
            })),
            after: (after.params?.pinned || []).map((item) => ({
                key: itemKey(item, 'pinned'),
                value: item?.value,
            })),
        },
    ]);

    addMapChanges(
        changes,
        'prompts',
        before.params?.promptPositive || [],
        after.params?.promptPositive || [],
        (_item, index) => `positive:${index}`,
        (item) => item,
        () => 'Positive prompt',
    );
    addMapChanges(
        changes,
        'prompts',
        before.params?.promptNegative || [],
        after.params?.promptNegative || [],
        (_item, index) => `negative:${index}`,
        (item) => item,
        () => 'Negative prompt',
    );
    addMapChanges(
        changes,
        'models',
        before.params?.model_references || [],
        after.params?.model_references || [],
        (item, index) => itemKey(item, `model:${index}`),
        (item) => item?.saved_value,
        (item) => `${item?.category || 'model'} · ${item?.node_title || item?.node_type || 'loader'}`,
    );

    const summaryKeys = ['baseModel', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise', 'seed', 'resolution', 'nodeCount', 'loras'];
    addScalarChanges(changes, 'parameters', summaryKeys.map((key) => ({
        key,
        label: key,
        before: summaryValue(before, key),
        after: summaryValue(after, key),
    })));

    const beforeGraph = graphSummary(before);
    const afterGraph = graphSummary(after);
    addScalarChanges(changes, 'workflow', [
        { key: 'fingerprint', label: 'Workflow fingerprint', before: beforeGraph.fingerprint, after: afterGraph.fingerprint },
        { key: 'node_count', label: 'Node count', before: beforeGraph.nodes, after: afterGraph.nodes },
        { key: 'link_count', label: 'Link count', before: beforeGraph.links, after: afterGraph.links },
    ]);

    addScalarChanges(changes, 'presentation', [
        { key: 'name', label: 'Recipe name', before: before.name, after: after.name },
        { key: 'notes', label: 'Notes', before: before.notes, after: after.notes },
        { key: 'tags', label: 'Tags', before: before.tags || [], after: after.tags || [] },
        { key: 'cover', label: 'Cover', before: Boolean(before.thumbnail || before.source_image), after: Boolean(after.thumbnail || after.source_image) },
        {
            key: 'preview_snapshots',
            label: 'Model preview snapshots',
            before: (before.params?.model_references || []).filter((item) => item?.preview?.snapshot_asset_id).length,
            after: (after.params?.model_references || []).filter((item) => item?.preview?.snapshot_asset_id).length,
        },
    ]);

    return changes.slice(0, MAX_CHANGES);
}

export function diffIsEmpty(changes) {
    return !Array.isArray(changes) || changes.length === 0;
}
