import os
from .api import setup_routes
from .api.usage_ledger import note_prompt
from server import PromptServer

WEB_DIRECTORY = "./web"

# 注册 API 路由
if hasattr(PromptServer, "instance") and PromptServer.instance is not None:
    setup_routes(PromptServer.instance.app)
    # Each queued run's nodes and models, for the Tidy tab's "Not used lately" (api/usage_ledger.py).
    PromptServer.instance.add_on_prompt_handler(note_prompt)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
