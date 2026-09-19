"""Shared model catalog, media, and recovery constants."""

MEDIA_EXTENSIONS = ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi')
MODEL_EXTENSIONS = ('.safetensors', '.ckpt', '.pt', '.bin')
PREVIEW_SUFFIXES = tuple(f'.preview{ext}' for ext in MEDIA_EXTENSIONS)
CIVITAI_BACKUP_SUFFIXES = tuple(f'.civitai_bak{ext}' for ext in MEDIA_EXTENSIONS)
SIDECAR_SUFFIXES = (
    '.info', '.civitai.info', '.json', '.txt', '.yaml',
    *MEDIA_EXTENSIONS,
    *PREVIEW_SUFFIXES,
    *CIVITAI_BACKUP_SUFFIXES,
)
RESOLVABLE_MODEL_TYPES = (
    'checkpoints', 'loras', 'unet', 'diffusion_models', 'controlnet',
    'vae', 'vae_approx', 'clip', 'text_encoders', 'clip_vision',
)
