// Where a downloaded model goes (web/modules/download_places.js).
import assert from 'node:assert/strict';
import { baseFolder, destinationFor, expandFolder, unsafeFormat } from '../web/modules/download_places.js';

const entry = (value) => ({ value });
const workflow = { place: 'workflow', folder: 'Downloads' };
const fixed = { place: 'folder', folder: 'Downloads' };

// Where the workflow says: its own subfolder (Windows separators too), so the node needs no change.
assert.equal(destinationFor(entry('Flux\\style\\ink.safetensors'), {}, workflow), 'Flux/style/ink.safetensors');
// A bare name goes into the settings' folder; an empty folder means the type's folder itself.
assert.equal(destinationFor(entry('ink.safetensors'), {}, workflow), 'Downloads/ink.safetensors');
assert.equal(destinationFor(entry('ink.safetensors'), {}, { place: 'workflow', folder: '' }), 'ink.safetensors');
// A set folder wins over the workflow's; the file keeps the workflow's name.
assert.equal(destinationFor(entry('Flux/ink.safetensors'), {}, fixed), 'Downloads/ink.safetensors');

// {base}: the usual folder name of the base model, or the folder you already have for it.
assert.equal(baseFolder('SDXL 1.0'), 'SDXL');
assert.equal(baseFolder('Flux.1 D'), 'Flux');
assert.equal(baseFolder('SD 1.5'), 'SD1.5');
assert.equal(baseFolder('Illustrious', ['illustrious', 'pony']), 'illustrious');
assert.equal(baseFolder('SD 1.5', ['sd15']), 'sd15');
assert.equal(baseFolder('Some: New/Model'), 'Some New Model');
assert.equal(baseFolder(''), '');
const subfolders = ['Characters', 'Characters/SDXL', 'Downloads', 'Downloads/flux-models', 'NoobAI'];
assert.equal(expandFolder('{base}', 'Flux.1 D', subfolders), 'Flux'); // the nested one is not beside it
assert.equal(expandFolder('Downloads/{base}', 'Flux.1 D', subfolders), 'Downloads/Flux');
assert.equal(expandFolder('downloads/{base}', 'SDXL 1.0', ['Downloads', 'Downloads/sd-xl']), 'downloads/sd-xl');
assert.equal(expandFolder('{base}', 'NoobAI', subfolders), 'NoobAI');
assert.equal(expandFolder('{base}/loras', '', subfolders), 'loras'); // unknown base: the part goes
assert.equal(destinationFor(entry('a.safetensors'), { base_model: 'Pony' }, { place: 'folder', folder: '{base}' }), 'Pony/a.safetensors');

assert.equal(unsafeFormat('x.ckpt'), true);
assert.equal(unsafeFormat('x.PT'), true);
assert.equal(unsafeFormat('x.safetensors'), false);
assert.equal(unsafeFormat('x.gguf'), false);

console.log('download_places: ok');
