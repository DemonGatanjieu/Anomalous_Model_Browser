// The AI's card over the canvas (web/modules/ai_float_state.js): when it shows, what it says first,
// which task it follows, the user's × and what brings the card back, and where it may stand.
import assert from 'node:assert/strict';
import {
    ACTIVE_SECONDS, QUIET_SECONDS, attentionKey, attentionKeys, clampFloatPosition, dismissFloat, floatEligible, floatOutcome, floatState,
    floatTone, floatWakeIn, hasNewAttention, isTaskActive, lastSettledStep, liftDismissal, parseFloatPosition, pickFloatAsk,
    pickTracked, shouldAutoShowOnBoot, shouldShowFloat, unresolvedFailures,
} from '../web/modules/ai_float_state.js';

const NOW = 10_000;
const step = (id, extra = {}) => ({ id, tool: 'describe_canvas', kind: 'look', ok: true, state: 'done', at: NOW - 5, ...extra });
const task = (id, steps, extra = {}) => ({ id, title: id, started: NOW - 600, ended: null, waiting: false, steps, ...extra });
const choices = (id, count, extra = {}) => ({ id, type: 'choices', question: 'Which?', options: Array.from({ length: count }, (_, at) => ({ id: `o${at}`, label: `O${at}` })), ...extra });
const panel = (id, blocks, extra = {}) => step(id, { tool: 'show_panel', kind: 'panel', panel: { title: 'P', blocks }, answers: {}, ...extra });
const gate = (id, extra = {}) => step(id, { tool: 'run_workflow', kind: 'run', state: 'asking', gate: { gate: 'gpu', lines: [{ label: 'nodes', value: '12' }] }, ...extra });

// Whether an AI is at work, from the full record.
assert.ok(!isTaskActive(null, NOW));
assert.ok(isTaskActive(task('a', [step('s1')]), NOW), 'the AI was here seconds ago');
assert.ok(!isTaskActive(task('a', [step('s1', { at: NOW - ACTIVE_SECONDS - 1 })]), NOW), 'gone quiet');
assert.ok(isTaskActive(task('a', [step('s1', { at: NOW - 3000, state: 'running' })]), NOW), 'a call going counts however long');
assert.ok(isTaskActive(task('a', [gate('g1', { at: NOW - 3000 })]), NOW), 'a gate waiting counts');
assert.ok(!isTaskActive(task('a', [step('s1')], { ended: NOW }), NOW));
assert.ok(!isTaskActive(task('a', [step('u', { kind: 'user', tool: 'user_message' })], { waiting: true }), NOW), 'no AI took it yet');
assert.ok(!isTaskActive(task('a', [step('s1'), step('h', { kind: 'user', tool: 'user_halt', pause: true })]), NOW), 'paused by the user');
assert.ok(!isTaskActive(task('a', [step('u', { kind: 'user', tool: 'user_message' })]), NOW), 'only the user wrote');

// The page loading: the newest row decides, never an ended or quiet task.
assert.ok(!shouldAutoShowOnBoot(null, NOW));
assert.ok(shouldAutoShowOnBoot({ live: true, updated: NOW - 5000 }, NOW), 'a run going');
assert.ok(shouldAutoShowOnBoot({ asks: 1, updated: NOW - 600 }, NOW), 'a question asked lately');
assert.ok(!shouldAutoShowOnBoot({ asks: 1, updated: NOW - 3600 }, NOW), 'a question left long ago');
assert.ok(shouldAutoShowOnBoot({ updated: NOW - 10 }, NOW), 'the AI here just now');
assert.ok(!shouldAutoShowOnBoot({ updated: NOW - 600 }, NOW), 'idle history');
assert.ok(!shouldAutoShowOnBoot({ live: true, ended: NOW - 1, updated: NOW }, NOW), 'ended');
assert.ok(!shouldAutoShowOnBoot({ live: true, halted: true, updated: NOW }, NOW), 'halted');
assert.ok(!shouldAutoShowOnBoot({ waiting: true, updated: NOW }, NOW), 'waiting for an AI');

