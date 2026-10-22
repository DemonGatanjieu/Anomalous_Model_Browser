/** Capture submission receipts from one native ComfyUI queue request, preserving its seed/widget hooks. */
export async function queueTracked(app, api, batch = 1) {
    if (app.processingQueue) throw new Error('ComfyUI is submitting another batch. Wait for submission to finish, then try again.');
    if (!Number.isSafeInteger(app.nextQueueRequestId) || typeof api.queuePrompt !== 'function') {
        throw new Error('This ComfyUI frontend cannot identify queue requests. Update the frontend before running from AI.');
    }
    const requestId = app.nextQueueRequestId;
    const original = api.queuePrompt;
    const ids = [];
    let capturing = false, error = '', attempts = 0;
    let complete;
    const ownDone = new Promise(resolve => { complete = resolve; });
    const started = event => { if (event.detail?.requestId === requestId) capturing = true; };
    const finished = event => { if (event.detail?.requestId === requestId) { capturing = false; complete(); } };
    const wrapped = async function (...args) {
        // Calls queued by the user behind this batch run after its promptQueued event.
        const ours = capturing && attempts < batch;
        if (ours) attempts++;
        try {
            const result = await original.apply(this, args);
            if (ours) {
                if (typeof result?.prompt_id === 'string' && result.prompt_id) ids.push(result.prompt_id);
                else { error = 'ComfyUI did not return a prompt ID for this submission.'; capturing = false; complete(); }
            }
            return result;
        } catch (failure) {
            if (ours) { error = String(failure?.message || failure).slice(0, 300); capturing = false; complete(); }
            throw failure; // the native error display and partial-batch handling still run
        }
    };
    api.addEventListener('promptQueueing', started);
    api.addEventListener('promptQueued', finished);
    api.queuePrompt = wrapped;
    try {
        // Native queuePrompt may also drain later manual requests. Return our receipt as soon as
        // our batch ends, but still handle a later rejection from the native queue promise.
        const nativeDone = Promise.resolve(app.queuePrompt(0, batch)).catch(failure => {
            if (ids.length < batch) error ||= String(failure?.message || failure).slice(0, 300);
        });
        await Promise.race([nativeDone, ownDone]);
    } catch (failure) {
        error ||= String(failure?.message || failure).slice(0, 300);
    } finally {
        capturing = false;
        if (api.queuePrompt === wrapped) api.queuePrompt = original;
        api.removeEventListener('promptQueueing', started);
        api.removeEventListener('promptQueued', finished);
    }
    if (ids.length < batch) error ||= `Only ${ids.length} of ${batch} prompts were accepted. Check ComfyUI before retrying.`;
    return { prompt_ids: ids, queued: ids.length, requested: batch, ...(error ? { submission_error: error } : {}) };
}
