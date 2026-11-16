// The 'auto' theme follows ComfyUI: a dark palette is told by the old class or the new color-scheme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { comfyIsDark } from '../web/modules/comfy_palette.js';

const root = (classes = [], colorScheme = '') => ({ classList: { contains: name => classes.includes(name) }, style: { colorScheme } });

test('older ComfyUI: the dark-theme class', () => {
    assert.equal(comfyIsDark(root(['dark-theme'])), true);
    assert.equal(comfyIsDark(root([])), false);
});

test('ComfyUI 1.59 on: color-scheme in <html> style', () => {
    assert.equal(comfyIsDark(root([], 'dark')), true);
    assert.equal(comfyIsDark(root([], 'light')), false);
    assert.equal(comfyIsDark(root([], 'Dark ')), true);
    assert.equal(comfyIsDark(root([], 'light dark')), false); // "either": not a dark palette
    assert.equal(comfyIsDark(null), false);
});
