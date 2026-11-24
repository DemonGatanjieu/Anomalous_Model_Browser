// Files dropped on the Workflows page (web/modules/workflow_file_import.js): what kind each is, the workflow a
// .json holds (ComfyUI's own, a recipe AMB keeps, a run's API prompt told apart), the saves key dropped and
// nothing else touched, the recipe's name, and what one toast says of a drop.
import assert from 'node:assert/strict';
import {
    buildDropSummary, classifyDroppedWorkflowFile, deriveDroppedRecipeName, parseDroppedWorkflowJson, stripSavesKey,
} from '../web/modules/workflow_file_import.js';

// What kind of file.
assert.equal(classifyDroppedWorkflowFile('flow.json'), 'json');
assert.equal(classifyDroppedWorkflowFile('Flow.JSON', 'application/json'), 'json');
assert.equal(classifyDroppedWorkflowFile('ComfyUI_00012_.png'), 'image');
assert.equal(classifyDroppedWorkflowFile('out.webp'), 'image');
assert.equal(classifyDroppedWorkflowFile('pasted', 'image/png'), 'image', 'no extension: the type says');
assert.equal(classifyDroppedWorkflowFile('pack.zip'), 'zip');
assert.equal(classifyDroppedWorkflowFile('photo.jpg', 'image/jpeg'), 'unsupported');
assert.equal(classifyDroppedWorkflowFile('notes.txt'), 'unsupported');
assert.equal(classifyDroppedWorkflowFile(''), 'unsupported');

// A pack not installed here: its node is kept exactly as written.
const unknown = { id: 2, type: 'SomePackNode', properties: { 'Node name for S&R': 'x', secret: [1, 2] }, widgets_values: ['as it was', 7], inputs: [{ name: 'a', link: 1 }] };
const ui = { last_node_id: 2, nodes: [{ id: 1, type: 'KSampler', widgets_values: [1] }, unknown], links: [[1, 1, 0, 2, 0, 'MODEL']], extra: { ds: { scale: 1 }, anomalous_saves: 'canvas-key' } };

// ComfyUI's own workflow file.
const plain = parseDroppedWorkflowJson(JSON.stringify(ui));
assert.equal(plain.ok, true);
assert.deepEqual(plain.workflow.nodes[1], unknown);
assert.deepEqual(plain.workflow.extra, { ds: { scale: 1 } }, 'the saves key goes, the rest of extra stays');
assert.deepEqual(plain.workflow.links, ui.links);
assert.deepEqual([plain.name, plain.tags, plain.notes], ['', [], '']);
assert.equal(ui.extra.anomalous_saves, 'canvas-key', 'the parsed text, not a shared object: nothing to mutate');

// A recipe AMB keeps: its workflow, name, tags and notes.
const recipe = parseDroppedWorkflowJson(JSON.stringify({ name: '  Portrait  ', tags: ['sdxl', ' face ', 3, '', 'sdxl'], notes: 'keep', workflow: ui, params: {} }));
assert.equal(recipe.ok, true);
assert.deepEqual(recipe.workflow.nodes, ui.nodes);
assert.equal(recipe.workflow.extra.anomalous_saves, undefined);
assert.deepEqual([recipe.name, recipe.tags, recipe.notes], ['Portrait', ['sdxl', 'face'], 'keep']);

// A run's API prompt, broken text, other JSON.
const api = { 3: { class_type: 'KSampler', inputs: { seed: 1 } }, 4: { class_type: 'CheckpointLoaderSimple', inputs: {} } };
assert.deepEqual(parseDroppedWorkflowJson(JSON.stringify(api)), { ok: false, reason: 'api_only' });
assert.deepEqual(parseDroppedWorkflowJson(JSON.stringify({ prompt: api })), { ok: false, reason: 'api_only' });
assert.deepEqual(parseDroppedWorkflowJson('{"nodes": [1,'), { ok: false, reason: 'invalid_json' });
assert.deepEqual(parseDroppedWorkflowJson(''), { ok: false, reason: 'invalid_json' });
assert.deepEqual(parseDroppedWorkflowJson('[1, 2]'), { ok: false, reason: 'not_workflow' });
assert.deepEqual(parseDroppedWorkflowJson('{"nodes": "none"}'), { ok: false, reason: 'not_workflow' });
assert.deepEqual(parseDroppedWorkflowJson('{}'), { ok: false, reason: 'not_workflow' });
assert.deepEqual(parseDroppedWorkflowJson('{"3": {"class_type": "KSampler"}}'), { ok: false, reason: 'not_workflow' }, 'no inputs: not a run');

// The saves key alone, and only when it is there.
const bare = { nodes: [] };
assert.equal(stripSavesKey(bare), bare);
assert.equal(stripSavesKey(null), null);
const kept = { nodes: [], extra: { anomalous_saves: 'k', other: 1 } };
assert.deepEqual(stripSavesKey(kept), { nodes: [], extra: { other: 1 } });
assert.equal(kept.extra.anomalous_saves, 'k', 'a copy: the original keeps it');

// The recipe's name.
assert.equal(deriveDroppedRecipeName({ fileName: 'x.json', explicitName: 'Mine' }), 'Mine');
assert.equal(deriveDroppedRecipeName({ fileName: 'C:\\flows\\upscale 4x.json' }), 'upscale 4x');
assert.equal(deriveDroppedRecipeName({ fileName: 'ComfyUI_00012_.png', promptPositive: '1girl, red hair' }), 'ComfyUI_00012_');
assert.equal(deriveDroppedRecipeName({ fileName: '.png', promptPositive: 'masterpiece, 1girl, red hair, smile' }), '1girl, red hair, smile');
assert.equal(deriveDroppedRecipeName({ fileName: '', fallback: 'Untitled' }), 'Untitled');
assert.equal(deriveDroppedRecipeName({ fileName: `${'a'.repeat(200)}.webp` }).length, 120);
assert.equal(deriveDroppedRecipeName(), '');

// One toast for a drop.
assert.deepEqual(buildDropSummary([{ name: 'a' }, { name: 'b.txt', reason: 'unsupported' }, { name: 'p.zip', shown: true }, { name: 'c' }]),
    { saved: ['a', 'c'], skipped: [{ name: 'b.txt', reason: 'unsupported' }] });
assert.deepEqual(buildDropSummary([]), { saved: [], skipped: [] });
assert.deepEqual(buildDropSummary(undefined), { saved: [], skipped: [] });

console.log('workflow_file_import: kinds, workflows, names and the drop summary passed');
