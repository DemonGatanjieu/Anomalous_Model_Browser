import assert from 'node:assert/strict';
import { MAX_EACH, MAX_TOTAL, OWN, still, toggled, total, valuesOf, withTimes } from '../web/modules/preset_run_list.js';

// The list: a press lines a preset up at the end, another takes it off; each runs 1 to MAX_EACH times.
let picks = [{ file: OWN, times: 1 }];
picks = toggled(picks, 'night.json');
picks = toggled(picks, 'snow.json');
assert.deepEqual(picks.map(pick => pick.file), [OWN, 'night.json', 'snow.json'], 'in the order pressed');
picks = toggled(picks, OWN);
assert.deepEqual(picks.map(pick => pick.file), ['night.json', 'snow.json']);
picks = withTimes(picks, 'snow.json', 4);
assert.equal(total(picks), 5);
assert.equal(withTimes(picks, 'snow.json', 99)[1].times, MAX_EACH);
assert.equal(withTimes(picks, 'snow.json', '')[1].times, 1, 'a field emptied while typing');
assert.equal(withTimes(picks, 'snow.json', -3)[1].times, 1);

// "The same again": what was kept, as far as it is still saved.
const workflows = [{ file: 'lake.json', name: 'Lake', presets: [{ file: 'night.json', name: 'Night' }, { file: 'snow.json', name: 'Snow' }] }];
const kept = { workflow: 'lake.json', picks: [{ file: 'night.json', times: 2 }, { file: 'gone.json', times: 1 }, { file: OWN, times: 1 }, { file: 'night.json', times: 5 }], close: false };
assert.deepEqual(still(kept, workflows), { workflow: workflows[0], picks: [{ file: 'night.json', times: 2 }, { file: OWN, times: 1 }], close: false },
    'a preset removed since is left out, one kept twice runs once');
assert.equal(still({ workflow: 'lake.json', picks: [{ file: 'night.json', times: 1 }] }, workflows).close, true, 'the tab closes unless they said not to');
assert.equal(still({ ...kept, workflow: 'other.json' }, workflows), null, 'the saved workflow is gone');
assert.equal(still({ workflow: 'lake.json', picks: [{ file: 'gone.json', times: 1 }] }, workflows), null, 'nothing of it is left');
assert.equal(still(null, workflows), null);
assert.equal(still({ workflow: 'lake.json', picks: 'x' }, workflows), null, 'not a list this page wrote');
assert.ok(MAX_TOTAL >= MAX_EACH);

// What a canvas would run with: moving a node is no change, a value or a link is.
const state = { nodes: [{ id: 3, type: 'KSampler', pos: [0, 0], widgets_values: [8, 'euler'], inputs: [{ link: 5 }] }, { id: 9, type: 'SaveImage', pos: [9, 9] }] };
const moved = { nodes: [{ ...state.nodes[1], pos: [300, 20] }, { ...state.nodes[0], pos: [50, 60] }] };
assert.equal(valuesOf(moved), valuesOf(state), 'where the nodes lie, and their order, are not in it');
assert.notEqual(valuesOf({ nodes: [{ ...state.nodes[0], widgets_values: [12, 'euler'] }, state.nodes[1]] }), valuesOf(state));
assert.notEqual(valuesOf({ nodes: [{ ...state.nodes[0], inputs: [{ link: null }] }, state.nodes[1]] }), valuesOf(state));
assert.notEqual(valuesOf({ nodes: [{ ...state.nodes[0], mode: 4 }, state.nodes[1]] }), valuesOf(state), 'a node switched off');
console.log('preset_run_list: the list of presets to run, what is kept of it and what a canvas runs with passed');
