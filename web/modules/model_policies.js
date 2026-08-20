const PHYSICAL_RENAME_PROTECTED_TYPES = new Set([
    'vae',
    'vae_approx',
    'clip',
    'text_encoders',
    'clip_vision',
]);

export function isPhysicalRenameProtectedType(folderType) {
    return PHYSICAL_RENAME_PROTECTED_TYPES.has(String(folderType || '').trim().toLowerCase());
}

export function inferModelFolderTypes(node, widget) {
    const widgetName = String(widget?.name || '').toLowerCase();
    const nodeType = String(node?.type || '').toLowerCase();
    const key = `${widgetName} ${nodeType}`;

    if (key.includes('clip_vision') || key.includes('clip vision') || nodeType.includes('clipvision')) return ['clip_vision'];
    if (key.includes('vae_approx') || key.includes('vae approx')) return ['vae_approx'];
    if (widgetName.includes('vae') || nodeType === 'vaeloader' || key.includes('vae loader')) return ['vae'];
    if (widgetName.includes('lora') || key.includes('lora')) return ['loras'];
    if (widgetName.includes('control_net') || widgetName.includes('controlnet') || key.includes('controlnet')) return ['controlnet'];
    if (widgetName.includes('ckpt') || widgetName.includes('checkpoint') || key.includes('checkpoint')) return ['checkpoints'];
    if (widgetName.includes('unet') || widgetName.includes('diffusion_model') || key.includes('unet loader')) return ['diffusion_models', 'unet'];
    if (widgetName.includes('clip_name') || widgetName.includes('text_encoder') || nodeType.includes('cliploader')) return ['clip', 'text_encoders'];
    return [];
}

export function requiresHashForModelRecovery(node, widget) {
    const types = inferModelFolderTypes(node, widget);
    return types.length > 0 && types.every(type => PHYSICAL_RENAME_PROTECTED_TYPES.has(type));
}
