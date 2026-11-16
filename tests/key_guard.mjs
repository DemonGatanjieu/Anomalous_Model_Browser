// Ctrl+Enter typed in the plugin's own fields stays the plugin's (ComfyUI would queue the canvas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { inOurWindow, keepFromComfy, pathOf } from '../web/modules/ui_key_guard.js';

const step = (tag, { id = '', classes = [], editable = false, top = false } = {}) => ({ tag, id, classes, editable, top });
const ctrlEnter = { key: 'Enter', ctrlKey: true, metaKey: false };

// A field in the browser window, a field in a popup on <body>, a ComfyUI field.
const inWindow = [step('TEXTAREA'), step('DIV', { classes: ['anomalous-dialog-body'] }), step('DIV', { id: 'anomalous-modal', top: true })];
const inPopup = [step('INPUT'), step('DIV', { classes: ['anomalous-popup-menu'], top: true })];
const comfyField = [step('TEXTAREA', { classes: ['comfy-multiline-input'] }), step('DIV', { classes: ['dom-widget'] }), step('DIV', { id: 'graph-canvas-container', top: true })];

test('Ctrl+Enter or Cmd+Enter in our fields is kept from ComfyUI', () => {
    assert.equal(keepFromComfy(ctrlEnter, inWindow), true);
    assert.equal(keepFromComfy({ key: 'Enter', ctrlKey: false, metaKey: true }, inPopup), true);
    assert.equal(keepFromComfy(ctrlEnter, [step('DIV', { editable: true }), ...inWindow.slice(1)]), true);
});

test('everything else reaches ComfyUI as before', () => {
    // ComfyUI's own prompt box: Ctrl+Enter still queues.
    assert.equal(keepFromComfy(ctrlEnter, comfyField), false);
    // Not a text field (a button or the window itself): ComfyUI's shortcut works.
    assert.equal(keepFromComfy(ctrlEnter, [step('BUTTON'), ...inWindow.slice(1)]), false);
    // Plain Enter and other keys are left alone.
    assert.equal(keepFromComfy({ key: 'Enter', ctrlKey: false, metaKey: false }, inWindow), false);
    assert.equal(keepFromComfy({ key: 's', ctrlKey: true, metaKey: false }, inWindow), false);
});

test('a window of ours is an anomalous- id, or an anomalous- class on a child of <body>', () => {
    assert.equal(inOurWindow(inWindow), true);
    assert.equal(inOurWindow(inPopup), true);
    assert.equal(inOurWindow(comfyField), false);
    // An anomalous- class deeper down (one we put on a ComfyUI element) does not make it ours.
    assert.equal(inOurWindow([step('TEXTAREA', { classes: ['anomalous-prompt-tools'] }), step('DIV', { top: true })]), false);
});

test('the path is read from the event, so a box that closed on the key still counts', () => {
    // composedPath() as the browser gives it: target first, then up to window.
    const node = (tagName, id = '', classes = []) => ({ tagName, id, classList: classes, getAttribute: () => null });
    const nodes = [node('TEXTAREA'), node('DIV', '', ['anomalous-dialog']), node('BODY'), node('HTML'), {}, {}];
    const path = pathOf(nodes);
    assert.deepEqual(path.map(item => [item.tag, item.top]), [['TEXTAREA', false], ['DIV', true]]);
    assert.equal(keepFromComfy(ctrlEnter, path), true);
});
