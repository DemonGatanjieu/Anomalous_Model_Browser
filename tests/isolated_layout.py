"""Tests never read this computer's settings: side files (model_sidecars.py) go beside the model,
whatever api/config.json on this computer says. Imported by the tests that write side files."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import model_sidecars  # noqa: E402

model_sidecars.CONFIG_PATH = os.path.join(tempfile.gettempdir(), "anomalous-tests-have-no-config.json")
model_sidecars._layout["mtime"] = None
