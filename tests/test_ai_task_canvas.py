"""Task canvas metadata reaches missing-model downloads as well as canvas edits."""
import unittest

from test_ai_tasks import isolate
from api import ai_task_canvas, ai_tasks


class CanvasTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.addCleanup(ai_task_canvas.begin_call, None)

    def test_missing_model_download_carries_its_task_tab(self):
        task = ai_tasks.begin_task('A', 'Canvas')
        ai_task_canvas.set_mode(task['id'], 'new')
        ai_task_canvas.begin_call(task['id'])
        ai_task_canvas.remember({'path': 'task-A.json', 'name': 'A'})
        spec = ai_task_canvas.spec('download_missing')
        self.assertEqual(spec['mode'], 'new')
        self.assertEqual(spec['tab']['path'], 'task-A.json')
        ai_task_canvas.set_mode(task['id'], 'current')
        self.assertEqual(ai_task_canvas.spec('download_missing')['mode'], 'current')
        self.assertIsNone(ai_task_canvas.spec('open_model'))


if __name__ == '__main__':
    unittest.main()
