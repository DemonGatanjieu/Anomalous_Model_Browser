"""Tasks that go on from one another (ai_task_links.py): kept when an AI begins a new task while on
another and when the user starts one from a task, changed or taken off by the user, never a loop,
and an AI beginning the next task hears what was decided in the one before."""
import unittest

from test_ai_tasks import isolate
from api import ai_task_links, ai_tasks, mcp_task_tools


class LinkTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.ctx = {"client": "A", "session": "s1"}

    def test_a_new_task_goes_on_from_the_one_the_ai_was_on_and_hears_its_decisions(self):
        first = mcp_task_tools.begin_task(self.ctx, "海边少女")["task"]
        mcp_task_tools.log_decision({**self.ctx, "task": first}, "构图", "竖图")
        second = mcp_task_tools.begin_task(self.ctx, "换成夜景", new_task=True)
        self.assertEqual(ai_tasks.get_task(second["task"])["from"], first)
        self.assertEqual(second["continues"]["task"], first)
        self.assertIn("构图: 竖图", second["continues"]["decisions"])
        self.assertEqual(ai_task_links.links(first)["next"], [{"id": second["task"], "title": "换成夜景"}])
        self.assertEqual(ai_task_links.links(second["task"])["from"], {"id": first, "title": "海边少女"})
        self.assertEqual(ai_tasks.list_tasks()[0]["from"], first)

    def test_the_user_starts_links_and_unlinks_but_never_in_a_loop(self):
        one = ai_tasks.begin_task("A", "一")["id"]
        two = ai_tasks.start_task("二", from_task=one)["id"]
        self.assertEqual(ai_tasks.begin_task("B", "二")["id"], two, "an AI takes the task the user started")
        self.assertEqual(ai_tasks.get_task(two)["from"], one)
        three = ai_tasks.start_task("三", from_task="gone")["id"]
        self.assertNotIn("from", ai_tasks.get_task(three))
        ai_task_links.set_from(three, two)
        with self.assertRaises(ai_task_links.LinkError):
            ai_task_links.set_from(one, three)  # one → three → two → one would loop
        with self.assertRaises(ai_task_links.LinkError):
            ai_task_links.set_from(one, one)
        ai_task_links.set_from(three, None)
        self.assertIsNone(ai_task_links.links(three)["from"])
        self.assertIsNone(ai_task_links.carried(ai_tasks.get_task(one)))


if __name__ == "__main__":
    unittest.main()
