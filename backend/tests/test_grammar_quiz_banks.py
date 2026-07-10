"""CI gate — every committed grammar quiz bank must be import-ready.

Any file `docs/grammar-quiz-banks/G-*.md` (a produced check-up bank) is validated
with the SAME logic the importer + Adaptive-Mastery engine enforce
(scripts/validate_grammar_quiz_bank.check_file):

  - structural: valid quiz META, per-question fields by input type, unique ids;
  - linkage:   every grammar_article_slug resolves to a LIVE Wiki article;
  - mastery:   each item_key has >= correct_to_master distinct skills + >=1
               production (input: text), else the engine can never master it;
  - standard:  every question carries explain + subtype(level).

This protects the mass-production effort: a malformed bank fails CI instead of
silently failing import (or stalling the mastery loop) in front of learners.
Banks are authored per docs/GRAMMAR_QUIZ_AUTHORING_GUIDE.md.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.validate_grammar_quiz_bank import check_file, content_lint  # noqa: E402
_BANK_DIR = Path(__file__).resolve().parents[2] / "docs" / "grammar-quiz-banks"


def _bank_files() -> list[Path]:
    # Every `G-*.md` is meant to be a bank. Do NOT pre-filter by "has valid META"
    # — a malformed/missing-META bank must be SURFACED by check_file (structural
    # error), not silently dropped from the gate (or collapse the list into the
    # no-banks-yet skip). Naming convention `G-` already excludes _TEMPLATE.md /
    # AGENT_PROMPT.md.
    return sorted(_BANK_DIR.glob("G-*.md"))


def test_bank_dir_exists():
    assert _BANK_DIR.is_dir(), f"thiếu thư mục bank: {_BANK_DIR}"


@pytest.mark.parametrize(
    "bank_path",
    _bank_files() or [pytest.param(None, id="no-banks-yet")],
)
def test_grammar_quiz_bank_valid(bank_path):
    if bank_path is None:
        pytest.skip("chưa có bank grammar nào (docs/grammar-quiz-banks/G-*.md)")
    problems = check_file(bank_path)
    assert not problems, (
        f"{bank_path.name} chưa import-ready:\n  - " + "\n  - ".join(problems)
    )


@pytest.mark.parametrize(
    "bank_path",
    _bank_files() or [pytest.param(None, id="no-banks-yet")],
)
def test_grammar_quiz_bank_content_clean(bank_path):
    """Cổng lint nội dung: không có đáp án tự-mâu-thuẫn / accept không gõ được.

    Lớp lỗi mơ-hồ-đa-đáp-án cần reviewer QA2 (LLM) — không gate được ở đây.
    """
    if bank_path is None:
        pytest.skip("chưa có bank grammar nào (docs/grammar-quiz-banks/G-*.md)")
    problems = content_lint(bank_path)
    assert not problems, (
        f"{bank_path.name} lỗi lint nội dung:\n  - " + "\n  - ".join(problems)
    )
