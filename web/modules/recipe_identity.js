import { inferModelFolderTypes } from './model_policies.js';

/** Pure helpers for recipe model references and provenance labels. */

const MODEL_FILE_PATTERN = /\.(?:safetensors|ckpt|pt|bin|sft)$/i;
const VERIFIABLE_RECIPE_MODEL_CATEGORIES = new Set([
    'checkpoint',
    'lora',
    'unet',
    'controlnet',
    'vae',
    'text_encoder',
    'clip_vision',
]);

function nodeType(node) {
    return String(node?.type || node?.class_type || '').trim();
}

function nodeTitle(node) {
    return String(node?._meta?.title || node?.title || nodeType(node) || 'Unknown node').trim();
}

export function deriveNodeModelSpecs(nodeOrType) {
    const node = typeof nodeOrType === 'string' ? { type: nodeOrType } : (nodeOrType || {});
    const type = nodeType(node);
    const lowered = type.toLowerCase();

    // Tier 2: Static known mapping table for classic native nodes (100% backward compatible)
    if (/checkpointloader(simple)?$/.test(lowered)) return [[0, 'checkpoint', 'ckpt_name']];
    if (lowered.endsWith('unetloader')) return [[0, 'unet', 'unet_name']];
    if (/loraloader/.test(lowered)) return [[0, 'lora', 'lora_name']];
    if (lowered.endsWith('vaeloader')) return [[0, 'vae', 'vae_name']];
    if (lowered.endsWith('clipvisionloader')) return [[0, 'clip_vision', 'clip_name']];
    if (lowered.endsWith('controlnetloader')) return [[0, 'controlnet', 'control_net_name']];
    if (/(^|[^a-z])(?:dual|triple)?cliploader$/.test(lowered)) {
        const specs = [[0, 'text_encoder', 'clip_name1']];
        if (lowered.includes('dualclip') || lowered.includes('tripleclip')) specs.push([1, 'text_encoder', 'clip_name2']);
        if (lowered.includes('tripleclip')) specs.push([2, 'text_encoder', 'clip_name3']);
        return specs;
    }

    // Tier 1: Live node with widgets array (inspect widget names and folder types dynamically)
    if (Array.isArray(node.widgets) && node.widgets.length > 0) {
        const specs = [];
        for (const [index, widget] of node.widgets.entries()) {
            if (!widget) continue;
            const widgetName = String(widget.name || widget.label || '').trim();
            const folderTypes = inferModelFolderTypes(node, widget);
            let category = null;
            if (folderTypes.includes('checkpoints')) category = 'checkpoint';
            else if (folderTypes.includes('diffusion_models') || folderTypes.includes('unet')) category = 'unet';
            else if (folderTypes.includes('loras')) category = 'lora';
            else if (folderTypes.includes('vae')) category = 'vae';
            else if (folderTypes.includes('controlnet')) category = 'controlnet';
            else if (folderTypes.includes('clip_vision')) category = 'clip_vision';
            else if (folderTypes.includes('text_encoders') || folderTypes.includes('clip')) category = 'text_encoder';

            if (!category) {
                const lowerName = widgetName.toLowerCase();
                if (/^(ckpt_name|checkpoint|base_model)$/.test(lowerName)) category = 'checkpoint';
                else if (/^(unet_name|unet)$/.test(lowerName)) category = 'unet';
                else if (/^(vae_name|vae)$/.test(lowerName)) category = 'vae';
                else if (/^(lora_name|lora|lora_\d+_name)$/.test(lowerName)) category = 'lora';
                else if (/^(control_net_name|controlnet_name|controlnet)$/.test(lowerName)) category = 'controlnet';
                else if (/^(clip_name|clip|text_encoder)$/.test(lowerName)) category = 'text_encoder';
            }

            if (category) {
                specs.push([index, category, widgetName || category]);
            }
        }
        if (specs.length > 0) return specs;
    }

    // Tier 3: Serialized JSON node without widgets array
    // Known All-in-One loader layout patterns
    if (/easy.*a1111loader/i.test(lowered)) {
        return [[0, 'checkpoint', 'ckpt_name'], [1, 'vae', 'vae_name'], [3, 'lora', 'lora_name']];
    }
    if (/easy.*fullloader/i.test(lowered)) {
        return [[0, 'checkpoint', 'ckpt_name'], [2, 'vae', 'vae_name'], [4, 'lora', 'lora_name']];
    }
    if (/efficient.*loader/i.test(lowered)) {
        return [[0, 'checkpoint', 'ckpt_name'], [1, 'vae', 'vae_name'], [3, 'lora', 'lora_name']];
    }

    // General serialized JSON node inference via widgets_values scan
    if (Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
        const specs = [];
        let hasCheckpoint = false;
        for (const [index, val] of node.widgets_values.entries()) {
            if (typeof val !== 'string' || !val.trim() || val.trim().toLowerCase() === 'none') continue;
            if (!MODEL_FILE_PATTERN.test(val)) continue;

            const lowerVal = val.toLowerCase();
            let category = null;
            let widgetName = `model_${index}`;

            if (/(?:^|[\\/_-])vae(?:[\\/_-]|\.|$)/i.test(lowerVal) || lowerVal.includes('vae') || lowered.includes('vae')) {
                category = 'vae';
                widgetName = 'vae_name';
            } else if (/(?:^|[\\/_-])lora(?:[\\/_-]|\.|$)/i.test(lowerVal) || lowerVal.includes('lora') || lowered.includes('lora')) {
                category = 'lora';
                widgetName = `lora_name_${index}`;
            } else if (/(?:^|[\\/_-])controlnet(?:[\\/_-]|\.|$)/i.test(lowerVal) || lowerVal.includes('controlnet') || lowered.includes('controlnet')) {
                category = 'controlnet';
                widgetName = `controlnet_name_${index}`;
            } else if (/(?:^|[\\/_-])clip(?:[\\/_-]|\.|$)/i.test(lowerVal) || lowerVal.includes('clip') || lowered.includes('clip')) {
                category = 'text_encoder';
                widgetName = `clip_name_${index}`;
            } else if (lowered.includes('unet')) {
                category = 'unet';
                widgetName = 'unet_name';
            } else if (!hasCheckpoint) {
                category = 'checkpoint';
                widgetName = 'ckpt_name';
                hasCheckpoint = true;
            } else {
                category = 'checkpoint';
                widgetName = `ckpt_name_${index}`;
            }

            specs.push([index, category, widgetName]);
        }
        if (specs.length > 0) return specs;
    }

    return [];
}

