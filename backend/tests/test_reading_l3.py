"""Tests for Sprint 20.5 — L3 Full Test backend (cluster 20.x).

  • content_import_service — L3 parse / validate / build (pure)
  • POST /admin/reading/content/import — dispatches reading_full_test to L3
  • services/reading_test_grader — Academic band table + rollups + grade_attempt
  • routers/reading_student — L3 trio: list / detail (no-leak) / start / submit
  • Q5 server-guard at submit (elapsed > limit + grace → 422)
  • Seed L3 .md parses + validates cleanly

DB + auth patched (no real DB), matching test_reading_l1 / test_reading_l2.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from services.content_import_service import (
    build_reading_test_payloads,
    parse_reading_test,
    validate_reading_test,
)
from services.reading_test_grader import (
    band_estimate,
    by_part_breakdown,
    grade_attempt,
    rollup_skill_breakdown,
)


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_AUTH = {"Authorization": "Bearer fake.user.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_USER = {"id": "00000000-0000-0000-0000-00000000bbbb", "email": "u@x"}

_CONTENT_DIR = Path(__file__).parent.parent / "content" / "reading"


# Minimal valid L3 MD (3 small passages × 1 question, total_questions=3).
# Sprint 20.6.6 — rewritten from the v1-spec NESTED shape to the v2 FLAT
# shape (options at question top level, answer as a string). The original
# nested shape now fails validation loudly (F1/F2). See
# reading_content_format_v2.md §4 for the author contract.
_L3_MIN = """---
content_type: reading_full_test
test_id: TEST-MIN-001
title: Tiny Test
module: academic
time_limit_minutes: 60
passage_count: 3
total_questions: 3
published: true
passages:
  - passage_order: 1
    slug: tiny-t1-p1
    title: P1
    body_markdown: Body of passage 1 (long enough).
    questions:
      - q_num: 1
        question_type: true_false_not_given
        prompt: x
        answer: "TRUE"
        alternatives: ["T"]
        skill_tag: detail
  - passage_order: 2
    slug: tiny-t1-p2
    title: P2
    body_markdown: Body of passage 2 (long enough).
    questions:
      - q_num: 2
        question_type: short_answer
        prompt: x
        answer: cat
        skill_tag: scanning
  - passage_order: 3
    slug: tiny-t1-p3
    title: P3
    body_markdown: Body of passage 3 (long enough).
    questions:
      - q_num: 3
        question_type: mcq_single
        prompt: x
        options:
          - label: A
            text: a
          - label: B
            text: b
        answer: "A"
        skill_tag: main_idea
