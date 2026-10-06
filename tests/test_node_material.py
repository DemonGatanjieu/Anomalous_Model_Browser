import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import materials, node_material


class NodeMaterialTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        patcher = mock.patch.object(materials, 'get_materials_dir', return_value=str(self.root))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.node = {'type': 'KSampler', 'title': 'Sampler', 'widgets_values': [123, 'fixed', 30, 5.5, 'euler', 'karras', 1]}

    async def save(self, **body):
        request = SimpleNamespace(json=mock.AsyncMock(return_value={'node': self.node, **body}))
        response = await node_material.api_save_node_material(request)
        return response.status, json.loads(response.body)

    async def test_saved_node_reads_back_as_a_parameter_block(self):
        status, data = await self.save(name='Slow and sharp')
        self.assertEqual(status, 200)
        self.assertEqual(data['material']['kind'], 'node_parameter_selection')
        self.assertEqual(data['material']['node_types'], ['KSampler'])
        result = materials._query_materials(str(self.root), {'category': 'params'})
        self.assertEqual([item['name'] for item in result['materials']], ['Slow and sharp'])
        record = materials._read_material(self.root / data['filename'])
        blocks = materials._material_node_blocks(record, include_values=True)
        self.assertEqual([(block['type'], block['widgets_values']) for block in blocks],
                         [('KSampler', self.node['widgets_values'])])

    async def test_same_values_are_saved_once(self):
        self.assertEqual((await self.save())[0], 200)
        status, data = await self.save(name='Another name')
        self.assertEqual(status, 409)
        self.assertEqual(data['name'], 'Sampler')  # the title is the default name
        self.node = {**self.node, 'widgets_values': [123, 'fixed', 31, 5.5, 'euler', 'karras', 1]}
        self.assertEqual((await self.save())[0], 200)

    async def test_bad_input_saves_nothing(self):
        for node in [None, {'type': '', 'widgets_values': [1]}, {'type': 'KSampler', 'widgets_values': []},
                     {'type': 'KSampler', 'widgets_values': 'x'}, {'type': 'K' * 201, 'widgets_values': [1]}]:
            self.node = node
            self.assertEqual((await self.save())[0], 400)
        self.node = {'type': 'KSampler', 'widgets_values': [float('nan')]}
        self.assertEqual((await self.save())[0], 400)
        self.assertEqual(list(self.root.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
