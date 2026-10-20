// The AI workbench's rules (web/modules/ai_task_view.js): folding reads, words, counts, addresses.
import assert from 'node:assert/strict';
import {
    audioResult, duration, groupSteps, isVideo, lookTools, outputUrl, stepDetail, taskCounts, taskResults, taskState, toolKey,
} from '../web/modules/ai_task_view.js';

const look = (tool, ok = true) => ({ kind: 'look', tool, ok, summary: tool });
const act = (tool, kind = 'canvas') => ({ kind, tool, ok: true, summary: `${tool}: K` });

// Reads that follow each other fold into one row; a failed read and the work stay rows.
const items = groupSteps([look('search_models'), look('describe_canvas'), act('place_combo'), look('list_combos', false), look('search_images')]);
assert.deepEqual(items.map(item => item.type), ['looks', 'step', 'step', 'looks']);
assert.equal(items[0].steps.length, 2);
assert.deepEqual(groupSteps(undefined), []);
assert.deepEqual(lookTools([look('a'), look('b'), look('a')]), [{ tool: 'a', count: 2 }, { tool: 'b', count: 1 }]);

// Words.
assert.equal(toolKey('place_combo'), 'aiTool_place_combo');
assert.equal(toolKey('x<y>'), 'aiTool_xy');
assert.equal(stepDetail(act('place_combo')), 'K');
assert.equal(stepDetail({ tool: 'describe_canvas', summary: 'describe_canvas' }), '');
assert.equal(stepDetail({ tool: 'report', summary: 'something else' }), 'something else');

// A task's state and counts.
assert.equal(taskState({ live: true, errors: 1 }), 'live');
assert.equal(taskState({ errors: 2 }), 'error');
assert.equal(taskState({}), 'done');
assert.deepEqual(taskCounts({ kinds: { canvas: 2, look: 5, speech: 1 }, images: 3, errors: 1 }), [
    { key: 'aiCountCanvas', values: { count: 2 } }, { key: 'aiCountImages', values: { count: 3 } },
    { key: 'aiCountSpeech', values: { count: 1 } }, { key: 'aiCountErrors', values: { count: 1 } },
]);
assert.deepEqual(taskCounts({}), []);

// What a task made, and where it is served.
const made = taskResults({ steps: [
    { results: [{ type: 'image', filename: 'a.png', subfolder: 'x' }, { type: 'canvas', activity: 'e1' }] },
    { results: [{ type: 'model', model_id: 'm' }, { type: 'weird' }] },
] });
assert.equal(made.image.length, 1);
assert.equal(made.canvas[0].activity, 'e1');
assert.equal(made.model.length, 1);
assert.equal(outputUrl({ filename: 'a b.png', subfolder: 'x/y' }), '/view?filename=a+b.png&subfolder=x%2Fy&type=output');
assert.deepEqual(audioResult({ file: 'audio/Aris/a.flac' }), { filename: 'a.flac', subfolder: 'audio/Aris', folder: 'output' });
assert.deepEqual(audioResult({ file: 'a.flac' }), { filename: 'a.flac', subfolder: '', folder: 'output' });
assert.equal(isVideo({ filename: 'clip.MP4' }), true);
assert.equal(isVideo({ filename: 'a.png' }), false);

// How long a step took.
assert.equal(duration(400), null);
assert.deepEqual(duration(48_200), { key: 'aiSeconds', values: { count: 48 } });
assert.deepEqual(duration(150_000), { key: 'aiMinutes', values: { count: 3 } });

console.log('ai_task_view: ok');
