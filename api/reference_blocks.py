"""Ready-made blocks of nodes, distilled from workflows that do one thing well (a repaint that
crops around the marked area and stitches it back, face and hand detailing): a light model
names one (add_nodes block=…) and Anomalous builds it on the canvas, spliced into the
workflow there. A block is a group in ComfyUI's API form (mcp_canvas_edit.add_nodes) whose
links may name roles the page finds on the canvas by their sockets (web/modules/canvas_roles.js):
"$sampler" (the KSampler), "$decode" (the node decoding its latent), "$save" (the node taking
that picture); ["$decode", 0] is that node's output, ["$sampler.positive", "*"] what feeds that
input, a path ("$sampler.positive.clip") followed upstream. A node "like" a role takes its
settings of the same name; one that "replaces" a role takes its place, links and settings. The
directory (directory()) is the "reference" the AI is handed when it begins a task: one line a block,
the rest comes with the block.
"""

import re

# A redraw after enlarging: low enough to keep the picture, high enough for real detail (the source used 0.32),
# at the size the source used (its author: more than 1.5× goes wrong; 1.5× of 832×1216 is too much for a 6 GB card).
UPSCALE_DENOISE = 0.35
UPSCALE_BY = 1.25
INPAINT_IMAGE = "the picture with the area as its alpha (inpaint_image from propose_repaint_area or ask_user's answer)"
REFERENCE_IMAGE = "the picture to follow: one the user handed you (its path, as their message gives it) or one in the input folder"
# The words a ControlNet file's name has for what it follows; a union model follows all of them.
CONTROLS = {"pose": ("openpose", "pose"), "depth": ("depth",)}
ANY_CONTROL = ("union", "promax")
# The directory's headings, what an AI wants done; under each, its blocks with a few words apiece.
JOBS = {"repaint": "Repaint a marked area", "upscale": "Enlarge a picture", "follow": "Follow a picture the user gave",
        "detail": "Fix faces and hands"}

