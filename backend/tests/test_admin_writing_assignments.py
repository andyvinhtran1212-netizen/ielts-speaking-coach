"""Tests for /admin/writing/assignments/* — Phase 2.3a-2.

Mirrors the test pattern from test_admin_writing_prompts.py:
  • TestClient on the real app (no Depends overrides).
  • Auth gate: missing Authorization → 401 BEFORE Pydantic validation.
  • Pydantic validation: empty student_ids → 422.
  • Happy path: patch require_admin with AsyncMock and supabase_admin
    with a MagicMock chain so we don't touch the real DB.
  • Status auto-stamp: PATCH status='submitted' must include
    submitted_at in the update payload.
  • Hard-delete guard: only unstarted `pending` rows can be deleted;
    anything past that → 409 (A-08 draft/essay cases live in
    test_writing_assignment_delete_guard.py).
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
_REQUEST_ID    = "00000000-0000-4000-8000-000000000123"


def _rpc_db(**receipt) -> MagicMock:
    """A DB stub for a NEW idempotent give: no committed receipt in the
    request ledger, and the RPC returns `receipt`."""
    mock_db = MagicMock()
    ledger = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    ledger.execute.return_value = MagicMock(data=[])
    mock_db.rpc.return_value.execute.return_value = MagicMock(data={
        "created": [], "created_count": 0,
        "group_id": "00000000-0000-4000-8000-000000000999",
        "duplicates_warning": [], "replayed": False, **receipt,
    })
    return mock_db


def _rpc_args(mock_db: MagicMock) -> dict:
    name, args = mock_db.rpc.call_args.args
    assert name == "fn_create_writing_assignments_idempotent"
    return args


# ── Auth gate ────────────────────────────────────────────────────────


def test_list_assignments_requires_auth_header():
    """Missing Authorization → 401 before any DB call."""
    r = _client().get("/admin/writing/assignments")
    assert r.status_code == 401


def test_create_assignment_requires_auth_header():
    r = _client().post(
        "/admin/writing/assignments",
        json={"request_id": _REQUEST_ID, "prompt_id": _PROMPT_ID, "student_ids": [_STUDENT_ID]},
    )
    assert r.status_code == 401


# ── Pydantic body validation ─────────────────────────────────────────


def test_create_rejects_empty_student_ids():
    """min_length=1 — bulk-create with zero students is meaningless."""
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post(
            "/admin/writing/assignments",
            json={"request_id": _REQUEST_ID, "prompt_id": _PROMPT_ID, "student_ids": []},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 422


def test_create_without_request_id_is_422_and_writes_nothing():
    """PC-J37: the request receipt is what marks an admin-tools give. A give
    without one would read as an /instructor give, so it is refused."""
    mock_db = MagicMock()
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={"prompt_id": _PROMPT_ID, "student_ids": [_STUDENT_ID]},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 422
    assert any(err["loc"][-1] == "request_id" for err in r.json()["detail"])
    assert mock_db.mock_calls == []


def test_fanout_without_request_id_is_422_and_writes_nothing():
    mock_db = MagicMock()
    fan_out = MagicMock()
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db), \
         patch("services.cohort_assignment_service.fan_out_assignment", fan_out):
        r = _client().post(
            "/admin/writing/assignments/fan-out",
            json={"prompt_id": _PROMPT_ID,
                  "cohort_id": "00000000-0000-0000-0000-00000000eeee"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 422
    assert any(err["loc"][-1] == "request_id" for err in r.json()["detail"])
    assert mock_db.mock_calls == []
    fan_out.assert_not_called()


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
    assert body["capped"] is False
    assert mock_db.table.return_value.select.return_value.order.return_value.limit.call_args.args == (201,)


def test_list_assignments_reports_and_removes_sentinel_row():
    """A 501st row proves truncation without leaking beyond the public cap."""
    mock_db = MagicMock()
    chain = (mock_db.table.return_value.select.return_value.order.return_value.limit.return_value)
    chain.execute.return_value = MagicMock(data=[
        {"id": f"assignment-{index}"} for index in range(501)
    ])
    with patch("routers.admin_writing_assignments.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().get("/admin/writing/assignments?limit=500", headers=_ADMIN_AUTH)
    assert r.status_code == 200
    assert r.json()["capped"] is True
    assert len(r.json()["assignments"]) == 500


def test_cohort_list_filter_keeps_stamped_rows_and_limits_legacy_rows_to_roster():
    from routers.admin_writing_assignments import _cohort_assignment_filter

    cohort_id = "00000000-0000-0000-0000-00000000eeee"
    assert _cohort_assignment_filter(cohort_id, [_STUDENT_ID]) == (
        f"cohort_id.eq.{cohort_id},"
        f"and(cohort_id.is.null,student_id.in.({_STUDENT_ID}))"
    )


def test_cohort_list_filter_keeps_stamped_history_after_last_member_leaves():
    from routers.admin_writing_assignments import _cohort_assignment_filter

    cohort_id = "00000000-0000-0000-0000-00000000eeee"
    assert _cohort_assignment_filter(cohort_id, []) == f"cohort_id.eq.{cohort_id}"


def test_create_single_assignment_returns_count_one_no_duplicates():
    """Create one assignment for one student — no existing duplicates →
    `duplicates_warning` is empty."""
    mock_db = _rpc_db(created=[
        {"id": _ASSIGN_ID, "prompt_id": _PROMPT_ID,
         "student_id": _STUDENT_ID, "status": "pending"},
    ], created_count=1)

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={"request_id": _REQUEST_ID, "prompt_id": _PROMPT_ID, "student_ids": [_STUDENT_ID]},
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 201
    body = r.json()
    assert body["count"] == 1
    assert body["duplicates_warning"] == []
    # The give is stamped with assigned_by from the calling admin.
    args = _rpc_args(mock_db)
    assert args["p_assigned_by"] == _ADMIN_USER["id"]
    assert args["p_student_ids"] == [_STUDENT_ID]
    mock_db.table.return_value.insert.assert_not_called()


def test_create_with_request_id_uses_atomic_idempotency_rpc():
    """Create never inserts directly; the client UUID owns
    one atomic request ledger + assignment receipt."""
    mock_db = MagicMock()
    mock_db.rpc.return_value.execute.return_value = MagicMock(data={
        "created": [{"id": _ASSIGN_ID}], "created_count": 1,
        "group_id": "00000000-0000-4000-8000-000000000999",
        "duplicates_warning": [], "replayed": False,
    })
    # No committed receipt yet: the route checks the request ledger first.
    ledger = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    ledger.execute.return_value = MagicMock(data=[])
    request_id = "00000000-0000-4000-8000-000000000123"
    with patch("routers.admin_writing_assignments.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={"request_id": request_id, "prompt_id": _PROMPT_ID, "student_ids": [_STUDENT_ID]},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 201
    assert r.json()["count"] == 1
    assert r.json()["replayed"] is False
    name, args = mock_db.rpc.call_args.args
    assert name == "fn_create_writing_assignments_idempotent"
    assert args["p_request_id"] == request_id
    assert args["p_student_ids"] == [_STUDENT_ID]
    assert "cohort_id" not in args["p_request_payload"]
    mock_db.table.return_value.insert.assert_not_called()


def test_create_request_id_replay_returns_same_receipt():
    mock_db = MagicMock()
    mock_db.rpc.return_value.execute.return_value = MagicMock(data={
        "created": [{"id": _ASSIGN_ID}], "created_count": 1,
        "group_id": "00000000-0000-4000-8000-000000000999",
        "duplicates_warning": [_STUDENT_ID], "replayed": True,
    })
    # No committed receipt yet: the route checks the request ledger first.
    ledger = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    ledger.execute.return_value = MagicMock(data=[])
    with patch("routers.admin_writing_assignments.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={"request_id": "00000000-0000-4000-8000-000000000123", "prompt_id": _PROMPT_ID, "student_ids": [_STUDENT_ID]},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 201
    assert r.json()["replayed"] is True
    assert r.json()["duplicates_warning"] == [_STUDENT_ID]


def test_fanout_request_id_rejects_changed_cohort_size_before_rpc():
    """Review arithmetic is a precondition, not decorative copy."""
    mock_db = MagicMock()
    ledger = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    ledger.execute.return_value = MagicMock(data=[])
    students = mock_db.table.return_value.select.return_value.eq.return_value
    students.execute.return_value = MagicMock(data=[{"id": _STUDENT_ID}, {"id": _STUDENT_ID_2}])
    with patch("routers.admin_writing_assignments.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments/fan-out",
            json={
                "request_id": "00000000-0000-4000-8000-000000000123",
                "prompt_id": _PROMPT_ID,
                "cohort_id": "00000000-0000-0000-0000-00000000eeee",
                "expected_student_count": 1,
            },
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 409
    assert "Sĩ số lớp đã đổi từ 1 thành 2" in r.json()["detail"]
    mock_db.rpc.assert_not_called()


def test_fanout_atomic_roster_race_is_reported_as_conflict():
    mock_db = MagicMock()
    mock_db.rpc.return_value.execute.side_effect = RuntimeError(
        "writing_assignment_request_roster_changed"
    )
    with patch("routers.admin_writing_assignments.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db), \
         patch("routers.admin_writing_assignments._read_assignment_request_receipt", return_value=None), \
         patch("routers.admin_writing_assignments.active_student_ids_for_cohort", return_value=[_STUDENT_ID]):
        r = _client().post(
            "/admin/writing/assignments/fan-out",
            json={
                "request_id": "00000000-0000-4000-8000-000000000123",
                "prompt_id": _PROMPT_ID,
                "cohort_id": "00000000-0000-0000-0000-00000000eeee",
                "expected_student_count": 1,
            },
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 409
    assert "Sĩ số lớp đã thay đổi" in r.json()["detail"]


def test_fanout_replay_returns_original_receipt_before_reading_changed_cohort():
    """A lost-response retry is governed by its immutable request receipt,
    not by cohort membership that may have changed after the original commit."""
    mock_db = MagicMock()
    request_id = "00000000-0000-4000-8000-000000000123"
    request_payload = {
        "expected_student_count": 1,
        "prompt_ids": [_PROMPT_ID],
        "cohort_id": "00000000-0000-0000-0000-00000000eeee",
        "name": None,
        "allow_soft_check": False,
        "deadline": None,
        "instructions": None,
        "is_timed": False,
        "time_limit_minutes": None,
        "analysis_level": 3,
    }
    receipt = {
        "created": [{"id": _ASSIGN_ID}],
        "assignment_ids": [_ASSIGN_ID],
        "created_count": 1,
        "student_count": 1,
        "group_id": "00000000-0000-4000-8000-000000000999",
        "duplicates_warning": [],
        "replayed": False,
    }
    ledger = mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
    ledger.execute.return_value = MagicMock(data=[{
        "assigned_by": _ADMIN_USER["id"],
        "request_payload": request_payload,
        "receipt": receipt,
    }])

    with patch("routers.admin_writing_assignments.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments/fan-out",
            json={
                "request_id": request_id,
                "prompt_id": _PROMPT_ID,
                "cohort_id": request_payload["cohort_id"],
                "expected_student_count": 1,
            },
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 201
    assert r.json()["replayed"] is True
    assert r.json()["assignment_ids"] == [_ASSIGN_ID]
    mock_db.rpc.assert_not_called()
    mock_db.table.assert_called_once_with("writing_assignment_requests")


def test_verify_request_returns_only_rows_still_in_receipt_group():
    request_id = "00000000-0000-4000-8000-000000000123"
    group_id = "00000000-0000-4000-8000-000000000999"
    mock_db = MagicMock()
    mock_db.rpc.return_value.execute.return_value = MagicMock(data={
        "request_id": request_id,
        "group_id": group_id,
        "expected_count": 2,
        "assignment_ids": [_ASSIGN_ID],
    })

    with patch("routers.admin_writing_assignments.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().get(
            f"/admin/writing/assignments/requests/{request_id}",
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 200
    assert r.json() == {
        "request_id": request_id,
        "group_id": group_id,
        "expected_count": 2,
        "assignment_ids": [_ASSIGN_ID],
    }
    mock_db.rpc.assert_called_once_with("fn_verify_writing_assignment_request", {
        "p_request_id": request_id,
        "p_assigned_by": _ADMIN_USER["id"],
    })


def test_create_bulk_assignment_surfaces_duplicate_warning():
    """Bulk-create where one of the students already had this prompt:
    insert still happens for ALL students (allow + warn policy from
    2026-05-06), but the duplicate student_id surfaces in
    `duplicates_warning` so the admin UI can flag it."""
    # The RPC computes the warning in the same transaction as the insert
    # (migration 206); the route must surface it unchanged.
    mock_db = _rpc_db(created=[
        {"id": _ASSIGN_ID,    "student_id": _STUDENT_ID,    "status": "pending"},
        {"id": "another-id",  "student_id": _STUDENT_ID_2,  "status": "pending"},
    ], created_count=2, duplicates_warning=[_STUDENT_ID])

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={
                "request_id":  _REQUEST_ID,
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
    # Both students are given — duplicates are allowed, only warned.
    assert _rpc_args(mock_db)["p_student_ids"] == [_STUDENT_ID, _STUDENT_ID_2]


def test_create_multi_prompt_groups_rows_with_name_and_soft_check():
    """W-ASSIGN: N prompts × M students → N×M rows that all share one
    assignment_group_id + the given name + allow_soft_check. Each prompt
    stays its own row (own essay later) — grouping is just a label."""
    prompt_2 = "00000000-0000-0000-0000-00000000bbbc"
    mock_db = _rpc_db(created=[
        {"id": "r1"}, {"id": "r2"}, {"id": "r3"}, {"id": "r4"},
    ], created_count=4)

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={
                "request_id":       _REQUEST_ID,
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

    # The RPC builds the prompt × student Cartesian product under ONE
    # group id; the route hands it both lists + the name + flag.
    args = _rpc_args(mock_db)
    assert args["p_prompt_ids"] == [_PROMPT_ID, prompt_2]
    assert args["p_student_ids"] == [_STUDENT_ID, _STUDENT_ID_2]
    assert args["p_name"] == "Buổi 5"
    assert args["p_allow_soft_check"] is True


def test_create_legacy_single_prompt_id_still_works():
    """Back-compat: the pre-W-ASSIGN UI sends `prompt_id` (singular).
    It must still create rows (one group, allow_soft_check defaults
    false) so PR-1 can merge before the admin UI (PR-2)."""
    mock_db = _rpc_db(created=[{"id": "r1"}], created_count=1)

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={"request_id": _REQUEST_ID, "prompt_id": _PROMPT_ID, "student_ids": [_STUDENT_ID]},
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 201
    args = _rpc_args(mock_db)
    assert args["p_prompt_ids"] == [_PROMPT_ID]
    assert args["p_request_payload"]["prompt_ids"] == [_PROMPT_ID]
    assert args["p_allow_soft_check"] is False
    assert r.json()["group_id"]                     # still grouped


def test_create_requires_at_least_one_prompt():
    """Neither prompt_id nor prompt_ids → 422 from the coalesce validator."""
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", MagicMock()):
        r = _client().post(
            "/admin/writing/assignments",
            json={"request_id": _REQUEST_ID, "student_ids": [_STUDENT_ID]},
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
    update_chain.eq.return_value = update_chain
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
    update_chain.eq.return_value = update_chain
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
    """An unstarted pending row (no draft, no essay) is the only state
    where hard delete is allowed.  Per-table mocks: the A-08 guard also
    reads writing_drafts, which a single shared chain would answer with
    the assignment row (see test_writing_assignment_delete_guard.py)."""
    assignments = MagicMock()
    select_chain = assignments.select.return_value.eq.return_value.limit.return_value
    select_chain.execute.return_value = MagicMock(data=[{"status": "pending"}])
    delete_chain = (assignments.delete.return_value.eq.return_value.eq.return_value
                    .is_.return_value.is_.return_value)
    delete_chain.execute.return_value = MagicMock(data=[{"id": _ASSIGN_ID}])
    drafts = MagicMock()
    drafts_chain = drafts.select.return_value.eq.return_value.limit.return_value
    drafts_chain.execute.return_value = MagicMock(data=[])
    mock_db = MagicMock()
    mock_db.table.side_effect = lambda name: {
        "writing_assignments": assignments, "writing_drafts": drafts,
    }[name]

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().delete(
            f"/admin/writing/assignments/{_ASSIGN_ID}",
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 200
    assignments.delete.assert_called()


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
    mock_db = _rpc_db(created=[
        {"id": _ASSIGN_ID, "student_id": _STUDENT_ID,
         "is_timed": True, "time_limit_minutes": 40},
    ], created_count=1)

    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={
                "request_id":         _REQUEST_ID,
                "prompt_id":          _PROMPT_ID,
                "student_ids":        [_STUDENT_ID],
                "is_timed":           True,
                "time_limit_minutes": 40,
            },
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 201, r.text
    args = _rpc_args(mock_db)
    assert args["p_is_timed"]           is True
    assert args["p_time_limit_minutes"] == 40


def test_create_timed_assignment_without_minutes_rejects_422():
    """is_timed=true with no time_limit_minutes → 422 from the
    field_validator, BEFORE we ever touch the DB."""
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post(
            "/admin/writing/assignments",
            json={
                "request_id":  _REQUEST_ID,
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
                "request_id":         _REQUEST_ID,
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
                "request_id":         _REQUEST_ID,
                "prompt_id":          _PROMPT_ID,
                "student_ids":        [_STUDENT_ID],
                "is_timed":           True,
                "time_limit_minutes": 200,
            },
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 422


# ── analysis_level at assign time (mig 104) ──────────────────────────────

_COHORT_ID = "00000000-0000-0000-0000-00000000eeee"


def test_create_assignment_persists_analysis_level():
    """analysis_level passed in the body lands on every inserted row."""
    mock_db = _rpc_db(created=[{"id": "r1"}], created_count=1)
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={"request_id": _REQUEST_ID, "prompt_id": _PROMPT_ID,
                  "student_ids": [_STUDENT_ID], "analysis_level": 5},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 201
    assert _rpc_args(mock_db)["p_analysis_level"] == 5


def test_create_assignment_defaults_analysis_level_3():
    """Omitting analysis_level → default 3 (back-compat, e.g. Hub deep-link)."""
    mock_db = _rpc_db(created=[{"id": "r1"}], created_count=1)
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db):
        r = _client().post(
            "/admin/writing/assignments",
            json={"request_id": _REQUEST_ID, "prompt_id": _PROMPT_ID, "student_ids": [_STUDENT_ID]},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 201
    assert _rpc_args(mock_db)["p_analysis_level"] == 3


def test_create_assignment_rejects_out_of_range_level():
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post(
            "/admin/writing/assignments",
            json={"request_id": _REQUEST_ID, "prompt_id": _PROMPT_ID,
                  "student_ids": [_STUDENT_ID], "analysis_level": 6},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 422


def test_fanout_threads_analysis_level_to_rpc():
    """Cohort fan-out forwards analysis_level into the idempotent give."""
    mock_db = _rpc_db(student_count=2, created_count=2, assignment_ids=["a1", "a2"])
    with patch("routers.admin_writing_assignments.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.supabase_admin", mock_db), \
         patch("routers.admin_writing_assignments.active_student_ids_for_cohort",
               return_value=[_STUDENT_ID, _STUDENT_ID_2]):
        r = _client().post(
            "/admin/writing/assignments/fan-out",
            json={"request_id": _REQUEST_ID, "prompt_id": _PROMPT_ID,
                  "cohort_id": _COHORT_ID, "analysis_level": 4},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 201
    args = _rpc_args(mock_db)
    assert args["p_analysis_level"] == 4
    assert args["p_student_ids"] == [_STUDENT_ID, _STUDENT_ID_2]
