"""Shows a model file in this computer's file manager: Explorer or Finder with the file
selected, the folder on Linux; or, without a file name, opens a models folder (a type's root
or a subfolder). The request names it the way the browser lists it (type, folder index,
subfolder, file name), never a path, and local_guard lets only this computer ask (a POST)."""
import os
import subprocess
import sys
import threading
import time

from aiohttp import web

from .utils import require_filename, resolve_folder_subdir, resolve_within


def _explorer_windows():
    """Handles of the open Explorer folder windows (window class CabinetWClass)."""
    import ctypes
    from ctypes import wintypes

    found = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def collect(hwnd, _):
        name = ctypes.create_unicode_buffer(64)
        ctypes.windll.user32.GetClassNameW(hwnd, name, 64)
        if name.value == "CabinetWClass":
            found.append(hwnd)
        return True

    ctypes.windll.user32.EnumWindows(callback_type(collect), 0)
    return found


def _window_title(hwnd):
    import ctypes

    title = ctypes.create_unicode_buffer(512)
    ctypes.windll.user32.GetWindowTextW(hwnd, title, 512)
    return title.value


def _to_front(hwnd):
    """Windows keeps a background program (ComfyUI here) from raising a window; borrowing the
    foreground window's input queue for a moment lets it."""
    import ctypes

    user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
    foreground = user32.GetForegroundWindow()
    theirs = user32.GetWindowThreadProcessId(foreground, None)
    mine = kernel32.GetCurrentThreadId()
    attached = theirs and theirs != mine and user32.AttachThreadInput(mine, theirs, True)
    try:
        user32.ShowWindow(hwnd, 9 if user32.IsIconic(hwnd) else 5)  # SW_RESTORE / SW_SHOW
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
    finally:
        if attached:
            user32.AttachThreadInput(mine, theirs, False)


def _raise_explorer(folder, before):
    """Waits up to 3 s for the window showing `folder` (a new one, or the open one Explorer
    reused) and brings it to the front."""
    names = (os.path.basename(folder).lower(), os.path.normcase(folder).lower())

    def shows_folder(hwnd):
        # The folder's name (or full path), then " - File Explorer" in the system's language.
        title = _window_title(hwnd).lower()
        return any(title == name or title.startswith(name + " - ") for name in names)

    for _ in range(30):
        time.sleep(0.1)
        windows = _explorer_windows()
        fresh = [hwnd for hwnd in windows if hwnd not in before]
        match = fresh or [hwnd for hwnd in windows if shows_folder(hwnd)]
        if match:
            _to_front(match[0])
            return


def _reveal(path):
    if sys.platform == "win32":
        before = set(_explorer_windows())
        subprocess.Popen(f'explorer /select,"{path}"')
        threading.Thread(target=_raise_explorer, args=(os.path.dirname(path), before), daemon=True).start()
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(path)])


def _open_folder(folder):
    if sys.platform == "win32":
        before = set(_explorer_windows())
        subprocess.Popen(f'explorer "{folder}"')
        threading.Thread(target=_raise_explorer, args=(folder, before), daemon=True).start()
    elif sys.platform == "darwin":
        subprocess.Popen(["open", folder])
    else:
        subprocess.Popen(["xdg-open", folder])


async def api_open_model_folder(request):
    """{type, path_idx, subfolder, filename}: Explorer with the model selected; without a
    filename, the folder (type root or subfolder) itself."""
    try:
        data = await request.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        return web.json_response({"status": "error", "message": "Invalid request body"}, status=400)
    try:
        _, folder = resolve_folder_subdir(data.get("type", ""), int(data.get("path_idx", 0)), data.get("subfolder", "/"))
        filename = data.get("filename")
        path = resolve_within(folder, require_filename(filename)) if filename else None
    except (ValueError, KeyError, TypeError):
        return web.json_response({"status": "error", "message": "Invalid request parameters"}, status=400)
    if not os.path.isfile(path) if path else not os.path.isdir(folder):
        return web.json_response({"status": "error", "message": "Not found"}, status=404)
    try:
        _reveal(path) if path else _open_folder(folder)
    except OSError as error:
        return web.json_response({"status": "error", "message": str(error)}, status=500)
    return web.json_response({"status": "success"})
