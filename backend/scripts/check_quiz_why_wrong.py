#!/usr/bin/env python3
"""check_quiz_why_wrong.py — coverage report for the #7a per-distractor gate.

Pure (no LLM/DB): parses the grammar quiz banks, runs
services.quiz_why_wrong.validate_why_wrong(required=True) on every choice
question, and reports how many carry per-distractor `why_wrong` reasoning.

    python -m scripts.check_quiz_why_wrong                     # all banks
    python -m scripts.check_quiz_why_wrong path/to/G-*.md      # some banks
    python -m scripts.check_quiz_why_wrong --strict            # exit 1 if any gap
    python -m scripts.check_quiz_why_wrong --rank              # banks sorted by gap size

Use --rank to pick the highest-impact banks to backfill first.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.quiz_why_wrong import validate_why_wrong, wrong_option_indices  # noqa: E402

_BANK_DIR = Path(__file__).resolve().parents[2] / "docs" / "grammar-quiz-banks"


def _iter_questions(md_path: Path):
    text = md_path.read_text(encoding="utf-8")
    for chunk in re.split(r"^---\s*$", text, flags=re.M):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            d = yaml.safe_load(chunk)
        except yaml.YAMLError:
            continue
        if isinstance(d, dict) and d.get("type") and "answer" in d:
            yield d


def check_file(md_path: Path) -> tuple[int, int, list[str]]:
    """Returns (choice_questions, covered, gap_messages)."""
    total = covered = 0
    gaps: list[str] = []
    for q in _iter_questions(md_path):
        if wrong_option_indices(q) is None:
            continue  # not an index-answered choice question
        total += 1
        errs = validate_why_wrong(q, f"{md_path.stem}:{q.get('id','?')}", required=True)
        if errs:
            gaps.extend(errs)
        else:
            covered += 1
    return total, covered, gaps


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    strict = "--strict" in argv
    rank = "--rank" in argv
    argv = [a for a in argv if a not in ("--strict", "--rank")]

    files = [Path(a) for a in argv] if argv else sorted(_BANK_DIR.glob("G-*.md"))
    if not files:
        print("no quiz banks found"); return 1

    rows = []
    for f in files:
        total, covered, gaps = check_file(f)
        rows.append((f.name, total, covered, gaps))

    if rank:
        rows.sort(key=lambda r: (r[1] - r[2]), reverse=True)  # biggest gap first

    grand_total = sum(r[1] for r in rows)
    grand_cov = sum(r[2] for r in rows)
    any_gap = grand_cov < grand_total

    for name, total, covered, gaps in rows:
        if total == 0:
            continue
        pct = covered / total * 100
        marker = "" if covered == total else "  ← backfill"
        print(f"{name:<52} {covered:>3}/{total:<3} ({pct:>3.0f}%){marker}")

    print(f"\nTỔNG: {grand_cov}/{grand_total} câu trắc nghiệm có why_wrong "
          f"({grand_cov/grand_total*100:.0f}%)" if grand_total else "no choice questions")
    return 1 if (strict and any_gap) else 0


if __name__ == "__main__":
    sys.exit(main())
