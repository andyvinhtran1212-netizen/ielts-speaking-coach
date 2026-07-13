"""Tests for the 4-skill mock-exam backend (Phase 1).

Covers services/mock_exam_service.py + services/mock_review_workflow.py in
isolation with a stateful in-memory fake for `supabase_admin` (both modules
share one fake instance so the sitting written by the service is visible to the
review workflow).

What we pin:
  - create_sitting: gates (is_open, window, cohort), idempotent active-sitting return
  - advance_section: SEQUENTIAL admin-gated flow — not_started → listening →
    reading → writing → done, one shared classroom clock per section, force-
    collects stragglers of the section being closed
  - submit_section: per-section collection, gated on the exam's active_section,
    finalises the sitting once every configured section is in
  - terminal reconciliation is ORDER-INDEPENDENT (speaking before or after LRW)
  - all_submitted auto-creates a review (idempotent)
  - claim is atomic — concurrent claims, exactly one wins
  - final bands → overall via the verified 4-arg mean (never trusted from client)
  - release_results requires 'reviewed' and LIFTS THE SEAL on the sitting
  - is_sealed tracks sitting.sealed
"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest


# ── In-memory fake for supabase_admin (supports .not_.in_) ─────────────


class _Response:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, fake, table_name):
        self.fake = fake
        self.table_name = table_name
        self.op = None
        self.payload = None
        self.filters = []          # (field, op, value, negate)
        self.in_filters = []       # (field, [values], negate)
        self.limit_n = None
        self.order_by = None
        self._negate_next = False

    @property
    def not_(self):
        self._negate_next = True
        return self

    def select(self, *_a, **_k):
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

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, field, value):
        self.filters.append((field, "eq", value, self._negate_next))
        self._negate_next = False
        return self

    def neq(self, field, value):
        self.filters.append((field, "eq", value, True))   # negated eq
        return self

    def in_(self, field, values):
        self.in_filters.append((field, list(values), self._negate_next))
        self._negate_next = False
        return self

    def is_(self, field, value):
        self.filters.append((field, "is_", value, self._negate_next))
        self._negate_next = False
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def order(self, field, desc=False):
        self.order_by = (field, desc)
        return self

    def _matches(self, row):
        for field, op, value, negate in self.filters:
            if op == "is_":
                is_null = row.get(field) is None
                ok = is_null if value == "null" else (row.get(field) == value)
            else:
                ok = row.get(field) == value
            if negate:
                ok = not ok
            if not ok:
                return False
        for field, values, negate in self.in_filters:
            ok = row.get(field) in values
            if negate:
                ok = not ok
            if not ok:
                return False
        return True

    def execute(self):
        rows = self.fake.tables.setdefault(self.table_name, [])

        if self.op == "insert":
            with self.fake.lock:
                if self.table_name == "mock_exam_reviews":
                    sid = self.payload.get("sitting_id")
                    if any(r.get("sitting_id") == sid for r in rows):
                        raise Exception(
                            'duplicate key value violates unique constraint '
                            '"one_review_per_sitting"'
                        )
                now = datetime.now(timezone.utc).isoformat()
                row = {"id": str(uuid4()), "created_at": now, "updated_at": now,
                       **self.payload}
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

        if self.op == "delete":
            with self.fake.lock:
                removed = [r for r in rows if self._matches(r)]
                self.fake.tables[self.table_name] = [
                    r for r in rows if not self._matches(r)
                ]
                return _Response(removed)

        raise AssertionError(f"Unsupported op: {self.op!r}")


class FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {}
        self.lock = threading.Lock()

    def table(self, name):
        return _Query(self, name)

    # test helpers
    def seed(self, name, row):
        self.tables.setdefault(name, []).append(row)

    def rows(self, name):
        return self.tables.get(name, [])


# ── Fixtures ──────────────────────────────────────────────────────────


@pytest.fixture
def fake_db(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr("services.mock_exam_service.supabase_admin", fake)
    monkeypatch.setattr("services.mock_review_workflow.supabase_admin", fake)
    # _promote_writing_essays calls into essay_service.create_essay_row_only,
    # which reads/writes through essay_service's OWN supabase_admin binding —
    # share the same fake so promoted essays land in the same in-memory DB.
    monkeypatch.setattr("services.essay_service.supabase_admin", fake)
    monkeypatch.setattr("services.mock_exam_assignment_service.supabase_admin", fake)
    return fake


@pytest.fixture
def svc():
    from services import mock_exam_service
    return mock_exam_service


@pytest.fixture
def wf():
    from services import mock_review_workflow
    return mock_review_workflow


def _seed_exam(fake, *, cohort_id=None, open_from=None, open_until=None,
               speaking=False, is_open=True, listening=True, reading=True):
    exam = {
        "id": str(uuid4()), "code": "MOCK-TEST-A", "title": "Test",
        "status": "published", "is_open": is_open, "cohort_id": cohort_id,
        "open_from": open_from, "open_until": open_until,
        "total_minutes": 150, "reading_minutes": 60, "writing_minutes": 60,
        "active_section": "not_started",
        "listening_started_at": None, "reading_started_at": None,
        "writing_started_at": None,
        # speaking is required only when the exam defines a speaking component
        "speaking_topic_set": ({"part1": ["x"]} if speaking else {}),
    }
    if listening:
        exam["listening_test_id"] = str(uuid4())
        fake.seed("listening_tests", {"id": exam["listening_test_id"],
                                      "full_audio_duration_seconds": 1800})
    if reading:
        exam["reading_test_id"] = str(uuid4())
    fake.seed("mock_exams", exam)
    return exam


# ── create_sitting ────────────────────────────────────────────────────


def test_create_sitting_inserts_registered_sealed(fake_db, svc):
    _seed_exam(fake_db)
    s = svc.create_sitting(uuid4(), "MOCK-TEST-A")
    assert s["status"] == "registered"
    assert s["sealed"] is True


def test_create_sitting_idempotent_returns_active(fake_db, svc):
    _seed_exam(fake_db)
    u = uuid4()
    first = svc.create_sitting(u, "MOCK-TEST-A")
    second = svc.create_sitting(u, "MOCK-TEST-A")
    assert first["id"] == second["id"]
    assert len(fake_db.rows("mock_exam_sittings")) == 1


def test_create_sitting_window_closed_raises(fake_db, svc):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    _seed_exam(fake_db, open_until=past)
    with pytest.raises(svc.WindowClosedError):
        svc.create_sitting(uuid4(), "MOCK-TEST-A")


def test_create_sitting_cohort_not_member_raises(fake_db, svc):
    exam = _seed_exam(fake_db, cohort_id=str(uuid4()))
    with pytest.raises(svc.NotEligibleError):
        svc.create_sitting(uuid4(), "MOCK-TEST-A")
    # a member is allowed
    u = uuid4()
    fake_db.seed("students", {"id": str(uuid4()), "user_id": str(u),
                              "cohort_id": exam["cohort_id"]})
    s = svc.create_sitting(u, "MOCK-TEST-A")
    assert s["status"] == "registered"


# ── advance_section (sequential, admin-gated) ──────────────────────────


def test_create_sitting_not_open_raises(fake_db, svc):
    """Live gate: a not-yet-opened exam can't be started."""
    _seed_exam(fake_db, is_open=False)
    with pytest.raises(svc.WindowClosedError):
        svc.create_sitting(uuid4(), "MOCK-TEST-A")


