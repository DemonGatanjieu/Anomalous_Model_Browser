/**
 * The task's own canvas tab (api/ai_task_canvas.py), on the page: before an AI's canvas action
 * (mcp_bridge.js), with the task set to "new", the task's tab is brought to the front the way a
 * click on it does (ComfyUI's store alone would not load its graph); with no tab yet, the first
 * change copies the open workflow into a new tab named after the task and says so in a toast,
 * so the user's own tab is never changed. Reads and runs follow the task's tab when it is open
 * and use the canvas as it is before it has one; new_workflow and open_workflow make the tab
 * they open the task's. An existing task tab that cannot be opened stops the action.
 */

import { app } from '../../../scripts/app.js';
import { translate as t } from './locales.js';
import { showWorkbenchToast } from './ui_prompt_toast.js';
import { tabName } from './mcp_canvas_edit.js';

const CHANGES = new Set(['set_prompt', 'set_model', 'add_lora', 'place_combo', 'fix_models', 'add_node', 'connect_nodes', 'set_values', 'remove_nodes']);
const FOLLOWS = new Set(['describe_canvas', 'check_models', 'run_workflow', 'download_missing']);
const OPENS = new Set(['new_workflow', 'open_workflow']);
const SWITCH_WAIT_MS = 4000;

const store = () => app.extensionManager?.workflow || null;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const shown = path => store()?.activeWorkflow?.path === path && !store()?.activeWorkflow?.isLoading;

function frontTab(made = false) {
    const workflow = store()?.activeWorkflow;
    return workflow ? { path: workflow.path, name: String(workflow.filename || workflow.path).replace(/\.json$/i, ''), made } : null;
}

async function settled(path, limit = SWITCH_WAIT_MS) {
    for (let waited = 0; waited < limit && !shown(path); waited += 50) await wait(50);
    if (shown(path)) await new Promise(resolve => requestAnimationFrame(resolve));
    return shown(path);
}

/** Brings open tab `path` to the front as a click on it does; false when it is not open. */
export async function showTab(path) {
    const workflows = store()?.openWorkflows || [];
    const index = workflows.findIndex(workflow => workflow.path === path);
    if (index < 0) return false;
    if (shown(path)) return true;
    document.querySelectorAll('.workflow-tabs > button')[index]?.click();
    if (await settled(path)) return true;
    // Tabs not on screen (another layout): step through the open ones, as Ctrl+Tab does.
    for (let step = 0; step < workflows.length && !shown(path); step++) {
        await app.extensionManager?.command?.execute?.('Workspace.NextOpenedWorkflow');
        await settled(path, 600);
    }
    return shown(path);
}

/** Runs page action `action` (`run()`) on the task's tab per `spec` ({mode, tab, title}); `opened(tab)`
 * hears of a tab made or opened for the task ({path, name, made}). Returns what `run()` does. */
export async function onTaskTab(action, spec, run, opened) {
    if (spec?.mode !== 'new' || !(CHANGES.has(action) || FOLLOWS.has(action) || OPENS.has(action))) return run();
    if (OPENS.has(action)) {
        const value = await run();
        opened(frontTab());
        return value;
    }
    const path = spec.tab?.path;
    if (path) {
        if (!await showTab(path)) throw new Error('The task canvas tab is closed or could not be activated. '
            + 'Reopen that workflow, or explicitly use open_workflow/new_workflow for this task before retrying. Nothing was run or changed.');
        return run();
    }
    if (!CHANGES.has(action)) return run();
    const name = tabName(spec.title || t('aiTaskTabDefault'));
    await app.loadGraphData(app.graph.serialize(), true, true, name);
    opened(frontTab(true));
    showWorkbenchToast(t('aiTaskTabMade', { name }));
    return run();
}
