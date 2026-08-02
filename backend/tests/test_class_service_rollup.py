"""services/class_service — sĩ số lớp cho trang gộp "Lớp & Học viên" (GĐ 1).

Three properties are worth pinning, and all three are ones the code gets to be
wrong about silently:

  * **The activation gap.** `unactivated_count` is students on the roster with no
    account. They receive nothing that is assigned to them — no error anywhere —
    so if this number is wrong the admin has no other signal (mig 177 header).

  * **Pagination.** PostgREST caps an un-ranged select at ~1000 rows. This repo
    has shipped that bug repeatedly and its signature is always a plausible
    number plus a green test run, which is exactly what a small fixture
    produces. The test here therefore uses >1000 rows on purpose: with a 30-row
    fixture a broken paginator passes.

  * **Failure ≠ zero.** A failed roster scan must report `rollup_failed` and
    leave the counts absent. "0 học viên" is a claim about the class that a
    query which never ran has not earned — the same rule the access-code
    endpoints follow with `association_lookup_failed`.

The service takes its db client as a parameter precisely so it can be exercised
with a stub, which is what this does — no network, no Supabase.
"""

from __future__ import annotations

import pytest

from services.class_service import list_cohorts_with_rollup


class _Resp:
    def __init__(self, data):
        self.data = data


# PostgREST's implicit ceiling on a select with no Range header. The stub MUST
# enforce it: without this a stub returns every row, so deleting the paginator
# still passes and the pagination test is a false green. (Verified by deleting
# the paginator — the test only fails once this cap exists.)
POSTGREST_IMPLICIT_CAP = 1000


class _Query:
    """Chainable stub of the postgrest builder, honouring the calls the service
    actually makes: select / eq / in_ / order / range / execute — including the
    implicit row cap when range() is never called."""

    def __init__(self, rows, *, raises=False):
        self._rows = rows
        self._raises = raises
        self._eq: list[tuple[str, object]] = []
        self._in: tuple[str, list] | None = None
        self._range: tuple[int, int] | None = None

    def select(self, *_a, **_kw):
        return self

    def eq(self, field, value):
        self._eq.append((field, value))
        return self

    def in_(self, field, values):
        self._in = (field, list(values))
        return self

    def order(self, *_a, **_kw):
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def execute(self):
        if self._raises:
            raise RuntimeError("boom")
        rows = list(self._rows)
        for field, value in self._eq:
            rows = [r for r in rows if r.get(field) == value]
        if self._in:
            field, values = self._in
            rows = [r for r in rows if r.get(field) in values]
        if self._range:
            start, end = self._range
            rows = rows[start:end + 1]      # postgrest range is inclusive
        else:
            rows = rows[:POSTGREST_IMPLICIT_CAP]
        return _Resp(rows)


class _DB:
    def __init__(self, tables, *, fail: set[str] = frozenset()):
        self._tables = tables
        self._fail = fail

    def table(self, name):
        return _Query(self._tables.get(name, []), raises=name in self._fail)


COHORT_A = "aaaaaaaa-0000-0000-0000-000000000001"
COHORT_B = "bbbbbbbb-0000-0000-0000-000000000002"
COURSE_C2 = "cccccccc-0000-0000-0000-000000000003"


def _base_tables(students):
    return {
        "cohorts": [
            {"id": COHORT_A, "name": "C2-K12", "is_active": True, "course_id": COURSE_C2,
             "created_at": "2026-08-01"},
            {"id": COHORT_B, "name": "Lớp chưa gán khoá", "is_active": True, "course_id": None,
             "created_at": "2026-07-01"},
        ],
        "courses": [
            {"id": COURSE_C2, "code": "C2", "name": "Khóa kỹ năng nền tảng",
             "sort_order": 2, "is_active": True},
        ],
        "students": students,
    }


def _student(i, cohort_id, *, activated):
    return {
        "id": f"s{i:05d}",
        "cohort_id": cohort_id,
        "user_id": f"u{i:05d}" if activated else None,
    }


