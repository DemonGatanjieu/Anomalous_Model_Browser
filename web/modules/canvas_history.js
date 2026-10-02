/**
 * ComfyUI's Ctrl+Z history. It takes a step on its own events (a mouse button or key let
 * go); a canvas write made by a drop (no mouse-up follows a drag), in a click handler or
 * after a request finishes would otherwise land in no step, and Ctrl+Z would skip it.
 * Call after every canvas write. Takes `app` so pure modules can use it.
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
