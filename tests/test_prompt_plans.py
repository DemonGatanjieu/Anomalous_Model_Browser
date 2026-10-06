import copy
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


class PromptPlanTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        patcher = mock.patch.object(materials, 'get_materials_dir', return_value=str(self.root))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.plan = {'parts': [
            {'name': '默认词', 'category': 'general', 'enabled': True, 'positive': '  (quality:1.2)\n', 'negative': 'bad'},
            {'name': '模型', 'category': 'specific', 'enabled': False, 'positive': 'style', 'negative': ''}],
            'positive': '本次内容', 'negative': ''}

    async def save(self, **changes):
        return await materials.api_save_prompt_plan(SimpleNamespace(json=mock.AsyncMock(return_value={
            'name': '测试方案', 'tags': ['模型'], 'plan': self.plan, **changes})))

    async def test_roundtrip_dedup_and_reopen(self):
        response = await self.save()
        self.assertEqual(response.status, 200)
        filename = json.loads(response.body)['filename']
        record = materials._read_material(self.root / filename)
        self.assertEqual(record['plan'], self.plan)
        self.assertNotIn('workflow', record)
        self.assertNotIn('image', record)
        self.assertEqual((await self.save(name='Same content')).status, 409)
        self.assertEqual((await self.save(allow_duplicate=True)).status, 200)
        detail = json.loads(materials._material_detail_response(self.root / filename, '0').body)
        self.assertEqual(detail['data']['plan'], self.plan)
        self.assertEqual(detail['node_blocks'], [])
        self.assertEqual(detail['workflow_hashes'], {})
        self.assertEqual(materials._material_detail_response(self.root / filename, '1').status, 403)
        self.assertEqual(materials._query_materials(str(self.root), {'kind': 'prompt_plan'})['total'], 2)
        self.assertEqual(materials._query_materials(str(self.root), {'node_type': 'CLIPTextEncode'})['total'], 0)

    async def test_invalid_data_never_publishes(self):
        for plan in [None, [], {'parts': {}}, {'positive': 12}, {'parts': [{}]},
                     {'parts': [{'category': 'general', 'enabled': 'yes'}]},
                     {'parts': [{'category': 'general', 'name': 'x' * 121}]},
                     {'parts': [self.plan['parts'][0]] * 101}]:
            self.assertEqual((await self.save(plan=plan)).status, 400, plan)
        for changes in [{'name': ''}, {'name': []}, {'allow_duplicate': 'yes'}, {'tags': 12}]:
            self.assertEqual((await self.save(**changes)).status, 400)
        with mock.patch.object(materials, 'MAX_NOTEBOOK_BYTES', 20):
            self.assertEqual((await self.save()).status, 400)
        with mock.patch.object(materials, '_atomic_write_json', side_effect=OSError('disk full')):
            self.assertEqual((await self.save()).status, 500)
        self.assertEqual(list(self.root.iterdir()), [])

    async def test_snapshot_excludes_unknown_fields_and_is_independent(self):
        plan = copy.deepcopy(self.plan)
        plan['workflow'] = {'nodes': ['injected']}
        plan['parts'][0]['source_path'] = '../unused.json'
        response = await self.save(plan=plan)
        filename = json.loads(response.body)['filename']
        plan['parts'][0]['positive'] = 'later change'
        self.assertEqual(materials._read_material(self.root / filename)['plan'], self.plan)

    async def test_node_type_filter_and_scoped_hashes(self):
        workflow = {'nodes': [{'id': 1, 'type': 'CLIPTextEncode', 'widgets_values': ['hello']},
                              {'id': 2, 'type': 'KSampler', 'widgets_values': [123, 20]}],
                    'links': [], 'extra': {'anomalous_hashes': {'1_a': 'a', '2_b': 'b', '11_hidden': 'c'}}}
        record = {'schema_version': 1, 'kind': 'image_node_selection', 'name': 'Node', 'workflow': workflow,
                  'selection': {'scope': 'nodes', 'node_ids': [1]}, 'capabilities': ['apply_node_parameters']}
        (self.root / 'node.json').write_text(json.dumps(record), encoding='utf-8')
        self.assertEqual(materials._query_materials(str(self.root), {'node_type': 'CLIPTextEncode'})['total'], 1)
        self.assertEqual(materials._query_materials(str(self.root), {'node_type': 'cliptextencode'})['total'], 0)
        self.assertEqual(materials._query_materials(str(self.root), {'node_type': 'KSampler'})['total'], 0)
        result = json.loads(materials._material_detail_response(self.root / 'node.json', '0').body)
        self.assertEqual(result['workflow_hashes'], {'1_a': 'a'})
        self.assertNotIn('workflow', result['data'])


if __name__ == '__main__':
    unittest.main()
