"""Plugin version display, published-release listing and version switching.

The plugin is normally installed as a git clone (ComfyUI Manager), so the
installed version is read from git and switching checks out a published
release tag. Nothing runs automatically: every network call starts from a
button in the UI. Switching refuses when tracked files have local changes, and
only tags that are published releases (or at least exist on the remote) can be
checked out.
"""

import asyncio
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.request

from aiohttp import web

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_FILE = os.path.join(PLUGIN_DIR, ".anomalous_version.local.json")
# A version whose tree contains this file has the version panel; older ones do not.
SWITCHER_MARKER = "api/version_manager.py"
TAG_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]{0,99}$")
GITHUB_REMOTE = re.compile(r"github\.com[:/]+([^/]+)/([^/]+?)(?:\.git)?/?$", re.IGNORECASE)
RELEASES_CACHE_SECONDS = 300
NETWORK_TIMEOUT = 10
FETCH_TIMEOUT = 180

_lock = threading.Lock()
_releases_cache = {"expires": 0, "data": None}


class VersionError(Exception):
    """A user-facing failure with a stable code for the UI."""

    def __init__(self, code, message="", **details):
        super().__init__(message or code)
        self.code = code
        self.details = details


# ---------- git helpers ----------

def _git_executable():
    found = shutil.which("git")
    if not found:
        raise VersionError("git_missing", "git executable not found")
    return found


def _git(*args, timeout=30, check=True):
    kwargs = {}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    try:
        result = subprocess.run(
            [_git_executable(), "-C", PLUGIN_DIR, *args],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, env=env, **kwargs,
        )
    except subprocess.TimeoutExpired:
        raise VersionError("git_timeout", f"git {' '.join(args[:2])} timed out")
    if check and result.returncode != 0:
        raise VersionError("git_failed", (result.stderr or result.stdout).strip()[-500:])
    return result


def _git_out(*args, **kwargs):
    result = _git(*args, check=False, **kwargs)
    return result.stdout.strip() if result.returncode == 0 else ""


def version_key(tag):
    """Sortable key for tags such as v1.4.2, v1.57-beta, v1.58.0-rc1 (stable after pre-release)."""
    match = re.match(r"^v?(\d+(?:\.\d+)*)(.*)$", str(tag or ""))
    if not match:
        return ((), 0, str(tag))
    numbers = tuple(int(part) for part in match.group(1).split("."))
    suffix = match.group(2).lstrip("-_.")
    return (numbers, 1 if not suffix else 0, suffix)


def current_state():
    """Local only (no network): what is installed and whether it can be switched."""
    if not os.path.isdir(os.path.join(PLUGIN_DIR, ".git")) and _git_out("rev-parse", "--is-inside-work-tree") != "true":
        return {"is_git": False}
    commit = _git_out("rev-parse", "HEAD")
    branch = _git_out("symbolic-ref", "--short", "-q", "HEAD") or None
    exact_tag = _git_out("describe", "--tags", "--exact-match", "HEAD") or None
    described = _git_out("describe", "--tags", "--always")
    base_tag = _git_out("describe", "--tags", "--abbrev=0") or None
    # Porcelain lines are "XY path"; keep the leading status column (no strip before slicing).
    status = _git("status", "--porcelain", "--untracked-files=no", check=False).stdout
    changed = [line[3:] for line in status.splitlines() if line.strip()]
    return {
        "is_git": True,
        "commit": commit[:12],
        "branch": branch,
        "tag": exact_tag,
        "base_tag": base_tag,
        "label": exact_tag or described or commit[:12],
        "dirty": bool(changed),
        "changed_files": changed[:20],
        "remote": _git_out("remote", "get-url", "origin") or None,
        "previous": _read_state().get("previous"),
    }


# ---------- releases ----------

def _github_repo(remote_url):
    match = GITHUB_REMOTE.search(remote_url or "")
    return (match.group(1), match.group(2)) if match else None


