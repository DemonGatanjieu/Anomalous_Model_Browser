import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from PIL import Image

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import materials


class MaterialBrowsingTests(unittest.TestCase):
    def test_filters_pagination_and_tag_edit_preserve_workflow(self):
        with tempfile.TemporaryDirectory() as directory:
            workflow = {'nodes': [{'id': 1, 'type': 'KSampler', 'widgets_values': [123]}]}
            for i in range(55):
                Path(directory, f'{i}.json').write_text(json.dumps({'name': f'Material {i}', 'workflow': workflow, 'kind': 'image_workflow_snapshot', 'tags': ['Portrait'] if i % 2 else ['景色'], 'timestamp': i}))
            first = materials._query_materials(directory, {'category': 'workflow', 'page': '1'})
            second = materials._query_materials(directory, {'category': 'workflow', 'page': '2'})
            self.assertEqual((len(first['materials']), len(second['materials']), first['total']), (48, 7, 55))
            self.assertFalse({m['filename'] for m in first['materials']} & {m['filename'] for m in second['materials']})
            self.assertEqual(materials._query_materials(directory, {'category': 'workflow', 'tag': 'portrait'})['total'], 27)
            # Whole workflows are recipes now: "all" (the pieces) does not list them.
            self.assertEqual(materials._query_materials(directory, {})['total'], 0)
            self.assertEqual(materials._query_materials(directory, {'category': 'workflow', 'q': 'ksampler'})['total'], 55)
            self.assertEqual(materials._query_materials(directory, {'kind': 'image_node_selection'})['total'], 0)
            materials._update_material_details(directory, '0.json', 'Renamed', ['new'])
            self.assertEqual(materials._query_materials(directory, {'category': 'workflow', 'q': 'renamed', 'tag': 'new'})['total'], 1)
            self.assertEqual(json.loads(Path(directory, '0.json').read_text())['workflow'], workflow)
            # One moved to the recipes is not listed again; its file stays whole.
            materials._store._mark_material_moved(directory, '0.json', 'recipe_1.json')
            self.assertEqual(materials._query_materials(directory, {'category': 'workflow'})['total'], 54)
            self.assertEqual(json.loads(Path(directory, '0.json').read_text())['workflow'], workflow)

    def test_duplicate_warning_uses_image_and_selected_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory, 'image.png'); Image.new('RGB', (8, 8)).save(source)
            store = Path(directory, 'library'); store.mkdir()
            record = {'name': 'one', 'kind': 'image_node_selection', 'workflow': {'nodes': [{'id': 1, 'type': 'KSampler'}, {'id': 2, 'type': 'CLIPTextEncode'}]}, 'selection': {'node_ids': ['1', '2']}}
            self.assertIsNone(materials._persist_material(str(store), 'one.json', str(source), record))
            record['selection']['node_ids'].reverse()
            duplicate = materials._persist_material(str(store), 'two.json', str(source), record)
            self.assertEqual(duplicate['filename'], 'one.json')
            self.assertFalse((store/'two.json').exists())
            self.assertFalse((store/'.assets/two').exists())
            self.assertIsNone(materials._persist_material(str(store), 'two.json', str(source), record, allow_duplicate=True))
            record['selection']['node_ids'] = ['1']
            self.assertIsNone(materials._persist_material(str(store), 'three.json', str(source), record))

    def test_tags_are_bounded_and_case_insensitive_duplicates_removed(self):
        self.assertEqual(materials._normalise_material_tags([' Portrait ', 'portrait', '景色']), ['Portrait', '景色'])
        for tags in ('bad', ['x' * 61], ['x'] * 21, [123]):
            with self.assertRaises(ValueError):
                materials._normalise_material_tags(tags)


if __name__ == '__main__':
    unittest.main()


class MaterialsByNodeTypeTests(unittest.IsolatedAsyncioTestCase):
    async def test_moved_workflow_is_not_offered_again(self):
        with tempfile.TemporaryDirectory() as directory:
            workflow = {'nodes': [{'id': 1, 'type': 'KSampler', 'widgets_values': [123, 'fixed', 20]}]}
            for name in ('kept', 'moved'):
                Path(directory, f'{name}.json').write_text(json.dumps({'name': name, 'workflow': workflow, 'kind': 'image_workflow_snapshot'}))
            materials._store._mark_material_moved(directory, 'moved.json', 'recipe_1.json')
            with mock.patch.object(materials, 'get_materials_dir', lambda: directory):
                response = await materials.api_get_materials_by_node_type(SimpleNamespace(query={'type': 'KSampler'}))
            self.assertEqual([item['name'] for item in json.loads(response.text)['materials']], ['kept'])

