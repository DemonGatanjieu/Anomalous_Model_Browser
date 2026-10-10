import asyncio
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

from aiohttp import web
from aiohttp.test_utils import make_mocked_request

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import activity_log  # noqa: E402


class ActivityLogTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = str(Path(self.directory.name, 'activity_log.json'))
        self.patch = mock.patch.object(activity_log, 'log_path', return_value=self.path)
        self.patch.start()
        activity_log._entries = None

    def tearDown(self):
        self.patch.stop()
        activity_log._entries = None
        self.directory.cleanup()

    def test_entries_are_newest_first_bounded_and_saved(self):
        with mock.patch.object(activity_log, 'MAX_ENTRIES', 3):
            for index in range(5):
                activity_log.add_entry('file', 'recipe_save', f'r{index}')
        self.assertEqual([e['target'] for e in activity_log.list_entries()], ['r4', 'r3', 'r2'])
        activity_log._entries = None  # read back from disk
        self.assertEqual([e['target'] for e in activity_log.list_entries()], ['r4', 'r3', 'r2'])
        self.assertEqual([e['target'] for e in activity_log.list_entries(source='canvas')], [])
        activity_log.clear()
        self.assertEqual(json.loads(Path(self.path).read_text()), [])

    def test_log_stays_under_its_byte_limit(self):
        with mock.patch.object(activity_log, 'MAX_LOG_BYTES', 20_000):
            for index in range(200):
                activity_log.add_entry('file', 'note_save', f'{index}-' + 'x' * 300)
            self.assertLessEqual(Path(self.path).stat().st_size, 20_000)
            self.assertTrue(activity_log.list_entries()[0]['target'].startswith('199-'))

    def test_long_values_are_shortened(self):
        entry = activity_log.add_entry('file', 'note_save', 'x' * 1000)
        self.assertLessEqual(len(entry['target']), activity_log.MAX_VALUE_CHARS + 1)

    def test_a_change_late_in_a_long_text_still_shows(self):
        before = ', '.join(f'tag{i}' for i in range(200))  # far longer than MAX_VALUE_CHARS
        after = before.replace('tag180', 'tag180, extra')
        item = activity_log._clean_changes([{'kind': 'changed', 'node': 'n', 'widget': 'text',
                                             'before': before, 'after': after}])[0]
        self.assertNotEqual(item['before'], item['after'])
        self.assertIn('extra', item['after'])
        self.assertTrue(item['before'].startswith('…'))
        self.assertLessEqual(len(item['after']), activity_log.MAX_VALUE_CHARS + 2)

    def test_failure_responses_are_not_recorded(self):
        ok = web.json_response({'success': True})
        self.assertFalse(activity_log._failed(ok))
        for bad in (web.json_response({'status': 'error'}), web.json_response({'success': False}),
                    web.json_response({'ok': True}, status=400)):
            self.assertTrue(activity_log._failed(bad))

    def test_middleware_records_successful_writes_only(self):
        async def run(path, status, payload):
            request = make_mocked_request('POST', path, headers={'Content-Type': 'application/json'})
            request._read_bytes = json.dumps(payload).encode()

            async def handler(_request):
                await _request.json()
                return web.json_response({'success': status < 300}, status=status)
            await activity_log.activity_middleware(request, handler)

        asyncio.run(run('/anomalous/delete_recipe', 200, {'filename': 'folder/My Recipe.json'}))
        asyncio.run(run('/anomalous/delete_recipe', 500, {'filename': 'broken.json'}))
        asyncio.run(run('/anomalous/folders', 200, {'name': 'not a write route'}))
        entries = activity_log.list_entries()
        self.assertEqual([(e['action'], e['target']) for e in entries], [('recipe_delete', 'My Recipe.json')])

    def test_canvas_post_keeps_known_change_kinds(self):
        async def post(body):
            request = make_mocked_request('POST', '/anomalous/activity', headers={'Content-Type': 'application/json'})
            request._read_bytes = json.dumps(body).encode()
            return await activity_log.api_post_activity(request)

        bad = asyncio.run(post({'changes': [{'kind': 'script', 'node': 'x'}]}))
        self.assertEqual(bad.status, 400)
        good = asyncio.run(post({'changes': [{'kind': 'changed', 'node': 'KSampler #3', 'widget': 'steps',
                                              'before': '20', 'after': '30'}], 'total': 4, 'workflow': 'a.json'}))
        self.assertEqual(good.status, 200)
        entry = activity_log.list_entries()[0]
        self.assertEqual((entry['source'], entry['target'], entry['detail']['total']), ('canvas', 'a.json', 4))


if __name__ == '__main__':
    unittest.main()
