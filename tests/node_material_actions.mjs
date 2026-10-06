import assert from 'node:assert/strict';
import { applyNodeMaterialValues, selectedMaterialNode } from '../web/modules/node_material_actions.js';
import { promptBoxes } from '../web/modules/prompt_boxes.js';
import { composePromptPlan } from '../web/modules/prompt_composition.js';

// A saved block's values into a node of its type (the library's block apply, removed with the
// Material Library page), to exercise applyNodeMaterialValues' value and hash rules.
function applyMaterialBlock(app, node, block, workflowHashes) {
    if (node?.type !== block?.type || !Array.isArray(block.widgets_values)
        || block.widgets_values.length > (node.widgets?.length || 0)) throw new Error('materialNoCompatibleValues');
    return applyNodeMaterialValues(app, node, block.widgets_values.map((value, index) => ({ index, value })),
        { sourceNodeId: block.node_id, workflowHashes });
}

function fixture() {
    const node = { id: 7, type: 'KSampler', pos: [100, 20], inputs: [{ link: 88 }],
        widgets: [{ name: 'seed', value: 123 }, { name: 'steps', value: 20 }, { name: 'sampler_name', value: 'euler', options: { values: ['euler', 'heun'] } }],
        widgets_values: [123, 20, 'euler'] };
    const calls = [];
    node.onWidgetChanged = (name, value, old, widget) => { assert.equal(widget.name, name); calls.push([node.widgets.indexOf(widget), value, old]); };
    const graph = { extra: { keep: true, anomalous_hashes: { '7_old': 'old', '8_other': 'other' } },
        getNodeById: id => id === node.id ? node : null,
        beforeChange: () => calls.push('before'), afterChange: () => calls.push('after'), change() {}, setDirtyCanvas() {} };
    const app = { graph, canvas: { selected_nodes: { 7: node }, setDirty() {} } };
    const block = { node_id: 2, type: 'KSampler', widgets_values: [999, 30, 'heun'] };
    return { node, graph, app, block, calls };
}
{
    const { node, graph, app, block, calls } = fixture();
    assert.equal(selectedMaterialNode(app), node);
    const before = structuredClone({ values: node.widgets_values, extra: graph.extra, pos: node.pos, inputs: node.inputs });
    const result = applyMaterialBlock(app, node, block, { '2_model': { hash: 'abc' }, '22_secret': 'ignore' });
    assert.equal(result.widgets, 2);
    assert.deepEqual(node.widgets_values, [123, 30, 'heun']);
    assert.deepEqual(graph.extra.anomalous_hashes, { '7_model': { hash: 'abc' }, '8_other': 'other' });
    assert.deepEqual(calls, ['before', [1, 30, 20], [2, 'heun', 'euler'], 'after']);
    result.undo();
    assert.deepEqual({ values: node.widgets_values, extra: graph.extra, pos: node.pos, inputs: node.inputs }, before);
    assert.throws(() => result.undo(), /materialUndoChanged/);
}
for (const invalid of [ { type: 'Other' }, { widgets_values: [99, 30, 'foreign'] }, { widgets_values: [99, 'bad', 'heun'] }, { widgets_values: [99, NaN, 'heun'] }, { widgets_values: [99, 30, 'heun', 4] } ]) {
    const { app, node, block, graph, calls } = fixture();
    const before = JSON.stringify([node.widgets_values, graph.extra]);
    assert.throws(() => applyMaterialBlock(app, node, { ...block, ...invalid }, {}));
    assert.equal(JSON.stringify([node.widgets_values, graph.extra]), before);
    assert.deepEqual(calls, [], 'validation must finish before graph mutation');
}
{
    const { app, node, block, graph, calls } = fixture();
    node.widgets[2].callback = () => { throw new Error('host hook failed'); };
    const before = JSON.stringify([node.widgets_values, graph.extra]);
    assert.throws(() => applyMaterialBlock(app, node, block, { '2_new': 'new' }), /host hook/);
    assert.deepEqual([node.widgets_values, graph.extra], JSON.parse(before));
    assert.deepEqual(node.widgets.map(w => w.value), node.widgets_values);
    assert.equal(calls.at(-1), 'after');
}
for (const change of ['widget', 'serialized', 'hash', 'graph']) {
    const { app, node, graph, block } = fixture();
    const result = applyMaterialBlock(app, node, block, {});
    if (change === 'widget') node.widgets[1].value = 55;
    if (change === 'serialized') node.widgets_values[1] = 55;
    if (change === 'hash') graph.extra.anomalous_hashes['7_other'] = 'new';
    if (change === 'graph') app.graph = { ...graph };
    assert.throws(() => result.undo(), /materialUndoChanged/);
}
{
    const { app, node, block, graph } = fixture();
    delete graph.extra;
    const result = applyMaterialBlock(app, node, block, { '2_model': 'new' });
    result.undo(); assert.equal(Object.hasOwn(graph, 'extra'), false);
    app.canvas.selected_nodes.other = {};
    assert.equal(selectedMaterialNode(app), null);
    app.canvas.selected_nodes = { 7: { ...node } };
    assert.equal(selectedMaterialNode(app), null);
    assert.throws(() => applyNodeMaterialValues(app, { ...node }, [{ index: 1, value: 30 }]), /materialTargetChanged/);
}
{
    const { app, node } = fixture();
    node.type = 'CLIPTextEncode';
    node.widgets = [{ name: 'text', value: 'old' }, { name: 'text_l', value: '' }, { name: 'model', value: 'not a prompt' }];
    globalThis.LiteGraph = { registered_node_types: { CLIPTextEncode: { nodeData: { input: { required: { text: ['STRING', { multiline: true }], text_l: ['STRING', { multiline: true }], model: ['STRING', {}] } } } } } };
    assert.deepEqual(promptBoxes(node).map(box => [box.index, box.name]), [[0, 'text'], [1, 'text_l']]);
    const result = applyNodeMaterialValues(app, node, [{ index: 0, value: 'new\n(weights:1.2)' }]);
    assert.equal(node.widgets[1].value, ''); result.undo(); assert.equal(node.widgets[0].value, 'old');
}
const plan = { parts: [
    { enabled: true, positive: '  (quality:1.2), BREAK\n', negative: 'bad' },
    { enabled: false, positive: 'disabled', negative: 'disabled' },
    { enabled: true, positive: 'style', negative: 'bad' },
], positive: 'scene', negative: ' ' };
assert.deepEqual(composePromptPlan(plan), { positive: '  (quality:1.2), BREAK\n\nstyle\nscene', negative: 'bad\nbad' });
assert.deepEqual(composePromptPlan({ parts: [] }), { positive: '', negative: '' });
console.log('node materials: validation, scoped hashes, rollback, guarded undo and prompt composition OK');
