"""Phase 3 — exam module: pure validate/build/grade + the seed TOEIC content is
valid and its KP links all resolve to live assets.
"""
from __future__ import annotations

from pathlib import Path

from services import exam_service as ex
from services import kp_registry, reading_solution
from services.content_import_service import _split_frontmatter

CONTENT = Path(__file__).resolve().parents[1] / "content" / "exams" / "toeic-p5-001.md"

_GOOD_Q = {
    "q_num": 1, "question_type": "mcq_single",
    "prompt": "The report ____ ready.", "answer": "B",
    "options": [{"label": "A", "text": "are"}, {"label": "B", "text": "is"}],
    "kp_focus": "grammar", "grammar_slug": "subject-verb-agreement",
}
_GOOD_FM = {"exam_source": "toeic_rc", "code": "AVR-TOEIC-P5-X", "title": "T", "questions": [_GOOD_Q]}


# ── validation ───────────────────────────────────────────────────────────────

def test_valid_exam_passes():
    assert ex.validate_exam(_GOOD_FM) == []


def test_bad_source_missing_code_and_options_rejected():
    bad = {"exam_source": "gre", "title": "T",
           "questions": [{"q_num": 1, "prompt": "p", "answer": "A", "options": []}]}
    errs = ex.validate_exam(bad)
    assert any("exam_source" in e for e in errs)
    assert any("code" in e for e in errs)
    assert any("options" in e for e in errs)


def test_duplicate_qnum_and_bad_kp_focus_rejected():
    fm = {"exam_source": "toeic_rc", "code": "C", "title": "T", "questions": [
        dict(_GOOD_Q), dict(_GOOD_Q, kp_focus="phonics")]}
    errs = ex.validate_exam(fm)
    assert any("q_num 1 bị trùng" in e for e in errs)
    assert any("kp_focus" in e for e in errs)


def test_bad_solution_structure_rejected():
    fm = {"exam_source": "toeic_rc", "code": "C", "title": "T", "questions": [
        dict(_GOOD_Q, solution={"solution_steps": [{"action": "warp", "instruction_vi": "x"}]})]}
    assert any("action" in e for e in ex.validate_exam(fm))


# ── build + grade ────────────────────────────────────────────────────────────

def test_build_payloads_shape():
    plan = ex.build_exam_payloads(_GOOD_FM)
    assert plan["test_row"]["exam_source"] == "toeic_rc"
    assert plan["test_row"]["total_questions"] == 1
    r = plan["question_rows"][0]
    assert r["answer"] == {"answer": "B", "alternatives": []}
    assert r["grammar_slug"] == "subject-verb-agreement" and r["order_num"] == 1


def test_grade_counts_correct_and_wrong():
    key = [{"q_num": 1, "answer": {"answer": "B", "alternatives": []}},
           {"q_num": 2, "answer": {"answer": "C", "alternatives": []}}]
    ua = [{"q_num": 1, "user_answer": "B"}, {"q_num": 2, "user_answer": "A"}]
    res = ex.grade_exam(ua, key)
    assert res["score"] == 1 and res["max_score"] == 2 and res["correct_count"] == 1
    verdicts = {p["q_num"]: p["correct"] for p in res["per_question"]}
    assert verdicts == {1: True, 2: False}


# ── seed content is valid + every KP link is live ────────────────────────────

def test_seed_toeic_content_valid_and_kp_links_resolve():
    fm, _ = _split_frontmatter(CONTENT.read_text(encoding="utf-8"))
    assert ex.validate_exam(fm) == []
    for q in fm["questions"]:
        # grammar_slug points at a real grammar article
        if q.get("grammar_slug"):
            assert kp_registry.resolve_grammar(q["grammar_slug"]) is None, q["grammar_slug"]
        # every kp_ref in the solution resolves (grammar/skill offline)
        for ref in reading_solution.iter_kp_refs(q.get("solution")):
            if ref["type"] in ("grammar", "skill"):
                assert kp_registry.resolve_ref(ref["type"], ref["slug"], ref["anchor"]) is None, ref
