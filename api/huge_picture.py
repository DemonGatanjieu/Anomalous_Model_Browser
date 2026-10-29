"""Run by media_routes.py as a child process: a smaller WebP of a picture too large to decode
inside ComfyUI (past Pillow's pixel limit), so the memory it takes goes back when it ends.
Arguments: the picture, the WebP to write, the longest edge, the most pixels it may decode."""

import sys

from PIL import Image, ImageOps


def shrink(source, target, edge, most_pixels):
    Image.MAX_IMAGE_PIXELS = most_pixels
    with Image.open(source) as image:
        image.thumbnail((edge, edge), Image.Resampling.LANCZOS)  # a JPEG decodes at a fraction; others whole, once
        image = ImageOps.exif_transpose(image)  # on the small one: turning the whole picture would copy it
        if image.mode not in ('RGB', 'RGBA'):
            image = image.convert('RGBA' if 'transparency' in image.info else 'RGB')
        image.save(target, format='WEBP', quality=84, method=4)


if __name__ == '__main__':
    shrink(sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]))
