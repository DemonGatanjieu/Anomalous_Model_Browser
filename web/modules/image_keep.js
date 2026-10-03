/**
 * Keeping an output image (the gallery's star, the image workbench) as one of three things:
 * its whole workflow as a Workflow Recipe (recipe_save.js), its main model, LoRAs and
 * positive prompt as a combo (搭配, a file of GET /anomalous/notebooks), or its prompts as a
 * saved prompt (POST /anomalous/save_prompt_plan). The image's workflow is laid on a
 * canvas of its own and read like a recipe saved from it (recipe_parser.js); its models are
 * looked up among this computer's files. Each thing kept remembers its image, so
 * GET /anomalous/kept_images can say what an image was kept as. No DOM.
 */

import { extractRecipeMetadata } from './recipe_parser.js';
import { categorizePromptSnippet, promptTitle } from './prompt_composition.js';
import { jsonResponse } from './ui_dom.js';

const MAIN_TYPES = ['checkpoints', 'unet', 'diffusion_models'];
// The combo editor lists models without a base model under this value (notebook_canvas.js).
const UNLABELED_BASE_MODEL = '__unlabeled__';

const post = (url, body) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

/** The key of an output image in the map loadKeptImages() returns. */
export const keptKey = image => `${image?.subfolder || ''}\n${image?.filename || ''}`;

/** Map(keptKey → { recipe, combo, prompt }), each { filename, name } or null. */
export async function loadKeptImages(signal) {
    const response = await fetch('/anomalous/kept_images', { cache: 'no-store', signal });
    const { images = [] } = await jsonResponse(response, 'list kept images');
    return new Map(images.map(item => [keptKey(item), item]));
}

/** What the image's workflow uses (extractRecipeMetadata) and a name: its prompt's first tags, else the file's. */
async function readImage(sourceImage) {
    const info = await jsonResponse(await post('/anomalous/inspect_image_material', { source_image: sourceImage }), 'read image workflow');
    const graph = new globalThis.LiteGraph.LGraph();
    graph.configure(JSON.parse(JSON.stringify(info.workflow)));
    const metadata = extractRecipeMetadata(graph);
    const name = promptTitle(metadata.promptPositive[0]) || String(sourceImage?.filename || '').replace(/\.[^.]+$/, '');
    return { name, metadata };
}

/** { path → this computer's model } for the paths found among `types`. */
async function localModels(paths, types) {
    if (!paths.length) return {};
    const response = await post('/anomalous/resolve_paths_to_previews', { paths, folder_types: types });
    const { models = {} } = await jsonResponse(response, 'look up models');
    // The editor's model entries carry no absolute path.
    return Object.fromEntries(Object.entries(models).map(([path, { file_path, ...model }]) => [path, model]));
}

/** Every combo: [{ filename, name, data }]. */
export async function listCombos() {
    const response = await fetch('/anomalous/notebooks', { cache: 'no-store' });
    return (await jsonResponse(response, 'list combos')).notebooks || [];
}

const sameImage = (a, b) => Boolean(a?.filename && b?.filename) && keptKey(a) === keptKey(b);

/** `name`, or `name 2`, `name 3`… so a new combo never overwrites another one's file. */
export function freeComboName(name, combos) {
    const taken = new Set(combos.map(note => note.filename.toLowerCase()));
    const base = String(name || '').trim().replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 100) || 'Combo';
    for (let n = 1; ; n += 1) {
        const candidate = n === 1 ? base : `${base} ${n}`;
        if (!taken.has(`${candidate}.json`.toLowerCase())) return candidate;
    }
}

/**
 * Keeps the image's main model, LoRAs and positive prompt as a combo; an image kept before
 * gives that combo back (`existed`). Models this computer does not have are left out and
 * named in `missing`. Returns { filename, name, existed, missing }.
 */
export async function keepImageAsCombo(sourceImage, { name = '' } = {}) {
    const combos = await listCombos();
    const kept = combos.find(note => sameImage(note.data?.source_image, sourceImage));
    if (kept) return { filename: kept.filename, name: kept.name, existed: true, missing: [] };
    const image = await readImage(sourceImage);
    const main = image.metadata.baseModel || '';
    const loraPaths = [...new Set((image.metadata.loras || []).map(lora => lora.name).filter(Boolean))];
    const [mains, loras] = await Promise.all([
        localModels(main ? [main] : [], MAIN_TYPES),
        localModels(loraPaths, ['loras']),
    ]);
    const mainModel = mains[main] || null;
    const comboName = freeComboName(name || image.name, combos);
    const data = {
        name: comboName,
        baseModel: mainModel ? String(mainModel.metadata?.baseModel || '').trim() || UNLABELED_BASE_MODEL : '',
        mainModel,
        loras: loraPaths.filter(path => loras[path]).map(path => loras[path]),
        promptEn: image.metadata.promptPositive.join('\n'),
        promptZh: '',
        source_image: sourceImage,
    };
    const filename = `${comboName}.json`;
    const response = await post('/anomalous/save_notebook', { filename, name: comboName, data });
    if ((await jsonResponse(response, 'save combo')).status !== 'success') throw new Error('combo save failed');
    const missing = [...(main && !mainModel ? [main] : []), ...loraPaths.filter(path => !loras[path])];
    return { filename, name: comboName, existed: false, missing };
}

/**
 * Keeps the image's positive and negative prompts as one saved prompt; the same prompts
 * saved before give that one back (`existed`). Returns { filename, name, existed }, or
 * { empty: true } when the workflow has no prompt.
 */
export async function keepImagePrompts(sourceImage, { name = '' } = {}) {
    const image = await readImage(sourceImage);
    const positive = image.metadata.promptPositive.join('\n');
    const negative = image.metadata.promptNegative.join('\n');
    if (!positive.trim() && !negative.trim()) return { empty: true };
    const promptName = String(name || image.name || sourceImage.filename).trim().slice(0, 120);
    const parts = [['positive', positive], ['negative', negative]].filter(([, text]) => text.trim()).map(([role, text]) => ({
        name: promptName,
        category: role === 'negative' ? 'base' : categorizePromptSnippet(text),
        role,
        positive: role === 'positive' ? text : '',
        negative: role === 'negative' ? text : '',
        enabled: true,
    }));
    const response = await post('/anomalous/save_prompt_plan', {
        name: promptName,
        plan: { version: 2, positive, negative, parts },
        source_image: sourceImage,
    });
    // The same prompts saved before come back as that saved prompt (409), not a copy.
    const payload = response.status === 409 ? await response.json() : await jsonResponse(response, 'save prompts');
    if (!['success', 'duplicate'].includes(payload.status)) throw new Error('prompt save failed');
    return { filename: payload.filename, name: payload.name || promptName, existed: payload.status === 'duplicate' };
}
