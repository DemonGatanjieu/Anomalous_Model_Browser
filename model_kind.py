"""What a model file is, from its header alone: which models folder it belongs in (LoRA,
checkpoint, VAE…) and its base model. Reads a .safetensors header (JSON) or a .gguf header
(key/value metadata and tensor names); never loads tensors and never opens formats that can
carry code (.ckpt/.pt/.pth/.bin). Shared by model import (api/model_import.py) and the
scanner's offline base model (model_identity.infer_base_model_from_header). No imports from
ComfyUI, so it is tested on its own.

`classify(fmt, header)` -> {"kind": a ComfyUI folder name or "", "base": base model or "",
"sure": True when the header names both outright, False when it is a reasoned guess}.
"""

import json
import struct

MAX_HEADER = 100 * 1024 * 1024
GGUF_READ = 16 * 1024 * 1024

# Cross-attention width (the text encoder's output) -> base model, for the SD family.
CONTEXT_WIDTH = {768: "SD 1.5", 1024: "SD 2.1", 2048: "SDXL"}
# ComfyUI-GGUF's architecture names.
GGUF_DIFFUSION = {
    "flux": "Flux.1 D", "sd1": "SD 1.5", "sdxl": "SDXL", "sd3": "SD3", "aura": "AuraFlow",
    "hidream": "HiDream", "cosmos": "Cosmos", "ltxv": "LTXV", "hyvid": "Hunyuan Video",
    "wan": "Wan Video", "lumina2": "Lumina", "qwen_image": "Qwen", "chroma": "Chroma",
}
GGUF_TEXT = ("t5", "t5encoder", "umt5", "llama", "qwen2", "qwen2vl", "qwen3", "gemma", "clip", "mistral")
EMBEDDING_KEYS = {"emb_params", "clip_l", "clip_g", "string_to_param", "string_to_token", "name", "step",
                  "sd_checkpoint", "sd_checkpoint_name"}
LORA_MARKS = ("lora_up.", "lora_down.", "lora_a.", "lora_b.", "lora.up.", "lora.down.", "hada_w1_a",
              "lokr_w1", ".lora_linear_layer.", "dora_scale")
CONTROL_MARKS = ("control_model_", "input_hint_block", "controlnet_cond_embedding", "controlnet_blocks",
                 "controlnet_x_embedder", "zero_convs", "controlnet_mid_block")
DIFFUSION_STARTS = ("double_blocks.", "single_blocks.", "joint_blocks.", "transformer_blocks.",
                    "single_transformer_blocks.", "input_blocks.", "blocks.0.self_attn")


