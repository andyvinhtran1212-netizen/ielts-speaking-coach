#!/usr/bin/env python3
"""check_reading_solution_depth.py — coverage report for the #6 depth gate.

Pure (no LLM, no DB): parses reading test markdown, runs
services.reading_solution_depth.validate_solution_depth on every question, and
prints how many pass the depth bar + which q_nums fail and why.

    python -m scripts.check_reading_solution_depth                 # all L3 tests
    python -m scripts.check_reading_solution_depth path/to/test.md # one file
    python -m scripts.check_reading_solution_depth --strict        # exit 1 if any gap

Use it to (a) see the current gap concretely (~1/40), (b) verify a backfill
batch, (c) later flip --strict on in a content-CI job once coverage lands.
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

# make `services` importable when run as a plain script
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.reading_solution_depth import validate_solution_depth  # noqa: E402

_CONTENT_DIR = Path(__file__).resolve().parents[1] / "content" / "reading"


def _frontmatter(md_path: Path) -> dict:
    raw = md_path.read_text(encoding="utf-8")
    parts = raw.split("---", 2)
    if len(parts) < 3:
        raise ValueError(f"{md_path.name}: no YAML frontmatter")
    return yaml.safe_load(parts[1]) or {}


def _iter_questions(fm: dict):
    """Yield (q_num, question_dict) across every passage/section."""
    for passage in fm.get("passages") or []:
        for q in passage.get("questions") or []:
            if isinstance(q, dict):
                yield q.get("q_num", "?"), q


def check_file(md_path: Path) -> tuple[int, int, list[str]]:
    fm = _frontmatter(md_path)
    total = deep = 0
    gaps: list[str] = []
    for q_num, q in _iter_questions(fm):
        total += 1
        errs = validate_solution_depth(q, f"{md_path.stem} Q{q_num}")
        if errs:
            gaps.extend(errs)
        else:
            deep += 1
    return total, deep, gaps


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    strict = "--strict" in argv
    argv = [a for a in argv if a != "--strict"]

    files = [Path(a) for a in argv] if argv else sorted(_CONTENT_DIR.glob("l3-*.md"))
    if not files:
        print("no reading test files found"); return 1

    any_gap = False
    for f in files:
        total, deep, gaps = check_file(f)
        pct = (deep / total * 100) if total else 0
        print(f"\n{f.name}: {deep}/{total} câu đạt chuẩn giải sâu ({pct:.0f}%)")
        if gaps:
            any_gap = True
            for g in gaps[:80]:
                print(f"  ✗ {g}")
            if len(gaps) > 80:
                print(f"  … +{len(gaps) - 80} gap khác")
    print()
    return 1 if (strict and any_gap) else 0


if __name__ == "__main__":
    sys.exit(main())
