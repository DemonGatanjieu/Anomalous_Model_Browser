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
