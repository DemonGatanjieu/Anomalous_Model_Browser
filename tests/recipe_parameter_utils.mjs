import assert from 'node:assert/strict';
import {
    formatRecipeResolution,
    isVolatileParameter,
    parameterNodeOrder,
    parseEditorValue,
    topologicalSortNodes,
} from '../web/modules/ui_recipe_parameter_utils.js';

const nodes = [{ id: 3 }, { id: 1 }, { id: 2 }];
const links = [[10, 1, 0, 2, 0], [11, 2, 0, 3, 0]];
assert.deepEqual(topologicalSortNodes(nodes, links), ['1', '2', '3']);

const ordered = parameterNodeOrder({
    workflow: { nodes, links },
    params: { nodes: [{ id: 3, type: 'Output' }, { id: 1, type: 'Input' }, { id: 2, type: 'Middle' }] },
});
assert.deepEqual(ordered.map(item => String(item.summary.id)), ['1', '2', '3']);
assert.equal(isVolatileParameter({ type: 'KSampler' }, { name: 'control_after_generate' }, 0), true);
assert.equal(isVolatileParameter({ type: 'Other' }, { name: 'steps' }, 0), false);
assert.equal(parseEditorValue('12.5', 1), 12.5);
assert.equal(parseEditorValue('false', true), false);
assert.deepEqual(parseEditorValue('{"a":2}', { a: 1 }), { a: 2 });
assert.equal(formatRecipeResolution({ width: 1024, height: 768 }), '1024x768');

console.log('Recipe parameter utils: topology, volatility, parsing, and resolution formatting passed.');