// What the card says first, in order.
const run = step('r1', { tool: 'run_workflow', kind: 'run', state: 'running', at: NOW - 30, prompt_ids: ['p'], progress: { state: 'running', max: 20, value: 5 } });
assert.equal(floatState(task('a', [run]), NOW).kind, 'run');
assert.equal(floatTone(task('a', [run]), NOW), 'running');
assert.equal(floatState(task('a', [step('s1', { state: 'running' })]), NOW).kind, 'tool');
assert.equal(floatState(task('a', [run, gate('g1')]), NOW).kind, 'gate', 'a gate before the run');
assert.equal(floatTone(task('a', [gate('g1')]), NOW), 'asking');
assert.equal(floatState(task('a', [panel('p1', [choices('b1', 2)])]), NOW).kind, 'ask');
const halted = task('a', [run, gate('g1'), step('h', { kind: 'user', tool: 'user_halt', pause: true })]);
assert.equal(floatState(halted, NOW).kind, 'halt', 'a pause before all else');
assert.equal(floatTone(halted, NOW), 'paused');
assert.equal(floatState(task('a', [step('u', { kind: 'user', tool: 'user_message' })], { waiting: true }), NOW).kind, 'waiting');
assert.equal(floatState(task('a', [step('s1')], { ended: NOW }), NOW).kind, 'done');
assert.equal(floatState(task('a', [step('s1', { ok: false, state: 'error' })], { ended: NOW }), NOW).kind, 'error');

// Between two calls the card stays and says so: thinking, then idle, then (for a card that opened by itself) gone.
const gap = task('a', [step('s1', { tool: 'place_combo', kind: 'canvas', at: NOW - 20 }), step('u', { kind: 'user', tool: 'user_message', at: NOW - 1 })]);
assert.equal(floatState(gap, NOW).kind, 'thinking');
assert.equal(floatState(gap, NOW).step.tool, 'place_combo', 'the last step of the AI, not the user');
assert.equal(lastSettledStep(task('a', [step('s1', { state: 'running' })])), null);
assert.equal(floatTone(gap, NOW), 'tool');
assert.equal(floatWakeIn(gap, NOW), ACTIVE_SECONDS - 20, 'woken when thinking turns idle');
const later = NOW + ACTIVE_SECONDS;
assert.equal(floatState(gap, later).kind, 'idle');
assert.equal(floatWakeIn(gap, later), QUIET_SECONDS - (ACTIVE_SECONDS + 20));
assert.ok(shouldShowFloat({ task: gap, watching: 'a', at: later }), 'a card watching does not blink away in a pause');
assert.ok(!shouldShowFloat({ task: gap, at: later }), 'one not shown yet does not open for an idle task');
assert.ok(!shouldShowFloat({ task: gap, watching: 'a', at: NOW + QUIET_SECONDS }), 'long quiet: it goes');
assert.ok(shouldShowFloat({ task: gap, pinnedTaskId: 'a', at: NOW + QUIET_SECONDS }), 'put on the canvas: it stays');
assert.equal(floatWakeIn(task('a', [run]), NOW), null);

// When the card shows.
const working = task('a', [step('s1', { state: 'running' })]);
assert.ok(shouldShowFloat({ task: working, at: NOW }));
assert.ok(!shouldShowFloat({ task: working, browserOpen: true, at: NOW }), 'AMB\'s window open: the card steps back');
assert.ok(!shouldShowFloat({ task: null }));
const ended = task('a', [step('s1')], { ended: NOW });
assert.ok(shouldShowFloat({ task: ended, watching: 'a', at: NOW }), 'its end, to the card that watched it');
assert.ok(!shouldShowFloat({ task: ended, at: NOW }), 'never a task that ended before');
assert.ok(!shouldShowFloat({ task: ended, pinnedTaskId: 'a', at: NOW }), 'on the canvas but not watched end: no');
const waiting = task('w', [], { waiting: true });
assert.ok(!shouldShowFloat({ task: waiting, at: NOW }));
assert.ok(shouldShowFloat({ task: waiting, pinnedTaskId: 'w', at: NOW }), 'a waiting task the user put on the canvas');

// The user's ×: the AI goes on; the card comes back for something new to decide only.
const asking = task('a', [gate('g1')]);
assert.deepEqual(attentionKeys(asking), ['gate:g1']);
const closed = dismissFloat(asking);
assert.ok(!shouldShowFloat({ task: asking, dismissed: closed, at: NOW }));
assert.equal(liftDismissal(closed, asking), closed, 'the same gate keeps it closed');
const answered = task('a', [{ ...gate('g1'), state: 'done' }, step('s2', { state: 'running' })]);
assert.equal(liftDismissal(closed, answered), closed, 'progress does not bring it back');
const newGate = task('a', [{ ...gate('g1'), state: 'done' }, gate('g2')]);
assert.equal(liftDismissal(closed, newGate), null, 'a new gate does');
const newAsk = task('a', [gate('g1'), panel('p1', [choices('b1', 3)])]);
assert.equal(liftDismissal(closed, newAsk), null, 'so does a new question');
assert.equal(liftDismissal(closed, task('b', [gate('g9')])), closed, 'another task leaves it as it is');
assert.ok(shouldShowFloat({ task: task('b', [step('s1', { state: 'running' })]), dismissed: closed, at: NOW }), 'a new task shows');
assert.equal(liftDismissal(null, asking), null);
assert.ok(hasNewAttention([], asking));
assert.ok(!hasNewAttention(['gate:g1'], asking));
assert.deepEqual(dismissFloat(null), null);

