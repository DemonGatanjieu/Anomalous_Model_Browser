"""What a LoRA file trains, read from its safetensors header: whether it also has text-encoder
weights, so inserting it wires the CLIP line too (graph_splice.js planLoraInsertion).

GET /anomalous/lora_info?name=<the loader's lora_name> -> {text_encoder}.
"""

import asyncio
import json
import struct

from aiohttp import web
import folder_paths

# Key prefixes of text-encoder weights: kohya lora_te / lora_te1 / lora_te2, te1 / te2, diffusers text_encoder.
TEXT_ENCODER_KEYS = ("lora_te", "te_", "te1", "te2", "text_encoder")
MAX_HEADER_BYTES = 100 * 1024 * 1024


def trains_text_encoder(path):
    """Whether the LoRA at `path` has text-encoder weights. Other formats, or a header that
    cannot be read, count as yes: the CLIP line then goes through it, which costs nothing."""
    if not str(path).lower().endswith(".safetensors"):
        return True
    try:
        with open(path, "rb") as source:
            size = struct.unpack("<Q", source.read(8))[0]
            if size > MAX_HEADER_BYTES:
                return True
            keys = json.loads(source.read(size))
    except (OSError, ValueError, struct.error):
        return True
    return any(key.startswith(TEXT_ENCODER_KEYS) for key in keys if key != "__metadata__")


async def api_lora_info(request):
    name = request.query.get("name", "")
    path = folder_paths.get_full_path("loras", name) if name else None  # only names ComfyUI lists
    if not path:
        return web.json_response({"error": "Unknown LoRA"}, status=404)
    return web.json_response({"text_encoder": await asyncio.to_thread(trains_text_encoder, path)})
