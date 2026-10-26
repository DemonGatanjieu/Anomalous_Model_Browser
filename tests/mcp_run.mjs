import assert from 'node:assert/strict';
import { queueTracked } from '../web/modules/mcp_run.js';

// Only the host is substituted: its queue drains batches, emits request IDs, and calls widgets around submissions.
function host({ failAt = 0, manual = false, refuse = null } = {}) {
    const api = new EventTarget();
    const events = (name, detail) => api.dispatchEvent(Object.assign(new Event(name), { detail }));
    let count = 0;
    const hooks = [];
    api.queuePrompt = async () => {
        const n = ++count;
        await Promise.resolve();
        if (n === failAt) throw Object.assign(new Error('invalid graph'), refuse ? { response: refuse, toString: () => 'Prompt outputs failed validation' } : {});
        return { prompt_id: `p${n}` };
    };
    const app = {
        nextQueueRequestId: 0, processingQueue: false, queueItems: [],
        async queuePrompt(number, batch) {
            const requestId = this.nextQueueRequestId++;
            this.queueItems.push({ number, batch, requestId });
            events('promptQueueing', { requestId });
            if (this.processingQueue) return false;
            this.processingQueue = true;
            try {
                while (this.queueItems.length) {
                    const item = this.queueItems.pop();
                    let accepted = 0;
                    for (let i = 0; i < item.batch; i++) {
                        hooks.push('before');
                        try {
                            const result = await api.queuePrompt(item.number, {});
                            assert.ok(result.prompt_id);
                            if (manual && count === 1) void this.queuePrompt(0, 1);
                        } catch { break; }
                        accepted++;
                        hooks.push('after');
                    }
                    if (accepted) events('promptQueued', { requestId: item.requestId });
                }
            } finally { this.processingQueue = false; }
            return true;
        },
    };
    return { app, api, hooks };
}

for (const manual of [false, true]) {
    const { app, api, hooks } = host({ manual });
    const original = api.queuePrompt;
    const result = await queueTracked(app, api, 2);
    assert.deepEqual(result.prompt_ids, ['p1', 'p2']);
    assert.equal(result.queued, 2);
    assert.equal(api.queuePrompt, original);
    await new Promise(setImmediate); // a later manual batch may still be draining
    assert.deepEqual(hooks, Array(manual ? 3 : 2).fill(['before', 'after']).flat());
}
{
    const { app, api } = host({ manual: true });
    const submit = api.queuePrompt;
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let count = 0;
    api.queuePrompt = async function (...args) {
        if (++count === 3) await held;
        return submit.apply(this, args);
    };
    const result = await queueTracked(app, api, 2);
    assert.deepEqual(result.prompt_ids, ['p1', 'p2']);
    assert.equal(app.processingQueue, true, 'AI receipt does not wait for the manual batch behind it');
    release();
    await new Promise(setImmediate);
}
{
    const { app, api } = host({ failAt: 2, manual: true });
    const result = await queueTracked(app, api, 3);
    assert.deepEqual(result.prompt_ids, ['p1'], 'manual submission after a partial failure is not captured');
    assert.match(result.submission_error, /invalid graph/);
}
{
    const { app, api } = host({ failAt: 1 });
    assert.equal((await queueTracked(app, api)).queued, 0);
    const result = await queueTracked(app, api);
    assert.deepEqual(result.prompt_ids, ['p2'], 'failed capture leaves no listeners or wrapper behind');
}
{
    const { app, api } = host();
    const first = queueTracked(app, api, 2);
    await assert.rejects(queueTracked(app, api), /another batch/);
    assert.deepEqual((await first).prompt_ids, ['p1', 'p2']);
    delete app.nextQueueRequestId;
    await assert.rejects(queueTracked(app, api), /Update the frontend/);
}
{
    // ComfyUI's refusal goes on as data too, for the server to say what to do next.
    const refuse = { error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation', details: '' },
        node_errors: { 3: { class_type: 'KSampler', errors: [{ type: 'required_input_missing', message: 'Required input is missing', details: 'model', extra_info: { input_name: 'model' } }] } } };
    const result = await queueTracked(...Object.values(host({ failAt: 1, refuse })).slice(0, 2));
    assert.equal(result.queued, 0);
    assert.equal(result.refusal.type, 'prompt_outputs_failed_validation');
    assert.deepEqual(result.refusal.nodes, [{ node: '3', class_type: 'KSampler', type: 'required_input_missing', message: 'Required input is missing',
        details: 'model', input: 'model', value: undefined }]);
}
console.log('mcp_run: exact receipts, manual interleaving, partial failure, busy guard and cleanup passed');
