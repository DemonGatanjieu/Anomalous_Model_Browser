"""Card images: kept in the user folder, posters for video covers, background warm-up."""

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
