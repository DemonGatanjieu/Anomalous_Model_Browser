import assert from 'node:assert/strict';
import { baseOnly, onKeptBase } from '../web/modules/base_only.js';

const loaders = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'a.safetensors', weight_dtype: 'default' } },
    5: { class_type: 'CLIPLoader', inputs: { clip_name: 'te.safetensors', type: 'stable_diffusion' } },
    8: { class_type: 'VAELoader', inputs: { vae_name: 'vae.safetensors' } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: 'a lake', clip: ['5', 0] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['5', 0] } },
    6: { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
};
const advanced = (model, latent, start, end, leftover) => ({
    class_type: 'KSamplerAdvanced', inputs: {
        model: [model, 0], positive: ['2', 0], negative: ['3', 0], latent_image: [latent, 0], add_noise: 'enable',
        noise_seed: 7, steps: 35, start_at_step: start, end_at_step: end, return_with_leftover_noise: leftover,
    },
});

// The two-pass card: the base is decoded and saved, then encoded, enlarged and redrawn by a second model under Tile.
{
    const output = {
        ...loaders, 30: { class_type: 'UNETLoader', inputs: { unet_name: 'b.safetensors', weight_dtype: 'default' } },
        32: advanced('1', '6', 0, 35, 'disable'),
        7: { class_type: 'VAEDecodeTiled', inputs: { samples: ['32', 0], vae: ['8', 0], tile_size: 512 } },
        9: { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'two_pass/base' } },
        10: { class_type: 'VAEEncodeTiled', inputs: { pixels: ['7', 0], vae: ['8', 0] } },
        11: { class_type: 'LatentUpscaleBy', inputs: { samples: ['10', 0], scale_by: 1.5 } },
        18: { class_type: 'AnimaLLLiteApply', inputs: { model: ['30', 0], image: ['7', 0] } },
        19: { class_type: 'KSampler', inputs: { model: ['18', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['11', 0], seed: 3, denoise: 0.85 } },
        20: { class_type: 'VAEDecodeTiled', inputs: { samples: ['19', 0], vae: ['8', 0] } },
        21: { class_type: 'ColorMatch', inputs: { image_ref: ['7', 0], image_target: ['20', 0] } },
        22: { class_type: 'SaveImage', inputs: { images: ['21', 0], filename_prefix: 'two_pass/upscaled' } },
    };
    const before = JSON.stringify(output);
    const got = baseOnly(output);
    assert.equal(JSON.stringify(output), before, 'the queued prompt is cut down in a copy');
    assert.deepEqual(got.bases, [{ node: '32', type: 'KSamplerAdvanced', names: ['noise_seed'] }]);
    assert.deepEqual(got.shows, ['9']);
    assert.deepEqual(got.saved, ['9'], 'the full run saves this base again: it can be compared');
    assert.equal(got.prefix, 'two_pass/base');
    assert.deepEqual(Object.keys(got.output).sort(), ['1', '2', '3', '32', '5', '6', '7', '8', '9']);
    assert.deepEqual(got.output[9], { class_type: 'PreviewImage', inputs: { images: ['7', 0] } });
    assert.equal(got.output[32], output[32], 'a base that finishes on its own runs as it is: the same picture');

    // The run after the pick: the second pass takes the kept picture wherever it took the base's, the base is not drawn again.
    const kept = onKeptBase(output, 'anomalous_reference_abc.png');
    assert.deepEqual(kept[33], { class_type: 'LoadImage', inputs: { image: 'anomalous_reference_abc.png' } });
    assert.deepEqual([kept[10].inputs.pixels, kept[18].inputs.image, kept[21].inputs.image_ref], [['33', 0], ['33', 0], ['33', 0]]);
    assert.deepEqual(kept[21].inputs.image_target, ['20', 0]);
    assert.deepEqual(Object.keys(kept).sort(), ['10', '11', '18', '19', '2', '20', '21', '22', '3', '30', '33', '5', '8'], 'the base model and its empty latent are not loaded');
    assert.equal(JSON.stringify(output), before, 'the queued prompt is changed in a copy');
}