// What waits first, and which question shows on the card.
assert.equal(attentionKey(task('a', [gate('g1'), gate('g2')])), 'gate:g2', 'the newest gate first');
assert.equal(attentionKey(task('a', [panel('p1', [choices('b1', 2)]), panel('p2', [choices('b2', 2)])])), 'ask:p2:b2', 'the newest panel first');
assert.equal(attentionKey(task('a', [panel('p1', [choices('b1', 2)], { answers: { b1: { choice: ['o0'] } } })])), '', 'answered');
assert.equal(attentionKey(task('a', [panel('p1', [choices('b1', 2)], { panel: { title: 'P', closed: true, blocks: [choices('b1', 2)] } })])), '', 'a closed panel');
assert.equal(attentionKey(task('a', [gate('g1')], { ended: NOW })), '');
assert.equal(attentionKey(halted), '', 'nothing is asked of a paused task');
const asks = task('a', [panel('p1', [choices('one', 3), { id: 'line', type: 'input' }]), panel('p2', [choices('many', 7)])]);
assert.deepEqual(pickFloatAsk(asks), { step: asks.steps[1], block: asks.steps[1].panel.blocks[0], inline: null, more: 2 }, 'more than six: to the workbench');
const drafted = pickFloatAsk(asks, (s, b) => b.id === 'line');
assert.equal(drafted.block.id, 'line', 'a question half answered stays in front');
assert.equal(drafted.inline, 'input');
assert.equal(pickFloatAsk(task('a', [panel('p1', [choices('one', 6)])])).inline, 'choices');
assert.equal(pickFloatAsk(task('a', [panel('p1', [choices('one', 3, { multiple: true })])])).inline, null, 'several picks');
assert.equal(pickFloatAsk(task('a', [panel('p1', [{ id: 'k', type: 'picks', items: [] }])])).inline, null);
assert.equal(pickFloatAsk(task('a', [panel('p1', [{ id: 'k', type: 'plan', card: {} }])])).block.id, 'k', 'a plan waits for its nod');
assert.equal(pickFloatAsk(task('a', [panel('p1', [{ id: 'm', type: 'markdown' }])])), null, 'words only ask nothing');
assert.equal(pickFloatAsk(halted), null);

// Which task the card follows.
const quietA = task('a', [step('s1', { at: NOW - 600 })], { started: NOW - 900 });
const busyB = task('b', [step('s1', { state: 'running' })], { started: NOW - 100 });
assert.equal(pickTracked(null, busyB, { at: NOW }), busyB);
assert.equal(pickTracked(quietA, null, { at: NOW }), quietA);
assert.equal(pickTracked(quietA, { ...quietA, title: 'x' }, { at: NOW }).title, 'x', 'the same task, read again');
assert.equal(pickTracked(quietA, busyB, { at: NOW }), busyB, 'the followed one rests');
assert.equal(pickTracked(quietA, busyB, { pinnedTaskId: 'a', at: NOW }), quietA, 'put on the canvas, it keeps the card');
const askingB = task('b', [gate('g1')], { started: NOW - 2000 });
assert.equal(pickTracked(quietA, askingB, { pinnedTaskId: 'a', at: NOW }), askingB, 'a task asking comes first, even over one put on the canvas');
const askingA = task('a', [gate('g0')], { started: NOW - 900 });
assert.equal(pickTracked(askingA, busyB, { at: NOW }), askingA, 'a decision waiting is not taken from under the user');
assert.equal(pickTracked(askingA, askingB, { at: NOW }), askingA);
const olderBusy = task('c', [step('s1', { state: 'running' })], { started: NOW - 5000 });
assert.equal(pickTracked(busyB, olderBusy, { at: NOW }), busyB, 'an older task does not take the card from one at work');
assert.equal(pickTracked(ended, busyB, { at: NOW }), busyB, 'a new task after the end');

