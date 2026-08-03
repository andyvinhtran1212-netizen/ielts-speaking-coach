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
        self._eq, self._in, self._range = [], [], None
        self._is_null, self._negate_is = None, False

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self

    def eq(self, f, v): self._eq.append((f, v)); return self
    def in_(self, f, v):
        # ACCUMULATE: keeping only the last one silently dropped a filter of a
        # chained .in_(a).in_(b), so a test could not tell whether the query
        # really narrowed on both.
        self._in.append((f, list(v)))
        self.db.in_sizes.append(len(v))
        return self

    def update(self, patch):
        self._update = dict(patch)
        return self
    def range(self, s, e): self._range = (s, e); return self

    def is_(self, field, value):
        self._is_null = (field, value)
        return self

    @property
    def not_(self):
        self._negate_is = True
        return self

    def execute(self):
        self.db.queries.append(self.name)
        if self._raises:
            raise RuntimeError("boom")
        rows = list(self._rows)
        for f, v in self._eq:
            rows = [r for r in rows if r.get(f) == v]
        for f, vals in self._in:
            rows = [r for r in rows if r.get(f) in vals]
        if self._is_null and self._is_null[1] == "null":
            field = self._is_null[0]
            # .not_.is_(x, "null") means "x IS NOT NULL"
            rows = [r for r in rows
                    if (r.get(field) is None) != self._negate_is]
        if getattr(self, "_update", None) is not None:
            for r in rows:
                r.update(self._update)
            return _Resp(rows)
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
        "writing_feedback_current": [],
        "dictation_sessions": [],
        "class_assignments": [],
        "class_assignment_items": [],
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


# ── nguồn dữ liệu phải TRÙNG với các màn admin đã có (Codex review) ─────


def _tables2(**kw):
    base = {
        "students": [], "sessions": [], "writing_essays": [],
        "writing_feedback_current": [], "reading_test_attempts": [],
        "listening_test_attempts": [], "dictation_sessions": [],
        "class_assignments": [], "class_assignment_items": [],
    }
    base.update({k: list(v) for k, v in kw.items()})
    return base


def test_writing_excludes_soft_deleted_essays():
    """admin_writing_cohorts already filters deleted_at IS NULL. Counting them
    here would put two admin screens at odds about the same student."""
    db = _DB(_tables2(
        students=[_student("s1", "u1")],
        writing_essays=[
            {"id": "e1", "student_id": "s1", "created_at": "2026-08-01",
             "status": "delivered", "deleted_at": None},
            {"id": "e2", "student_id": "s1", "created_at": "2026-08-02",
             "status": "delivered", "deleted_at": "2026-08-03"},
        ],
    ))
    cell = cohort_progress(db, COHORT)["students"][0]["skills"]["writing"]
    assert cell["attempts"] == 1, "a soft-deleted essay was counted"


def test_writing_band_comes_from_the_current_feedback_view():
    """The band lives in writing_feedback_current, not on the essay — without
    reading it the column showed no band for students who HAVE been graded."""
    db = _DB(_tables2(
        students=[_student("s1", "u1")],
        writing_essays=[{"id": "e1", "student_id": "s1", "created_at": "2026-08-01",
                         "status": "delivered", "deleted_at": None}],
        writing_feedback_current=[{"id": "f1", "essay_id": "e1",
                                   "overall_band_score": 6.5}],
    ))
    cell = cohort_progress(db, COHORT)["students"][0]["skills"]["writing"]
    assert cell["last_band"] == 6.5


def test_listening_counts_dictation_as_well_as_full_tests():
    """services/student_service calls listening_test_attempts + dictation_sessions
    the canonical pair. Folding only the tests made a dictation-only learner read
    as inactive here and active on their profile."""
    db = _DB(_tables2(
        students=[_student("s1", "u1")],
        listening_test_attempts=[{"id": "t1", "user_id": "u1",
                                  "submitted_at": "2026-08-01",
                                  "band_estimate": 6.0, "status": "submitted"}],
        dictation_sessions=[
            {"id": "d1", "user_id": "u1", "completed_at": "2026-08-04"},
            {"id": "d2", "user_id": "u1", "completed_at": "2026-08-05"},
        ],
    ))
    cell = cohort_progress(db, COHORT)["students"][0]["skills"]["listening"]
    assert cell["attempts"] == 3, "dictation sessions were not counted"
    assert cell["last_activity"] == "2026-08-05", "dictation must move last activity"
    # Dictation reports accuracy, not an IELTS band — the band stays test-only.
    assert cell["last_band"] == 6.0


def test_a_dictation_only_learner_is_not_shown_as_inactive():
    db = _DB(_tables2(
        students=[_student("s1", "u1")],
        dictation_sessions=[{"id": "d1", "user_id": "u1", "completed_at": "2026-08-04"}],
    ))
    cell = cohort_progress(db, COHORT)["students"][0]["skills"]["listening"]
    assert cell["attempts"] == 1
    assert cell["last_band"] is None


