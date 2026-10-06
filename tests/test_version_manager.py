from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PLUGIN), str(PLUGIN.parents[1])]
from api import version_manager as vm


def git(cwd, *args):
    return subprocess.run(['git', '-C', str(cwd), *args], check=True, capture_output=True, text=True).stdout.strip()


def commit(repo, name, content, message):
    Path(repo, name).parent.mkdir(parents=True, exist_ok=True)
    Path(repo, name).write_text(content, encoding='utf-8')
    git(repo, 'add', name)
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message)


class VersionManagerTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.upstream = root / 'upstream'
        self.upstream.mkdir()
        git(self.upstream, 'init', '-q', '-b', 'main')
        commit(self.upstream, 'app.txt', 'one', 'one')
        git(self.upstream, 'tag', 'v1.0.0')
        commit(self.upstream, 'app.txt', 'two', 'two')
        git(self.upstream, 'tag', 'v1.55-beta')
        commit(self.upstream, 'api/version_manager.py', '# panel', 'add panel')
        git(self.upstream, 'tag', 'v1.58.0')
        self.plugin = root / 'plugin'
        git(root, 'clone', '-q', str(self.upstream), str(self.plugin))
        for name, value in (('PLUGIN_DIR', str(self.plugin)), ('STATE_FILE', str(self.plugin / '.anomalous_version.local.json'))):
            patcher = mock.patch.object(vm, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        github = mock.patch.object(vm, '_fetch_github_releases', side_effect=OSError('offline'))
        github.start()
        self.addCleanup(github.stop)
        vm._releases_cache.update(expires=0, data=None)

    def tearDown(self):
        self._tmp.cleanup()

    def head(self):
        return git(self.plugin, 'rev-parse', 'HEAD')

    def test_version_keys_order_mixed_tag_styles(self):
        tags = ['v1.5.0', 'v1.57-beta', 'v1.4.3', 'v1.58.0', 'v1.58.0-rc1', 'v1.55-beta']
        self.assertEqual(sorted(tags, key=vm.version_key, reverse=True),
                         ['v1.58.0', 'v1.58.0-rc1', 'v1.57-beta', 'v1.55-beta', 'v1.5.0', 'v1.4.3'])

    def test_state_and_release_list_from_git_fallback(self):
        state = vm.current_state()
        self.assertEqual((state['branch'], state['tag'], state['dirty']), ('main', 'v1.58.0', False))
        listing = vm.list_releases()
        self.assertEqual(listing['source'], 'git')
        self.assertEqual([r['tag'] for r in listing['releases']], ['v1.58.0', 'v1.55-beta', 'v1.0.0'])
        self.assertEqual(listing['latest'], 'v1.58.0')
        self.assertEqual([r['direction'] for r in listing['releases']], ['same', 'older', 'older'])

    def test_github_prereleases_are_listed_but_never_latest(self):
        releases = [
            {'tag': 'v1.59.0-rc1', 'name': 'rc', 'published_at': '2026-10-02', 'prerelease': True, 'notes': '', 'url': None},
            {'tag': 'v1.58.0', 'name': 'stable', 'published_at': '2026-10-01', 'prerelease': False, 'notes': 'n', 'url': None},
        ]
        with mock.patch.object(vm, '_fetch_github_releases', return_value=releases), \
                mock.patch.object(vm, '_github_repo', return_value=('owner', 'repo')):
            listing = vm.list_releases(force=True)
        self.assertEqual(listing['source'], 'github')
        self.assertEqual(listing['latest'], 'v1.58.0')
        self.assertEqual(listing['releases'][0]['direction'], 'newer')

    def test_rollback_preview_switch_undo_and_return_to_latest(self):
        start = self.head()
        preview = vm.preview_switch('v1.55-beta')
        self.assertEqual((preview['direction'], preview['has_switcher']), ('older', False))
        self.assertEqual(self.head(), start, 'preview changes nothing')
        self.assertTrue(vm.preview_switch('v1.58.0')['has_switcher'])

        vm.switch_to('v1.55-beta')
        state = vm.current_state()
        self.assertEqual((state['tag'], state['branch']), ('v1.55-beta', None))
        self.assertEqual(Path(self.plugin, 'app.txt').read_text(), 'two')
        self.assertEqual(state['previous']['branch'], 'main')

        vm.undo_last_switch()
        self.assertEqual((vm.current_state()['branch'], self.head()), ('main', start))

        vm.switch_to('v1.0.0')
        commit(self.upstream, 'app.txt', 'three', 'three')  # main moves on after the rollback
        vm.return_to_latest()
        state = vm.current_state()
        self.assertEqual(state['branch'], 'main')
        self.assertEqual(Path(self.plugin, 'app.txt').read_text(), 'three')
        self.assertEqual(state['previous']['label'], 'v1.0.0')

    def test_local_changes_block_every_switch(self):
        start = self.head()
        Path(self.plugin, 'app.txt').write_text('edited', encoding='utf-8')
        for action in (lambda: vm.switch_to('v1.0.0'), vm.return_to_latest, lambda: vm.preview_switch('v1.0.0')):
            with self.assertRaises(vm.VersionError) as caught:
                action()
            self.assertEqual(caught.exception.code, 'dirty')
            self.assertIn('app.txt', caught.exception.details['files'])
        self.assertEqual(self.head(), start)
        self.assertEqual(Path(self.plugin, 'app.txt').read_text(), 'edited')

    def test_untracked_files_do_not_block(self):
        Path(self.plugin, 'notes.local.json').write_text('{}', encoding='utf-8')
        vm.switch_to('v1.0.0')
        self.assertEqual(vm.current_state()['tag'], 'v1.0.0')
        self.assertTrue(Path(self.plugin, 'notes.local.json').exists())

    def test_only_published_tags_can_be_checked_out(self):
        for tag, code in (('main', 'unknown_tag'), ('HEAD~1', 'bad_tag'), ('--help', 'bad_tag'), ('v9.9.9', 'unknown_tag')):
            with self.assertRaises(vm.VersionError) as caught:
                vm.switch_to(tag)
            self.assertEqual(caught.exception.code, code, tag)

    def test_diverged_local_branch_is_not_overwritten(self):
        commit(self.plugin, 'local.txt', 'mine', 'local work')
        mine = self.head()
        commit(self.upstream, 'app.txt', 'three', 'three')
        with self.assertRaises(vm.VersionError) as caught:
            vm.return_to_latest()
        self.assertEqual(caught.exception.code, 'diverged')
        self.assertEqual(self.head(), mine)

    def test_undo_without_history(self):
        with self.assertRaises(vm.VersionError) as caught:
            vm.undo_last_switch()
        self.assertEqual(caught.exception.code, 'no_previous')

    def test_not_a_git_checkout(self):
        with tempfile.TemporaryDirectory() as plain, mock.patch.object(vm, 'PLUGIN_DIR', plain):
            self.assertEqual(vm.current_state(), {'is_git': False})


if __name__ == '__main__':
    unittest.main()
