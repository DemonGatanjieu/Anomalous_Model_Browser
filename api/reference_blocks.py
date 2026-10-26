"""Ready-made blocks of nodes, distilled from workflows that do one thing well (a repaint that
crops around the marked area and stitches it back, face and hand detailing): a light model
names one (add_nodes block=…) and Anomalous builds it on the canvas, spliced into the
workflow there. A block is a group in ComfyUI's API form (mcp_canvas_edit.add_nodes) whose
links may name roles the page finds on the canvas by their sockets (web/modules/canvas_roles.js):
"$sampler" (the KSampler), "$decode" (the node decoding its latent), "$save" (the node taking
that picture); ["$decode", 0] is that node's output, ["$sampler.positive", "*"] what feeds that
input, a path ("$sampler.positive.clip") followed upstream. The directory (directory()) is the
"reference" the AI is handed when it begins a task: one line a block, the rest comes with the block.
"""

BLOCKS = {
    "inpaint_crop_stitch": {
        "for": "Repaint a marked area (inpaint_image) of a picture: crops around it, repaints it at 1024 and stitches "
               "it back, the rest untouched. Best for faces, hands, small fixes.",
        "packs": {"InpaintCropImproved": "ComfyUI-Inpaint-CropAndStitch", "InpaintStitchImproved": "ComfyUI-Inpaint-CropAndStitch"},
        "instead": "inpaint_basic",
        "takes": "image",
        "nodes": {
            "picture": {"class_type": "LoadImage", "inputs": {"image": "$image"}},
            "soft": {"class_type": "DifferentialDiffusion", "inputs": {"model": ["$sampler.model", "*"]}, "wire_to": "$sampler"},
            "crop": {"class_type": "InpaintCropImproved", "inputs": {
                "image": ["picture", 0], "mask": ["picture", 1], "mask_blend_pixels": 32, "context_from_mask_extend_factor": 1.2,
                "output_resize_to_target_size": True, "output_target_width": 1024, "output_target_height": 1024,
                "downscale_algorithm": "lanczos", "upscale_algorithm": "lanczos"}},
            "condition": {"class_type": "InpaintModelConditioning", "inputs": {
                "vae": ["$decode.vae", "*"], "pixels": ["crop", "cropped_image"], "mask": ["crop", "cropped_mask"]},
                "wire_to": "$sampler"},
            "stitch": {"class_type": "InpaintStitchImproved", "inputs": {"stitcher": ["crop", "stitcher"], "inpainted_image": ["$decode", 0]},
                       "wire_to": "$save"},
        },
        "after": "The sampler now repaints the cropped area (its steps, cfg and sampler stay; denoise 1 repaints it "
                 "fully, 0.6–0.8 keeps more of the old). run_workflow; the saved picture is the whole one, stitched.",
    },
    "inpaint_basic": {
        "for": "Repaint a marked area (inpaint_image) with ComfyUI's own nodes only: the whole picture is sampled, "
               "only the area changes.",
        "packs": {},
        "takes": "image",
        "nodes": {
            "picture": {"class_type": "LoadImage", "inputs": {"image": "$image"}},
            "soft": {"class_type": "DifferentialDiffusion", "inputs": {"model": ["$sampler.model", "*"]}, "wire_to": "$sampler"},
            "encode": {"class_type": "VAEEncode", "inputs": {"pixels": ["picture", 0], "vae": ["$decode.vae", "*"]}},
            "area": {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["encode", 0], "mask": ["picture", 1]},
                     "wire_to": "$sampler"},
        },
        "after": "Set the sampler's denoise to 0.6–0.8 (set_values) so the area keeps the picture's look, then run_workflow.",
    },
    "detail_face_hands": {
        "for": "Fix faces and hands after a picture is made: finds each one, repaints it larger and puts it back "
               "(FaceDetailer). For a picture made on this canvas.",
        "packs": {"FaceDetailer": "ComfyUI-Impact-Pack", "UltralyticsDetectorProvider": "ComfyUI-Impact-Subpack"},
        "detectors": {"face": "face_yolov8", "hand": "hand_yolov8"},
        "nodes": {
            "face_finder": {"class_type": "UltralyticsDetectorProvider", "inputs": {"model_name": "$face"}},
            "hand_finder": {"class_type": "UltralyticsDetectorProvider", "inputs": {"model_name": "$hand"}},
            "face": {"class_type": "FaceDetailer", "inputs": {
                "image": ["$decode", 0], "model": ["$sampler.model", "*"], "clip": ["$sampler.positive.clip", "*"],
                "vae": ["$decode.vae", "*"], "positive": ["$sampler.positive", "*"], "negative": ["$sampler.negative", "*"],
                "bbox_detector": ["face_finder", 0], "denoise": 0.4, "guide_size": 512}},
            "hands": {"class_type": "FaceDetailer", "inputs": {
                "image": ["face", "image"], "model": ["$sampler.model", "*"], "clip": ["$sampler.positive.clip", "*"],
                "vae": ["$decode.vae", "*"], "positive": ["$sampler.positive", "*"], "negative": ["$sampler.negative", "*"],
                "bbox_detector": ["hand_finder", 0], "denoise": 0.45, "guide_size": 512}},
            "save": {"class_type": "SaveImage", "inputs": {"images": ["hands", "image"], "filename_prefix": "detailed"}},
        },
        "after": "run_workflow saves the picture as before and the detailed one beside it (prefix detailed).",
    },
}


