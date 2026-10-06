// node --experimental-vm-modules tests/canvas_undo.mjs — undo from the activity log.
import assert from 'node:assert/strict';
import { snapshotGraph } from '../web/modules/activity_diff.js';
import { canUndo, keepUndo, undoEntry } from '../web/modules/canvas_undo.js';

globalThis.LiteGraph = { registered_node_types: {} };

function makeNode(id, type, widgets, inputs = []) {
    return {
        id, type, title: type, inputs, outputs: [],
        widgets: Object.entries(widgets).map(([name, value]) => ({ name, value })),
    };
}
function makeGraph(nodes) {
    const graph = {
        _nodes: nodes,
        getNodeById: id => graph._nodes.find(node => String(node.id) === String(id)) || null,
        remove: node => { graph._nodes = graph._nodes.filter(item => item !== node); },
        steps: 0,
    };
    return graph;
}
function makeApp(graph, key = 'wf-1') {
    const tracker = { captureCanvasState() { graph.steps += 1; } };
    return { graph, canvas: { graph }, extensionManager: { workflow: { activeWorkflow: { key, changeTracker: tracker } } } };
}

// A value change and an added unconnected node: undone together, one Ctrl+Z step.
{
    const sampler = makeNode(3, 'KSampler', { seed: 5, steps: 20, sampler_name: 'euler' });
    const graph = makeGraph([sampler]);
    const app = makeApp(graph);
    const before = snapshotGraph(graph);
    sampler.widgets[0].value = 6; // a seed changed meanwhile stays
    sampler.widgets[1].value = 30;
    sampler.widgets[2].value = 'dpmpp_2m';
    graph._nodes.push(makeNode(7, 'CLIPTextEncode', { text: 'a cat' }));
    keepUndo('e1', 'wf-1', before, snapshotGraph(graph));
    assert.equal(canUndo(app, { id: 'e1' }), true);
    undoEntry(app, { id: 'e1' });
    assert.equal(sampler.widgets[0].value, 6);
    assert.equal(sampler.widgets[1].value, 20);
    assert.equal(typeof sampler.widgets[1].value, 'number');
    assert.equal(sampler.widgets[2].value, 'euler');
    assert.equal(graph.getNodeById(7), null);
    assert.equal(graph.steps, 1);
    assert.equal(canUndo(app, { id: 'e1' }), false, 'an entry is undone once');
}

// Changed again since, another workflow open, or the added node wired up: no undo.
{
    const sampler = makeNode(3, 'Steps', { steps: 20 });
    const graph = makeGraph([sampler]);
    const before = snapshotGraph(graph);
    sampler.widgets[0].value = 30;
    keepUndo('e2', 'wf-1', before, snapshotGraph(graph));
    assert.equal(canUndo(makeApp(graph, 'wf-2'), { id: 'e2' }), false);
    sampler.widgets[0].value = 31;
    assert.equal(canUndo(makeApp(graph), { id: 'e2' }), false);
    assert.throws(() => undoEntry(makeApp(graph), { id: 'e2' }), /activityUndoGone/);

    const graph2 = makeGraph([]);
    const before2 = snapshotGraph(graph2);
    const added = makeNode(5, 'LoraLoader', { lora_name: 'x' });
    graph2._nodes.push(added);
    keepUndo('e3', 'wf-1', before2, snapshotGraph(graph2));
    added.outputs = [{ links: [11] }];
    assert.equal(canUndo(makeApp(graph2), { id: 'e3' }), false);
}

// Removed nodes or rewired inputs are never kept; nor is an entry without an id.
{
    const a = makeNode(1, 'A', { v: 1 });
    const b = makeNode(2, 'B', { v: 1 }, [{ link: null }]);
    const graph = makeGraph([a, b]);
    const before = snapshotGraph(graph);
    graph._nodes = [b];
    keepUndo('e4', 'wf-1', before, snapshotGraph(graph));
    assert.equal(canUndo(makeApp(graph), { id: 'e4' }), false);

    const graph2 = makeGraph([makeNode(1, 'A', { v: 1 }), b]);
    const before2 = snapshotGraph(graph2);
    b.inputs[0].link = 4;
    b.widgets[0].value = 2;
    keepUndo('e5', 'wf-1', before2, snapshotGraph(graph2));
    assert.equal(canUndo(makeApp(graph2), { id: 'e5' }), false);
    assert.equal(canUndo(makeApp(graph2), {}), false);
}
// A choice this computer no longer has, or only a seed changed: nothing to offer.
{
    const loader = makeNode(4, 'CheckpointLoaderSimple', { ckpt_name: 'a.safetensors' });
    loader.widgets[0].options = { values: ['b.safetensors'] };
    const graph = makeGraph([loader]);
    const before = snapshotGraph(graph);
    loader.widgets[0].value = 'b.safetensors';
    keepUndo('e6', 'wf-1', before, snapshotGraph(graph));
    assert.equal(canUndo(makeApp(graph), { id: 'e6' }), false);

    const seeded = makeNode(8, 'Noise', { noise_seed: 1 });
    const graph2 = makeGraph([seeded]);
    const before2 = snapshotGraph(graph2);
    seeded.widgets[0].value = 2;
    keepUndo('e7', 'wf-1', before2, snapshotGraph(graph2));
    assert.equal(canUndo(makeApp(graph2), { id: 'e7' }), false);
}
console.log('canvas_undo: ok');
