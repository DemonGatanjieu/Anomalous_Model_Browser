"""The API's way to delete the user's files: recycle_bin.py (shared with the scanner)."""

try:
    from ..recycle_bin import TrashUnavailable, move_to_trash
except ImportError:  # loaded outside the package (tests)
    from recycle_bin import TrashUnavailable, move_to_trash

__all__ = ["TrashUnavailable", "move_to_trash", "trash_failure"]


def trash_failure(exc):
    """What to tell the user when moving to the Recycle Bin did not happen."""
    if isinstance(exc, TrashUnavailable):
        return ("这个位置没有回收站（U 盘或网络盘），为了安全没有删除，请在文件管理器里手动删除。"
                " / No Recycle Bin here (USB or network drive); nothing was deleted, please delete it in your file manager.")
    if getattr(exc, "errno", None) == 32 or getattr(exc, "winerror", None) == 32 or "being used" in str(exc):
        return ("文件正在被使用（可能 ComfyUI 已经加载了它），没有删除。请先卸载模型或重启 ComfyUI。"
                " / The file is in use (ComfyUI may have it loaded); nothing was deleted.")
    return f"没有删除 / Not deleted: {exc}"