class BlockError(ValueError):
    pass


def directory(info=None):
    """{block: what it is for} for the AI; with ComfyUI's node list `info`, a block whose nodes are missing says what to install."""
    out = {}
    for name, block in BLOCKS.items():
        missing = sorted({pack for kind, pack in block["packs"].items() if info is not None and kind not in info})
        out[name] = block["for"] + (f" Needs {', '.join(missing)} (not installed: use {block['instead']})."
                                    if missing and block.get("instead") else f" Needs {', '.join(missing)} (not installed)." if missing else "")
    return out


def _detector(info, prefix):
    """The detector model file for `prefix` this ComfyUI has, preferring the larger kinds (m over s over n)."""
    try:
        files = info["UltralyticsDetectorProvider"]["input"]["required"]["model_name"][0]
    except (KeyError, IndexError, TypeError):
        files = []
    found = sorted((name for name in files if isinstance(name, str) and prefix in name.lower()),
                   key=lambda name: ("m." not in name, "s." not in name, name))
    if not found:
        raise BlockError(f"No {prefix.split('_')[0]} detector model in models/ultralytics/bbox ({prefix}*.pt): "
                         "ask the user to get one (ComfyUI-Manager's model list has them).")
    return found[0]


def nodes_of(name, info, image=None):
    """Block `name` as add_nodes' group, its values filled in, or BlockError saying why not."""
    block = BLOCKS.get(name)
    if not block:
        raise BlockError(f"No block {name!r}; there are: {', '.join(BLOCKS)}.")
    missing = sorted({pack for kind, pack in block["packs"].items() if kind not in info})
    if missing:
        instead = f" Use block {block['instead']} instead, or ask the user to install it with ComfyUI-Manager." if block.get("instead") else \
            " Ask the user to install it with ComfyUI-Manager."
        raise BlockError(f"Block {name} needs {', '.join(missing)}, not installed here.{instead}")
    if block.get("takes") == "image" and not (isinstance(image, str) and image.strip()):
        raise BlockError(f"Block {name} needs image: the picture with the area as its alpha (inpaint_image from "
                         "propose_repaint_area or ask_user's answer).")
    fills = {"$image": (image or "").strip()}
    for role, prefix in (block.get("detectors") or {}).items():
        fills[f"${role}"] = _detector(info, prefix)
    return {key: {**spec, "inputs": {input: fills.get(value, value) if isinstance(value, str) else value
                                     for input, value in spec["inputs"].items()}} for key, spec in block["nodes"].items()}


def after(name):
    return BLOCKS[name]["after"]
