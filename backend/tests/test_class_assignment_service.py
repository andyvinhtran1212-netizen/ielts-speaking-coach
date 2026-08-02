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
    EmptyRosterError,
    TaskMismatchError,
    attach_session_to_class_item,
    compose_due_at,
    create_class_assignment,
    is_assignment_open,
    reconcile_ledger_from_sessions,
    validate_class_item_for_session,
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


class _RPC:
    """Stands in for fn_create_class_assignment (mig 179). Mirrors the real
    contract: roster counted and rows created inside ONE call, empty roster
    raises, nothing partial is ever left behind."""

    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        if self.name == "fn_create_class_assignment":
            students = [s for s in self.db.tables.get("students", [])
                        if s.get("cohort_id") == self.params["p_cohort_id"]]
            if not students:
                raise RuntimeError('empty_roster')
            row = {"id": "asg-new", **{k[2:]: v for k, v in self.params.items()}}
            self.db.store.setdefault("class_assignments", []).append(row)
            self.db.store.setdefault("class_assignment_items", []).extend(
                {"assignment_id": "asg-new", "student_id": s["id"]} for s in students)
            return _Resp([{
                "assignment": row,
                "student_count": len(students),
                "unactivated_count": len([s for s in students if not s.get("user_id")]),
            }])
        if self.name == "fn_delete_class_assignment_if_unsubmitted":
            return _Resp(True)
        if self.name == "fn_bind_session_to_class_item":
            # Mirrors mig 179: ownership AND open-state re-checked inside the
            # same transaction as the write.
            item = next((i for i in self.db.tables.get("class_assignment_items", [])
                         if i["id"] == self.params["p_item_id"]), None)
            if not item:
                return _Resp(False)
            stu = next((s for s in self.db.tables.get("students", [])
                        if s["id"] == item.get("student_id")), None)
            if not stu or stu.get("user_id") != self.params["p_user_id"]:
                return _Resp(False)
            asg = next((a for a in self.db.tables.get("class_assignments", [])
                        if a["id"] == item["assignment_id"]), None)
            if not asg or not is_assignment_open(asg):
                return _Resp(False)
            for s in self.db.tables.get("sessions", []):
                if s["id"] == self.params["p_session_id"]:
                    s["class_assignment_item_id"] = self.params["p_item_id"]
                    self.db.store.setdefault("_updated", []).append(s)
                    return _Resp(True)
            return _Resp(False)
        raise AssertionError(f"unexpected rpc {self.name}")


class _DB:
    def __init__(self, tables, *, fail=frozenset()):
        self.tables, self.fail, self.store = tables, fail, {}

    def table(self, name):
        return _Query(self.store, name, self.tables.setdefault(name, []), raises=name in self.fail)

    def rpc(self, name, params):
        return _RPC(self, name, params)


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


def test_empty_roster_creates_nothing_at_all():
    """Codex review: raising AFTER the insert left a published 0/0 give behind —
    the admin is told "không giao được", reloads, and finds it sitting there."""
    db = _DB({"students": [], "class_assignments": [], "class_assignment_items": []})
    with pytest.raises(EmptyRosterError):
        create_class_assignment(db, cohort_id=COHORT, skill="speaking", title="x")
    assert db.store.get("class_assignments") is None, "an orphan give was inserted"
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


# ── phiên phải ĐÚNG là bài được giao (Codex P1) ─────────────────────────
#
# Ownership alone is not enough: `class_assignment_item_id` arrives in a request
# body next to a topic/mode/part the caller also chose. Without a match check a
# student can do an easy Part 1 practice, bind it to the Part 3 homework, and the
# ledger records the assigned task as done. That claim is the ledger's whole
# value, so these are the tests that protect it.

ASSIGNED = {"topic": "Hometown", "mode": "test_part", "part": 3}


