"""Civitai answers its API on civitai.com and civitai.red; some networks reach only the second."""
import io
import sys
import unittest
import urllib.error
import urllib.parse
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

import civitai_client
from api import download_sources


class _Answer(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _network(asked, blocked=("civitai.com",), body=b'{"id": 7}'):
    """An urlopen where the `blocked` hosts time out and the others answer `body`."""
    def opened(request, timeout):
        host = urllib.parse.urlsplit(request.full_url).hostname
        asked.append(host)
        if host in blocked:
            raise urllib.error.URLError(TimeoutError("timed out"))
        return _Answer(body)
    return opened


class CivitaiHostsTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(civitai_client, "_answered", ["civitai.com"])
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_the_scan_asks_civitai_red_when_civitai_com_does_not_answer(self):
        asked = []
        with mock.patch.object(civitai_client, "urlopen", side_effect=_network(asked)):
            self.assertEqual(civitai_client.fetch_civitai_info("ab" * 32), {"id": 7})
            self.assertEqual(civitai_client.fetch_civitai_info("cd" * 32), {"id": 7})
        self.assertEqual(asked, ["civitai.com", "civitai.red", "civitai.red"])  # then the one that answered first

    def test_an_answer_from_civitai_com_is_not_asked_again_elsewhere(self):
        asked = []
        missing = urllib.error.HTTPError("https://civitai.com/x", 404, "x", {}, io.BytesIO(b""))
        def opened(request, timeout):
            asked.append(urllib.parse.urlsplit(request.full_url).hostname)
            raise missing
        with mock.patch.object(civitai_client, "urlopen", side_effect=opened):
            self.assertIsNone(civitai_client.fetch_civitai_info("ab" * 32))
        self.assertEqual(asked, ["civitai.com"])

    def test_neither_answering_is_unreachable(self):
        asked = []
        with mock.patch.object(civitai_client, "urlopen", side_effect=_network(asked, ("civitai.com", "civitai.red"))), \
                mock.patch.object(civitai_client.time, "sleep"):
            with self.assertRaises(civitai_client.CivitaiUnreachable) as raised:
                civitai_client.fetch_civitai_info("ab" * 32, max_retries=2)
        self.assertEqual(raised.exception.args[0], "timeout")
        self.assertEqual(asked, ["civitai.com", "civitai.red"] * 2)

    def test_import_and_model_check_ask_civitai_red_too(self):
        asked = []
        with mock.patch.object(download_sources, "urlopen", side_effect=_network(asked, body=b'{"files": []}')):
            self.assertIsNone(download_sources.civitai_by_hash("ab" * 32))  # answered, no such file
        self.assertEqual(asked, ["civitai.com", "civitai.red"])
        self.assertEqual(civitai_client.api_hosts()[0], "civitai.red")
        with mock.patch.object(download_sources, "urlopen", side_effect=_network([], ("civitai.com", "civitai.red"))):
            with self.assertRaises(download_sources.SourceUnreachable):
                download_sources.civitai_by_hash("ab" * 32)


if __name__ == "__main__":
    unittest.main()
