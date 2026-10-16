"""The first-run setup's question: does this computer reach Civitai, and is a set key refused?"""
import io
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import local_guard, network_check


class _Answer(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _http_error(code):
    return urllib.error.HTTPError("https://civitai.com" + network_check.PROBE_PATH, code, "x", {}, io.BytesIO(b""))


class CivitaiCheckTests(unittest.TestCase):
    def check(self, *answers, key=None):
        """The check, with civitai.com answering answers[0] and civitai.red answers[1] (if asked)."""
        headers = {"User-Agent": "t", **({"Authorization": f"Bearer {key}"} if key else {})}
        with mock.patch.object(network_check, "civitai_headers", return_value=headers), \
                mock.patch("civitai_client._answered", ["civitai.com"]), \
                mock.patch.object(network_check.urllib.request, "urlopen", side_effect=list(answers)) as opened:
            result = network_check.check_civitai()
        self.assertEqual(opened.call_args.kwargs["timeout"], network_check.TIMEOUT)
        return result

    def test_reachable_with_and_without_a_key(self):
        self.assertEqual((lambda r: (r["reachable"], r["key"]))(self.check(_Answer(b"{}"))), (True, "none"))
        self.assertEqual((lambda r: (r["reachable"], r["key"]))(self.check(_Answer(b"{}"), key="k")), (True, "set"))

    def test_a_refused_key_is_told_apart_from_no_network(self):
        refused = self.check(_http_error(401), key="bad")
        self.assertEqual((refused["reachable"], refused["key"]), (True, "refused"))
        down = self.check(urllib.error.URLError("timed out"), urllib.error.URLError("refused"))
        self.assertEqual((down["reachable"], down["key"], down["host"]), (False, "none", ""))
        self.assertIn("timed out", down["error"])  # why civitai.com, the usual address, failed
        self.assertFalse(self.check(_http_error(503))["reachable"])

    def test_civitai_red_answering_is_reachable_and_named(self):
        # Some networks (a cloud server in mainland China) reach only Civitai's other address.
        result = self.check(urllib.error.URLError("timed out"), _Answer(b"{}"))
        self.assertEqual((result["reachable"], result["host"]), (True, "civitai.red"))
        self.assertEqual(self.check(_Answer(b"{}"))["host"], "civitai.com")

    def test_it_answers_this_computer_only(self):
        self.assertIn("/anomalous/civitai_check", local_guard.LOCAL_GETS)


if __name__ == "__main__":
    unittest.main()
