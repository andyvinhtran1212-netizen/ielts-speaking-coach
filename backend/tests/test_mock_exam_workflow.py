"""Tests for the 4-skill mock-exam backend (Phase 1).

Covers services/mock_exam_service.py + services/mock_review_workflow.py in
isolation with a stateful in-memory fake for `supabase_admin` (both modules
share one fake instance so the sitting written by the service is visible to the
review workflow).

What we pin:
  - create_sitting: gates (window, cohort), idempotent active-sitting return
  - start_section: forward-only one-way machine, idempotent resume, auto-submit
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

    def eq(self, field, value):
        self.filters.append((field, "eq", value, self._negate_next))
        self._negate_next = False
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
    return fake


@pytest.fixture
def svc():
    from services import mock_exam_service
    return mock_exam_service


@pytest.fixture
def wf():
    from services import mock_review_workflow
    return mock_review_workflow


def _seed_exam(fake, *, cohort_id=None, open_from=None, open_until=None, speaking=False):
    exam = {
        "id": str(uuid4()), "code": "MOCK-TEST-A", "title": "Test",
        "status": "published", "cohort_id": cohort_id,
        "open_from": open_from, "open_until": open_until,
        "section_minutes": {"listening": 32, "reading": 60, "writing": 60},
        # speaking is required only when the exam defines a speaking component
        "speaking_topic_set": ({"part1": ["x"]} if speaking else {}),
    }
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


# ── start_section (one-way machine) ───────────────────────────────────


def test_start_section_forward_only(fake_db, svc):
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    # cannot jump to writing before listening/reading
    with pytest.raises(svc.SittingConflictError):
        svc.start_section(s["id"], u, "writing")
    # listening starts fine
    s2 = svc.start_section(s["id"], u, "listening")
    assert s2["status"] == "lrw_listening"
    assert s2["listening_started_at"] is not None
    assert s2["lrw_started_at"] is not None


def test_start_section_advance_stamps_prior_after_real_submit(fake_db, svc):
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.start_section(s["id"], u, "listening")
    _submit_section(svc, fake_db, s["id"], u, "listening")   # real submitted attempt
    s2 = svc.start_section(s["id"], u, "reading")
    assert s2["status"] == "lrw_reading"
    assert s2["listening_submitted_at"] is not None


def test_start_section_advance_blocked_without_prior_submit(fake_db, svc):
    """Finding 1: advancing must NOT fabricate a prior submission from nav state."""
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.start_section(s["id"], u, "listening")
    # no listening attempt submitted → cannot advance to reading
    with pytest.raises(svc.SittingConflictError):
        svc.start_section(s["id"], u, "reading")


def test_start_section_resume_is_idempotent(fake_db, svc):
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    a = svc.start_section(s["id"], u, "listening")
    b = svc.start_section(s["id"], u, "listening")   # reload/resume
    assert a["listening_started_at"] == b["listening_started_at"]


def test_start_section_wrong_owner_raises(fake_db, svc):
    _seed_exam(fake_db)
    s = svc.create_sitting(uuid4(), "MOCK-TEST-A")
    with pytest.raises(PermissionError):
        svc.start_section(s["id"], uuid4(), "listening")


# ── terminal reconciliation (order-independent) ───────────────────────


def _submit_section(svc, fake, sitting_id, u, section, test_id=None):
    """Simulate a runner finishing a section: seed a SUBMITTED domain attempt +
    attach it to the sitting (so the advance/finalize integrity checks pass)."""
    table = {"listening": "listening_test_attempts",
             "reading": "reading_test_attempts"}[section]
    aid = str(uuid4())
    fake.seed(table, {"id": aid, "user_id": str(u), "test_id": test_id,
                      "status": "submitted", "sitting_id": None})
    svc.attach_attempt(sitting_id, str(u), section, aid)
    return aid


def _reach_writing(svc, fake, sitting_id, u):
    """Drive the sitting to the active Writing step (listening + reading submitted)."""
    svc.start_section(sitting_id, u, "listening")
    _submit_section(svc, fake, sitting_id, u, "listening")
    svc.start_section(sitting_id, u, "reading")
    _submit_section(svc, fake, sitting_id, u, "reading")
    svc.start_section(sitting_id, u, "writing")


def _run_lrw(svc, fake, sitting_id, u):
    _reach_writing(svc, fake, sitting_id, u)
    svc.submit_writing(sitting_id, u, "task one essay", "task two essay")
    return svc.submit_lrw(sitting_id, u)


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
    _seed_exam(fake_db, speaking=False)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    final = _run_lrw(svc, fake_db, s["id"], u)
    assert final["status"] == "all_submitted"
    assert len(fake_db.rows("mock_exam_reviews")) == 1


def test_submit_lrw_then_speaking_reaches_all_submitted(fake_db, svc, wf):
    _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    after_lrw = _run_lrw(svc, fake_db, s["id"], u)
    assert after_lrw["status"] == "speaking_pending"    # speaking required, not yet done
    final = _do_speaking(svc, fake_db, s["id"], u)
    assert final["status"] == "all_submitted"
    assert len(fake_db.rows("mock_exam_reviews")) == 1


def test_speaking_first_then_lrw_also_reaches_all_submitted(fake_db, svc):
    """Order independence: speaking taken BEFORE the LRW mạch."""
    _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    mid = _do_speaking(svc, fake_db, s["id"], u)
    assert mid["status"] == "registered"   # LRW not done yet → no premature advance
    final = _run_lrw(svc, fake_db, s["id"], u)
    assert final["status"] == "all_submitted"
    assert len(fake_db.rows("mock_exam_reviews")) == 1


def test_all_submitted_creates_review_once(fake_db, svc, wf):
    _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, s["id"], u)
    _do_speaking(svc, fake_db, s["id"], u)
    # idempotent: reconciling again doesn't create a second review
    svc._reconcile_terminal(s["id"])
    assert len(fake_db.rows("mock_exam_reviews")) == 1


def test_attach_attempt_sets_both_directions(fake_db, svc):
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    attempt_id = str(uuid4())
    fake_db.seed("reading_test_attempts",
                 {"id": attempt_id, "user_id": str(u), "test_id": None,
                  "status": "in_progress", "sitting_id": None})
    svc.attach_attempt(s["id"], u, "reading", attempt_id)
    sitting = svc.get_sitting(s["id"])
    assert sitting["reading_attempt_id"] == attempt_id
    assert fake_db.rows("reading_test_attempts")[0]["sitting_id"] == s["id"]


def test_attach_attempt_rejects_foreign_attempt(fake_db, svc):
    """Finding 2: cannot attach an attempt owned by another user."""
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    other_attempt = str(uuid4())
    fake_db.seed("reading_test_attempts",
                 {"id": other_attempt, "user_id": str(uuid4()), "test_id": None,
                  "status": "submitted", "sitting_id": None})
    with pytest.raises(PermissionError):
        svc.attach_attempt(s["id"], u, "reading", other_attempt)


def test_attach_attempt_rejects_wrong_test(fake_db, svc):
    """Finding 2: cannot attach an attempt of a different (easier) test."""
    exam = _seed_exam(fake_db)
    exam["reading_test_id"] = "the-real-test"      # exam now pins a reading test
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    wrong = str(uuid4())
    fake_db.seed("reading_test_attempts",
                 {"id": wrong, "user_id": str(u), "test_id": "some-other-test",
                  "status": "submitted", "sitting_id": None})
    with pytest.raises(svc.SittingConflictError):
        svc.attach_attempt(s["id"], u, "reading", wrong)


def test_attach_attempt_rejects_swap(fake_db, svc):
    """Finding 2: a section bound to a SUBMITTED attempt can't swap to another."""
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    a1, a2 = str(uuid4()), str(uuid4())
    for a in (a1, a2):
        fake_db.seed("reading_test_attempts",
                     {"id": a, "user_id": str(u), "test_id": None,
                      "status": "submitted", "sitting_id": None})
    svc.attach_attempt(s["id"], u, "reading", a1)
    with pytest.raises(svc.SittingConflictError):
        svc.attach_attempt(s["id"], u, "reading", a2)


