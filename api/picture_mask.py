"""What LoadImage gets from a picture in ComfyUI's input folder (or a run's preview in temp), for the
AI (get_image_info folder=input/temp): its size and, when it has an alpha, the area LoadImage gives as
MASK (1 - alpha), the part a repaint changes, said as a share and a box in percent of the picture."""

from PIL import Image


def input_facts(path):
    """Size of an input or preview picture and, when it has an alpha, the area LoadImage gives as MASK (1 - alpha)."""
    try:
        with Image.open(path) as picture:
            facts = {"width": picture.width, "height": picture.height}
            if "A" not in picture.getbands():
                facts["mask"] = "none: no alpha, so LoadImage's MASK is empty"
                return facts
            area = picture.getchannel("A").point(lambda value: 255 if value < 128 else 0)
    except (OSError, ValueError, Image.DecompressionBombError):
        return {"note": "The picture cannot be read."}
    box = area.getbbox()
    if not box:
        facts["mask"] = "none: fully opaque, so LoadImage's MASK is empty"
        return facts
    share = area.histogram()[255] / (facts["width"] * facts["height"])
    left, top, right, bottom = (round(100 * value / size) for value, size in zip(box, (facts["width"], facts["height"]) * 2))
    facts["mask"] = {"share": f"{round(100 * share, 1)}%", "area": f"x {left}-{right}%, y {top}-{bottom}% of the picture",
                     "meaning": "LoadImage gives this area as MASK: what to repaint"}
    return facts
