"""Tests for Sprint 20.3 — L2 Skill Practice + admin reading list (cluster 20.x).

  • content_import_service generalisation (L1 + L2 share parse/validate/build;
    library is derived from content_type; skill_focus required for L2)
  • POST /admin/reading/content/import — now accepts reading_skill_exercise
  • GET  /admin/reading/content       — admin list across libraries (NEW)
  • GET  /api/reading/skill           — L2 list (auth-gated)
  • GET  /api/reading/skill/{slug}    — L2 detail (no answer-key leak)
  • POST /api/reading/skill/{slug}/check — L2 instant feedback grading
  • backend/content/reading/l2-*.md seeds parse + validate cleanly

DB + auth patched (no real DB), matching test_reading_l1.py.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from services.content_import_service import (
    build_reading_passage_payload,
    parse_reading_passage,
    validate_reading_passage,
)


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_AUTH = {"Authorization": "Bearer fake.user.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_USER = {"id": "00000000-0000-0000-0000-00000000bbbb", "email": "u@x"}

_CONTENT_DIR = Path(__file__).parent.parent / "content" / "reading"

_L2_MD = """---
content_type: reading_skill_exercise
title: L2 Test Exercise
slug: l2-test-exercise
skill_focus: skimming
difficulty_level: intermediate
topic_tags: [environment]
published: true
questions:
  - q_num: 1
    question_type: matching_headings
    prompt: Pick the best heading.
    options:
      - label: i
        text: First
      - label: ii
        text: Second
    answer: i
    skill_tag: skimming
    explanation: Paragraph 1 introduces the first point.
---
A short body that is long enough to pass validation.
"""


# ── Service: generalised L1 + L2 parse / validate / build ─────────────


def test_parse_l2_extracts_skill_focus():
    p = parse_reading_passage(_L2_MD)
    assert p.content_type == "reading_skill_exercise"
    assert p.skill_focus == "skimming"
    assert p.library == "l2_skill"          # derived from content_type
    assert p.as_preview()["library"] == "l2_skill"
    assert p.as_preview()["skill_focus"] == "skimming"


def test_validate_clean_l2_has_no_errors():
    assert validate_reading_passage(parse_reading_passage(_L2_MD)) == []


def test_validate_l2_requires_skill_focus():
    md = _L2_MD.replace("skill_focus: skimming\n", "")
    fields = {e["field"] for e in validate_reading_passage(parse_reading_passage(md))}
    assert "skill_focus" in fields


def test_validate_l2_rejects_unknown_skill_focus():
    md = _L2_MD.replace("skill_focus: skimming", "skill_focus: vibing")
    fields = {e["field"] for e in validate_reading_passage(parse_reading_passage(md))}
    assert "skill_focus" in fields


def test_build_l2_sets_library_and_skill_focus():
    p = parse_reading_passage(_L2_MD)
    payload = build_reading_passage_payload(p, p.slug)
    assert payload["library"] == "l2_skill"
    assert payload["skill_focus"] == "skimming"
    assert payload["status"] == "published"


def test_l1_still_derives_l1_vocab_library():
    """Regression: the Sprint 20.2 L1 build hard-coded library='l1_vocab'.
    After the 20.3 generalisation it's derived from content_type — same result."""
    p = parse_reading_passage(
        "---\ncontent_type: reading_passage_l1\ntitle: x\nslug: y\npublished: true\n---\nBody.\n"
    )
    payload = build_reading_passage_payload(p, "y")
    assert payload["library"] == "l1_vocab"
    assert payload["skill_focus"] is None       # not required for L1


# ── Admin list endpoint ───────────────────────────────────────────────


def test_admin_list_requires_auth():
    # No auth header → require_admin raises 401.
    assert _client().get("/admin/reading/content").status_code == 401


def test_admin_list_returns_items_with_library_filter():
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value
    chain.order.return_value.range.return_value.eq.return_value.execute.return_value = \
        MagicMock(data=[{"id": "p1", "slug": "x", "library": "l2_skill", "title": "X",
                          "status": "draft", "skill_focus": "skimming"}], count=1)

    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _client().get("/admin/reading/content?library=l2_skill", headers=_ADMIN_AUTH)

    assert r.status_code == 200
    body = r.json()
    assert body["items"][0]["library"] == "l2_skill"
    # The .eq() chain must have applied the library filter.
    eq_calls = mock_db.table.return_value.select.return_value.order.return_value.range.return_value.eq.call_args_list
    assert any(c.args[:2] == ("library", "l2_skill") for c in eq_calls)