---
"""


# ── Service: L3 parse / validate / build ──────────────────────────────


def test_parse_l3_extracts_test_metadata_and_passages():
    p = parse_reading_test(_L3_MIN)
    assert p.content_type == "reading_full_test"
    assert p.test_id == "TEST-MIN-001"
    assert p.library == "l3_test"           # derived from content_type
    assert p.module == "academic"
    assert p.time_limit_minutes == 60
    assert len(p.passages) == 3
    preview = p.as_preview()
    assert preview["library"] == "l3_test"
    assert preview["question_count"] == 3
    assert len(preview["passages"]) == 3


def test_validate_clean_l3_no_errors():
    assert validate_reading_test(parse_reading_test(_L3_MIN)) == []


def test_validate_l3_rejects_wrong_content_type():
    bad = _L3_MIN.replace("content_type: reading_full_test", "content_type: reading_passage_l1")
    fields = {e["field"] for e in validate_reading_test(parse_reading_test(bad))}
    assert "content_type" in fields


def test_validate_l3_rejects_missing_test_id():
    bad = _L3_MIN.replace("test_id: TEST-MIN-001\n", "")
    fields = {e["field"] for e in validate_reading_test(parse_reading_test(bad))}
    assert "test_id" in fields


def test_validate_l3_flags_qnum_count_mismatch():
    bad = _L3_MIN.replace("total_questions: 3", "total_questions: 4")
    msgs = " ".join(e["message"] for e in validate_reading_test(parse_reading_test(bad)))
    assert "Tổng số" in msgs or "khác total_questions" in msgs


def test_validate_l3_flags_duplicate_qnum_across_passages():
    bad = _L3_MIN.replace("q_num: 2", "q_num: 1", 1)
    msgs = " ".join(e["message"] for e in validate_reading_test(parse_reading_test(bad)))
    assert "trùng" in msgs


def test_build_l3_payloads_emits_test_row_passage_rows_and_questions():
    p = parse_reading_test(_L3_MIN)
    plan = build_reading_test_payloads(p)
    assert plan["test_row"]["test_id"] == "TEST-MIN-001"
    assert plan["test_row"]["status"] == "published"
    assert plan["test_row"]["total_questions"] == 3
    assert len(plan["passage_rows"]) == 3
    assert all(pr["library"] == "l3_test" for pr in plan["passage_rows"])
    # The build emits questions WITHOUT a passage_id — the router fills it
    # after inserting the passage row (since the id is DB-assigned).
    pq = plan["passage_questions"]
    assert len(pq) == 3
    for _slug, q_rows in pq:
        assert q_rows and "passage_id" not in q_rows[0]


# ── Grader: Academic band table boundaries ────────────────────────────


def test_band_estimate_academic_boundaries():
    # Spot-check every threshold from the Academic table. The boundary is
    # "raw >= threshold" → band; immediately below moves to the next band.
    cases = [
        (40, 9.0), (39, 9.0), (38, 8.5), (37, 8.5),
        (36, 8.0), (35, 8.0), (34, 7.5), (33, 7.5),
        (32, 7.0), (30, 7.0), (29, 6.5), (27, 6.5),
        (26, 6.0), (23, 6.0), (22, 5.5), (19, 5.5),
        (18, 5.0), (15, 5.0), (14, 4.5), (13, 4.5),
        (12, 4.0), (10, 4.0), (9, 3.5), (8, 3.5),
        (7, 3.0), (6, 3.0), (5, 2.5), (4, 2.5),
    ]
    for raw, band in cases:
        assert band_estimate(raw) == band, f"raw={raw} expected band={band}"


def test_band_estimate_below_table_is_none():
    assert band_estimate(3) is None
    assert band_estimate(0) is None


def test_band_estimate_general_training_is_phase_b_none():
    # Phase-B gate per Sprint 20.5 commission: GT returns None until its own
    # table ships, so the API surfaces the gap rather than mis-estimating.
    assert band_estimate(35, module="general_training") is None


# ── Grader: rollups + grade_attempt ───────────────────────────────────


def test_rollup_skill_breakdown_buckets_by_tag():
    results = [
        {"skill_tag": "detail",   "correct": True},
        {"skill_tag": "detail",   "correct": False},
        {"skill_tag": "skimming", "correct": True},
        {"skill_tag": None,       "correct": True},      # ignored
    ]
    out = rollup_skill_breakdown(results)
    assert out["detail"] == {"correct": 1, "total": 2}
    assert out["skimming"] == {"correct": 1, "total": 1}
    assert "None" not in out


def test_by_part_breakdown_groups_by_passage_order():
    results = [
        {"passage_order": 1, "correct": True},
        {"passage_order": 1, "correct": False},
        {"passage_order": 2, "correct": True},
        {"passage_order": 3, "correct": True},
        {"passage_order": 3, "correct": True},
    ]
    out = by_part_breakdown(results)
    assert out["p1"] == {"correct": 1, "total": 2}
    assert out["p2"] == {"correct": 1, "total": 1}
    assert out["p3"] == {"correct": 2, "total": 2}


def test_grade_attempt_end_to_end():
    answer_key = [
        {"q_num": 1, "answer": "TRUE",  "alternatives": ["T"], "skill_tag": "detail",   "passage_order": 1, "explanation": "x"},
        {"q_num": 2, "answer": "cat",   "alternatives": [],     "skill_tag": "scanning", "passage_order": 2, "explanation": None},
        {"q_num": 3, "answer": "A",     "alternatives": [],     "skill_tag": "main_idea","passage_order": 3, "explanation": None},
    ]
    user_answers = [
        {"q_num": 1, "user_answer": "true"},   # correct (case-insensitive)
        {"q_num": 2, "user_answer": "dog"},    # incorrect
        # q_num=3 missing → incorrect
    ]
    result = grade_attempt(user_answers, answer_key)
    assert result["score"] == 1
    assert result["max_score"] == 3
    # Band table doesn't cover scores < 4 → None
    assert result["band_estimate"] is None
    assert result["skill_breakdown"]["detail"]["correct"] == 1
    assert result["skill_breakdown"]["scanning"]["correct"] == 0
    assert result["skill_breakdown"]["main_idea"]["correct"] == 0
    assert result["by_part"]["p1"]["correct"] == 1
    assert result["by_part"]["p3"]["total"] == 1


def test_grade_attempt_full_marks_returns_band_9():
    answer_key = [
        {"q_num": i, "answer": "A", "alternatives": [], "skill_tag": "detail", "passage_order": 1}
        for i in range(1, 41)
    ]
    user_answers = [{"q_num": i, "user_answer": "A"} for i in range(1, 41)]
    result = grade_attempt(user_answers, answer_key)
    assert result["score"] == 40 and result["max_score"] == 40
    assert result["band_estimate"] == 9.0


# ── L3 endpoints: auth-gating ─────────────────────────────────────────


def test_l3_list_requires_auth():
    assert _client().get("/api/reading/test").status_code == 401


def test_l3_detail_requires_auth():
    assert _client().get("/api/reading/test/some-id").status_code == 401


def test_l3_start_requires_auth():
    assert _client().post("/api/reading/test/some-id/attempts").status_code == 401


def test_l3_submit_requires_auth():
    assert _client().post("/api/reading/test/attempts/some-uuid/submit",
                          json={"answers": []}).status_code == 401


# ── L3 detail: never selects answer + explanation columns ─────────────


def test_l3_detail_strips_answer_keys_via_column_selection():
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value
    # 1) _fetch_published_test: select.eq.eq.limit.execute
    chain.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "test-uuid", "test_id": "T1", "title": "T", "module": "academic",
                          "time_limit_minutes": 60, "passage_count": 3, "total_questions": 40,
                          "band_target": None, "status": "published"}])
    # 2) passages: select.eq.eq.order.execute
    chain.eq.return_value.eq.return_value.order.return_value.execute.return_value = \
        MagicMock(data=[{"id": "p1", "passage_order": 1, "slug": "s", "title": "P",
                          "body_markdown": "b"}])
    # 3) questions: select.in_.order.execute
    chain.in_.return_value.order.return_value.execute.return_value = \
        MagicMock(data=[{"q_num": 1, "question_type": "true_false_not_given", "prompt": "p",
                          "payload": {}, "skill_tag": "detail", "sub_skill": None,
                          "order_num": 1, "passage_id": "p1"}])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().get("/api/reading/test/T1", headers=_AUTH)

    assert r.status_code == 200
    # No select() call may name the answer or explanation columns.
    for call in mock_db.table.return_value.select.call_args_list:
        cols = call.args[0] if call.args else ""
        assert "answer" not in cols
        assert "explanation" not in cols
    body = r.json()
    assert all("answer" not in q for q in body["questions"])
    # passage_order stamped onto each question for the UI.
    assert body["questions"][0]["passage_order"] == 1


# ── L3 submit: time-limit guard ───────────────────────────────────────


def test_l3_submit_rejects_when_elapsed_exceeds_limit_plus_grace():
    from datetime import datetime, timezone, timedelta

    # Attempt started 2 hours ago; time_limit_minutes=60 + 5 min grace = 65 min.
    started_long_ago = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()

    # Use a TestClient that surfaces server exceptions as 500 responses
    # rather than re-raising them through pytest — fragile mocks below can
    # crash mid-handler and we want to inspect the response either way.
    from main import app as _app
    from fastapi.testclient import TestClient as _TC
    client = _TC(_app, raise_server_exceptions=False)

    mock_db = MagicMock()
    # Use side_effect so the two select chains return DIFFERENT data:
    # call 1 = _fetch_attempt_or_404 (attempt row), call 2 = test_row fetch.
    attempt_row = {
        "id": "a-uuid", "user_id": _USER["id"], "test_id": "t-uuid",
        "status": "in_progress", "started_at": started_long_ago, "answers": [],
    }
    test_row = {"id": "t-uuid", "test_id": "T1", "time_limit_minutes": 60, "module": "academic"}
    execute_returns = [MagicMock(data=[attempt_row]), MagicMock(data=[test_row])]
    mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.side_effect = execute_returns

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = client.post("/api/reading/test/attempts/a-uuid/submit",
                        headers=_AUTH, json={"answers": []})

    # The Q5 server-guard MUST fire: elapsed (~7200s) > 60 min + 5 min grace.
    assert r.status_code == 422
    assert "expired" in (r.json().get("detail") or "").lower()


# ── Seed L3 content is well-formed + importable ───────────────────────


def test_seed_l3_test_parses_and_validates_clean():
    files = sorted(_CONTENT_DIR.glob("l3-*.md"))
    assert files, "expected at least 1 L3 seed file"
    for f in files:
        parsed = parse_reading_test(f.read_text(encoding="utf-8"))
        errors = validate_reading_test(parsed)
        assert errors == [], f"{f.name} has validation errors: {errors}"
        assert parsed.library == "l3_test"
        assert parsed.passage_count == 3
        # The seed should ship a complete test (40 Qs across 3 passages).
        total_qs = sum(len(p.get("questions") or []) for p in parsed.passages)
        assert total_qs == parsed.total_questions == 40


# ── L3 import endpoint dispatches reading_full_test to L3 handler ─────


def _upload(md: str, qs: str = "", headers=None):
    files = {"file": ("test.md", md.encode("utf-8"), "text/markdown")}
    return _client().post("/admin/reading/content/import" + qs, files=files, headers=headers or {})


def test_import_l3_dry_run_shows_passage_summaries():
    mock_db = MagicMock()
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _upload(_L3_MIN, "?dry_run=true", _ADMIN_AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["dry_run"] is True
    assert body["committed_id"] is None
    assert body["validation_errors"] == []
    assert body["parsed_data"]["library"] == "l3_test"
    assert body["parsed_data"]["question_count"] == 3
    assert len(body["parsed_data"]["passages"]) == 3
    mock_db.table.return_value.insert.assert_not_called()


# ── Sprint 20.6 — resilience endpoints (PATCH /answers + GET in-progress) ─


def test_resume_in_progress_requires_auth():
    assert _client().get("/api/reading/test/T1/attempts/in-progress").status_code == 401


def test_patch_answers_requires_auth():
    assert _client().patch("/api/reading/test/attempts/some-uuid/answers",
                           json={"q_num": 1, "user_answer": "A"}).status_code == 401


def test_resume_returns_open_attempt_when_one_exists():
    """Sprint 20.9 D3: the resume payload hydrates answers from the new
    `reading_attempt_answers` table (mig 088), not from the in_progress
    row's JSONB array."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value
    # _fetch_published_test: select.eq.eq.limit.execute (status=published)
    chain.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "test-uuid", "test_id": "T1", "title": "T", "module": "academic",
                          "time_limit_minutes": 60, "passage_count": 3, "total_questions": 40,
                          "band_target": None, "status": "published"}])
    # in-progress lookup (reading_test_attempts): select.eq.eq.eq.order.limit.execute
    chain.eq.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "a-uuid", "started_at": "2026-05-28T10:00:00+00:00",
                          "status": "in_progress"}])
    # 20.9 — per-q_num answers fetch (reading_attempt_answers): select.eq.order.execute
    chain.eq.return_value.order.return_value.execute.return_value = \
        MagicMock(data=[{"q_num": 1, "user_answer": "A",
                          "answered_at": "2026-05-28T10:01:00+00:00"}])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().get("/api/reading/test/T1/attempts/in-progress", headers=_AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["attempt_id"] == "a-uuid"
    assert body["time_limit_minutes"] == 60
    assert body["answers"] == [{
        "q_num": 1, "user_answer": "A",
        "answered_at": "2026-05-28T10:01:00+00:00",
    }]


def test_resume_404_when_no_in_progress_attempt():
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value
    # Test exists (published).
    chain.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "test-uuid", "test_id": "T1", "title": "T", "module": "academic",
                          "time_limit_minutes": 60, "passage_count": 3, "total_questions": 40,
                          "band_target": None, "status": "published"}])
    # No in-progress attempt for this user+test.
    chain.eq.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().get("/api/reading/test/T1/attempts/in-progress", headers=_AUTH)
    assert r.status_code == 404


