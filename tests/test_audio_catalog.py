import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import audio_catalog


class _Request:
    def __init__(self, form=None, body=None, query=None):
        self._form = form or {}
        self._body = body
        self.query = query or {}

    async def post(self):
        return self._form

    async def json(self):
        return self._body


def _run(coro):
    return asyncio.run(coro)


def _body(response):
    return json.loads(response.body.decode('utf-8'))


def _vorbis_block(tags):
    vendor = b'test'
    body = len(vendor).to_bytes(4, 'little') + vendor + len(tags).to_bytes(4, 'little')
    for key, value in tags.items():
        entry = f'{key}={value}'.encode('utf-8')
        body += len(entry).to_bytes(4, 'little') + entry
    return body


def _write_flac(path, tags):
    streaminfo = b'\x00' + (34).to_bytes(3, 'big') + b'\x00' * 34
    comment = _vorbis_block(tags)
    block = bytes([0x80 | 4]) + len(comment).to_bytes(3, 'big') + comment
    Path(path).write_bytes(b'fLaC' + streaminfo + block + b'\xff\xf8audio')


def _ogg_page(packet):
    lacing = [255] * (len(packet) // 255) + [len(packet) % 255]
    return b'OggS' + b'\x00' * 22 + bytes([len(lacing)]) + bytes(lacing) + packet


def _write_opus(path, tags):
    Path(path).write_bytes(_ogg_page(b'OpusHead' + b'\x01' * 11) + _ogg_page(b'OpusTags' + _vorbis_block(tags)))


PROMPT = json.dumps({
    '14': {'class_type': 'PreviewAudio', 'inputs': {'audio': ['16', 0]}},
    '16': {'class_type': 'F5TTSAudio', 'inputs': {'sample': 'F5-TTS\\Arona.wav', 'speech': '{happy} 早上好！\n{main} 开始吧。', 'seed': 7}},
}, ensure_ascii=False)


class AudioGalleryTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.output_dir = root / 'output'
        self.temp_dir = root / 'temp'
        self.output_dir.mkdir()
        self.temp_dir.mkdir()
        for name, target in (('get_output_directory', self.output_dir), ('get_temp_directory', self.temp_dir), ('get_input_directory', root / 'input')):
            patcher = mock.patch.object(audio_catalog.folder_paths, name, return_value=str(target))
            patcher.start()
            self.addCleanup(patcher.stop)
        audio_catalog._info_cache.clear()

    def tearDown(self):
        self._tmp.cleanup()

    def test_generation_info_is_read_from_flac_and_opus_comments(self):
        (self.output_dir / 'audio').mkdir()
        _write_flac(self.output_dir / 'audio' / 'a.flac', {'prompt': PROMPT, 'workflow': '{}'})
        _write_opus(self.output_dir / 'b.opus', {'PROMPT': PROMPT})
        (self.output_dir / 'c.mp3').write_bytes(b'ID3')
        body = _body(_run(audio_catalog.api_get_audio_gallery(_Request(query={}))))
        by_name = {item['filename']: item for item in body['audios']}
        self.assertEqual(set(by_name), {'a.flac', 'b.opus', 'c.mp3'})
        for name in ('a.flac', 'b.opus'):
            info = by_name[name]['generation']
            self.assertEqual(info['speech'], '{happy} 早上好！\n{main} 开始吧。')
            self.assertEqual(info['sample'], 'F5-TTS/Arona.wav')
            self.assertEqual(info['seed'], 7)
        self.assertIsNone(by_name['c.mp3']['generation'])

    def test_gallery_search_matches_speech_text_and_file_names(self):
        _write_flac(self.output_dir / 'first.flac', {'prompt': PROMPT})
        (self.output_dir / 'second.wav').write_bytes(b'RIFF')
        hits = _body(_run(audio_catalog.api_get_audio_gallery(_Request(query={'q': '开始吧'}))))
        self.assertEqual([item['filename'] for item in hits['audios']], ['first.flac'])
        self.assertEqual(hits['total'], 1)
        by_name = _body(_run(audio_catalog.api_get_audio_gallery(_Request(query={'q': 'SECOND'}))))
        self.assertEqual([item['filename'] for item in by_name['audios']], ['second.wav'])

    def test_previews_list_temp_audio_and_save_copies_without_overwriting(self):
        _write_flac(self.temp_dir / 'ComfyUI_temp_abcde_00001.flac', {'prompt': PROMPT})
        (self.temp_dir / 'note.txt').write_text('x')
        previews = _body(_run(audio_catalog.api_get_audio_previews(_Request())))['audios']
        self.assertEqual([p['filename'] for p in previews], ['ComfyUI_temp_abcde_00001.flac'])
        self.assertIn('type=temp', previews[0]['audio_url'])
        self.assertEqual(previews[0]['generation']['seed'], 7)

        request = {'filename': 'ComfyUI_temp_abcde_00001.flac', 'subfolder': ''}
        first = _body(_run(audio_catalog.api_save_audio_preview(_Request(body=request))))
        second = _body(_run(audio_catalog.api_save_audio_preview(_Request(body=request))))
        self.assertNotEqual(first['audio']['filename'], second['audio']['filename'])
        saved = sorted(p.name for p in (self.output_dir / 'audio').iterdir())
        self.assertEqual(len(saved), 2)
        self.assertEqual(first['audio']['generation']['speech'], '{happy} 早上好！\n{main} 开始吧。')
        self.assertTrue((self.temp_dir / 'ComfyUI_temp_abcde_00001.flac').exists(), 'the preview itself is untouched')

    def test_preview_save_rejects_escape_and_non_audio(self):
        (self.temp_dir / 'note.txt').write_text('x')
        escape = _run(audio_catalog.api_save_audio_preview(_Request(body={'filename': 'x.flac', 'subfolder': '../output'})))
        self.assertEqual(escape.status, 403)
        text = _run(audio_catalog.api_save_audio_preview(_Request(body={'filename': 'note.txt', 'subfolder': ''})))
        self.assertEqual(text.status, 403)
        missing = _run(audio_catalog.api_save_audio_preview(_Request(body={'filename': 'gone.flac', 'subfolder': ''})))
        self.assertEqual(missing.status, 404)
        self.assertFalse((self.output_dir / 'audio').exists() and any((self.output_dir / 'audio').iterdir()))

    def test_gallery_delete_only_removes_audio_inside_output(self):
        (self.output_dir / 'image.png').write_bytes(b'png')
        (self.output_dir / 'take.wav').write_bytes(b'wav')
        refused = _run(audio_catalog.api_delete_audio_gallery(_Request(body={'filename': 'image.png', 'subfolder': ''})))
        self.assertEqual(refused.status, 415)
        self.assertTrue((self.output_dir / 'image.png').exists())
        escape = _run(audio_catalog.api_delete_audio_gallery(_Request(body={'filename': 'x.wav', 'subfolder': '../input'})))
        self.assertEqual(escape.status, 403)
        sent = []
        with mock.patch.object(audio_catalog, 'move_to_trash', side_effect=lambda *paths: sent.extend(paths)):
            ok = _run(audio_catalog.api_delete_audio_gallery(_Request(body={'filename': 'take.wav', 'subfolder': ''})))
        self.assertEqual(ok.status, 200)
        self.assertEqual([os.path.basename(path) for path in sent], ['take.wav'])  # to the Recycle Bin

    def test_gallery_rejects_bad_paging_values(self):
        response = _run(audio_catalog.api_get_audio_gallery(_Request(query={'page': 'x', 'limit': '-3'})))
        body = _body(response)
        self.assertEqual((body['page'], body['total']), (1, 0))

    def test_stream_accepts_temp_and_rejects_unknown_roots(self):
        _write_flac(self.temp_dir / 'p.flac', {})
        ok = _run(audio_catalog.api_serve_audio(_Request(query={'path': 'p.flac', 'type': 'temp'})))
        self.assertEqual(ok.status, 200)
        for root in ('models', 'input'):
            bad = _run(audio_catalog.api_serve_audio(_Request(query={'path': 'p.flac', 'type': root})))
            self.assertEqual(bad.status, 400, root)


if __name__ == '__main__':
    unittest.main()
