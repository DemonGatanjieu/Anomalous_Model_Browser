"""Card images: kept in the user folder, posters for video covers, background warm-up."""

import asyncio
import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from PIL import Image  # noqa: E402

from api import media_routes  # noqa: E402


def write_video(path, frames=3):
    import av
    with av.open(path, mode='w') as container:
        stream = container.add_stream('mpeg4', rate=10)
        stream.width, stream.height, stream.pix_fmt = 640, 360, 'yuv420p'
        for index in range(frames):
            image = Image.new('RGB', (640, 360), (200, 40 * index, 30))
            frame = av.VideoFrame.from_image(image)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


class CardImageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.user = os.path.join(self.root, 'user')
        patcher = mock.patch.object(media_routes.folder_paths, 'get_user_directory', return_value=self.user)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def cache_files(self):
        directory = os.path.join(self.user, 'anomalous', 'cache', 'card_thumbnails')
        return sorted(os.listdir(directory)) if os.path.isdir(directory) else []

    def test_thumbnail_is_kept_in_the_user_folder(self):
        cover = os.path.join(self.root, 'model.preview.png')
        Image.new('RGB', (1200, 1600), (10, 20, 30)).save(cover)
        served = media_routes._build_card_thumbnail(cover)
        self.assertTrue(served.startswith(os.path.join(self.user, 'anomalous', 'cache')))
        with Image.open(served) as image:
            self.assertEqual(max(image.size), media_routes.CARD_THUMBNAIL_EDGE)
        self.assertEqual(media_routes._build_card_thumbnail(cover), served)
        self.assertEqual(media_routes.thumbnail_cache_usage()[0], 1)
        self.assertEqual(media_routes.clear_thumbnail_cache(), 1)
        self.assertTrue(os.path.isfile(cover))  # the cover itself is never touched

    def test_video_cover_gets_a_poster(self):
        video = os.path.join(self.root, 'model.mp4')
        write_video(video)
        poster = media_routes._build_video_poster(video)
        self.assertIsNotNone(poster)
        with Image.open(poster) as image:
            self.assertEqual(image.size, (512, 288))
        broken = os.path.join(self.root, 'broken.mp4')
        with open(broken, 'wb') as handle:
            handle.write(b'not a video')
        self.assertIsNone(media_routes._build_video_poster(broken))

    def test_a_picture_past_the_pixel_limit_is_shrunk_by_a_child_never_served_whole(self):
        picture = os.path.join(self.root, 'upscaled.png')
        Image.new('RGB', (1600, 1040), (90, 140, 200)).save(picture)
        self.assertEqual(media_routes.picture_size(picture), (1600, 1040))
        # Below the size, the same steps as a 20480x13312 upscale past Pillow's limit.
        with mock.patch.object(Image, 'MAX_IMAGE_PIXELS', 1000):
            served = media_routes._build_card_thumbnail(picture)
            self.assertNotEqual(served, picture)
            with mock.patch.object(Image, 'MAX_IMAGE_PIXELS', None):
                with Image.open(served) as image:
                    self.assertEqual((image.format, image.size), ('WEBP', (512, 333)))
            self.assertEqual(media_routes._build_card_thumbnail(picture), served, 'made once, then kept')
            other = os.path.join(self.root, 'bigger.png')
            Image.new('RGB', (2000, 2000)).save(other)
            with mock.patch.object(media_routes, 'HUGE_PICTURE_PIXELS', 3_000_000):
                self.assertIsNone(media_routes._build_card_thumbnail(other), 'past what a child decodes: a placeholder')
        response = media_routes.picture_placeholder(other)
        self.assertEqual(response.content_type, 'image/svg+xml')
        self.assertIn('2000 × 2000', response.body.decode('utf-8'))

    def test_an_unreadable_large_file_is_never_the_card(self):
        broken = os.path.join(self.root, 'broken.png')
        with open(broken, 'wb') as handle:
            handle.write(b'\0' * 64)
        self.assertEqual(media_routes._build_card_thumbnail(broken), broken, 'small: shown as it is')
        with mock.patch.object(media_routes, 'ORIGINAL_CARD_BYTES', 10):
            self.assertIsNone(media_routes._build_card_thumbnail(broken))

    def test_viewers_get_a_smaller_copy_of_a_very_large_output(self):
        from aiohttp.test_utils import make_mocked_request
        from api import gallery_routes
        output = os.path.join(self.root, 'output')
        os.makedirs(output)
        Image.new('RGB', (900, 600), (1, 2, 3)).save(os.path.join(output, 'big.png'))
        Image.new('RGB', (300, 200)).save(os.path.join(output, 'small.png'))
        ask = lambda query: asyncio.run(gallery_routes.api_output_preview(make_mocked_request('GET', f'/anomalous/output_preview?{query}')))
        with mock.patch.object(gallery_routes.folder_paths, 'get_output_directory', return_value=output), \
                mock.patch.object(gallery_routes, 'PREVIEW_PIXELS', 400_000), mock.patch.object(gallery_routes, 'PREVIEW_EDGE', 256):
            info = json.loads(ask('filename=big.png&info=1').body)
            self.assertEqual(info, {"width": 900, "height": 600, "bytes": os.path.getsize(os.path.join(output, 'big.png')), "preview": True})
            served = ask('filename=big.png')
            with Image.open(served._path) as image:
                self.assertEqual(image.size, (256, 171))
            self.assertTrue(os.path.samefile(ask('filename=small.png')._path, os.path.join(output, 'small.png')), 'a usual picture is itself')
            self.assertEqual(ask('filename=..%2Fx.png').status, 400)
            with mock.patch.object(gallery_routes, 'BIG_FILE_BYTES', 1):
                listed = {item['filename']: item for item in gallery_routes._collect_gallery_images(output)}
            self.assertEqual((listed['big.png']['width'], listed['big.png']['height']), (900, 600))
            self.assertGreater(listed['small.png']['bytes'], 0)

    def test_warm_up_makes_the_images_in_the_background(self):
        cover = os.path.join(self.root, 'a.png')
        Image.new('RGB', (900, 900)).save(cover)
        video = os.path.join(self.root, 'b.mp4')
        write_video(video)
        media_routes.queue_card_images([cover, video, os.path.join(self.root, 'c.txt'), cover])
        deadline = time.time() + 20
        while media_routes._warm_thread is not None and time.time() < deadline:
            time.sleep(0.05)
        self.assertEqual(len(self.cache_files()), 2)


if __name__ == '__main__':
    unittest.main()