def _fetch_github_releases(owner, repo):
    url = f"https://api.github.com/repos/{owner}/{repo}/releases?per_page=50"
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "Anomalous-Model-Browser",
    })
    with urllib.request.urlopen(request, timeout=NETWORK_TIMEOUT) as response:
        payload = json.loads(response.read().decode("utf-8"))
    releases = []
    for item in payload if isinstance(payload, list) else []:
        if item.get("draft") or not item.get("tag_name"):
            continue
        releases.append({
            "tag": item["tag_name"],
            "name": item.get("name") or item["tag_name"],
            "published_at": item.get("published_at"),
            "prerelease": bool(item.get("prerelease")),
            "notes": (item.get("body") or "")[:8000],
            "url": item.get("html_url"),
        })
    return releases


def _remote_tags():
    output = _git_out("ls-remote", "--tags", "--refs", "origin", timeout=NETWORK_TIMEOUT * 3)
    tags = [line.split("refs/tags/", 1)[1] for line in output.splitlines() if "refs/tags/" in line]
    return [{"tag": tag, "name": tag, "published_at": None, "prerelease": False, "notes": "", "url": None} for tag in tags]


def list_releases(force=False):
    """Published releases, newest first. GitHub API first, `git ls-remote` (uses git's proxy) as fallback."""
    state = current_state()
    if not state.get("is_git"):
        raise VersionError("not_git", "The plugin is not a git checkout")
    now = time.monotonic()
    if not force and _releases_cache["data"] and now < _releases_cache["expires"]:
        releases, source = _releases_cache["data"]
    else:
        releases, source = None, None
        repo = _github_repo(state.get("remote"))
        if repo:
            try:
                releases, source = _fetch_github_releases(*repo), "github"
            except Exception:
                releases = None
        if releases is None:
            releases, source = _remote_tags(), "git"
            if not releases:
                raise VersionError("offline", "Could not reach GitHub or the git remote")
        releases.sort(key=lambda item: (item["published_at"] or "", version_key(item["tag"])), reverse=True)
        if source == "git":
            releases.sort(key=lambda item: version_key(item["tag"]), reverse=True)
        _releases_cache.update(expires=now + RELEASES_CACHE_SECONDS, data=(releases, source))

    current_key = version_key(state.get("tag") or state.get("base_tag"))
    stable = [item for item in releases if not item["prerelease"]]
    latest = stable[0]["tag"] if stable else None
    result = []
    for item in releases:
        key = version_key(item["tag"])
        entry = dict(item)
        entry["current"] = item["tag"] == state.get("tag")
        entry["latest"] = item["tag"] == latest
        entry["direction"] = "same" if entry["current"] else ("newer" if key > current_key else "older")
        result.append(entry)
    return {"state": state, "releases": result, "latest": latest, "source": source}


# ---------- switching ----------

def _read_state():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_state(data):
    temporary = STATE_FILE + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    os.replace(temporary, STATE_FILE)


def _require_switchable():
    state = current_state()
    if not state.get("is_git"):
        raise VersionError("not_git", "The plugin is not a git checkout")
    if state["dirty"]:
        raise VersionError("dirty", "Tracked files have local changes", files=state["changed_files"])
    return state


def _known_tag(tag):
    if not TAG_NAME.match(str(tag or "")):
        raise VersionError("bad_tag", "Invalid version name")
    tags = {item["tag"] for item in list_releases()["releases"]}
    if tag not in tags:
        raise VersionError("unknown_tag", f"{tag} is not a published version")
    return tag


def _fetch_tag(tag):
    _git("fetch", "--no-tags", "--force", "origin", f"+refs/tags/{tag}:refs/tags/{tag}", timeout=FETCH_TIMEOUT)


def preview_switch(tag):
    """Fetch the target and report what switching would mean, without changing anything."""
    state = _require_switchable()
    _known_tag(tag)
    _fetch_tag(tag)
    has_switcher = _git("cat-file", "-e", f"refs/tags/{tag}:{SWITCHER_MARKER}", check=False).returncode == 0
    target_key = version_key(tag)
    current_key = version_key(state.get("tag") or state.get("base_tag"))
    return {
        "tag": tag,
        "direction": "same" if tag == state.get("tag") else ("newer" if target_key > current_key else "older"),
        "has_switcher": has_switcher,
        "from": state["label"],
        "from_branch": state["branch"],
    }