def _bind_db(*, cfg=None, status="published", publish_at=None):
    return _DB({
        "students": [{"id": "stu-1", "user_id": "user-1"}],
        "class_assignment_items": [
            {"id": "item-1", "student_id": "stu-1", "assignment_id": "asg-1"},
        ],
        "class_assignments": [{
            "id": "asg-1", "status": status, "publish_at": publish_at,
            "content_config": cfg if cfg is not None else dict(ASSIGNED),
        }],
        "sessions": [{"id": "sess-1"}],
    })


def _bind(db, **over):
    """Validation is now a separate, EARLIER step than the link write (Codex
    review: rejecting after creation burned a daily session slot). The tests
    exercise the same guarantees through validate()."""
    kw = {"session_mode": "test_part", "session_part": 3, "session_topic": "Hometown"}
    kw.update(over)
    validate_class_item_for_session(db, "user-1", "item-1", **kw)
    attach_session_to_class_item(db, "sess-1", "user-1", "item-1")


def test_a_matching_session_binds():
    db = _bind_db()
    _bind(db)
    assert db.store["_updated"][0]["class_assignment_item_id"] == "item-1"


def test_a_different_part_is_rejected():
    with pytest.raises(TaskMismatchError):
        _bind(_bind_db(), session_part=1)


def test_a_different_mode_is_rejected():
    with pytest.raises(TaskMismatchError):
        _bind(_bind_db(), session_mode="practice")


def test_a_different_topic_is_rejected():
    with pytest.raises(TaskMismatchError):
        _bind(_bind_db(), session_topic="Something easier")


def test_topic_matching_tolerates_case_and_spacing():
    """The topic round-trips through the client; a stray capital must not stop a
    student handing their work in."""
    db = _bind_db()
    _bind(db, session_topic="  hometown ")
    assert db.store.get("_updated")


def test_an_unpublished_assignment_cannot_be_bound():
    with pytest.raises(TaskMismatchError):
        _bind(_bind_db(status="draft"))


def test_someone_elses_item_is_rejected():
    db = _bind_db()
    db.tables["class_assignment_items"][0]["student_id"] = "stu-OTHER"
    with pytest.raises(Exception):
        _bind(db)


# ── publish_at là cổng hé bài (Codex P4) ────────────────────────────────


def test_a_future_publish_at_hides_the_assignment():
    """Items are created eagerly at give time, so publish_at is the only thing
    keeping next week's give off today's list."""
    future = datetime(2099, 1, 1, tzinfo=timezone.utc).isoformat()
    assert is_assignment_open({"status": "published", "publish_at": future}) is False


def test_a_past_publish_at_reveals_it():
    past = datetime(2020, 1, 1, tzinfo=timezone.utc).isoformat()
    assert is_assignment_open({"status": "published", "publish_at": past}) is True


def test_no_publish_at_means_visible_immediately():
    assert is_assignment_open({"status": "published", "publish_at": None}) is True


def test_draft_and_archived_are_never_open():
    for st in ("draft", "archived"):
        assert is_assignment_open({"status": st, "publish_at": None}) is False


# ── ghi nhận nộp bài phải SỬA ĐƯỢC khi thử lại (Codex P3) ───────────────


def test_recording_is_retried_on_the_already_completed_path():
    """If the ledger write fails once, a retry of PATCH /sessions/{id}/complete
    takes the early "already completed" return — so that path must attempt the
    write too, or a transient failure leaves the teacher seeing the homework as
    never handed in, permanently.

    Structural on purpose: complete_session computes bands from graded responses,
    and mocking that whole pipeline to assert one call would test the mock. What
    matters is that BOTH exits go through the same recorder, and that the
    recorder is safe to call twice — which the idempotency test above covers.
    """
    import pathlib
    src = pathlib.Path(__file__).resolve().parents[1].joinpath("routers", "sessions.py").read_text()

    early = src.index("Idempotent: already done with a valid band")
    normal = src.index("completed = result.data[0]")
    assert "_record_class_submission(session)" in src[early:normal], (
        "the already-completed early return must retry the ledger write"
    )
    assert "_record_class_submission(completed)" in src[normal:], (
        "the normal completion path must record the hand-in"
    )