def test_create_sitting_resumes_after_gate_closed(fake_db, svc):
    """A mid-exam student can resume even after the admin closes the live gate."""
    exam = _seed_exam(fake_db, is_open=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    exam["is_open"] = False                          # admin closes the gate
    resumed = svc.create_sitting(u, "MOCK-TEST-A")   # refresh → resume, not locked
    assert resumed["id"] == s["id"]


def test_advance_section_walks_the_sequence(fake_db, svc):
    exam = _seed_exam(fake_db)   # listening + reading + writing all configured
    admin = str(uuid4())
    a = svc.advance_section(exam["id"], admin)
    assert a["active_section"] == "listening"
    assert a["listening_started_at"] is not None
    b = svc.advance_section(exam["id"], admin)
    assert b["active_section"] == "reading"
    assert b["reading_started_at"] is not None
    c = svc.advance_section(exam["id"], admin)
    assert c["active_section"] == "writing"
    assert c["writing_started_at"] is not None
    d = svc.advance_section(exam["id"], admin)
    assert d["active_section"] == "done"


def test_advance_section_skips_unconfigured_sections(fake_db, svc):
    """An exam with no Listening test skips straight to Reading."""
    exam = _seed_exam(fake_db, listening=False, reading=True)
    admin = str(uuid4())
    a = svc.advance_section(exam["id"], admin)
    assert a["active_section"] == "reading"


def test_advance_section_past_done_raises(fake_db, svc):
    exam = _seed_exam(fake_db, listening=False, reading=False)   # writing-only
    admin = str(uuid4())
    svc.advance_section(exam["id"], admin)   # → writing
    svc.advance_section(exam["id"], admin)   # → done
    with pytest.raises(svc.SittingConflictError):
        svc.advance_section(exam["id"], admin)


def test_advance_section_force_collects_stragglers(fake_db, svc):
    """A student who never submitted Listening (disconnected) is force-collected
    when the admin advances past it — the sitting must not block forever."""
    exam = _seed_exam(fake_db)
    admin = str(uuid4())
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.advance_section(exam["id"], admin)          # → listening (straggler never submits)
    svc.advance_section(exam["id"], admin)          # → reading: force-collects listening
    sitting = svc.get_sitting(s["id"])
    assert sitting["listening_submitted_at"] is not None
    assert sitting["status"] == "lrw_in_progress"


def test_section_time_remaining_from_shared_clock(fake_db, svc):
    exam = _seed_exam(fake_db)
    admin = str(uuid4())
    updated = svc.advance_section(exam["id"], admin)   # → listening
    left = svc.section_time_remaining_seconds(updated, "listening")
    # audio 1800s + 120s buffer, just started
    assert 0 < left <= 1920


def test_submit_section_rejects_before_clock_expires(fake_db, svc):
    """No early manual submit, enforced server-side (not just a hidden UI
    button) — a plain API call right after the section opens must be
    rejected, even though attach_attempt / active_section both check out."""
    exam = _seed_exam(fake_db, listening=False)   # single advance opens reading
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.advance_section(exam["id"], str(uuid4()))   # → reading, clock just started
    aid = str(uuid4())
    fake_db.seed("reading_test_attempts", {
        "id": aid, "user_id": str(u), "test_id": exam["reading_test_id"],
        "status": "submitted", "sitting_id": None,
    })
    svc.attach_attempt(s["id"], u, "reading", aid)
    with pytest.raises(svc.SittingConflictError):
        svc.submit_section(s["id"], u, "reading")


def test_force_collect_grades_the_straggler_listening_attempt(fake_db, svc):
    """Codex P1: force-collecting a straggler must actually GRADE from
    whatever was persisted — not just flip status, which would leave the
    review draft blank for that skill."""
    exam = _seed_exam(fake_db)
    admin = str(uuid4())
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.advance_section(exam["id"], admin)   # → listening
    aid = str(uuid4())
    fake_db.seed("listening_test_attempts", {
        "id": aid, "user_id": str(u), "test_id": exam["listening_test_id"],
        "status": "in_progress", "sitting_id": None,
        "answers": [{"q_num": 1, "user_answer": "beach"}],
    })
    svc.attach_attempt(s["id"], u, "listening", aid)
    fake_db.seed("listening_content", {"id": "c1", "test_id": exam["listening_test_id"]})
    fake_db.seed("listening_exercises", {"content_id": "c1", "payload": {
        "template_kind": "dictation_gap_fill",
        "answers": [{"q_num": 1, "answer": "beach", "alternatives": []}],
    }})
    svc.advance_section(exam["id"], admin)   # → reading: force-collects listening (disconnected)
    attempt = fake_db.rows("listening_test_attempts")[0]
    assert attempt["status"] == "submitted"
    assert attempt["score"] == 1   # actually graded, not just a blind status flip
    assert attempt["grading_details"]  # per-question breakdown populated


def test_force_collect_grades_the_straggler_reading_attempt(fake_db, svc):
    exam = _seed_exam(fake_db, listening=False)   # single advance opens reading
    admin = str(uuid4())
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.advance_section(exam["id"], admin)   # → reading
    aid = str(uuid4())
    fake_db.seed("reading_test_attempts", {
        "id": aid, "user_id": str(u), "test_id": exam["reading_test_id"],
        "status": "in_progress", "sitting_id": None,
    })
    svc.attach_attempt(s["id"], u, "reading", aid)
    fake_db.seed("reading_tests", {"id": exam["reading_test_id"], "module": "academic"})
    fake_db.seed("reading_passages", {"id": "p1", "test_id": exam["reading_test_id"],
                                      "library": "l3_test", "passage_order": 1})
    fake_db.seed("reading_questions", {"q_num": 1, "answer": {"answer": "TRUE", "alternatives": []},
                                       "skill_tag": "detail", "explanation": "", "passage_id": "p1"})
    fake_db.seed("reading_attempt_answers", {"attempt_id": aid, "q_num": 1, "user_answer": "TRUE"})
    svc.advance_section(exam["id"], admin)   # → writing: force-collects reading (disconnected)
    attempt = fake_db.rows("reading_test_attempts")[0]
    assert attempt["status"] == "submitted"
    assert attempt["score"] == 1   # actually graded, not just a blind status flip
    assert attempt["grading_details"]  # per-question breakdown populated


def test_force_collect_skips_already_submitted_attempt(fake_db, svc):
    """The client's own submit beat the sweep — force-collect must not
    re-grade (idempotent, no wasted work / no risk of overwriting)."""
    exam = _seed_exam(fake_db, listening=False)
    admin = str(uuid4())
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.advance_section(exam["id"], admin)   # → reading
    aid = str(uuid4())
    fake_db.seed("reading_test_attempts", {
        "id": aid, "user_id": str(u), "test_id": exam["reading_test_id"],
        "status": "submitted", "score": 7, "band_estimate": 6.5, "sitting_id": None,
    })
    svc.attach_attempt(s["id"], u, "reading", aid)
    svc.advance_section(exam["id"], admin)   # → writing: sitting never called submit_section
    attempt = fake_db.rows("reading_test_attempts")[0]
    assert attempt["score"] == 7   # unchanged — not re-graded
    assert svc.get_sitting(s["id"])["reading_submitted_at"] is not None  # sitting still collected


def test_admin_section_progress_counts(fake_db, svc):
    """Powers the admin console's "đã nộp X/Y" readout that informs advance."""
    exam = _seed_exam(fake_db, listening=False, reading=False)   # writing-only
    admin = str(uuid4())
    u1, u2 = uuid4(), uuid4()
    s1 = svc.create_sitting(u1, "MOCK-TEST-A")
    s2 = svc.create_sitting(u2, "MOCK-TEST-A")
    svc.advance_section(exam["id"], admin)   # → writing
    _expire_section(fake_db, exam["id"], "writing")
    svc.submit_section(s1["id"], u1, "writing", "one", "two")
    progress = svc.admin_section_progress(exam["id"])
    assert progress["active_section"] == "writing"
    assert progress["sections"]["writing"] == {"submitted": 1, "total": 2}
    assert progress["sections"]["listening"] == {"submitted": 0, "total": 2}
    # a voided sitting doesn't count toward total
    svc.void_sitting(s2["id"], admin, "tech")
    progress2 = svc.admin_section_progress(exam["id"])
    assert progress2["sections"]["writing"] == {"submitted": 1, "total": 1}


def test_list_open_exams_only_published_open(fake_db, svc):
    _seed_exam(fake_db, is_open=True)                       # published + open
    fake_db.seed("mock_exams", {"id": str(uuid4()), "code": "B", "title": "B",
                                "status": "published", "is_open": False})   # closed
    fake_db.seed("mock_exams", {"id": str(uuid4()), "code": "C", "title": "C",
                                "status": "draft", "is_open": True})        # not published
    codes = {e["code"] for e in svc.list_open_exams(str(uuid4()))}
    assert codes == {"MOCK-TEST-A"}


def test_set_open_toggles_exam(fake_db, svc):
    exam = _seed_exam(fake_db, is_open=False)
    svc.set_open(exam["id"], True, str(uuid4()))
    assert fake_db.rows("mock_exams")[0]["is_open"] is True


def test_reserved_test_ids_hides_mock_assigned(fake_db, svc):
    """Exclusivity: a test chosen for a mock is reserved (hidden from lists)."""
    exam = _seed_exam(fake_db)
    exam["reading_test_id"] = "R-123"
    exam["listening_test_id"] = "L-456"
    assert "R-123" in svc.reserved_test_ids("reading")
    assert "L-456" in svc.reserved_test_ids("listening")
    # an archived exam does not reserve its tests
    fake_db.seed("mock_exams", {"id": str(uuid4()), "status": "archived",
                                "reading_test_id": "R-999", "listening_test_id": None})
    assert "R-999" not in svc.reserved_test_ids("reading")


def test_available_reading_tests_includes_already_reserved(fake_db, svc):
    """A reading test may be reused across mock exams — the create-exam
    picker must NOT drop a test just because another mock exam already
    reserved it (2026-07-12: reservation only hides from student practice)."""
    fake_db.seed("reading_tests", {"id": "R-1", "test_id": "ILR-RDG-001",
                                   "title": "Reused test", "status": "published",
                                   "metadata": {"test_type": "full"},
                                   "created_at": "2026-01-01T00:00:00+00:00"})
    fake_db.seed("reading_tests", {"id": "R-2", "test_id": "ILR-RDG-002",
                                   "title": "Mini test", "status": "published",
                                   "metadata": {"test_type": "mini"},
                                   "created_at": "2026-01-01T00:00:00+00:00"})
    fake_db.seed("reading_tests", {"id": "R-3", "test_id": "ILR-RDG-003",
                                   "title": "Draft test", "status": "draft",
                                   "metadata": {}, "created_at": "2026-01-01T00:00:00+00:00"})
    _seed_exam(fake_db)["reading_test_id"] = "R-1"  # already used by MOCK-TEST-A

    ids = {t["id"] for t in svc.admin_available_reading_tests()}
    assert ids == {"R-1"}  # reused-but-published in, mini + draft out


# ── terminal reconciliation (order-independent) ───────────────────────


def _attach_domain_submitted(svc, fake, exam, sitting_id, u, section):
    """Simulate a runner finishing a section: seed a SUBMITTED domain attempt
    for the exam's OWN configured test (attach_attempt rejects a mismatched
    test_id) + attach it to the sitting. Caller must have already advanced the
    exam so `section` is the currently-open one (attach_attempt gates on it)."""
    table = {"listening": "listening_test_attempts",
             "reading": "reading_test_attempts"}[section]
    test_id = exam.get(f"{section}_test_id")
    aid = str(uuid4())
    fake.seed(table, {"id": aid, "user_id": str(u), "test_id": test_id,
                      "status": "submitted", "sitting_id": None})
    svc.attach_attempt(sitting_id, str(u), section, aid)
    return aid


def _expire_section(fake, exam_id, section):
    """Fast-forward `section`'s shared clock into the past so submit_section's
    no-early-submit grace check (server-side, real wall clock) doesn't reject
    the test's simulated submit — mutates the SAME dict object the fake DB
    holds, mirroring how the other tests mutate a seeded row in place."""
    past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    for row in fake.rows("mock_exams"):
        if row["id"] == exam_id:
            row[f"{section}_started_at"] = past


def _reach_writing(svc, fake, exam, sitting_id, u):
    """Walk the admin-gated sequence through Listening + Reading (submitting
    each as the runner would) and open Writing — stops right before the
    student submits Writing, mirroring a mid-sequence sitting."""
    admin = str(uuid4())
    for section in svc._configured_sections(exam):
        svc.advance_section(exam["id"], admin)   # admin opens `section`
        if section == "writing":
            return
        _expire_section(fake, exam["id"], section)
        _attach_domain_submitted(svc, fake, exam, sitting_id, u, section)
        svc.submit_section(sitting_id, u, section)


def _run_lrw(svc, fake, exam, sitting_id, u):
    """Drive a sitting through the FULL sequential flow: admin opens each
    configured section in order, the student submits it, until Writing is
    collected and the sitting finalises."""
    admin = str(uuid4())
    result = None
    for section in svc._configured_sections(exam):
        svc.advance_section(exam["id"], admin)
        _expire_section(fake, exam["id"], section)
        if section == "writing":
            result = svc.submit_section(
                sitting_id, u, "writing", "task one essay", "task two essay",
            )
        else:
            _attach_domain_submitted(svc, fake, exam, sitting_id, u, section)
            result = svc.submit_section(sitting_id, u, section)
    return result


def _do_speaking(svc, fake, sitting_id, u, n=1):
    """Simulate speaking: seed n COMPLETED sessions linked to the sitting (as if
    created within it via bind_session_to_sitting), each with a graded response,
    then record completion."""
    ids = []
    for _ in range(n):
        sid = str(uuid4())
        fake.seed("sessions", {"id": sid, "user_id": str(u),
                               "sitting_id": str(sitting_id), "status": "completed"})
        fake.seed("responses", {"id": str(uuid4()), "session_id": sid})
        ids.append(sid)
    return svc.record_speaking(sitting_id, str(u), ids)


def test_lrw_only_exam_finalises_without_speaking(fake_db, svc):
    """No speaking_topic_set → the seated LRW mạch alone reaches all_submitted."""
    exam = _seed_exam(fake_db, speaking=False)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    final = _run_lrw(svc, fake_db, exam, s["id"], u)
    assert final["status"] == "all_submitted"
    assert len(fake_db.rows("mock_exam_reviews")) == 1


def test_lrw_then_speaking_reaches_all_submitted(fake_db, svc, wf):
    exam = _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    after_lrw = _run_lrw(svc, fake_db, exam, s["id"], u)
    assert after_lrw["status"] == "speaking_pending"    # speaking required, not yet done
    final = _do_speaking(svc, fake_db, s["id"], u)
    assert final["status"] == "all_submitted"
    assert len(fake_db.rows("mock_exam_reviews")) == 1


def test_speaking_first_then_lrw_also_reaches_all_submitted(fake_db, svc):
    """Order independence: speaking taken BEFORE the LRW mạch."""
    exam = _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    mid = _do_speaking(svc, fake_db, s["id"], u)
    assert mid["status"] == "registered"   # LRW not done yet → no premature advance
    final = _run_lrw(svc, fake_db, exam, s["id"], u)
    assert final["status"] == "all_submitted"
    assert len(fake_db.rows("mock_exam_reviews")) == 1


def test_all_submitted_creates_review_once(fake_db, svc, wf):
    exam = _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, exam, s["id"], u)
    _do_speaking(svc, fake_db, s["id"], u)
    # idempotent: reconciling again doesn't create a second review
    svc._reconcile_terminal(s["id"])
    assert len(fake_db.rows("mock_exam_reviews")) == 1


