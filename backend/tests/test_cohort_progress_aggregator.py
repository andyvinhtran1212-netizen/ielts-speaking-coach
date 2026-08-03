"""services/cohort_progress_aggregator — tiến độ 4 kỹ năng của cả lớp (GĐ 4).

Four properties, each one the code can be silently wrong about:

  * **Batched, not per-student.** A class of 30 asked skill-by-skill is 120
    round-trips and it grows with the roster. The test counts the queries.

  * **A failed skill is null, never zero.** "0 lượt Reading" is a claim about a
    student that an errored query has not earned — and unlike a slow page, a
    wrong zero is invisible.

  * **No account ≠ did nothing.** Speaking/Reading/Listening key off
    `students.user_id`; a student who never activated has no rows there. The row
    carries `activated: false` so the page can say which it is.

  * **The last band is the last band that EXISTS.** The newest attempt may be
    ungraded; showing "—" for a student who has bands is worse than showing the
    last real one.
"""

from __future__ import annotations

import pytest

from services.cohort_progress_aggregator import cohort_progress

POSTGREST_IMPLICIT_CAP = 1000

COHORT = "c1"


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, name, rows, *, raises=False):
        self.db, self.name, self._rows, self._raises = db, name, rows, raises
        self._eq, self._in, self._range = [], None, None

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self

    def eq(self, f, v): self._eq.append((f, v)); return self
    def in_(self, f, v):
        self._in = (f, list(v))
        self.db.in_sizes.append(len(v))
        return self
    def range(self, s, e): self._range = (s, e); return self

    def execute(self):
        self.db.queries.append(self.name)
        if self._raises:
            raise RuntimeError("boom")
        rows = list(self._rows)
        for f, v in self._eq:
            rows = [r for r in rows if r.get(f) == v]
        if self._in:
            f, vals = self._in
            rows = [r for r in rows if r.get(f) in vals]
        if self._range:
            s, e = self._range
            rows = rows[s:e + 1]
        else:
            rows = rows[:POSTGREST_IMPLICIT_CAP]
        return _Resp(rows)


class _DB:
    def __init__(self, tables, *, fail=frozenset()):
        self.tables, self.fail = tables, fail
        self.queries: list[str] = []
        self.in_sizes: list[int] = []

    def table(self, name):
        return _Query(self, name, self.tables.get(name, []), raises=name in self.fail)


def _tables(*, students, sessions=(), essays=(), reading=(), listening=()):
    return {
        "students": list(students),
        "sessions": list(sessions),
        "writing_essays": list(essays),
        "reading_test_attempts": list(reading),
        "listening_test_attempts": list(listening),
    }


def _student(sid, uid=None):
    return {"id": sid, "student_code": sid.upper(), "full_name": f"HV {sid}",
            "user_id": uid, "cohort_id": COHORT}


# ── gộp theo lô ─────────────────────────────────────────────────────────


def test_one_query_per_skill_regardless_of_class_size():
    """Per-student fetching is 4 queries × N students. This must stay flat."""
    students = [_student(f"s{i}", f"u{i}") for i in range(30)]
    db = _DB(_tables(students=students))
    cohort_progress(db, COHORT)

    for table in ("sessions", "writing_essays",
                  "reading_test_attempts", "listening_test_attempts"):
        assert db.queries.count(table) == 1, (
            f"{table} was queried {db.queries.count(table)}× for 30 students"
        )


def test_id_lists_are_chunked_for_the_url():
    """A thousand ids in one `in.(...)` is tens of KB of query string; PostgREST
    rejects it before pagination runs."""
    students = [_student(f"s{i:04d}", f"u{i:04d}") for i in range(250)]
    db = _DB(_tables(students=students))
    cohort_progress(db, COHORT)
    assert db.in_sizes, "no in_() filter was applied at all"
    assert max(db.in_sizes) <= 100, f"an in.() carried {max(db.in_sizes)} ids"


# ── lỗi ≠ số 0 ──────────────────────────────────────────────────────────


def test_a_failed_skill_is_null_not_zero():
    students = [_student("s1", "u1")]
    db = _DB(_tables(students=students), fail={"reading_test_attempts"})
    out = cohort_progress(db, COHORT)

    assert out["degraded"] == ["reading"]
    row = out["students"][0]
    assert row["skills"]["reading"] is None, "a failed query must not render as 0 lượt"
    # …and the other three still report.
    assert row["skills"]["speaking"] == {"attempts": 0, "last_activity": None, "last_band": None}


