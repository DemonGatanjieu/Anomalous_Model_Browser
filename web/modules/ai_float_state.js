/**
 * The AI's card over the canvas (ui_ai_float.js draws it) as rules without DOM: whether a task is at
 * work, what the card says first, what waits on the user, which task the card follows, when it shows
 * and where it may stand. A task is api/ai_tasks.py's record (GET /anomalous/ai_tasks/{id}), a summary
 * its row in the list (task_summary); times are seconds, as the server keeps them. A task an AI app works
 * on in its own chat (`chat_only`, api/mcp_tool_sets.py note_mode) gets the card only for a gate.
 */

import { haltOf, taskStatus } from './ai_task_status.js';
import { QUESTIONS, openAsks, outputCount, taskOutputs } from './ai_task_view.js';

export const RUNNING = ['submitting', 'queued', 'running'];
/** The AI touched the task this recently: between two of its calls it is thinking, not gone. */
export const ACTIVE_SECONDS = 120;
/** No word from the AI for this long, and nothing asked: a card it opened by itself goes. */
export const QUIET_SECONDS = 15 * 60;
/** An open question older than this is not brought back when the page loads (the server's IDLE_SECONDS). */
export const FRESH_SECONDS = 20 * 60;
/** A pick of one among this many options or fewer is answered on the card. */
export const MAX_INLINE_OPTIONS = 6;
/** From the edges of the canvas. */
export const FLOAT_MARGIN = 8;

const ASKS = [...QUESTIONS, 'plan']; // a plan card waits for the user's nod too (ui_ai_plan.js)
const stepsOf = task => task?.steps || [];
const now = () => Date.now() / 1000;

/** The newest step waiting at a gate for the user's OK (api/ai_gates.py), or null. */
export const gateOf = task => stepsOf(task).findLast(step => step.state === 'asking' && step.gate) || null;

/**
 * Everything waiting on the user now, newest first: gates (`gate:<step>`), then the questions nobody
 * answered (`ask:<step>:<block>`). None for a task that ended or that the user halted.
 */
export function attentionKeys(task) {
    if (!task || task.ended || haltOf(task)) return [];
    const gates = stepsOf(task).filter(step => step.state === 'asking' && step.gate).reverse().map(step => `gate:${step.id}`);
    return [...gates, ...openAsks(task, ASKS).map(({ step, block }) => `ask:${step.id}:${block.id}`)];
}

/** What waits on the user first ('' for nothing). */
export const attentionKey = task => attentionKeys(task)[0] || '';

/** Whether `task` waits on the user for something not among `keys` (what was known before). */
export const hasNewAttention = (keys, task) => attentionKeys(task).some(key => !(keys || []).includes(key));

/**
 * Whether an AI is at work on `task`: a call or a run going, something waiting on the user, or the AI
 * here within ACTIVE_SECONDS. Not a task that ended, that no AI took yet, or that the user halted.
 */
export function isTaskActive(task, at = now()) {
    if (!task || task.ended || task.waiting || haltOf(task)) return false;
    if (attentionKeys(task).length || stepsOf(task).some(step => step.state === 'running')) return true;
    return stepsOf(task).some(step => step.kind !== 'user') && taskStatus(task, at).age < ACTIVE_SECONDS;
}

/**
 * Whether the newest task's row (a summary) is worth its card when the page loads or AMB's window
 * closes: a run going, the AI here just now, or a question or gate asked lately.
 */
export function shouldAutoShowOnBoot(summary, at = now()) {
    if (!summary || summary.ended || summary.waiting || summary.halted) return false;
    if (summary.chat_only && !summary.asks) return false;
    const since = at - (summary.updated || 0);
    return Boolean(summary.live) || since < ACTIVE_SECONDS || (summary.asks > 0 && since < FRESH_SECONDS);
}

/**
 * The first question the card shows, { step, block, inline, more }, or null. `inline`: 'choices' (a
 * pick of one among few) or 'input' (a line) are answered on the card; null sends the user to the
 * workbench (several picks, pictures, prompts, a plan, a long list). `drafted(step, block)`: whether
 * the user half answered one (ui_ai_panel.js hasDraft), which then stays in front.
 */