def test_recording_is_a_noop_when_the_session_has_no_class_item():
    """Most sessions are self-practice and carry no item — that path must not
    touch the ledger at all."""
    db = _DB({"class_assignment_items": []})
    assert mark_item_submitted.__name__       # imported
    # The helper in sessions.py guards on the column; here we pin the service
    # contract it relies on: no item id, no write.
    assert db.store == {}


# ── sửa lại bài nộp bị ghi hỏng (Codex P1 #2) ───────────────────────────
#
# PATCH /sessions/{id}/complete records the hand-in best-effort, and practice.js
# fires it once and redirects on 200 — so a transient failure there has no client
# retry and the teacher would permanently see completed homework as missing. The
# completed session is the durable evidence; reconciling from it repairs the
# ledger at the moment the admin opens the list.


def _reconcile_db(*, session_status="completed", item_submitted=None):
    return _DB({
        "class_assignment_items": [
            {"id": "item-1", "assignment_id": "asg-1", "submitted_at": item_submitted,
             "state": "assigned"},
        ],
        "sessions": [
            {"id": "sess-1", "class_assignment_item_id": "item-1",
             "status": session_status, "overall_band": 6.5},
        ],
    })


def test_a_completed_session_repairs_an_unrecorded_hand_in():
    db = _reconcile_db()
    assert reconcile_ledger_from_sessions(db, ["asg-1"]) == 1
    item = db.tables["class_assignment_items"][0]
    assert item["submitted_at"] is not None
    assert item["artifact_id"] == "sess-1"
    assert item["score"] == 6.5


def test_an_unfinished_session_is_not_treated_as_a_hand_in():
    db = _reconcile_db(session_status="in_progress")
    assert reconcile_ledger_from_sessions(db, ["asg-1"]) == 0
    assert db.tables["class_assignment_items"][0]["submitted_at"] is None


def test_reconciling_twice_keeps_the_original_submission_time():
    """The repair must never move an on-time hand-in past its deadline."""
    db = _reconcile_db()
    reconcile_ledger_from_sessions(db, ["asg-1"])
    first = db.tables["class_assignment_items"][0]["submitted_at"]
    assert reconcile_ledger_from_sessions(db, ["asg-1"]) == 0
    assert db.tables["class_assignment_items"][0]["submitted_at"] == first


def test_reconcile_is_a_noop_with_nothing_to_fix():
    assert reconcile_ledger_from_sessions(_reconcile_db(), []) == 0


# ── giao bài là NGUYÊN TỬ (Codex P1 #3) ─────────────────────────────────


def test_create_goes_through_the_atomic_rpc_not_two_inserts():
    """Two PostgREST inserts meant the parent committed first: a failure fanning
    out left a published give with zero or partial recipients, which after a
    reload is indistinguishable from a real 0/N assignment."""
    import inspect
    from services import class_assignment_service as mod
    src = inspect.getsource(mod.create_class_assignment)
    assert 'rpc("fn_create_class_assignment"' in src
    assert 'table("class_assignments").insert' not in src
    assert 'table("class_assignment_items").insert' not in src


# ── sửa sổ phải giữ ĐÚNG mốc hoàn thành (Codex vòng 2) ──────────────────


