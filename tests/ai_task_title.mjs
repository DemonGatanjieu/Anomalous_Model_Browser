// A task's name on the page (web/modules/ai_task_title.js): a given title as it is, Anomalous's own in the page's words.
import assert from 'node:assert/strict';
import { taskTitle } from '../web/modules/ai_task_title.js';

globalThis.anomalous_browser_lang = 'zh';
assert.equal(taskTitle({ title: 'new_workflow: anima test', title_from: 'auto' }), '新建了工作流：anima test');
assert.equal(taskTitle({ title: 'run_workflow', title_from: 'auto' }), '运行工作流');
assert.equal(taskTitle({ title: 'run_workflow: 两行\n的名字', title_from: 'auto' }), '运行工作流：两行\n的名字');
assert.equal(taskTitle({ title: 'run_workflow', title_from: 'ai' }), 'run_workflow', 'a title the AI or the user gave stays as written');
assert.equal(taskTitle({ title: 'run_workflow' }), 'run_workflow', 'no word on where it came from: as written');
assert.equal(taskTitle({ title: 'no_such_tool: x', title_from: 'auto' }), 'no_such_tool: x', 'a tool without words: as written');
assert.equal(taskTitle({ title: '', title_from: 'auto' }), '未命名任务');
assert.equal(taskTitle(null), '未命名任务');
globalThis.anomalous_browser_lang = 'en';
assert.equal(taskTitle({ title: 'new_workflow: anima test', title_from: 'auto' }), 'Started a workflow: anima test');
console.log('ai_task_title ok');
