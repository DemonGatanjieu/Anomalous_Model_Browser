/**
 * An output image kept as a combo of its own nodes (image_keep.js keepImageAsCombo): the part
 * of its workflow that makes the sampler's model and prompts (sampler_inputs.js), laid on a
 * graph of its own, saved like nodes picked on the canvas (combo_structure.js) with every value
 * as the image had it: LoRA strengths, CLIP skip, the negative prompt. A combo never changes a
 * value (AGENTS.md, 功能原则). Models are looked up among this computer's files: one found
 * there is named by where it is here; one not found keeps the workflow's name and is reported.
 */

import { captureStructure } from './combo_structure.js';
import { NONE, STRUCTURED } from './combo_slots.js';
import { slotLabel } from './ui_combo_structure.js';
import { samplerSideNodes } from './sampler_inputs.js';

const MAIN_FOLDERS = new Set(['checkpoints', 'unet', 'diffusion_models']);
const relOf = model => [String(model.subfolder || '').replace(/^\/+|\/+$/g, ''), model.filename].filter(Boolean).join('/');

/**
 * The combo data of `graph`'s sampler side, or null when the workflow has no sampler to read
 * from. `localModels(paths, folders)` gives { path → this computer's model }. Returns { data:
 * { kind, structure, values, covers }, mainModel, loras, missing }.
 */
export async function keepGraphNodes(graph, localModels) {
    const nodes = samplerSideNodes(graph);
    if (!nodes.length) return null;
    const { structure, values } = await captureStructure(nodes, { labelFor: slotLabel });
    if (!structure) return null;
    // An empty row of a stack node is no slot (as when saving from the canvas, unticked).
    const slots = structure.slots.filter(slot => !(slot.optional && NONE.test(String(values[slot.id] ?? ''))));
    const kept = Object.fromEntries(slots.map(slot => [slot.id, values[slot.id]]));
    const covers = {};
    const missing = [];
    let mainModel = null;
    const loras = [];
    const models = slots.filter(slot => slot.kind === 'model' && !NONE.test(String(kept[slot.id] ?? '')));
    const folders = [...new Set(models.map(slot => slot.folder).filter(Boolean))];
    const found = await localModels([...new Set(models.map(slot => kept[slot.id]))], folders);
    for (const slot of models) {
        const model = found[kept[slot.id]];
        if (!model) {
            missing.push(kept[slot.id]);
            continue;
        }
        kept[slot.id] = relOf(model);
        if (model.preview_url) covers[slot.id] = model.preview_url;
        if (!mainModel && MAIN_FOLDERS.has(slot.folder)) mainModel = model;
        if (slot.folder === 'loras') loras.push(model);
    }
    return {
        data: { kind: STRUCTURED, structure: { ...structure, slots }, values: kept, covers },
        mainModel,
        loras,
        missing,
    };
}
