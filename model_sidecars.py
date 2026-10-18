"""Where a model's side files are kept, as Settings → Models → "Side files" says (SIDECAR_LAYOUT
in api/config.json):
- "beside" (the default): every side file next to the model, <folder>/<stem><suffix>;
- "hidden": the files only this plugin uses (OWN_SUFFIXES: what a scan found, the user's edits,
  Civitai's cover kept aside) in the folder's hidden .amb folder, <folder>/.amb/<stem><suffix>.
Covers (<stem>.preview.*, <stem>.<image>) and other tools' files (.civitai.info, .yaml, .txt…)
always stay beside the model, where ComfyUI and other plugins look for them.

Reading looks in both places, the setting's first, so a folder moved half way, or by hand, still
reads; a file is written where it is already, else where the setting says. Shared by the
standalone scanner and the API (no ComfyUI imports).

Civitai's cover is kept aside (<stem>.civitai_bak.*) only while the user's own cover is shown:
otherwise the cover itself is Civitai's, and the scan notes its SHA-256 in the .info
(COVER_HASH_KEY) to tell it from a picture the user puts there later.
"""

import ctypes
import hashlib
import json
import os

MEDIA_EXTENSIONS = ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mov', '.avi')  # as api/model_constants.py
CIVITAI_BACKUP_SUFFIXES = tuple(f'.civitai_bak{ext}' for ext in MEDIA_EXTENSIONS)
ACTIVE_COVER_SUFFIXES = tuple(f'.preview{ext}' for ext in MEDIA_EXTENSIONS) + MEDIA_EXTENSIONS  # <model>.preview.png, else <model>.png
USER_INFO_SUFFIX = '.anomalous.json'
OWN_SUFFIXES = ('.info', USER_INFO_SUFFIX, *CIVITAI_BACKUP_SUFFIXES)
HIDDEN_DIR = '.amb'
LAYOUTS = ('beside', 'hidden')
COVER_HASH_KEY = 'anomalous_cover_sha256'
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'api', 'config.json')
FILE_ATTRIBUTE_HIDDEN = 0x2

_layout = {'mtime': None, 'value': 'beside'}


def layout():
    """'beside' or 'hidden', as api/config.json says (read again when the file changes)."""
    try:
        mtime = os.stat(CONFIG_PATH).st_mtime_ns
    except OSError:
        return 'beside'
    if mtime != _layout['mtime']:
        try:
            with open(CONFIG_PATH, encoding='utf-8') as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = {}
        value = data.get('SIDECAR_LAYOUT') if isinstance(data, dict) else None
        _layout.update(mtime=mtime, value=value if value in LAYOUTS else 'beside')
    return _layout['value']


def hidden_path(base, suffix):
    folder, stem = os.path.split(base)
    return os.path.join(folder, HIDDEN_DIR, stem + suffix)


def is_hidden(path):
    return os.path.basename(os.path.dirname(path)) == HIDDEN_DIR


def places(base, suffix, wanted=None):
    """Where a side file of `suffix` may be, the place `wanted` (the setting when None) first."""
    if suffix not in OWN_SUFFIXES:
        return [base + suffix]
    pair = [hidden_path(base, suffix), base + suffix]
    return pair if (wanted or layout()) == 'hidden' else pair[::-1]


def find(base, suffix):
    """The side file of `suffix` where it is, or None."""
    return next((path for path in places(base, suffix) if os.path.exists(path)), None)


def make_hidden_dir(folder):
    """<folder>/.amb, made when missing (and hidden from Explorer on Windows)."""
    path = os.path.join(folder, HIDDEN_DIR)
    if not os.path.isdir(path):
        os.makedirs(path, exist_ok=True)
        if os.name == 'nt':
            try:
                ctypes.windll.kernel32.SetFileAttributesW(path, FILE_ATTRIBUTE_HIDDEN)
            except (OSError, AttributeError):
                pass  # only how Explorer shows it
    return path


def target(base, suffix):
    """Where the side file of `suffix` is written: where it is already, else where the setting says."""
    found = find(base, suffix)
    if found:
        return found
    path = places(base, suffix)[0]
    if is_hidden(path):
        make_hidden_dir(os.path.dirname(base))
    return path


def existing(base, suffixes):
    """[(path, suffix)] of the side files a model has, in either place."""
    return [(path, suffix) for suffix in suffixes for path in places(base, suffix) if os.path.isfile(path)]


def follow(path, new_base, suffix):
    """Where side file `path` goes when its model becomes `new_base`: the same kind of place."""
    if is_hidden(path):
        make_hidden_dir(os.path.dirname(new_base))
        return hidden_path(new_base, suffix)
    return new_base + suffix


def drop_empty_hidden_dir(folder):
    """Removes <folder>/.amb when nothing is left in it."""
    try:
        os.rmdir(os.path.join(folder, HIDDEN_DIR))
    except OSError:
        pass  # missing, or still holds files


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def same_file(a, b):
    """Byte-for-byte equal (covers are small; size is checked first)."""
    try:
        return os.path.getsize(a) == os.path.getsize(b) and file_sha256(a) == file_sha256(b)
    except OSError:
        return False


def _read_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def civitai_cover_hash(base):
    """The SHA-256 a scan noted for the Civitai picture it made the cover, or ''."""
    info = find(base, '.info')
    value = (_read_json(info) or {}).get(COVER_HASH_KEY) if info else None
    return value if isinstance(value, str) else ''


def note_cover_hash(base, cover):
    """Notes in the model's .info that `cover` is Civitai's picture (False without a .info)."""
    info = find(base, '.info')
    data = _read_json(info) if info else None
    if data is None:
        return False
    data[COVER_HASH_KEY] = file_sha256(cover)
    temporary = f'{info}.{os.getpid()}.tmp'
    with open(temporary, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=True, indent=4)
    os.replace(temporary, info)
    return True


def backups(base):
    """Civitai's covers kept aside (<stem>.civitai_bak.*), in either place."""
    return [path for path, _ in existing(base, CIVITAI_BACKUP_SUFFIXES)]


def cover_owners(base):
    """(Civitai's, the user's) active covers: Civitai's is the picture a scan noted or a copy of
    the one kept aside; any other is the user's."""
    kept, noted = backups(base), civitai_cover_hash(base)
    covers = [base + suffix for suffix in ACTIVE_COVER_SUFFIXES if os.path.isfile(base + suffix)]
    civitai = [cover for cover in covers if is_civitai_cover(cover, base, kept, noted)]
    return civitai, [cover for cover in covers if cover not in civitai]


def is_civitai_cover(cover, base, kept=None, noted=None):
    """Whether `cover` is Civitai's picture: a copy of one kept aside, or the one the scan noted."""
    kept = backups(base) if kept is None else kept
    if any(same_file(cover, backup) for backup in kept):
        return True
    noted = civitai_cover_hash(base) if noted is None else noted
    try:
        return bool(noted) and file_sha256(cover) == noted
    except OSError:
        return False


def keep_aside(base, cover):
    """Moves Civitai's picture `cover` aside (<stem>.civitai_bak.<ext>), to bring back later."""
    path = target(base, '.civitai_bak' + os.path.splitext(cover)[1])
    os.replace(cover, path)
    return path


def suffix_of(path, base):
    """What follows the model's name in a side file's name ('.info', '.civitai_bak.png'…)."""
    return os.path.basename(path)[len(os.path.basename(base)):]
