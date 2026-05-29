"""Sprint 20.9 — Codex audit hardening regression tests (D1 + D2 + D3 + D4 + D5).

Each test names the audit finding it closes. The integration-style D6 test
lives separately at `test_reading_live_route_integration.py`.

Why concurrency tests with MagicMock:
The supabase-py client is mocked across the reading suite, so we can't run
true PostgreSQL row locks here. What we CAN pin is the call shape that makes
concurrency impossible at the DB layer:
  * D2 — the router catches unique-constraint violations and retries the
    abandon-then-insert sequence. We assert the retry behavior.
  * D3 — the router calls `.upsert()` on `reading_attempt_answers` with
    `on_conflict="attempt_id,q_num"`. PostgreSQL's UPSERT is atomic by
    PK design, so we assert the call shape rather than simulate locks.
The migration (`088_reading_attempt_hardening.sql`) is the actual DB layer.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from services.content_import_service import parse_reading_test, build_reading_test_payloads
from services.reading_diagnostic_engine import _diagnostic_level


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_AUTH = {"Authorization": "Bearer fake.user.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_USER = {"id": "00000000-0000-0000-0000-00000000bbbb", "email": "u@x"}


# ── D1 — L3 passage reconciliation (audit P1-1) ───────────────────────


_L3_TWO_PASSAGES = """---
content_type: reading_full_test
test_id: TEST-RECONCILE-001
title: Reconcile Test
module: academic
time_limit_minutes: 60
passage_count: 2
total_questions: 2
published: true
passages:
  - passage_order: 1
    slug: reconcile-p1-kept
    title: Kept
    body_markdown: Body of kept passage (long enough).
    questions:
      - q_num: 1
        question_type: true_false_not_given
        prompt: x
        answer: "TRUE"
        alternatives: ["T"]
        skill_tag: detail
  - passage_order: 2
    slug: reconcile-p2-also-kept
    title: Also Kept
    body_markdown: Body of also-kept passage (long enough).
    questions:
      - q_num: 2
        question_type: short_answer
        prompt: x
        answer: cat
        skill_tag: scanning
---
"""


def _upload(md: str, qs: str = "?dry_run=false", headers=None):
    files = {"file": ("test.md", md.encode("utf-8"), "text/markdown")}
    return _client().post("/admin/reading/content/import" + qs, files=files,
                          headers=headers or {})


def test_d1_l3_reimport_deletes_passage_removed_from_source():
    """Codex audit P1-1: when an admin re-uploads an L3 test with a passage
    REMOVED from the source file, the orphan reading_passages row attached
    to the test_id must be deleted. ON DELETE CASCADE on reading_questions
    handles the questions."""
    mock_db = MagicMock()

    # 1) reading_tests existence check (used by _import_l3_full_test step 1).
    test_exist_chain = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    test_exist_chain.execute.return_value = MagicMock(
        data=[{"id": "test-uuid"}],     # the test already exists → update path
    )
    # 2a) existing passages lookup — the test row currently has THREE passages
    #     (slug A, B, C), but the incoming payload only has A + B. C must be
    #     deleted by the reconciliation step.
    #     Path: .table("reading_passages").select("id,slug").eq("test_id",...).eq("library",...).execute
    existing_pass_chain = mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value
    existing_pass_chain.execute.return_value = MagicMock(data=[
        {"id": "p-a-uuid", "slug": "reconcile-p1-kept"},
        {"id": "p-b-uuid", "slug": "reconcile-p2-also-kept"},
        {"id": "p-c-uuid", "slug": "reconcile-p3-REMOVED"},   # ← orphan
    ])
    # 2b) per-slug existing check during upsert — return data so update path runs.
    # The same chain is reused; existing_pass_chain.execute serves the
    # subsequent per-slug existence checks too. Make them all return a row so
    # the upsert hits update, not insert.

    # 3) insert returns
    mock_db.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": "fake-pid"}],
    )

    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _upload(_L3_TWO_PASSAGES, "?dry_run=false", _ADMIN_AUTH)

    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["validation_errors"] == []
    assert body["action"] == "updated"
    # The removed slug is recorded in the response for operator visibility.
    assert "reconcile-p3-REMOVED" in (body.get("removed_passage_slugs") or [])

    # The orphan passage row was deleted (delete chain hit p-c-uuid).
    delete_calls = mock_db.table.return_value.delete.return_value.eq.call_args_list
    # We expect at least one delete by id targeting the orphan, AND the
    # standard delete-by-passage_id for reading_questions on the kept passages.
    deleted_ids = [c.args[1] for c in delete_calls if c.args[:1] == ("id",)]
    assert "p-c-uuid" in deleted_ids, (
        f"orphan passage p-c-uuid was not deleted; deletes by id: {deleted_ids}"
    )


def test_d1_l3_reimport_unchanged_passages_no_extra_delete():
    """Idempotency regression: when the re-uploaded file has EXACTLY the same
    passages as the existing test, the reconciliation step deletes none of
    them. (It still deletes reading_questions per passage for the
    delete-then-insert question replacement — that's separate.)"""
    mock_db = MagicMock()

    test_exist_chain = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    test_exist_chain.execute.return_value = MagicMock(data=[{"id": "test-uuid"}])

    existing_pass_chain = mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value
    existing_pass_chain.execute.return_value = MagicMock(data=[
        {"id": "p-a-uuid", "slug": "reconcile-p1-kept"},
        {"id": "p-b-uuid", "slug": "reconcile-p2-also-kept"},
    ])
    mock_db.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": "fake-pid"}],
    )

    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _upload(_L3_TWO_PASSAGES, "?dry_run=false", _ADMIN_AUTH)

    assert r.status_code == 200
    body = r.json()
    assert body["validation_errors"] == []
    assert body.get("removed_passage_slugs") == []
    # No delete-by-id was issued for a passage row (only delete-by-passage_id
    # for the reading_questions replacement, which is the existing behavior).
    delete_calls = mock_db.table.return_value.delete.return_value.eq.call_args_list
    deleted_ids = [c.args[1] for c in delete_calls if c.args[:1] == ("id",)]
    assert deleted_ids == [], (
        f"no passage rows should be deleted on unchanged re-import; got: {deleted_ids}"
    )


