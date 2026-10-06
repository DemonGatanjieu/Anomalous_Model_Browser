from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import model_type_listing


class TypeModelsTests(unittest.TestCase):
    def test_lists_every_subfolder_and_each_model_names_its_own(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'Anime' / 'deep').mkdir(parents=True)
            (root / 'base.safetensors').write_bytes(b'x')
            (root / 'base.png').write_bytes(b'x')
            (root / 'Anime' / 'girl.safetensors').write_bytes(b'x')
            (root / 'Anime' / 'deep' / 'far.ckpt').write_bytes(b'x')
            (root / 'Anime' / 'notes.txt').write_text('not a model')
            with mock.patch.object(model_type_listing.folder_paths, 'get_folder_paths', return_value=[directory]):
                models = model_type_listing._collect_type_models('loras', 0)
        self.assertEqual([(m['subfolder'], m['filename']) for m in models],
                         [('', 'base.safetensors'), ('Anime', 'girl.safetensors'), ('Anime/deep', 'far.ckpt')])
        self.assertIn('filename=base.png', models[0]['preview_url'])
        self.assertTrue(all(m['type'] == 'loras' and m['path_idx'] == 0 for m in models))

    def test_lists_gguf_pth_and_any_case(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('wan-Q4_K_M.gguf', '4x-UltraSharp.pth', 'flux.sft', 'OLD.SAFETENSORS', 'readme.md'):
                (root / name).write_bytes(b'x')
            with mock.patch.object(model_type_listing.folder_paths, 'get_folder_paths', return_value=[directory]):
                models = model_type_listing._collect_type_models('diffusion_models', 0)
        self.assertEqual([m['filename'] for m in models],
                         ['4x-UltraSharp.pth', 'flux.sft', 'OLD.SAFETENSORS', 'wan-Q4_K_M.gguf'])

    def test_unknown_type_or_index_lists_nothing(self):
        with mock.patch.object(model_type_listing.folder_paths, 'get_folder_paths', side_effect=KeyError('nope')):
            self.assertEqual(model_type_listing._collect_type_models('nope', 0), [])
        with mock.patch.object(model_type_listing.folder_paths, 'get_folder_paths', return_value=['x']):
            self.assertEqual(model_type_listing._collect_type_models('loras', 3), [])


if __name__ == '__main__':
    unittest.main()
