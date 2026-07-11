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


def _seed_exam(fake, *, cohort_id=None, open_from=None, open_until=None):
    exam = {
        "id": str(uuid4()), "code": "MOCK-TEST-A", "title": "Test",
        "status": "published", "cohort_id": cohort_id,
        "open_from": open_from, "open_until": open_until,
        "section_minutes": {"listening": 32, "reading": 60, "writing": 60},
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


def test_start_section_advance_auto_submits_prior(fake_db, svc):
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    svc.start_section(s["id"], u, "listening")
    s2 = svc.start_section(s["id"], u, "reading")
    assert s2["status"] == "lrw_reading"
    assert s2["listening_submitted_at"] is not None  # auto-submitted on advance


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


def _run_lrw(svc, sitting_id, u):
    svc.start_section(sitting_id, u, "listening")
    svc.start_section(sitting_id, u, "reading")
    svc.start_section(sitting_id, u, "writing")
    return svc.submit_lrw(sitting_id, u)


def test_submit_lrw_then_speaking_reaches_all_submitted(fake_db, svc, wf):
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    after_lrw = _run_lrw(svc, s["id"], u)
    assert after_lrw["status"] == "speaking_pending"
    final = svc.record_speaking(s["id"], u, [str(uuid4())])
    assert final["status"] == "all_submitted"
    # review auto-created
    assert len(fake_db.rows("mock_exam_reviews")) == 1


def test_speaking_first_then_lrw_also_reaches_all_submitted(fake_db, svc):
    """Order independence: speaking taken BEFORE the LRW mạch."""
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    mid = svc.record_speaking(s["id"], u, [str(uuid4())])
    assert mid["status"] == "registered"   # LRW not done yet → no premature advance
    final = _run_lrw(svc, s["id"], u)
    assert final["status"] == "all_submitted"
    assert len(fake_db.rows("mock_exam_reviews")) == 1


def test_all_submitted_creates_review_once(fake_db, svc, wf):
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, s["id"], u)
    svc.record_speaking(s["id"], u, [str(uuid4())])
    # idempotent: reconciling again doesn't create a second review
    svc._reconcile_terminal(s["id"])
    assert len(fake_db.rows("mock_exam_reviews")) == 1


def test_attach_attempt_sets_both_directions(fake_db, svc):
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    attempt_id = str(uuid4())
    fake_db.seed("reading_test_attempts", {"id": attempt_id, "sitting_id": None})
    svc.attach_attempt(s["id"], u, "reading", attempt_id)
    sitting = svc.get_sitting(s["id"])
    assert sitting["reading_attempt_id"] == attempt_id
    assert fake_db.rows("reading_test_attempts")[0]["sitting_id"] == s["id"]


def test_is_sealed_tracks_flag(fake_db, svc):
    _seed_exam(fake_db)
    s = svc.create_sitting(uuid4(), "MOCK-TEST-A")
    assert svc.is_sealed(s["id"]) is True
    fake_db.rows("mock_exam_sittings")[0]["sealed"] = False
    assert svc.is_sealed(s["id"]) is False
    assert svc.is_sealed(uuid4()) is False   # missing sitting → not sealed


# ── review workflow: claim / final bands / release ────────────────────


def _sitting_at_all_submitted(fake_db, svc):
    _seed_exam(fake_db)
    u = uuid4()
    s = svc.create_sitting(u, "MOCK-TEST-A")
    _run_lrw(svc, s["id"], u)
    svc.record_speaking(s["id"], u, [str(uuid4())])
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


def test_compute_overall_pure():
    from services import mock_review_workflow as wf
    assert wf.compute_overall(
        {"listening": 8.0, "reading": 8.0, "writing": 7.0, "speaking": 7.0}) == 7.5
    # mean 7.25 → IELTS rounds .25 UP → 7.5
    assert wf.compute_overall(
        {"listening": 7.0, "reading": 7.0, "writing": 7.0, "speaking": 8.0}) == 7.5


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