def test_patch_answers_upserts_by_qnum_when_in_progress():
    """Sprint 20.9 D3: PATCH /answers writes to the new
    `reading_attempt_answers` table as a single PK upsert (atomic). The pre-
    20.9 read-modify-write against reading_test_attempts.answers JSONB is
    GONE — no .update() of the attempt row, no read-modify-write window."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value
    # _fetch_attempt_or_404: select.eq.limit.execute returns the attempt row.
    chain.select.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{
            "id": "a-uuid", "user_id": _USER["id"], "test_id": "t-uuid",
            "status": "in_progress",
        }])
    # Echo count fetch (after the upsert) — select.eq.execute returns row count.
    chain.select.return_value.eq.return_value.execute.return_value = \
        MagicMock(data=[{"q_num": 1}], count=1)

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().patch("/api/reading/test/attempts/a-uuid/answers",
                            headers=_AUTH, json={"q_num": 1, "user_answer": "NEW"})

    assert r.status_code == 200
    # The handler must NOT update the attempt row's answers JSONB anymore.
    chain.update.assert_not_called()
    # It MUST upsert into reading_attempt_answers with the (attempt_id, q_num)
    # PK conflict target (atomic by construction — no race with other q_nums).
    upsert_call = chain.upsert.call_args
    assert upsert_call is not None, "upsert was not called"
    payload = upsert_call.args[0]
    assert payload["attempt_id"] == "a-uuid"
    assert payload["q_num"] == 1
    assert payload["user_answer"] == "NEW"
    assert "answered_at" in payload
    # Confirm the conflict target was the composite PK so PostgREST resolves
    # against (attempt_id, q_num), not just attempt_id.
    assert upsert_call.kwargs.get("on_conflict") == "attempt_id,q_num"
    # The body shape returned to the client is small + non-leaking.
    body = r.json()
    assert body["attempt_id"] == "a-uuid"
    assert body["q_num"] == 1


def test_patch_answers_rejects_when_attempt_already_submitted():
    """Sprint 20.9 D3: the upsert path still respects the in_progress gate."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value
    chain.select.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{
            "id": "a-uuid", "user_id": _USER["id"], "test_id": "t-uuid",
            "status": "submitted",      # final state
        }])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().patch("/api/reading/test/attempts/a-uuid/answers",
                            headers=_AUTH, json={"q_num": 1, "user_answer": "X"})
    assert r.status_code == 422
    chain.update.assert_not_called()
    chain.upsert.assert_not_called()


