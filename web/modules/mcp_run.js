// ComfyUI's own words when it refuses a prompt (which node, what is wrong), not just "failed".
const reason = failure => String((failure?.response && failure.toString?.()) || failure?.message || failure).slice(0, 800);

/** The same refusal as data (the frontend's PromptExecutionError.response), for the server to say what to do next (run_refusal.py). */
const refusal = failure => {
    const response = failure?.response;
    if (!response || typeof response !== 'object') return null;
    const top = typeof response.error === 'string' ? { message: response.error } : (response.error || {});
    const nodes = Object.entries(response.node_errors || {}).slice(0, 12).flatMap(([node, item]) => (item?.errors || []).slice(0, 4).map(error => ({
        node, class_type: item?.class_type, type: error?.type, message: error?.message, details: String(error?.details ?? '').slice(0, 200),
        input: error?.extra_info?.input_name, value: error?.extra_info?.received_value == null ? undefined : String(error.extra_info.received_value).slice(0, 120),
    })));
    return { type: top.type, message: top.message, details: String(top.details ?? '').slice(0, 300), nodes };
};

const SEEDS = ['seed', 'noise_seed'];

/**
 * For a batch of tries: each seed held "fixed" counts up instead while the batch is queued (the
 * native control moves it per prompt), so N tries are N pictures, not one prompt ComfyUI runs
 * once. Returns the undo: each control and seed as they were.
 */
export function varySeeds(graph) {
    const held = [];
    for (const node of graph?._nodes || []) {
        for (const widget of node.widgets || []) {
            const control = SEEDS.includes(widget.name) ? widget.linkedWidgets?.find(item => item.name === 'control_after_generate') : null;
            if (control?.value !== 'fixed') continue;
            held.push({ widget, control, seed: widget.value });
            control.value = 'increment';
        }
    }
    return () => held.forEach(({ widget, control, seed }) => {
        control.value = 'fixed';
        widget.value = seed;
    });
}

/** Capture submission receipts from one native ComfyUI queue request, preserving its seed/widget hooks; a batch varies held seeds (varySeeds). */
export async function queueTracked(app, api, batch = 1) {
    if (app.processingQueue) throw new Error('ComfyUI is submitting another batch. Wait for submission to finish, then try again.');
    if (!Number.isSafeInteger(app.nextQueueRequestId) || typeof api.queuePrompt !== 'function') {
        throw new Error('This ComfyUI frontend cannot identify queue requests. Update the frontend before running from AI.');
    }
    const requestId = app.nextQueueRequestId;
    const original = api.queuePrompt;
    const ids = [];
    let capturing = false, error = '', refused = null, attempts = 0;
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
            if (ours) { error = reason(failure); refused = refusal(failure); capturing = false; complete(); }
            throw failure; // the native error display and partial-batch handling still run
        }
    };
    api.addEventListener('promptQueueing', started);
    api.addEventListener('promptQueued', finished);
    api.queuePrompt = wrapped;
    const unvary = batch > 1 ? varySeeds(app.graph) : null;
    try {
        // Native queuePrompt may also drain later manual requests. Return our receipt as soon as
        // our batch ends, but still handle a later rejection from the native queue promise.
        const nativeDone = Promise.resolve(app.queuePrompt(0, batch)).catch(failure => {
            if (ids.length < batch) { error ||= reason(failure); refused ||= refusal(failure); }
        });
        await Promise.race([nativeDone, ownDone]);
    } catch (failure) {
        error ||= reason(failure);
    } finally {
        capturing = false;
        unvary?.();
        if (api.queuePrompt === wrapped) api.queuePrompt = original;
        api.removeEventListener('promptQueueing', started);
        api.removeEventListener('promptQueued', finished);
    }
    if (ids.length < batch) error ||= `Only ${ids.length} of ${batch} prompts were accepted. Check ComfyUI before retrying.`;
    return { prompt_ids: ids, queued: ids.length, requested: batch, ...(error ? { submission_error: error } : {}), ...(refused ? { refusal: refused } : {}) };
}
