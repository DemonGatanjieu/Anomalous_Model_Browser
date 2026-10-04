/**
 * Records the canvas changes Anomalous makes. A pointer press anywhere in Anomalous's
 * interface takes a snapshot of the canvas; the next press outside it (or any key
 * outside it, or the next press inside) compares the canvas with that snapshot and
 * logs the difference, before the user's own edit happens. So every button, drag and
 * dialog that writes to nodes is covered without each one reporting itself.
 * Opening another workflow meanwhile is logged as that, not as removed nodes. What each
 * entry did is handed to canvas_undo.js, so the log can undo it.
 */

import { app } from "../../../scripts/app.js";
import { diffSnapshots, snapshotGraph } from './activity_diff.js';
import { postCanvasActivity } from './activity_log.js';
import { keepUndo, workflowKey as openWorkflowKey } from './canvas_undo.js';

const AMB_UI = '#anomalous-modal, [id^="anomalous-"], [class*="anomalous-"]';
const MAX_SENT = 60;

const currentGraph = () => app.canvas?.graph || app.graph || null;
const activeWorkflow = () => app.extensionManager?.workflow?.activeWorkflow || null;
const workflowName = () => {
    const workflow = activeWorkflow();
    return String(workflow?.filename || workflow?.path || '');
};
const workflowKey = () => openWorkflowKey(app);

// <html> carries Anomalous classes too (the floating entry setting); it is not our interface.
const insideAnomalous = (target) => {
    const hit = target instanceof Element ? target.closest(AMB_UI) : null;
    return Boolean(hit) && hit !== document.documentElement && hit !== document.body;
};

/** Starts watching; sets `owner.flushCanvasActivity()` (log what is pending now). */
export function watchCanvasChanges(owner) {
    let baseline = null;

    const flush = () => {
        // A combo group following the pointer is logged once it is put down; Esc removes it.
        if (!baseline || owner.placingCombo) return;
        const { graph, workflow, nodes } = baseline;
        baseline = null;
        const now = currentGraph();
        if (!now || now !== graph) return; // moved into or out of a subgraph meanwhile
        const after = snapshotGraph(now);
        const opened = workflowKey() !== workflow;
        const changes = opened ? [{ kind: 'opened', node: workflowName(), after: String(after.size) }] : diffSnapshots(nodes, after);
        if (!changes.length) return;
        postCanvasActivity({ changes: changes.slice(0, MAX_SENT), total: changes.length, workflow: workflowName() })
            .then((data) => {
                if (!opened) keepUndo(data?.entry?.id, workflow, nodes, after);
                owner.onActivityRecorded?.();
            })
            .catch((error) => console.warn('[AMB] Activity log: canvas change not recorded.', error));
    };

    const start = () => {
        flush();
        const graph = currentGraph();
        baseline = graph ? { graph, workflow: workflowKey(), nodes: snapshotGraph(graph) } : null;
    };

    // Capture phase: runs before ComfyUI or Anomalous handle the event.
    window.addEventListener('pointerdown', (e) => {
        if (insideAnomalous(e.target)) start();
        else flush();
    }, true);
    window.addEventListener('keydown', (e) => {
        if (!insideAnomalous(e.target)) flush();
    }, true);

    owner.flushCanvasActivity = flush;
}