def test_patch_answers_rejects_qnum_out_of_range():
    """Pydantic ge=1, le=40 — q_num outside that range = 422 before any DB hit."""
    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)):
        r = _client().patch("/api/reading/test/attempts/a-uuid/answers",
                            headers=_AUTH, json={"q_num": 99, "user_answer": "X"})
    assert r.status_code == 422


# ── Sprint Perf-1 — combined Reading boot endpoint ─────────────────────


def test_l3_boot_requires_auth():
    assert _client().get("/api/reading/test/T1/boot").status_code == 401


def test_l3_boot_returns_test_and_resume_payload_without_answer_keys():
    """Perf-1: the combined boot endpoint replaces the frontend waterfall
    without weakening answer-key stripping or resume hydration."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value
    # _fetch_published_test: select.eq.eq.limit.execute
    chain.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "test-uuid", "test_id": "T1", "title": "T", "module": "academic",
                          "time_limit_minutes": 60, "passage_count": 3, "total_questions": 40,
                          "band_target": None, "status": "published"}])
    # passages: select.eq.eq.order.execute
    chain.eq.return_value.eq.return_value.order.return_value.execute.return_value = \
        MagicMock(data=[{"id": "p1", "passage_order": 1, "slug": "s", "title": "P",
                          "body_markdown": "b"}])
    # questions: select.in_.order.execute
    chain.in_.return_value.order.return_value.execute.return_value = \
        MagicMock(data=[{"q_num": 1, "question_type": "true_false_not_given", "prompt": "p",
                          "payload": {}, "skill_tag": "detail", "sub_skill": None,
                          "order_num": 1, "passage_id": "p1"}])
    # in-progress lookup: select.eq.eq.eq.order.limit.execute
    chain.eq.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "a-uuid", "started_at": "2026-05-28T10:00:00+00:00",
                          "status": "in_progress"}])
    # per-q_num answers: select.eq.order.execute
    chain.eq.return_value.order.return_value.execute.return_value = \
        MagicMock(data=[{"q_num": 1, "user_answer": "A",
                          "answered_at": "2026-05-28T10:01:00+00:00"}])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().get("/api/reading/test/T1/boot", headers=_AUTH)

    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"test", "in_progress"}
    assert body["test"]["test_id"] == "T1"
    assert body["test"]["questions"][0]["passage_order"] == 1
    assert all("answer" not in q for q in body["test"]["questions"])
    assert all("explanation" not in q for q in body["test"]["questions"])
    assert body["in_progress"] == {
        "attempt_id": "a-uuid",
        "test_id": "T1",
        "status": "in_progress",
        "started_at": "2026-05-28T10:00:00+00:00",
        "answers": [{
            "q_num": 1, "user_answer": "A",
            "answered_at": "2026-05-28T10:01:00+00:00",
        }],
        "time_limit_minutes": 60,
    }
    # The attempts query must remain user-scoped (RLS/application guard).
    assert any(c.args == ("user_id", _USER["id"]) for c in chain.eq.call_args_list)
    for call in mock_db.table.return_value.select.call_args_list:
        cols = call.args[0] if call.args else ""
        if "q_num,question_type" in cols:
            assert "answer" not in cols
            assert "explanation" not in cols


def test_l3_boot_returns_null_resume_when_no_in_progress_attempt():
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value
    chain.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "test-uuid", "test_id": "T1", "title": "T", "module": "academic",
                          "time_limit_minutes": 60, "passage_count": 3, "total_questions": 40,
                          "band_target": None, "status": "published"}])
    chain.eq.return_value.eq.return_value.order.return_value.execute.return_value = \
        MagicMock(data=[])
    chain.eq.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[])

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().get("/api/reading/test/T1/boot", headers=_AUTH)

    assert r.status_code == 200
    body = r.json()
    assert body["test"]["test_id"] == "T1"
    assert body["test"]["passages"] == []
    assert body["test"]["questions"] == []
    assert body["in_progress"] is None
