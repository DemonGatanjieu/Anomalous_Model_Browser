import assert from 'node:assert/strict';
import { callLines, NEW_CHAT } from '../web/modules/ai_call_lines.js';

const ai = (tool, more = {}) => ({ id: tool, tool, kind: 'look', state: 'done', at: 1, ...more });
const first = task => callLines(task)?.lines[0];

assert.equal(callLines(null), null);
assert.equal(callLines({ ended: 5, steps: [ai('report')] }), null, 'an ended task waits for nothing');
const waiting = { waiting: true, steps: [{ tool: 'user_message', kind: 'user', delivered: false }] };
assert.equal(callLines(waiting), null, 'a task waiting for its first AI has the line that starts it on its own card');

const task = { title: 'Sleepy girl', steps: [ai('begin_task'), ai('report', { kind: 'note' })] };
assert.deepEqual(callLines(task), { lead: 'aiCallLead', lines: ['aiCallGoOn', NEW_CHAT] });

task.steps.push({ tool: 'user_message', kind: 'user', delivered: false });
assert.equal(first(task), 'aiCallReplied', 'words the AI has not got');
task.steps.at(-1).delivered = true;
assert.equal(first(task), 'aiCallGoOn');
task.steps.push({ tool: 'user_activity', kind: 'user', delivered: false });
assert.equal(first(task), 'aiCallGoOn', 'something the user changed is not a reply');

const panel = ai('ask_user', { kind: 'panel', answers: { answer: { choice: ['fix'], delivered: false } } });
task.steps.push(panel);
assert.equal(first(task), 'aiCallReplied', 'an answer on a panel the AI stopped waiting for');
panel.answers.answer.delivered = true;
const gate = ai('run_workflow', { kind: 'run', state: 'allowed', gate: { timed_out: true, decision: 'allow', delivered: false } });
task.steps.push(gate);
assert.equal(first(task), 'aiCallReplied', 'a gate answered after the AI stopped waiting');
gate.gate.delivered = true;

const run = ai('run_workflow', { kind: 'run', state: 'done', call_ai: true });
task.steps.push(run, { tool: 'user_message', kind: 'user', delivered: false });
assert.deepEqual(callLines(task), { lead: 'aiCallDoneLead', lines: ['aiCallDone', 'aiCallAgain', NEW_CHAT] }, 'a run that ended comes first');
run.state = 'error';
assert.deepEqual(callLines(task).lines, ['aiCallFailed', NEW_CHAT]);
delete run.call_ai;
assert.equal(first(task), 'aiCallReplied', 'once told of the run, the reply is left');
console.log('ai_call_lines: lines by what waits for the AI passed');
