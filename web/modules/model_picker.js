const MODEL_FILE_PATTERN = /\.(safetensors|ckpt|pt|bin|pth|sft)$/i;

export function inferPickerModelType(node, widget, options = {}) {
    const widgetName = String(widget?.name || '').toLowerCase();
    const nodeType = String(node?.type || '').toLowerCase();
    const explicitLabel = String(options.modelTypeLabel || '');
    const key = `${widgetName} ${nodeType} ${explicitLabel.toLowerCase()}`;
    if (widgetName.includes('vae') || nodeType === 'vaeloader' || key.includes('vae loader')) {
        return { label: 'VAE', folderTypes: ['vae'], isLora: false };
    }
    if (widgetName.includes('lora') || key.includes('lora')) {
        return { label: 'LoRA', folderTypes: ['loras'], isLora: true };
    }
    if (widgetName.includes('control_net') || widgetName.includes('controlnet') || key.includes('controlnet')) {
        return { label: 'ControlNet', folderTypes: ['controlnet'], isLora: false };
    }
    if (widgetName.includes('ckpt') || widgetName.includes('checkpoint') || key.includes('checkpoint')) {
        return { label: 'Checkpoint', folderTypes: ['checkpoints'], isLora: false };
    }
    if (widgetName.includes('unet') || widgetName.includes('diffusion_model') || key.includes('unet loader')) {
        return { label: 'UNET', folderTypes: ['diffusion_models', 'unet'], isLora: false };
    }
    return {
        label: explicitLabel || node?.type || widget?.name || 'Model',
        folderTypes: [],
        isLora: false,
    };
}

export function getBaseModelFamily(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!normalized) return '';
    if (normalized.includes('illustrious')) return 'illustrious';
    if (normalized.includes('pony')) return 'pony';
    if (normalized.includes('flux')) return 'flux';
    if (normalized.includes('sdxl') || normalized.includes('stablediffusionxl')) return 'sdxl';
    if (normalized.includes('sd35') || normalized.includes('stablediffusion35')) return 'sd35';
    if (normalized.includes('sd3') || normalized.includes('stablediffusion3')) return 'sd3';
    if (normalized.includes('sd21') || normalized.includes('stablediffusion21')) return 'sd21';
    if (normalized.includes('sd15') || normalized.includes('stablediffusion15')) return 'sd15';
    return normalized;
}

function getGraphNodeById(graph, nodeId) {
    return graph?.getNodeById?.(nodeId)
        || graph?._nodes_by_id?.[nodeId]
        || graph?._nodes?.find?.(candidate => candidate?.id === nodeId)
        || null;
}

export function collectMainModelContextRequests(graph, startNode) {
    if (!graph || !startNode) return [];
    const queue = [startNode];
    const visited = new Set();
    let depth = 0;
    while (queue.length && depth < 12) {
        const levelSize = queue.length;
        const found = [];
        for (let index = 0; index < levelSize; index += 1) {
            const current = queue.shift();
            if (!current || visited.has(current.id)) continue;
            visited.add(current.id);
            for (const widget of current.widgets || []) {
                if (typeof widget?.value !== 'string' || !MODEL_FILE_PATTERN.test(widget.value)) continue;
                const inferred = inferPickerModelType(current, widget);
                if (!inferred.isLora) {
                    const request = { path: widget.value };
                    if (inferred.folderTypes.length) request.folder_types = inferred.folderTypes;
                    found.push(request);
                }
            }
            for (const input of current.inputs || []) {
                if (!['MODEL', 'CLIP'].includes(input?.type) || input.link == null) continue;
                const link = graph.links?.[input.link] || graph._links?.[input.link];
                const origin = getGraphNodeById(graph, link?.origin_id);
                if (origin && !visited.has(origin.id)) queue.push(origin);
            }
        }
        if (found.length) {
            const seen = new Set();
            return found.filter(item => {
                const key = `${(item.folder_types || []).join(',')}|${item.path}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }
        depth += 1;
    }
    return [];
}

export function formatModelTypeLabel(type, fallback = 'Model') {
    const labels = {
        loras: 'LoRA',
        checkpoints: 'Checkpoint',
        diffusion_models: 'UNET',
        unet: 'UNET',
        controlnet: 'ControlNet',
        vae: 'VAE',
    };
    return labels[String(type || '').toLowerCase()] || fallback;
}
