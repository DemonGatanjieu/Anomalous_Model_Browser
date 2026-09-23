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

/**
 * All-in-one loaders with a verified serialized widget layout. Must stay in sync
 * with ALL_IN_ONE_LOADER_SPECS in api/recipe_schema.py. Arbitrary third-party
 * widgets stay parameters: guessing categories from file names mislabels models.
 */
export const ALL_IN_ONE_LOADER_SPECS = Object.freeze({
    // ComfyUI-Easy-Use: ckpt_name, vae_name, clip_skip, lora_name, ...
    'easy a1111loader': [[0, 'checkpoint', 'ckpt_name'], [1, 'vae', 'vae_name'], [3, 'lora', 'lora_name']],
    // ComfyUI-Easy-Use: ckpt_name, config_name, vae_name, clip_skip, lora_name, ...
    'easy fullloader': [[0, 'checkpoint', 'ckpt_name'], [2, 'vae', 'vae_name'], [4, 'lora', 'lora_name']],
    // efficiency-nodes-comfyui: ckpt_name, vae_name, clip_skip, lora_name, ...
    'efficient loader': [[0, 'checkpoint', 'ckpt_name'], [1, 'vae', 'vae_name'], [3, 'lora', 'lora_name']],
});

/** Loader values that mean "no file selected". */
const PLACEHOLDER_MODEL_VALUES = new Set(['none', 'baked vae']);

export function isAllInOneLoaderType(type) {
    return Object.prototype.hasOwnProperty.call(ALL_IN_ONE_LOADER_SPECS, String(type || '').trim().toLowerCase());
}

export function isPlaceholderModelValue(value) {
    return PLACEHOLDER_MODEL_VALUES.has(String(value ?? '').trim().toLowerCase());
}

/** [widgetIndex, category, widgetName] triples for known loader nodes (by type). */
export function deriveNodeModelSpecs(nodeOrType) {
    const type = typeof nodeOrType === 'string' ? nodeOrType : nodeType(nodeOrType);
    const lowered = type.trim().toLowerCase();
    if (isAllInOneLoaderType(lowered)) return ALL_IN_ONE_LOADER_SPECS[lowered].map((spec) => [...spec]);
    if (/checkpointloader(simple)?$/.test(lowered)) return [[0, 'checkpoint', 'checkpoint']];
    if (lowered.endsWith('unetloader')) return [[0, 'unet', 'unet']];
    if (/loraloader/.test(lowered)) return [[0, 'lora', 'lora']];
    if (lowered.endsWith('vaeloader')) return [[0, 'vae', 'vae']];
    if (lowered.endsWith('clipvisionloader')) return [[0, 'clip_vision', 'clip_vision']];
    if (lowered.endsWith('controlnetloader')) return [[0, 'controlnet', 'controlnet']];
    if (/(^|[^a-z])(?:dual|triple)?cliploader$/.test(lowered)) {
        const specs = [[0, 'text_encoder', 'clip']];
        if (lowered.includes('dualclip') || lowered.includes('tripleclip')) specs.push([1, 'text_encoder', 'clip']);
        if (lowered.includes('tripleclip')) specs.push([2, 'text_encoder', 'clip']);
        return specs;
    }
    return [];
}


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
            if (typeof savedValue !== 'string' || !savedValue.trim() || isPlaceholderModelValue(savedValue)) continue;
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
    return Boolean(val && !isPlaceholderModelValue(val) && MODEL_FILE_PATTERN.test(val));
}
