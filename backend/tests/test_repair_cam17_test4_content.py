"""Regression guard for the completed CAM17 Test 4 repair verifier."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from canonical_text_guard import replace_expected, strip_known_note


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
    assert "verify_listening_audit()" in source


def test_replace_expected_accepts_only_known_legacy_or_canonical_text() -> None:
    assert replace_expected("before OLD after", "OLD", "NEW", "fixture") == "before NEW after"
    assert replace_expected("before NEW after", "OLD", "NEW", "fixture") == "before NEW after"

    with pytest.raises(RuntimeError, match="legacy=0, canonical=0"):
        replace_expected("before altered after", "OLD", "NEW", "fixture")
    with pytest.raises(RuntimeError, match="legacy=2"):
        replace_expected("OLD and OLD", "OLD", "NEW", "fixture")


def test_strip_known_note_rejects_unrecognised_note_drift() -> None:
    pattern = r"\n\n> \*Ghi chú OCR:\*[^\n]*"
    assert strip_known_note("Explanation\n\n> *Ghi chú OCR:* old", pattern,
                            "Ghi chú OCR:", "fixture") == "Explanation"
    assert strip_known_note("Explanation", pattern, "Ghi chú OCR:", "fixture") == "Explanation"

    with pytest.raises(RuntimeError, match="unrecognised"):
        strip_known_note("Explanation\nGhi chú OCR: altered", pattern,
                         "Ghi chú OCR:", "fixture")
