"""Regression guard for the completed CAM17 Test 4 repair verifier."""

from __future__ import annotations

import ast
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "repair_cam17_test4_content.py"


def test_checked_in_repair_artifact_is_read_only() -> None:
    source = SCRIPT.read_text(encoding="utf-8")
    tree = ast.parse(source)
    mutators = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in {"insert", "update", "upsert", "delete", "rpc"}
        and "sb." in ast.unparse(node.func.value)
    }

    assert mutators == set()
    assert "--commit" not in source
    assert "READ-ONLY VERIFY" in source