def test_d1_l3_first_import_no_existing_passages_no_delete():
    """When the test is created (not updated), the existing-passage lookup
    returns empty and the reconciliation step is a no-op."""
    mock_db = MagicMock()
    test_exist_chain = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    test_exist_chain.execute.return_value = MagicMock(data=[])    # test row does not exist → insert path
    existing_pass_chain = mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value
    existing_pass_chain.execute.return_value = MagicMock(data=[])  # no existing passages
    mock_db.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": "fake-pid"}],
    )

    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _upload(_L3_TWO_PASSAGES, "?dry_run=false", _ADMIN_AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["action"] == "created"
    assert body.get("removed_passage_slugs") == []


# ── D2 — Q7 invariant: concurrent-start retry semantics (audit P1-2) ──


class _FakeUniqueViolation(Exception):
    """Stand-in for supabase-py's APIError carrying PG code 23505."""
    code = "23505"

    def __str__(self):
        return 'duplicate key value violates unique constraint "uniq_reading_test_attempts_active"'


def test_d2_start_retries_on_unique_violation_until_insert_succeeds():
    """Codex audit P1-2: when a concurrent POST races us and inserts an
    in_progress row between our abandon and our insert, our insert hits the
    partial unique index `uniq_reading_test_attempts_active`. The handler
    catches the unique violation, loops, re-abandons (which now sees and
    abandons the racer's row), and inserts successfully."""
    from unittest.mock import call

    mock_db = MagicMock()
    # The test fetch in _fetch_published_test:
    fetch_chain = mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value
    fetch_chain.execute.return_value = MagicMock(data=[{
        "id": "test-uuid", "test_id": "T1", "title": "T", "module": "academic",
        "time_limit_minutes": 60, "passage_count": 3, "total_questions": 40,
        "band_target": None, "status": "published",
    }])

    insert_exec = mock_db.table.return_value.insert.return_value.execute
    # First insert call: simulate the unique-violation race.
    # Second insert call: succeed.
    insert_exec.side_effect = [_FakeUniqueViolation(), MagicMock(data=[{"id": "new-attempt-uuid"}])]

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().post("/api/reading/test/T1/attempts", headers=_AUTH)

    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["status"] == "in_progress"
    assert "attempt_id" in body
    # Insert was called TWICE: the first hit the unique violation, the second
    # succeeded after the retry-abandon ran.
    assert insert_exec.call_count == 2, (
        f"expected 2 insert attempts (1 race + 1 success); got {insert_exec.call_count}"
    )
    # And abandon was called twice — once before each insert attempt.
    assert mock_db.table.return_value.update.return_value.eq.return_value.eq.return_value.eq.return_value.execute.call_count >= 2


def test_d2_start_503_when_retry_budget_exhausted():
    """Three back-to-back unique violations (pathological contention) → the
    handler gives up with a 503, not an infinite loop or a 500."""
    mock_db = MagicMock()
    fetch_chain = mock_db.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value
    fetch_chain.execute.return_value = MagicMock(data=[{
        "id": "test-uuid", "test_id": "T1", "title": "T", "module": "academic",
        "time_limit_minutes": 60, "passage_count": 3, "total_questions": 40,
        "band_target": None, "status": "published",
    }])
    insert_exec = mock_db.table.return_value.insert.return_value.execute
    insert_exec.side_effect = [_FakeUniqueViolation(), _FakeUniqueViolation(), _FakeUniqueViolation()]

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = _client().post("/api/reading/test/T1/attempts", headers=_AUTH)

    assert r.status_code == 503


# ── D3 — Atomic PATCH /answers semantics (audit P1-3) ─────────────────


def test_d3_patch_two_different_qnums_each_upserts_independently():
    """The new shape: two sequential PATCHes for different q_nums each issue
    one upsert to reading_attempt_answers — independent of any other q_num's
    state. (No shared array read; no lost-update window.)

    This is the unit-test surrogate for the audit's concurrency concern.
    True parallel concurrency is verified at the DB layer by the partial
    PK on (attempt_id, q_num) in migration 088."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value
    chain.select.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{
            "id": "a-uuid", "user_id": _USER["id"], "test_id": "t-uuid",
            "status": "in_progress",
        }])
    chain.select.return_value.eq.return_value.execute.return_value = \
        MagicMock(data=[{"q_num": 1}, {"q_num": 7}], count=2)

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r1 = _client().patch("/api/reading/test/attempts/a-uuid/answers",
                             headers=_AUTH, json={"q_num": 1, "user_answer": "A"})
        r2 = _client().patch("/api/reading/test/attempts/a-uuid/answers",
                             headers=_AUTH, json={"q_num": 7, "user_answer": "C"})

    assert r1.status_code == 200 and r2.status_code == 200
    upsert_calls = chain.upsert.call_args_list
    assert len(upsert_calls) == 2
    qnums = [c.args[0]["q_num"] for c in upsert_calls]
    assert qnums == [1, 7]
    # Each upsert uses the composite PK as the conflict target — no chance
    # a same-q_num retry would target only attempt_id.
    for c in upsert_calls:
        assert c.kwargs.get("on_conflict") == "attempt_id,q_num"
    # The attempt row's answers JSONB column is NEVER touched by PATCH.
    chain.update.assert_not_called()


# ── D4 — Fail-closed on malformed started_at (audit P2-1) ─────────────


def test_d4_submit_fails_closed_on_unparseable_started_at():
    """Audit P2-1: a malformed started_at must 422, not grade as elapsed=0."""
    from main import app as _app
    from fastapi.testclient import TestClient as _TC
    client = _TC(_app, raise_server_exceptions=False)

    mock_db = MagicMock()
    attempt_row = {
        "id": "a-uuid", "user_id": _USER["id"], "test_id": "t-uuid",
        "status": "in_progress",
        "started_at": "this is not a timestamp",   # corrupted
        "answers": [],
    }
    test_row = {"id": "t-uuid", "test_id": "T1", "time_limit_minutes": 60, "module": "academic"}
    mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.side_effect = [
        MagicMock(data=[attempt_row]),
        MagicMock(data=[test_row]),
    ]

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = client.post("/api/reading/test/attempts/a-uuid/submit",
                        headers=_AUTH, json={"answers": []})

    assert r.status_code == 422
    assert "started_at" in (r.json().get("detail") or "")


def test_d4_submit_fails_closed_on_missing_started_at():
    """A missing started_at is also a fail-closed case (the 20.5 path silently
    treated it as elapsed=0)."""
    from main import app as _app
    from fastapi.testclient import TestClient as _TC
    client = _TC(_app, raise_server_exceptions=False)

    mock_db = MagicMock()
    attempt_row = {
        "id": "a-uuid", "user_id": _USER["id"], "test_id": "t-uuid",
        "status": "in_progress",
        # started_at intentionally absent
        "answers": [],
    }
    test_row = {"id": "t-uuid", "test_id": "T1", "time_limit_minutes": 60, "module": "academic"}
    mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.side_effect = [
        MagicMock(data=[attempt_row]),
        MagicMock(data=[test_row]),
    ]

    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", mock_db):
        r = client.post("/api/reading/test/attempts/a-uuid/submit",
                        headers=_AUTH, json={"answers": []})
    assert r.status_code == 422


# ── D5 — Diagnostic boundary tests (audit P2-2, Codex own gap) ────────


def test_d5_diagnostic_level_at_exact_boundary_59():
    """59% is still strictly < 60% → weak."""
    assert _diagnostic_level(59) == "weak"


def test_d5_diagnostic_level_at_exact_boundary_60():
    """60% crosses the WEAK threshold → watch."""
    assert _diagnostic_level(60) == "watch"


def test_d5_diagnostic_level_at_exact_boundary_74():
    """74% is still strictly < 75% → watch."""
    assert _diagnostic_level(74) == "watch"


def test_d5_diagnostic_level_at_exact_boundary_75():
    """75% crosses the WATCH threshold → strong."""
    assert _diagnostic_level(75) == "strong"


def test_d5_diagnostic_level_low_and_high_extremes():
    """Defensive guards either side of the table — 0% is weak, 100% is strong."""
    assert _diagnostic_level(0) == "weak"
    assert _diagnostic_level(100) == "strong"
