"""Fix-1 merge-gate — grade-loop dead-end (D-A) + revoke desync (D2).

Two defects this pins, end-to-end, on an in-memory fake (no network IO):

  D-A  A student submitting an INSTRUCTOR-assigned essay must land in that
       instructor's review queue. The bug: submit never set
       grading_tier='instructor', so `_bg_grade_essay` never called
       create_review → the queue stayed empty. The decision lives in
       `routers.writing_student._assignment_grading_tier` (assignment-
       ownership only: assigned_by is an instructor → 'instructor';
       admin / mass-code / no-assignment → 'standard').

  D2   Revoking a delivered essay flips the essay delivered→reviewed but
       historically left the review row at 'delivered' — invisible to the
       default {queued,claimed} queue filter, so it could not be re-delivered.
       `instructor_workflow.sync_revoke_review` now flips the review
       delivered→claimed (keeping claimed_by) so it re-surfaces.

Pinned here:
  • tier decision: instructor → 'instructor'; admin / None → 'standard'
  • e2e loop: create_review → instructor queue → claim → deliver →
    essay delivered + student-visible instructor_note
  • REGRESSION (both ways): a standard essay (no review row) never appears
    in an instructor's queue — the admin/mass path is untouched
  • D2: revoke → review back to 'claimed' + visible in queue + re-deliverable;
    revoke on a standard essay (no review) is a 0-row no-op
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from models.instructor_review import InstructorReviewStatus


# ── In-memory fake for supabase_admin (mirrors test_instructor_workflow) ──


class _Response:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, fake, table_name):
        self.fake = fake
        self.table_name = table_name
        self.op = None
        self.payload = None
        self.filters = []
        self.in_filters = []
        self.limit_n = None
        self.order_by = None

    def select(self, *_args, **_kw):
        self.op = "select"
        return self

    def insert(self, payload):
        self.op = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.op = "update"
        self.payload = payload
        return self

    def eq(self, field, value):
        self.filters.append((field, "eq", value))
        return self

    def in_(self, field, values):
        self.in_filters.append((field, list(values)))
        return self

    def is_(self, field, value):
        self.filters.append((field, "is_", value))
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def order(self, field, desc=False):
        self.order_by = (field, desc)
        return self

    def _matches(self, row):
        for field, op, value in self.filters:
            if op == "is_":
                if value == "null" and row.get(field) is not None:
                    return False
                continue
            if row.get(field) != value:
                return False
        for field, values in self.in_filters:
            if row.get(field) not in values:
                return False
        return True

    def execute(self):
        rows = self.fake.tables.setdefault(self.table_name, [])

        if self.op == "insert":
            with self.fake.lock:
                if self.table_name == "instructor_reviews":
                    new_essay_id = self.payload.get("essay_id")
                    for r in rows:
                        if r.get("essay_id") == new_essay_id:
                            raise Exception(
                                "duplicate key value violates unique "
                                "constraint \"one_review_per_essay\""
                            )
                row = {
                    "id":           str(uuid4()),
                    "created_at":   datetime.now(timezone.utc).isoformat(),
                    "updated_at":   datetime.now(timezone.utc).isoformat(),
                    "claimed_by":   None,
                    "claimed_at":   None,
                    "delivered_at": None,
                    "instructor_note": None,
                    **self.payload,
                }
                rows.append(row)
                return _Response([row])

        if self.op == "select":
            matched = [r for r in rows if self._matches(r)]
            if self.order_by:
                field, desc = self.order_by
                matched.sort(key=lambda r: r.get(field) or "", reverse=desc)
            if self.limit_n is not None:
                matched = matched[: self.limit_n]
            return _Response(matched)

        if self.op == "update":
            with self.fake.lock:
                changed = []
                for r in rows:
                    if self._matches(r):
                        r.update(self.payload)
                        r["updated_at"] = datetime.now(timezone.utc).isoformat()
                        changed.append(r)
                return _Response(changed)

        raise AssertionError(f"Unsupported op: {self.op!r}")


class FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {}
        self.lock = threading.Lock()

    def table(self, name: str) -> _Query:
        return _Query(self, name)


# ── Fixtures ──────────────────────────────────────────────────────────


@pytest.fixture
def fake_db(monkeypatch):
    """One shared fake, patched into EVERY module that reads supabase_admin
    on the grade-loop path so the whole loop runs against the same state."""
    fake = FakeSupabase()
    for mod in (
        "services.instructor_workflow.supabase_admin",
        "services.instructor_access.supabase_admin",
        "routers.writing_student.supabase_admin",
    ):
        monkeypatch.setattr(mod, fake)
    return fake


@pytest.fixture
def workflow():
    from services import instructor_workflow
    return instructor_workflow


# ── D-A — tier decision (assignment-ownership only) ───────────────────


def test_tier_instructor_when_assigned_by_is_instructor(fake_db):
    from routers import writing_student
    instr = str(uuid4())
    fake_db.tables["users"] = [{"id": instr, "role": "instructor"}]
    assert writing_student._assignment_grading_tier({"assigned_by": instr}) == "instructor"


def test_tier_standard_when_assigned_by_is_admin(fake_db):
    """Admins also fan-out assignments — a non-null assigned_by is NOT enough.
    An admin-owned assignment must stay 'standard' so the admin path is untouched."""
    from routers import writing_student
    admin = str(uuid4())
    fake_db.tables["users"] = [{"id": admin, "role": "admin"}]
    assert writing_student._assignment_grading_tier({"assigned_by": admin}) == "standard"


def test_tier_standard_when_no_assigned_by(fake_db):
    from routers import writing_student
    assert writing_student._assignment_grading_tier({"assigned_by": None}) == "standard"
    assert writing_student._assignment_grading_tier({}) == "standard"


def test_tier_fail_safe_standard_on_lookup_miss(fake_db):
    """assigned_by present but no users row (role unknown) → fail-safe 'standard'
    (never misroute into the instructor queue on a lookup gap)."""
    from routers import writing_student
    assert writing_student._assignment_grading_tier({"assigned_by": str(uuid4())}) == "standard"


# ── e2e MERGE-GATE — submit → queue → claim → deliver → student sees ──


def _seed_instructor_owned_essay(fake_db, *, instr, status="graded"):
    """Seed an instructor-OWNED essay (assignment.assigned_by=instr AND
    student.instructor_id=instr) plus its feedback row. Returns essay_id."""
    student_id = str(uuid4())
    user_id = str(uuid4())
    essay_id = str(uuid4())
    fake_db.tables.setdefault("writing_assignments", []).append(
        {"id": str(uuid4()), "assigned_by": instr, "essay_id": essay_id}
    )
    fake_db.tables.setdefault("students", []).append(
        {"id": student_id, "instructor_id": instr, "user_id": user_id}
    )
    fake_db.tables.setdefault("users", []).append(
        {"id": user_id, "email": "student@example.com"}
    )
    fake_db.tables.setdefault("writing_essays", []).append({
        "id": essay_id, "student_id": student_id, "status": status,
        "analysis_level": 3, "task_type": "task2",
        "created_at": "2026-06-15", "instructor_note": None,
    })
    fake_db.tables.setdefault("writing_feedback", []).append(
        {"essay_id": essay_id, "prompt_version": "v2.1-instructor-pending"}
    )
    return essay_id


def test_e2e_submit_to_student_sees(fake_db, workflow):
    """The merge-gate: an instructor-owned, instructor-tier essay flows
    create_review → queue → claim → deliver → essay delivered with the
    teacher-comment visible to the student (separate from AI feedback)."""
    instr = str(uuid4())
    essay_id = _seed_instructor_owned_essay(fake_db, instr=instr)

    # _bg_grade_essay fires this for tier==INSTRUCTOR essays.
    review = workflow.create_review(essay_id)
    assert review.status == InstructorReviewStatus.QUEUED

    # Appears in THAT instructor's queue (ownership-derived routing).
    queue = workflow.get_instructor_queue(instr)
    assert len(queue) == 1
    assert str(queue[0].essay_id) == essay_id

    # Claim (owner-checked) → teacher-comment via deliver's note → deliver.
    workflow.claim(review.id, instr, owner_id=instr)
    workflow.deliver(review.id, instr, instructor_note="Tốt lắm em!")

    essay = fake_db.tables["writing_essays"][0]
    assert essay["status"] == "delivered"
    assert essay["instructor_note"] == "Tốt lắm em!"   # student-visible, separate from AI


def test_standard_essay_never_enters_instructor_queue(fake_db, workflow):
    """REGRESSION (admin path intact): an instructor-owned essay with NO
    review row (the standard/admin path never calls create_review) does not
    surface in the instructor queue. Combined with the tier-decision tests
    above (admin/None → 'standard'), this proves the mass-code/admin essay
    never floods a GV's queue."""
    instr = str(uuid4())
    _seed_instructor_owned_essay(fake_db, instr=instr)   # owned, but no create_review
    assert workflow.get_instructor_queue(instr) == []


