import assert from 'node:assert/strict';
import { fixture } from './ui_fixture.mjs';

const storageMap = new Map();
const mockStorage = {
    getItem: (k) => storageMap.has(k) ? storageMap.get(k) : null,
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
};

const f = fixture({ storageOverride: mockStorage });
const layoutMod = await f.module('shortcut_layout.js');
const registryMod = await f.module('tool_registry.js');

const eq = (a, b) => assert.deepEqual([...a], [...b]);

// 1. Initial state without storage: returns DEFAULT_PINNED_SHORTCUTS
eq(layoutMod.loadShortcutLayout(mockStorage), ['scan', 'doctor', 'assistant', 'materials']);

// 2. Capacity limit check: already has 4 items, cannot pin another unpinned tool
assert.equal(layoutMod.isToolPinned('model-sources', mockStorage), false);
const fullRes = layoutMod.pinTool('model-sources', -1, mockStorage);
assert.equal(fullRes.success, false);
assert.equal(fullRes.reason, 'capacity_full');
assert.equal(layoutMod.loadShortcutLayout(mockStorage).length, 4);

// 3. Reordering existing pinned tool does not trigger capacity full
const reorderRes = layoutMod.pinTool('materials', 0, mockStorage);
assert.equal(reorderRes.success, true);
assert.equal(reorderRes.reordered, true);
eq(layoutMod.loadShortcutLayout(mockStorage), ['materials', 'scan', 'doctor', 'assistant']);

// 4. Unpin tool
const unpinRes = layoutMod.unpinTool('doctor', mockStorage);
assert.equal(unpinRes.success, true);
assert.equal(unpinRes.changed, true);
eq(layoutMod.loadShortcutLayout(mockStorage), ['materials', 'scan', 'assistant']);

// 5. Pin new tool when space is available
const pinRes = layoutMod.pinTool('model-sources', 1, mockStorage);
assert.equal(pinRes.success, true);
eq(layoutMod.loadShortcutLayout(mockStorage), ['materials', 'model-sources', 'scan', 'assistant']);

// 6. Direct reorder
layoutMod.reorderShortcut(1, 3, mockStorage);
eq(layoutMod.loadShortcutLayout(mockStorage), ['materials', 'scan', 'assistant', 'model-sources']);

// 7. Reset to defaults
layoutMod.resetShortcutLayout(mockStorage);
eq(layoutMod.loadShortcutLayout(mockStorage), ['scan', 'doctor', 'assistant', 'materials']);

// 8. Explicit empty array is valid and preserved
layoutMod.saveShortcutLayout([], mockStorage);
eq(layoutMod.loadShortcutLayout(mockStorage), []);

// 9. Unknown/corrupted storage handling: resets to defaults
mockStorage.setItem(layoutMod.SHORTCUT_STORAGE_KEY, '{"schemaVersion": 999, "pinned": ["invalid"]}');
eq(layoutMod.loadShortcutLayout(mockStorage), ['scan', 'doctor', 'assistant', 'materials']);

mockStorage.setItem(layoutMod.SHORTCUT_STORAGE_KEY, 'not-json');
eq(layoutMod.loadShortcutLayout(mockStorage), ['scan', 'doctor', 'assistant', 'materials']);

// 10. Storage failure fallback to memory
const failingStorage = {
    getItem() { throw new Error('Blocked'); },
    setItem() { throw new Error('Blocked'); },
};
const memLayout = layoutMod.loadShortcutLayout(failingStorage);
eq(memLayout, ['scan', 'doctor', 'assistant', 'materials']);
const memSave = layoutMod.saveShortcutLayout(['doctor', 'materials'], failingStorage);
assert.equal(memSave.success, true);
assert.equal(memSave.memoryOnly, true);

console.log('shortcut_layout: default, capacity, unpin, pin, reorder, reset, empty, corrupted, and error fallback passed.');
