import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptPickerModel, expandModelGroups, filterPickerModels, modelTypes } from '../web/modules/ai_model_pick.js';

test('adaptPickerModel preserves type, exact base, inferred local badge and version fields', () => {
    const scanned = adaptPickerModel({
        model_id: 'checkpoints:0:il/foo_v2.safetensors',
        name: 'Foo Anime',
        file: 'foo_v2.safetensors',
        type: 'checkpoints',
        base: 'Illustrious',
        family: 'SDXL',
        favourite: true,
        cover: '/anomalous/preview/foo.webp',
        metadata: { model_id: 42, version_id: 200, version_name: 'v2.0', baseModel: 'Illustrious' },
    });
    assert.equal(scanned.filename, 'foo_v2.safetensors');
    assert.equal(scanned.metadata.custom_name, 'Foo Anime');
    assert.equal(scanned.metadata.version_name, 'v2.0');
    assert.equal(scanned.metadata.baseModel, 'Illustrious');
    assert.equal(scanned.metadata.info_source, '');
    assert.equal(scanned.preview_url, '/anomalous/preview/foo.webp');

    const localOnly = adaptPickerModel({
        model_id: 'diffusion_models:0:bar.safetensors',
        name: 'bar',
        type: 'diffusion_models',
        metadata: { base_guess: 'Anima' },
    });
    assert.equal(localOnly.metadata.baseModel, 'Anima');
    assert.equal(localOnly.metadata.info_source, 'local');
    assert.equal(localOnly.filename, 'bar.safetensors');
});

test('modelTypes and filterPickerModels distinguish types, exact base families, versions and favourites', () => {
    const models = [
        adaptPickerModel({ model_id: 'dm1', name: 'Anima Turbo', file: 'anima_v10.safetensors', type: 'diffusion_models', base: 'Anima', family: 'Anima', favourite: false, metadata: { version_name: 'v10' } }),
        adaptPickerModel({ model_id: 'c1', name: 'Pony Mix', file: 'pony_mix.safetensors', type: 'checkpoints', base: 'Pony Diffusion V6', family: 'SDXL', favourite: true, metadata: { version_name: 'V6' } }),
        adaptPickerModel({ model_id: 'c2', name: 'IL Glow', file: 'il_glow.safetensors', type: 'checkpoints', base: 'Illustrious', family: 'SDXL', favourite: false, metadata: { version_name: 'v3.2' } }),
    ];
    assert.deepEqual(modelTypes(models), [['checkpoints', 2], ['diffusion_models', 1]]);
    assert.deepEqual(filterPickerModels(models, { type: 'checkpoints' }).map(m => m.model_id), ['c1', 'c2']);
    assert.deepEqual(filterPickerModels(models, { baseFamily: 'Pony' }).map(m => m.model_id), ['c1']);
    assert.deepEqual(filterPickerModels(models, { baseFamily: 'Illustrious' }).map(m => m.model_id), ['c2']);
    assert.deepEqual(filterPickerModels(models, { favouritesOnly: true }).map(m => m.model_id), ['c1']);
    assert.deepEqual(filterPickerModels(models, { query: 'v3.2' }).map(m => m.model_id), ['c2']);
    assert.deepEqual(filterPickerModels(models, { query: 'anima_v10' }).map(m => m.model_id), ['dm1']);
});

test('expandModelGroups keeps same-model versions side-by-side and expanded while sorting groups cleanly', () => {
    const models = [
        adaptPickerModel({ model_id: 'a1', name: 'Series A', file: 'series_a_v1.safetensors', favourite: false, metadata: { model_id: 100, version_id: 10, version_name: 'v1' } }),
        adaptPickerModel({ model_id: 'b1', name: 'Solo B', file: 'solo_b.safetensors', favourite: true, metadata: { model_id: 200, version_id: 50, version_name: 'v1' } }),
        adaptPickerModel({ model_id: 'a2', name: 'Series A', file: 'series_a_v2.safetensors', favourite: true, metadata: { model_id: 100, version_id: 20, version_name: 'v2' } }),
        adaptPickerModel({ model_id: 'solo', name: 'Solo Local', file: 'solo_local.safetensors', favourite: false }),
    ];
    const expanded = expandModelGroups(models);
    assert.deepEqual(expanded.map(entry => entry.model.model_id), ['a2', 'a1', 'b1', 'solo'], 'sibling versions stay contiguous with newest version first inside a group');
    assert.equal(expanded[0].groupSize, 2);
    assert.equal(expanded[0].isGroupStart, true);
    assert.equal(expanded[1].isGroupEnd, true);
    assert.equal(expanded[2].groupSize, 1);

    const prioritized = expandModelGroups(models, ['solo']);
    assert.deepEqual(prioritized.map(entry => entry.model.model_id), ['solo', 'a2', 'a1', 'b1']);
});
