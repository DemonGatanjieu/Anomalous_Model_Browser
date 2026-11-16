/**
 * Pure tests for web/modules/ai_chat_plus.js (ref note and serialization) and
 * ai_toolbox_data.js wayItems.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    MAX_REF_NOTE,
    refNote,
    serializeRef,
    serializeRefs,
} from '../web/modules/ai_chat_plus.js';
import { wayItems } from '../web/modules/ai_toolbox_data.js';

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

test('serializeRefs strips, truncates notes at 120 chars, keeps attached when true, and omits empty notes', () => {
    const longNote = 'x'.repeat(MAX_REF_NOTE + 25);
    assert.equal(refNote(longNote).length, MAX_REF_NOTE);
    assert.deepEqual(serializeRef({ kind: 'models', id: 'm1', label: 'M1', note: '   ', attached: false }), { kind: 'models', id: 'm1', label: 'M1' });
    assert.deepEqual(serializeRefs([
        { kind: 'models', id: 'm1', label: 'M1', attached: true, note: '  base model  ' },
        { kind: 'ways', id: 'w1', label: 'W1', note: '' },
        { kind: 'combos', id: 'c1', label: 'C1', attached: true, note: longNote },
    ]), [
        { kind: 'models', id: 'm1', label: 'M1', attached: true, note: 'base model' },
        { kind: 'ways', id: 'w1', label: 'W1' },
        { kind: 'combos', id: 'c1', label: 'C1', attached: true, note: 'x'.repeat(MAX_REF_NOTE) },
    ]);
});
