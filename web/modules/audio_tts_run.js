import { api } from '../../../scripts/api.js';

/**
 * Run one ComfyUI API prompt from the audio page without touching the canvas:
 * POST /prompt with this page's client id, live status from the queue's
 * websocket events, the result from /history (polled too, so a missed event
 * cannot leave the job hanging). ComfyUI runs it in the same queue as the
 * user's own workflows.
 */

const POLL_MS = 1500;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** A refused prompt's reason, from ComfyUI's validation answer. */
function refusalMessage(data) {
    const nodeErrors = Object.values(data?.node_errors || {}).flatMap(entry => entry?.errors || []);
    const details = nodeErrors.map(error => error.details || error.message).filter(Boolean);
    return details.join('; ') || data?.error?.message || '';
}

function historyError(record) {
    const messages = record?.status?.messages || [];
    const failure = messages.find(([type]) => type === 'execution_error');
    if (failure) return failure[1]?.exception_message || 'error';
    return messages.some(([type]) => type === 'execution_interrupted') ? null : 'error';
}

/**
 * Queue `prompt` and follow it. `onStatus({ state: 'queued' | 'running', value?, max? })`.
 * Returns `{ result, cancel }`: `result` resolves with `{ outputs, promptId }` (the history
 * outputs by node id) and rejects with an Error (`cancelled: true` when stopped).
 */
export function startPromptJob(prompt, { onStatus } = {}) {
    let promptId = null;
    let running = false;
    let finished = false;
    let timer = null;
    let settle;
    const result = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    const listeners = [];

    const finish = (error, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        listeners.forEach(([type, handler]) => api.removeEventListener(type, handler));
        if (error) settle.reject(error); else settle.resolve(value);
    };
    const cancelled = () => Object.assign(new Error('cancelled'), { cancelled: true });
    const status = next => { if (!finished) onStatus?.(next); };
    // ComfyUI may start the job and send its first events before /prompt has answered with
    // the id, so events that arrive before the id is known are kept and replayed.
    const early = [];
    const listen = (type, handler) => {
        const wrapped = event => {
            const detail = event?.detail;
            if (!detail?.prompt_id) return;
            if (promptId === null) early.push([detail, handler]);
            else if (detail.prompt_id === promptId) handler(detail);
        };
        api.addEventListener(type, wrapped);
        listeners.push([type, wrapped]);
    };

    listen('execution_start', () => { running = true; status({ state: 'running' }); });
    listen('progress', detail => { running = true; status({ state: 'running', value: detail.value, max: detail.max }); });
    listen('execution_error', detail => finish(new Error(detail.exception_message || 'error')));
    listen('execution_interrupted', () => finish(cancelled()));

    const poll = async () => {
        if (finished) return;
        try {
            const history = await (await fetch(`/history/${encodeURIComponent(promptId)}`)).json();
            const record = history?.[promptId];
            if (record?.status?.completed) return finish(null, { outputs: record.outputs || {}, promptId });
            if (record?.status?.status_str === 'error') {
                const message = historyError(record);
                return finish(message ? new Error(message) : cancelled());
            }
        } catch (_) {
            // A dropped request is retried on the next tick.
        }
        timer = setTimeout(poll, POLL_MS);
    };

    (async () => {
        const resp = await fetch('/prompt', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ prompt, client_id: api.clientId }) });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.prompt_id) throw new Error(refusalMessage(data) || `HTTP ${resp.status}`);
        promptId = data.prompt_id;
        status({ state: 'queued' });
        early.splice(0).forEach(([detail, handler]) => { if (detail.prompt_id === promptId) handler(detail); });
        poll();
    })().catch(error => finish(error));

    /** Remove the job from the queue, or interrupt it when it is the one running. */
    const cancel = async () => {
        if (finished || !promptId) return;
        // The start event may not have arrived yet: ask the queue before choosing.
        const queue = running ? null : await fetch('/queue').then(resp => resp.json()).catch(() => null);
        if (running || queue?.queue_running?.some(item => item?.[1] === promptId)) {
            await fetch('/interrupt', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ prompt_id: promptId }) }).catch(() => {});
        } else {
            await fetch('/queue', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ delete: [promptId] }) }).catch(() => {});
            finish(cancelled());
        }
    };

    return { result, cancel };
}
