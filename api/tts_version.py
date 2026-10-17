"""Version and updates of the companion node pack Anomalous_TTS (GPT-SoVITS Settings).

Only a git checkout of the official repository is touched, found among the
custom_nodes folders by its node class and checked by its `origin` remote. The
rules are those of the plugin's own version panel (api/version_manager.py):
published releases are fetched only when asked, a switch checks out a
published release tag, refuses over modified tracked files and can be undone.
"""

import asyncio
import os

from aiohttp import web

import folder_paths

from . import version_manager as vm

OFFICIAL = ("demongatanjieu", "anomalous_tts")
NODE_CLASS = "AnomalousTTS_CharacterSpeech"
STATE_FILE = os.path.join(vm.PLUGIN_DIR, ".anomalous_tts_version.local.json")
READ_LIMIT = 200_000


def _node_folders():
    """custom_nodes folders whose nodes.py defines the Anomalous_TTS node (disabled ones left out)."""
    for base in folder_paths.get_folder_paths("custom_nodes"):
        try:
            names = sorted(os.listdir(base))
        except OSError:
            continue
        for name in names:
            folder = os.path.join(base, name)
            if name.endswith(".disabled") or not os.path.exists(os.path.join(folder, ".git")):
                continue
            try:
                with open(os.path.join(folder, "nodes.py"), encoding="utf-8", errors="replace") as handle:
                    if NODE_CLASS in handle.read(READ_LIMIT):
                        yield folder
            except OSError:
                continue


def find_checkout():
    """The installed Anomalous_TTS as a version_manager.Checkout, or None (not installed, not a git
    clone, or cloned from somewhere else)."""
    for folder in _node_folders():
        repo = vm.Checkout(folder, STATE_FILE)
        owner_repo = vm._github_repo(vm._git_out("remote", "get-url", "origin", repo=repo))
        if owner_repo and tuple(part.lower() for part in owner_repo) == OFFICIAL:
            return repo
    return None


def _checkout():
    repo = find_checkout()
    if repo is None:
        raise vm.VersionError("tts_missing", "Anomalous_TTS is not installed as a git clone of its GitHub repository")
    return repo


def state():
    repo = find_checkout()
    return {"found": False} if repo is None else {"found": True, "state": vm.current_state(repo)}


async def api_get_state(request):
    """GET /anomalous/tts_version - Installed Anomalous_TTS version (local, no network)."""
    try:
        return web.json_response({"success": True, **(await asyncio.to_thread(state))})
    except vm.VersionError as error:
        return vm.error_response(error)


async def api_get_releases(request):
    """GET /anomalous/tts_version/releases?refresh=1 - Its published releases (network, only when asked)."""
    refresh = request.query.get("refresh") == "1"
    return await vm.run(lambda: vm.list_releases(refresh, _checkout()))


async def api_update(request):
    """POST /anomalous/tts_version/update {tag} - Check out a published release."""
    tag = str((await vm.json_body(request)).get("tag", ""))
    return await vm.run(lambda: vm.switch_to(tag, _checkout()))


async def api_undo(request):
    """POST /anomalous/tts_version/undo - Back to where the last update came from."""
    return await vm.run(lambda: vm.undo_last_switch(_checkout()))


def register_routes(app):
    app.router.add_get('/anomalous/tts_version', api_get_state)
    app.router.add_get('/anomalous/tts_version/releases', api_get_releases)
    app.router.add_post('/anomalous/tts_version/update', api_update)
    app.router.add_post('/anomalous/tts_version/undo', api_undo)