export function pickFloatAsk(task, drafted = () => false) {
    if (!task || task.ended || haltOf(task)) return null;
    const asks = openAsks(task, ASKS);
    if (!asks.length) return null;
    const { step, block } = asks[Math.max(0, asks.findIndex(ask => drafted(ask.step, ask.block)))];
    const options = Array.isArray(block.options) ? block.options : [];
    const one = block.type === 'choices' && !block.multiple && options.length > 0 && options.length <= MAX_INLINE_OPTIONS;
    return { step, block, inline: block.type === 'input' ? 'input' : one ? 'choices' : null, more: asks.length - 1 };
}

/** The newest step of the AI's that is over, for "the last step" while it thinks; null before its first. */
export const lastSettledStep = task => stepsOf(task).findLast(step => step.kind !== 'user' && step.state !== 'running') || null;

/** Failed steps no later success made good, as the task list counts them (api/ai_task_handoff.py unresolved). */
export function unresolvedFailures(steps) {
    const laterOk = new Set();
    const laterTools = new Set();
    let count = 0;
    for (const step of [...(steps || [])].reverse()) {
        const target = step.recovery_target ?? null;
        const key = JSON.stringify([step.tool, target]);
        if (step.ok && (step.state == null || step.state === 'done')) {
            laterOk.add(key);
            laterTools.add(step.tool);
        } else if (!step.ok && !laterOk.has(key) && !(target === null && laterTools.has(step.tool))) {
            count += 1;
        }
    }
    return count;
}

/**
 * What the card says first, { kind, status, step }, the first that holds: 'done' / 'error' (ended),
 * 'halt' (the user paused or halted it), 'waiting' (no AI took it yet), 'gate' (a step waits for an
 * OK), 'run' (pictures being made), 'tool' (a call going), 'ask' (only a question waits), 'thinking'
 * (between two calls), 'idle' (the AI has not been back for ACTIVE_SECONDS). `status`: taskStatus.
 */
export function floatState(task, at = now()) {
    const status = taskStatus(task, at);
    if (task?.ended) return { kind: unresolvedFailures(stepsOf(task)) ? 'error' : 'done', status, step: null };
    const halt = haltOf(task);
    if (halt) return { kind: 'halt', status, step: halt };
    if (task?.waiting && stepsOf(task).every(step => step.kind === 'user')) return { kind: 'waiting', status, step: null };
    const gate = gateOf(task);
    if (gate) return { kind: 'gate', status, step: gate };
    if (status.run && RUNNING.includes(status.state)) return { kind: 'run', status, step: status.run };
    if (status.state === 'tool') return { kind: 'tool', status, step: status.active };
    if (openAsks(task, ASKS).length) return { kind: 'ask', status, step: null };
    return { kind: status.age < ACTIVE_SECONDS ? 'thinking' : 'idle', status, step: lastSettledStep(task) };
}

const TONES = { done: 'done', error: 'error', halt: 'paused', waiting: 'waiting', gate: 'asking', ask: 'asking', run: 'running', tool: 'tool', thinking: 'tool', idle: 'idle' };

/** The colour of the card's dot: 'running' | 'tool' | 'asking' | 'paused' | 'waiting' | 'error' | 'done' | 'idle'. */
export const floatTone = (task, at = now()) => TONES[floatState(task, at).kind];

/** What an ended task made, for its last card: things made (pictures among them), canvas changes, failures left. */
export function floatOutcome(task) {
    const outputs = taskOutputs(task);
    return { made: outputCount(outputs), images: outputs.runs.reduce((sum, run) => sum + run.pictures.length, 0),
        canvas: outputs.canvas, failed: unresolvedFailures(stepsOf(task)) };
}

/**
 * Whether the card shows `task` (the one it follows). Never while AMB's window is open, nor for a task
 * the user closed it on (`dismissed`, liftDismissal). One the user put on the canvas (`pinnedTaskId`)
 * stays through the AI's pauses, and one the card showed while it went on (`watching`) until the AI
 * has been quiet for QUIET_SECONDS; any other shows while the AI is at work. An ended task shows only
 * to a card that was watching it end. One the AI works on in its own chat shows only while a gate waits
 * for the user's OK (the AI would wait for nothing else), unless they put it on the canvas.
 */
