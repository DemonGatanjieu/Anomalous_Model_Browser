import asyncio
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import materials, utils


def material(name, node_type='KSampler'):
    return {'name': name, 'workflow': {'nodes': [{'id': 1, 'type': node_type, 'widgets_values': [1]}]}, 'timestamp': 1}


class ListingIndexTests(unittest.TestCase):
    def setUp(self):
        materials._cached_material_summary.cache_clear()
        utils._invalidate_gallery_snapshot()

    def test_warm_summary_avoids_workflow_reads_and_detects_file_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'one.json')
            path.write_text(json.dumps(material('first')))
            with mock.patch.object(materials, '_read_material', wraps=materials._read_material) as read:
                first = materials._list_materials(directory)
                first[0]['name'] = 'mutated caller'
                self.assertEqual(materials._list_materials(directory)[0]['name'], 'first')
                self.assertEqual(read.call_count, 1)
                path.write_text(json.dumps(material('changed name')))
                self.assertEqual(materials._list_materials(directory)[0]['name'], 'changed name')
                self.assertEqual(read.call_count, 2)
                path.unlink()
                self.assertEqual(materials._list_materials(directory), [])

    def test_node_lookup_reads_only_matching_records_after_index_warmup(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'one.json').write_text(json.dumps(material('one', 'KSampler')))
            Path(directory, 'two.json').write_text(json.dumps(material('two', 'CLIPTextEncode')))
            materials._list_materials(directory)
            request = type('Request', (), {'query': {'type': 'KSampler'}})()
            with mock.patch.object(materials, 'get_materials_dir', return_value=directory), mock.patch.object(materials, '_read_material', wraps=materials._read_material) as read:
                response = asyncio.run(materials.api_get_materials_by_node_type(request))
                self.assertEqual(len(json.loads(response.text)['materials']), 1)
                self.assertEqual(read.call_count, 1)

    def test_gallery_pagination_reuses_snapshot_and_refresh_sees_new_output(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'one.png').write_bytes(b'image')
            with mock.patch.object(utils, '_collect_gallery_images', wraps=utils._collect_gallery_images) as collect:
                self.assertEqual(len(utils._gallery_images(directory)), 1)
                Path(directory, 'two.png').write_bytes(b'image')
                self.assertEqual(len(utils._gallery_images(directory)), 1)
                self.assertEqual(collect.call_count, 1)
                self.assertEqual(len(utils._gallery_images(directory, refresh=True)), 2)
                utils._invalidate_gallery_snapshot()
                utils._gallery_images(directory)
                self.assertEqual(collect.call_count, 3)

    def test_gallery_ttl_and_root_change_invalidate_snapshot(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            with mock.patch.object(utils, '_collect_gallery_images', wraps=utils._collect_gallery_images) as collect:
                utils._gallery_images(first)
                utils._gallery_images(second)
                utils._gallery_snapshot['expires'] = 0
                utils._gallery_images(second)
                self.assertEqual(collect.call_count, 3)


if __name__ == '__main__':
    unittest.main()