def switch_to(tag):
    with _lock:
        state = _require_switchable()
        _known_tag(tag)
        _fetch_tag(tag)
        previous = {"commit": _git_out("rev-parse", "HEAD"), "branch": state["branch"], "label": state["label"]}
        _git("-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", f"refs/tags/{tag}")
        _write_state({"previous": previous, "switched_at": time.time()})
        return {"state": current_state(), "restart_required": True}


def _default_branch():
    ref = _git_out("symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    if ref.startswith("origin/"):
        return ref.split("/", 1)[1]
    for name in ("main", "master"):
        if _git("ls-remote", "--exit-code", "--heads", "origin", name, check=False, timeout=NETWORK_TIMEOUT * 3).returncode == 0:
            return name
    raise VersionError("no_default_branch", "Could not determine the default branch")


def return_to_latest():
    """Back to the default branch at its newest commit; the same path ComfyUI Manager's update takes."""
    with _lock:
        state = _require_switchable()
        branch = _default_branch()
        _git("fetch", "--no-tags", "origin", f"+refs/heads/{branch}:refs/remotes/origin/{branch}", timeout=FETCH_TIMEOUT)
        previous = {"commit": _git_out("rev-parse", "HEAD"), "branch": state["branch"], "label": state["label"]}
        if _git("rev-parse", "--verify", "--quiet", f"refs/heads/{branch}", check=False).returncode == 0:
            _git("checkout", "--quiet", branch)
        else:
            _git("checkout", "--quiet", "-b", branch, f"origin/{branch}")
        merge = _git("merge", "--ff-only", "--quiet", f"origin/{branch}", check=False)
        if merge.returncode != 0:
            raise VersionError("diverged", f"Local {branch} has commits that are not on the remote")
        _write_state({"previous": previous, "switched_at": time.time()})
        return {"state": current_state(), "restart_required": True}


def undo_last_switch():
    with _lock:
        previous = _read_state().get("previous")
        if not previous or not previous.get("commit"):
            raise VersionError("no_previous", "There is no switch to undo")
        state = _require_switchable()
        here = {"commit": _git_out("rev-parse", "HEAD"), "branch": state["branch"], "label": state["label"]}
        if previous.get("branch"):
            # Going back to a branch means its current tip, even if it moved since (e.g. a Manager update).
            _git("checkout", "--quiet", previous["branch"])
        else:
            _git("-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", previous["commit"])
        _write_state({"previous": here, "switched_at": time.time()})
        return {"state": current_state(), "restart_required": True}


# ---------- routes ----------

def _error_response(error):
    status = 409 if error.code in {"dirty", "diverged"} else 400
    if error.code in {"offline", "git_timeout", "git_failed"}:
        status = 502
    return web.json_response({"success": False, "code": error.code, "error": str(error), **error.details}, status=status)


async def _run(handler, *args):
    try:
        return web.json_response({"success": True, **(await asyncio.to_thread(handler, *args))})
    except VersionError as error:
        return _error_response(error)


async def _json_body(request):
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


async def api_get_version(request):
    """GET /anomalous/version - Installed version (local, no network)."""
    try:
        return web.json_response({"success": True, "state": await asyncio.to_thread(current_state)})
    except VersionError as error:
        return _error_response(error)


async def api_get_releases(request):
    """GET /anomalous/version/releases?refresh=1 - Published releases (network, only when asked)."""
    return await _run(list_releases, request.query.get("refresh") == "1")


async def api_preview_switch(request):
    """POST /anomalous/version/preview {tag}"""
    return await _run(preview_switch, str((await _json_body(request)).get("tag", "")))


async def api_switch_version(request):
    """POST /anomalous/version/switch {tag}"""
    return await _run(switch_to, str((await _json_body(request)).get("tag", "")))


async def api_return_to_latest(request):
    """POST /anomalous/version/latest"""
    return await _run(return_to_latest)


async def api_undo_switch(request):
    """POST /anomalous/version/undo"""
    return await _run(undo_last_switch)


def register_routes(app):
    app.router.add_get('/anomalous/version', api_get_version)
    app.router.add_get('/anomalous/version/releases', api_get_releases)
    app.router.add_post('/anomalous/version/preview', api_preview_switch)
    app.router.add_post('/anomalous/version/switch', api_switch_version)
    app.router.add_post('/anomalous/version/latest', api_return_to_latest)
    app.router.add_post('/anomalous/version/undo', api_undo_switch)
