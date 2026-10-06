import json
from pathlib import Path
import sys
import tempfile
import unittest

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import materials

class StudioCategories(unittest.TestCase):
    def test_categories_cover_saved_sources_before_pagination(self):
        with tempfile.TemporaryDirectory() as directory:
            records = [
                {'kind': 'image_workflow_snapshot', 'workflow': {'nodes': [{'id': 1, 'type': 'CLIPTextEncode'}]}},
                {'kind': 'image_node_selection', 'workflow': {'nodes': [{'id': 1, 'type': 'KSampler'}]}},
                {'kind': 'recipe_parameter_selection', 'workflow': {'nodes': [{'id': 1, 'type': 'KSampler'}]}},
                {'kind': 'image_node_selection', 'workflow': {'nodes': [{'id': 1, 'type': 'CLIPTextEncode'}]}},
                {'kind': 'prompt_text', 'note': {'promptEn': 'test'}},
                {'kind': 'prompt_note_bundle', 'note': {'promptEn': 'test'}},
                {'kind': 'prompt_plan', 'plan': {'parts': [], 'positive': 'test', 'negative': ''}},
            ]
            for index, record in enumerate(records):
                Path(directory, f'{index}.json').write_text(json.dumps({'name': f'Material {index}', 'tags': ['A'], **record}))
            for category, total in [('all', 6), ('workflow', 1), ('params', 2), ('prompts', 4)]:
                result = materials._query_materials(directory, {'category': category, 'page': 1, 'limit': 1})
                self.assertEqual(result['total'], total)
                self.assertEqual(result['pages'], total)
                self.assertEqual(len(result['materials']), 1)
            self.assertEqual(materials._query_materials(directory, {'category': 'params', 'node_type': 'KSampler'})['total'], 2)
            self.assertEqual(materials._query_materials(directory, {'category': 'prompts', 'kind': 'prompt_text', 'q': 'Material 4', 'tag': 'a'})['total'], 1)
            with self.assertRaises(ValueError): materials._query_materials(directory, {'category': 'invalid'})

if __name__ == '__main__': unittest.main()