// A later step that previews a mask cut from the base (only the character redrawn): the mask is no base to pick.
{
    const output = {
        ...loaders,
        32: advanced('1', '6', 0, 35, 'disable'),
        7: { class_type: 'VAEDecode', inputs: { samples: ['32', 0], vae: ['8', 0] } },
        9: { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'picture' } },
        40: { class_type: 'InspyrenetRembg', inputs: { image: ['7', 0] } },
        41: { class_type: 'MaskToImage', inputs: { mask: ['40', 1] } },
        42: { class_type: 'PreviewImage', inputs: { images: ['41', 0] } },
        43: { class_type: 'VAEEncode', inputs: { pixels: ['7', 0], vae: ['8', 0] } },
        44: { class_type: 'SetLatentNoiseMask', inputs: { samples: ['43', 0], mask: ['40', 1] } },
        45: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['44', 0], seed: 5, denoise: 0.7 } },
        46: { class_type: 'VAEDecode', inputs: { samples: ['45', 0], vae: ['8', 0] } },
        47: { class_type: 'SaveImage', inputs: { images: ['46', 0], filename_prefix: 'upscaled_character' } },
    };
    const got = baseOnly(output);
    assert.deepEqual(got.shows, ['9'], 'the base alone, not the mask preview');
    assert.deepEqual(Object.keys(got.output).sort(), ['1', '2', '3', '32', '5', '6', '7', '8', '9'], 'nothing is cut out for a base to pick');
    const kept = onKeptBase(output, 'kept.png');
    assert.deepEqual([kept[40].inputs.image, kept[43].inputs.pixels], [['48', 0], ['48', 0]], 'the rest cuts and redraws the kept picture');
    assert.ok(kept[42] && kept[47] && !kept[32] && !kept[9], 'the mask preview is the rest\'s, the base is not drawn again');
}

// The mid-way switch: the first model hands its unfinished latent to the second; the base is finished and decoded to show.
{
    const output = {
        ...loaders, 30: { class_type: 'UNETLoader', inputs: { unet_name: 'b.safetensors', weight_dtype: 'default' } },
        32: advanced('1', '6', 0, 21, 'enable'), 33: { ...advanced('30', '32', 21, 10000, 'disable') },
        7: { class_type: 'VAEDecodeTiled', inputs: { samples: ['33', 0], vae: ['8', 0], tile_size: 512 } },
        9: { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'relay' } },
    };
    output[33].inputs.add_noise = 'disable';
    const got = baseOnly(output);
    assert.deepEqual(got.bases.map(base => base.node), ['32']);
    assert.deepEqual(got.shows, ['35']);
    assert.deepEqual(got.saved, [], 'the full run never shows this base');
    assert.equal(got.prefix, '');
    assert.deepEqual(got.output[34], { class_type: 'VAEDecodeTiled', inputs: { samples: ['32', 0], vae: ['8', 0], tile_size: 512 } },
        'decoded as the canvas decodes');
    assert.deepEqual(got.output[35], { class_type: 'PreviewImage', inputs: { images: ['34', 0] } });
    assert.equal(got.output[32].inputs.end_at_step, 10000);
    assert.equal(got.output[32].inputs.return_with_leftover_noise, 'disable');
    assert.equal(output[32].inputs.end_at_step, 21, 'the canvas prompt keeps its switch');
    assert.equal(onKeptBase(output, 'kept.png'), null, 'a latent handed on cannot come from a picture: drawn again from its seed');
    assert.deepEqual(Object.keys(got.output).sort(), ['1', '2', '3', '32', '34', '35', '5', '6', '8']);
}

// One pass only: the whole picture, shown and not saved.
{
    const output = {
        ...loaders, 4: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['6', 0], seed: 1 } },
        7: { class_type: 'VAEDecode', inputs: { samples: ['4', 0], vae: ['8', 0] } },
        9: { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'ComfyUI' } },
    };
    const got = baseOnly(output);
    assert.deepEqual(got.bases, [{ node: '4', type: 'KSampler', names: ['seed'] }]);
    assert.equal(got.output[9].class_type, 'PreviewImage');
    assert.equal(onKeptBase(output, 'kept.png'), null, 'nothing after the base');
}

assert.throws(() => baseOnly({ ...loaders }), /No sampler/);
console.log('base_only: ok');
