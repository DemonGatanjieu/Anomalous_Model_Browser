import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_KIND,
    DEFAULT_OTHER_KIND,
    KIND_ORDER,
    RECENT_MAX,
    countRecent,
    filterPickerItems,
    keepLayout,
    keyOf,
    pickOffered,
    readPickerState,
    readRecent,
    recordRecent,
    rememberBase,
    rememberFacet,
    rememberKind,
    resolveOpenKind,
    resolveRecentItems,
    savedLayout,
    standingInWithFavorites,
    taskEffectivePicks,
    totalPicks,
} from '../web/modules/ai_toolbox_state.js';

function memoryStorage() {
    const map = new Map();
    return {
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => { map.set(key, String(value)); },
    };
}

test('picker state defaults and remembers kind, other kind, per-kind facet and base with fallback', () => {
    const storage = memoryStorage();
    assert.deepEqual(KIND_ORDER, ['models', 'ways', 'combos', 'workflows', 'prompts', 'nodes']);
    assert.equal(resolveOpenKind(null, storage), DEFAULT_KIND);
    assert.equal(resolveOpenKind('other', storage), DEFAULT_OTHER_KIND);

    rememberKind('ways', storage);
    assert.equal(resolveOpenKind(null, storage), 'ways');
    assert.equal(resolveOpenKind('other', storage), DEFAULT_OTHER_KIND);

    rememberKind('prompts', storage);
    assert.equal(resolveOpenKind(null, storage), 'prompts');
    assert.equal(resolveOpenKind('other', storage), 'prompts');

    rememberFacet('nodes', 'ComfyUI-Impact-Pack', storage);
    rememberFacet('models', 'loras', storage);
    rememberBase('SDXL', storage);
    const state = readPickerState(storage);
    assert.equal(state.facets.nodes, 'ComfyUI-Impact-Pack');
    assert.equal(state.facets.models, 'loras');
    assert.equal(state.base, 'SDXL');

    assert.equal(pickOffered('loras', ['checkpoints', 'loras']), 'loras');
    assert.equal(pickOffered('vae', ['checkpoints', 'loras']), null);
    rememberFacet('models', null, storage);
    rememberBase(null, storage);
    const cleared = readPickerState(storage);
    assert.equal(cleared.facets.models, undefined);
    assert.equal(cleared.base, null);
});

test('recent items stay capped, newest-first, skipped for privacy, and drop missing entries', () => {
    const storage = memoryStorage();
    recordRecent([
        { kind: 'pictures', id: 'a.png', attached: true },
        { kind: 'models', id: 'm1', attached: false },
        { kind: 'models', id: 'm2', attached: true },
        { kind: 'ways', id: 'upscale', attached: true },
    ], { privateTask: false, storage });
    assert.deepEqual(readRecent(storage), [
        { kind: 'ways', id: 'upscale' },
        { kind: 'models', id: 'm2' },
    ]);

    recordRecent([{ kind: 'combos', id: 'secret', attached: true }], { privateTask: true, storage });
    assert.deepEqual(readRecent(storage), [
        { kind: 'ways', id: 'upscale' },
        { kind: 'models', id: 'm2' },
    ]);

    const many = Array.from({ length: RECENT_MAX + 5 }, (_, idx) => ({ kind: 'nodes', id: `N${idx}`, attached: true }));
    recordRecent(many, { storage });
    const recent = readRecent(storage);
    assert.equal(recent.length, RECENT_MAX);
    assert.deepEqual(recent[0], { kind: 'nodes', id: `N${RECENT_MAX + 4}` });

    const byKey = new Map([
        [keyOf('nodes', 'N34'), { kind: 'nodes', id: 'N34', title: 'N34' }],
        [keyOf('packs', 'p1'), { kind: 'packs', id: 'p1', title: 'P1' }],
    ]);
    recordRecent([{ kind: 'packs', id: 'p1', attached: true }], { storage });
    assert.deepEqual(resolveRecentItems('nodes', readRecent(storage), byKey).map(item => item.id), ['p1', 'N34']);
    assert.equal(countRecent(readRecent(storage), byKey, kind => kind === 'nodes' || kind === 'packs'), 2);
});

test('layout persistence, effective picks, and filterPickerItems helpers', () => {
    const storage = memoryStorage();
    assert.equal(savedLayout(storage), 'side');
    assert.equal(savedLayout(storage, 'full'), 'full');
    keepLayout('full', storage);
    assert.equal(savedLayout(storage), 'full');
    keepLayout('side', storage);
    assert.equal(savedLayout(storage, 'full'), 'side');

    const kinds = ['models', 'ways'];
    assert.equal(standingInWithFavorites({}, { models: ['m1'], ways: [] }, kinds), true);
    assert.equal(taskEffectivePicks({}, { models: ['m1'], ways: [] }, kinds).mode, 'prefer');
    assert.equal(totalPicks(taskEffectivePicks({ toolbox: { mode: 'only', models: ['m2'], ways: [] } }, { models: ['m1'], ways: [] }, kinds), kinds), 1);

    const byKey = new Map([[keyOf('models', 'm1'), { kind: 'models', id: 'm1' }]]);
    const recent = filterPickerItems({
        kind: 'models',
        filter: 'recent',
        query: '',
        rawItems: [],
        recentEntries: [{ kind: 'models', id: 'm1' }, { kind: 'models', id: 'gone' }],
        byKey,
        favIds: [],
        given: () => false,
        liked: () => false,
        search: items => items,
    });
    assert.deepEqual(recent.map(item => item.id), ['m1']);
});
