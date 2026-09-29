import os
from .api import setup_routes
from server import PromptServer

WEB_DIRECTORY = "./web"

# 注册 API 路由
if hasattr(PromptServer, "instance") and PromptServer.instance is not None:
    setup_routes(PromptServer.instance.app)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
