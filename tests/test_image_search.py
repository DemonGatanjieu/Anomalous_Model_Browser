import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

from PIL import Image, PngImagePlugin

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import image_search, model_resolution


def _png(path, **texts):
    info = PngImagePlugin.PngInfo()
    for key, value in texts.items():
        info.add_text(key, value)
    Image.new('RGB', (4, 4)).save(path, pnginfo=info)


PROMPT = json.dumps({
    '3': {'class_type': 'KSampler', 'inputs': {'seed': 123456789, 'steps': 25, 'model': ['4', 0]}},
    '4': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': '2D_Anime\\MiaoMiao RealSkin.safetensors'}},
    '6': {'class_type': 'CLIPTextEncode', 'inputs': {'text': '1girl, 赛博朋克 city, neon'}},
})
WORKFLOW = json.dumps({'extra': {'anomalous_hashes': {
    '4_2D_Anime\\MiaoMiao RealSkin.safetensors': {'hash': '667B5E3BEDE5A2FD53BB6F0EA5B93A89453D6855FA2E5D95ACDE93CF543C4F7C', 'size': 1},
}}})


class ImageSearchTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / 'sub').mkdir()
        _png(self.root / 'a.png', prompt=PROMPT, workflow=WORKFLOW)
        _png(self.root / 'sub' / 'b.png', prompt=json.dumps({'1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': 'renamed_copy.safetensors'}}}))
        _png(self.root / 'c.png', parameters='a cat in rain\nSteps: 20, Seed: 42, Model hash: abcdef1234, Model: dreamshaper')
        Image.new('RGB', (4, 4)).save(self.root / 'plain.jpg')
        self.images = [
            {'filename': 'a.png', 'subfolder': ''},
            {'filename': 'b.png', 'subfolder': 'sub'},
            {'filename': 'c.png', 'subfolder': ''},
            {'filename': 'plain.jpg', 'subfolder': ''},
        ]
        image_search._record_cache.clear()
        image_search._model_index.update(expires=0, entries={})
        patcher = mock.patch.object(model_resolution, 'collect_model_hash_index', return_value={
            'renamed_copy.safetensors': {'hash': '667b5e3bede5a2fd53bb6f0ea5b93a89453d6855fa2e5d95acde93cf543c4f7c'},
        })
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self._tmp.cleanup()

    def names(self, query):
        return [image['filename'] for image in image_search.filter_images(str(self.root), self.images, query)]

    def test_prompt_text_models_and_seed(self):
        self.assertEqual(self.names('赛博朋克'), ['a.png'])
        self.assertEqual(self.names('miaomiao realskin'), ['a.png'], 'all terms must match')
        self.assertEqual(self.names('123456789'), ['a.png'])
        self.assertEqual(self.names('seed:123456789'), ['a.png'])
        self.assertEqual(self.names('neon cat'), [])

    def test_search_blocks_keep_phrases_whole(self):
        # A list is one phrase per block; a plain string still splits on spaces.
        self.assertEqual(self.names(['city, neon']), ['a.png'])
        self.assertEqual(self.names(['neon city']), [])
        self.assertEqual(self.names('neon city'), ['a.png'])
        self.assertEqual(self.names(['cat in  rain', 'Seed: 42']), ['c.png'])
        self.assertEqual(image_search.parse_query(['  A  b ', 'a b', '']), ['a b'])

    def test_a1111_parameters_and_file_names(self):
        self.assertEqual(self.names('cat'), ['c.png'])
        self.assertEqual(self.names('abcdef1234'), ['c.png'], 'A1111 model hash text')
        self.assertEqual(self.names('plain'), ['plain.jpg'])

    def test_hash_matches_recorded_hashes_and_local_renamed_files(self):
        # a.png recorded the hash; b.png only names a local file whose scanned hash matches.
        self.assertEqual(self.names('667B5E3B'), ['a.png', 'b.png'])
        self.assertEqual(self.names('667b5e3bede5a2fd'), ['a.png', 'b.png'])
        self.assertEqual(self.names('deadbeef'), [])

    def test_records_are_cached_by_mtime(self):
        self.names('cat')
        with mock.patch.object(image_search, 'build_record', side_effect=AssertionError('re-read')):
            images = [dict(image, mtime=image_search._record_cache[str(self.root / image['subfolder'] / image['filename'])][0])
                      for image in self.images]
            self.assertEqual([i['filename'] for i in image_search.filter_images(str(self.root), images, 'cat')], ['c.png'])

    def test_only_text_chunks_before_pixels_are_read(self):
        chunks = image_search.read_png_text(self.root / 'a.png')
        self.assertEqual(set(chunks), {'prompt', 'workflow'})
        self.assertIn('赛博朋克', json.loads(chunks['prompt'])['6']['inputs']['text'])


class ModelResolutionImportTests(unittest.TestCase):
    def test_model_scan_uses_model_extensions(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'model.safetensors').write_bytes(b'x')
            Path(directory, 'notes.txt').write_text('x')
            with mock.patch.object(model_resolution.folder_paths, 'get_folder_paths', return_value=[directory]):
                candidates = model_resolution._collect_resolution_candidates(['checkpoints'])
        self.assertEqual([c['filename'] for c in candidates], ['model.safetensors'])


if __name__ == '__main__':
    unittest.main()