def test_attach_attempt_sets_both_directions(fake_db, svc):
    exam = _seed_exam(fake_db, listening=False)   # a single advance opens Reading
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.advance_section(exam["id"], str(uuid4()))
    attempt_id = str(uuid4())
    fake_db.seed("reading_test_attempts",
                 {"id": attempt_id, "user_id": str(u), "test_id": exam["reading_test_id"],
                  "status": "in_progress", "sitting_id": None})
    svc.attach_attempt(s["id"], u, "reading", attempt_id)
    sitting = svc.get_sitting(s["id"])
    assert sitting["reading_attempt_id"] == attempt_id
    assert fake_db.rows("reading_test_attempts")[0]["sitting_id"] == s["id"]


def test_attach_attempt_rejects_before_section_open(fake_db, svc):
    """A domain attempt can't be attached before the admin opens that section."""
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    attempt_id = str(uuid4())
    fake_db.seed("reading_test_attempts",
                 {"id": attempt_id, "user_id": str(u), "test_id": None,
                  "status": "in_progress", "sitting_id": None})
    with pytest.raises(svc.SittingConflictError):
        svc.attach_attempt(s["id"], u, "reading", attempt_id)


def test_attach_attempt_rejects_foreign_attempt(fake_db, svc):
    """Finding 2: cannot attach an attempt owned by another user."""
    exam = _seed_exam(fake_db, listening=False)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.advance_section(exam["id"], str(uuid4()))
    other_attempt = str(uuid4())
    fake_db.seed("reading_test_attempts",
                 {"id": other_attempt, "user_id": str(uuid4()), "test_id": None,
                  "status": "submitted", "sitting_id": None})
    with pytest.raises(PermissionError):
        svc.attach_attempt(s["id"], u, "reading", other_attempt)


def test_attach_attempt_rejects_wrong_test(fake_db, svc):
    """Finding 2: cannot attach an attempt of a different (easier) test."""
    exam = _seed_exam(fake_db, listening=False)
    exam["reading_test_id"] = "the-real-test"      # exam now pins a reading test
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.advance_section(exam["id"], str(uuid4()))
    wrong = str(uuid4())
    fake_db.seed("reading_test_attempts",
                 {"id": wrong, "user_id": str(u), "test_id": "some-other-test",
                  "status": "submitted", "sitting_id": None})
    with pytest.raises(svc.SittingConflictError):
        svc.attach_attempt(s["id"], u, "reading", wrong)


def test_attach_attempt_rejects_swap(fake_db, svc):
    """Finding 2: a section bound to a SUBMITTED attempt can't swap to another."""
    exam = _seed_exam(fake_db, listening=False)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.advance_section(exam["id"], str(uuid4()))
    a1, a2 = str(uuid4()), str(uuid4())
    for a in (a1, a2):
        fake_db.seed("reading_test_attempts",
                     {"id": a, "user_id": str(u), "test_id": exam["reading_test_id"],
                      "status": "submitted", "sitting_id": None})
    svc.attach_attempt(s["id"], u, "reading", a1)
    with pytest.raises(svc.SittingConflictError):
        svc.attach_attempt(s["id"], u, "reading", a2)


def test_attach_attempt_allows_rebind_of_unsubmitted(fake_db, svc):
    """Finding 3 (round 3): a reload abandons the in_progress attempt and the
    runner mints a new one — re-binding must succeed (else the student is locked
    out), because the prior attempt was NOT submitted."""
    exam = _seed_exam(fake_db, listening=False)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.advance_section(exam["id"], str(uuid4()))
    old, new = str(uuid4()), str(uuid4())
    fake_db.seed("reading_test_attempts",
                 {"id": old, "user_id": str(u), "test_id": exam["reading_test_id"],
                  "status": "in_progress", "sitting_id": None})
    fake_db.seed("reading_test_attempts",
                 {"id": new, "user_id": str(u), "test_id": exam["reading_test_id"],
                  "status": "in_progress", "sitting_id": None})
    svc.attach_attempt(s["id"], u, "reading", old)
    svc.attach_attempt(s["id"], u, "reading", new)   # resume — must not raise
    assert svc.get_sitting(s["id"])["reading_attempt_id"] == new


def test_submit_writing_stores_texts_with_word_counts(fake_db, svc):
    exam = _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _reach_writing(svc, fake_db, exam, s["id"], u)
    out = svc.submit_writing(s["id"], u, "one two three", "alpha beta")
    ws = out["writing_submission"]
    assert ws["task1"]["word_count"] == 3
    assert ws["task2"]["word_count"] == 2
    assert ws["task1"]["text"] == "one two three"


