/**
 * What an event of the server about a task ("anomalous.ai_task", api/ai_tasks.py _notify) asks of
 * the user, for a desktop notification while they are in another window (ui_ai_notify.js): the AI
 * asks a question, a step waits for their OK, or a run ended that the AI was not told of.
 */

/** {title, body} as locale keys (`text`: the AI's own title in place of a body) for event `detail`, or null. */
export function noticeOf(detail) {
    if (!detail || detail.progress) return null;
    if (detail.asks && detail.gate) return { title: 'aiNotifyGate', body: `aiGateQ_${detail.gate}` };
    if (detail.asks && detail.panel) return { title: 'aiNotifyAsks', text: String(detail.panel) };
    if (detail.ran === 'done' || detail.ran === 'error') return { title: detail.ran === 'done' ? 'aiNotifyRan' : 'aiNotifyFailed', body: 'aiNotifyRanDo' };
    return null;
}
