import assert from 'node:assert/strict';
import {
    appliedState, applyParameterChanges, closestSet, isAppliedEntry, loadParameterSets, loadSetPictures, parameterChanges, parameterRows,
    rememberApplied, restoreApplied,
} from '../web/modules/node_parameter_sets.js';

// Both sources, with the same values saved in a material and in a recipe parameter set.
const shared = [123, 'fixed', 30, 5.5, 'euler', 'karras', 1];
const asked = [];
globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => (asked.push(String(url)), String(url).includes('/parameter_pictures')
        ? { pictures: { ['a'.repeat(64)]: { count: 2, newest: { filename: 'p.png', subfolder: '' } } } }
        : String(url).includes('/materials/')
        ? { materials: [
            { name: 'Slow', filename: 'm.json', timestamp: 10, origin: 'generated_image', source_image: { filename: 'kept.png', subfolder: '' }, preview: 'preview-1.webp',
                blocks: [{ title: 'KSampler', widgets_values: shared }] },
            { name: 'Fast', timestamp: 30, blocks: [{ title: 'KSampler', widgets_values: [1, 'fixed', 8, 2, 'lcm', 'sgm_uniform', 1] }] },
        ] }
        : { groups: [
            { recipe_filename: 'r.json', recipe_name: 'Portrait', notebooks: [{ name: 'Slow set', filename: 'params_1.json', signature: 'a'.repeat(64), timestamp: 20, nodes: [{ title: 'KSampler', widgets_values: shared }] }] },
            { recipe_filename: 'unbound', notebooks: [{ name: 'Loose', timestamp: 99, nodes: [{ widgets_values: [9] }] }] },
            { recipe_filename: 'gone.json', recipe_name: 'gone.json', notebooks: [{ name: 'Old', timestamp: 98, nodes: [{ widgets_values: [8] }] }] },
        ] }),
});

{
    const entries = await loadParameterSets('KSampler');
    assert.deepEqual(entries.map(entry => entry.name), ['Fast', 'Slow']);
    assert.deepEqual(entries[1].sources.map(source => [source.kind, source.label]), [['material', 'Slow'], ['recipe', 'Portrait']]);
    assert.equal(entries[1].timestamp, 20);
    // Where each came from: the kept picture and its saved preview, the recipe's set file and signature.
    const [kept, set] = entries[1].sources;
    assert.deepEqual([kept.origin, kept.image, kept.preview], ['generated_image', { filename: 'kept.png', subfolder: '' }, '/anomalous/material_asset?filename=m.json&asset=preview-1.webp']);
    assert.deepEqual([set.recipeFile, set.setFile, set.setName, set.signature], ['r.json', 'params_1.json', 'Slow set', 'a'.repeat(64)]);
    assert.equal(entries[0].sources[0].image, null);
    // The pictures made with the sets' values: one request for all of them.
    const pictures = await loadSetPictures(entries);
    assert.equal(pictures['a'.repeat(64)].count, 2);
    assert.equal(asked.filter(url => url.includes('/parameter_pictures')).length, 1);
    assert.deepEqual(await loadSetPictures([entries[0]]), {}); // no recipe set, nothing asked
}

// What would change: seeds, model files and missing choices stay.
const widget = (name, value, values) => ({ name, value, ...(values ? { options: { values } } : {}) });
function sampler() {
    return {
        id: 3, type: 'KSampler',
        widgets: [widget('seed', 5), widget('control_after_generate', 'fixed', ['fixed', 'randomize']), widget('steps', 20),
            widget('cfg', 7), widget('sampler_name', 'euler', ['euler', 'dpmpp_2m']), widget('scheduler', 'normal', ['normal', 'karras']), widget('denoise', 1)],
    };
}
{
    const node = sampler();
    const changes = parameterChanges(node, [123, 'randomize', 30, 5.5, 'euler', 'beta57', 1]);
    assert.deepEqual(changes.map(c => [c.label, c.from, c.to, c.keep]), [
        ['seed', 5, 123, 'seed'], ['control_after_generate', 'fixed', 'randomize', 'seed'], ['steps', 20, 30, ''], ['cfg', 7, 5.5, ''], ['scheduler', 'normal', 'beta57', 'missing'],
    ]);
    const loader = { id: 4, type: 'CheckpointLoaderSimple', widgets: [widget('ckpt_name', 'a.safetensors', ['a.safetensors', 'b.safetensors'])] };
    assert.equal(parameterChanges(loader, ['b.safetensors'])[0].keep, 'model');
    assert.deepEqual(parameterChanges(node, ['not a number', 'fixed', 20]), []); // a value of another type is not this input
    // Every value, the equal ones too, for "show all" and the side-by-side table.
    assert.deepEqual(parameterRows(node, [5, 'fixed', 30, 7, 'dpmpp_2m']).map(row => [row.label, row.status]),
        [['seed', 'same'], ['control_after_generate', 'same'], ['steps', 'change'], ['cfg', 'same'], ['sampler_name', 'change']]);
}

