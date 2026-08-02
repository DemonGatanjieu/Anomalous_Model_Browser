/** Pure helpers for recipe model references and provenance labels. */

const MODEL_FILE_PATTERN = /\.(?:safetensors|ckpt|pt|bin|sft)$/i;

function nodeType(node) {
    return String(node?.type || node?.class_type || '').trim();
}

function nodeTitle(node) {
    return String(node?._meta?.title || node?.title || nodeType(node) || 'Unknown node').trim();
}

function modelSpecs(type) {
    const lowered = type.toLowerCase();
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
        for (const [widgetIndex, category, widgetName] of modelSpecs(type)) {
            const savedValue = values[widgetIndex];
            if (typeof savedValue !== 'string' || !savedValue.trim()) continue;
            references.push({
                node_id: node?.id ?? null,
                node_type: type || 'Unknown',
                node_title: nodeTitle(node),
                widget_index: widgetIndex,
                widget_name: widgetName,
                saved_value: savedValue,
                category,
                base_model: recipe?.params?.baseModel || null,
                identity: { status: 'unverified' },
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
    return Boolean(reference?.saved_value && MODEL_FILE_PATTERN.test(reference.saved_value));
}