def test_attach_attempt_allows_rebind_of_unsubmitted(fake_db, svc):
    """Finding 3 (round 3): a reload abandons the in_progress attempt and the
    runner mints a new one — re-binding must succeed (else the student is locked
    out), because the prior attempt was NOT submitted."""
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    old, new = str(uuid4()), str(uuid4())
    fake_db.seed("reading_test_attempts",
                 {"id": old, "user_id": str(u), "test_id": None,
                  "status": "in_progress", "sitting_id": None})
    fake_db.seed("reading_test_attempts",
                 {"id": new, "user_id": str(u), "test_id": None,
                  "status": "in_progress", "sitting_id": None})
    svc.attach_attempt(s["id"], u, "reading", old)
    svc.attach_attempt(s["id"], u, "reading", new)   # resume — must not raise
    assert svc.get_sitting(s["id"])["reading_attempt_id"] == new


def test_submit_writing_stores_texts_with_word_counts(fake_db, svc):
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _reach_writing(svc, fake_db, s["id"], u)
    out = svc.submit_writing(s["id"], u, "one two three", "alpha beta")
    ws = out["writing_submission"]
    assert ws["task1"]["word_count"] == 3
    assert ws["task2"]["word_count"] == 2
    assert ws["task1"]["text"] == "one two three"


def test_submit_writing_rejected_after_lrw_submit(fake_db, svc):
    """Finding 1 (round 4): Writing text can't be overwritten after finalisation."""
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, s["id"], u)          # sitting now past lrw_writing
    with pytest.raises(svc.SittingConflictError):
        svc.submit_writing(s["id"], u, "sneaky edit", "sneaky edit 2")


def test_submit_lrw_idempotent_no_status_regress(fake_db, svc, wf):
    """Finding 2 (round 4): a stale submit-lrw retry after review started must
    not regress under_review back to lrw_submitted."""
    _seed_exam(fake_db, speaking=False)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, s["id"], u)          # → all_submitted, review queued
    review = wf.get_review_for_sitting(s["id"])
    wf.claim(review["id"], uuid4())             # → under_review
    assert svc.get_sitting(s["id"])["status"] == "under_review"
    svc.submit_lrw(s["id"], u)                   # stale retry — must be a no-op
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


def test_submit_lrw_on_empty_sitting_raises(fake_db, svc):
    """Finding 1: a bare submit-lrw on a registered sitting must not finalise or
    queue a review with no work."""
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    with pytest.raises(svc.SittingConflictError):
        svc.submit_lrw(s["id"], u)
    assert len(fake_db.rows("mock_exam_reviews")) == 0


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
    _seed_exam(fake_db, speaking=True)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, s["id"], u)
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
    _seed_exam(fake_db, speaking=False)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, fake_db, s["id"], u)               # → all_submitted (no speaking)
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
