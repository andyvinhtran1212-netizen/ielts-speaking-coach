"""PC-J08 — one rule for a writing give's lateness and review state.

A-S3: a hand-in after `deadline` is "Nộp trễ" on /my-class, the admin cohort
matrix and the /instructor matrix alike, so all three read
`services.writing_give_status`. W-07: the learner's review state comes from the
essay. W-TIER-DISPLAY: the assignment's `grading_tier` setting is the AI-pass
depth only; it never decides whether the essay goes to a teacher.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from services.writing_give_status import (
    writing_give_timing,
    writing_result_path,
    writing_review_state,
)

NOW = datetime(2026, 10, 28, 3, 0, tzinfo=timezone.utc)


# ── lateness (A-S3) ────────────────────────────────────────────────────


@pytest.mark.parametrize("submitted_at, expected", [
    ("2026-10-27T16:00:01Z", True),          # one second after 23:00 VN
    ("2026-10-27T23:00:01+07:00", True),     # same instant, other offset
    ("2026-10-27T16:00:00Z", False),         # exactly on the deadline is on time
    ("2026-10-27T22:59:59+07:00", False),
])
def test_late_compares_instants_across_offsets(submitted_at, expected):
    row = {"id": "w", "deadline": "2026-10-27T23:00:00+07:00", "submitted_at": submitted_at}
    assert writing_give_timing(row, NOW) == (expected, False)


def test_missing_is_only_for_unsubmitted_work_past_the_deadline():
    overdue = {"id": "w", "deadline": "2026-10-27T16:00:00Z", "submitted_at": None}
    open_ = {"id": "w", "deadline": "2026-10-29T16:00:00Z", "submitted_at": None}
    no_deadline = {"id": "w", "deadline": None, "submitted_at": "2026-10-27T16:00:00Z"}
    assert writing_give_timing(overdue, NOW) == (False, True)
    assert writing_give_timing(open_, NOW) == (False, False)
    assert writing_give_timing(no_deadline, NOW) == (False, False)


def test_due_at_is_deprecated_and_never_read():
    """`due_at` (mig 106) is written by no give path; only `deadline` counts."""
    row = {"id": "w", "deadline": None, "due_at": "2026-01-01T00:00:00Z",
           "submitted_at": "2026-10-27T16:00:00Z"}
    assert writing_give_timing(row, NOW) == (False, False)


def test_a_malformed_timestamp_is_logged_by_row_id_not_value(caplog):
    row = {"id": "w-bad", "deadline": "not-a-date", "submitted_at": "2026-10-27T16:00:00Z"}
    with caplog.at_level("WARNING"):
        assert writing_give_timing(row, NOW) == (False, False)
    assert "w-bad" in caplog.text and "not-a-date" not in caplog.text


# ── review state (W-07) ────────────────────────────────────────────────


@pytest.mark.parametrize("essay_status, expected", [
    ("delivered", "returned"),
    ("graded", "graded"),
    ("reviewed", "graded"),
    ("grading", "submitted"),
    ("pending", "submitted"),
    ("failed", "submitted"),
])
def test_review_state_follows_the_essay(essay_status, expected):
    row = {"submitted_at": "2026-10-27T16:00:00Z", "status": "submitted"}
    assert writing_review_state(row, {"status": essay_status}) == expected


def test_review_state_never_claims_more_than_submitted_without_the_essay():
    row = {"submitted_at": "2026-10-27T16:00:00Z", "status": "delivered"}
    assert writing_review_state(row, None) == "submitted"
    assert writing_review_state({"submitted_at": None}, {"status": "delivered"}) == "not_submitted"


def test_result_path_points_at_the_learner_result_page():
    assert writing_result_path("e1") == "/writing/result?essay_id=e1"
    assert writing_result_path(None) is None


# ── the admin cohort matrix and /instructor read the same rule ─────────


def test_admin_cohort_matrix_marks_a_late_hand_in():
    from tests.test_admin_writing_cohorts import _ADMIN_AUTH, _ADMIN_USER, _client, _db
    table_map = {
        "cohorts": [{"id": "c1", "name": "Lớp A"}],
        "students": [{"id": "s1", "full_name": "An", "student_code": "A1"},
                     {"id": "s2", "full_name": "Bình", "student_code": "B1"}],
        "writing_assignments": [
            {"id": "a1", "student_id": "s1", "prompt_id": "p1", "essay_id": "e1",
             "status": "submitted", "deadline": "2026-10-27T23:00:00+07:00",
             "submitted_at": "2026-10-27T16:30:00Z", "created_at": "2026-10-20",
             "updated_at": "2026-10-27", "assignment_group_id": "g1", "name": "Buổi 1"},
            {"id": "a2", "student_id": "s2", "prompt_id": "p1", "essay_id": "e2",
             "status": "submitted", "deadline": "2026-10-27T23:00:00+07:00",
             "submitted_at": "2026-10-27T15:30:00Z", "created_at": "2026-10-20",
             "updated_at": "2026-10-27", "assignment_group_id": "g1", "name": "Buổi 1"},
        ],
        "writing_prompts": [{"id": "p1", "title": "Đề 1", "task_type": "task_2"}],
        "writing_essays": [{"id": "e1", "status": "graded", "is_flagged": False},
                           {"id": "e2", "status": "graded", "is_flagged": False}],
    }
    cid = "11111111-1111-1111-1111-111111111111"
    with patch("routers.admin_writing_cohorts.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_cohorts.supabase_admin", _db(table_map)):
        r = _client().get("/admin/writing/cohorts/" + cid, headers=_ADMIN_AUTH)
    assert r.status_code == 200
    matrix = r.json()["matrix"]
    assert matrix["s1"]["group:g1:prompt:p1"]["is_late"] is True
    assert matrix["s2"]["group:g1:prompt:p1"]["is_late"] is False


def test_instructor_assignment_list_marks_a_late_hand_in():
    from tests.test_instructor_routes_isolation import A, AA, AB, _as, _seed
    store = _seed()
    for row in store["writing_assignments"]:
        row.update({"deadline": "2026-10-27T23:00:00+07:00", "created_at": "2026-10-20T00:00:00Z"})
    by_id = {row["id"]: row for row in store["writing_assignments"]}
    by_id[AA]["submitted_at"] = "2026-10-27T16:30:00Z"
    by_id[AB]["submitted_at"] = "2026-10-27T15:30:00Z"
    by_id[AB]["assigned_by"] = A          # second row on my list, on time
    with _as(A, store) as (client, _store):
        r = client.get("/instructor/assignments", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200
    late = {row["id"]: row["is_late"] for row in r.json()}
    assert late == {AA: True, AB: False}


# ── W-TIER-DISPLAY — the give's grading_tier is AI depth, not the tier ─


@pytest.fixture
def tier_db(monkeypatch):
    from tests.test_fix1_grade_loop import FakeSupabase
    fake = FakeSupabase()
    monkeypatch.setattr("routers.writing_student.supabase_admin", fake)
    return fake


def _qa_task2_give(fake, *, receipt: bool, ai_tier: str) -> dict:
    """The staging shape behind essays c4b72ec1/da76f35a: the owner (role admin)
    fanned 'QA TEST Task 2' out to his own class (cohorts.created_by = him)."""
    admin, student, cohort, group = (str(uuid4()) for _ in range(4))
    fake.tables["users"] = [{"id": admin, "role": "admin"}]
    fake.tables["students"] = [{"id": student, "instructor_id": None}]
    fake.tables["cohorts"] = [{"id": cohort, "created_by": admin}]
    fake.tables["writing_assignment_requests"] = (
        [{"id": str(uuid4()), "assigned_by": admin, "receipt": {"group_id": group}}]
        if receipt else [])
    return {"id": str(uuid4()), "assigned_by": admin, "student_id": student,
            "cohort_id": cohort, "assignment_group_id": group, "grading_tier": ai_tier}


@pytest.mark.parametrize("ai_tier", ["standard", "deep"])
def test_an_instructor_page_give_is_teacher_reviewed_whatever_its_ai_depth(tier_db, ai_tier):
    """No admin-tools receipt → given from /instructor → the teacher returns it.
    The 'Standard — 1 lượt AI' setting is the AI pre-pass, not a learner-facing
    'standard' tier, so it must not flip the decision either way."""
    from routers import writing_student
    give = _qa_task2_give(tier_db, receipt=False, ai_tier=ai_tier)
    assert writing_student._assignment_grading_tier(give) == "instructor"


@pytest.mark.parametrize("ai_tier", ["standard", "deep"])
def test_an_admin_tools_give_stays_standard_whatever_its_ai_depth(tier_db, ai_tier):
    from routers import writing_student
    give = _qa_task2_give(tier_db, receipt=True, ai_tier=ai_tier)
    assert writing_student._assignment_grading_tier(give) == "standard"