BLOCKS = {
    "inpaint_crop_stitch": {
        "job": "repaint", "short": "small fixes, the rest untouched",
        "packs": {"InpaintCropImproved": "ComfyUI-Inpaint-CropAndStitch", "InpaintStitchImproved": "ComfyUI-Inpaint-CropAndStitch"},
        "instead": "inpaint_basic",
        "takes": INPAINT_IMAGE,
        "nodes": {
            "picture": {"class_type": "LoadImage", "inputs": {"image": "$image"}},
            "soft": {"class_type": "DifferentialDiffusion", "inputs": {"model": ["$sampler.model", "*"]}, "wire_to": "$sampler"},
            "crop": {"class_type": "InpaintCropImproved", "inputs": {
                "image": ["picture", 0], "mask": ["picture", 1], "mask_blend_pixels": 32, "context_from_mask_extend_factor": 2.0,
                "output_resize_to_target_size": True, "output_target_width": 1024, "output_target_height": 1024,
                "downscale_algorithm": "lanczos", "upscale_algorithm": "lanczos"}},
            "condition": {"class_type": "InpaintModelConditioning", "inputs": {
                "vae": ["$decode.vae", "*"], "pixels": ["crop", "cropped_image"], "mask": ["crop", "cropped_mask"]},
                "wire_to": "$sampler"},
            "stitch": {"class_type": "InpaintStitchImproved", "inputs": {"stitcher": ["crop", "stitcher"], "inpainted_image": ["$decode", 0]},
                       "wire_to": "$save"},
        },
        "roles": {"sampler": {"denoise": 0.75}},  # at 1 a model not made for inpainting paints a whole new subject into the crop
        "after": "The sampler now repaints only the cropped area, at denoise 0.75 (lower keeps more of the old). Its "
                 "prompt is still the whole picture's: set_prompt it to what belongs in the area (\"a hand, five "
                 "fingers\"), or it paints the whole subject there. Then run_workflow; the saved picture is the whole "
                 "one, stitched.",
    },
    "inpaint_basic": {
        "job": "repaint", "short": "built-in nodes only",
        "packs": {},
        "takes": INPAINT_IMAGE,
        "nodes": {
            "picture": {"class_type": "LoadImage", "inputs": {"image": "$image"}},
            "soft": {"class_type": "DifferentialDiffusion", "inputs": {"model": ["$sampler.model", "*"]}, "wire_to": "$sampler"},
            "encode": {"class_type": "VAEEncode", "inputs": {"pixels": ["picture", 0], "vae": ["$decode.vae", "*"]}},
            "area": {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["encode", 0], "mask": ["picture", 1]},
                     "wire_to": "$sampler"},
        },
        "roles": {"sampler": {"denoise": 0.7}},
        "after": "The sampler repaints only the area, at denoise 0.7 so it keeps the picture's look (higher changes more). "
                 "Then run_workflow.",
    },
    "inpaint_lanpaint": {
        "job": "repaint", "short": "best blend, slow",
        "packs": {"LanPaint_KSampler": "LanPaint", "LanPaint_ImageEncode": "LanPaint", "LanPaint_ImageDecode": "LanPaint"},
        "instead": "inpaint_crop_stitch",
        "takes": INPAINT_IMAGE,
        "nodes": {
            "picture": {"class_type": "LoadImage", "inputs": {"image": "$image"}},
            "encode": {"class_type": "LanPaint_ImageEncode", "inputs": {"image": ["picture", 0], "vae": ["$decode.vae", "*"], "mask": ["picture", 1]}},
            "sampler": {"class_type": "LanPaint_KSampler", "replaces": "$sampler", "inputs": {"latent_image": ["encode", 0], "denoise": 1.0}},
            "decode": {"class_type": "LanPaint_ImageDecode", "replaces": "$decode", "inputs": {
                "samples": ["sampler", 0], "image": ["picture", 0], "mask": ["picture", 1]}},
        },
        "after": "The KSampler is now LanPaint's (same steps, cfg and seed) and repaints only the area, blending it "
                 "into the rest. Its prompt is still the whole picture's: set_prompt it to what belongs in the area "
                 "(\"a hand, five fingers\"). Then run_workflow; it takes several times longer than before.",
    },
    "upscale": {
        "job": "upscale", "short": "1.25×",
        "packs": {},
        "upscaler": True,
        "nodes": {
            "upscaler": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "$upscaler"}},  # enlarges, then fit brings it to UPSCALE_BY
            "enlarge": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["upscaler", 0], "image": ["$save.images", "*"]}},
            "fit": {"class_type": "ImageScaleBy", "inputs": {"image": ["enlarge", 0], "upscale_method": "lanczos", "scale_by": "$fit"}},
            "encode": {"class_type": "VAEEncode", "inputs": {"pixels": ["fit", 0], "vae": ["$decode.vae", "*"]}},
            "redraw": {"class_type": "KSampler", "like": "$sampler", "inputs": {
                "model": ["$sampler.model", "*"], "positive": ["$sampler.positive", "*"], "negative": ["$sampler.negative", "*"],
                "latent_image": ["encode", 0], "denoise": UPSCALE_DENOISE}},
            "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["redraw", 0], "vae": ["$decode.vae", "*"]}},
            "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": "upscaled"}},
        },
        "after": f"run_workflow saves the picture as before and the larger one beside it (prefix upscaled). The redraw "
                 f"sampler has the first one's steps and cfg at denoise {UPSCALE_DENOISE}: lower keeps more of the "
                 "picture, higher adds more (and above 0.5 may change it). For 2× or more use upscale_tiled.",
    },
    "upscale_tiled": {
        "job": "upscale", "short": "2×, in tiles",
        "packs": {"UltimateSDUpscale": "ComfyUI_UltimateSDUpscale"},
        "instead": "upscale",
        "upscaler": True,
        "nodes": {
            "upscaler": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "$upscaler"}},
            "tiles": {"class_type": "UltimateSDUpscale", "like": "$sampler", "inputs": {
                "image": ["$save.images", "*"], "model": ["$sampler.model", "*"], "positive": ["$sampler.positive", "*"],
                "negative": ["$sampler.negative", "*"], "vae": ["$decode.vae", "*"], "upscale_model": ["upscaler", 0],
                "upscale_by": 2.0, "denoise": 0.3, "tile_width": 1024, "tile_height": 1024}},
            "save": {"class_type": "SaveImage", "inputs": {"images": ["tiles", 0], "filename_prefix": "upscaled"}},
        },
        "after": "run_workflow saves the picture as before and the 2× one beside it (prefix upscaled); each tile is "
                 "redrawn with the sampler's steps and cfg at denoise 0.3 (higher adds more detail, and may add seams).",
    },
    "control_pose": {
        "job": "follow", "short": "its pose",
        "packs": {"OpenposePreprocessor": "comfyui_controlnet_aux"},
        "takes": REFERENCE_IMAGE,
        "control": "pose",
        "nodes": {
            "reference": {"class_type": "LoadImage", "inputs": {"image": "$image"}},
            "pose": {"class_type": "OpenposePreprocessor", "inputs": {
                "image": ["reference", 0], "detect_hand": "enable", "detect_body": "enable", "detect_face": "enable", "resolution": 1024}},
            "controlnet": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "$controlnet"}},
            "steer": {"class_type": "ControlNetApplyAdvanced", "inputs": {
                "positive": ["$sampler.positive", "*"], "negative": ["$sampler.negative", "*"], "control_net": ["controlnet", 0],
                "image": ["pose", 0], "vae": ["$decode.vae", "*"], "strength": 0.8, "start_percent": 0.0, "end_percent": 0.8},
                "wire_to": "$sampler"},
        },
        "after": "run_workflow: the picture now takes that pose (strength 0.8, for the first 80% of the steps; lower "
                 "either for a looser pose). The prompt still says who and what: change it if it fights the pose.",
    },
    "control_depth": {
        "job": "follow", "short": "its layout and shapes",
        "packs": {"DepthAnythingV2Preprocessor": "comfyui_controlnet_aux"},
        "takes": REFERENCE_IMAGE,
        "control": "depth",
        "nodes": {
            "reference": {"class_type": "LoadImage", "inputs": {"image": "$image"}},
            "depth": {"class_type": "DepthAnythingV2Preprocessor", "inputs": {
                "image": ["reference", 0], "ckpt_name": "depth_anything_v2_vitl.pth", "resolution": 1024}},
            "controlnet": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "$controlnet"}},
            "steer": {"class_type": "ControlNetApplyAdvanced", "inputs": {
                "positive": ["$sampler.positive", "*"], "negative": ["$sampler.negative", "*"], "control_net": ["controlnet", 0],
                "image": ["depth", 0], "vae": ["$decode.vae", "*"], "strength": 0.7, "start_percent": 0.0, "end_percent": 0.7},
                "wire_to": "$sampler"},
        },
        "after": "run_workflow: the picture now keeps that layout (strength 0.7, for the first 70% of the steps; lower "
                 "either to let the model change more). The prompt still says what is drawn.",
    },
    "detail_face_hands": {
        "job": "detail", "short": "after a picture is made",
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
    """{job: "block (a few words), …"} for the AI, short enough to stay in the chat; with ComfyUI's node
    list `info`, a block whose nodes are missing says what to install and what to use instead."""
    out = {heading: [] for heading in JOBS.values()}
    for name, block in BLOCKS.items():
        missing = sorted({pack for kind, pack in block["packs"].items() if info is not None and kind not in info})
        needs = f"; needs {', '.join(missing)}" + (f", use {block['instead']}" if block.get("instead") else "") if missing else ""
        out[JOBS[block["job"]]].append(f"{name} ({block['short']}{needs})")
    return {heading: ", ".join(names) for heading, names in out.items()}


def _choices(info, kind, name):
    """The files node `kind`'s drop-down `name` offers, in either form ComfyUI's node list gives it
    ([[choices], {...}] or ["COMBO", {"options": [choices]}])."""
    try:
        spec = info[kind]["input"]["required"][name]
        found = spec[0] if isinstance(spec[0], list) else spec[1].get("options", []) if spec[0] == "COMBO" else []
    except (KeyError, IndexError, TypeError, AttributeError):
        found = []
    return [item for item in found if isinstance(item, str)]


def _detector(info, prefix):
    """The detector model file for `prefix` this ComfyUI has, preferring the larger kinds (m over s over n)."""
    found = sorted((name for name in _choices(info, "UltralyticsDetectorProvider", "model_name") if prefix in name.lower()),
                   key=lambda name: ("m." not in name, "s." not in name, name))
    if not found:
        raise BlockError(f"No {prefix.split('_')[0]} detector model in models/ultralytics/bbox ({prefix}*.pt): "
                         "ask the user to get one (ComfyUI-Manager's model list has them).")
    return found[0]


def _upscaler(info):
    """The upscale model file this ComfyUI has, preferring a 4× one, and how many times it enlarges."""
    files = _choices(info, "UpscaleModelLoader", "model_name")
    if not files:
        raise BlockError("No upscale model in models/upscale_models: ask the user to get one (4x-UltraSharp, "
                         "ComfyUI-Manager's model list has it).")
    times = {name: int(found.group(1) or found.group(2)) for name in files
             if (found := re.search(r"(?<![0-9])([1-8])x|x([1-8])(?![0-9])", name.lower()))}
    name = sorted(files, key=lambda item: (times.get(item) != 4, item.lower()))[0]
    return name, times.get(name, 4)


def _controlnet(info, kind, main, base_of):
    """The ControlNet file for `kind` (CONTROLS) whose base model (`base_of(name)`) is of the family of
    `main`, the canvas's model's: one for that kind before a union one, one of that very base first.
    LLLite files need their own loader."""
    from .model_advice import family

    wanted = family(main)
    files = [name for name in _choices(info, "ControlNetLoader", "control_net_name") if "lllite" not in name.lower()]
    own = [name for name in files if any(word in name.lower() for word in CONTROLS[kind])]
    union = [name for name in files if any(word in name.lower() for word in ANY_CONTROL) and name not in own]
    fitting = [name for name in own + union if not wanted or family(base_of(name)) == wanted]
    if not fitting:
        raise BlockError(f"No {kind} ControlNet{f' for {wanted} models' if wanted else ''} in models/controlnet: ask the "
                         "user to get one (Anomalous can download one they pick on Civitai).")
    return min(fitting, key=lambda name: (name in union, base_of(name).lower() != str(main).lower()))


def nodes_of(name, info, image=None, main_base=lambda: "", base_of=lambda name: ""):
    """Block `name` as add_nodes' group, its values filled in, or BlockError saying why not. A control
    block asks `main_base()` for the canvas's model's base model and `base_of` for each ControlNet's."""
    block = BLOCKS.get(name)
    if not block:
        raise BlockError(f"No block {name!r}; there are: {', '.join(BLOCKS)}.")
    missing = sorted({pack for kind, pack in block["packs"].items() if kind not in info})
    if missing:
        instead = f" Use block {block['instead']} instead, or ask the user to install it with ComfyUI-Manager." if block.get("instead") else \
            " Ask the user to install it with ComfyUI-Manager."
        raise BlockError(f"Block {name} needs {', '.join(missing)}, not installed here.{instead}")
    if block.get("takes") and not (isinstance(image, str) and image.strip()):
        raise BlockError(f"Block {name} needs image: {block['takes']}.")
    fills = {"$image": (image or "").strip()}
    for role, prefix in (block.get("detectors") or {}).items():
        fills[f"${role}"] = _detector(info, prefix)
    if block.get("upscaler"):
        fills["$upscaler"], times = _upscaler(info)
        fills["$fit"] = round(UPSCALE_BY / times, 4)  # the model's 4× brought back to UPSCALE_BY
    if block.get("control"):
        fills["$controlnet"] = _controlnet(info, block["control"], main_base(), base_of)
    return {key: {**spec, "inputs": {input: fills.get(value, value) if isinstance(value, str) else value
                                     for input, value in spec["inputs"].items()}} for key, spec in block["nodes"].items()}


def roles_of(name):
    """The settings block `name` changes on canvas nodes it finds ({role: {setting: value}}), as the page applies them."""
    return BLOCKS[name].get("roles") or {}


def after(name):
    return BLOCKS[name]["after"]