export function shouldShowFloat({ task, browserOpen = false, pinnedTaskId = null, dismissed = null, watching = null, at = now() } = {}) {
    if (!task || browserOpen || dismissed?.id === task.id) return false;
    if (task.chat_only && pinnedTaskId !== task.id) return Boolean(gateOf(task));
    if (task.ended) return watching === task.id;
    if (pinnedTaskId === task.id) return true;
    if (watching === task.id && (attentionKeys(task).length || taskStatus(task, at).age < QUIET_SECONDS)) return true;
    return isTaskActive(task, at);
}

/** Whether the card may show `task` at all: not one in an AI app's own chat, unless a gate waits or the user put it on the canvas. */
export const floatEligible = (task, pinnedTaskId = null) => !task?.chat_only || task.id === pinnedTaskId || Boolean(gateOf(task));

/** The user's × on the card over `task`: what waited on them then does not bring the card back. */
export const dismissFloat = task => (task ? { id: task.id, keys: attentionKeys(task) } : null);

/** `dismissed` as it stands once `task` is read again: gone when that task asks something new. */
export function liftDismissal(dismissed, task) {
    if (!dismissed || !task || dismissed.id !== task.id) return dismissed;
    return hasNewAttention(dismissed.keys, task) ? null : dismissed;
}

/**
 * Which task the card follows, `current` or `incoming` (just read): one the card may show (floatEligible)
 * before one it may not; then one asking something of the user before one that does not; else the one
 * followed now while it asks or the user put it on the canvas; else `incoming` when it is at work and
 * newer, or the followed one rests.
 */
export function pickTracked(current, incoming, { pinnedTaskId = null, at = now() } = {}) {
    if (!incoming) return current || null;
    if (!current || current.id === incoming.id) return incoming;
    const eligible = floatEligible(incoming, pinnedTaskId);
    if (eligible !== floatEligible(current, pinnedTaskId)) return eligible ? incoming : current; // a quiet chat in an AI app takes nothing over
    const asksIncoming = attentionKeys(incoming).length > 0;
    const asksCurrent = attentionKeys(current).length > 0;
    if (asksIncoming !== asksCurrent) return asksIncoming ? incoming : current;
    if (asksCurrent || (pinnedTaskId === current.id && !current.ended)) return current;
    const newer = (incoming.started || 0) > (current.started || 0);
    return isTaskActive(incoming, at) && (newer || !isTaskActive(current, at)) ? incoming : current;
}

/** Seconds until time alone changes what the card says of `task` (thinking turns idle, a quiet card goes), or null. */
export function floatWakeIn(task, at = now()) {
    if (!task || task.ended) return null;
    const { kind, status } = floatState(task, at);
    if (kind === 'thinking') return Math.max(1, ACTIVE_SECONDS - status.age);
    if (kind === 'idle' && status.age < QUIET_SECONDS) return Math.max(1, QUIET_SECONDS - status.age);
    return null;
}

/** `pos` ({left, top} in the canvas) kept FLOAT_MARGIN inside `bounds` ({width, height}) for a card of `size`. */
export function clampFloatPosition(pos, bounds, size, margin = FLOAT_MARGIN) {
    const fit = (value, span, length) => {
        const most = Math.max(margin, (Number(span) || 0) - (Number(length) || 0) - margin);
        return Math.round(Math.min(most, Math.max(margin, Number.isFinite(value) ? value : margin)));
    };
    return { left: fit(pos?.left, bounds?.width, size?.width), top: fit(pos?.top, bounds?.height, size?.height) };
}

/** A position kept as text (localStorage), or null when there is none or it is not one. */
export function parseFloatPosition(text) {
    try {
        const pos = JSON.parse(text || 'null');
        return Number.isFinite(pos?.left) && Number.isFinite(pos?.top) ? { left: pos.left, top: pos.top } : null;
    } catch {
        return null;
    }
}
