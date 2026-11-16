import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildStrip,
    composeFirstNote,
    filterModels,
    filterWorkflows,
    loadImageInfo,
    modelFamilies,
    modelStem,
    pickWay,
    resolveStartFrom,
    routeModels,
    secondModelChoices,
    startFactSentence,
    stillValidStartFrom,
} from '../web/modules/ai_start_from.js';

const dict = {
    aiStartStripDraw: ({ model }) => `出图 · ${model}`,
    aiStartStripPair: ({ first, way, second }) => `${first}  →  ${way} · ${second}`,
    aiRouteShort_tile_second: () => 'Tile 放大',
    aiStartNoteOpen: () => '先从我开着的画布开始。',
    aiStartNoteOpenOne: () => '先从我开着的画布开始，它读了 1 张图，原样留着不动。',
    aiStartNoteOpenImages: ({ count }) => `先从我开着的画布开始，它读了 ${count} 张图，原样留着不动。`,
    aiStartNoteCard: ({ name }) => `先从我存的工作流卡「${name}」开始。`,
};
const t = (key, values = {}) => dict[key](values);

test('loadImageInfo counts active LoadImage nodes with an image widget, ignoring muted and bypassed ones', () => {
    const graph = {
        _nodes: [
            { type: 'LoadImage', mode: 0, widgets: [{ name: 'image', value: 'sub/cat.png' }] },
            { type: 'LoadImageMask', mode: 0, widgets: [{ name: 'image', value: 'folder\\mask.png' }] },
            { type: 'LoadImage', mode: 2, widgets: [{ name: 'image', value: 'muted.png' }] },
            { type: 'LoadImage', mode: 4, widgets: [{ name: 'image', value: 'bypassed.png' }] },
            { type: 'LoadImageCustom', mode: 0, widgets: [{ name: 'url', value: 'x' }] },
            { type: 'KSampler', mode: 0, widgets: [{ name: 'seed', value: 1 }] },
        ],
    };
    assert.deepEqual(loadImageInfo(graph), { count: 2, names: ['cat.png', 'mask.png'] });
    assert.deepEqual(loadImageInfo({ _nodes: [] }), { count: 0, names: [] });
});

test('secondModelChoices, filterModels and modelFamilies support family, query and favourite ordering', () => {
    const models = [
        { model_id: 'a1', name: 'Alpha', family: 'Anima', favourite: false },
        { model_id: 'a2', name: 'Beta', family: 'Anima', favourite: true },
        { model_id: 'x1', name: 'Gamma XL', family: 'SDXL', favourite: false },
        { model_id: 'x2', name: 'Delta XL', family: 'SDXL', favourite: true },
        { model_id: 'u1', name: 'Unknown 1', family: '' },
        { model_id: 'u2', name: 'Unknown 2', family: '' },
    ];
    assert.deepEqual(secondModelChoices(models, 'a1').map(m => m.model_id), ['a2']);
    assert.deepEqual(secondModelChoices(models, 'u1'), []);
    assert.deepEqual(filterModels(models).map(m => m.model_id), ['a2', 'x2', 'a1', 'x1', 'u1', 'u2']);
    assert.deepEqual(filterModels(models, { family: 'Anima' }).map(m => m.model_id), ['a2', 'a1']);
    assert.deepEqual(filterModels(models, { family: '' }).map(m => m.model_id), ['u1', 'u2']);
    assert.deepEqual(filterModels(models, { query: 'xl' }).map(m => m.model_id), ['x2', 'x1']);
    assert.deepEqual(filterModels(models, { query: 'a', family: 'SDXL' }).map(m => m.model_id), ['x2', 'x1']);
    assert.deepEqual(modelFamilies(models), [['', 2], ['Anima', 2], ['SDXL', 2]]);
    assert.equal(filterWorkflows([{ file: 'f1.json', name: 'Anime' }, { file: 'f2.json', name: 'Photo' }], 'pho', 'f1.json').length, 2);
});

