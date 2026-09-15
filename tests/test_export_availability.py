import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PLUGIN_DIR = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN_DIR), str(PLUGIN_DIR.parents[1])]
from api import recipe_packages


class ExportAvailabilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_export_rejected_before_request_or_files_are_read(self):
        class UnreadRequest:
            async def json(self):
                raise AssertionError('Disabled export must not read request data')

        with patch.object(recipe_packages, 'get_recipes_dir', side_effect=AssertionError('No filesystem access')):
            response = await recipe_packages.api_export_recipe_package(UnreadRequest())
        self.assertEqual(response.status, 503)
        self.assertEqual(json.loads(response.text)['code'], 'recipe_export_disabled')
        self.assertNotIn('Content-Disposition', response.headers)


if __name__ == '__main__':
    unittest.main()
