import os
import sys

# Ensure python_embeded and Scripts (containing ffmpeg/ffprobe) are in PATH
python_dir = os.path.dirname(sys.executable)
scripts_dir = os.path.join(python_dir, "Scripts")
for p in [python_dir, scripts_dir]:
    if os.path.isdir(p) and p not in os.environ.get("PATH", ""):
        os.environ["PATH"] = p + os.pathsep + os.environ.get("PATH", "")

from .api import setup_routes
from server import PromptServer

WEB_DIRECTORY = "./web"

# 注册 API 路由
if hasattr(PromptServer, "instance") and PromptServer.instance is not None:
    setup_routes(PromptServer.instance.app)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
