"""Tests for Sprint 20.2 — L1 Vocab Reading (cluster 20.x).

  • content_import_service — L1 question parse/validate/build (pure)
  • POST /admin/reading/content/import — now inserts reading_questions
  • routers.reading_student._grade_one — server-side instant-feedback grading
  • GET/POST /api/reading/vocab* — auth-gating + answer-key non-leak + grading
  • backend/content/reading/*.md seed passages are well-formed + importable

DB + auth patched (no real DB), mirroring test_reading_content_import.py.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from services.content_import_service import (
    build_reading_question_payloads,
    parse_reading_passage,
    validate_reading_passage,
    validate_reading_questions,
)
from routers.reading_student import _grade_one


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_AUTH = {"Authorization": "Bearer fake.user.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_USER = {"id": "00000000-0000-0000-0000-00000000bbbb", "email": "u@x"}

_CONTENT_DIR = Path(__file__).parent.parent / "content" / "reading"

_L1_WITH_QS = """---
content_type: reading_passage_l1
title: Test Passage
slug: test-passage
difficulty_level: foundation
published: true
questions:
  - q_num: 1
    question_type: true_false_not_given
    prompt: The sky is green.
    answer: "FALSE"
    alternatives: ["F"]
    skill_tag: detail
    explanation: It is blue.
  - q_num: 2
    question_type: mcq_single
    prompt: Pick A.
    options:
      - label: A
        text: first
      - label: B
        text: second
    answer: "A"
    skill_tag: main_idea
