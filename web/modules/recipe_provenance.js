/** UI-neutral helpers for Workflow Recipe model provenance records. */

const MODEL_FILE_PATTERN = /\.(?:safetensors|ckpt|pt|bin|sft)$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function pathVariants(value) {
    if (typeof value !== 'string') return [];
    return [...new Set([
        value,
        value.replace(/\\/g, '/'),
        value.replace(/\//g, '\\'),
    ])];
}

function nodeHashKeys(nodeId, value) {
    return pathVariants(value).map((variant) => `${nodeId}_${variant}`);
}

function provenanceMap(workflow) {
    const hashes = workflow?.extra?.anomalous_hashes;
    return hashes && typeof hashes === 'object' && !Array.isArray(hashes) ? hashes : null;
}

export function findWorkflowHashRecord(workflow, nodeId, value) {
    const hashes = provenanceMap(workflow);
    if (!hashes) return null;
    const keys = [
        ...nodeHashKeys(nodeId, value),
        ...pathVariants(value),
    ];
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(hashes, key)) return cloneJson(hashes[key]);
    }
    return null;
}

function writeNodeHashRecord(hashes, nodeId, value, record) {
    for (const key of nodeHashKeys(nodeId, value)) hashes[key] = cloneJson(record);
}

/** Build node-ID-remapped provenance for appending a partial recipe. */
export function remapWorkflowHashRecords(workflow, idMap) {
    const remapped = {};
    if (!(idMap instanceof Map) || !provenanceMap(workflow)) return remapped;
    for (const node of workflow?.nodes || []) {
        const newId = idMap.get(String(node?.id));
        if (newId === undefined || !Array.isArray(node?.widgets_values)) continue;
        for (const value of node.widgets_values) {
            if (typeof value !== 'string' || !MODEL_FILE_PATTERN.test(value)) continue;
            const record = findWorkflowHashRecord(workflow, node.id, value);
            if (record !== null) writeNodeHashRecord(remapped, newId, value, record);
        }
    }
    return remapped;
}

/** Merge remapped recipe provenance into the live graph without deleting host data. */
export function mergeRecipeHashRecords(graph, workflow, idMap) {
    const additions = remapWorkflowHashRecords(workflow, idMap);
    const keys = Object.keys(additions);
    if (!keys.length) return 0;
    if (!graph.extra || typeof graph.extra !== 'object') graph.extra = {};
    if (!graph.extra.anomalous_hashes || typeof graph.extra.anomalous_hashes !== 'object') {
        graph.extra.anomalous_hashes = {};
    }
    Object.assign(graph.extra.anomalous_hashes, additions);
    return keys.length;
}

