import assert from 'node:assert/strict';
import { stuckReason } from '../web/modules/ai_stuck.js';
import { haltOf } from '../web/modules/ai_task_status.js';

const NOW = 10000;
const ai = (tool, more = {}) => ({ id: tool, tool, kind: 'look', state: 'done', ok: true, at: NOW - 30, ...more });
const user = (tool, more = {}) => ({ id: tool, tool, kind: 'user', ok: true, at: NOW - 20, delivered: false, ...more });
const why = task => stuckReason(task, NOW).why;

assert.equal(why({ waiting: true, steps: [user('user_message')] }), 'unstarted', 'no AI took it yet');

const task = { title: 'Lake', started: NOW - 600, steps: [ai('describe_canvas')] };
assert.equal(why(task), 'fresh', 'heard from a moment ago: it may be at its next step');
task.steps[0].at = NOW - 400;
assert.deepEqual(stuckReason(task, NOW), { why: 'quiet', seconds: 400 });

task.steps.push(ai('set_prompt', { kind: 'canvas', ok: false, state: 'error', at: NOW - 300 }));
assert.equal(why(task), 'failed', "the AI's last step did not go through");

const run = ai('run_workflow', { kind: 'run', state: 'done', call_ai: true, at: NOW - 200 });
task.steps.push(run);
assert.equal(why(task), 'ran', 'a run ended that the AI was not told of');
run.state = 'error';
assert.equal(why(task), 'ranFailed');
Object.assign(run, { state: 'running', progress: { state: 'running', percent: 40 } });
assert.deepEqual(stuckReason(task, NOW), { why: 'running', percent: 40 });
Object.assign(run, { state: 'done', call_ai: false });

const tool = ai('add_nodes', { kind: 'canvas', state: 'running', at: NOW - 20 });
task.steps.push(tool);
assert.equal(why(task), 'tool');
tool.at = NOW - 300;
assert.deepEqual(stuckReason(task, NOW), { why: 'toolLong', tool: 'add_nodes', seconds: 300 });
tool.state = 'done';

const panel = ai('ask_user', { kind: 'panel', panel: { blocks: [{ id: 'a', type: 'choices' }, { id: 'b', type: 'text' }] }, answers: {} });
task.steps.push(panel);
assert.deepEqual(stuckReason(task, NOW), { why: 'asks', count: 1 });
panel.answers.a = { choice: ['x'] };

task.steps.push(ai('download_model', { kind: 'download', state: 'asking', gate: { gate: 'download' } }));
assert.deepEqual(stuckReason(task, NOW), { why: 'gate', tool: 'download_model' }, 'a step waiting for an OK comes before a question');

task.steps.push(user('user_halt'));
assert.equal(why(task), 'halted', 'a halt comes before all that');
assert.equal(haltOf(task).tool, 'user_halt');
task.steps.push(ai('describe_canvas'), ai('set_prompt', { kind: 'canvas', ok: false }));
assert.equal(why(task), 'halted', "the AI's reads and refused calls leave it standing");
task.steps.push(ai('set_prompt', { kind: 'canvas' }));
assert.equal(haltOf(task), null, 'the AI acting again, on the user\'s word in its chat, ends it');

assert.equal(why({ ended: NOW - 50, steps: [ai('report', { kind: 'note' })] }), 'ended');
console.log('ai_stuck: what a task waits for passed');
