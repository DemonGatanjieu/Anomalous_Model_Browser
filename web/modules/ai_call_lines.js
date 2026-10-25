/**
 * The lines the user can paste into the AI's chat for a task (ui_ai_call.js draws them over the
 * message box). Anomalous cannot wake an AI app, so when the AI has stopped the user tells it in a
 * word, picked by what waits: a run it was not told has ended (`call_ai`, api/ai_task_runs.py),
 * something the user gave it that it has not got yet, or nothing (go on). The last line picks the
 * task up in a new chat. A task that ended has lines only while a reply of the user's waits (writing
 * to it opens it again, api/ai_panels.py); one still waiting for its first AI has none
 * (ui_ai_ready.js, the waiting page, has the line that starts it).
 */

const REPLIES = new Set(['user_message', 'user_marks', 'user_pictures', 'user_toolbox']);
export const NEW_CHAT = 'aiCallNewChat';

/** Whether the user gave the AI something it has not got: words, marks, pictures, materials, an answer, a late gate decision. */
export function unseenReply(task) {
    return (task?.steps || []).some(step => (step.kind === 'user' && REPLIES.has(step.tool) && !step.delivered)
        || (step.gate?.timed_out && step.gate.decision && !step.gate.delivered)
        || Object.values(step.answers || {}).some(given => !given.delivered));
}

/** {lead, lines} as locale keys for `task` (the first line is the one to send), or null. */
export function callLines(task) {
    const steps = task?.steps || [];
    if (!task || (task.waiting && steps.every(step => step.kind === 'user'))) return null;
    if (task.ended) return unseenReply(task) ? { lead: 'aiCallRepliedLead', lines: ['aiCallReplied', NEW_CHAT] } : null;
    const run = steps.findLast(step => step.tool === 'run_workflow' && step.call_ai);
    if (run?.state === 'done') return { lead: 'aiCallDoneLead', lines: ['aiCallDone', 'aiCallAgain', NEW_CHAT] };
    if (run?.state === 'error') return { lead: 'aiCallFailedLead', lines: ['aiCallFailed', NEW_CHAT] };
    if (unseenReply(task)) return { lead: 'aiCallRepliedLead', lines: ['aiCallReplied', NEW_CHAT] };
    return { lead: 'aiCallLead', lines: ['aiCallGoOn', NEW_CHAT] };
}