def test_one_broken_skill_does_not_take_the_others_down():
    students = [_student("s1", "u1")]
    db = _DB(_tables(students=students,
                     sessions=[{"id": "x", "user_id": "u1", "started_at": "2026-08-01",
                                "overall_band": 6.0, "status": "completed"}]),
             fail={"writing_essays"})
    out = cohort_progress(db, COHORT)
    assert out["degraded"] == ["writing"]
    assert out["students"][0]["skills"]["speaking"]["attempts"] == 1


# ── chưa kích hoạt ≠ chưa làm gì ────────────────────────────────────────


def test_a_student_with_no_account_is_marked_not_silently_empty():
    students = [_student("s1", None)]
    db = _DB(_tables(students=students))
    row = cohort_progress(db, COHORT)["students"][0]

    assert row["activated"] is False
    # The three user-keyed skills are empty because there is no account, and the
    # flag is what lets the page say that instead of "did nothing".
    assert row["skills"]["speaking"]["attempts"] == 0
    assert row["skills"]["listening"]["attempts"] == 0


def test_writing_still_counts_for_an_unactivated_student():
    """Writing keys off students.id — an admin can enter essays before the
    learner ever activates."""
    students = [_student("s1", None)]
    db = _DB(_tables(students=students,
                     essays=[{"id": "e1", "student_id": "s1",
                              "created_at": "2026-08-01", "status": "delivered"}]))
    row = cohort_progress(db, COHORT)["students"][0]
    assert row["activated"] is False
    assert row["skills"]["writing"]["attempts"] == 1


def test_rows_are_attributed_to_the_right_student():
    students = [_student("s1", "u1"), _student("s2", "u2")]
    db = _DB(_tables(students=students, sessions=[
        {"id": "a", "user_id": "u1", "started_at": "2026-08-01", "overall_band": 6.0, "status": "completed"},
        {"id": "b", "user_id": "u2", "started_at": "2026-08-02", "overall_band": 7.0, "status": "completed"},
        {"id": "c", "user_id": "u2", "started_at": "2026-08-03", "overall_band": 7.5, "status": "completed"},
    ]))
    by_id = {r["student_id"]: r for r in cohort_progress(db, COHORT)["students"]}
    assert by_id["s1"]["skills"]["speaking"]["attempts"] == 1
    assert by_id["s2"]["skills"]["speaking"]["attempts"] == 2


# ── band gần nhất CÓ THẬT ───────────────────────────────────────────────


def test_last_band_skips_an_ungraded_newer_attempt():
    """The newest attempt may have no band yet. Showing "—" for a student who
    does have bands is worse than showing their last real one."""
    students = [_student("s1", "u1")]
    db = _DB(_tables(students=students, sessions=[
        {"id": "a", "user_id": "u1", "started_at": "2026-08-01", "overall_band": 6.5, "status": "completed"},
        {"id": "b", "user_id": "u1", "started_at": "2026-08-05", "overall_band": None, "status": "completed"},
    ]))
    cell = cohort_progress(db, COHORT)["students"][0]["skills"]["speaking"]
    assert cell["attempts"] == 2
    assert cell["last_band"] == 6.5
    assert cell["last_activity"] == "2026-08-05", "activity is the newest attempt, graded or not"


def test_only_completed_speaking_counts():
    """An abandoned in-progress session is not an attempt at the work."""
    students = [_student("s1", "u1")]
    db = _DB(_tables(students=students, sessions=[
        {"id": "a", "user_id": "u1", "started_at": "2026-08-01", "overall_band": 6.0, "status": "completed"},
        {"id": "b", "user_id": "u1", "started_at": "2026-08-02", "overall_band": None, "status": "in_progress"},
    ]))
    assert cohort_progress(db, COHORT)["students"][0]["skills"]["speaking"]["attempts"] == 1


def test_an_empty_class_asks_for_nothing_else():
    db = _DB(_tables(students=[]))
    out = cohort_progress(db, COHORT)
    assert out == {"students": [], "degraded": []}
    assert db.queries == ["students"], "no skill query should run for an empty roster"
