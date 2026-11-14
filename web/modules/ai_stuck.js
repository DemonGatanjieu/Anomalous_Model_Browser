/**
 * Why a task of the AI workbench stands still, for "Stuck?" (ui_ai_stuck.js): the one thing it
 * waits for now, read from the task as the page has it. Anomalous cannot see into the AI app, so
 * "the AI went quiet" is what is left when nothing else explains it.
 */

import { callLines } from './ai_call_lines.js';
import { haltOf, taskStatus } from './ai_task_status.js';

const ASKS = ['choices', 'input', 'picks', 'prompts']; // ui_ai_side.js QUESTIONS
const GOING = ['submitting', 'queued', 'running'];
const LONG_TOOL = 120; // seconds: a tool call still going after this hangs on the AI app's side
const THINKING = 90; // seconds after its last call in which an AI may well be at its next step

/**
 * {why, …} for `task` at `now` (seconds): unstarted (no AI took it yet), halted, gate (a step waits
 * for the user's OK: `tool`), asks (`count` questions), running (`percent` or null), tool or
 * toolLong (`tool`, `seconds`), ended, ran or ranFailed (a run ended and the AI was not told),
 * failed (the AI's last step), fresh or quiet (`seconds` since the AI last called: a moment, or longer).
 */
export function stuckReason(task, now = Date.now() / 1000) {
    const steps = task?.steps || [];
    if (task?.waiting && steps.every(step => step.kind === 'user')) return { why: 'unstarted' };
    if (haltOf(task)) return { why: 'halted' };
    const gate = steps.findLast(step => step.state === 'asking' && step.gate);
    if (gate) return { why: 'gate', tool: gate.tool };
    const count = task?.ended ? 0 : steps.reduce((sum, step) => sum + (step.panel && !step.panel.closed
        ? (step.panel.blocks || []).filter(block => ASKS.includes(block?.type) && !(step.answers || {})[block.id]).length : 0), 0);
    if (count) return { why: 'asks', count };
    const status = taskStatus(task, now);
    if (status.run && GOING.includes(status.state)) {
        return { why: 'running', percent: Number.isFinite(status.run.progress?.percent) ? status.run.progress.percent : null };
    }
    if (status.state === 'tool') {
        const seconds = Math.max(0, Math.floor(now - (status.active.at || now)));
        return { why: seconds >= LONG_TOOL ? 'toolLong' : 'tool', tool: status.active.tool, seconds };
    }
    if (task?.ended) return { why: 'ended' };
    const lead = callLines(task)?.lead;
    if (lead === 'aiCallDoneLead' || lead === 'aiCallFailedLead') return { why: lead === 'aiCallDoneLead' ? 'ran' : 'ranFailed' };
    if (steps.findLast(step => step.kind !== 'user')?.ok === false) return { why: 'failed' };
    return { why: status.age < THINKING ? 'fresh' : 'quiet', seconds: status.age };
}
