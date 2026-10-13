/**
 * Which LoRAs a canvas node loads, for a workflow's summary (recipe_parser.js): ComfyUI's LoRA
 * loaders and nodes named like one, all-in-one loaders (recipe_identity.js), stack nodes' rows
 * (lora_N_name / lora_name_N with their strengths) and rgthree's Power Lora Loader rows that are
 * switched on (lora_nodes.js). Also keeps the summary's LoRAs in step with an edited loader box.
 */

import { isAllInOneLoaderType, isPlaceholderModelValue } from './recipe_identity.js';
import { POWER_LORA, powerLoraRows } from './lora_nodes.js';
import { isSelectedModelFile, normaliseName, numberValue, textValue, widgetValue } from './recipe_widgets.js';

const LORA_LOADER = /lora.*loader|loader.*lora/i;
const POWER_LORA_TYPE = POWER_LORA.toLowerCase();

/** [{ name, strength_model, strength_clip }] for `node`, whose type recipe_parser read as `type`. */
export function nodeLoras(node, type) {
    if (normaliseName(type) === POWER_LORA_TYPE) {
        return powerLoraRows(node).filter((row) => row.on && isSelectedModelFile(row.lora))
            .map((row) => ({ name: row.lora, strength_model: row.strength, strength_clip: row.strengthTwo ?? row.strength }));
    }
    const loras = [];
    // LoRA loaders and all-in-one loaders: one entry per node, like the loaders themselves.
    const isLoraLoader = LORA_LOADER.test(type);
    if (isLoraLoader || isAllInOneLoaderType(type)) {
        const loraName = textValue(widgetValue(node, ['lora_name', 'lora', 'model_name'], isLoraLoader ? 0 : -1));
        if (isLoraLoader ? loraName && !isPlaceholderModelValue(loraName) : isSelectedModelFile(loraName)) {
            loras.push({
                name: loraName,
                strength_model: numberValue(widgetValue(node, ['strength_model', 'model_strength', 'lora_model_strength'], isLoraLoader ? 1 : -1)),
                strength_clip: numberValue(widgetValue(node, ['strength_clip', 'clip_strength', 'lora_clip_strength'], isLoraLoader ? 2 : -1)),
            });
        }
    }

    if (Array.isArray(node.widgets)) {
        for (const widget of node.widgets) {
            const wName = String(widget?.name || '').toLowerCase();
            const match = wName.match(/^lora(?:_(\d+))?_name$/) || wName.match(/^lora_name_(\d+)$/);
            if (match && match[1]) {
                const slotNum = match[1];
                const slotVal = textValue(widget?.value);
                if (isSelectedModelFile(slotVal)) {
                    const slotStrengthModel = numberValue(widgetValue(node, [`lora_${slotNum}_strength`, `lora_${slotNum}_model_strength`, `lora_model_strength_${slotNum}`], -1));
                    const slotStrengthClip = numberValue(widgetValue(node, [`lora_${slotNum}_clip_strength`, `lora_clip_strength_${slotNum}`], -1));
                    loras.push({
                        name: slotVal,
                        strength_model: slotStrengthModel,
                        strength_clip: slotStrengthClip,
                    });
                }
            }
        }
    }
    return loras;
}

/** Current LoRA file shown by the edited node (single-LoRA loaders or a `lora_N_*` stack slot). */
function loraNameForChange(params, change, widget) {
    const summary = (params.nodes || []).find((item) => String(item?.id) === String(change.nodeId));
    const slot = /^lora_(\d+)_/.exec(widget)?.[1];
    const names = slot ? [`lora_${slot}_name`] : ['lora_name', 'lora', 'model_name'];
    const nameWidget = (summary?.widgets || []).find((item) => names.includes(normaliseName(item?.name)));
    return textValue(nameWidget?.value);
}

/** Keeps the summary's LoRAs in step with an edited box of a LoRA loader or stack row. */
export function syncLoraMetadata(params, change, type, widget) {
    const isLoraNode = LORA_LOADER.test(type) || isAllInOneLoaderType(type);
    const isStackSlot = /^lora_\d+_(name|strength|model_strength|clip_strength)$|^lora_name_\d+$/.test(widget);
    if (!isLoraNode && !isStackSlot) return;
    if (!Array.isArray(params.loras)) return;

    if (/^(lora_name|lora|lora_\d+_name|lora_name_\d+)$/.test(widget) || (LORA_LOADER.test(type) && widget === 'model_name')) {
        const previous = textValue(change.previousValue);
        const lora = params.loras.find((item) => item?.name === previous);
        if (lora && isSelectedModelFile(change.value)) lora.name = textValue(change.value);
        return;
    }
    const lora = params.loras.find((item) => item?.name === loraNameForChange(params, change, widget));
    if (!lora) return;
    if (/^(strength_model|model_strength|lora_model_strength|lora_\d+_strength|lora_\d+_model_strength)$/.test(widget)) {
        lora.strength_model = numberValue(change.value);
    }
    if (/^(strength_clip|clip_strength|lora_clip_strength|lora_\d+_clip_strength)$/.test(widget)) {
        lora.strength_clip = numberValue(change.value);
    }
}