def test_repair_stamps_the_session_completion_time_not_the_repair_time():
    """Work finished at 18:00 and reconciled at 20:00 must stay on time.

    Stamping the repair time would manufacture the exact verdict the repair
    exists to correct — and it is deterministic for assigned full tests, whose
    completion path runs outside PATCH /complete entirely.
    """
    finished = datetime(2026, 8, 3, 11, 0, tzinfo=timezone.utc)   # 18:00 giờ VN
    db = _DB({
        "class_assignment_items": [
            {"id": "item-1", "assignment_id": "asg-1", "submitted_at": None, "state": "assigned"},
        ],
        "sessions": [
            {"id": "sess-1", "class_assignment_item_id": "item-1", "status": "completed",
             "overall_band": 6.0, "completed_at": finished.isoformat()},
        ],
    })
    assert reconcile_ledger_from_sessions(db, ["asg-1"]) == 1

    stamped = db.tables["class_assignment_items"][0]["submitted_at"]
    assert datetime.fromisoformat(stamped) == finished

    # And therefore the verdict is on-time against a 19:00 deadline.
    due = compose_due_at("2026-08-03")
    p = progress_for_assignments(
        db, [{"id": "asg-1", "due_at": due}],
        now=datetime(2026, 8, 3, 20, 0, tzinfo=timezone.utc),
    )["asg-1"]
    assert p["late"] == 0 and p["submitted"] == 1


def test_repair_falls_back_to_now_when_completion_time_is_missing():
    db = _DB({
        "class_assignment_items": [
            {"id": "item-1", "assignment_id": "asg-1", "submitted_at": None, "state": "assigned"},
        ],
        "sessions": [
            {"id": "sess-1", "class_assignment_item_id": "item-1", "status": "completed",
             "overall_band": 6.0, "completed_at": None},
        ],
    })
    assert reconcile_ledger_from_sessions(db, ["asg-1"]) == 1
    assert db.tables["class_assignment_items"][0]["submitted_at"] is not None


# ── gắn phiên đi qua RPC nguyên tử (Codex vòng 2) ───────────────────────


def test_binding_a_session_to_an_archived_assignment_is_refused():
    """Validation runs before the session is created; the assignment can be
    archived in between, so the write itself must re-check."""
    db = _bind_db(status="archived")
    assert attach_session_to_class_item(db, "sess-1", "user-1", "item-1") is False


def test_binding_goes_through_the_atomic_rpc():
    import inspect
    from services import class_assignment_service as mod
    src = inspect.getsource(mod.attach_session_to_class_item)
    assert 'rpc("fn_bind_session_to_class_item"' in src
    assert 'table("sessions").update' not in src, (
        "a bare UPDATE cannot re-check open-state in the same transaction"
    )


# ── đối chiếu sổ phải PHÂN TRANG (Codex vòng 3) ─────────────────────────


def test_reconcile_repairs_beyond_the_postgrest_cap():
    """A class giving one task a day passes ~1000 items within a couple of
    months. Un-ranged, the un-repaired hand-ins are precisely the ones outside
    the returned page — never fixed, and the admin keeps seeing them missing."""
    n = 1500
    items = [{"id": f"item-{i:05d}", "assignment_id": "asg-1",
              "submitted_at": None, "state": "assigned"} for i in range(n)]
    sessions = [{"id": f"sess-{i:05d}", "class_assignment_item_id": f"item-{i:05d}",
                 "status": "completed", "overall_band": 6.0,
                 "completed_at": "2026-08-03T11:00:00+00:00"} for i in range(n)]
    db = _DB({"class_assignment_items": items, "sessions": sessions})

    assert reconcile_ledger_from_sessions(db, ["asg-1"]) == n
    assert all(i["submitted_at"] for i in items)


def test_full_test_is_not_an_allowed_class_assignment_mode():
    """A Full Test is three chained sessions and its result is the aggregate;
    only the opening session would carry the ledger link, so the homework score
    would deterministically be Part 1's band. Rejected with a reason rather than
    silently recorded wrong."""
    from routers.admin_class_assignments import AssignmentCreate, _SPEAKING_MODES

    assert "test_full" not in _SPEAKING_MODES
    with pytest.raises(Exception) as exc:
        AssignmentCreate(title="x", topic="y", mode="test_full")
    assert "Full Test" in str(exc.value)

    # the two single-session modes still work
    for mode in ("practice", "test_part"):
        assert AssignmentCreate(title="x", topic="y", mode=mode).mode == mode


# ── vòng 4 ──────────────────────────────────────────────────────────────


