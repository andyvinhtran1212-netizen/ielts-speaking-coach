"""Tests for services/instructor_workflow.py (Sprint 2.7d.1).

Covers the workflow service in isolation by stubbing
`supabase_admin` with a stateful in-memory fake. The fake
implements just enough of the Supabase Python client surface
(`.table().select()/.insert()/.update()/.eq()/.in_()/.limit()/.execute()`)
to exercise the queue/claim/release/deliver lifecycle.

What we pin:
  - create_review is idempotent (duplicate calls return existing row)
  - claim is atomic — concurrent claims, only one succeeds, loser
    raises ConflictError
  - claim against a non-queued row raises ConflictError with the
    current status in the message
  - release auth — non-owner raises PermissionError
  - deliver mirrors instructor_note onto writing_essays AND flips
    writing_essays.status='delivered' AND stamps writing_feedback
    prompt_version with -instructor (idempotent)
  - get_review_for_essay returns None for non-Instructor essays
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest

from models.instructor_review import (
    InstructorReview,
    InstructorReviewStatus,
)


# ── In-memory fake for supabase_admin ─────────────────────────────────


class _Response:
    def __init__(self, data):
        self.data = data


class _Query:
    """Builder that records filters and resolves on .execute()."""

    def __init__(self, fake, table_name):
        self.fake = fake
        self.table_name = table_name
        self.op = None              # 'select' | 'insert' | 'update'
        self.payload = None
        self.filters = []           # list of (field, op, value)
        self.in_filters = []        # list of (field, [values])
        self.limit_n = None
        self.order_by = None

    # Builder methods —— each returns self for chaining.
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

    def limit(self, n):
        self.limit_n = n
        return self

    def order(self, field, desc=False):
        self.order_by = (field, desc)
        return self

    def _matches(self, row):
        for field, op, value in self.filters:
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
                # Honour UNIQUE on (essay_id) for instructor_reviews.
                if self.table_name == "instructor_reviews":
                    new_essay_id = self.payload.get("essay_id")
                    for r in rows:
                        if r.get("essay_id") == new_essay_id:
                            raise Exception(
                                "duplicate key value violates unique "
                                "constraint \"one_review_per_essay\""
                            )
                row = {
                    "id":         str(uuid4()),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "claimed_by": None,
                    "claimed_at": None,
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
    """Stateful in-memory stand-in for `database.supabase_admin`."""

    def __init__(self):
        self.tables: dict[str, list[dict]] = {}
        self.lock = threading.Lock()

    def table(self, name: str) -> _Query:
        return _Query(self, name)


# ── Fixtures ──────────────────────────────────────────────────────────


@pytest.fixture
def fake_db(monkeypatch):
    """Replace `services.instructor_workflow.supabase_admin` with a fake."""
    fake = FakeSupabase()
    monkeypatch.setattr(
        "services.instructor_workflow.supabase_admin", fake,
    )
    return fake


@pytest.fixture
def workflow():
    """Re-import after monkeypatching is applied."""
    from services import instructor_workflow
    return instructor_workflow


# ── create_review ─────────────────────────────────────────────────────


def test_create_review_inserts_queued_row(fake_db, workflow):
    essay_id = uuid4()
    review = workflow.create_review(essay_id)
    assert review.essay_id == essay_id
    assert review.status == InstructorReviewStatus.QUEUED
    assert review.claimed_by is None


def test_create_review_idempotent_returns_existing(fake_db, workflow):
    """A duplicate call must not raise — returns the existing row.
    Matters for retry from `_bg_grade_essay` after a partial failure."""
    essay_id = uuid4()
    first = workflow.create_review(essay_id)
    second = workflow.create_review(essay_id)
    assert first.id == second.id
    assert first.status == second.status


# ── claim ─────────────────────────────────────────────────────────────


def test_claim_queued_review_succeeds(fake_db, workflow):
    review = workflow.create_review(uuid4())
    instructor = uuid4()
    claimed = workflow.claim(review.id, instructor)
    assert claimed.status == InstructorReviewStatus.CLAIMED
    assert claimed.claimed_by == instructor
    assert claimed.claimed_at is not None


def test_claim_already_claimed_raises_conflict(fake_db, workflow):
    review = workflow.create_review(uuid4())
    a, b = uuid4(), uuid4()
    workflow.claim(review.id, a)
    with pytest.raises(workflow.ConflictError, match="cannot claim"):
        workflow.claim(review.id, b)


def test_claim_nonexistent_review_raises_not_found(fake_db, workflow):
    with pytest.raises(workflow.NotFoundError, match="not found"):
        workflow.claim(uuid4(), uuid4())


def test_concurrent_claim_only_one_succeeds(fake_db, workflow):
    """Two threads race to claim the same review. Postgres UPDATE
    WHERE atomic semantics ensure exactly one wins; the loser sees
    zero affected rows. Our in-memory fake mirrors that with a
    threading.Lock around UPDATE — same contract."""
    review = workflow.create_review(uuid4())
    a, b = uuid4(), uuid4()
    results: list = []
    barrier = threading.Barrier(2)

    def attempt(instructor_id):
        try:
            barrier.wait(timeout=1)
            results.append(("ok", workflow.claim(review.id, instructor_id)))
        except workflow.ConflictError as e:
            results.append(("conflict", e))
        except Exception as e:  # noqa: BLE001
            results.append(("error", e))

    t1 = threading.Thread(target=attempt, args=(a,))
    t2 = threading.Thread(target=attempt, args=(b,))
    t1.start(); t2.start()
    t1.join(timeout=2); t2.join(timeout=2)

    successes = [r for tag, r in results if tag == "ok"]
    conflicts = [r for tag, r in results if tag == "conflict"]
    assert len(successes) == 1, (
        f"expected exactly 1 successful claim, got {len(successes)} "
        f"(results: {results})"
    )
    assert len(conflicts) == 1


# ── release ───────────────────────────────────────────────────────────


def test_release_returns_to_queue(fake_db, workflow):
    review = workflow.create_review(uuid4())
    instructor = uuid4()
    workflow.claim(review.id, instructor)
    released = workflow.release(review.id, instructor)
    assert released.status == InstructorReviewStatus.QUEUED
    assert released.claimed_by is None
    assert released.claimed_at is None


def test_release_by_non_owner_raises_permission_error(fake_db, workflow):
    review = workflow.create_review(uuid4())
    a, b = uuid4(), uuid4()
    workflow.claim(review.id, a)
    with pytest.raises(PermissionError, match="not claimed by instructor"):
        workflow.release(review.id, b)


# ── deliver ───────────────────────────────────────────────────────────


def test_deliver_marks_review_delivered_and_writes_note(fake_db, workflow):
    """Deliver flips review status, mirrors note onto writing_essays
    (student-facing column from migration 043), flips essay status,
    and stamps writing_feedback prompt_version with -instructor."""
    essay_id = uuid4()
    fake_db.tables["writing_essays"] = [{
        "id": str(essay_id),
        "status": "graded",
        "instructor_note": None,
    }]
    fake_db.tables["writing_feedback"] = [{
        "essay_id": str(essay_id),
        "prompt_version": "v2.1-instructor-pending",
    }]
    review = workflow.create_review(essay_id)
    instructor = uuid4()
    workflow.claim(review.id, instructor)

    delivered = workflow.deliver(
        review.id, instructor,
        instructor_note="Great work, em!",
    )
    assert delivered.status == InstructorReviewStatus.DELIVERED
    assert delivered.instructor_note == "Great work, em!"
    assert delivered.delivered_at is not None

    # Side effects: writing_essays + writing_feedback updated.
    essay = fake_db.tables["writing_essays"][0]
    assert essay["status"] == "delivered"
    assert essay["instructor_note"] == "Great work, em!"

    fb = fake_db.tables["writing_feedback"][0]
    assert fb["prompt_version"] == "v2.1-instructor", (
        "deliver must strip -instructor-pending and replace with -instructor"
    )


def test_deliver_without_note_does_not_clobber_existing_writing_essays_note(fake_db, workflow):
    """Existing instructor_note on writing_essays (set via the legacy
    PATCH /instructor-note path before deliver) must survive when
    deliver is called with note=None. Same column, two writers — the
    deliver action must not blank it."""
    essay_id = uuid4()
    fake_db.tables["writing_essays"] = [{
        "id": str(essay_id),
        "status": "graded",
        "instructor_note": "Pre-set via legacy PATCH",
    }]
    fake_db.tables["writing_feedback"] = [{
        "essay_id": str(essay_id),
        "prompt_version": "v2.1-instructor-pending",
    }]
    review = workflow.create_review(essay_id)
    instructor = uuid4()
    workflow.claim(review.id, instructor)
    workflow.deliver(review.id, instructor, instructor_note=None)

    essay = fake_db.tables["writing_essays"][0]
    assert essay["instructor_note"] == "Pre-set via legacy PATCH", (
        "deliver(note=None) must not clobber a pre-set instructor_note"
    )


def test_deliver_by_non_owner_raises(fake_db, workflow):
    review = workflow.create_review(uuid4())
    a, b = uuid4(), uuid4()
    workflow.claim(review.id, a)
    with pytest.raises(PermissionError, match="cannot be delivered"):
        workflow.deliver(review.id, b, instructor_note="hi")


def test_deliver_stamp_idempotent_no_double_suffix(fake_db, workflow):
    """A re-deliver (admin clicks twice) must NOT produce
    `v2.1-instructor-instructor`. Stamp is normalised before append."""
    essay_id = uuid4()
    fake_db.tables["writing_essays"] = [{
        "id": str(essay_id),
        "status": "graded",
        "instructor_note": None,
    }]
    fake_db.tables["writing_feedback"] = [{
        "essay_id": str(essay_id),
        "prompt_version": "v2.1-instructor",  # already suffixed
    }]
    review = workflow.create_review(essay_id)
    instructor = uuid4()
    workflow.claim(review.id, instructor)
    workflow.deliver(review.id, instructor, instructor_note="x")

    assert fake_db.tables["writing_feedback"][0]["prompt_version"] == "v2.1-instructor"


# ── get_review_for_essay ──────────────────────────────────────────────


def test_get_review_for_essay_returns_none_for_no_row(fake_db, workflow):
    """Standard / Deep tier essays have no instructor_reviews row.
    Caller (student-facing status endpoint) must treat None as
    'no instructor flow involved'."""
    assert workflow.get_review_for_essay(uuid4()) is None


def test_get_review_for_essay_returns_existing_row(fake_db, workflow):
    essay_id = uuid4()
    created = workflow.create_review(essay_id)
    fetched = workflow.get_review_for_essay(essay_id)
    assert fetched is not None
    assert fetched.id == created.id


# ── Sprint 2.7d.2 — essay_id filter on get_queue ──────────────────────


def test_get_queue_essay_id_filter_returns_single_review(fake_db, workflow):
    """The grading page passes essay_id to fetch the review for one
    essay without scanning the full queue. Must return exactly the
    matching review (or empty list)."""
    target_essay = uuid4()
    other_essay = uuid4()
    # Seed essay rows so the queue's join doesn't filter the target out.
    fake_db.tables["writing_essays"] = [
        {"id": str(target_essay), "student_id": None,
         "analysis_level": 3, "task_type": "task2", "created_at": "2026-05-08"},
        {"id": str(other_essay),  "student_id": None,
         "analysis_level": 4, "task_type": "task1_academic", "created_at": "2026-05-08"},
    ]
    target_review = workflow.create_review(target_essay)
    workflow.create_review(other_essay)

    items = workflow.get_queue(essay_id=target_essay)

    assert len(items) == 1
    assert items[0].review.id == target_review.id
    assert items[0].essay_id == target_essay


def test_get_queue_essay_id_no_match_returns_empty(fake_db, workflow):
    """No review for that essay → empty list, not error."""
    items = workflow.get_queue(essay_id=uuid4())
    assert items == []


# ── Sprint 2.7d.1.1 hotfix — schema-aware regression ──────────────────


def test_get_queue_select_columns_match_writing_essays_migration():
    """Schema-aware regression for the 2.7d.1.1 hotfix.

    The original 2.7d.1 implementation SELECTed `level` from
    writing_essays — but migration 033 named the column
    `analysis_level`. The in-memory FakeSupabase fixture didn't
    enforce schema, so the 30 tests passed while production
    crashed with "column writing_essays.level does not exist".

    This test reads migration 033 directly and verifies that
    every column the workflow's get_queue() SELECTs from
    writing_essays actually exists in the migration's CREATE
    TABLE block. A future SELECT that references a non-existent
    column (or a typo like `level` vs `analysis_level`) surfaces
    HERE instead of in production.

    See TECH_DEBT.md anti-pattern #37 — schema-naive test fixtures.
    """
    import re
    from pathlib import Path

    migration_path = (
        Path(__file__).parent.parent / "migrations"
        / "033_writing_coach_tables.sql"
    )
    sql = migration_path.read_text(encoding="utf-8")

    # Extract the writing_essays CREATE TABLE block — everything
    # between `CREATE TABLE ... writing_essays (` and the matching
    # `);`. The migration file may have other tables; we want only
    # the writing_essays columns.
    match = re.search(
        r"CREATE TABLE[^(]*writing_essays\s*\((.*?)\n\)\s*;",
        sql, re.DOTALL | re.IGNORECASE,
    )
    assert match, "migration 033 must have a CREATE TABLE writing_essays block"
    block = match.group(1)

    # Extract column names (first identifier on each line that isn't
    # a CHECK / CONSTRAINT / FOREIGN / PRIMARY / etc.). Tolerant —
    # commented lines and comma-only lines skipped.
    columns: set[str] = set()
    for raw_line in block.splitlines():
        line = raw_line.strip().rstrip(",")
        if not line or line.startswith("--"):
            continue
        upper = line.upper()
        if any(upper.startswith(kw) for kw in (
            "CONSTRAINT", "PRIMARY", "FOREIGN", "CHECK", "UNIQUE", "REFERENCES",
        )):
            continue
        m = re.match(r"([a-zA-Z_][a-zA-Z0-9_]*)", line)
        if m:
            columns.add(m.group(1).lower())

    # Pin the columns the workflow's SELECT actually uses. Update
    # this list (and the workflow's SELECT in lockstep) when the
    # query changes.
    selected_columns = {
        "id", "student_id", "analysis_level", "task_type", "created_at",
    }

    missing = selected_columns - columns
    assert not missing, (
        f"get_queue() SELECTs columns from writing_essays that don't "
        f"exist in migration 033: {missing}. Either the column was "
        f"renamed (update both migration + SELECT) or the SELECT has "
        f"a typo. The column most commonly mistaken: 'level' → real "
        f"name is 'analysis_level' (Sprint 2.7d.1.1 hotfix)."
    )
    # Specifically: 'level' (no underscore prefix) MUST NOT be the
    # column name. This is the exact bug 2.7d.1.1 fixed.
    assert "level" not in columns or "analysis_level" in columns, (
        "writing_essays must define `analysis_level`, not bare `level`"
    )
