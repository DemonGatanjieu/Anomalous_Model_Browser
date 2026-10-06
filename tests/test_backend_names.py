"""Every name a backend module reads must be bound somewhere in that module.

Splitting a module can leave a function calling a helper, or a standard library module,
that was only imported in the old file. Python reports that only when the line runs, so a
save or thumbnail route fails for users while imports and other tests still pass. This
check is deliberately scope-blind: it catches missing imports, not every local-name slip.
"""

import ast
import builtins
import unittest
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[1]
ALWAYS_BOUND = set(dir(builtins)) | {"__file__", "__name__", "__doc__", "__package__", "__spec__", "__path__"}


def _backend_files():
    yield from sorted(PLUGIN_DIR.glob("*.py"))
    yield from sorted((PLUGIN_DIR / "api").glob("*.py"))


def _arguments(args):
    names = [a.arg for a in args.posonlyargs + args.args + args.kwonlyargs]
    names += [a.arg for a in (args.vararg, args.kwarg) if a]
    return names


def _bound_names(tree, path):
    bound = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            bound.add(node.name)
            bound.update(_arguments(node.args))
        elif isinstance(node, ast.Lambda):
            bound.update(_arguments(node.args))
        elif isinstance(node, ast.ClassDef):
            bound.add(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                if alias.name == "*":
                    bound |= _star_names(node, path)
                else:
                    bound.add((alias.asname or alias.name).split(".")[0])
        elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            bound.add(node.id)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            bound.add(node.name)
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            bound.update(node.names)
        elif isinstance(node, (ast.MatchAs, ast.MatchStar)) and node.name:
            bound.add(node.name)
    return bound


def _star_names(node, path):
    """Top-level names of a sibling module imported with ``from .x import *``."""
    if node.level != 1 or not node.module:
        raise AssertionError(f"{path.name}: only sibling star imports are checked")
    target = path.parent / f"{node.module}.py"
    tree = ast.parse(target.read_text(encoding="utf-8"))
    return {name for name in _bound_names(tree, target) if not name.startswith("_")}


class BackendNamesTests(unittest.TestCase):
    def test_every_read_name_is_bound(self):
        problems = []
        for path in _backend_files():
            tree = ast.parse(path.read_text(encoding="utf-8"))
            bound = _bound_names(tree, path) | ALWAYS_BOUND
            for node in ast.walk(tree):
                if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id not in bound:
                    problems.append(f"{path.relative_to(PLUGIN_DIR)}:{node.lineno} {node.id}")
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