# ── % nộp đúng hạn (Codex review — kế hoạch dòng 223 hứa, tôi bỏ sót) ────


DUE = "2026-08-03T19:00:00+07:00"          # 12:00Z
ON_TIME = "2026-08-03T11:00:00+00:00"      # 18:00 giờ VN
LATE = "2026-08-03T13:00:00+00:00"         # 20:00 giờ VN
# Comfortably in the past whenever the suite runs.
PAST_DUE = "2020-01-01T19:00:00+07:00"


def _hw_tables(students, assignments, items):
    base = _tables2(students=students)
    base["class_assignments"] = list(assignments)
    base["class_assignment_items"] = list(items)
    return base


def test_on_time_rate_counts_hand_ins_not_everything_assigned():
    """Dividing by everything assigned would drag a punctual student down for
    work that is not even due yet — the opposite of what the column is for."""
    db = _DB(_hw_tables(
        [_student("s1", "u1")],
        [{"id": "a1", "due_at": DUE, "status": "published", "cohort_id": COHORT},
         {"id": "a2", "due_at": DUE, "status": "published", "cohort_id": COHORT},
         {"id": "a3", "due_at": None, "status": "published", "cohort_id": COHORT}],
        [{"id": "i1", "assignment_id": "a1", "student_id": "s1", "submitted_at": ON_TIME},
         {"id": "i2", "assignment_id": "a2", "student_id": "s1", "submitted_at": ON_TIME},
         {"id": "i3", "assignment_id": "a3", "student_id": "s1", "submitted_at": None}],
    ))
    hw = cohort_progress(db, COHORT)["students"][0]["homework"]
    assert hw["submitted"] == 2
    assert hw["on_time_pct"] == 100


def test_a_late_hand_in_lowers_the_rate():
    db = _DB(_hw_tables(
        [_student("s1", "u1")],
        [{"id": f"a{i}", "due_at": DUE, "status": "published", "cohort_id": COHORT}
         for i in range(4)],
        [{"id": "i0", "assignment_id": "a0", "student_id": "s1", "submitted_at": ON_TIME},
         {"id": "i1", "assignment_id": "a1", "student_id": "s1", "submitted_at": ON_TIME},
         {"id": "i2", "assignment_id": "a2", "student_id": "s1", "submitted_at": ON_TIME},
         {"id": "i3", "assignment_id": "a3", "student_id": "s1", "submitted_at": LATE}],
    ))
    hw = cohort_progress(db, COHORT)["students"][0]["homework"]
    assert (hw["late"], hw["on_time_pct"]) == (1, 75)


def test_nothing_handed_in_yet_is_unknown_not_zero_percent():
    """0% reads as "always late" — a damning verdict on someone who may simply be
    new to the class.

    Uses a deadline safely in the past: DUE is 19:00 on a date that may still be
    ahead of the clock when the suite runs, which would make `missing` legitimately
    zero and the assertion meaningless.
    """
    db = _DB(_hw_tables(
        [_student("s1", "u1")],
        [{"id": "a1", "due_at": PAST_DUE, "status": "published", "cohort_id": COHORT}],
        [{"id": "i1", "assignment_id": "a1", "student_id": "s1", "submitted_at": None}],
    ))
    hw = cohort_progress(db, COHORT)["students"][0]["homework"]
    assert hw["on_time_pct"] is None
    assert hw["missing"] == 1, "past its deadline with nothing submitted"


def test_work_not_yet_due_is_not_counted_missing():
    future = "2099-01-01T12:00:00+00:00"
    db = _DB(_hw_tables(
        [_student("s1", "u1")],
        [{"id": "a1", "due_at": future, "status": "published", "cohort_id": COHORT}],
        [{"id": "i1", "assignment_id": "a1", "student_id": "s1", "submitted_at": None}],
    ))
    hw = cohort_progress(db, COHORT)["students"][0]["homework"]
    assert hw["missing"] == 0


def test_punctuality_is_attributed_per_student():
    db = _DB(_hw_tables(
        [_student("s1", "u1"), _student("s2", "u2")],
        [{"id": "a1", "due_at": DUE, "status": "published", "cohort_id": COHORT}],
        [{"id": "i1", "assignment_id": "a1", "student_id": "s1", "submitted_at": ON_TIME},
         {"id": "i2", "assignment_id": "a1", "student_id": "s2", "submitted_at": LATE}],
    ))
    by_id = {r["student_id"]: r for r in cohort_progress(db, COHORT)["students"]}
    assert by_id["s1"]["homework"]["on_time_pct"] == 100
    assert by_id["s2"]["homework"]["on_time_pct"] == 0


def test_a_failed_ledger_read_is_null_not_zeros():
    db = _DB(_hw_tables([_student("s1", "u1")], [], []),
             fail={"class_assignments"})
    out = cohort_progress(db, COHORT)
    assert "homework" in out["degraded"]
    assert out["students"][0]["homework"] is None


