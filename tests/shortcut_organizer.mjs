import assert from 'node:assert/strict';
import { fixture, Element } from './ui_fixture.mjs';

const storageMap = new Map();
const mockStorage = {
    getItem: (k) => storageMap.has(k) ? storageMap.get(k) : null,
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
};

const f = fixture({ storageOverride: mockStorage });
const organizer = await f.module('ui_shortcut_organizer.js');
const layoutMod = await f.module('shortcut_layout.js');
const registryMod = await f.module('tool_registry.js');

// 1. Module loaded successfully
assert.ok(organizer.bindDraggableTool);
assert.ok(organizer.openShortcutButtonMenu);
assert.ok(organizer.openToolboxCardMenu);

// 2. Click vs Drag deadzone contract
let clicked = false;
const btn = new Element('button');
btn.id = 'test-btn';
btn.getBoundingClientRect = () => ({ left: 100, top: 200, width: 32, height: 32, right: 132, bottom: 232 });

organizer.bindDraggableTool(btn, {
    toolId: 'assistant',
    source: 'shortcut',
    onToolClick: () => { clicked = true; }
});

// Pointer down and up at same spot (0px movement <= 6px) -> regular click
btn.dispatch('pointerdown', { clientX: 100, clientY: 200, button: 0, pointerType: 'mouse' });
f.document.dispatch('pointerup', { clientX: 100, clientY: 200, preventDefault() {}, stopPropagation() {} });
assert.equal(clicked, true, 'Click should trigger when pointer moves <= 6px');

// Reset and move > 6px (7px dx)
clicked = false;
let layoutChanged = false;
const card = new Element('div');
card.id = 'test-card';
card.getBoundingClientRect = () => ({ left: 10, top: 10, width: 100, height: 50, right: 110, bottom: 60 });

organizer.bindDraggableTool(card, {
    toolId: 'workflow-transfer',
    source: 'toolbox',
    onLayoutChange: () => { layoutChanged = true; },
    onToolClick: () => { clicked = true; }
});

card.dispatch('pointerdown', { clientX: 10, clientY: 10, button: 0, pointerType: 'mouse' });
f.document.dispatch('pointermove', { clientX: 20, clientY: 10 }); // dx = 10 > 6px
assert.equal(organizer.isOrganizingDragActive(), true, 'Drag should activate past 6px threshold');

// Escape should cancel drag
f.document.dispatch('keydown', { key: 'Escape' });
assert.equal(organizer.isOrganizingDragActive(), false, 'Escape should cancel active drag');
assert.equal(clicked, false, 'Cancelled drag must not fire click');

console.log('ui_shortcut_organizer: click deadzone, threshold activation, and Escape cancellation passed.');
