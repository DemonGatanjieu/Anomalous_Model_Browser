/**
 * ComfyUI's Ctrl+Z history. It takes a step on its own events (a mouse button or key let
 * go); a canvas write made by a drop (no mouse-up follows a drag), in a click handler or
 * after a request finishes would otherwise land in no step, and Ctrl+Z would skip it.
 * Call after every canvas write. Takes `app` so pure modules can use it. Also keeps a change of
 * fingerprints alone (absorbFingerprintChange) out of the history.
 */

export function recordCanvasStep(app) {
    try {
        const tracker = app?.extensionManager?.workflow?.activeWorkflow?.changeTracker;
        if (typeof tracker?.captureCanvasState === 'function') tracker.captureCanvasState();
        else tracker?.checkState?.(); // older ComfyUI
    } catch (error) {
        console.warn('[AMB] Ctrl+Z history: step not recorded.', error);
    }
}

// What a saved workflow carries from the fingerprint cache (hash_resolver.js), not the canvas.
const DERIVED = ['anomalous_hashes', 'anomalous_model_sources'];

function withoutDerived(state) {
    const extra = { ...(state?.extra || {}) };
    for (const key of DERIVED) delete extra[key];
    return { ...state, extra };
}

/**
 * After the fingerprint cache changes (a scan, a download), the workflow serializes with
 * other fingerprints although nothing on the canvas changed; ComfyUI would take that as a
 * step, and the next Ctrl+Z would seem to do nothing. When that is the only difference, the
 * history's current state takes it without a step.
 */
export function absorbFingerprintChange(app) {
    try {
        const tracker = app?.extensionManager?.workflow?.activeWorkflow?.changeTracker;
        const graph = app?.rootGraph || app?.graph;
        if (!tracker?.activeState || typeof graph?.serialize !== 'function') return;
        const current = JSON.parse(JSON.stringify(graph.serialize()));
        const a = withoutDerived(tracker.activeState);
        const b = withoutDerived(current);
        const same = typeof tracker.constructor?.graphEqual === 'function'
            ? tracker.constructor.graphEqual(a, b)
            : JSON.stringify(a) === JSON.stringify(b);
        if (same) tracker.activeState = current;
    } catch (error) {
        console.warn('[AMB] Ctrl+Z history: could not take the new fingerprints in.', error);
    }
}