def test_punctuality_stays_batched():
    """Two reads for the whole class, however many students."""
    students = [_student(f"s{i}", f"u{i}") for i in range(30)]
    db = _DB(_hw_tables(
        students,
        [{"id": "a1", "due_at": DUE, "status": "published", "cohort_id": COHORT}],
        [{"id": f"i{i}", "assignment_id": "a1", "student_id": f"s{i}",
          "submitted_at": ON_TIME} for i in range(30)],
    ))
    cohort_progress(db, COHORT)
    assert db.queries.count("class_assignments") == 1
    assert db.queries.count("class_assignment_items") == 1


# ── bài Reading/Listening đã nộp phải hiện ở CẢ tab Tiến độ ──────────────
#
# Those two skills have no completion hook: the test page submits without
# knowing the class ledger exists, so the ledger is repaired from the attempt
# rows on read. Whichever screen an admin opens FIRST has to run that repair.
# Wiring it into only the homework list means opening Progress first reports
# handed-in work as missing — two admin screens disagreeing about one student.


def test_a_reading_hand_in_shows_up_even_if_progress_is_opened_first():
    """End-to-end through the real repair: the ONLY evidence of this hand-in is
    the attempt row. If Progress reads the ledger without repairing it, the
    student is reported as not having submitted."""
    tables = _hw_tables(
        [_student("s1", "u1")],
        [{"id": "asg-1", "due_at": DUE, "status": "published", "cohort_id": COHORT,
          "skill": "reading", "content_id": "test-1",
          "created_at": "2020-01-01T00:00:00+00:00"}],
        [{"id": "item-1", "assignment_id": "asg-1", "student_id": "s1",
          "submitted_at": None, "state": "assigned"}],
    )
    tables["reading_test_attempts"] = [{
        "id": "att-1", "user_id": "u1", "test_id": "test-1", "status": "submitted",
        "submitted_at": ON_TIME, "band_estimate": 6.5,
        # The link the student's class page stamped on it (mig 181) — the whole
        # reason this repair does not have to guess.
        "class_assignment_item_id": "item-1",
    }]
    hw = cohort_progress(_DB(tables), COHORT)["students"][0]["homework"]
    assert hw["submitted"] == 1, (
        "the attempt row is the evidence — Progress must repair before it reads"
    )
    assert hw["missing"] == 0
    assert hw["late"] == 0


def test_a_failed_repair_still_renders_the_rest_of_the_row():
    """Best-effort: a stale homework column is better than a 500 that hides the
    Speaking, Writing and Reading bands too."""
    tables = _hw_tables(
        [_student("s1", "u1")],
        [{"id": "asg-1", "due_at": DUE, "status": "published", "cohort_id": COHORT,
          "skill": "reading", "content_id": "test-1",
          "created_at": "2020-01-01T00:00:00+00:00"}],
        [{"id": "item-1", "assignment_id": "asg-1", "student_id": "s1",
          "submitted_at": None, "state": "assigned"}],
    )
    out = cohort_progress(_DB(tables, fail={"reading_test_attempts"}), COHORT)
    assert out["students"][0]["homework"]["assigned"] == 1


def test_a_failed_repair_is_NAMED_not_just_logged():
    """Continuing on the unrepaired ledger is right — the other skills are fine
    and the counts are merely stale. Presenting stale counts as canonical is
    not: that is how "chưa nộp" gets shown for work already handed in. The
    homework list endpoint warns on exactly this; this screen must not stay
    quiet while showing the same numbers."""
    tables = _hw_tables(
        [_student("s1", "u1")],
        [{"id": "asg-1", "due_at": DUE, "status": "published", "cohort_id": COHORT,
          "skill": "reading", "content_id": "test-1",
          "created_at": "2020-01-01T00:00:00+00:00"}],
        [{"id": "item-1", "assignment_id": "asg-1", "student_id": "s1",
          "submitted_at": None, "state": "assigned"}],
    )
    out = cohort_progress(_DB(tables, fail={"reading_test_attempts"}), COHORT)
    assert "homework_stale" in out["degraded"]
    # ...and the row is still rendered, with the other skills intact.
    assert out["students"][0]["homework"]["assigned"] == 1


def test_a_clean_read_names_nothing():
    tables = _hw_tables(
        [_student("s1", "u1")],
        [{"id": "asg-1", "due_at": DUE, "status": "published", "cohort_id": COHORT,
          "skill": "reading", "content_id": "test-1",
          "created_at": "2020-01-01T00:00:00+00:00"}],
        [{"id": "item-1", "assignment_id": "asg-1", "student_id": "s1",
          "submitted_at": None, "state": "assigned"}],
    )
    assert "homework_stale" not in cohort_progress(_DB(tables), COHORT)["degraded"]
