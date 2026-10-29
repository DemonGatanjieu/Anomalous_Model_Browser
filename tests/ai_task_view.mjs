// The AI workbench's rules (web/modules/ai_task_view.js): folding reads, words, counts, addresses.
import assert from 'node:assert/strict';
import {
    activityIds, audioResult, chainTools, duration, flowStages, foldLooks, groupSteps, isVideo, panelGist, lookTools, newestPicture, outputCount, outputUrl, outputPicture, pictureShown,
    pictureKey, picturePreview, uniquePictures, stepDetail, taskCounts, taskOutputs, taskResults, taskState, toolKey,
} from '../web/modules/ai_task_view.js';

const look = (tool, ok = true, state = 'done') => ({ kind: 'look', tool, ok, state, summary: tool });
const act = (tool, kind = 'canvas') => ({ kind, tool, ok: true, state: 'done', summary: `${tool}: K` });

// Reads that follow each other fold into one row; a running or failed read and what the user looks for stay rows.
const items = groupSteps([look('search_models'), look('describe_canvas'), act('report', 'note'), look('list_combos', false), look('search_images')]);
assert.deepEqual(items.map(item => item.type), ['looks', 'step', 'step', 'looks']);
assert.equal(items[0].steps.length, 2);
const inFlight = groupSteps([look('search_models'), look('describe_canvas', true, 'running')]);
assert.deepEqual(inFlight.map(item => item.type), ['looks', 'step'], 'an in-flight read stays visible until it finishes');
assert.deepEqual(groupSteps(undefined), []);
assert.deepEqual(lookTools([look('a'), look('b'), look('a')]), [{ tool: 'a', count: 2 }, { tool: 'b', count: 1 }]);

// The AI's work in a row (reads, canvas changes, decisions) folds into a chain of three or more.
const work = [look('find_nodes'), act('add_node'), act('add_node'), act('connect_nodes'), act('log_decision', 'decision'), act('run_workflow', 'run'), look('run_status')];
const chained = groupSteps(work);
assert.deepEqual(chained.map(item => item.type), ['chain', 'step', 'looks']);
assert.equal(chained[0].steps.length, 5);
assert.deepEqual(chainTools(chained[0].steps), [{ tool: 'look', kind: 'look', count: 1 }, { tool: 'add_node', kind: 'canvas', count: 2 },
    { tool: 'connect_nodes', kind: 'canvas', count: 1 }, { tool: 'log_decision', kind: 'decision', count: 1 }]);
assert.deepEqual(foldLooks(chained[0].steps).map(item => item.type), ['looks', 'step', 'step', 'step', 'step'], 'a chain opens to its steps, reads still folded');
assert.deepEqual(groupSteps([look('a'), act('set_prompt'), look('b')]).map(item => item.type), ['looks', 'step', 'looks'], 'one change among reads stays in sight');
assert.deepEqual(groupSteps([act('set_prompt'), act('set_values')]).map(item => item.type), ['step', 'step'], 'two steps stay as they are');
assert.deepEqual(groupSteps([look('a'), look('b'), look('c')]).map(item => item.type), ['looks'], 'only reads stay a row of reads');
const broken = groupSteps([act('add_node'), act('add_node'), { ...act('connect_nodes'), ok: false }, act('add_node'), act('add_node'), act('add_node')]);
assert.deepEqual(broken.map(item => item.type), ['step', 'step', 'step', 'chain'], 'a failed step stays in sight and splits the work');
assert.deepEqual(groupSteps([act('add_node'), act('add_node'), { ...act('set_values'), state: 'asking' }]).map(item => item.type), ['step', 'step', 'step'],
    'a step waiting at a gate is not folded away');

// Words.
assert.equal(toolKey('place_combo'), 'aiTool_place_combo');
assert.equal(toolKey('x<y>'), 'aiTool_xy');
assert.equal(stepDetail(act('place_combo')), 'K');
assert.equal(stepDetail({ tool: 'describe_canvas', summary: 'describe_canvas' }), '');
assert.equal(stepDetail({ tool: 'report', summary: 'something else' }), 'something else');

// A task's state and counts.
assert.equal(taskState({ live: true, errors: 1 }), 'live');
assert.equal(taskState({ live: true, asks: 1 }), 'asks', 'a question waiting for the user comes first');
assert.equal(taskState({ waiting: true }), 'waiting', 'a task the user started, before an AI takes it');
assert.deepEqual(taskCounts({ asks: 2 }), [{ key: 'aiCountAsks', values: { count: 2 } }]);
assert.equal(taskState({ errors: 2 }), 'error');
assert.equal(taskState({}), 'idle', 'silence without an explicit end is not completion');
assert.equal(taskState({ ended: 100 }), 'done');
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