# ── D2 — revoke ↔ review coherence ────────────────────────────────────


def test_revoke_syncs_review_and_allows_redeliver(fake_db, workflow):
    """deliver → revoke-sync → review back to 'claimed' (in the default queue
    filter) + claimed_by preserved → the same instructor re-delivers."""
    instr = str(uuid4())
    essay_id = _seed_instructor_owned_essay(fake_db, instr=instr)
    review = workflow.create_review(essay_id)
    workflow.claim(review.id, instr, owner_id=instr)
    workflow.deliver(review.id, instr, instructor_note="v1")

    # Simulate the revoke route: essay delivered→reviewed, then sync the review.
    fake_db.tables["writing_essays"][0]["status"] = "reviewed"
    synced = workflow.sync_revoke_review(essay_id)
    assert synced is not None
    assert synced.status == InstructorReviewStatus.CLAIMED
    assert str(synced.claimed_by) == instr   # stays with the same GV
    assert synced.delivered_at is None

    # Re-surfaces in the queue (claimed ∈ default filter) and re-delivers.
    queue = workflow.get_instructor_queue(instr)
    assert len(queue) == 1 and str(queue[0].essay_id) == essay_id
    redelivered = workflow.deliver(review.id, instr, instructor_note="v2")
    assert redelivered.status == InstructorReviewStatus.DELIVERED
    assert fake_db.tables["writing_essays"][0]["instructor_note"] == "v2"


def test_revoke_sync_noop_for_standard_essay(fake_db, workflow):
    """A standard essay has no review row → sync_revoke_review is a 0-row
    no-op (returns None). The admin/mass-code revoke path is safe."""
    assert workflow.sync_revoke_review(str(uuid4())) is None
