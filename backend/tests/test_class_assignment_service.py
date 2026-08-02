"""services/class_assignment_service — giao bài cho lớp (GĐ 2).

Four properties, each one a thing the code can be silently wrong about:

  * **19:00 is wall-clock time in Vietnam.** The centre's rule is "nộp trước 7h
    tối". Composed from a date via ZoneInfo, in one place. CI runs at UTC, so a
    naive implementation passes every test that does not assert the offset —
    which is exactly how this repo shipped a day-boundary bug before.

  * **Lateness and missed-ness are derived.** No `is_late` column, no `missed`
    state (mig 177). The boundary is asserted to the second, because "nộp lúc
    19:00:00" and "nộp lúc 19:00:01" is precisely the case a `>` vs `>=` slip
    gets wrong and nobody notices.

  * **Fan-out reaches the whole roster.** Paged, because PostgREST caps an
    un-ranged select at ~1000 rows and the failure mode is a plausible number
    plus a green run. A student who silently never receives the homework then
    reads as a student who did not do it.

  * **Recording a hand-in is idempotent.** The update only fires while
    `submitted_at IS NULL`, so a retried or re-completed session cannot move the
    submission time later and turn an on-time hand-in into a late one.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from services.class_assignment_service import (
    CLASS_TZ,
    compose_due_at,
    create_class_assignment,
    mark_item_submitted,
    progress_for_assignments,
)

POSTGREST_IMPLICIT_CAP = 1000   # see test_class_service_rollup for why this matters

COHORT = "aaaaaaaa-0000-0000-0000-000000000001"


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, store, name, rows, *, raises=False):
        self.store, self.name, self._rows, self._raises = store, name, rows, raises
        self._eq, self._in, self._range = [], None, None
        self._is_null = None
        self._mode, self._payload = "select", None

    def select(self, *_a, **_kw): return self
    def order(self, *_a, **_kw): return self
    def limit(self, *_a): return self

    def insert(self, payload):
        self._mode, self._payload = "insert", payload
        return self

    def update(self, payload):
        self._mode, self._payload = "update", payload
        return self

    def eq(self, f, v): self._eq.append((f, v)); return self
    def in_(self, f, v): self._in = (f, list(v)); return self
    def range(self, s, e): self._range = (s, e); return self

    def is_(self, field, value):
        self._is_null = (field, value)
        return self

    def execute(self):
        if self._raises:
            raise RuntimeError("boom")
        if self._mode == "insert":
            payload = self._payload if isinstance(self._payload, list) else [self._payload]
            self.store.setdefault(self.name, []).extend(payload)
            return _Resp([dict(r) for r in payload])
        if self._mode == "update":
            hit = []
            for row in self._rows:
                if not all(row.get(f) == v for f, v in self._eq):
                    continue
                if self._is_null and self._is_null[1] == "null" and row.get(self._is_null[0]) is not None:
                    continue
                row.update(self._payload)
                hit.append(row)
            self.store.setdefault("_updated", []).extend(hit)
            return _Resp(hit)

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
        self.tables, self.fail, self.store = tables, fail, {}

    def table(self, name):
        return _Query(self.store, name, self.tables.setdefault(name, []), raises=name in self.fail)


# ── 19:00 giờ Việt Nam ──────────────────────────────────────────────────


def test_due_at_is_seven_pm_in_vietnam_not_utc():
    iso = compose_due_at("2026-08-03")
    dt = datetime.fromisoformat(iso)
    assert (dt.hour, dt.minute) == (19, 0)
    assert dt.utcoffset().total_seconds() == 7 * 3600, (
        "the deadline must carry the +07:00 offset — without it CI (UTC) still "
        "passes while the real deadline lands at 02:00 the next morning"
    )
    assert dt.tzinfo is not None


def test_due_at_in_utc_is_noon_the_same_day():
    """19:00 +07 == 12:00 UTC. Pinned explicitly because every downstream
    comparison happens in UTC."""
    dt = datetime.fromisoformat(compose_due_at("2026-08-03")).astimezone(timezone.utc)
    assert (dt.year, dt.month, dt.day, dt.hour) == (2026, 8, 3, 12)


def test_no_date_means_no_deadline():
    """An assignment with no deadline is legal, and is never late or missed."""
    assert compose_due_at(None) is None
    assert compose_due_at("") is None


def test_class_timezone_is_vietnam():
    assert str(CLASS_TZ) == "Asia/Ho_Chi_Minh"


# ── trễ hạn / bỏ bài đều là suy ra ──────────────────────────────────────


def _assignment(due_iso):
    return {"id": "asg-1", "due_at": due_iso}


def _items(*specs):
    return [
        {"id": f"i{n}", "assignment_id": "asg-1", "student_id": f"s{n}",
         "state": "submitted" if sub else "assigned", "submitted_at": sub, "score": None}
        for n, sub in enumerate(specs)
    ]


DUE = compose_due_at("2026-08-03")                      # 19:00 +07
AFTER_DUE = datetime.fromisoformat(DUE).astimezone(timezone.utc)


def test_on_time_at_the_exact_deadline_is_not_late():
    """Submitting at exactly 19:00:00 is on time. `>=` here would mark a
    punctual student late, and nobody would ever notice."""
    db = _DB({"class_assignment_items": _items(DUE)})
    p = progress_for_assignments(db, [_assignment(DUE)], now=AFTER_DUE)["asg-1"]
    assert p["submitted"] == 1 and p["late"] == 0


def test_one_second_past_the_deadline_is_late():
    late_iso = (datetime.fromisoformat(DUE).replace(second=1)).isoformat()
    db = _DB({"class_assignment_items": _items(late_iso)})
    p = progress_for_assignments(db, [_assignment(DUE)], now=AFTER_DUE)["asg-1"]
    assert p["late"] == 1


def test_not_submitted_before_the_deadline_is_not_missing():
    """Before 19:00 a student who has not submitted is simply not due yet —
    counting them as missing would put a warning on every class all day."""
    before = datetime.fromisoformat(DUE).astimezone(timezone.utc).replace(hour=6)
    db = _DB({"class_assignment_items": _items(None)})
    p = progress_for_assignments(db, [_assignment(DUE)], now=before)["asg-1"]
    assert p["missing"] == 0 and p["assigned"] == 1


def test_not_submitted_after_the_deadline_is_missing():
    after = datetime.fromisoformat(DUE).astimezone(timezone.utc).replace(hour=23)
    db = _DB({"class_assignment_items": _items(None)})
    p = progress_for_assignments(db, [_assignment(DUE)], now=after)["asg-1"]
    assert p["missing"] == 1


def test_an_assignment_without_a_deadline_is_never_late_or_missing():
    db = _DB({"class_assignment_items": _items(None, DUE)})
    p = progress_for_assignments(db, [_assignment(None)], now=AFTER_DUE)["asg-1"]
    assert p == {"assigned": 2, "submitted": 1, "late": 0, "missing": 0}


def test_moving_the_deadline_changes_the_verdict_with_no_backfill():
    """The point of deriving instead of storing: extend the deadline and the
    same rows stop being late, with nothing to migrate."""
    submitted = (datetime.fromisoformat(DUE).replace(second=30)).isoformat()
    db = _DB({"class_assignment_items": _items(submitted)})
    assert progress_for_assignments(db, [_assignment(DUE)], now=AFTER_DUE)["asg-1"]["late"] == 1

    later = compose_due_at("2026-08-04")
    db2 = _DB({"class_assignment_items": _items(submitted)})
    assert progress_for_assignments(db2, [_assignment(later)], now=AFTER_DUE)["asg-1"]["late"] == 0


# ── fan-out ─────────────────────────────────────────────────────────────


def _students(n, *, activated_from=0):
    return [
        {"id": f"s{i:05d}", "cohort_id": COHORT, "user_id": (f"u{i}" if i >= activated_from else None)}
        for i in range(n)
    ]


def test_fan_out_creates_one_item_per_student():
    db = _DB({"students": _students(5), "class_assignments": [], "class_assignment_items": []})
    out = create_class_assignment(db, cohort_id=COHORT, skill="speaking",
                                  title="Speaking 3/8", due_date="2026-08-03")
    assert out["student_count"] == 5
    assert len(db.store["class_assignment_items"]) == 5


def test_fan_out_pages_past_the_postgrest_cap():
    """>1000 students. An un-ranged select returns exactly 1000 and looks fine —
    the missing students then read as students who did not do the work."""
    db = _DB({"students": _students(1500), "class_assignments": [], "class_assignment_items": []})
    out = create_class_assignment(db, cohort_id=COHORT, skill="speaking", title="x")
    assert out["student_count"] == 1500
    assert len(db.store["class_assignment_items"]) == 1500


def test_fan_out_reports_students_who_cannot_receive_it():
    """user_id NULL = no account = the task is delivered into silence."""
    db = _DB({"students": _students(10, activated_from=3),
              "class_assignments": [], "class_assignment_items": []})
    out = create_class_assignment(db, cohort_id=COHORT, skill="speaking", title="x")
    assert out["unactivated_count"] == 3
    # They still get a row: they are on the roster and the teacher's list must
    # be complete.
    assert len(db.store["class_assignment_items"]) == 10


def test_empty_roster_creates_no_items():
    db = _DB({"students": [], "class_assignments": [], "class_assignment_items": []})
    out = create_class_assignment(db, cohort_id=COHORT, skill="speaking", title="x")
    assert out["student_count"] == 0
    assert db.store.get("class_assignment_items") is None


def test_due_date_is_composed_not_passed_through():
    db = _DB({"students": _students(1), "class_assignments": [], "class_assignment_items": []})
    create_class_assignment(db, cohort_id=COHORT, skill="speaking", title="x",
                            due_date="2026-08-03")
    stored = db.store["class_assignments"][0]["due_at"]
    assert datetime.fromisoformat(stored).utcoffset().total_seconds() == 7 * 3600


# ── ghi nhận nộp bài ────────────────────────────────────────────────────


def test_marking_submitted_records_the_artifact():
    rows = [{"id": "i1", "submitted_at": None, "state": "assigned"}]
    db = _DB({"class_assignment_items": rows})
    assert mark_item_submitted(db, item_id="i1", artifact_kind="session",
                               artifact_id="sess-1", score=6.5) is True
    assert rows[0]["artifact_id"] == "sess-1"
    assert rows[0]["state"] == "graded"        # a score arrived with it
    assert rows[0]["score"] == 6.5


def test_marking_submitted_twice_does_not_move_the_timestamp():
    """A retried or re-completed session must not turn an on-time hand-in into a
    late one."""
    rows = [{"id": "i1", "submitted_at": None, "state": "assigned"}]
    db = _DB({"class_assignment_items": rows})
    first = datetime(2026, 8, 3, 11, 0, tzinfo=timezone.utc)
    mark_item_submitted(db, item_id="i1", artifact_kind="session",
                        artifact_id="s1", now=first)
    stamped = rows[0]["submitted_at"]

    later = datetime(2026, 8, 4, 11, 0, tzinfo=timezone.utc)
    assert mark_item_submitted(db, item_id="i1", artifact_kind="session",
                               artifact_id="s2", now=later) is False
    assert rows[0]["submitted_at"] == stamped
    assert rows[0]["artifact_id"] == "s1"


def test_a_failed_write_reports_false_rather_than_raising():
    """The caller is PATCH /sessions/complete — a graded session must still
    complete even if the ledger write fails."""
    db = _DB({"class_assignment_items": []}, fail={"class_assignment_items"})
    assert mark_item_submitted(db, item_id="i1", artifact_kind="session",
                               artifact_id="s1") is False
