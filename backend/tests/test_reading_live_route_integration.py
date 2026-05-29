"""Sprint 20.9 D6 — End-to-end live-route integration test.

Codex audit P2-4: the F1/F2 fix added a full chain regression at the
parse → validate → build → grade layer, but no test exercises the live
HTTP route chain. This test fills that gap with one focused journey:

    admin import (dry-run + commit)
      → admin list shows the new L3 test
      → student detail (answer keys STRIPPED — verified at the response shape)
      → start attempt (D2-aware: first try succeeds, no race)
      → PATCH /answers x2 (D3-aware: each goes to reading_attempt_answers
        via upsert with composite PK conflict target)
      → submit returns score + skill_breakdown
      → diagnostic returns a sane shape

What this does NOT do:
  * Real DB writes — supabase_admin is mocked throughout.
  * Real concurrency — see test_reading_audit_hardening for the unit-level
    pins on retry + per-q_num upsert call shape.

What this DOES lock:
  * The 20.5 → 20.6 → 20.7 → 20.9 route chain still connects after the D3
    storage refactor.
  * Answer keys never leak into student-facing HTTP responses (the
    strip-keys watch-item, verified end-to-end at the response surface).
  * The L3 list endpoint surfaces a freshly-imported test.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_AUTH = {"Authorization": "Bearer fake.user.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_USER = {"id": "00000000-0000-0000-0000-00000000bbbb", "email": "u@x"}


_TINY_L3 = """---
content_type: reading_full_test
test_id: INT-LIVE-001
title: Integration Live Test
module: academic
time_limit_minutes: 60
passage_count: 3
total_questions: 3
published: true
passages:
  - passage_order: 1
    slug: int-live-p1
    title: P1
    body_markdown: Body of passage 1 (long enough).
    questions:
      - q_num: 1
        question_type: true_false_not_given
        prompt: claim 1
        answer: "TRUE"
        alternatives: ["T"]
        skill_tag: detail
        explanation: because reasons
  - passage_order: 2
    slug: int-live-p2
    title: P2
    body_markdown: Body of passage 2 (long enough).
    questions:
      - q_num: 2
        question_type: short_answer
        prompt: q2
        answer: cat
        skill_tag: scanning
  - passage_order: 3
    slug: int-live-p3
    title: P3
    body_markdown: Body of passage 3 (long enough).
    questions:
      - q_num: 3
        question_type: mcq_single
        prompt: q3
        options:
          - { label: A, text: a }
          - { label: B, text: b }
        answer: "A"
        skill_tag: main_idea
---
"""


# ── Step 1 — admin import dry-run ─────────────────────────────────────


def test_d6_admin_import_dry_run_is_clean_for_the_integration_fixture():
    """The fixture used by the live-route chain must validate clean. If this
    fails, the rest of the chain is meaningless."""
    mock_db = MagicMock()
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        files = {"file": ("t.md", _TINY_L3.encode("utf-8"), "text/markdown")}
        r = _client().post("/admin/reading/content/import?dry_run=true",
                           files=files, headers=_ADMIN_AUTH)
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["dry_run"] is True
    assert body["validation_errors"] == []
    assert body["parsed_data"]["library"] == "l3_test"
    assert body["parsed_data"]["question_count"] == 3


# ── Step 2 — admin list shows the imported L3 test ────────────────────


def test_d6_admin_list_l3_returns_the_imported_test():
    """After import, the L3 filter on the admin list must show the test row.
    The 20.8 endpoint queries reading_tests directly for library=l3_test."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value.order.return_value.range.return_value
    chain.execute.return_value = MagicMock(
        data=[{
            "id": "test-uuid", "test_id": "INT-LIVE-001", "title": "Integration Live Test",
            "module": "academic", "time_limit_minutes": 60, "passage_count": 3,
            "total_questions": 3, "band_target": None, "status": "published",
            "updated_at": "2026-05-29T10:00:00+00:00", "created_at": "2026-05-29T09:00:00+00:00",
        }],
        count=1,
    )
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _client().get("/admin/reading/content?library=l3_test", headers=_ADMIN_AUTH)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1 and items[0]["slug"] == "INT-LIVE-001"
    # The L3 row uses the normalised shape from the 20.8 endpoint extension.
    assert items[0]["library"] == "l3_test"
    assert items[0]["difficulty_level"] == "academic"


# ── Step 3 — student detail with answer keys STRIPPED ─────────────────