// What an ended task made, and failures made good.
const made = task('a', [
    step('r', { tool: 'run_workflow', kind: 'run', results: [{ type: 'image', filename: '1.png' }, { type: 'image', filename: '2.png' }] }),
    step('c', { tool: 'place_combo', kind: 'canvas', results: [{ type: 'canvas', activity: 'x' }] }),
], { ended: NOW });
assert.deepEqual(floatOutcome(made), { made: 2, images: 2, canvas: 1, failed: 0 });
assert.equal(unresolvedFailures([step('a', { tool: 't', ok: false, state: 'error', recovery_target: 'n1' }), step('b', { tool: 't', recovery_target: 'n1' })]), 0, 'tried again and done');
assert.equal(unresolvedFailures([step('a', { tool: 't', ok: false, state: 'error', recovery_target: 'n1' }), step('b', { tool: 't', recovery_target: 'n2' })]), 1, 'another target does not mend it');
assert.equal(unresolvedFailures([step('a', { tool: 't', ok: false, state: 'error' }), step('b', { tool: 't', recovery_target: 'n2' })]), 0, 'no target: any later success of the tool');
assert.equal(unresolvedFailures(undefined), 0);

// A task an AI app works on in its own chat (?tools=core): the card only for a gate, or when the user put it there.
const chat = (id, steps, extra = {}) => task(id, steps, { chat_only: true, ...extra });
assert.ok(!shouldAutoShowOnBoot({ live: true, updated: NOW - 5, chat_only: true, asks: 0 }, NOW), 'its runs stay in the chat');
assert.ok(shouldAutoShowOnBoot({ updated: NOW - 5, chat_only: true, asks: 1 }, NOW), 'a gate waits for the user');
for (const [what, quiet] of [
    ['a call going', chat('c', [step('s1', { state: 'running' })])],
    ['a run going', chat('c', [step('r', { tool: 'run_workflow', kind: 'run', state: 'running', run: { state: 'running' } })])],
    ['thinking', chat('c', [step('s1')])],
    ['ended', chat('c', [step('s1')], { ended: NOW })],
]) {
    assert.ok(!shouldShowFloat({ task: quiet, watching: 'c', at: NOW }), what);
}
const chatGate = chat('c', [step('s1'), gate('g1')]);
assert.ok(shouldShowFloat({ task: chatGate, at: NOW }), 'a gate brings it');
assert.ok(!shouldShowFloat({ task: chat('c', [step('s1'), gate('g1', { state: 'done' })]), watching: 'c', at: NOW }), 'answered: gone again');
assert.ok(shouldShowFloat({ task: chat('c', [step('s1')]), pinnedTaskId: 'c', at: NOW }), 'put on the canvas from the workbench');
assert.ok(!shouldShowFloat({ task: chatGate, browserOpen: true, at: NOW }), 'never over the open window');
assert.ok(!floatEligible(chat('c', [step('s1')])) && floatEligible(chatGate) && floatEligible(chat('c', []), 'c') && floatEligible(task('w', [])));
const inWorkbench = task('w', [step('s1', { state: 'running' })], { started: NOW - 900 });
const inChat = chat('c', [step('s2', { state: 'running' })], { started: NOW - 10 });
assert.equal(pickTracked(inWorkbench, inChat, { at: NOW }).id, 'w', 'a newer chat in an AI app takes nothing over');
assert.equal(pickTracked(inChat, inWorkbench, { at: NOW }).id, 'w', 'the workbench task takes the card back');
assert.equal(pickTracked(inWorkbench, chat('c', [gate('g2')], { started: NOW - 10 }), { at: NOW }).id, 'c', 'its gate still comes first');
assert.equal(pickTracked(inWorkbench, inChat, { pinnedTaskId: 'c', at: NOW }).id, 'c', 'put on the canvas: it may follow');

// Where the card may stand: inside the canvas, a margin from the edges.
assert.deepEqual(clampFloatPosition({ left: 50, top: 40 }, { width: 800, height: 600 }, { width: 340, height: 120 }), { left: 50, top: 40 });
assert.deepEqual(clampFloatPosition({ left: -40, top: -5 }, { width: 800, height: 600 }, { width: 340, height: 120 }), { left: 8, top: 8 });
assert.deepEqual(clampFloatPosition({ left: 700, top: 590 }, { width: 800, height: 600 }, { width: 340, height: 120 }), { left: 452, top: 472 });
assert.deepEqual(clampFloatPosition({ left: 100, top: 100 }, { width: 200, height: 100 }, { width: 340, height: 120 }), { left: 8, top: 8 }, 'bigger than the canvas: at its corner');
assert.deepEqual(clampFloatPosition({ left: NaN, top: 30.6 }, { width: 800, height: 600 }, { width: 100, height: 40 }), { left: 8, top: 31 });
assert.deepEqual(parseFloatPosition('{"left":12,"top":30}'), { left: 12, top: 30 });
assert.equal(parseFloatPosition('{bad'), null);
assert.equal(parseFloatPosition('{"left":"12","top":30}'), null);
assert.equal(parseFloatPosition(null), null);

console.log('ai_float_state: showing, saying, following, closing and placing the canvas card passed');