// Applying writes only the changes that are made, as one undoable step.
{
    const node = sampler();
    node.widgets_values = node.widgets.map(w => w.value);
    const graph = { getNodeById: id => (id === 3 ? node : null), beforeChange() {}, afterChange() {}, change() {}, setDirtyCanvas() {} };
    const app = { graph, canvas: { setDirty() {} } };
    const result = applyParameterChanges(app, node, parameterChanges(node, [123, 'fixed', 30, 5.5, 'euler', 'beta57', 1]));
    assert.deepEqual(node.widgets.map(w => w.value), [5, 'fixed', 30, 5.5, 'euler', 'normal', 1]);
    result.undo();
    assert.deepEqual(node.widgets.map(w => w.value), [5, 'fixed', 20, 7, 'euler', 'normal', 1]);
}

// What was last put into a node, per workflow and node; what changed since; undone, forgotten.
{
    const saved = new Map();
    globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)) };
    const app = { extensionManager: { workflow: { activeWorkflow: { key: 'workflows/a.json' } } } };
    const node = sampler();
    const entry = { name: 'Slow', values: [123, 'fixed', 30, 5.5, 'euler', 'normal', 1] };
    const rows = parameterRows(node, entry.values);
    assert.equal(appliedState(app, node), null);
    const previous = rememberApplied(app, node, entry, rows, 1000);
    assert.equal(previous, null);
    for (const change of parameterChanges(node, entry.values).filter(change => !change.keep)) node.widgets[change.index].value = change.to;
    assert.deepEqual(appliedState(app, node).changed, []);
    assert.equal(isAppliedEntry(entry, appliedState(app, node).record), true);
    assert.equal(isAppliedEntry({ ...entry, values: [123, 'fixed', 31] }, appliedState(app, node).record), false);
    node.widgets[3].value = 6; // cfg by hand
    assert.deepEqual(appliedState(app, node).changed.map(change => [change.label, change.from, change.to]), [['cfg', 5.5, 6]]);
    const other = { ...sampler(), id: 9 };
    assert.equal(appliedState(app, other), null); // another node
    app.extensionManager.workflow.activeWorkflow.key = 'workflows/b.json';
    assert.equal(appliedState(app, node), null); // another workflow
    app.extensionManager.workflow.activeWorkflow.key = 'workflows/a.json';
    node.widgets[2].value = 20; // steps and cfg back as before: nothing it changed is left
    node.widgets[3].value = 7;
    assert.equal(appliedState(app, node), null);
    restoreApplied(app, node, previous); // undone: forgotten
    assert.equal(JSON.parse(saved.get('anomalous_applied_sets'))['workflows/a.json||3'], undefined);
}

// Without a record: the set the values are now, or the closest one.
{
    const node = sampler();
    const now = node.widgets.map(w => w.value);
    const entries = [
        { name: 'Far', values: [1, 'fixed', 40, 2, 'dpmpp_2m', 'karras', 0.5] },
        { name: 'Near', values: [1, 'fixed', 20, 7.5, 'euler', 'normal', 1] },
        { name: 'Same', values: now },
        { name: 'Same too', values: [...now] },
    ];
    assert.deepEqual([closestSet(node, entries).entry.name, closestSet(node, entries).others], ['Same', 1]);
    const near = closestSet(node, entries.slice(0, 2));
    assert.deepEqual([near.entry.name, near.changes.map(change => change.label)], ['Near', ['cfg']]);
    assert.equal(closestSet(node, entries.slice(0, 1)), null); // too far to speak of
}

console.log('node parameter sets: merged sources, kept values, undoable apply, last applied OK');