// Output-only reuse: never compare an input/temp file with a same-named output by accident.
assert.equal(outputPicture({ filename: 'a.png', folder: 'temp' }), null);
assert.equal(outputPicture({ filename: 'a.mp4' }), null);
assert.equal(outputPicture({ filename: 'a.flac' }), null);
assert.deepEqual(outputPicture({ filename: 'a.png', subfolder: 'x' }), { type: 'output', filename: 'a.png', subfolder: 'x' });
const repeated = uniquePictures([{ filename: 'a.png' }, { filename: 'a.png', folder: 'output' }, { filename: 'a.png', subfolder: 'b' }]);
assert.equal(repeated.length, 2);
assert.notEqual(pictureKey(repeated[0]), pictureKey(repeated[1]));
assert.match(picturePreview({ filename: 'a b.png', subfolder: 'x/y' }), /^\/anomalous\/output_thumbnail\?filename=a\+b.png&subfolder=x%2Fy$/);
assert.equal(picturePreview({ filename: 'a.mp4' }), outputUrl({ filename: 'a.mp4' }));
assert.equal(pictureShown({ filename: 'a b.png', subfolder: 'x' }), '/anomalous/output_preview?filename=a+b.png&subfolder=x', 'larger views: never the huge original');
assert.equal(pictureShown({ filename: 'a.png', folder: 'input' }), outputUrl({ filename: 'a.png', folder: 'input' }));

// How long a step took.
assert.equal(duration(400), null);
assert.deepEqual(duration(48_200), { key: 'aiSeconds', values: { count: 48 } });
assert.deepEqual(duration(150_000), { key: 'aiMinutes', values: { count: 3 } });

// The flow: stages in the order they came, each with its last step's state.
const staged = (id, stage, extra = {}) => ({ id, stage, ok: true, state: 'done', results: [], ...extra });
const flow = flowStages({ steps: [
    staged('a', 'model'), staged('b', 'prompt'), staged('c', 'model', { state: 'running' }),
    { id: 'd', kind: 'note', ok: true, results: [{ type: 'image', filename: 'x.png' }] }, { id: 'e', kind: 'user', ok: true },
    staged('f', 'run', { state: 'asking' }), staged('g', 'canvas', { ok: false, state: 'stopped' }),
] });
assert.deepEqual(flow.map(item => [item.stage, item.state, item.first, item.count]), [
    ['model', 'running', 'a', 2], ['prompt', 'done', 'b', 1], ['picture', 'done', 'd', 1], ['run', 'asking', 'f', 1], ['canvas', 'error', 'g', 1],
]);
assert.deepEqual(flowStages(null), []);

// The activity entries a task shows: the AI's canvas changes and the user's own.
assert.deepEqual(activityIds({ steps: [{ results: [{ type: 'canvas', activity: 'a1' }, { type: 'model' }] }, { tool: 'user_activity', activity: 'u1', results: [] }] }), ['a1', 'u1']);

console.log('ai_task_view: ok');

// What a panel holds, for its card in the timeline.
assert.deepEqual(panelGist({ blocks: [{ type: 'heading' }, { type: 'slider' }, { type: 'images', items: [{}, {}] }] }),
    { icon: 'image', parts: [{ key: 'aiGistCompare', values: {} }, { key: 'aiGistPictures', values: { count: 2 } }] });
assert.equal(panelGist({ blocks: [{ type: 'choices', options: [{}, {}] }, { type: 'images', items: [{}] }] }).icon, 'question', 'a question comes first');
assert.deepEqual(panelGist({ blocks: [{ type: 'run_map' }] }), { icon: 'nodes', parts: [{ key: 'aiGistMap', values: {} }] });
assert.deepEqual(panelGist({ blocks: [{ type: 'text' }] }), { icon: 'panel', parts: [] }, 'words only: no line under the title');
console.log('ai_task_view: panel gist ok');

// Results: each thing once, the steps that brought pictures newest first, the newest picture still there to keep from.
const outputs = taskOutputs({ steps: [
    { id: 'r1', results: [{ type: 'image', filename: 'a.png' }, { type: 'image', filename: 'b.png' }, { type: 'canvas', activity: 'e1' }] },
    { id: 'c1', results: [{ type: 'combo', name: 'K' }, { type: 'model', model_id: 'm1' }, { type: 'canvas', activity: 'e2' }] },
    { id: 'r2', results: [{ type: 'image', filename: 'c.png', gone: true }, { type: 'image', filename: 'a.png' }, { type: 'image', filename: 'v.mp4' }] },
    { id: 'n1', results: [{ type: 'combo', name: 'K' }, { type: 'model', model_id: 'm1' }, { type: 'download', file: 'hand.safetensors', size: 9 },
        { type: 'audio', file: 'audio/A/1.flac' }, { type: 'scan' }] },
] });
assert.deepEqual(outputs.runs.map(run => [run.step.id, run.pictures.map(image => image.filename)]), [['r2', ['c.png', 'v.mp4']], ['r1', ['a.png', 'b.png']]]);
assert.deepEqual([outputs.combos.length, outputs.models.length, outputs.downloads.map(item => item.file), outputs.audio.length, outputs.canvas], [1, 1, ['hand.safetensors'], 1, 2]);
assert.equal(outputCount(outputs), 4 + 1 + 1 + 1 + 1);
assert.deepEqual(newestPicture(outputs), { type: 'output', filename: 'a.png', subfolder: '' }, 'past a deleted picture and a video');
assert.equal(newestPicture(taskOutputs({ steps: [] })), null);
assert.equal(outputCount(taskOutputs(null)), 0);
console.log('ai_task_view: results ok');
