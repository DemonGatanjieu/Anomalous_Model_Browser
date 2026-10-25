/**
 * Keeping an output image (the gallery's star, the image workbench) as one of three things:
 * its whole workflow as a Workflow Recipe (recipe_save.js), the nodes that make its sampler's
 * model and prompts as a combo (搭配, a file of GET /anomalous/notebooks; image_keep_nodes.js,
 * every value as the image had it; a workflow without a sampler to read from gives its main
 * model, LoRAs and positive prompt), or its prompts as a saved prompt
 * (POST /anomalous/save_prompt_plan). The image's workflow is laid on a
 * canvas of its own and read like a recipe saved from it (recipe_parser.js); its models are
 * looked up among this computer's files. Each thing kept remembers its image, so
 * GET /anomalous/kept_images can say what an image was kept as. No DOM.
 */

import { extractRecipeMetadata } from './recipe_parser.js';
import { categorizePromptSnippet, promptTitle } from './prompt_composition.js';
import { jsonResponse } from './ui_dom.js';
import { readDetached } from './detached_graph.js';

const MAIN_TYPES = ['checkpoints', 'unet', 'diffusion_models'];
// Tags nearly every picture has: a combo's name skips them so two combos read apart.
const COMMON_TAG = /^(?:\d+\s*(?:girls?|boys?|others?)|solo|solo focus|looking at viewer|simple background|white background|smile|blush|open mouth|upper body|full body|cowboy shot)$/i;
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

const fileStem = name => String(name || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');

/** What the image's workflow uses (extractRecipeMetadata) and a name: its prompt's first tags, else the file's. */
async function readImage(sourceImage) {
    const info = await jsonResponse(await post('/anomalous/inspect_image_material', { source_image: sourceImage }), 'read image workflow');
    const metadata = readDetached(info.workflow, extractRecipeMetadata);
    const name = promptTitle(metadata.promptPositive[0]) || fileStem(sourceImage?.filename);
    return { name, metadata, workflow: info.workflow };
}

/** A model's name as its card shows it: the name the user gave it, else the file's. */
const modelLabel = model => String(model?.metadata?.custom_name || '').trim() || fileStem(model?.filename);

/**
 * A combo's name that tells combos apart: its first LoRA (else its main model), then the
 * prompt's first two telling tags — "Ahri · fox ears, kimono"; the file's name when neither.
 */
export function comboTitle({ prompt = '', mainModel = null, loras = [], fallback = '' } = {}) {
    const model = modelLabel(loras[0] || mainModel).slice(0, 40);
    const subject = promptTitle(prompt, { count: 2, skip: COMMON_TAG });
    return [model, subject].filter(Boolean).join(' · ') || fallback;
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

/** Saves combo `data` under a free name from `wanted`. Returns { filename, name }. */
async function saveCombo(data, wanted, combos) {
    const comboName = freeComboName(wanted, combos);
    const filename = `${comboName}.json`;
    const response = await post('/anomalous/save_notebook', { filename, name: comboName, data: { ...data, name: comboName } });
    if ((await jsonResponse(response, 'save combo')).status !== 'success') throw new Error('combo save failed');
    return { filename, name: comboName };
}

/**
 * Keeps the image as a combo of the nodes that make its sampler's model and prompts, every
 * value as it was; an image kept before gives that combo back (`existed`). Models this
 * computer does not have are named in `missing` (kept by the workflow's name, `missingKept`). A workflow
 * without a sampler to read from gives a combo of its main model, LoRAs and positive prompt.
 * Returns { filename, name, existed, missing }.
 */
export async function keepImageAsCombo(sourceImage, { name = '' } = {}) {
    const combos = await listCombos();
    const kept = combos.find(note => sameImage(note.data?.source_image, sourceImage));
    if (kept) return { filename: kept.filename, name: kept.name, existed: true, missing: [] };
    const image = await readImage(sourceImage);
    const prompt = image.metadata.promptPositive.join('\n');
    // Loaded only here: it reaches the canvas modules (no DOM in this file, and tests import it).
    const { keepGraphNodes } = await import('./image_keep_nodes.js');
    const nodes = await readDetached(image.workflow, graph => keepGraphNodes(graph, localModels));
    if (nodes) {
        const title = comboTitle({ prompt, mainModel: nodes.mainModel, loras: nodes.loras, fallback: image.name });
        const saved = await saveCombo({ ...nodes.data, source_image: sourceImage }, name || title, combos);
        return { ...saved, existed: false, missing: nodes.missing, missingKept: true };
    }
    return keepSimpleCombo(sourceImage, image, prompt, name, combos);
}

/** The older kind of combo: the image's main model, LoRAs and positive prompt. */
async function keepSimpleCombo(sourceImage, image, prompt, name, combos) {
    const main = image.metadata.baseModel || '';
    const loraPaths = [...new Set((image.metadata.loras || []).map(lora => lora.name).filter(Boolean))];
    const [mains, loras] = await Promise.all([
        localModels(main ? [main] : [], MAIN_TYPES),
        localModels(loraPaths, ['loras']),
    ]);
    const mainModel = mains[main] || null;
    const localLoras = loraPaths.filter(path => loras[path]).map(path => loras[path]);
    const saved = await saveCombo({
        baseModel: mainModel ? String(mainModel.metadata?.baseModel || '').trim() || UNLABELED_BASE_MODEL : '',
        mainModel,
        loras: localLoras,
        promptEn: prompt,
        promptZh: '',
        source_image: sourceImage,
    }, name || comboTitle({ prompt, mainModel, loras: localLoras, fallback: image.name }), combos);
    const missing = [...(main && !mainModel ? [main] : []), ...loraPaths.filter(path => !loras[path])];
    return { ...saved, existed: false, missing };
}

/** Gives the combo kept in `filename` the name `name` (its file keeps its name). Returns the name. */
export async function renameCombo(filename, name) {
    const wanted = String(name || '').trim().slice(0, 100);
    const note = (await listCombos()).find(item => item.filename === filename);
    if (!wanted || !note) throw new Error('combo rename failed');
    const response = await post('/anomalous/save_notebook', { filename, data: { ...note.data, name: wanted } });
    if ((await jsonResponse(response, 'rename combo')).status !== 'success') throw new Error('combo rename failed');
    return wanted;
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