test('remembered choice holds only when its models, way or card still exist, and falls back otherwise', () => {
    const models = [
        { model_id: 'm1', name: 'M1', family: 'anima' },
        { model_id: 'm2', name: 'M2', family: 'anima' },
    ];
    const ways = [{ id: 'tile_second' }, { id: 'one_pass' }];
    const workflows = [{ file: 'a.json', name: 'Card A' }];
    assert.equal(stillValidStartFrom({ mode: 'new', first: 'm1', second: 'm2', route: 'tile_second' }, { hasNew: true, models, ways }), true);
    assert.equal(stillValidStartFrom({ mode: 'new', first: 'gone', second: '', route: 'one_pass' }, { hasNew: true, models, ways }), false);
    assert.equal(stillValidStartFrom({ mode: 'new', first: 'm1', second: 'm2', route: 'midway_enlarge' }, { hasNew: true, models, ways }), false);
    assert.equal(stillValidStartFrom({ mode: 'open' }, { canOpen: false }), false);
    assert.equal(stillValidStartFrom({ mode: 'open' }, { canOpen: true }), true);
    assert.equal(stillValidStartFrom({ mode: 'card', card: 'a.json' }, { workflows }), true);
    assert.equal(stillValidStartFrom({ mode: 'card', card: 'gone.json' }, { workflows }), false);

    assert.equal(resolveStartFrom(null, { hasNew: true, models, ways, workflows }).mode, 'new');
    assert.equal(resolveStartFrom(null, { hasNew: false, workflows }).mode, 'ai');
    assert.deepEqual(
        resolveStartFrom({ mode: 'new', first: 'gone', second: '', route: 'one_pass' }, { hasNew: true, models, ways, workflows }),
        { mode: 'new', first: 'm1', second: '', route: 'tile_second', card: 'a.json' },
    );
});

test('pickWay presses a way that draws with as many models as were chosen', () => {
    const ways = [{ id: 'midway', models: 2 }, { id: 'tile_second', models: 2 }, { id: 'one_pass', models: 1 }];
    assert.equal(pickWay(ways, 'one_pass', true), 'midway', 'a second model was chosen: the first way that uses it');
    assert.equal(pickWay(ways, 'tile_second', true), 'tile_second', 'the way chosen stays');
    assert.equal(pickWay(ways, 'midway', false), 'one_pass', 'no second model: the way for one');
    assert.equal(pickWay([{ id: 'one_pass', models: 1 }], 'gone', true), 'one_pass', 'nothing fits: the first offered');
    assert.equal(pickWay([], 'one_pass', false), '');
});

test('routeModels, buildStrip and first-message sentences match public and private mode', () => {
    assert.deepEqual(routeModels('one_pass', 'm1', 'm2'), ['m1']);
    assert.deepEqual(routeModels('tile_second', 'm1', 'm2'), ['m1', 'm2']);
    assert.equal(buildStrip('tile_second', 'Harem', 'Realskin', t), '出图 · Harem  →  Tile 放大 · Realskin');
    assert.equal(buildStrip('one_pass', 'Harem', 'Realskin', t), '出图 · Harem');

    const mark = s => `\u27e6${s}\u27e7`;
    assert.equal(startFactSentence({ mode: 'ai' }, t, mark), '');
    assert.equal(startFactSentence({ mode: 'new' }, t, mark), '');
    assert.equal(startFactSentence({ mode: 'open', count: 0 }, t, mark), '先从我开着的画布开始。');
    assert.equal(startFactSentence({ mode: 'open', count: 3 }, t, mark), '先从我开着的画布开始，它读了 3 张图，原样留着不动。');
    assert.equal(startFactSentence({ mode: 'card', cardName: 'My Card', secret: false }, t, mark), '先从我存的工作流卡「My Card」开始。');
    assert.equal(startFactSentence({ mode: 'card', cardName: 'My Card', secret: true }, t, mark), '先从我存的工作流卡「\u27e6My Card\u27e7」开始。');
    assert.equal(composeFirstNote('先从我开着的画布开始。', '正面提示词原样用这个：[P1]。'), '先从我开着的画布开始。 正面提示词原样用这个：[P1]。');
    assert.equal(modelStem('checkpoints:0:harem.safetensors'), 'harem');
    assert.equal(modelStem('diffusion_models:0:Anima/realskin_v13.safetensors'), 'realskin_v13');
});
