// What the review console rehearses (web/modules/review_scenarios.js): every task, in both languages, says on the
// canvas card what its name promises through the card's own rules (ai_float_state.js); a press on the card moves it
// on as the server would; the rail pins of a new, an upgraded and a full user are the rail's own shape.
import assert from 'node:assert/strict';
import {
    attentionKeys, dismissFloat, floatOutcome, floatState, liftDismissal, pickFloatAsk, shouldShowFloat,
} from '../web/modules/ai_float_state.js';
import { loadRailPins } from '../web/modules/rail_pins.js';
import { REVIEW_SCENARIOS, applyPreviewAction, buildPreviewTask, railPreset } from '../web/modules/review_scenarios.js';

const NOW = 50_000;
const KINDS = {
    tool: 'tool', run: 'run', thinking: 'thinking', ask_choice: 'ask', ask_input: 'ask', ask_workbench: 'ask', gate: 'gate',
    paused: 'halt', done: 'done', error: 'error', chat_only_quiet: 'tool', chat_only_gate: 'gate',
};
const shows = (task, extra = {}) => shouldShowFloat({ task, watching: task.chat_only ? null : task.id, at: NOW, ...extra });

assert.equal(REVIEW_SCENARIOS.length, 12);
assert.deepEqual(new Set(REVIEW_SCENARIOS.map(scene => scene.group)), new Set(['live', 'action', 'other']));
for (const scene of REVIEW_SCENARIOS) {
    for (const locale of ['zh', 'en']) {
        const task = buildPreviewTask(scene.id, { locale, now: NOW });
        assert.equal(task.id, `preview_${scene.id}`);
        assert.equal(task._preview, true);
        assert.ok(task.title && task.title !== scene.id, `${scene.id} ${locale} has a name`);
        assert.equal(new Set(task.steps.map(step => step.id)).size, task.steps.length, `${scene.id}: step ids are one each`);
        assert.equal(floatState(task, NOW).kind, KINDS[scene.id], `${scene.id} ${locale}`);
        assert.equal(shows(task), scene.id !== 'chat_only_quiet', `${scene.id} ${locale} on the card`);
        assert.deepEqual(JSON.parse(JSON.stringify(task)), task, 'plain data, as the server sends it');
    }
}
assert.notEqual(buildPreviewTask('run', { locale: 'zh' }).title, buildPreviewTask('run', { locale: 'en' }).title);
assert.ok(/[a-z]/i.test(buildPreviewTask('ask_choice', { locale: 'en', now: NOW }).steps[1].panel.blocks[0].question));

// What the questions look like on the card.
const choice = buildPreviewTask('ask_choice', { now: NOW });
assert.equal(pickFloatAsk(choice).inline, 'choices');
assert.equal(choice.steps[1].panel.blocks[0].options.filter(option => option.recommended).length, 1);
assert.equal(pickFloatAsk(buildPreviewTask('ask_input', { now: NOW })).inline, 'input');
assert.equal(pickFloatAsk(buildPreviewTask('ask_workbench', { now: NOW })).inline, null, 'to the workbench');
assert.deepEqual(floatOutcome(buildPreviewTask('done', { now: NOW })), { made: 2, images: 2, canvas: 2, failed: 0 });
assert.equal(floatOutcome(buildPreviewTask('error', { now: NOW })).failed, 1);
assert.equal(floatState(buildPreviewTask('thinking', { now: NOW }), NOW).step.tool, 'set_prompt', '"last step": the prompt');
assert.equal(floatState(buildPreviewTask('run', { now: NOW, percent: 35 }), NOW).step.progress.percent, 35);

