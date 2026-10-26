"""Argument correction must agree with gate approval and the workbench's receipt."""
import unittest
from contextlib import ExitStack
from unittest import mock

from test_ai_tasks import isolate
from test_mcp import rpc
from api import ai_gates, ai_tasks, mcp_server


class ArgumentReceiptTests(unittest.TestCase):
    def setUp(self):
        isolate()
        self.run = mock.Mock(return_value={"changed": True})
        patches = ExitStack()
        self.addCleanup(patches.close)
        tool = {**mcp_server.TOOLS["set_model"], "run": self.run}
        patches.enter_context(mock.patch.dict(mcp_server.TOOLS, {"set_model": tool}))
        patches.enter_context(mock.patch.object(mcp_server.ai_outside, "check", return_value=None))
        self.policies = patches.enter_context(mock.patch.object(ai_gates, "policies", return_value={**ai_gates.DEFAULTS, "canvas": "auto"}))

    def call(self, args):
        return rpc("tools/call", {"name": "set_model", "arguments": {"node_id": 1, **args}}, "set_model")["result"]

    def test_corrected_model_is_present_in_task_receipt(self):
        result = self.call({"model": "checkpoints:0:sample.safetensors"})
        self.assertFalse(result["isError"], result)
        self.assertIn("Took model as model_id", result["structuredContent"]["arguments_note"])
        task = ai_tasks.get_task(ai_tasks.list_tasks()[0]["id"])
        self.assertIn({"type": "model", "model_id": "checkpoints:0:sample.safetensors"}, task["steps"][-1]["results"])

    def test_corrected_retry_uses_the_existing_approval(self):
        self.policies.return_value = {**ai_gates.DEFAULTS, "canvas": "ask"}
        with mock.patch.object(ai_gates, "WAIT_SECONDS", 0):
            first = self.call({"model": "checkpoints:0:sample.safetensors"})
            self.assertTrue(first["structuredContent"]["waiting_for_user"])
            task = ai_tasks.get_task(ai_tasks.list_tasks()[0]["id"])
            step = task["steps"][-1]
            ai_gates.decide(task["id"], step["id"], "allow")
            second = self.call({"model_id": "checkpoints:0:sample.safetensors"})
        self.assertFalse(second.get("structuredContent", {}).get("waiting_for_user"))
        self.run.assert_called_once()
        self.assertIn("model_id", [line["label"] for line in step["gate"]["lines"]])