def test_admin_list_rejects_unknown_library():
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().get("/admin/reading/content?library=nope", headers=_ADMIN_AUTH)
    assert r.status_code == 422


# ── L2 import via the admin endpoint (reuses 20.1/20.2 import wiring) ──


def _upload(md: str, qs: str = "", headers=None):
    files = {"file": ("p.md", md.encode("utf-8"), "text/markdown")}
    return _client().post("/admin/reading/content/import" + qs, files=files, headers=headers or {})


def test_import_l2_commit_persists_l2_skill_library_and_skill_focus():
    mock_db = MagicMock()
    sel = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    sel.execute.return_value = MagicMock(data=[])                       # new slug → insert
    mock_db.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{"id": "pid"}])

    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _upload(_L2_MD, "?dry_run=false", _ADMIN_AUTH)

    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["action"] == "created"
    # The passage insert (first dict-shaped insert call) must carry L2 library + skill_focus.
    dict_inserts = [c.args[0] for c in mock_db.table.return_value.insert.call_args_list
                    if isinstance(c.args[0], dict)]
    assert dict_inserts and dict_inserts[0]["library"] == "l2_skill"
    assert dict_inserts[0]["skill_focus"] == "skimming"


# ── L2 student endpoints: auth-gating ─────────────────────────────────


def test_l2_list_requires_auth():
    assert _client().get("/api/reading/skill").status_code == 401


def test_l2_detail_requires_auth():
    assert _client().get("/api/reading/skill/some-slug").status_code == 401


def test_l2_check_requires_auth():
    assert _client().post("/api/reading/skill/some-slug/check", json={"answers": []}).status_code == 401


# ── L2 detail does not select the answer key ──────────────────────────


def test_l2_detail_does_not_select_answer_or_explanation():
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value
    chain.eq.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "pid", "slug": "s", "title": "T", "body_markdown": "b",
                          "glossary": [], "skill_focus": "skimming"}])
    chain.eq.return_value.order.return_value.execute.return_value = \
        MagicMock(data=[{"q_num": 1, "question_type": "matching_headings", "prompt": "p",
                          "payload": {"options": []}, "skill_tag": "skimming",
                          "sub_skill": None, "order_num": 1}])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().get("/api/reading/skill/s", headers=_AUTH)

    assert r.status_code == 200
    for call in mock_db.table.return_value.select.call_args_list:
        cols = call.args[0] if call.args else ""
        assert "answer" not in cols
        assert "explanation" not in cols
    assert all("answer" not in q for q in r.json()["questions"])
    assert r.json()["skill_focus"] == "skimming"


# ── L2 check end-to-end grading ───────────────────────────────────────


def test_l2_check_grades_a_matching_headings_answer():
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value
    chain.eq.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "pid"}])
    chain.eq.return_value.execute.return_value = MagicMock(data=[
        {"q_num": 1, "answer": {"answer": "ii", "alternatives": []},
         "explanation": "Para 1 metaphor.", "skill_tag": "skimming"},
    ])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().post("/api/reading/skill/s/check", headers=_AUTH,
                           json={"answers": [{"q_num": 1, "user_answer": "II"}]})

    assert r.status_code == 200
    results = r.json()["results"]
    assert results[0]["correct"] is True
    assert results[0]["expected"] == "ii"
    assert results[0]["skill_tag"] == "skimming"


# ── Seed L2 content is well-formed + importable ───────────────────────


def test_seed_l2_passages_parse_and_validate_clean():
    files = sorted(_CONTENT_DIR.glob("l2-*.md"))
    assert files, "expected at least 1 seed L2 exercise"
    for f in files:
        parsed = parse_reading_passage(f.read_text(encoding="utf-8"))
        errors = validate_reading_passage(parsed)
        assert errors == [], f"{f.name} has validation errors: {errors}"
        assert parsed.library == "l2_skill"
        assert parsed.skill_focus, f"{f.name} should declare skill_focus"
        assert parsed.questions, f"{f.name} should ship skill-tagged questions"