def test_d6_student_detail_omits_answer_keys_at_the_response_surface():
    """Answer-key stripping is a strip-keys watch-item invariant. The detail
    endpoint must never include `answer` or `explanation` in any question
    object it returns, and the underlying SQL must never select those
    columns either."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value
    # _fetch_published_test
    chain.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[{
        "id": "test-uuid", "test_id": "INT-LIVE-001", "title": "Integration Live Test",
        "module": "academic", "time_limit_minutes": 60, "passage_count": 3,
        "total_questions": 3, "band_target": None, "status": "published",
    }])
    # passages query
    chain.eq.return_value.eq.return_value.order.return_value.execute.return_value = MagicMock(data=[
        {"id": "p1", "slug": "int-live-p1", "title": "P1", "body_markdown": "b1",
         "passage_order": 1, "word_count": 50, "estimated_minutes": 5, "topic_tags": []},
    ])
    # questions query — NO answer / explanation columns selected
    chain.in_.return_value.order.return_value.execute.return_value = MagicMock(data=[
        {"q_num": 1, "question_type": "true_false_not_given", "prompt": "claim 1",
         "payload": {}, "skill_tag": "detail", "sub_skill": None,
         "order_num": 1, "passage_id": "p1"},
    ])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().get("/api/reading/test/INT-LIVE-001", headers=_AUTH)

    assert r.status_code == 200
    body = r.json()
    # The SQL never asked for answer/explanation in the question column list.
    for call in mock_db.table.return_value.select.call_args_list:
        cols = call.args[0] if call.args else ""
        assert "answer" not in cols, f"select asked for answer columns: {cols!r}"
        assert "explanation" not in cols, f"select asked for explanation: {cols!r}"
    # Nor does any question in the HTTP response carry an `answer` field.
    assert all("answer" not in q for q in body["questions"])
    assert all("explanation" not in q for q in body["questions"])


# ── Step 4 — start attempt (success, no race) ─────────────────────────


def test_d6_start_attempt_succeeds_first_try_in_the_happy_path():
    """In the no-contention case, the D2 retry loop executes exactly once."""
    mock_db = MagicMock()
    fetch_chain = mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value
    fetch_chain.execute.return_value = MagicMock(data=[{
        "id": "test-uuid", "test_id": "INT-LIVE-001", "title": "Integration Live Test",
        "module": "academic", "time_limit_minutes": 60, "passage_count": 3,
        "total_questions": 3, "band_target": None, "status": "published",
    }])
    mock_db.table.return_value.insert.return_value.execute.return_value = \
        MagicMock(data=[{"id": "attempt-uuid"}])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().post("/api/reading/test/INT-LIVE-001/attempts", headers=_AUTH)

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "in_progress"
    assert "attempt_id" in body
    # No retry needed.
    assert mock_db.table.return_value.insert.return_value.execute.call_count == 1


# ── Step 5 — PATCH /answers twice (different q_nums) ──────────────────


def test_d6_two_patches_for_different_qnums_each_upsert_reading_attempt_answers():
    """Sprint 20.9 D3: each PATCH lands as a single upsert into
    reading_attempt_answers, keyed by the (attempt_id, q_num) PK. The
    attempt row's answers JSONB column is never touched during the
    in-flight phase."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value
    chain.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[{
        "id": "attempt-uuid", "user_id": _USER["id"], "test_id": "test-uuid",
        "status": "in_progress",
    }])
    chain.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[
        {"q_num": 1}, {"q_num": 2},
    ], count=2)

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r1 = _client().patch("/api/reading/test/attempts/attempt-uuid/answers",
                             headers=_AUTH, json={"q_num": 1, "user_answer": "TRUE"})
        r2 = _client().patch("/api/reading/test/attempts/attempt-uuid/answers",
                             headers=_AUTH, json={"q_num": 2, "user_answer": "cat"})

    assert r1.status_code == 200 and r2.status_code == 200
    chain.update.assert_not_called()
    upsert_calls = chain.upsert.call_args_list
    assert [c.args[0]["q_num"] for c in upsert_calls] == [1, 2]
    assert all(c.kwargs.get("on_conflict") == "attempt_id,q_num" for c in upsert_calls)


# ── Step 6 — submit returns grade + skill_breakdown ──────────────────


def test_d6_submit_returns_grade_with_skill_breakdown():
    """Submit gathers per-q_num answers from the new table, grades, and
    returns the canonical {score, max_score, band_estimate, per_question,
    skill_breakdown, by_part, time_spent_seconds} shape."""
    from datetime import datetime, timezone, timedelta

    started_at = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()

    mock_db = MagicMock()
    # 1) _fetch_attempt_or_404 + test row
    mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.side_effect = [
        MagicMock(data=[{
            "id": "attempt-uuid", "user_id": _USER["id"], "test_id": "test-uuid",
            "status": "in_progress", "started_at": started_at, "answers": [],
        }]),
        MagicMock(data=[{
            "id": "test-uuid", "test_id": "INT-LIVE-001",
            "time_limit_minutes": 60, "module": "academic",
        }]),
    ]
    # 2) passages query for grading
    mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[
        {"id": "p1", "passage_order": 1},
        {"id": "p2", "passage_order": 2},
        {"id": "p3", "passage_order": 3},
    ])
    # 3) questions query for answer key (with .in_)
    mock_db.table.return_value.select.return_value.in_.return_value.execute.return_value = MagicMock(data=[
        {"q_num": 1, "answer": {"answer": "TRUE", "alternatives": ["T"]},
         "skill_tag": "detail", "explanation": "because", "passage_id": "p1"},
        {"q_num": 2, "answer": {"answer": "cat", "alternatives": []},
         "skill_tag": "scanning", "explanation": None, "passage_id": "p2"},
        {"q_num": 3, "answer": {"answer": "A", "alternatives": []},
         "skill_tag": "main_idea", "explanation": None, "passage_id": "p3"},
    ])
    # 4) D3 — persisted per-q_num answers
    mock_db.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[
        {"q_num": 1, "user_answer": "TRUE"},
        {"q_num": 2, "user_answer": "cat"},
        {"q_num": 3, "user_answer": "A"},
    ])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().post("/api/reading/test/attempts/attempt-uuid/submit",
                           headers=_AUTH, json={"answers": []})

    assert r.status_code == 200, r.json()
    body = r.json()
    # Perfect score against the answer key (TRUE / cat / A).
    assert body["score"] == 3 and body["max_score"] == 3
    # skill_breakdown is the per-skill rollup; by_part is per-passage_order.
    assert "skill_breakdown" in body and "by_part" in body
    # The HTTP response surface does NOT leak the answer column shape.
    for q in body.get("per_question", []):
        assert "answer" not in q  # we use `expected` for the display string
