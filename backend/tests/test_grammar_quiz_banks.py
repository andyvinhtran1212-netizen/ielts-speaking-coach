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


def _lint_doc(body: str) -> str:
    return f'''---
kind: quiz
code: "LINT-T"
skill_area: "grammar"
---

---
{body.strip()}
---
'''


def _q(qid: str, prompt: str, accept: str, hint: str | None = None) -> str:
    h = f'\nhint: "{hint}"' if hint else ""
    return (f'id: "{qid}"\ntype: "gap_text"\ninput: "text"\nheadword: "x"\n'
            f'skill: "production"\nprompt: "{prompt}"{h}\naccept: {accept}')


def test_content_lint_catches_answer_leak_channels(tmp_path):
    """Audit 2026-07-17 lint (a): ngoặc-trong-prompt / hint chứa nguyên văn đáp án."""
    f = tmp_path / "bad.md"
    # multi-word accept given verbatim in a paren → leak
    f.write_text(_lint_doc(_q("leak1", "He has ____ (a lot of) experience.", '["a lot of"]')))
    assert any("lộ đáp án" in p for p in content_lint(f))
    # word + criterion in the paren → leak (not a bare base-form cloze)
    f.write_text(_lint_doc(_q("leak2", "A ____ (historic — viết đúng dạng) moment.", '["historic"]')))
    assert any("lộ đáp án" in p for p in content_lint(f))
    # hint contains the accept verbatim (and is not a choice hint) → leak
    f.write_text(_lint_doc(_q("leak3", "A truly ____ moment.", '["historic"]', hint="từ 'historic' hợp với 'moment'")))
    assert any("hint chứa nguyên văn đáp án" in p for p in content_lint(f))


def test_content_lint_allows_cloze_and_choice_hints(tmp_path):
    """Cloze giữ-nguyên-dạng '____ (make)' và hint lựa chọn 'chọn X hoặc Y' hợp lệ."""
    f = tmp_path / "ok.md"
    f.write_text(_lint_doc(_q("ok1", "They ____ (make) a lot of noise.", '["make"]')))
    assert not [p for p in content_lint(f) if "lộ đáp án" in p]
    f.write_text(_lint_doc(_q("ok2", "____ tech startups failed early.", '["Many"]', hint="chọn 'many' hoặc 'much'")))
    assert not [p for p in content_lint(f) if "hint chứa" in p]


def test_content_lint_catches_embedded_instruction(tmp_path):
    """Audit 2026-07-17 lint (b): prompt còn '— write…' / ngoặc hướng dẫn cuối câu."""
    f = tmp_path / "instr.md"
    f.write_text(_lint_doc(_q("in1", "She gave a ____ (danger) speech — write the adjective form.", '["dangerous"]')))
    assert any("instruction nhúng" in p for p in content_lint(f))
    f.write_text(_lint_doc(_q("in2", "Water is scarce. ____ is worrying. (điền cụm 2 từ)", '["this trend"]')))
    assert any("instruction nhúng" in p for p in content_lint(f))
    # câu đề bình thường có dấu — giữa câu KHÔNG bị bắt nhầm
    f.write_text(_lint_doc(_q("in3", "I love old films — there is something charming about them: ____.", '["nostalgia"]')))
    assert not [p for p in content_lint(f) if "instruction nhúng" in p]
