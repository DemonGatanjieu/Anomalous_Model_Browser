"""Prompt translation (api/translation_routes.py): how DeepL is asked with the user's key, and
that a DeepL failure still gets a translation from another provider and says why. No request
leaves this computer: the network calls are replaced."""
import asyncio
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]

from api import backup, translation_routes  # noqa: E402


class FakeRequest:
    def __init__(self, body):
        self.body = body

    async def json(self):
        return self.body


def answer(response):
    return json.loads(response.body.decode("utf-8"))


class DeepLTests(unittest.TestCase):
    def test_the_key_goes_in_the_header_and_a_free_key_to_the_free_host(self):
        sent = []

        def urlopen(request, timeout):
            sent.append(request)
            return io.BytesIO(json.dumps({"translations": [{"text": "一个女孩"}]}).encode("utf-8"))

        with mock.patch.object(translation_routes.urllib.request, "urlopen", urlopen):
            self.assertEqual(translation_routes._translate_with_deepl("a girl", "zh-CN", "abc:fx"), "一个女孩")
            translation_routes._translate_with_deepl("a girl", "en", "abc")
        free, pro = sent
        self.assertEqual(free.full_url, "https://api-free.deepl.com/v2/translate")
        self.assertEqual(pro.full_url, "https://api.deepl.com/v2/translate")
        self.assertEqual(free.get_header("Authorization"), "DeepL-Auth-Key abc:fx")
        self.assertEqual(json.loads(free.data), {"text": ["a girl"], "target_lang": "ZH-HANS"})
        self.assertNotIn(b"auth_key", free.data)  # DeepL no longer takes the key as a parameter
        self.assertEqual(json.loads(pro.data)["target_lang"], "EN-US")

    def test_a_refused_key_and_a_used_up_month_are_told_apart(self):
        def http(code):
            return urllib.error.HTTPError("https://api-free.deepl.com", code, "", {}, None)

        self.assertEqual(translation_routes._deepl_error(http(403)), "bad_key")
        self.assertEqual(translation_routes._deepl_error(http(456)), "quota")
        self.assertEqual(translation_routes._deepl_error(http(500)), "HTTP 500")

    def test_when_deepl_fails_google_translates_and_the_reason_is_given(self):
        def refused(text, tl, key):
            raise urllib.error.HTTPError("https://api-free.deepl.com", 403, "", {}, None)

        with mock.patch.object(translation_routes, "_deepl_key", return_value="bad:fx"), \
                mock.patch.object(translation_routes, "_translate_with_deepl", refused), \
                mock.patch.object(translation_routes, "_translate_with_google", return_value="一个女孩"):
            data = answer(asyncio.run(translation_routes.api_translate(FakeRequest({"text": "a girl", "target_lang": "zh-CN"}))))
        self.assertEqual(data["engine"], "google")
        self.assertEqual(data["translated"], "一个女孩")
        self.assertEqual(data["deepl_error"], "bad_key")
        self.assertNotIn("error", data)  # a translation came back: the page shows it, not an error

    def test_without_a_key_deepl_is_not_asked(self):
        with mock.patch.object(translation_routes, "_deepl_key", return_value=""), \
                mock.patch.object(translation_routes, "_translate_with_deepl") as deepl, \
                mock.patch.object(translation_routes, "_translate_with_google", return_value="一个女孩"):
            data = answer(asyncio.run(translation_routes.api_translate(FakeRequest({"text": "a girl"}))))
        deepl.assert_not_called()
        self.assertEqual(data["engine"], "google")
        self.assertNotIn("deepl_error", data)

    def test_the_key_never_goes_into_a_backup(self):
        self.assertIn("DEEPL_API_KEY", backup.SECRET_KEYS)


if __name__ == "__main__":
    unittest.main()
