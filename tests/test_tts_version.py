"""Anomalous_TTS updates: only a git clone of the official repository is found, and switching it
uses its own folder and state file, never the plugin's."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import tts_version, version_manager as vm

NODES = 'NODE_CLASS_MAPPINGS = {"AnomalousTTS_CharacterSpeech": object}\n'


def git(cwd, *args):
    return subprocess.run(['git', '-C', str(cwd), *args], check=True, capture_output=True, text=True).stdout.strip()


def commit(repo, name, content, message):
    Path(repo, name).write_text(content, encoding='utf-8')
    git(repo, 'add', name)
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message)


class TtsVersionTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.nodes = self.root / 'custom_nodes'
        self.nodes.mkdir()
        paths = mock.patch.object(tts_version.folder_paths, 'get_folder_paths', lambda name: [str(self.nodes)])
        paths.start()
        self.addCleanup(paths.stop)
        state = mock.patch.object(tts_version, 'STATE_FILE', str(self.root / 'tts_state.json'))
        state.start()
        self.addCleanup(state.stop)

    def tearDown(self):
        self._tmp.cleanup()

    def clone(self, name, remote, nodes=NODES):
        folder = self.nodes / name
        folder.mkdir()
        git(folder, 'init', '-q', '-b', 'main')
        commit(folder, 'nodes.py', nodes, 'one')
        git(folder, 'remote', 'add', 'origin', remote)
        return folder

    def test_only_the_official_clone_is_found(self):
        self.assertIsNone(tts_version.find_checkout())
        self.clone('A_fork', 'https://github.com/someone/Anomalous_TTS.git')
        self.clone('Other_pack', 'https://github.com/DemonGatanjieu/Anomalous_TTS', nodes='NODE_CLASS_MAPPINGS = {}\n')
        (self.nodes / 'Plain_copy').mkdir()
        Path(self.nodes / 'Plain_copy' / 'nodes.py').write_text(NODES, encoding='utf-8')  # no git: Manager's zip, a copy
        self.assertIsNone(tts_version.find_checkout())
        self.assertEqual(tts_version.state(), {'found': False})

        folder = self.clone('Anomalous_TTS', 'https://github.com/DemonGatanjieu/Anomalous_TTS.git')
        repo = tts_version.find_checkout()
        self.assertEqual(Path(repo.root), folder)
        found = tts_version.state()
        self.assertTrue(found['found'])
        self.assertEqual(found['state']['branch'], 'main')

    def test_switching_acts_on_the_node_pack_only(self):
        upstream = self.root / 'upstream'
        upstream.mkdir()
        git(upstream, 'init', '-q', '-b', 'main')
        commit(upstream, 'nodes.py', NODES, 'one')
        git(upstream, 'tag', 'v1.0.0')
        commit(upstream, 'nodes.py', NODES + '# two\n', 'two')
        git(upstream, 'tag', 'v1.1.0')
        folder = self.nodes / 'Anomalous_TTS'
        git(self.root, 'clone', '-q', str(upstream), str(folder))
        repo = vm.Checkout(str(folder), tts_version.STATE_FILE)
        plugin_head = git(PLUGIN, 'rev-parse', 'HEAD')
        git(folder, 'tag', '-d', 'v1.1.0')  # cloned before the release, updated by a pull: no local tag
        with mock.patch.object(vm, '_fetch_github_releases', side_effect=OSError('offline')):
            listing = vm.list_releases(True, repo)
            self.assertEqual((listing['latest'], listing['state']['tag']), ('v1.1.0', 'v1.1.0'))
            vm.switch_to('v1.0.0', repo)
            self.assertEqual(vm.current_state(repo)['tag'], 'v1.0.0')
            self.assertEqual(vm.current_state(repo)['previous']['branch'], 'main')
            self.assertTrue(Path(tts_version.STATE_FILE).is_file())
            vm.undo_last_switch(repo)
            self.assertEqual(vm.current_state(repo)['branch'], 'main')
        self.assertEqual(git(PLUGIN, 'rev-parse', 'HEAD'), plugin_head)


if __name__ == '__main__':
    unittest.main()