def test_submit_writing_rejected_after_lrw_submit(fake_db, svc):
    """Finding 1 (round 4): Writing text can't be overwritten after finalisation."""
    exam = _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, exam, s["id"], u)          # sitting now past lrw_writing
    with pytest.raises(svc.SittingConflictError):
        svc.submit_writing(s["id"], u, "sneaky edit", "sneaky edit 2")


def test_submit_section_idempotent_no_status_regress(fake_db, svc, wf):
    """Finding 2 (round 4), carried into the sequential model: a stale
    submit_section retry after review started must not regress under_review
    back to lrw_submitted."""
    exam = _seed_exam(fake_db, speaking=False)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, exam, s["id"], u)          # → all_submitted, review queued
    review = wf.get_review_for_sitting(s["id"])
    wf.claim(review["id"], uuid4())             # → under_review
    assert svc.get_sitting(s["id"])["status"] == "under_review"
    svc.submit_section(s["id"], u, "writing")    # stale retry — must be a no-op
    assert svc.get_sitting(s["id"])["status"] == "under_review"


def test_void_keeps_sitting_sealed(fake_db, svc):
    """Finding 3 (round 4): voiding a not-yet-released sitting must not unseal
    (would expose scores/answer keys for a cancelled exam)."""
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.void_sitting(s["id"], str(uuid4()), "tech failure")
    assert svc.is_sealed(s["id"]) is True       # still sealed after void
    assert svc.get_sitting(s["id"])["status"] == "void"


def test_submit_section_before_open_raises(fake_db, svc):
    """A bare submit on a registered (nothing opened yet) sitting must not
    finalise or queue a review with no work."""
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    with pytest.raises(svc.SittingConflictError):
        svc.submit_section(s["id"], u, "listening")
    assert len(fake_db.rows("mock_exam_reviews")) == 0


def test_submit_section_writing_before_open_raises(fake_db, svc):
    exam = _seed_exam(fake_db, listening=False, reading=False)   # writing-only
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    # exam still not_started — Writing never opened
    with pytest.raises(svc.SittingConflictError):
        svc.submit_section(s["id"], u, "writing", "essay one", "essay two")


def test_submit_section_writing_empty_text_still_accepted(fake_db, svc):
    """An empty essay (student wrote nothing before time ran out) is a valid,
    if weak, submission — not an error."""
    exam = _seed_exam(fake_db, listening=False, reading=False)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.advance_section(exam["id"], str(uuid4()))   # → writing
    _expire_section(fake_db, exam["id"], "writing")
    result = svc.submit_section(s["id"], u, "writing")
    assert result["writing_submitted_at"] is not None


def test_record_speaking_empty_raises(fake_db, svc):
    """Finding 2: an empty session list cannot mark Speaking complete."""
    _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    with pytest.raises(svc.SittingConflictError):
        svc.record_speaking(s["id"], str(u), [])


def test_record_speaking_foreign_session_raises(fake_db, svc):
    """Finding 2: a session owned by another user cannot complete Speaking."""
    _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    other = str(uuid4())
    fake_db.seed("sessions", {"id": other, "user_id": str(uuid4()),
                              "sitting_id": s["id"]})
    with pytest.raises(PermissionError):
        svc.record_speaking(s["id"], str(u), [other])


def test_record_speaking_unlinked_session_raises(fake_db, svc):
    """Finding 3: a session NOT created within the sitting (its per-response
    grading was never sealed) cannot be used to complete Speaking."""
    _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    unlinked = str(uuid4())
    fake_db.seed("sessions", {"id": unlinked, "user_id": str(u), "sitting_id": None})
    with pytest.raises(svc.SittingConflictError):
        svc.record_speaking(s["id"], str(u), [unlinked])


def test_record_speaking_incomplete_session_raises(fake_db, svc):
    """Finding 2 (round 3): a linked but in_progress / response-less session (a
    bare shell, no actual speaking) can't complete Speaking."""
    _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    shell = str(uuid4())
    # linked + owned, but in_progress and no responses
    fake_db.seed("sessions", {"id": shell, "user_id": str(u),
                              "sitting_id": s["id"], "status": "in_progress"})
    with pytest.raises(svc.SittingConflictError):
        svc.record_speaking(s["id"], str(u), [shell])


def test_bind_session_to_sitting_links_at_creation(fake_db, svc):
    """Finding 3: sessions are linked to the sitting at creation so per-response
    grading is sealed from the first answer."""
    _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    sess = str(uuid4())
    fake_db.seed("sessions", {"id": sess, "user_id": str(u), "sitting_id": None})
    svc.bind_session_to_sitting(sess, str(u), s["id"])
    assert fake_db.rows("sessions")[0]["sitting_id"] == s["id"]


def test_is_sealed_tracks_flag(fake_db, svc):
    _seed_exam(fake_db)
    s = svc.create_sitting(uuid4(), "MOCK-TEST-A")
    assert svc.is_sealed(s["id"]) is True
    fake_db.rows("mock_exam_sittings")[0]["sealed"] = False
    assert svc.is_sealed(s["id"]) is False
    assert svc.is_sealed(uuid4()) is False   # missing sitting → not sealed


# ── review workflow: claim / final bands / release ────────────────────


def _sitting_at_all_submitted(fake_db, svc):
    # 4-skill exam so the review requires all four bands (see finding 5 tests).
    exam = _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, exam, s["id"], u)
    _do_speaking(svc, fake_db, s["id"], u)
    return s["id"]


def test_review_created_queued(fake_db, svc, wf):
    sid = _sitting_at_all_submitted(fake_db, svc)
    review = wf.get_review_for_sitting(sid)
    assert review["status"] == "queued"


def test_claim_is_atomic(fake_db, svc, wf):
    sid = _sitting_at_all_submitted(fake_db, svc)
    review = wf.get_review_for_sitting(sid)
    results = {}
    barrier = threading.Barrier(2)

    def worker(name, admin):
        barrier.wait()
        try:
            wf.claim(review["id"], admin)
            results[name] = "ok"
        except wf.ConflictError:
            results[name] = "conflict"

    a = uuid4(); b = uuid4()
    t1 = threading.Thread(target=worker, args=("a", a))
    t2 = threading.Thread(target=worker, args=("b", b))
    t1.start(); t2.start(); t1.join(); t2.join()
    assert sorted(results.values()) == ["conflict", "ok"]
    # sitting mirrored to under_review
    assert svc.get_sitting(sid)["status"] == "under_review"


def test_claim_non_queued_raises_conflict(fake_db, svc, wf):
    sid = _sitting_at_all_submitted(fake_db, svc)
    review = wf.get_review_for_sitting(sid)
    wf.claim(review["id"], uuid4())
    with pytest.raises(wf.ConflictError):
        wf.claim(review["id"], uuid4())


def test_save_final_bands_computes_overall(fake_db, svc, wf):
    sid = _sitting_at_all_submitted(fake_db, svc)
    review = wf.get_review_for_sitting(sid)
    admin = uuid4()
    wf.claim(review["id"], admin)
    saved = wf.save_final_bands(
        review["id"], admin,
        {"listening": 7.0, "reading": 6.5, "writing": 6.0, "speaking": 6.5},
    )
    # mean = 6.5 → ielts_round → 6.5
    assert saved["final_bands"]["overall"] == 6.5
    assert saved["status"] == "reviewed"


def test_save_final_bands_rounds_quarter_up(fake_db, svc, wf):
    sid = _sitting_at_all_submitted(fake_db, svc)
    review = wf.get_review_for_sitting(sid)
    admin = uuid4()
    wf.claim(review["id"], admin)
    saved = wf.save_final_bands(
        review["id"], admin,
        {"listening": 7.0, "reading": 6.0, "writing": 6.0, "speaking": 6.0},
    )
    # mean = 6.25 → IELTS rounds .25 UP → 6.5
    assert saved["final_bands"]["overall"] == 6.5


def test_save_final_bands_missing_skill_raises(fake_db, svc, wf):
    sid = _sitting_at_all_submitted(fake_db, svc)
    review = wf.get_review_for_sitting(sid)
    admin = uuid4()
    wf.claim(review["id"], admin)
    with pytest.raises(wf.ValidationError):
        wf.save_final_bands(review["id"], admin,
                            {"listening": 7.0, "reading": 6.5, "writing": 6.0})


def test_save_final_bands_non_claimant_raises(fake_db, svc, wf):
    sid = _sitting_at_all_submitted(fake_db, svc)
    review = wf.get_review_for_sitting(sid)
    wf.claim(review["id"], uuid4())
    with pytest.raises(PermissionError):
        wf.save_final_bands(review["id"], uuid4(),
                            {"listening": 7.0, "reading": 6.5,
                             "writing": 6.0, "speaking": 6.5})


def test_release_requires_reviewed(fake_db, svc, wf):
    sid = _sitting_at_all_submitted(fake_db, svc)
    review = wf.get_review_for_sitting(sid)
    admin = uuid4()
    wf.claim(review["id"], admin)
    # not yet reviewed → cannot release
    with pytest.raises(wf.ConflictError):
        wf.release_results(review["id"], admin)


