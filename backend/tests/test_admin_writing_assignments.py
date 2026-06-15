"""Tests for /admin/writing/assignments/* — Phase 2.3a-2.

Mirrors the test pattern from test_admin_writing_prompts.py:
  • TestClient on the real app (no Depends overrides).
  • Auth gate: missing Authorization → 401 BEFORE Pydantic validation.
  • Pydantic validation: empty student_ids → 422.
  • Happy path: patch require_admin with AsyncMock and supabase_admin
    with a MagicMock chain so we don't touch the real DB.
  • Status auto-stamp: PATCH status='submitted' must include
    submitted_at in the update payload.
  • Hard-delete guard: only `pending` rows can be deleted; anything
    past that → 409.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH    = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER    = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_PROMPT_ID     = "00000000-0000-0000-0000-00000000bbbb"
_STUDENT_ID    = "00000000-0000-0000-0000-00000000cccc"
_STUDENT_ID_2  = "00000000-0000-0000-0000-00000000cccd"
_ASSIGN_ID     = "00000000-0000-0000-0000-00000000dddd"


# ── Auth gate ────────────────────────────────────────────────────────


def test_list_assignments_requires_auth_header():
    """Missing Authorization → 401 before any DB call."""
    r = _client().get("/admin/writing/assignments")
    assert r.status_code == 401


def test_create_assignment_requires_auth_header():
    r = _client().post(
        "/admin/writing/assignments",
        json={"prompt_id": _PROMPT_ID, "student_ids": [_STUDENT_ID]},
    )
    assert r.status_code == 401


# ── Pydantic body validation ─────────────────────────────────────────


def test_create_rejects_empty_student_ids():
    """min_length=1 — bulk-create with zero students is meaningless."""
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post(
            "/admin/writing/assignments",
            json={"prompt_id": _PROMPT_ID, "student_ids": []},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 422


def test_patch_rejects_invalid_status():
    """Status outside the 5-state enum → 422."""
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().patch(
            f"/admin/writing/assignments/{_ASSIGN_ID}",
            json={"status": "lol_done"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 422


# ── Happy paths (DB stubbed) ─────────────────────────────────────────


def test_list_assignments_returns_joined_payload():
    """List endpoint returns {assignments:[...]} with prompt + student
    embedded so the admin UI doesn't need a second round-trip."""
    mock_db = MagicMock()
    chain = (mock_db.table.return_value
             .select.return_value
             .order.return_value
             .limit.return_value)
    chain.execute.return_value = MagicMock(data=[
        {
            "id":       _ASSIGN_ID,
            "status":   "pending",
            "writing_prompts": {"id": _PROMPT_ID, "title": "Test prompt",
                                 "task_type": "task2"},
            "students":        {"id": _STUDENT_ID, "full_name": "Andy"},
        },
    ])

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().get("/admin/writing/assignments", headers=_ADMIN_AUTH)

    assert r.status_code == 200
    body = r.json()
    assert "assignments" in body
    assert body["assignments"][0]["writing_prompts"]["title"] == "Test prompt"


def test_create_single_assignment_returns_count_one_no_duplicates():
    """Create one assignment for one student — no existing duplicates →
    `duplicates_warning` is empty."""
    mock_db = MagicMock()
    # Duplicate-check returns no existing rows.
    dup_chain = (mock_db.table.return_value
                 .select.return_value.in_.return_value.in_.return_value)
    dup_chain.execute.return_value = MagicMock(data=[])
    # Insert succeeds.
    insert_chain = mock_db.table.return_value.insert.return_value
    insert_chain.execute.return_value = MagicMock(data=[
        {"id": _ASSIGN_ID, "prompt_id": _PROMPT_ID,
         "student_id": _STUDENT_ID, "status": "pending"},
    ])

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={"prompt_id": _PROMPT_ID, "student_ids": [_STUDENT_ID]},
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 201
    body = r.json()
    assert body["count"] == 1
    assert body["duplicates_warning"] == []
    # Insert payload stamped with assigned_by from the calling admin.
    insert_payload = mock_db.table.return_value.insert.call_args[0][0]
    assert insert_payload[0]["assigned_by"] == _ADMIN_USER["id"]
    assert insert_payload[0]["student_id"]  == _STUDENT_ID