export const modelSpecs = deriveNodeModelSpecs;


function statusFor(identity) {
    const status = identity?.status;
    return ['verified', 'unverified', 'unavailable'].includes(status) ? status : 'unavailable';
}

export function normaliseIdentity(identity) {
    const result = { ...(identity || {}) };
    result.status = statusFor(identity);
    if (typeof result.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(result.sha256)) delete result.sha256;
    if (!Number.isFinite(Number(result.size))) delete result.size;
    return result;
}

function workflowIdentity(workflow, nodeId, savedValue) {
    const hashes = workflow?.extra?.anomalous_hashes;
    if (!hashes || typeof savedValue !== 'string') return null;
    const normalized = savedValue.replace(/\\/g, '/');
    const windowsPath = savedValue.replace(/\//g, '\\');
    const record = hashes[`${nodeId}_${savedValue}`]
        || hashes[`${nodeId}_${normalized}`]
        || hashes[`${nodeId}_${windowsPath}`]
        || hashes[savedValue]
        || hashes[normalized]
        || hashes[windowsPath];
    const sha256 = typeof record === 'string' ? record : record?.hash;
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) return null;
    const identity = {
        status: 'verified',
        sha256: sha256.toLowerCase(),
        provenance: 'workflow snapshot',
    };
    if (record?.size !== null && record?.size !== '' && Number.isFinite(Number(record?.size))) {
        identity.size = Number(record.size);
    }
    return identity;
}

export function canVerifyRecipeModelReference(reference) {
    return VERIFIABLE_RECIPE_MODEL_CATEGORIES.has(String(reference?.category || '').toLowerCase());
}

export function deriveRecipeModelReferences(recipe) {
    const stored = recipe?.params?.model_references;
    if (Array.isArray(stored) && stored.length) {
        return stored.map((reference) => ({
            ...reference,
            identity: normaliseIdentity(reference.identity),
        }));
    }

    const references = [];
    for (const node of recipe?.workflow?.nodes || []) {
        const type = nodeType(node);
        const values = Array.isArray(node?.widgets_values) ? node.widgets_values : [];
        for (const [widgetIndex, category, widgetName] of deriveNodeModelSpecs(node)) {
            const savedValue = values[widgetIndex];
            if (typeof savedValue !== 'string' || !savedValue.trim() || savedValue.trim().toLowerCase() === 'none') continue;
            const identity = workflowIdentity(recipe?.workflow, node?.id, savedValue)
                || { status: 'unverified' };
            references.push({
                node_id: node?.id ?? null,
                node_type: type || 'Unknown',
                node_title: nodeTitle(node),
                widget_index: widgetIndex,
                widget_name: widgetName,
                saved_value: savedValue,
                category,
                base_model: recipe?.params?.baseModel || null,
                identity,
            });
        }
    }
    return references;
}

export function shortHash(value) {
    if (typeof value !== 'string' || !value) return '';
    return value.length > 16 ? `${value.slice(0, 12)}...${value.slice(-4)}` : value;
}

export function recipeReferenceKey(reference) {
    return [
        reference?.node_id ?? '',
        reference?.widget_index ?? '',
        reference?.category ?? '',
        reference?.saved_value ?? '',
    ].join('\u001f');
}

export function formatIdentitySize(value) {
    const size = Number(value);
    if (!Number.isFinite(size) || size < 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function isModelReference(reference) {
    const val = String(reference?.saved_value || '').trim();
    return Boolean(val && val.toLowerCase() !== 'none' && MODEL_FILE_PATTERN.test(val));
}