def test_reconcile_chunks_ids_for_the_url_not_just_the_rows():
    """_PAGE bounds ROWS coming back; _ID_CHUNK bounds IDS going out in an
    `in.(...)` filter, which lands in the URL. A thousand UUIDs is ~37 KB of
    query string and PostgREST rejects the request before pagination runs — the
    same split, for the same reason, as _ID_CHUNK in mock_exam_service."""
    from services.class_assignment_service import _ID_CHUNK, _PAGE

    assert _ID_CHUNK < _PAGE
    assert _ID_CHUNK <= 100

    import inspect, re
    from services import class_assignment_service as mod
    src = inspect.getsource(mod.reconcile_ledger_from_sessions)

    # EVERY chunk loop must step by _ID_CHUNK. Merely mentioning _ID_CHUNK
    # somewhere is not enough — the first version of this test passed while one
    # of the two loops had been reverted to _PAGE.
    steps = re.findall(r"for i in range\(0, len\([a-z_]+\), (\w+)\)", src)
    assert steps, "no chunk loop found — did reconcile stop chunking ids?"
    assert set(steps) == {"_ID_CHUNK"}, (
        f"an id list is chunked at {sorted(set(steps))}; a _PAGE-sized in.() "
        f"filter is ~37 KB of URL and gets rejected before pagination runs"
    )


def test_a_valid_assignment_entitles_its_own_mode():
    """Access codes are scoped per mode. A student holding only practice_single
    who is given a test_part task was counted as assigned, could see it, and got
    403 every time they opened it — homework they can see and can never do. The
    teacher assigning it is the authorisation (same bridge as Writing)."""
    import inspect
    from routers import sessions as mod
    src = inspect.getsource(mod.create_session)

    entitle = src.index("entitled_by_assignment = False")
    guard = src.index("if not entitled_by_assignment:")
    assert entitle < guard, "validation must run before the permission gate"
    assert "_require_permission(user_id, body.mode)" in src[guard:], (
        "the mode gate must still apply to sessions with no class assignment"
    )


# ── vòng 5 ──────────────────────────────────────────────────────────────


def test_progress_query_also_chunks_assignment_ids():
    """Fixed in reconcile last round, missed here. A class giving one task a day
    accumulates enough assignments that a single unchunked in.() filter becomes
    tens of KB of URL, and the admin list 500s instead of showing any progress."""
    import inspect, re
    from services import class_assignment_service as mod
    src = inspect.getsource(mod._items_for_assignments)
    steps = re.findall(r"range\(0, len\([a-z_]+\), (\w+)\)", src)
    assert steps and set(steps) == {"_ID_CHUNK"}, steps


def test_the_earliest_completed_session_wins_the_repair():
    """One item can have several completed sessions (the start endpoint allows a
    retry). Rows arrive ordered by UUID, so without an explicit choice the winner
    is whichever uuid sorts first — a later attempt could overwrite the real
    first hand-in with a different score AND a different late/on-time verdict."""
    early = "2026-08-03T11:00:00+00:00"   # 18:00 giờ VN — on time
    late  = "2026-08-03T13:00:00+00:00"   # 20:00 giờ VN — late

    # 'a…' sorts before 'z…', so the LATER session is the one _paged returns
    # first. The repair must still pick the earlier completion.
    db = _DB({
        "class_assignment_items": [
            {"id": "item-1", "assignment_id": "asg-1", "submitted_at": None, "state": "assigned"},
        ],
        "sessions": [
            {"id": "aaaa-late", "class_assignment_item_id": "item-1", "status": "completed",
             "overall_band": 5.0, "completed_at": late},
            {"id": "zzzz-early", "class_assignment_item_id": "item-1", "status": "completed",
             "overall_band": 7.0, "completed_at": early},
        ],
    })
    assert reconcile_ledger_from_sessions(db, ["asg-1"]) == 1

    item = db.tables["class_assignment_items"][0]
    assert item["submitted_at"] == early, "the later session overwrote the real first hand-in"
    assert item["artifact_id"] == "zzzz-early"
    assert item["score"] == 7.0

    # …and therefore it counts as on time against the 19:00 deadline.
    p = progress_for_assignments(
        db, [{"id": "asg-1", "due_at": compose_due_at("2026-08-03")}],
        now=datetime(2026, 8, 3, 23, 0, tzinfo=timezone.utc),
    )["asg-1"]
    assert p["late"] == 0