def test_create_bulk_assignment_surfaces_duplicate_warning():
    """Bulk-create where one of the students already had this prompt:
    insert still happens for ALL students (allow + warn policy from
    2026-05-06), but the duplicate student_id surfaces in
    `duplicates_warning` so the admin UI can flag it."""
    mock_db = MagicMock()
    # One existing duplicate against the first student id.
    dup_chain = (mock_db.table.return_value
                 .select.return_value.in_.return_value.in_.return_value)
    dup_chain.execute.return_value = MagicMock(data=[
        {"student_id": _STUDENT_ID},
    ])
    # Insert succeeds for both rows.
    insert_chain = mock_db.table.return_value.insert.return_value
    insert_chain.execute.return_value = MagicMock(data=[
        {"id": _ASSIGN_ID,    "student_id": _STUDENT_ID,    "status": "pending"},
        {"id": "another-id",  "student_id": _STUDENT_ID_2,  "status": "pending"},
    ])

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={
                "prompt_id":   _PROMPT_ID,
                "student_ids": [_STUDENT_ID, _STUDENT_ID_2],
            },
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 201
    body = r.json()
    assert body["count"] == 2
    assert _STUDENT_ID    in body["duplicates_warning"]
    assert _STUDENT_ID_2 not in body["duplicates_warning"]


def test_create_multi_prompt_groups_rows_with_name_and_soft_check():
    """W-ASSIGN: N prompts × M students → N×M rows that all share one
    assignment_group_id + the given name + allow_soft_check. Each prompt
    stays its own row (own essay later) — grouping is just a label."""
    prompt_2 = "00000000-0000-0000-0000-00000000bbbc"
    mock_db = MagicMock()
    dup_chain = (mock_db.table.return_value
                 .select.return_value.in_.return_value.in_.return_value)
    dup_chain.execute.return_value = MagicMock(data=[])
    insert_chain = mock_db.table.return_value.insert.return_value
    insert_chain.execute.return_value = MagicMock(data=[
        {"id": "r1"}, {"id": "r2"}, {"id": "r3"}, {"id": "r4"},
    ])

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={
                "prompt_ids":       [_PROMPT_ID, prompt_2],
                "student_ids":      [_STUDENT_ID, _STUDENT_ID_2],
                "name":             "Buổi 5",
                "allow_soft_check": True,
            },
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 201
    body = r.json()
    assert body["count"] == 4                       # 2 prompts × 2 students
    assert body["group_id"]                         # a group id is returned

    sent = mock_db.table.return_value.insert.call_args[0][0]
    assert len(sent) == 4
    # all rows share ONE group_id + carry the name + flag
    assert len({row["assignment_group_id"] for row in sent}) == 1
    assert sent[0]["assignment_group_id"] == body["group_id"]
    assert all(row["name"] == "Buổi 5" for row in sent)
    assert all(row["allow_soft_check"] is True for row in sent)
    # both prompts present (each its own row per student)
    assert {row["prompt_id"] for row in sent} == {_PROMPT_ID, prompt_2}


def test_create_legacy_single_prompt_id_still_works():
    """Back-compat: the pre-W-ASSIGN UI sends `prompt_id` (singular).
    It must still create rows (one group, allow_soft_check defaults
    false) so PR-1 can merge before the admin UI (PR-2)."""
    mock_db = MagicMock()
    dup_chain = (mock_db.table.return_value
                 .select.return_value.in_.return_value.in_.return_value)
    dup_chain.execute.return_value = MagicMock(data=[])
    insert_chain = mock_db.table.return_value.insert.return_value
    insert_chain.execute.return_value = MagicMock(data=[{"id": "r1"}])

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={"prompt_id": _PROMPT_ID, "student_ids": [_STUDENT_ID]},
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 201
    sent = mock_db.table.return_value.insert.call_args[0][0]
    assert len(sent) == 1
    assert sent[0]["prompt_id"] == _PROMPT_ID
    assert sent[0]["allow_soft_check"] is False
    assert sent[0]["assignment_group_id"]           # still grouped