def test_release_lifts_seal_on_sitting(fake_db, svc, wf):
    sid = _sitting_at_all_submitted(fake_db, svc)
    review = wf.get_review_for_sitting(sid)
    admin = uuid4()
    wf.claim(review["id"], admin)
    wf.save_final_bands(review["id"], admin,
                        {"listening": 7.0, "reading": 6.5,
                         "writing": 6.0, "speaking": 6.5})
    released = wf.release_results(review["id"], admin, channel="in_app")
    assert released["status"] == "released"
    assert released["release_channel"] == "in_app"
    sitting = svc.get_sitting(sid)
    assert sitting["status"] == "released"
    assert sitting["sealed"] is False
    assert svc.is_sealed(sid) is False   # seal lifted → scores now visible


def test_save_final_bands_rejected_after_release(fake_db, svc, wf):
    """Finding 4 (round 3): a stale admin tab can't rewrite bands after release."""
    sid = _sitting_at_all_submitted(fake_db, svc)
    review = wf.get_review_for_sitting(sid)
    admin = uuid4()
    wf.claim(review["id"], admin)
    bands = {"listening": 7.0, "reading": 6.5, "writing": 6.0, "speaking": 6.5}
    wf.save_final_bands(review["id"], admin, bands)
    wf.release_results(review["id"], admin, channel="in_app")
    with pytest.raises(wf.ConflictError):
        wf.save_final_bands(review["id"], admin,
                            {"listening": 9.0, "reading": 9.0,
                             "writing": 9.0, "speaking": 9.0})


def test_lrw_only_review_needs_no_speaking_band(fake_db, svc, wf):
    """Finding 5: an LRW-only exam bands 3 skills; overall = mean of the 3,
    and no Speaking band is demanded."""
    exam = _seed_exam(fake_db, speaking=False)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, exam, s["id"], u)               # → all_submitted (no speaking)
    review = wf.get_review_for_sitting(s["id"])
    admin = uuid4()
    wf.claim(review["id"], admin)
    saved = wf.save_final_bands(
        review["id"], admin,
        {"listening": 7.0, "reading": 6.0, "writing": 5.0},   # no speaking
    )
    # mean(7,6,5) = 6.0
    assert saved["final_bands"]["overall"] == 6.0
    assert "speaking" not in saved["final_bands"]


def test_reading_writing_only_review_needs_no_listening_band(fake_db, svc, wf):
    """Codex P2: an exam with no Listening test configured must not force the
    reviewer to invent a Listening band — required_skills mirrors
    _configured_sections, not just "speaking present or not"."""
    exam = _seed_exam(fake_db, speaking=False, listening=False)   # reading+writing only
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, exam, s["id"], u)
    review = wf.get_review_for_sitting(s["id"])
    admin = uuid4()
    wf.claim(review["id"], admin)
    assert set(wf.required_skills_for_sitting(s["id"])) == {"reading", "writing"}
    saved = wf.save_final_bands(
        review["id"], admin, {"reading": 6.0, "writing": 5.0},   # no listening, no speaking
    )
    assert saved["final_bands"]["overall"] == 5.5   # mean(6,5)
    assert "listening" not in saved["final_bands"]
    assert "speaking" not in saved["final_bands"]


def test_save_final_bands_persists_retest_flags(fake_db, svc, wf):
    """mig 152 (2026-07-12): retest_flags is an independent pass/fail judgment
    saved alongside final_bands, restricted to the sitting's required skills."""
    exam = _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, exam, s["id"], u)
    _do_speaking(svc, fake_db, s["id"], u)
    review = wf.get_review_for_sitting(s["id"])
    admin = uuid4()
    wf.claim(review["id"], admin)
    saved = wf.save_final_bands(
        review["id"], admin,
        {"listening": 5.0, "reading": 5.5, "writing": 4.0, "speaking": 6.0},
        retest_flags={"writing": True, "listening": False, "unknown_skill": True},
    )
    # unknown_skill dropped — only keys for required skills survive
    assert saved["retest_flags"] == {"writing": True, "listening": False}


def test_retest_summary_counts_per_skill_and_lists_students(fake_db, svc, wf):
    """Two sittings SHARE one exam's clock (advance_section is a single admin
    action for the whole class) — mirrors test_admin_section_progress_counts'
    two-sitting-one-exam pattern, not _run_lrw (built for a solo sitting)."""
    exam = _seed_exam(fake_db, speaking=True)
    admin_id = str(uuid4())
    u1, u2, u3 = uuid4(), uuid4(), uuid4()
    fake_db.seed("users", {"id": str(u1), "display_name": "Học viên A", "email": "a@x.com"})
    fake_db.seed("users", {"id": str(u2), "display_name": "Học viên B", "email": "b@x.com"})
    # a third sitting reaches the review queue but is never claimed/banded —
    # Codex P2 (2026-07-12): a still-'queued' review must NOT count as
    # "đã duyệt", or it silently reports as a clean pass with no retest.
    fake_db.seed("users", {"id": str(u3), "display_name": "Học viên C", "email": "c@x.com"})
    s1 = svc.create_sitting(u1, "MOCK-TEST-A")
    s2 = svc.create_sitting(u2, "MOCK-TEST-A")
    s3 = svc.create_sitting(u3, "MOCK-TEST-A")

    for section in svc._configured_sections(exam):
        svc.advance_section(exam["id"], admin_id)
        _expire_section(fake_db, exam["id"], section)
        for sid, u in ((s1["id"], u1), (s2["id"], u2), (s3["id"], u3)):
            if section == "writing":
                svc.submit_section(sid, u, "writing", "essay a", "essay b")
            else:
                _attach_domain_submitted(svc, fake_db, exam, sid, u, section)
                svc.submit_section(sid, u, section)
    _do_speaking(svc, fake_db, s1["id"], u1)
    _do_speaking(svc, fake_db, s2["id"], u2)
    _do_speaking(svc, fake_db, s3["id"], u3)

    r1 = wf.get_review_for_sitting(s1["id"])
    r2 = wf.get_review_for_sitting(s2["id"])
    r3 = wf.get_review_for_sitting(s3["id"])
    admin = uuid4()
    wf.claim(r1["id"], admin)
    wf.save_final_bands(
        r1["id"], admin,
        {"listening": 5.0, "reading": 5.0, "writing": 4.0, "speaking": 5.0},
        retest_flags={"writing": True},
    )
    wf.claim(r2["id"], admin)
    wf.save_final_bands(
        r2["id"], admin,
        {"listening": 7.0, "reading": 7.0, "writing": 6.5, "speaking": 7.0},
        retest_flags={"writing": False},   # no retest — clean pass
    )
    assert r3["status"] == "queued"   # never claimed/banded

    summary = wf.retest_summary(exam["id"])
    assert summary["total_sittings"] == 3
    assert summary["reviewed_sittings"] == 2   # s3's queued review excluded
    assert summary["needs_retest_count"] == 1
    assert summary["per_skill"]["writing"] == 1
    assert summary["per_skill"]["listening"] == 0
    assert summary["students"] == [
        {"sitting_id": s1["id"], "user_id": str(u1),
         "student_name": "Học viên A", "skills": ["writing"]},
    ]


def _stamp_attempt_score(fake, section, aid, *, score, total, band):
    """Write a machine grade onto a seeded L/R attempt so roster() has a
    correct-count/total to report (mirrors the real grader's writeback)."""
    table = {"listening": "listening_test_attempts",
             "reading": "reading_test_attempts"}[section]
    for row in fake.rows(table):
        if row["id"] == aid:
            row["score"] = score
            row["grading_details"] = [{"q_num": i} for i in range(total)]
            row["band_estimate"] = band


def test_roster_lists_students_with_per_skill_snapshot(fake_db, svc, wf):
    """P1 (2026-07-12): the review console shows a class grid — one row per
    sitting with a per-skill preliminary snapshot (L/R correct/total, Writing
    word counts, Speaking session count) + claim status. Two sittings share the
    one exam clock (advance_section is class-wide)."""
    exam = _seed_exam(fake_db, speaking=True)
    admin_id = str(uuid4())
    u1, u2 = uuid4(), uuid4()
    fake_db.seed("users", {"id": str(u1), "display_name": "An", "email": "an@x.com"})
    fake_db.seed("users", {"id": str(u2), "display_name": "Bình", "email": "binh@x.com"})
    s1 = svc.create_sitting(u1, "MOCK-TEST-A")
    s2 = svc.create_sitting(u2, "MOCK-TEST-A")

    for section in svc._configured_sections(exam):
        svc.advance_section(exam["id"], admin_id)
        _expire_section(fake_db, exam["id"], section)
        for sid, u in ((s1["id"], u1), (s2["id"], u2)):
            if section == "writing":
                svc.submit_section(sid, u, "writing", "one two three", "a b c d e f")
            else:
                aid = _attach_domain_submitted(svc, fake_db, exam, sid, u, section)
                score = 30 if section == "reading" else 28
                _stamp_attempt_score(fake_db, section, aid, score=score, total=40, band=7.0)
                svc.submit_section(sid, u, section)
    _do_speaking(svc, fake_db, s1["id"], u1, n=2)
    _do_speaking(svc, fake_db, s2["id"], u2, n=1)

    rows = wf.roster(exam["id"])
    assert [r["student_name"] for r in rows] == ["An", "Bình"]   # sorted by name
    an = rows[0]
    assert an["listening"] == {"score": 28, "max": 40, "band": 7.0}
    assert an["reading"] == {"score": 30, "max": 40, "band": 7.0}
    assert an["writing"]["task1_wc"] == 3
    assert an["writing"]["task2_wc"] == 6
    assert an["speaking"]["count"] == 2
    assert rows[1]["speaking"]["count"] == 1
    # a fully-submitted sitting has a review row → clickable into detail, unclaimed
    assert an["review_id"] is not None
    assert an["review_status"] == "queued"
    assert an["claimed"] is False