# ── the activation gap ──────────────────────────────────────────────────


def test_counts_split_activated_from_not():
    students = (
        [_student(i, COHORT_A, activated=True) for i in range(7)]
        + [_student(100 + i, COHORT_A, activated=False) for i in range(3)]
        + [_student(200 + i, COHORT_B, activated=True) for i in range(2)]
    )
    out = list_cohorts_with_rollup(_DB(_base_tables(students)))
    by_id = {c["id"]: c for c in out["cohorts"]}

    assert by_id[COHORT_A]["member_count"] == 10
    assert by_id[COHORT_A]["unactivated_count"] == 3
    assert by_id[COHORT_B]["member_count"] == 2
    assert by_id[COHORT_B]["unactivated_count"] == 0
    assert "rollup_failed" not in out


def test_course_is_attached_and_absent_when_unassigned():
    out = list_cohorts_with_rollup(_DB(_base_tables([])))
    by_id = {c["id"]: c for c in out["cohorts"]}

    assert by_id[COHORT_A]["course"]["code"] == "C2"
    # NULL course_id is "chưa gán khoá", a real state every pre-mig-175 class is
    # in — not an error, and not something to invent a course for.
    assert by_id[COHORT_B]["course"] is None


# ── the 1000-row cap ────────────────────────────────────────────────────


def test_roster_scan_pages_past_the_postgrest_cap():
    """>1000 students in one class. An un-ranged select would return exactly
    1000 and look entirely plausible."""
    total = 2350
    unactivated = 137
    students = [
        _student(i, COHORT_A, activated=(i >= unactivated))
        for i in range(total)
    ]
    out = list_cohorts_with_rollup(_DB(_base_tables(students)))
    row = next(c for c in out["cohorts"] if c["id"] == COHORT_A)

    assert row["member_count"] == total, (
        "roster scan stopped at the PostgREST page cap — the count is plausible "
        "and wrong, which is how this bug has shipped here before"
    )
    assert row["unactivated_count"] == unactivated


@pytest.mark.parametrize("total", [999, 1000, 1001, 2000])
def test_paging_is_exact_at_the_page_boundaries(total):
    """1000 and 2000 are the off-by-one traps: a full page must trigger another
    fetch, and an exactly-empty follow-up page must terminate the loop."""
    students = [_student(i, COHORT_A, activated=True) for i in range(total)]
    out = list_cohorts_with_rollup(_DB(_base_tables(students)))
    row = next(c for c in out["cohorts"] if c["id"] == COHORT_A)
    assert row["member_count"] == total


# ── failure is not zero ─────────────────────────────────────────────────


def test_failed_roster_scan_reports_instead_of_counting_zero():
    db = _DB(_base_tables([]), fail={"students"})
    out = list_cohorts_with_rollup(db)

    assert out["rollup_failed"] is True
    for c in out["cohorts"]:
        assert c["member_count"] is None, "a failed scan must not render as 0 học viên"
        assert c["unactivated_count"] is None


def test_failed_course_lookup_is_reported_separately():
    """A broken course lookup must not be indistinguishable from "chưa gán
    khoá" — the admin would go assign a course that is already assigned."""
    db = _DB(_base_tables([]), fail={"courses"})
    out = list_cohorts_with_rollup(db)

    assert out["course_lookup_failed"] is True
    # Roster counts are independent and must still be trustworthy.
    assert "rollup_failed" not in out


def test_no_cohorts_means_no_student_query_and_no_failure_flag():
    tables = _base_tables([])
    tables["cohorts"] = []
    out = list_cohorts_with_rollup(_DB(tables, fail={"students"}))
    # `students` would raise if queried; an empty cohort list must short-circuit.
    assert out == {"cohorts": []}


# ── filters ─────────────────────────────────────────────────────────────


def test_course_filter_is_applied_by_the_query_not_after():
    out = list_cohorts_with_rollup(_DB(_base_tables([])), course_id=COURSE_C2)
    assert [c["id"] for c in out["cohorts"]] == [COHORT_A]