// A press on the card, as the server would answer it; the task given stays as it was.
const act = (task, action) => applyPreviewAction(task, action, { now: NOW + 1 });
for (const id of ['gate', 'chat_only_gate']) {
    const task = buildPreviewTask(id, { now: NOW });
    const allowed = act(task, { type: 'allow' });
    assert.equal(allowed.receiptKey, 'reviewDid_allow');
    assert.equal(attentionKeys(allowed.task).length, 0);
    assert.equal(task.steps[1].state, 'asking', 'not changed in place');
    const denied = act(task, { type: 'deny' });
    assert.equal(denied.task.steps[1].ok, false);
    assert.equal(denied.receiptKey, 'reviewDid_deny');
    if (id === 'gate') assert.equal(floatState(allowed.task, NOW + 1).kind, 'thinking', 'the AI goes on');
    else assert.ok(!shows(allowed.task) && !shows(denied.task), 'pure chat: the card goes with its gate');
}
const picked = act(choice, { type: 'answer', step: 'p2', block: 'light', choice: ['o2'] });
assert.deepEqual([picked.receiptKey, picked.receiptParams], ['reviewDid_choice', { choice: '黄昏的暖光' }]);
assert.equal(pickFloatAsk(picked.task), null);
assert.equal(floatState(picked.task, NOW + 1).kind, 'thinking');
const typed = act(buildPreviewTask('ask_input', { now: NOW }), { type: 'answer', step: 'p2', block: 'title', text: '冬日' });
assert.deepEqual([typed.receiptKey, typed.receiptParams, pickFloatAsk(typed.task)], ['reviewDid_text', { text: '冬日' }, null]);
const skipped = act(choice, { type: 'skip', step: 'p2', block: 'light', skip: true });
assert.deepEqual([skipped.receiptKey, pickFloatAsk(skipped.task)], ['reviewDid_skip', null]);
assert.equal(act(choice, { type: 'answer', step: 'nope', block: 'light', choice: ['o1'] }).receiptKey, null);

const run = buildPreviewTask('run', { now: NOW });
const paused = act(run, { type: 'pause' });
assert.equal(floatState(paused.task, NOW + 1).kind, 'halt');
assert.equal(floatState(paused.task, NOW + 1).step.pause, true);
assert.equal(floatState(act(paused.task, { type: 'say', text: 'go on' }).task, NOW + 1).kind, 'run', 'a line to the AI lifts the pause');
const moved = act(run, { type: 'progress', percent: 85 }).task;
assert.deepEqual(floatState(moved, NOW).step.progress, { state: 'running', node: 'KSampler', value: 17, max: 20, percent: 85 });
assert.equal(act(run, { type: 'progress', percent: 140 }).task.steps.at(-1).progress.percent, 100);
const stopped = act(run, { type: 'stop' });
assert.equal(stopped.receiptKey, 'reviewDid_stop');
assert.equal(stopped.task.steps.at(-1).progress.stopping, true);
const said = act(run, { type: 'say', text: '狐狸要坐着' });
assert.deepEqual([said.receiptKey, said.receiptParams, said.task.steps.at(-1).kind], ['reviewDid_say', { text: '狐狸要坐着' }, 'user']);
assert.equal(act(run, { type: 'nothing' }).receiptKey, null);
assert.equal(act(run, { type: 'open_workbench' }).receiptKey, 'reviewDid_open');

// × on the card, then a new gate wakes it.
const gate = buildPreviewTask('gate', { now: NOW });
const dismissed = dismissFloat(gate);
assert.equal(liftDismissal(dismissed, gate), dismissed, 'the same gate keeps it shut');
const again = act(gate, { type: 'inject_gate' });
assert.equal(again.receiptKey, 'reviewDid_gate');
assert.equal(liftDismissal(dismissed, again.task), null, 'a new gate lifts the ×');
assert.equal(new Set(again.task.steps.map(step => step.id)).size, again.task.steps.length);
const quiet = act(buildPreviewTask('chat_only_quiet', { now: NOW }), { type: 'inject_gate' }).task;
assert.ok(shows(quiet), 'a gate brings the pure-chat card');
const reopened = act(buildPreviewTask('done', { now: NOW }), { type: 'inject_gate' }).task;
assert.equal(reopened.ended, null);
assert.equal(floatState(reopened, NOW + 1).kind, 'gate');

// The rail pins of a user, as rail_pins.js keeps them (read back unchanged), never kept here.
const read = preset => loadRailPins({ getItem: key => (key === 'anomalous_rail_pins' ? JSON.stringify(preset) : null) });
for (const mode of ['fresh', 'upgraded', 'full']) assert.deepEqual(read(railPreset(mode)), railPreset(mode), mode);
assert.deepEqual(railPreset('fresh').pinned, ['home', 'models', 'gallery', 'recipes', 'doctor']);
assert.deepEqual(railPreset('upgraded').pinned.slice(5), ['combos', 'prompts', 'ai', 'saves', 'scan']);
assert.equal(railPreset('upgraded').seeded, 'upgraded');
assert.equal(railPreset('full').pinned.length, 13);
assert.equal(railPreset('full').customized, true);

console.log('review_scenarios: every rehearsal, the presses on the card and the rail users passed');
