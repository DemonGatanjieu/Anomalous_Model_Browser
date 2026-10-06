import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

from PIL import Image

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import materials, notebooks, utils


class StorageReliabilityTests(unittest.TestCase):
    def test_atomic_failure_preserves_previous_record(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'note.json')
            path.write_text('{"name":"original"}')
            with mock.patch.object(utils.os, 'replace', side_effect=OSError('disk failure')):
                with self.assertRaises(OSError):
                    utils.atomic_write_json(str(path), {'name': 'changed'})
            self.assertEqual(json.loads(path.read_text())['name'], 'original')
            self.assertEqual(len(list(Path(directory).iterdir())), 1)

    def test_migration_preserves_conflicts_and_never_resurrects_deleted_notes(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = Path(directory, 'old'); legacy.mkdir()
            user = Path(directory, 'user'); user.mkdir()
            (legacy / 'note.json').write_text('{"name":"old"}')
            (user / 'note.json').write_text('{"name":"new"}')
            with mock.patch.object(notebooks, 'LEGACY_NOTEBOOKS_DIR', str(legacy)):
                notebooks._migrate_notebooks(str(user))
                recovered = list(user.glob('*_legacy_*.json'))
                self.assertEqual(len(recovered), 1)
                self.assertEqual(json.loads(recovered[0].read_text())['name'], 'old')
                self.assertEqual(json.loads((user/'note.json').read_text())['name'], 'new')
                recovered[0].unlink()
                notebooks._migrate_notebooks(str(user))
                self.assertFalse(list(user.glob('*_legacy_*.json')))
                self.assertTrue((legacy/'note.json').exists())

    def test_interrupted_migration_can_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = Path(directory, 'old'); legacy.mkdir()
            user = Path(directory, 'user'); user.mkdir()
            (legacy/'one.json').write_text('{"name":"one"}')
            (legacy/'two.json').write_text('{"name":"two"}')
            original_write = notebooks.atomic_write_json
            def fail_second(path, *args):
                if str(path).endswith('two.json'):
                    raise OSError('interruption')
                return original_write(path, *args)
            with mock.patch.object(notebooks, 'LEGACY_NOTEBOOKS_DIR', str(legacy)):
                with mock.patch.object(notebooks, 'atomic_write_json', side_effect=fail_second):
                    with self.assertRaises(OSError):
                        notebooks._migrate_notebooks(str(user))
                notebooks._migrate_notebooks(str(user))
            self.assertEqual(len(list(user.glob('*.json'))), 3)
            self.assertTrue((user/'.legacy_imported.json').exists())

    def test_notebooks_use_user_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(notebooks.folder_paths, 'get_user_directory', return_value=directory), mock.patch.object(notebooks, 'LEGACY_NOTEBOOKS_DIR', str(Path(directory, 'missing'))):
                notebooks._save_notebook('saved.json', {'name': 'Saved'})
                self.assertTrue(Path(directory, 'workflows/anomalous_notebooks/saved.json').exists())
                self.assertEqual(len(notebooks._list_notebooks()), 1)

    def _material_fixture(self, directory):
        source = Path(directory, 'source.png')
        Image.new('RGB', (8, 8)).save(source)
        store = Path(directory, 'materials'); store.mkdir()
        record = {'workflow': {'nodes': [], 'links': []}, 'name': 'test'}
        return source, store, record

    def test_material_json_failure_leaves_no_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            source, store, record = self._material_fixture(directory)
            with mock.patch.object(materials, '_atomic_write_json', side_effect=OSError('disk failure')):
                with self.assertRaises(OSError):
                    materials._persist_material(str(store), 'material_test.json', str(source), record)
            self.assertFalse(list(store.rglob('*')))

    def test_material_final_commit_failure_rolls_back_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            source, store, record = self._material_fixture(directory)
            original_replace = os.replace
            def fail_record(source, target):
                if os.path.realpath(target) == os.path.realpath(store/'material_test.json'):
                    raise OSError('commit failure')
                return original_replace(source, target)
            with mock.patch.object(materials.os, 'replace', side_effect=fail_record):
                with self.assertRaises(OSError):
                    materials._persist_material(str(store), 'material_test.json', str(source), record)
            self.assertFalse([p for p in store.rglob('*') if p.is_file()])

    def test_material_success_publishes_record_and_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            source, store, record = self._material_fixture(directory)
            materials._persist_material(str(store), 'material_test.json', str(source), record)
            saved = json.loads((store/'material_test.json').read_text())
            self.assertTrue((store/'.assets/material_test'/saved['image']['source_asset_id']).exists())
            self.assertFalse(list(store.glob('.save-*')))


if __name__ == '__main__':
    unittest.main()
