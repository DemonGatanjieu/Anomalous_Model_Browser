// node tests/recipe_focus.mjs — a workflow's focus values (重点参数) and how comparisons find them.
import assert from 'node:assert/strict';
import { MAX_FOCUS, focusEntries, focusTest, notedFocus, toggledFocus } from '../web/modules/recipe_focus.js';
import { compareParams, readParams } from '../web/modules/param_compare.js';

const workflow = { nodes: [{ id: 3, type: 'KSampler' }, { id: 7, type: 'LoraLoader' }, { id: 8, type: 'LoraLoader' }] };
const lora = { id: 7, type: 'LoraLoader' };

// Marking, unmarking, the note.
let params = toggledFocus({ steps: 20 }, lora, 'strength_model');
assert.deepEqual(params, { steps: 20, focusParams: [{ node: '7', type: 'LoraLoader', widget: 'strength_model', note: '' }] });
params = notedFocus(params, params.focusParams[0], `  ${'x'.repeat(200)}  `);
assert.equal(params.focusParams[0].note.length, 120);
assert.deepEqual(toggledFocus(params, lora, 'strength_model').focusParams, []);

// A full list takes no more; a mark whose node is gone or another type now is not shown.
const full = { focusParams: Array.from({ length: MAX_FOCUS }, (_, i) => ({ node: '3', type: 'KSampler', widget: `w${i}`, note: '' })) };
assert.equal(toggledFocus(full, lora, 'strength_clip'), null);
const stale = { focusParams: [
    { node: '7', type: 'LoraLoader', widget: 'strength_model', note: '' },
    { node: '9', type: 'LoraLoader', widget: 'strength_model', note: '' },
    { node: '3', type: 'LoraLoader', widget: 'strength_model', note: '' },
] };
assert.deepEqual(focusEntries(stale, workflow).map(entry => entry.node), ['7']);

// Comparing: the marked value of node 7 is a key value, the same widget of the other LoRA is not.
const recipe = { params: stale, workflow };
const test = focusTest(recipe);
assert.ok(test('LoraLoader', 'strength_model', '7'));
assert.equal(test('LoraLoader', 'strength_model', '8'), null);
const graph = strengths => ({ _nodes: [7, 8].map((id, i) => ({ id, type: 'LoraLoader', title: 'Lora', mode: 0, inputs: [],
    widgets: [{ name: 'strength_model', value: strengths[i] }] })) });
const result = compareParams(readParams(graph([0.7, 1])), readParams(graph([0.7, 0.5])), { isKey: test });
assert.deepEqual(result.keys.map(({ node, row }) => [node.id, row.same]), [['7', true]]);
assert.deepEqual(result.nodes.map(node => node.id), ['8']);
console.log('recipe_focus: ok');
