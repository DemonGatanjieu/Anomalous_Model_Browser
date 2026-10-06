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
from model_identity import computed_file_identity


class FileIdentityTests(unittest.TestCase):
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
