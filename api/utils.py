"""Compatibility exports for focused backend utility modules."""

import os

from . import gallery_routes as _gallery
from .folder_types import *
from .media_routes import *
from .path_utils import *
from .translation_routes import *


_gallery_snapshot = _gallery._gallery_snapshot
_gallery_collect_impl = _gallery._collect_gallery_images
_gallery_images_impl = _gallery._gallery_images


def _collect_gallery_images(output_dir):
    return _gallery_collect_impl(output_dir)


def _gallery_images(output_dir, refresh=False):
    _gallery._collect_gallery_images = _collect_gallery_images
    return _gallery_images_impl(output_dir, refresh)


def _invalidate_gallery_snapshot():
    return _gallery._invalidate_gallery_snapshot()


api_get_gallery_images = _gallery.api_get_gallery_images
api_delete_gallery_image = _gallery.api_delete_gallery_image
