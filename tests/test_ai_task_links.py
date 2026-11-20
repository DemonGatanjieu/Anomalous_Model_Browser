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
        self.assertEqual(ai_task_links.links(first)["next"], [{"id": second["task"], "title": "换成夜景", "title_from": "ai"}])
        self.assertEqual(ai_task_links.links(second["task"])["from"], {"id": first, "title": "海边少女", "title_from": "ai"})
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

    def test_a_task_going_on_from_a_private_one_is_private_as_it_is(self):
        from api import ai_privacy
        one = ai_tasks.begin_task("A", "一")["id"]
        ai_privacy.set_private(one, True)
        with ai_tasks._lock:  # the task's own switch for model names (ai_sealed_adjust.py writes it)
            ai_tasks._load()[one]["privacy_models"] = False
            ai_tasks._save(ai_tasks._load()[one])
        two = ai_tasks.start_task("", from_task=one)["id"]
        self.assertTrue(ai_privacy.is_private(ai_tasks.get_task(two)), "started from it by the user")
        self.assertIs(ai_tasks.get_task(two).get("privacy_models"), False)
        ai_tasks.begin_task("A", "二", task_id=two)
        three = ai_tasks.begin_task("A", "三", new_task=True)["id"]
        self.assertEqual(ai_tasks.get_task(three)["from"], two)
        self.assertTrue(ai_privacy.is_private(ai_tasks.get_task(three)), "begun as new by the AI while on it")
        plain = ai_tasks.start_task("", from_task=ai_tasks.begin_task("B", "四", new_task=True)["id"])["id"]
        self.assertNotIn("privacy", ai_tasks.get_task(plain), "a task following the default leaves the next to the default too")

    def test_a_new_chat_goes_on_with_the_task_its_line_names(self):
        old = mcp_task_tools.begin_task({"client": "A", "session": "chat1"}, "雪夜的街道")["task"]
        ai_tasks.begin_task("A", "别的事", new_task=True, session="chat1")  # the first chat moved on: the old task ended
        self.assertTrue(ai_tasks.get_task(old)["ended"])
        waiting = ai_tasks.start_task("等着的")["id"]
        again = mcp_task_tools.begin_task({"client": "A", "session": "chat2"}, "接着做", task=old)
        self.assertEqual(again["task"], old, "the id in the line, not the waiting task or a new one")
        self.assertIsNone(ai_tasks.get_task(old)["ended"], "it opens again")
        self.assertTrue(ai_tasks.get_task(waiting)["waiting"], "the waiting task still waits for its own AI")

    def test_removing_a_task_leaves_no_gap_in_the_line(self):
        one = ai_tasks.begin_task("A", "一")["id"]
        two = ai_tasks.start_task("二", from_task=one)["id"]
        ai_tasks.begin_task("B", "二")  # taken by an AI: a new waiting task would replace it
        three = ai_tasks.start_task("三", from_task=two)["id"]
        self.assertTrue(ai_task_links.remove(two))
        self.assertEqual(ai_tasks.get_task(three)["from"], one, "the line goes on past the removed task")
        self.assertTrue(ai_task_links.remove(one))
        self.assertNotIn("from", ai_tasks.get_task(three), "the first of a line leaves none to go on from")
        self.assertFalse(ai_task_links.remove("gone"))


if __name__ == "__main__":
    unittest.main()
