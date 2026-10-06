import assert from 'node:assert/strict';
import {
    findWorkflowHashRecord,
    mergeRecipeHashRecords,
    remapWorkflowHashRecords,
} from '../web/modules/recipe_provenance.js';

const hash = 'a'.repeat(64);
const workflow = {
    nodes: [{ id: 4, type: 'LoraLoader', widgets_values: ['styles\\detail.safetensors', 0.8, 0.8] }],
    extra: {
        anomalous_hashes: {
            '4_styles\\detail.safetensors': { hash, size: 12345 },
        },
    },
};

assert.deepEqual(
    findWorkflowHashRecord(workflow, 4, 'styles/detail.safetensors'),
    { hash, size: 12345 },
    'path separators do not break recipe provenance lookup',
);

const remapped = remapWorkflowHashRecords(workflow, new Map([['4', 19]]));
assert.deepEqual(remapped['19_styles/detail.safetensors'], { hash, size: 12345 });
assert.deepEqual(remapped['19_styles\\detail.safetensors'], { hash, size: 12345 });

const graph = { extra: { anomalous_hashes: { '1_host.safetensors': { hash: 'b'.repeat(64), size: 9 } } } };
const mergedCount = mergeRecipeHashRecords(graph, workflow, new Map([['4', 19]]));
assert.equal(mergedCount, 2);
assert.ok(graph.extra.anomalous_hashes['1_host.safetensors'], 'host provenance is preserved');
assert.ok(graph.extra.anomalous_hashes['19_styles/detail.safetensors'], 'appended node gets remapped provenance');

console.log('recipe provenance roundtrip: ok');
