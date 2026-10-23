import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Load the actual router, substituting only host/UI imports. No real graph, queue or downloads.
let source = await fs.readFile(new URL('../web/modules/mcp_task_tab.js', import.meta.url), 'utf8');
source = source.replace(/^import .*;\r?\n/gm, '');
source = 'const { app, t, showWorkbenchToast, tabName } = globalThis.taskTabHost;\n' + source;
const workflow = { activeWorkflow: null, openWorkflows: [] };
let copies = 0;
let switchesWork = true;
const app = {
    extensionManager: { workflow, command: { execute: async () => {} } },
    graph: { serialize: () => ({ nodes: [] }) },
    async loadGraphData(_data, _clean, _restore, name) {
        copies++;
        workflow.activeWorkflow = { path: name, filename: name };
        workflow.openWorkflows.push(workflow.activeWorkflow);
    },
};
globalThis.taskTabHost = { app, t: value => value, tabName: value => value, showWorkbenchToast() {} };
globalThis.document = { querySelectorAll: () => workflow.openWorkflows.map(item => ({
    click() { if (switchesWork) workflow.activeWorkflow = item; },
})) };
globalThis.requestAnimationFrame = callback => callback();
// Exercise timeout/fallback branches without waiting several real seconds.
globalThis.setTimeout = callback => callback();
const { onTaskTab } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const spec = { mode: 'new', tab: { path: 'task-A' }, title: 'Task A' };
let calls = 0;
const run = () => { calls++; return workflow.activeWorkflow.path; };
const opened = [];
const remember = value => opened.push(value);
function reset(hasTask = true) {
    calls = copies = 0;
    opened.length = 0;
    switchesWork = true;
    workflow.activeWorkflow = { path: 'user-B' };
    workflow.openWorkflows = [...(hasTask ? [{ path: 'task-A' }] : []), workflow.activeWorkflow];
}
for (const action of ['run_workflow', 'describe_canvas', 'check_models', 'download_missing', 'set_values']) {
    reset();
    assert.equal(await onTaskTab(action, spec, run, remember), 'task-A', `${action} follows its task`);
    assert.equal(calls, 1);
    for (const closed of [true, false]) {
        reset(!closed);
        switchesWork = false;
        await assert.rejects(onTaskTab(action, spec, run, remember), /closed or could not be activated/);
        assert.equal(calls, 0, `${action} must not fall through on a missing/stuck tab`);
        assert.equal(copies, 0, 'an unrelated workflow must not be cloned as a replacement');
        assert.equal(workflow.activeWorkflow.path, 'user-B');
    }
}
reset();
assert.equal(await onTaskTab('run_workflow', { mode: 'current', tab: spec.tab }, run, remember), 'user-B');
reset(false);
assert.equal(await onTaskTab('describe_canvas', { mode: 'new' }, run, remember), 'user-B');
assert.equal(copies, 0);
await onTaskTab('set_values', { mode: 'new', title: 'new-task' }, run, remember);
assert.equal(copies, 1);
assert.equal(opened[0].path, 'new-task');
assert.equal(opened[0].made, true);
reset(false);
await onTaskTab('new_workflow', spec, async () => {
    await app.loadGraphData({}, true, true, 'replacement');
    return 'created';
}, remember);
assert.equal(opened[0].path, 'replacement', 'explicit replacement remains available after closing a tab');
console.log('Task canvas routing: switch, closed/loading failure, download, current mode and explicit replacement passed.');
