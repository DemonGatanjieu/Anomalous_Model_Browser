import assert from 'node:assert/strict';
import test from 'node:test';
import { namedHidden, slipsThrough, swapNames } from '../web/modules/ai_name_guard.js';

const lantern = { kind: 'models', id: 'loras:0:amb164/lantern_glow.safetensors', title: 'Lantern Glow - v1', short: 'Lantern Glow', file: 'lantern_glow.safetensors' };
const anima = { kind: 'models', id: 'diffusion_models:0:Anima.safetensors', title: 'Anima', file: 'Anima.safetensors' };
const lineart = { kind: 'models', id: 'controlnet:0:anima-lllite-lineart-1.safetensors', title: 'anima-lllite-lineart-1', file: 'anima-lllite-lineart-1.safetensors' };
const meadow = { kind: 'models', id: 'loras:0:amb164/meadow_light.safetensors', title: 'meadow_light', file: 'meadow_light.safetensors' };
const all = [lantern, anima, lineart, meadow];
const hidden = () => true;

test('only the names the way to the AI leaves as written count', () => {
    assert.equal(slipsThrough('Anima'), true, 'one plain word');
    assert.equal(slipsThrough('abc'), true, 'under four letters');
    assert.equal(slipsThrough('Lantern Glow'), false, 'more than one word: Anomalous swaps it');
    assert.equal(slipsThrough('lantern_glow'), false);
    assert.deepEqual(namedHidden('用 Lantern Glow - v1 出图', all, hidden), [], 'its full card name is swapped on the way anyway');
    assert.deepEqual(namedHidden('用 Lantern Glow 出图', all, hidden).map(each => each.names), [['Lantern Glow']],
        'the name the cards show without its version is not one the way knows');
});

test('a loose name of a hidden model is found, as a word of its own', () => {
    const found = namedHidden('用 lantern 那个 LoRA，再加 anima', all, hidden);
    assert.deepEqual(found.map(each => [each.item.file, each.names]), [
        ['lantern_glow.safetensors', ['lantern']],
        ['Anima.safetensors', ['anima']],
    ]);
    assert.deepEqual(namedHidden('lanterns and animated scenes', all, hidden), [], 'inside another word it is not the name');
    assert.deepEqual(namedHidden('anima 的线稿', [lineart], hidden), [], 'the first word of a name without spaces is not taken');
    assert.deepEqual(namedHidden('用 lantern', all, item => item !== lantern), [], 'a model the AI may see by name is left alone');
    assert.deepEqual(namedHidden('用 Meadow Light 和 lantern glow', all, hidden).map(each => each.names), [['lantern glow'], ['Meadow Light']],
        'the same name written another way (case, spaces) is not swapped on the way, so it counts');
    assert.deepEqual(namedHidden('用 meadow_light 和 Lantern Glow - v1', all, hidden), [], 'written exactly, the way swaps it');
});

test('swapping writes the file name, which the way to the AI makes a code word', () => {
    const text = '用 Lantern 和 anima，lantern 权重 0.7';
    assert.equal(swapNames(text, namedHidden(text, all, hidden)), '用 lantern_glow.safetensors 和 Anima.safetensors，lantern_glow.safetensors 权重 0.7');
});
