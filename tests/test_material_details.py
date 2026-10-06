import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import materials


class MaterialDetailTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name, 'fixture.json')
        self.workflow = {
            'nodes': [
                {'id': 1, 'type': 'CLIPTextEncode', 'widgets_values': ['  exact prompt\n']},
                {'id': 2, 'type': 'KSampler', 'widgets_values': [123, 'fixed', 20, 7, 'euler', 'normal', 1], 'properties': {'custom': 'kept'}, 'mode': 0},
            ],
            'links': [[1, 1, 0, 2, 1, 'CONDITIONING']],
            'extra': {'anomalous_hashes': {'2_model': {'sha256': 'a' * 64}}},
        }
        self.record = {'kind': 'image_workflow_snapshot', 'name': 'Fixture', 'tags': ['tag'],
                       'capabilities': ['open_workflow', 'apply_node_parameters'],
                       'workflow': self.workflow, 'source': {'image': {'filename': 'source.png'}},
                       'model_references': [{'saved_value': 'model.safetensors'}]}
        self.write_record()

    def write_record(self):
        self.path.write_text(json.dumps(self.record), encoding='utf-8')

    async def request(self, **query):
        with mock.patch.object(materials, 'get_materials_dir', return_value=self.directory.name):
            return await materials.api_get_material_full(SimpleNamespace(query={'filename': 'fixture.json', **query}))

    async def test_detail_has_exact_blocks_without_workflow_or_disk_changes(self):
        original = self.path.read_bytes()
        response = await self.request(include_workflow='0')
        self.assertEqual(response.status, 200)
        payload = json.loads(response.body)
        self.assertNotIn('workflow', payload['data'])
        self.assertEqual(payload['data']['model_references'], self.record['model_references'])
        self.assertEqual(payload['data']['source'], self.record['source'])
        self.assertEqual(payload['node_blocks'][0]['widgets_values'], ['  exact prompt\n'])
        self.assertEqual(payload['node_blocks'][1]['properties'], {'custom': 'kept'})
        self.assertEqual(payload['node_blocks'][1]['volatile_widget_indexes'], [0])
        self.assertEqual(self.path.read_bytes(), original)

    async def test_open_has_exact_workflow_and_does_not_build_duplicate_blocks(self):
        with mock.patch.object(materials, '_material_node_blocks', side_effect=AssertionError('unneeded node blocks')):
            response = await self.request(include_workflow='1')
        payload = json.loads(response.body)
        self.assertEqual(response.status, 200)
        self.assertEqual(payload['data']['workflow'], self.workflow)
        self.assertEqual(payload['node_blocks'], [])

    async def test_legacy_full_snapshot_response_remains_compatible(self):
        payload = json.loads((await self.request()).body)
        self.assertEqual(payload['data']['workflow'], self.workflow)
        self.assertEqual(len(payload['node_blocks']), 2)
        self.assertEqual(payload['node_blocks'][1]['widgets_values'][0], 123)

    async def test_selected_material_never_sends_hidden_workflow(self):
        self.record.update(kind='image_node_selection', selection={'scope': 'nodes', 'node_ids': [2]})
        # Even an inconsistent capability must not expose the source graph.
        self.write_record()
        for query in ({}, {'include_workflow': '0'}):
            payload = json.loads((await self.request(**query)).body)
            self.assertNotIn('workflow', payload['data'])
            self.assertEqual([block['node_id'] for block in payload['node_blocks']], [2])
            self.assertNotIn('exact prompt', json.dumps(payload))
        self.assertEqual((await self.request(include_workflow='1')).status, 403)

    async def test_invalid_requests_are_rejected(self):
        self.assertEqual((await self.request(include_workflow='yes')).status, 400)
        self.assertEqual((await self.request(filename='../fixture.json')).status, 400)
        self.assertEqual((await self.request(filename='missing.json')).status, 404)

    def test_selection_filters_before_copying_values_and_keeps_occurrences(self):
        class UnusedValues(list):
            def __deepcopy__(self, memo):
                raise AssertionError('copied a hidden node')
        record = {'workflow': {'nodes': [
            {'id': 1, 'type': 'KSampler', 'widgets_values': UnusedValues([999])},
            {'id': 2, 'type': 'KSampler', 'widgets_values': [123]},
        ]}, 'selection': {'scope': 'nodes', 'node_ids': [2]}}
        blocks = materials._material_node_blocks(record)
        self.assertEqual(blocks[0]['occurrence'], 2)
        self.assertEqual(blocks[0]['widgets_values'], [123])


if __name__ == '__main__':
    unittest.main()
