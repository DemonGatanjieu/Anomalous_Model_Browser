"""Read ComfyUI generation info embedded in saved audio (FLAC and Ogg/Opus comments).

ComfyUI's audio save/preview nodes store the API prompt as a `prompt` comment.
Only the fields the audio gallery shows are extracted; nothing is written.
"""

import json
import os

MAX_TAG_BYTES = 16 * 1024 * 1024
MAX_OGG_SCAN_BYTES = 32 * 1024 * 1024
SPEECH_INPUTS = ("speech", "text", "gen_text")
# "character": Anomalous_TTS (GPT-SoVITS) names the voice by character instead of a file.
SAMPLE_INPUTS = ("sample", "ref_audio", "audio_prompt", "character")


def _parse_vorbis_comment(data, offset=0):
    """Parse a Vorbis comment block into {lowercase key: value}."""
    tags = {}
    try:
        vendor_len = int.from_bytes(data[offset:offset + 4], "little")
        pos = offset + 4 + vendor_len
        count = int.from_bytes(data[pos:pos + 4], "little")
        pos += 4
        for _ in range(min(count, 1024)):
            length = int.from_bytes(data[pos:pos + 4], "little")
            pos += 4
            entry = data[pos:pos + length].decode("utf-8", "replace")
            pos += length
            key, sep, value = entry.partition("=")
            if sep:
                tags.setdefault(key.lower(), value)
    except (IndexError, ValueError):
        pass
    return tags


def _flac_tags(handle):
    if handle.read(4) != b"fLaC":
        return {}
    while True:
        header = handle.read(4)
        if len(header) < 4:
            return {}
        is_last = header[0] & 0x80
        block_type = header[0] & 0x7F
        length = int.from_bytes(header[1:4], "big")
        if block_type == 4:
            if length > MAX_TAG_BYTES:
                return {}
            return _parse_vorbis_comment(handle.read(length))
        handle.seek(length, os.SEEK_CUR)
        if is_last:
            return {}


def _ogg_packets(handle, wanted=2):
    """Yield the first `wanted` logical packets of an Ogg stream."""
    packet = b""
    scanned = 0
    found = 0
    while found < wanted and scanned < MAX_OGG_SCAN_BYTES:
        header = handle.read(27)
        if len(header) < 27 or header[:4] != b"OggS":
            return
        segments = header[26]
        lacing = handle.read(segments)
        scanned += 27 + segments
        for size in lacing:
            packet += handle.read(size)
            scanned += size
            if size < 255:
                yield packet
                packet = b""
                found += 1
                if found >= wanted:
                    return
        if len(packet) > MAX_TAG_BYTES:
            return


def _ogg_tags(handle):
    packets = list(_ogg_packets(handle, wanted=2))
    if len(packets) < 2:
        return {}
    comment = packets[1]
    if comment.startswith(b"OpusTags"):
        return _parse_vorbis_comment(comment, 8)
    if comment.startswith(b"\x03vorbis"):
        return _parse_vorbis_comment(comment, 7)
    return {}


def read_audio_tags(path):
    """Return {lowercase key: value} comments for FLAC/Ogg/Opus files, else {}."""
    ext = os.path.splitext(path)[1].lower()
    try:
        with open(path, "rb") as handle:
            if ext == ".flac":
                return _flac_tags(handle)
            if ext in (".ogg", ".opus"):
                return _ogg_tags(handle)
    except OSError:
        pass
    return {}


def generation_info(path):
    """Speech text, sample voice and seed of the TTS node that produced this file, if recorded."""
    raw = read_audio_tags(path).get("prompt")
    if not raw:
        return None
    try:
        prompt = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(prompt, dict):
        return None

    nodes = [node for node in prompt.values() if isinstance(node, dict) and isinstance(node.get("inputs"), dict)]
    # Prefer TTS nodes; otherwise any node with a speech-like text input.
    nodes.sort(key=lambda node: "tts" not in str(node.get("class_type", "")).lower())
    for node in nodes:
        inputs = node["inputs"]
        speech = next((inputs[key] for key in SPEECH_INPUTS if isinstance(inputs.get(key), str) and inputs[key].strip()), None)
        if speech is None:
            continue
        sample = next((inputs[key] for key in SAMPLE_INPUTS if isinstance(inputs.get(key), str)), None)
        seed = inputs.get("seed")
        return {
            "node_type": str(node.get("class_type") or ""),
            "speech": speech[:4000],
            "sample": sample.replace("\\", "/") if sample else None,
            "seed": seed if isinstance(seed, (int, float)) else None,
        }
    return None
