// Run: node tests/script_cast.mjs  (Voice-over's cast: picking lines, colours; no ComfyUI needed)
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { pickLines, speakerColor } = await import(pathToFileURL(path.join(root, 'web/modules/ui_script_cast.js')).href);

// A click picks one line; Ctrl / ⌘ adds or takes one away; Shift picks the run from the anchor.
assert.deepEqual([...pickLines(new Set([1, 2]), 4, {})], [4]);
assert.deepEqual([...pickLines(new Set([1]), 3, { ctrlKey: true })].sort(), [1, 3]);
assert.deepEqual([...pickLines(new Set([1, 3]), 3, { metaKey: true })], [1]);
assert.deepEqual([...pickLines(new Set([5]), 2, { shiftKey: true }, 5)].sort(), [2, 3, 4, 5]);
assert.deepEqual([...pickLines(new Set(), 2, { shiftKey: true }, null)], [2]);

// A character's colour follows its place in the voice list, the same on the list and on the cards.
const groups = [{ group: 'a' }, { group: 'b' }, { group: 'c' }];
assert.notEqual(speakerColor('a', groups), speakerColor('b', groups));
assert.equal(speakerColor('b', groups), speakerColor('b', [...groups]));
assert.equal(speakerColor('gone', groups), speakerColor('a', groups));

console.log('script_cast: all checks passed');
