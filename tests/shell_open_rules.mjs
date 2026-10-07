// Which page opening the browser shows for the selected node, and the rail's number keys
// (web/modules/shell_open_rules.js).
import assert from 'node:assert/strict';
import { pageForNode, railPageForKey } from '../web/modules/shell_open_rules.js';

const kinds = {
    takesPrompt: node => Boolean(node.prompt),
    hasModel: node => Boolean(node.model),
};

// Opening the browser: a text node opens Prompt Studio, any other node Current node.
assert.equal(pageForNode(null, kinds), null); // nothing selected: the page used last
assert.equal(pageForNode({ prompt: true }, kinds), 'prompts'); // CLIP Text Encode
assert.equal(pageForNode({}, kinds), 'assistant'); // KSampler
assert.equal(pageForNode({ model: true }, kinds), 'assistant'); // a loader
assert.equal(pageForNode({ prompt: true, model: true }, kinds), 'assistant'); // a loader with prompt boxes: its models first

// Number keys: 1-9 from the top of the rail.
const pages = ['home', 'activity', 'models', 'gallery', 'recipes', 'combos', 'prompts', 'voices', 'audio-gallery'].map(page => ({ page }));
const canvas = { closest: () => null };
const field = { closest: selector => (selector.includes('textarea') ? {} : null) };
const key = (code, extra = {}) => ({ code, key: code.slice(-1), target: canvas, ...extra });

assert.equal(railPageForKey(key('Digit1'), pages), 'home');
assert.equal(railPageForKey(key('Digit7'), pages), 'prompts');
assert.equal(railPageForKey(key('Numpad9'), pages), 'audio-gallery');
assert.equal(railPageForKey(key('Digit0'), pages), null);
assert.equal(railPageForKey(key('KeyW'), pages), null); // W stays ComfyUI's (the Workflows sidebar)
assert.equal(railPageForKey(key('Digit3', { target: field }), pages), null); // typing a number into a box
assert.equal(railPageForKey(key('Digit3', { ctrlKey: true }), pages), null);
assert.equal(railPageForKey(key('Digit3', { shiftKey: true }), pages), null);
assert.equal(railPageForKey(key('Digit3', { isComposing: true }), pages), null); // a Chinese input method choosing a word
assert.equal(railPageForKey(key('Digit3', { repeat: true }), pages), null);
assert.equal(railPageForKey({ code: '', key: '4', target: canvas }, pages), 'gallery'); // no code: by the key
assert.equal(railPageForKey(key('Digit9'), pages.slice(0, 3)), null); // fewer pages than keys

console.log('shell_open_rules: ok');