def test_roster_excludes_void_and_handles_in_progress(fake_db, svc, wf):
    """Roster includes still-in-progress sittings (no attempts yet → None cells,
    no review to click) but excludes voided ones."""
    exam = _seed_exam(fake_db, speaking=False)
    u1, u2 = uuid4(), uuid4()
    fake_db.seed("users", {"id": str(u1), "display_name": "Chi", "email": "chi@x.com"})
    fake_db.seed("users", {"id": str(u2), "display_name": "Dũng", "email": "dung@x.com"})
    s1 = svc.create_sitting(u1, "MOCK-TEST-A")   # in-progress, nothing submitted
    s2 = svc.create_sitting(u2, "MOCK-TEST-A")
    # void s2 directly (void_sitting needs an admin id; the roster only reads status)
    for row in fake_db.rows("mock_exam_sittings"):
        if row["id"] == s2["id"]:
            row["status"] = "void"

    rows = wf.roster(exam["id"])
    assert [r["student_name"] for r in rows] == ["Chi"]   # Dũng (void) excluded
    chi = rows[0]
    assert chi["listening"] == {"score": None, "max": None, "band": None}
    assert chi["reading"] == {"score": None, "max": None, "band": None}
    assert chi["writing"]["task1_wc"] is None
    assert chi["speaking"]["count"] == 0
    assert chi["review_id"] is None        # nothing to review yet
    assert chi["claimed"] is False
    assert chi["needs_retest"] is False    # default, not flagged


def test_set_sitting_retest_toggles_and_roster_reflects_it(fake_db, svc, wf):
    """P4 (2026-07-12): admin marks a student 'cần test lại' EARLY from the
    roster; the flag round-trips (set → roster shows it → clear → gone)."""
    exam = _seed_exam(fake_db, speaking=False)
    u = uuid4()
    fake_db.seed("users", {"id": str(u), "display_name": "Em", "email": "em@x.com"})
    s = svc.create_sitting(u, "MOCK-TEST-A")
    admin = str(uuid4())

    svc.set_sitting_retest(s["id"], admin, True, reason="trượt L/R")
    assert wf.roster(exam["id"])[0]["needs_retest"] is True
    sitting = svc.get_sitting(s["id"])
    assert sitting["needs_retest_by"] == admin
    assert sitting["needs_retest_reason"] == "trượt L/R"

    svc.set_sitting_retest(s["id"], admin, False)
    row = wf.roster(exam["id"])[0]
    assert row["needs_retest"] is False
    assert svc.get_sitting(s["id"])["needs_retest_at"] is None   # stamp cleared


def test_retest_summary_counts_early_sitting_flag(fake_db, svc, wf):
    """An early needs_retest flag (no completed review yet) still counts toward
    the class 'cần test lại' total, with empty per-skill detail."""
    exam = _seed_exam(fake_db, speaking=False)
    u = uuid4()
    fake_db.seed("users", {"id": str(u), "display_name": "Phúc", "email": "p@x.com"})
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.set_sitting_retest(s["id"], str(uuid4()), True)

    summary = wf.retest_summary(exam["id"])
    assert summary["needs_retest_count"] == 1
    assert summary["students"] == [
        {"sitting_id": s["id"], "user_id": str(u), "student_name": "Phúc", "skills": []},
    ]
    assert summary["per_skill"] == {k: 0 for k in wf._SKILLS}   # no skill detail


def test_save_final_bands_syncs_sitting_needs_retest(fake_db, svc, wf):
    """save_final_bands with a per-skill flag also flips the sitting-level
    needs_retest, so roster/summary stay consistent whichever path set it."""
    exam = _seed_exam(fake_db, speaking=False)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, exam, s["id"], u)
    review = wf.get_review_for_sitting(s["id"])
    admin = uuid4()
    wf.claim(review["id"], admin)
    wf.save_final_bands(
        review["id"], admin,
        {"listening": 6.0, "reading": 6.0, "writing": 4.0},
        retest_flags={"writing": True},
    )
    assert svc.get_sitting(s["id"])["needs_retest"] is True


def test_save_final_bands_does_not_clear_early_retest_flag(fake_db, svc, wf):
    """Codex P2 (2026-07-12): the review form always posts a full retest_flags
    object (unchecked = false). Saving bands with NO per-skill flag must NOT
    wipe an EARLIER early-toggle retake decision — the sitting-level flag is
    only ever set true here, never cleared (clearing is the explicit toggle)."""
    exam = _seed_exam(fake_db, speaking=False)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, exam, s["id"], u)
    svc.set_sitting_retest(s["id"], str(uuid4()), True)   # early decision

    review = wf.get_review_for_sitting(s["id"])
    admin = uuid4()
    wf.claim(review["id"], admin)
    wf.save_final_bands(
        review["id"], admin,
        {"listening": 6.0, "reading": 6.0, "writing": 6.0},
        retest_flags={"writing": False, "listening": False, "reading": False},
    )
    # early flag survives — admin never explicitly cleared it
    assert svc.get_sitting(s["id"])["needs_retest"] is True


def test_get_queue_scoped_to_one_exam_with_student_name(fake_db, svc, wf):
    """Codex-adjacent (2026-07-12): duyệt theo từng đề, not a cross-exam batch —
    mock_exam_id scopes the queue, and each row carries a resolved
    student_name (display_name, falling back to email) instead of a bare
    user_id."""
    exam_a = _seed_exam(fake_db, speaking=True)
    exam_b = _seed_exam(fake_db, speaking=True)
    exam_b["code"] = "MOCK-TEST-B"

    u_a = uuid4()
    fake_db.seed("users", {"id": str(u_a), "display_name": "Nguyen Van A", "email": "a@x.com"})
    s_a = svc.create_sitting(u_a, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, exam_a, s_a["id"], u_a)
    _do_speaking(svc, fake_db, s_a["id"], u_a)

    u_b = uuid4()
    fake_db.seed("users", {"id": str(u_b), "display_name": None, "email": "b@x.com"})
    s_b = svc.create_sitting(u_b, "MOCK-TEST-B")
    _run_lrw(svc, fake_db, exam_b, s_b["id"], u_b)
    _do_speaking(svc, fake_db, s_b["id"], u_b)

    queue_a = wf.get_queue(mock_exam_id=exam_a["id"])
    assert len(queue_a) == 1
    assert queue_a[0]["sitting_id"] == s_a["id"]
    assert queue_a[0]["student_name"] == "Nguyen Van A"

    queue_b = wf.get_queue(mock_exam_id=exam_b["id"])
    assert len(queue_b) == 1
    assert queue_b[0]["sitting_id"] == s_b["id"]
    assert queue_b[0]["student_name"] == "b@x.com"  # no display_name → falls back to email


def test_promote_writing_essays_creates_pending_rows(fake_db, svc):
    """P1.1 (2026-07-12): a submitted Writing section's raw JSON becomes real
    writing_essays rows (status='pending', no job scheduled) — the same rows
    grade.html/queue.html already manage, instead of a bespoke JSON display."""
    exam = _seed_exam(fake_db, speaking=False)
    prompt1, prompt2 = str(uuid4()), str(uuid4())
    exam["writing_task1_prompt_id"] = prompt1
    exam["writing_task2_prompt_id"] = prompt2
    fake_db.seed("writing_prompts", {"id": prompt1, "task_type": "task1_academic",
                                     "prompt_text": "Describe the chart.", "title": "T1",
                                     "prompt_image_url": "https://img/x.png"})
    fake_db.seed("writing_prompts", {"id": prompt2, "task_type": "task2",
                                     "prompt_text": "Discuss both views.", "title": "T2"})
    u = uuid4()
    student_id = str(uuid4())
    fake_db.seed("students", {"id": student_id, "user_id": str(u)})
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, exam, s["id"], u)

    sitting = svc.get_sitting(s["id"])
    essays = fake_db.rows("writing_essays")
    assert len(essays) == 2
    assert {e["status"] for e in essays} == {"pending"}
    essay_ids = {e["id"] for e in essays}
    assert sitting["essay_task1_id"] in essay_ids
    assert sitting["essay_task2_id"] in essay_ids
    t1 = next(e for e in essays if e["id"] == sitting["essay_task1_id"])
    assert t1["task_type"] == "task1_academic"
    assert t1["student_id"] == student_id
    assert t1["prompt_text"] == "Describe the chart."
    assert not fake_db.rows("writing_jobs")   # no job auto-scheduled

    # idempotent — re-running (e.g. a stray force-collect) must not duplicate
    svc._promote_writing_essays(s["id"])
    assert len(fake_db.rows("writing_essays")) == 2


