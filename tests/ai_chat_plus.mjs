/**
 * Pure tests for web/modules/ai_chat_plus.js: model favourite ordering, usable/on way filtering,
 * and message ref serialization with optional notes.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    MAX_REF_NOTE,
    orderModelsFavoritesFirst,
    refNote,
    serializeRef,
    serializeRefs,
} from '../web/modules/ai_chat_plus.js';
import { wayItems } from '../web/modules/ai_toolbox_data.js';

const MODEL_FIXTURE = [
    { kind: 'models', id: 'checkpoints:0:a.safetensors', title: 'Alpha', haystack: 'alpha a.safetensors checkpoints sdxl' },
    { kind: 'models', id: 'loras:0:b.safetensors', title: 'Beta LoRA', haystack: 'beta lora b.safetensors loras sdxl' },
    { kind: 'models', id: 'checkpoints:0:c.safetensors', title: 'Gamma', haystack: 'gamma c.safetensors checkpoints anima' },
    { kind: 'models', id: 'loras:0:d.safetensors', title: 'Delta LoRA', haystack: 'delta lora d.safetensors loras sdxl' },
];

test('orderModelsFavoritesFirst places favourites first in favourite order and narrows by query', () => {
    const all = orderModelsFavoritesFirst(MODEL_FIXTURE, [
        'loras:0:d.safetensors',
        'checkpoints:0:c.safetensors',
    ]);
    assert.deepEqual(all.map(m => [m.id, m.favourite]), [
        ['loras:0:d.safetensors', true],
        ['checkpoints:0:c.safetensors', true],
        ['checkpoints:0:a.safetensors', false],
        ['loras:0:b.safetensors', false],
    ]);
    // Search preserves narrowing while keeping matching favourites ahead of non-favourites.
    const filtered = orderModelsFavoritesFirst(MODEL_FIXTURE, ['loras:0:d.safetensors'], 'lora');
    assert.deepEqual(filtered.map(m => m.id), [
        'loras:0:d.safetensors',
        'loras:0:b.safetensors',
    ]);
    assert.equal(MODEL_FIXTURE[0].favourite, undefined, 'input items are not mutated');
});

test('wayItems offers only usable and enabled blocks with localized title, about and bilingual search', () => {
    const blocks = [
        { name: 'color_lineart', job: 'follow', usable: true, on: true, title: { zh: '线稿上色', en: 'Colour a line drawing' }, about: { zh: '给黑白线稿上色', en: 'Colours a line drawing' } },
        { name: 'disabled_way', job: 'upscale', usable: true, on: false, title: { zh: '已关闭', en: 'Turned off' }, about: { zh: '关闭', en: 'Off' } },
        { name: 'missing_pack', job: 'detail', usable: false, on: true, title: { zh: '缺包', en: 'Missing pack' }, about: { zh: '缺包', en: 'Needs pack' } },
    ];
    const zh = wayItems(blocks, 'zh');
    assert.equal(zh.length, 1);
    assert.equal(zh[0].kind, 'ways');
    assert.equal(zh[0].id, 'color_lineart');
    assert.equal(zh[0].title, '线稿上色');
    assert.equal(zh[0].about, '给黑白线稿上色');
    assert.ok(zh[0].haystack.includes('colour a line drawing'));

    const en = wayItems(blocks, 'en');
    assert.equal(en[0].title, 'Colour a line drawing');
    assert.equal(en[0].about, 'Colours a line drawing');
});

test('serializeRefs strips, truncates notes at 120 chars and omits empty notes', () => {
    const longNote = 'x'.repeat(MAX_REF_NOTE + 25);
    assert.equal(refNote(longNote).length, MAX_REF_NOTE);
    assert.deepEqual(serializeRef({ kind: 'models', id: 'm1', label: 'M1', note: '   ' }), { kind: 'models', id: 'm1', label: 'M1' });
    assert.deepEqual(serializeRefs([
        { kind: 'models', id: 'm1', label: 'M1', note: '  base model  ' },
        { kind: 'ways', id: 'w1', label: 'W1', note: '' },
        { kind: 'combos', id: 'c1', label: 'C1', note: longNote },
    ]), [
        { kind: 'models', id: 'm1', label: 'M1', note: 'base model' },
        { kind: 'ways', id: 'w1', label: 'W1' },
        { kind: 'combos', id: 'c1', label: 'C1', note: 'x'.repeat(MAX_REF_NOTE) },
    ]);
});