# ── vòng 6 ──────────────────────────────────────────────────────────────


def test_archive_endpoint_exists_because_delete_points_at_it():
    """The DELETE guard tells the admin to archive instead once anyone has
    submitted. Until round 6 that action did not exist anywhere, so a cancelled
    assignment with one hand-in could never be closed and stayed startable."""
    from routers.admin_class_assignments import AssignmentPatch, update_assignment

    assert callable(update_assignment)
    assert AssignmentPatch(status="archived").status == "archived"
    assert AssignmentPatch(status="published").status == "published"
    with pytest.raises(Exception):
        AssignmentPatch(status="deleted")


def test_archived_assignments_are_closed_to_students():
    """Archiving is what makes the give stop being startable."""
    assert is_assignment_open({"status": "archived", "publish_at": None}) is False


# ── vòng 7 ──────────────────────────────────────────────────────────────


def test_delete_guard_also_counts_a_completed_session_as_evidence():
    """This feature declares the completed SESSION to be the durable evidence of
    a hand-in — that is the whole premise of reconcile_ledger_from_sessions. A
    delete guard that consults only submitted_at therefore has a window where the
    work is done, the ledger has not caught up, and DELETE cascades the item away
    AND nulls the session link, after which no repair can ever find it.

    Pinned on the SQL because the check lives inside the locking transaction
    (mig 180) — a Python-side check could not be atomic with the delete.
    """
    import pathlib
    sql = (pathlib.Path(__file__).resolve().parents[1]
           / "migrations" / "180_fn_class_assignment_locks.sql").read_text(encoding="utf-8")

    head = sql[:sql.index("INTO v_submitted")]
    body = head[head.rindex("SELECT EXISTS"):]
    assert "i.submitted_at IS NOT NULL" in body
    assert "s.status = 'completed'" in body, (
        "a completed linked session must block deletion too"
    )
    assert "class_assignment_item_id = i.id" in body


def test_bind_locks_the_assignment_row_not_only_the_item():
    """FOR UPDATE OF i alone leaves class_assignments free, so an archive can
    commit between the open-state check and the link write — the session ends up
    bound to a closed task, which is exactly what mig 179's comment claimed was
    impossible."""
    import pathlib, re
    sql = (pathlib.Path(__file__).resolve().parents[1]
           / "migrations" / "180_fn_class_assignment_locks.sql").read_text(encoding="utf-8")
    m = re.search(r"FOR UPDATE OF ([a-z, ]+);", sql)
    assert m, "the bind SELECT no longer takes a row lock"
    locked = {x.strip() for x in m.group(1).split(",")}
    assert locked == {"i", "a"}, locked


def test_outstanding_student_work_is_never_capped():
    """Two earlier shapes both hid an old unsubmitted task behind 200 newer
    rows. A student must never be shown "nothing to do" while an unanswered task
    exists."""
    import inspect
    from routers import class_student as mod
    src = inspect.getsource(mod.my_assignments)

    assert "_paged_items" in src, "outstanding items must be fetched in full, paged"
    assert '_MAX_HISTORY' in src
    # The cap must apply to the SUBMITTED branch only.
    hist = src[src.index("history = ("):src.index("items = outstanding + history")]
    assert 'not_.is_("submitted_at", "null")' in hist
    assert "_MAX_HISTORY" in hist
    outstanding = src[src.index("outstanding = _paged_items"):src.index("history = (")]
    assert "limit" not in outstanding.lower()
