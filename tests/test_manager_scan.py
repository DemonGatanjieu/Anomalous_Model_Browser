"""ComfyUI-Manager reads every .py file of a plugin, tests too, and lists whatever looks like a node
table as that plugin's nodes. AMB has none (AD-024), so no file may look like one: a table in a test once
made Manager offer AMB to people who missed Power Lora Loader, in place of rgthree."""
import re
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]

# As ComfyUI-Manager's scanner.py (scan_in_file) has them.
TABLE = re.compile(r"_CLASS_MAPPINGS\s*(?::\s*\w+\s*)?=\s*(?:\\\s*)?{([^}]*)}", re.MULTILINE | re.DOTALL)
OTHERS = (r'^[^=]*_CLASS_MAPPINGS\["(.*?)"\]', r"^[^=]*_CLASS_MAPPINGS\['(.*?)'\]",
          r'@register_node\("(.+)",\s*\".+"\)', r'"(\w+)"\s*:\s*{"class":\s*\w+\s*')


def claims(code):
    """What the scanner would take for nodes in `code`: the tables with something in them, and the other forms."""
    found = [table.strip() for table in TABLE.findall(code) if table.strip()]
    return found + [name for pattern in OTHERS for name in re.findall(pattern, code)]


class ManagerScanTests(unittest.TestCase):
    def test_the_check_sees_a_table(self):
        name = "NODE_CLASS_" + "MAPPINGS"  # in two, or this file would be the one to look like a table
        self.assertTrue(claims(name + ' = {"Some Node": object}'))
        self.assertFalse(claims(name + " = {}"))

    def test_no_file_looks_like_a_node_table(self):
        for path in PLUGIN.rglob("*.py"):
            parts = path.relative_to(PLUGIN).parts
            if "__pycache__" in parts or any(part.startswith(".") for part in parts):
                continue  # the scanner leaves these out too
            self.assertEqual(claims(path.read_text(encoding="utf-8", errors="ignore")), [], path)


if __name__ == "__main__":
    unittest.main()
