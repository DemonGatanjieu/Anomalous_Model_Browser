import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

import recycle_bin
from api import material_store, model_metadata


class FakeTrash:
    """Stands in for the Recycle Bin: records what was sent and removes it, like a move would."""

    def __init__(self, fail=None):
        self.calls = []
        self.fail = fail

    def __call__(self, *paths):
        if self.fail:
            raise self.fail
        self.calls.append([os.path.basename(p) for p in paths if os.path.lexists(p)])
        for path in paths:
            if os.path.isdir(path):
                import shutil
                shutil.rmtree(path)
            elif os.path.lexists(path):
                os.remove(path)
        return [p for p in paths]


class Request(dict):  # aiohttp requests also hold values for the middleware
    def __init__(self, body):
        super().__init__()
        self.body = body

    async def json(self):
        return self.body


def body(response):
    return json.loads(response.body)


class RecycleBinTests(unittest.TestCase):
    def test_only_existing_paths_go_together_as_absolute_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'a.safetensors').write_bytes(b'x')
            with mock.patch.object(recycle_bin.sys, 'platform', 'win32'), \
                    mock.patch.object(recycle_bin, '_windows_recycle') as recycle:
                moved = recycle_bin.move_to_trash(os.path.join(directory, 'a.safetensors'), os.path.join(directory, 'gone.png'), '')
        recycle.assert_called_once()
        self.assertEqual(moved, [os.path.abspath(os.path.join(directory, 'a.safetensors'))])
        self.assertEqual(recycle_bin.move_to_trash(), [])

    def test_network_and_removable_drives_are_refused_not_deleted(self):
        with mock.patch.object(recycle_bin, '_windows_fixed_drive', return_value=False):
            with self.assertRaises(recycle_bin.TrashUnavailable):
                recycle_bin._windows_recycle([r'\\server\share\model.safetensors'])


class ModelDeleteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = self.temp.name
        for name in ('m.safetensors', 'm.info', 'm.preview.png', 'other.safetensors'):
            Path(self.dir, name).write_bytes(b'x')
        self.patch = mock.patch.object(model_metadata, 'resolve_folder_subdir', return_value=(self.dir, self.dir))
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def delete(self, trash):
        with mock.patch.object(model_metadata, 'move_to_trash', trash):
            return body(asyncio.run(model_metadata.api_delete_model(Request({'filename': 'm.safetensors', 'type': 'loras'}))))

    def test_model_and_its_sidecars_go_to_the_recycle_bin_together(self):
        trash = FakeTrash()
        result = self.delete(trash)
        self.assertEqual(result['status'], 'success')
        self.assertEqual(len(trash.calls), 1)
        self.assertEqual(sorted(trash.calls[0]), ['m.info', 'm.preview.png', 'm.safetensors'])
        self.assertTrue(Path(self.dir, 'other.safetensors').exists())

    def test_sidecars_stay_when_another_model_shares_the_name(self):
        Path(self.dir, 'm.ckpt').write_bytes(b'x')
        trash = FakeTrash()
        result = self.delete(trash)
        self.assertEqual(trash.calls, [['m.safetensors']])
        self.assertTrue(result['sidecars_preserved'])

    def test_nothing_is_deleted_without_a_recycle_bin(self):
        result = self.delete(FakeTrash(fail=recycle_bin.TrashUnavailable('no bin')))
        self.assertEqual(result['status'], 'error')
        self.assertIn('回收站', result['message'])
        self.assertTrue(Path(self.dir, 'm.safetensors').exists())


class MaterialDeleteTests(unittest.TestCase):
    def test_material_and_its_images_go_together(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'one.json')
            path.write_text(json.dumps({'name': 'one', 'workflow': {'nodes': []}, 'timestamp': 1}))
            assets = Path(material_store._material_assets_dir(directory, 'one.json'))
            assets.mkdir(parents=True)
            (assets / 'image.png').write_bytes(b'png')
            trash = FakeTrash()
            with mock.patch.object(material_store, 'move_to_trash', trash), \
                    mock.patch.object(material_store, '_read_material', return_value={}):
                material_store._delete_material(directory, 'one.json', str(path))
            self.assertEqual(len(trash.calls), 1)
            self.assertIn('one.json', trash.calls[0])
            self.assertFalse(path.exists())


if __name__ == '__main__':
    unittest.main()
