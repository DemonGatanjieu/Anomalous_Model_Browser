"""Deleting the user's files: always to the system Recycle Bin, never permanently.

Shared by the API and the standalone scanner. Where no recycle bin exists (a USB stick,
a network share, a Linux box without send2trash or gio), nothing is deleted and
TrashUnavailable says so; the caller reports it instead of falling back to a permanent
delete. Temporary files the plugin made itself are not deleted through here.
"""

import os
import shutil
import subprocess
import sys


class TrashUnavailable(OSError):
    """There is no recycle bin for this location; the files were left in place."""


def _windows_fixed_drive(path):
    import ctypes

    root = os.path.splitdrive(path)[0]
    if not root or root.startswith("\\\\"):
        return False  # a UNC share: no recycle bin
    return ctypes.windll.kernel32.GetDriveTypeW(root + "\\") == 3  # DRIVE_FIXED


def _windows_recycle(paths):
    import ctypes
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR), ("pTo", wintypes.LPCWSTR),
            ("fFlags", ctypes.c_ushort), ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", ctypes.c_void_p), ("lpszProgressTitle", wintypes.LPCWSTR),
        ]

    if not all(_windows_fixed_drive(path) for path in paths):
        raise TrashUnavailable("No Recycle Bin on this drive (removable or network)")
    # FO_DELETE with FOF_ALLOWUNDO recycles; no dialogs. FOF_WANTNUKEWARNING makes Windows
    # ask instead of silently deleting if this drive's Recycle Bin is switched off.
    flags = 0x0040 | 0x0010 | 0x0004 | 0x0400 | 0x4000
    op = SHFILEOPSTRUCTW(None, 3, "\0".join(paths) + "\0", None, flags, False, None, None)
    result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    if result != 0 or op.fAnyOperationsAborted:
        raise OSError(result, f"Could not move to the Recycle Bin (code {result}); the file may be in use")


def _posix_recycle(paths):
    try:
        from send2trash import send2trash
    except ImportError:
        send2trash = None
    if send2trash:
        for path in paths:
            send2trash(path)
        return
    gio = shutil.which("gio")
    if not gio:
        raise TrashUnavailable("No trash available (install send2trash)")
    for path in paths:
        subprocess.run([gio, "trash", path], check=True, capture_output=True)


def move_to_trash(*paths):
    """Moves the existing files and folders among ``paths`` to the Recycle Bin, together.
    Returns the paths moved. Raises TrashUnavailable (nothing moved) or OSError."""
    targets = [os.path.abspath(path) for path in paths if path and os.path.lexists(path)]
    if not targets:
        return []
    if sys.platform == "win32":
        _windows_recycle(targets)
    else:
        _posix_recycle(targets)
    return targets