def parse_safetensors(data):
    """The header dict from a file's first bytes (8-byte length + JSON); None if not one."""
    if len(data) < 8:
        return None
    size = struct.unpack("<Q", data[:8])[0]
    if not 2 <= size <= MAX_HEADER or len(data) < 8 + size:
        return None
    try:
        header = json.loads(data[8:8 + size].decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    return header if isinstance(header, dict) else None


class _Reader:
    def __init__(self, data):
        self.data, self.at = data, 0

    def take(self, count):
        if self.at + count > len(self.data):
            raise EOFError
        part = self.data[self.at:self.at + count]
        self.at += count
        return part

    def number(self, fmt):
        return struct.unpack("<" + fmt, self.take(struct.calcsize(fmt)))[0]

    def text(self):
        return self.take(self.number("Q")).decode("utf-8", "replace")


_GGUF_SCALARS = {0: "B", 1: "b", 2: "H", 3: "h", 4: "I", 5: "i", 6: "f", 7: "?", 10: "Q", 11: "q", 12: "d"}


def _gguf_value(reader, kind):
    if kind in _GGUF_SCALARS:
        return reader.number(_GGUF_SCALARS[kind])
    if kind == 8:
        return reader.text()
    if kind == 9:  # an array: skipped (tokenizer word lists are long)
        item, count = reader.number("I"), reader.number("Q")
        for _ in range(count):
            _gguf_value(reader, item)
        return None
    raise ValueError("unknown gguf value type")


def parse_gguf(data):
    """{"meta": general.* values, "keys": tensor names} from a .gguf's first bytes; None if
    not one. What did not fit in `data` is left out."""
    if data[:4] != b"GGUF":
        return None
    reader = _Reader(data)
    reader.take(4)
    meta, keys = {}, []
    try:
        if reader.number("I") < 2:
            return None
        tensors, values = reader.number("Q"), reader.number("Q")
        for _ in range(values):
            key = reader.text()
            value = _gguf_value(reader, reader.number("I"))
            if key.startswith("general.") and isinstance(value, (str, int, float)):
                meta[key] = value
        for _ in range(tensors):
            keys.append(reader.text())
            dims = reader.number("I")
            reader.take(8 * dims + 4 + 8)
    except (EOFError, ValueError, struct.error):
        pass
    return {"meta": meta, "keys": keys}


def read_head(path):
    """(fmt, header) of a model file: ("safetensors", dict), ("gguf", dict), or (None, None)
    for other formats and unreadable files."""
    lower = path.lower()
    try:
        with open(path, "rb") as source:
            if lower.endswith((".safetensors", ".sft")):
                start = source.read(8)
                if len(start) < 8:
                    return None, None
                size = struct.unpack("<Q", start)[0]
                if size > MAX_HEADER:
                    return None, None
                return "safetensors", parse_safetensors(start + source.read(size))
            if lower.endswith(".gguf"):
                return "gguf", parse_gguf(source.read(GGUF_READ))
    except OSError:
        pass
    return None, None


def _context_width(header):
    """The cross-attention input width a SD-family file shows (768 / 1024 / 2048), else 0."""
    for key, value in header.items():
        low = key.lower().replace(".", "_")
        if "attn2_to_k" not in low or not isinstance(value, dict):
            continue
        shape = value.get("shape") or []
        if len(shape) == 2 and ("lora_down" in low or "lora_a" in low or low.endswith("to_k_weight")):
            return shape[1]
    return 0


def _family(meta):
    """An SDXL file's family from the name of the model it was trained on (kohya's metadata)."""
    trained_on = " ".join(str(meta.get(key, "")) for key in ("ss_sd_model_name", "ss_base_model", "modelspec.title")).lower()
    for mark, name in (("pony", "Pony"), ("illustrious", "Illustrious"), ("noob", "NoobAI")):
        if mark in trained_on:
            return name
    return ""


def _base_from_meta(meta):
    arch = str(meta.get("modelspec.architecture", "")).lower()
    trained = str(meta.get("ss_base_model_version", "")).lower()
    pairs = (("flux", "Flux.1 D"), ("chroma", "Chroma"), ("stable-diffusion-xl", "SDXL"), ("sdxl", "SDXL"),
             ("stable-diffusion-v1", "SD 1.5"), ("sd_v1", "SD 1.5"), ("stable-diffusion-v2", "SD 2.1"),
             ("sd_v2", "SD 2.1"), ("stable-diffusion-3", "SD3"), ("sd3", "SD3"), ("wan", "Wan Video"),
             ("qwen", "Qwen"), ("hunyuan", "Hunyuan Video"))
    for mark, name in pairs:
        if (arch and mark in arch) or (trained and trained.startswith(mark)):
            return name
    return ""


def _base_from_keys(header, text):
    """(base, sure) from tensor names; ("", False) when they do not tell."""
    if "individual_token_refiner" in text:
        return "Hunyuan Video", True
    if "distilled_guidance_layer" in text:
        return "Chroma", True
    if "img_mod_1" in text or "txt_norm" in text or "img_mlp_net" in text:
        return "Qwen", True
    if "double_blocks_0_img_attn" in text or "single_blocks_0_linear1" in text:
        return "Flux.1 D", True
    if "single_transformer_blocks_0_attn" in text or ("single_transformer_blocks" in text and "x_embedder" in text):
        return "Flux.1 D", False
    if "joint_blocks_0_x_block" in text:
        return "SD3", True
    if "blocks_0_self_attn_q" in text and "blocks_0_cross_attn_k" in text:
        return "Wan Video", True
    if any(mark in text for mark in ("conditioner_embedders_1", "label_emb_0_0", "lora_te1_", "lora_te2_",
                                     "lora_unet_input_blocks", "lora_unet_output_blocks")):
        return "SDXL", True
    width = _context_width(header)
    if width in CONTEXT_WIDTH:
        return CONTEXT_WIDTH[width], True
    if "cond_stage_model_transformer_text_model" in text:
        return "SD 1.5", True
    if "input_blocks_1_1_transformer_blocks" in text or "lora_unet_down_blocks" in text:
        return "SD 1.5", False
    return "", False


def _embedding_base(header):
    if "clip_g" in header:
        return "SDXL"
    shape = (header.get("emb_params") or {}).get("shape") or []
    return CONTEXT_WIDTH.get(shape[-1], "") if shape else ""


def _kind(keys, raw, text):
    """The models folder from tensor names: (kind, sure)."""
    names = set(keys)
    if names and names <= EMBEDDING_KEYS and names & {"emb_params", "clip_l", "clip_g", "string_to_param"}:
        return "embeddings", True
    if any(mark in text for mark in CONTROL_MARKS):
        return "controlnet", True
    if any(mark in raw for mark in LORA_MARKS):
        return "loras", True
    diffusion = any(key.startswith(("model.diffusion_model.", "diffusion_model.") + DIFFUSION_STARTS) for key in keys)
    if diffusion and any(key.startswith(("first_stage_model.", "vae.")) for key in keys):
        return "checkpoints", True
    if diffusion:
        return "diffusion_models", True
    if any(key.startswith(("image_proj.", "ip_adapter.")) for key in keys):
        return "ipadapter", True
    if any(mark in text for mark in ("encoder_down_0_block", "decoder_up_0_block", "encoder_down_blocks_0",
                                     "encoder_downsamples", "first_stage_model_encoder")):
        return "vae", True
    if "vision_model_encoder_layers" in text and "text_model" not in text:
        return "clip_vision", True
    if "text_model_encoder_layers" in text or "encoder_block_0_layer_0_selfattention" in text \
            or ("model_layers_0_self_attn" in text and "embed_tokens" in text):
        return "text_encoders", True
    if "conv_first_weight" in text or "body_0_rdb1" in text or ("model_0_weight" in text and "model_1_sub" in text):
        return "upscale_models", False
    return "", False


def classify(fmt, header):
    """What a parsed header says: {"kind", "base", "sure"} (see the module text)."""
    if not header:
        return {"kind": "", "base": "", "sure": False}
    if fmt == "gguf":
        meta, keys = header.get("meta") or {}, header.get("keys") or []
        arch = str(meta.get("general.architecture", "")).lower()
        if arch in GGUF_DIFFUSION:
            return {"kind": "diffusion_models", "base": GGUF_DIFFUSION[arch], "sure": True}
        if arch.startswith(GGUF_TEXT):
            return {"kind": "text_encoders", "base": "", "sure": True}
        header = {key: {} for key in keys}
    meta = header.get("__metadata__") if isinstance(header.get("__metadata__"), dict) else {}
    keys = [key for key in header if key != "__metadata__"]
    raw = "\n".join(keys).lower()
    text = raw.replace(".", "_")
    kind, sure = _kind(keys, raw, text)
    if kind in ("vae", "text_encoders", "clip_vision", "upscale_models", "ipadapter"):
        base, base_sure = "", True  # shared by several base models: the type's own folder
    elif kind == "embeddings":
        base, base_sure = _embedding_base(header), True
    else:
        base = _base_from_meta(meta)
        base_sure = bool(base)
        if not base:
            base, base_sure = _base_from_keys(header, text)
    if base == "SDXL":
        base = _family(meta) or base
    return {"kind": kind, "base": base, "sure": bool(kind) and sure and (base_sure or not base)}


def inspect_file(path):
    """classify() of a file on disk, plus its "format" (None when its header cannot be read)."""
    fmt, header = read_head(path)
    found = classify(fmt, header)
    found["format"] = fmt
    return found