def test_create_requires_at_least_one_prompt():
    """Neither prompt_id nor prompt_ids → 422 from the coalesce validator."""
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", MagicMock()):
        r = _client().post(
            "/admin/writing/assignments",
            json={"student_ids": [_STUDENT_ID]},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 422


def test_patch_status_submitted_auto_stamps_submitted_at():
    """Setting status='submitted' adds `submitted_at` to the update
    payload server-side — the client never has to compute the
    timestamp itself.

    Sprint 2.7 fix #2: handler now ALSO does a status pre-check
    against the transition matrix.  We seed the select chain with
    `in_progress` so the in_progress → submitted move is valid."""
    mock_db = MagicMock()
    # Sprint 2.7: seed the new pre-check SELECT.
    select_chain = (mock_db.table.return_value
                    .select.return_value.eq.return_value.limit.return_value)
    select_chain.execute.return_value = MagicMock(data=[{"status": "in_progress"}])
    update_chain = mock_db.table.return_value.update.return_value.eq.return_value
    update_chain.execute.return_value = MagicMock(data=[
        {"id": _ASSIGN_ID, "status": "submitted"},
    ])

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().patch(
            f"/admin/writing/assignments/{_ASSIGN_ID}",
            json={"status": "submitted"},
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 200
    update_payload = mock_db.table.return_value.update.call_args[0][0]
    assert update_payload["status"]       == "submitted"
    assert "submitted_at" in update_payload
    # Must NOT be the literal string "now()" — that would store the
    # text "now()" in the column rather than evaluating it server side.
    assert update_payload["submitted_at"] != "now()"
    # Should NOT auto-stamp graded_at / delivered_at on a submitted move.
    assert "graded_at"    not in update_payload
    assert "delivered_at" not in update_payload


# ── Sprint 2.7 fix #2: state transition matrix ───────────────────────


def _patch_with_current_status(current: str):
    """Helper — build a mock_db whose status SELECT returns `current`
    and whose UPDATE returns a generic success row."""
    mock_db = MagicMock()
    select_chain = (mock_db.table.return_value
                    .select.return_value.eq.return_value.limit.return_value)
    select_chain.execute.return_value = MagicMock(data=[{"status": current}])
    update_chain = mock_db.table.return_value.update.return_value.eq.return_value
    update_chain.execute.return_value = MagicMock(data=[{"id": _ASSIGN_ID}])
    return mock_db


def test_patch_rejects_pending_to_graded_skip():
    """Skipping the grader queue is the canonical illegal jump.
    The pre-check fires 409 before the UPDATE round-trip."""
    mock_db = _patch_with_current_status("pending")
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().patch(
            f"/admin/writing/assignments/{_ASSIGN_ID}",
            json={"status": "graded"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 409
    assert "Cannot transition" in r.json()["detail"]
    # No UPDATE should have fired.
    mock_db.table.return_value.update.assert_not_called()


def test_patch_rejects_delivered_to_anything():
    """`delivered` is terminal — every outbound transition rejects."""
    for target in ("pending", "in_progress", "submitted", "graded"):
        mock_db = _patch_with_current_status("delivered")
        with patch("routers.admin_writing_assignments.require_admin",
                   new=AsyncMock(return_value=_ADMIN_USER)), \
             patch("routers.admin_writing_assignments.supabase_admin", mock_db):
            r = _client().patch(
                f"/admin/writing/assignments/{_ASSIGN_ID}",
                json={"status": target},
                headers=_ADMIN_AUTH,
            )
        assert r.status_code == 409, f"target={target} should 409 from delivered"


def test_patch_allows_pending_to_in_progress():
    """The natural forward step — admin nudges a pending row to
    in_progress without waiting for the student's first draft save."""
    mock_db = _patch_with_current_status("pending")
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().patch(
            f"/admin/writing/assignments/{_ASSIGN_ID}",
            json={"status": "in_progress"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200


def test_patch_allows_pending_to_delivered_admin_override():
    """Admin manual delivery (e.g., student emailed essay outside
    the system) is the documented override path on the matrix."""
    mock_db = _patch_with_current_status("pending")
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().patch(
            f"/admin/writing/assignments/{_ASSIGN_ID}",
            json={"status": "delivered"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    update_payload = mock_db.table.return_value.update.call_args[0][0]
    assert update_payload["status"] == "delivered"
    assert "delivered_at" in update_payload


def test_patch_idempotent_same_status_allowed():
    """A re-save with the same status (admin updating instructions
    only via a payload that happens to include status) must not
    reject — keeps the admin UI's fire-and-forget workflow simple."""
    mock_db = _patch_with_current_status("in_progress")
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().patch(
            f"/admin/writing/assignments/{_ASSIGN_ID}",
            json={"status": "in_progress"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200


def test_patch_404_when_assignment_missing_for_status_change():
    """A status PATCH on a row that doesn't exist 404s on the
    pre-check, before the matrix even runs."""
    mock_db = MagicMock()
    select_chain = (mock_db.table.return_value
                    .select.return_value.eq.return_value.limit.return_value)
    select_chain.execute.return_value = MagicMock(data=[])
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().patch(
            f"/admin/writing/assignments/{_ASSIGN_ID}",
            json={"status": "submitted"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 404


def test_delete_pending_assignment_succeeds():
    """status='pending' is the only state where hard delete is allowed."""
    mock_db = MagicMock()
    select_chain = (mock_db.table.return_value
                    .select.return_value.eq.return_value.limit.return_value)
    select_chain.execute.return_value = MagicMock(data=[{"status": "pending"}])
    delete_chain = mock_db.table.return_value.delete.return_value.eq.return_value
    delete_chain.execute.return_value = MagicMock(data=[])

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().delete(
            f"/admin/writing/assignments/{_ASSIGN_ID}",
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 200
    mock_db.table.return_value.delete.assert_called()


def test_delete_non_pending_assignment_blocked():
    """Anything past pending → 409.  Real student/grader work has
    touched the row; hard delete would silently drop audit context."""
    mock_db = MagicMock()
    select_chain = (mock_db.table.return_value
                    .select.return_value.eq.return_value.limit.return_value)
    select_chain.execute.return_value = MagicMock(data=[{"status": "submitted"}])

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().delete(
            f"/admin/writing/assignments/{_ASSIGN_ID}",
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 409
    # delete() must NEVER be called when the guard fires.
    mock_db.table.return_value.delete.assert_not_called()


def test_get_single_assignment_not_found_returns_404():
    """Empty rows from Supabase → 404 (not silent empty body)."""
    mock_db = MagicMock()
    select_chain = (mock_db.table.return_value
                    .select.return_value.eq.return_value.limit.return_value)
    select_chain.execute.return_value = MagicMock(data=[])

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().get(
            f"/admin/writing/assignments/{_ASSIGN_ID}",
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 404


# ── Phase 2.3c-3: IELTS-mode timer fields ────────────────────────────


def test_create_assignment_with_timer_persists_fields():
    """is_timed=true + time_limit_minutes=40 round-trips into the
    insert payload — pinning these together prevents a regression
    where one drops out and the migration's CHECK constraint then
    rejects the row with an opaque error."""
    mock_db = MagicMock()
    dup_chain = (mock_db.table.return_value
                 .select.return_value.in_.return_value.in_.return_value)
    dup_chain.execute.return_value = MagicMock(data=[])
    insert_chain = mock_db.table.return_value.insert.return_value
    insert_chain.execute.return_value = MagicMock(data=[
        {"id": _ASSIGN_ID, "student_id": _STUDENT_ID,
         "is_timed": True, "time_limit_minutes": 40},
    ])

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={
                "prompt_id":          _PROMPT_ID,
                "student_ids":        [_STUDENT_ID],
                "is_timed":           True,
                "time_limit_minutes": 40,
            },
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 201, r.text
    insert_payload = mock_db.table.return_value.insert.call_args[0][0]
    assert insert_payload[0]["is_timed"]           is True
    assert insert_payload[0]["time_limit_minutes"] == 40


def test_create_timed_assignment_without_minutes_rejects_422():
    """is_timed=true with no time_limit_minutes → 422 from the
    field_validator, BEFORE we ever touch the DB."""
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post(
            "/admin/writing/assignments",
            json={
                "prompt_id":   _PROMPT_ID,
                "student_ids": [_STUDENT_ID],
                "is_timed":    True,
            },
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 422
    assert "time_limit_minutes" in r.text


def test_create_untimed_assignment_with_minutes_rejects_422():
    """is_timed=false but time_limit_minutes provided → 422.  Belt-
    and-braces — without this branch a stale UI checkbox could
    quietly pass a phantom 40 alongside is_timed=false and the DB
    CHECK would catch it with a much uglier error."""
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post(
            "/admin/writing/assignments",
            json={
                "prompt_id":          _PROMPT_ID,
                "student_ids":        [_STUDENT_ID],
                "is_timed":           False,
                "time_limit_minutes": 40,
            },
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 422


def test_create_timed_assignment_minutes_out_of_range_rejects_422():
    """time_limit_minutes is bounded to 1-180; 200 is past the cap
    and `Field(le=180)` rejects it before the field_validator runs."""
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post(
            "/admin/writing/assignments",
            json={
                "prompt_id":          _PROMPT_ID,
                "student_ids":        [_STUDENT_ID],
                "is_timed":           True,
                "time_limit_minutes": 200,
            },
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 422
