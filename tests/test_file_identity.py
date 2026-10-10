import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import metadata, models, recipes
from model_identity import computed_file_identity, safetensors_damage


def safetensors_bytes(tensors, payload=b'\0' * 16, header_size=None):
    header = json.dumps({'__metadata__': {'x': 'y'}, **tensors}).encode()
    return struct.pack('<Q', len(header) if header_size is None else header_size) + header + payload


class FileIdentityTests(unittest.TestCase):
    def test_damaged_headers_are_told_apart_from_whole_files(self):
        tensor = lambda end: {'w': {'dtype': 'F32', 'shape': [4], 'data_offsets': [0, end]}}
        cases = {
            'whole': (safetensors_bytes(tensor(16)), ''),
            'short': (b'abc', 'short'),
            'header longer than the file': (safetensors_bytes(tensor(16), header_size=10 ** 6), 'header_size'),
            'not json': (struct.pack('<Q', 4) + b'{{{{' + b'\0' * 8, 'header'),
            'offsets not numbers': (safetensors_bytes({'w': {'data_offsets': ['a', 'b']}}), 'header'),
            'cut short': (safetensors_bytes(tensor(64)), 'truncated'),
        }
        with tempfile.TemporaryDirectory() as directory:
            for name, (content, expected) in cases.items():
                with self.subTest(name):
                    path = Path(directory, 'm.safetensors')
                    path.write_bytes(content)
                    self.assertEqual(safetensors_damage(str(path)), expected)
            self.assertEqual(safetensors_damage(str(Path(directory, 'missing.safetensors'))), '')

    def test_header_digests_are_not_file_identity(self):
        for key in ('modelspec.hash.blake3', 'modelspec.hash.sha256', 'modelspec.hash_sha256'):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                path = Path(directory, 'fixture.safetensors')
                header = json.dumps({'__metadata__': {key: 'a' * 64}}).encode()
                path.write_bytes(struct.pack('<Q', len(header)) + header + b'payload')
                self.assertFalse(metadata.get_metadata(str(path))['hash'])
                with mock.patch.object(recipes, '_resolve_exact_model_reference', return_value={'path': str(path)}):
                    identity, _ = recipes._identity_for_reference(path.name)
                self.assertEqual(identity['status'], 'unverified')
                result = models._resolve_from_candidates([{'type': 'vae', 'filename': path.name, 'path': str(path), 'size': path.stat().st_size}], 'a' * 64, path.stat().st_size, require_hash=True)
                self.assertFalse(result['found'])

    def test_legacy_offline_hash_requires_reverification_and_keeps_notes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'fixture.safetensors')
            path.write_bytes(b'payload')
            info = path.with_suffix('.info')
            info.write_text(json.dumps({'id': -1, 'anomalous_custom_notes': 'Keep me', 'files': [{'hashes': {'SHA256': 'a' * 64}}]}))
            self.assertFalse(metadata.get_metadata(str(path))['hash'])
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            models._compute_and_save_fallback_info(str(path), digest)
            self.assertEqual(metadata.get_metadata(str(path))['hash'], digest)
            self.assertEqual(json.loads(info.read_text())['anomalous_custom_notes'], 'Keep me')

    def test_computed_record_invalidated_after_file_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'fixture.safetensors')
            path.write_bytes(b'payload')
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            path.with_suffix('.info').write_text(json.dumps({'anomalous_file_identity': computed_file_identity(path, digest)}))
            self.assertEqual(metadata.get_metadata(str(path))['hash'], digest)
            path.write_bytes(b'changed payload')
            self.assertFalse(metadata.get_metadata(str(path))['hash'])

    def test_offline_scan_persists_full_file_sha256(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'fixture.safetensors')
            header = json.dumps({'__metadata__': {'modelspec.hash.blake3': 'a' * 64}}).encode()
            path.write_bytes(struct.pack('<Q', len(header)) + header + b'payload')
            result = subprocess.run([sys.executable, str(PLUGIN / 'scraper.py'), directory, '--offline-only', '--skip-media', '--skip-rename'], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(metadata.get_metadata(str(path))['hash'], hashlib.sha256(path.read_bytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
