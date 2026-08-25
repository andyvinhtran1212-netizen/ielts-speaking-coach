#!/usr/bin/env python3
"""Validate Grammar Wiki learning-block frontmatter and placement markers.

Usage:
    cd backend && python scripts/validate_grammar_learning_blocks.py
    python scripts/validate_grammar_learning_blocks.py content/tenses/present-perfect.md
"""
from __future__ import annotations

import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.grammar_learning_blocks import validate_learning_blocks  # noqa: E402


CONTENT_DIR = Path(__file__).resolve().parents[1] / "content"


def check_file(path: Path) -> list[str]:
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---"):
        return []
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return ["frontmatter is not closed"]
    try:
        frontmatter = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError as exc:
        return [f"invalid YAML: {exc}"]
    content_type = str(frontmatter.get("content_type") or "")
    if content_type.startswith(("reading", "listening", "exam")):
        return []
    _, errors = validate_learning_blocks(frontmatter.get("learning_blocks"), parts[2])
    return errors


def main(argv: list[str]) -> int:
    paths = [Path(value).resolve() for value in argv]
    if not paths:
        paths = sorted(CONTENT_DIR.rglob("*.md"))
    failed = 0
    with_blocks = 0
    for path in paths:
        raw = path.read_text(encoding="utf-8")
        if "learning-block:" in raw or "learning_blocks:" in raw:
            with_blocks += 1
        errors = check_file(path)
        if errors:
            failed += 1
            print(f"FAIL {path}")
            for error in errors:
                print(f"  - {error}")
    if failed:
        print(f"\n{failed} file(s) failed learning-block validation.")
        return 1
    print(f"OK: {len(paths)} files checked; {with_blocks} use learning blocks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