def test_promote_writing_essays_snapshots_reviewed_task1_facts(fake_db, svc):
    """Codex P2 (2026-07-12): mock Task 1 essays have no writing_assignments
    row, so the grading-time fallback (reviewed_prompt_facts_for_essay) can
    never find facts for them — the submit-time snapshot must happen here,
    mirroring routers/writing_student.py's prompt_image_analysis_reviewed gate.
    A REVIEWED extraction is copied onto the essay; an unreviewed one is not."""
    exam = _seed_exam(fake_db, speaking=False)
    prompt1, prompt2 = str(uuid4()), str(uuid4())
    exam["writing_task1_prompt_id"] = prompt1
    exam["writing_task2_prompt_id"] = prompt2
    fake_db.seed("writing_prompts", {
        "id": prompt1, "task_type": "task1_academic",
        "prompt_text": "Describe the chart.", "title": "T1",
        "prompt_image_url": "https://img/x.png",
        "prompt_image_analysis": {"facts": ["bar A peaks in 2020"]},
        "prompt_image_analysis_reviewed": True,
    })
    fake_db.seed("writing_prompts", {
        "id": prompt2, "task_type": "task1_academic",
        "prompt_text": "Describe the other chart.", "title": "T2",
        "prompt_image_url": "https://img/y.png",
        "prompt_image_analysis": {"facts": ["should not appear"]},
        "prompt_image_analysis_reviewed": False,   # unreviewed — must NOT be copied
    })
    u = uuid4()
    student_id = str(uuid4())
    fake_db.seed("students", {"id": student_id, "user_id": str(u)})
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, exam, s["id"], u)

    sitting = svc.get_sitting(s["id"])
    essays = fake_db.rows("writing_essays")
    t1 = next(e for e in essays if e["id"] == sitting["essay_task1_id"])
    t2 = next(e for e in essays if e["id"] == sitting["essay_task2_id"])
    assert t1["prompt_image_analysis"] == {"facts": ["bar A peaks in 2020"]}
    assert t2.get("prompt_image_analysis") is None


def test_promote_writing_essays_skips_empty_task(fake_db, svc):
    """An empty essay text must not create a writing_essays row for that task."""
    exam = _seed_exam(fake_db, speaking=False)
    prompt1 = str(uuid4())
    exam["writing_task1_prompt_id"] = prompt1
    exam["writing_task2_prompt_id"] = None
    fake_db.seed("writing_prompts", {"id": prompt1, "task_type": "task1_academic",
                                     "prompt_text": "Describe the chart.", "title": "T1"})
    u = uuid4()
    fake_db.seed("students", {"id": str(uuid4()), "user_id": str(u)})
    s = svc.create_sitting(u, "MOCK-TEST-A")
    admin = str(uuid4())
    for section in svc._configured_sections(exam):
        svc.advance_section(exam["id"], admin)
        _expire_section(fake_db, exam["id"], section)
        if section == "writing":
            svc.submit_section(s["id"], u, "writing", "", "")   # both blank
        else:
            _attach_domain_submitted(svc, fake_db, exam, s["id"], u, section)
            svc.submit_section(s["id"], u, section)

    assert fake_db.rows("writing_essays") == []
    sitting = svc.get_sitting(s["id"])
    assert sitting.get("essay_task1_id") is None
    assert sitting.get("essay_task2_id") is None


def test_release_delivers_reviewed_writing_essays(fake_db, svc, wf):
    """P2 (2026-07-12): CÔNG BỐ is the one action that unlocks everything —
    release also flips the sitting's REVIEWED writing essays to 'delivered'
    (so the student can open writing-result.html, which gates on 'delivered'),
    while a still-'graded' essay (admin hasn't approved yet) is left untouched."""
    exam = _seed_exam(fake_db, speaking=False)
    p1, p2 = str(uuid4()), str(uuid4())
    exam["writing_task1_prompt_id"] = p1
    exam["writing_task2_prompt_id"] = p2
    fake_db.seed("writing_prompts", {"id": p1, "task_type": "task1_academic",
                                     "prompt_text": "x", "title": "T1"})
    fake_db.seed("writing_prompts", {"id": p2, "task_type": "task2",
                                     "prompt_text": "y", "title": "T2"})
    u = uuid4()
    fake_db.seed("students", {"id": str(uuid4()), "user_id": str(u)})
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, exam, s["id"], u)   # promotes 2 pending essays

    sitting = svc.get_sitting(s["id"])
    e1, e2 = sitting["essay_task1_id"], sitting["essay_task2_id"]
    for row in fake_db.rows("writing_essays"):
        if row["id"] == e1:
            row["status"] = "reviewed"   # admin approved
        if row["id"] == e2:
            row["status"] = "graded"     # AI done, admin not yet approved

    review = wf.get_review_for_sitting(s["id"])
    admin = uuid4()
    wf.claim(review["id"], admin)
    wf.save_final_bands(review["id"], admin,
                        {"listening": 6.0, "reading": 6.0, "writing": 6.0})
    wf.release_results(review["id"], admin)

    by_id = {r["id"]: r for r in fake_db.rows("writing_essays")}
    assert by_id[e1]["status"] == "delivered"
    assert by_id[e1].get("delivered_at")
    # delivery_method must be a value allowed by the writing_essays CHECK
    # (migration 033) — else Postgres rejects the update in prod and the essay
    # silently stays 'reviewed'.
    assert by_id[e1]["delivery_method"] == "web_view"
    assert by_id[e2]["status"] == "graded"   # not 'reviewed' → left untouched


def test_retake_assign_scopes_skills_and_is_idempotent(fake_db):
    """PR A (retake): assign() creates one row per (exam, user) with skills
    scoped to v1 L/R/W (drops unknown/speaking), shares one group_id, and is
    idempotent per user — re-assigning updates the row, no duplicate."""
    from services import mock_exam_assignment_service as a
    exam_id, admin = str(uuid4()), str(uuid4())
    u1, u2 = str(uuid4()), str(uuid4())

    res = a.assign(exam_id, [
        {"user_id": u1, "skills": ["writing", "speaking", "bogus"]},   # speaking/bogus dropped
        {"user_id": u2, "skills": ["listening", "reading"]},
        {"user_id": str(uuid4()), "skills": []},                       # no valid skill → skipped
    ], created_by=admin, source_exam_id="src-1")

    assert set(res["assigned"]) == {u1, u2}
    assert len(res["skipped"]) == 1
    rows = fake_db.rows("mock_exam_assignments")
    assert len(rows) == 2
    by_uid = {r["user_id"]: r for r in rows}
    assert by_uid[u1]["skills"] == ["writing"]          # speaking/bogus stripped
    assert by_uid[u2]["skills"] == ["listening", "reading"]
    assert by_uid[u1]["assignment_group_id"] == res["group_id"]
    assert by_uid[u1]["source_exam_id"] == "src-1"

    # re-assign u1 with a different skill set → UPDATE, not a duplicate row
    a.assign(exam_id, [{"user_id": u1, "skills": ["reading"]}], created_by=admin)
    rows2 = fake_db.rows("mock_exam_assignments")
    assert len(rows2) == 2
    assert next(r for r in rows2 if r["user_id"] == u1)["skills"] == ["reading"]


def test_retake_assign_coalesces_duplicate_user(fake_db):
    """Codex P2 (2026-07-13): retest_summary is per-sitting, so a user with >1
    flagged sitting arrives twice in one request. assign() must coalesce (union
    skills, one row) — NOT let the second occurrence hit UNIQUE(exam,user)."""
    from services import mock_exam_assignment_service as a
    exam_id, admin, u = str(uuid4()), str(uuid4()), str(uuid4())
    res = a.assign(exam_id, [
        {"user_id": u, "skills": ["writing"]},
        {"user_id": u, "skills": ["reading"]},   # same user, second sitting
    ], created_by=admin)
    assert res["assigned"] == [u]                # one, not two
    rows = fake_db.rows("mock_exam_assignments")
    assert len(rows) == 1
    assert rows[0]["skills"] == ["writing", "reading"]   # union


def test_retake_assign_rejects_inverted_window(fake_db):
    """Codex P2 (2026-07-13): open_until earlier than open_from would lock the
    student out — reject it (400 at the router) instead of persisting."""
    from services import mock_exam_assignment_service as a
    with pytest.raises(a.InvalidWindowError):
        a.assign(str(uuid4()), [{
            "user_id": str(uuid4()), "skills": ["writing"],
            "open_from": "2026-07-20T10:00:00Z", "open_until": "2026-07-20T09:00:00Z",
        }], created_by=str(uuid4()))
    # a valid (from <= until) window is fine
    a.assign(str(uuid4()), [{
        "user_id": str(uuid4()), "skills": ["writing"],
        "open_from": "2026-07-20T09:00:00Z", "open_until": "2026-07-20T10:00:00Z",
    }], created_by=str(uuid4()))


def test_retake_list_and_remove_assignments(fake_db):
    from services import mock_exam_assignment_service as a
    exam_id = str(uuid4())
    u1 = str(uuid4())
    fake_db.seed("users", {"id": u1, "display_name": "Học viên X", "email": "x@x.com"})
    a.assign(exam_id, [{"user_id": u1, "skills": ["writing"]}], created_by=str(uuid4()))

    listed = a.list_assignments(exam_id)
    assert len(listed) == 1
    assert listed[0]["student_name"] == "Học viên X"

    a.remove(exam_id, u1)
    assert a.list_assignments(exam_id) == []