---
A short body that is long enough to pass validation.
"""


# ── Service: question parse / validate / build ────────────────────────


def test_parse_extracts_questions_list():
    p = parse_reading_passage(_L1_WITH_QS)
    assert len(p.questions) == 2
    assert p.questions[0]["question_type"] == "true_false_not_given"
    assert p.as_preview()["question_count"] == 2


def test_validate_passage_includes_question_errors():
    bad = _L1_WITH_QS.replace("skill_tag: detail", "skill_tag: not_a_skill")
    fields = {e["field"] for e in validate_reading_passage(parse_reading_passage(bad))}
    assert "questions" in fields


def test_validate_questions_rejects_bad_type_and_missing_answer():
    qs = [
        {"q_num": 1, "question_type": "essay", "prompt": "x", "answer": "y", "skill_tag": "detail"},
        {"q_num": 2, "question_type": "short_answer", "prompt": "x", "skill_tag": "detail"},  # no answer
    ]
    msgs = " ".join(e["message"] for e in validate_reading_questions(qs))
    assert "question_type" in msgs
    assert "answer" in msgs


def test_validate_questions_flags_duplicate_qnum():
    qs = [
        {"q_num": 1, "question_type": "short_answer", "prompt": "a", "answer": "x", "skill_tag": "detail"},
        {"q_num": 1, "question_type": "short_answer", "prompt": "b", "answer": "y", "skill_tag": "detail"},
    ]
    assert any("trùng" in e["message"] for e in validate_reading_questions(qs))


def test_validate_questions_non_list_is_error():
    assert validate_reading_questions("nope")


def test_build_question_payloads_splits_answer_key_from_payload():
    p = parse_reading_passage(_L1_WITH_QS)
    rows = build_reading_question_payloads(p.questions, "pid-123")
    assert rows[0]["passage_id"] == "pid-123"
    assert rows[0]["answer"] == {"answer": "FALSE", "alternatives": ["F"]}
    # mcq options live in payload, never in the answer column.
    assert rows[1]["payload"]["options"][0]["label"] == "A"
    assert "options" not in rows[1]["answer"]


# ── Import endpoint now inserts reading_questions ─────────────────────


def _upload(md: str, qs: str = "", headers=None):
    files = {"file": ("p.md", md.encode("utf-8"), "text/markdown")}
    return _client().post("/admin/reading/content/import" + qs, files=files, headers=headers or {})


def test_import_commit_inserts_questions():
    mock_db = MagicMock()
    sel = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    sel.execute.return_value = MagicMock(data=[])               # new slug → insert
    mock_db.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{"id": "pid"}])

    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _upload(_L1_WITH_QS, "?dry_run=false", _ADMIN_AUTH)

    assert r.status_code == 200
    body = r.json()
    assert body["action"] == "created"
    assert body["question_count"] == 2
    # reading_questions were cleared then inserted for the new passage.
    table_names = [c.args[0] for c in mock_db.table.call_args_list]
    assert "reading_questions" in table_names
    assert mock_db.table.return_value.delete.called
    inserted = [c.args[0] for c in mock_db.table.return_value.insert.call_args_list]
    q_inserts = [a for a in inserted if isinstance(a, list)]
    assert q_inserts and len(q_inserts[0]) == 2
    assert q_inserts[0][0]["passage_id"] == "pid"


# ── Grading (_grade_one, pure) ────────────────────────────────────────


def _qrow(answer, alts=None, **extra):
    row = {"q_num": 1, "answer": {"answer": answer, "alternatives": alts or []}}
    row.update(extra)
    return row


def test_grade_one_correct_with_alternative_and_case():
    res = _grade_one(_qrow("FALSE", ["F"], explanation="x", skill_tag="detail"), "false")
    assert res["correct"] is True
    assert res["expected"] == "FALSE"
    assert res["explanation"] == "x"
    assert res["skill_tag"] == "detail"


def test_grade_one_incorrect():
    assert _grade_one(_qrow("FALSE", ["F"]), "TRUE")["correct"] is False


def test_grade_one_list_answer_any_match():
    res = _grade_one(_qrow(["A", "B"]), "b")
    assert res["correct"] is True
    assert "A" in res["expected"] and "B" in res["expected"]


def test_grade_one_blank_is_incorrect():
    assert _grade_one(_qrow("cascade"), "")["correct"] is False


# ── Student endpoints: auth-gating ────────────────────────────────────


def test_list_requires_auth():
    assert _client().get("/api/reading/vocab").status_code == 401


def test_detail_requires_auth():
    assert _client().get("/api/reading/vocab/some-slug").status_code == 401


def test_check_requires_auth():
    assert _client().post("/api/reading/vocab/some-slug/check", json={"answers": []}).status_code == 401


# ── Detail endpoint never selects the answer key ──────────────────────


def test_detail_does_not_select_answer_or_explanation():
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value
    chain.eq.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "pid", "slug": "s", "title": "T", "body_markdown": "b", "glossary": []}])
    chain.eq.return_value.order.return_value.execute.return_value = \
        MagicMock(data=[{"q_num": 1, "question_type": "short_answer", "prompt": "p",
                          "payload": {}, "skill_tag": "detail", "sub_skill": None, "order_num": 1}])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().get("/api/reading/vocab/s", headers=_AUTH)

    assert r.status_code == 200
    # No select() in the detail path may request the answer/explanation columns.
    for call in mock_db.table.return_value.select.call_args_list:
        cols = call.args[0] if call.args else ""
        assert "answer" not in cols
        assert "explanation" not in cols
    # And the returned questions carry no answer key.
    assert all("answer" not in q for q in r.json()["questions"])


def test_detail_strips_stepper_solution_from_payload():
    """P1 review fix: the L1 fetch has no post-check reveal path, so an authored
    payload.solution (its steps end in the answer) must be stripped pre-check."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value
    chain.eq.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "pid", "slug": "s", "title": "T", "body_markdown": "b", "glossary": []}])
    chain.eq.return_value.order.return_value.execute.return_value = \
        MagicMock(data=[{"q_num": 1, "question_type": "short_answer", "prompt": "p",
                          "payload": {"options": [], "solution": {
                              "solution_steps": [{"action": "confirm",
                                                  "instruction_vi": "Điền 'ritual'."}]}},
                          "skill_tag": "detail", "sub_skill": None, "order_num": 1}])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().get("/api/reading/vocab/s", headers=_AUTH)

    assert r.status_code == 200
    q0 = r.json()["questions"][0]
    assert "solution" not in q0["payload"]      # the answer-revealing steps are gone
    assert "options" in q0["payload"]           # other payload keys survive


# ── Check endpoint: end-to-end grading ────────────────────────────────


def test_check_grades_answers():
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value
    chain.eq.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "pid"}])
    chain.eq.return_value.execute.return_value = MagicMock(data=[
        {"q_num": 1, "answer": {"answer": "FALSE", "alternatives": ["F"]},
         "explanation": "blue", "skill_tag": "detail"},
    ])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().post("/api/reading/vocab/s/check", headers=_AUTH,
                           json={"answers": [{"q_num": 1, "user_answer": "false"}]})

    assert r.status_code == 200
    results = r.json()["results"]
    assert len(results) == 1
    assert results[0]["correct"] is True
    assert results[0]["expected"] == "FALSE"
    assert results[0]["explanation"] == "blue"


# ── Seed content is well-formed + importable ──────────────────────────


def test_seed_passages_parse_and_validate_clean():
    files = sorted(_CONTENT_DIR.glob("l1-*.md"))
    assert len(files) >= 2, "expected at least 2 seed L1 passages"
    for f in files:
        parsed = parse_reading_passage(f.read_text(encoding="utf-8"))
        errors = validate_reading_passage(parsed)
        assert errors == [], f"{f.name} has validation errors: {errors}"
        assert parsed.questions, f"{f.name} should ship light comprehension questions"
