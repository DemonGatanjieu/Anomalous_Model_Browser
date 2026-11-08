// The job sheet's rules (web/modules/job_sheet_plan.js): prompts from pasted text, rows, runs, seeds, outcomes.
import assert from 'node:assert/strict';
import { bounded, jobAt, outcomeOf, promptsOf, restLeft, room, rowsOf, seedOf, slotsOf, totalOf } from '../web/modules/job_sheet_plan.js';

// A line each; empty lines and spaces around go.
assert.deepEqual(promptsOf('a cat\r\n\r\n  a dog  \nbird\n'), ['a cat', 'a dog', 'bird']);
// Blocks: a prompt of several lines, parted by an empty line (spaces on it too).
assert.deepEqual(promptsOf('a cat,\nsitting\n \t\na dog\n\n\n', true), ['a cat,\nsitting', 'a dog']);
assert.deepEqual(promptsOf(''), []);

assert.equal(bounded('7', 1, 50, 1), 7);
assert.equal(bounded('99', 1, 50, 1), 50);
assert.equal(bounded('x', 1, 50, 1), 1);
assert.equal(bounded('2.6', 0, 10, 0), 3);

// No prompt: the canvas as it is, that many times.
assert.deepEqual(rowsOf([], 5), [{ count: 5 }]);
const rows = rowsOf(['a', 'b'], 3);
assert.deepEqual(rows, [{ prompt: 'a', count: 3 }, { prompt: 'b', count: 3 }]);
assert.equal(totalOf(rows), 6);

// Runs go row by row, each row's runs together.
assert.deepEqual(jobAt(rows, 0), { row: 0, round: 0 });
assert.deepEqual(jobAt(rows, 2), { row: 0, round: 2 });
assert.deepEqual(jobAt(rows, 3), { row: 1, round: 0 });
assert.equal(jobAt(rows, 6), null);
assert.deepEqual(jobAt([{ count: 1 }, { prompt: 'x', count: 2 }], 2), { row: 1, round: 1 });

// The same seeds: round r of every row has the same one; else a new one each run.
assert.equal(seedOf({ same_seeds: true, base: 100 }, 2), 102);
assert.equal(seedOf({ same_seeds: false, base: 100 }, 2), null);

assert.deepEqual(slotsOf({ prompt: 'a', count: 2 }), { prompt: 'a' });
assert.deepEqual(slotsOf({ values: { cfg: 5 }, negative: 'blur', count: 1 }), { negative: 'blur', values: { cfg: 5 } });
assert.deepEqual(slotsOf({ count: 4 }), {});

// How a run ended, by its history.
assert.deepEqual(outcomeOf(undefined), { outcome: 'gone', why: '' });
assert.deepEqual(outcomeOf({ status: { status_str: 'success', completed: true } }), { outcome: 'ok', why: '' });
assert.equal(outcomeOf({ status: { status_str: 'error', messages: [['execution_start', {}], ['execution_interrupted', {}]] } }).outcome, 'interrupted');
assert.deepEqual(outcomeOf({ status: { status_str: 'error', messages: [['execution_error', { node_type: 'KSampler', exception_message: 'out of memory' }]] } }),
    { outcome: 'error', why: 'KSampler: out of memory' });

// The pause after a run; none before the first or with no pause.
assert.equal(restLeft({ pause: 10 }, 1000, 4000), 7000);
assert.equal(restLeft({ pause: 10 }, 0, 4000), 0);
assert.equal(restLeft({ pause: 0 }, 1000, 1001), 0);
assert.equal(restLeft({ pause: 2 }, 1000, 9000), 0);

// With a pause one run at a time; with none one waits behind the one going.
assert.equal(room({ pause: 5, pending: [] }), true);
assert.equal(room({ pause: 5, pending: ['a'] }), false);
assert.equal(room({ pause: 0, pending: ['a'] }), true);
assert.equal(room({ pause: 0, pending: ['a', 'b'] }), false);

console.log('job_sheet_plan: ok');