def _seed_retake(fake, u, skills, *, open_from=None, open_until=None):
    """A published retake exam + one assignment for user `u`. Returns the exam."""
    exam = _seed_exam(fake, speaking=False)
    exam["exam_mode"] = "retake"
    p1, p2 = str(uuid4()), str(uuid4())
    exam["writing_task1_prompt_id"] = p1
    exam["writing_task2_prompt_id"] = p2
    fake.seed("writing_prompts", {"id": p1, "task_type": "task1_academic",
                                  "prompt_text": "x", "title": "T1"})
    fake.seed("writing_prompts", {"id": p2, "task_type": "task2",
                                  "prompt_text": "y", "title": "T2"})
    fake.seed("students", {"id": str(uuid4()), "user_id": str(u)})
    fake.seed("mock_exam_assignments", {
        "exam_id": exam["id"], "user_id": str(u), "skills": skills,
        "open_from": open_from, "open_until": open_until,
    })
    return exam


def test_retake_sitting_flow_writing_only(fake_db, svc, wf):
    """PR B: a retaker assigned only Writing enters via assignment (no cohort /
    no admin advance), starts the section on their own clock, submits early
    (self-paced), and finalises to all_submitted on the ASSIGNED skill alone."""
    u = uuid4()
    exam = _seed_retake(fake_db, u, ["writing"])

    s = svc.create_sitting(u, "MOCK-TEST-A")
    assert s["assigned_skills"] == ["writing"]
    assert s["status"] == "registered"

    s2 = svc.start_section(s["id"], u, "writing")
    assert s2["writing_started_at"]
    assert s2["status"] == "lrw_in_progress"
    active, tl = svc.retake_active_section(svc.get_sitting(s["id"]), exam)
    assert active == "writing"
    assert tl is not None and tl > 0

    # submit bypasses the sequential active_section gate; only-assigned skill
    # done → all_submitted + review queued + writing promoted (pipeline reused).
    result = svc.submit_section(s["id"], u, "writing", "essay a", "essay b")
    assert result["status"] == "all_submitted"
    assert len(fake_db.rows("mock_exam_reviews")) == 1
    assert len(fake_db.rows("writing_essays")) == 2


def test_retake_create_sitting_requires_assignment(fake_db, svc):
    exam = _seed_exam(fake_db, speaking=False)
    exam["exam_mode"] = "retake"
    with pytest.raises(svc.NotEligibleError):
        svc.create_sitting(uuid4(), "MOCK-TEST-A")   # no assignment


def test_retake_create_sitting_respects_window(fake_db, svc):
    u = uuid4()
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    _seed_retake(fake_db, u, ["writing"], open_from=future)
    with pytest.raises(svc.WindowClosedError):
        svc.create_sitting(u, "MOCK-TEST-A")         # before open_from


def test_retake_start_section_rejects_unassigned(fake_db, svc):
    u = uuid4()
    _seed_retake(fake_db, u, ["writing"])            # only writing assigned
    s = svc.create_sitting(u, "MOCK-TEST-A")
    with pytest.raises(svc.SittingConflictError):
        svc.start_section(s["id"], u, "reading")     # reading not assigned


def test_retake_review_requires_only_assigned_skills(fake_db, svc, wf):
    """Codex P1 (2026-07-13): a writing-only retake on a FULL mock must not force
    Listening/Reading/Speaking bands with no submissions — the reviewer bands
    only the sitting's assigned skills, so the result can actually be saved."""
    u = uuid4()
    _seed_retake(fake_db, u, ["writing"])            # exam has L/R config, but
    s = svc.create_sitting(u, "MOCK-TEST-A")         # this student only does W
    svc.start_section(s["id"], u, "writing")
    svc.submit_section(s["id"], u, "writing", "essay a", "essay b")

    assert wf.required_skills_for_sitting(s["id"]) == ["writing"]
    review = wf.get_review_for_sitting(s["id"])
    admin = uuid4()
    wf.claim(review["id"], admin)
    saved = wf.save_final_bands(review["id"], admin, {"writing": 6.5})   # no L/R/S needed
    assert saved["final_bands"]["writing"] == 6.5


def test_retake_start_section_blocks_second_concurrent(fake_db, svc):
    """Codex P2 (2026-07-13): only one per-sitting clock may run at a time —
    starting a second assigned section while one is in progress is rejected (a
    hidden clock would bleed time / be reaped unseen)."""
    u = uuid4()
    _seed_retake(fake_db, u, ["reading", "writing"])
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.start_section(s["id"], u, "writing")          # writing clock running
    with pytest.raises(svc.SittingConflictError):
        svc.start_section(s["id"], u, "reading")      # a 2nd concurrent start
    # re-entering the SAME in-progress section stays idempotent-OK
    assert svc.start_section(s["id"], u, "writing")["writing_started_at"]


def _backdate_sitting(fake, sitting_id, **cols):
    for row in fake.rows("mock_exam_sittings"):
        if row["id"] == sitting_id:
            row.update(cols)


def test_retake_reaper_collects_expired_started_section(fake_db, svc, wf):
    """PR C: a started section whose per-sitting clock ran out (+grace) is
    collected even though the student's browser never submitted — and the
    sitting finalises on its assigned skill alone."""
    u = uuid4()
    _seed_retake(fake_db, u, ["writing"])
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.start_section(s["id"], u, "writing")
    # writing limit = 60min; back-date the start well past limit + grace.
    past = (datetime.now(timezone.utc) - timedelta(seconds=3600 + 120)).isoformat()
    _backdate_sitting(fake_db, s["id"], writing_started_at=past)

    res = svc.reap_expired_retake_sittings(grace_seconds=30)
    assert res["collected"] == 1
    sit = svc.get_sitting(s["id"])
    assert sit["writing_submitted_at"]
    assert sit["status"] == "all_submitted"           # only-assigned skill done
    assert len(fake_db.rows("mock_exam_reviews")) == 1


def test_retake_reaper_skips_section_still_in_time(fake_db, svc):
    u = uuid4()
    _seed_retake(fake_db, u, ["writing"])
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.start_section(s["id"], u, "writing")           # just started — plenty of time
    assert svc.reap_expired_retake_sittings(grace_seconds=30)["collected"] == 0
    assert not svc.get_sitting(s["id"]).get("writing_submitted_at")


def test_retake_reaper_finalizes_past_window(fake_db, svc):
    """Once the availability window closes, an unstarted assigned section is
    collected so the sitting finalises (student never came back)."""
    u = uuid4()
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    _seed_retake(fake_db, u, ["writing"], open_until=future)
    s = svc.create_sitting(u, "MOCK-TEST-A")           # entered in-window
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    _backdate_sitting(fake_db, s["id"], retake_open_until=past)   # window now closed

    assert svc.reap_expired_retake_sittings()["collected"] == 1
    sit = svc.get_sitting(s["id"])
    assert sit["writing_submitted_at"]
    assert sit["status"] == "all_submitted"


def test_retake_reaper_ignores_sequential_sittings(fake_db, svc):
    _seed_exam(fake_db, speaking=False)                # sequential (no assigned_skills)
    s = svc.create_sitting(uuid4(), "MOCK-TEST-A")
    assert not s.get("assigned_skills")
    assert svc.reap_expired_retake_sittings()["collected"] == 0


def test_retake_reaper_reconciles_fully_stamped_orphan(fake_db, svc, wf):
    """Codex P2 (2026-07-13): a prior pass stamped every assigned section but
    died before finalising (e.g. a grade write raised after submitted_at). The
    next sweep must re-run the terminal transition, not `continue` past a
    fully-stamped sitting and strand it with no review."""
    u = uuid4()
    _seed_retake(fake_db, u, ["writing"])
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.start_section(s["id"], u, "writing")
    # Simulate the crash aftermath: writing IS stamped submitted, but the sitting
    # is still lrw_in_progress and NO review was ever created.
    _backdate_sitting(fake_db, s["id"],
                      writing_submitted_at=datetime.now(timezone.utc).isoformat(),
                      status="lrw_in_progress")
    assert not fake_db.rows("mock_exam_reviews")

    svc.reap_expired_retake_sittings()
    assert svc.get_sitting(s["id"])["status"] == "all_submitted"
    assert len(fake_db.rows("mock_exam_reviews")) == 1


def test_compute_overall_pure():
    from services import mock_review_workflow as wf
    assert wf.compute_overall(
        {"listening": 8.0, "reading": 8.0, "writing": 7.0, "speaking": 7.0}) == 7.5
    # mean 7.25 → IELTS rounds .25 UP → 7.5
    assert wf.compute_overall(
        {"listening": 7.0, "reading": 7.0, "writing": 7.0, "speaking": 8.0}) == 7.5
    # LRW-only: mean of 3 skills, IELTS-rounded
    assert wf.compute_overall(
        {"listening": 7.0, "reading": 6.0, "writing": 6.0},
        skills=("listening", "reading", "writing")) == 6.5


# ── endpoint seal helper (the guarantee the domain endpoints rely on) ──


def test_listening_endpoint_seal_helper(monkeypatch):
    """The listening submit/result/review endpoints gate on _mock_sealed. Pin it:
    no sitting_id → not sealed; sitting_id + is_sealed True → sealed."""
    from routers import listening
    monkeypatch.setattr(
        "services.mock_exam_service.is_sealed",
        lambda sid: str(sid) == "sealed-one",
    )
    assert listening._mock_sealed({"sitting_id": None}) is False
    assert listening._mock_sealed({}) is False
    assert listening._mock_sealed({"sitting_id": "sealed-one"}) is True
    assert listening._mock_sealed({"sitting_id": "other"}) is False
