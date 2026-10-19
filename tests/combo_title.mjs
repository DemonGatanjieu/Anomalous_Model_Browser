// The name a combo kept from an output image gets (web/modules/image_keep.js comboTitle).
import assert from 'node:assert/strict';
import { comboTitle } from '../web/modules/image_keep.js';

const lora = { filename: 'Ahri_v2.safetensors', metadata: {} };
const main = { filename: 'illustriousXL.safetensors', metadata: { custom_name: 'Illustrious XL' } };
const prompt = 'masterpiece, best quality, 1girl, solo, ahri, fox ears, kimono, looking at viewer';

// The first LoRA, then two tags that are neither quality words nor ones every picture has.
assert.equal(comboTitle({ prompt, mainModel: main, loras: [lora] }), 'Ahri_v2 · ahri, fox ears');
// No LoRA: the main model's own name.
assert.equal(comboTitle({ prompt: '1girl, (red hair:1.2), beach', mainModel: main }), 'Illustrious XL · red hair, beach');
// A LoRA's name from its card wins over its file's; a path keeps only the file.
assert.equal(comboTitle({ loras: [{ filename: 'chars\\x.safetensors', metadata: { custom_name: 'Nahida' } }] }), 'Nahida');
assert.equal(comboTitle({ mainModel: { filename: 'sdxl\\base.safetensors' } }), 'base');
assert.equal(comboTitle({ mainModel: { filename: 'sdxl/base.safetensors' } }), 'base');
// Nothing to go on: the fallback.
assert.equal(comboTitle({ prompt: 'masterpiece, 1girl, solo', fallback: 'ComfyUI_00012_' }), 'ComfyUI_00012_');
console.log('combo title: ok');
