"""Shared model catalog, media, and recovery constants."""

MEDIA_EXTENSIONS = ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi')
# Model files the browser lists, counts and looks up: GGUF and .pth too (quantized
# diffusion models, upscalers). Compared without case: see is_model_file().
MODEL_EXTENSIONS = ('.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.sft', '.gguf')
PREVIEW_SUFFIXES = tuple(f'.preview{ext}' for ext in MEDIA_EXTENSIONS)
CIVITAI_BACKUP_SUFFIXES = tuple(f'.civitai_bak{ext}' for ext in MEDIA_EXTENSIONS)
SIDECAR_SUFFIXES = (
    '.info', '.civitai.info', '.anomalous.json', '.json', '.txt', '.yaml',
    *MEDIA_EXTENSIONS,
    *PREVIEW_SUFFIXES,
    *CIVITAI_BACKUP_SUFFIXES,
)
RESOLVABLE_MODEL_TYPES = (
    'checkpoints', 'loras', 'unet', 'diffusion_models', 'controlnet',
    'vae', 'vae_approx', 'clip', 'text_encoders', 'clip_vision',
)


def is_model_file(name):
    """Whether a file name is a model file (MODEL_EXTENSIONS, any case)."""
    return name.lower().endswith(MODEL_EXTENSIONS)
