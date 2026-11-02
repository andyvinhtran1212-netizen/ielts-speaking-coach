"""CLASSARCHIVE-0030 T004/T006 on the learner Writing routes (routers/writing_student.py).

- T004: every row of ``GET /my-assignments`` and the ``GET /my-assignments/{id}``
  detail carry ``class_archived`` and ``archive_finish_allowed``. Both are false
  unless the give's class is archived (``is_active = false AND archived_at IS
  NOT NULL``); a legacy inactive class and an individual give carry false/false.
- T006: Variant A — a give of an archived class takes no start, draft save,
  editor claim, admission or submission (409 ``cohort_archived``, learner
  message). D3 — a timed give started before ``archived_at`` and not yet
  submitted may still save, submit and auto-submit. Legacy classes are never
  gated. A failed class read never opens a gate and never reports false.
  No database guard covers learner drafts or submits, so these gates are the
  only enforcement.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import writing_student as writing
from services import class_archive_service as svc
from services import core_admission as admission

_REAL_TIMER = writing._compute_timer_state

STUDENT = {"id": "11111111-0000-0000-0000-000000000001",
           "user_id": "22222222-0000-0000-0000-000000000002"}
ACTIVE, LEGACY, ARCHIVED = (
    "c0000000-0000-0000-0000-00000000000a",
    "c0000000-0000-0000-0000-00000000000b",
    "c0000000-0000-0000-0000-00000000000c",
)
ARCHIVED_AT = "2026-11-02T12:00:00+00:00"
BEFORE = "2026-11-02T11:55:00+00:00"   # started 5 minutes before the archive
AFTER = "2026-11-02T12:05:00+00:00"
LEASE = "2999-01-01T00:00:00+00:00"
DB_ERROR = 'relation "cohorts" column secret_col contains private-db-value'
LEARNER_409 = {"code": svc.COHORT_ARCHIVED_CODE, "message": svc.COHORT_ARCHIVED_LEARNER_MESSAGE}

COHORTS = {
    ACTIVE: {"id": ACTIVE, "is_active": True, "archived_at": None},
    LEGACY: {"id": LEGACY, "is_active": False, "archived_at": None},
    ARCHIVED: {"id": ARCHIVED, "is_active": False, "archived_at": ARCHIVED_AT},
}


# ── Fake PostgREST client (filters eq / in_ for the tables used here) ────

class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.mode, self.payload = db, table, [], "select", None

    def select(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def order(self, *_a, **_k): return self
    def gt(self, *_a): return self
    def is_(self, *_a): return self

    def eq(self, col, val):
        self.filters.append((col, {str(val)}))
        return self

    def in_(self, col, vals):
        self.filters.append((col, {str(v) for v in vals}))
        return self

    def update(self, payload):
        self.mode, self.payload = "update", payload
        return self

    def upsert(self, payload, **_k):
        self.mode, self.payload = "upsert", payload
        return self

    def execute(self):
        self.db.calls.append((self.table, self.mode, self.payload))
        failure = self.db.fail.get(self.table)
        if failure:
            raise failure
        if self.mode == "upsert":
            return SimpleNamespace(data=[dict(self.payload)])
        rows = [r for r in self.db.tables.get(self.table, [])
                if all(str(r.get(col)) in vals for col, vals in self.filters)]
        if self.mode == "update":
            for row in rows:
                row.update(self.payload)
        return SimpleNamespace(data=[dict(r) for r in rows])


class _Db:
    def __init__(self, gives):
        self.tables = {"writing_assignments": gives, "cohorts": list(COHORTS.values()),
                       "writing_drafts": []}
        self.calls: list = []
        self.fail: dict = {}

    def table(self, name): return _Q(self, name)

    def writes(self):
        return [(t, m) for t, m, _ in self.calls if m != "select"]


def _give(cohort_id, *, timed=False, started_at=None, status=None, submitted_at=None, **over):
    return {
        "id": str(uuid4()), "student_id": STUDENT["id"], "cohort_id": cohort_id,
        "status": status or ("in_progress" if started_at else "pending"),
        "deadline": None, "instructions": None, "created_at": "2026-11-01T00:00:00+00:00",
        "submitted_at": submitted_at, "delivered_at": None, "essay_id": None,
        "prompt_id": None, "assigned_by": None, "assignment_group_id": None, "name": "Task 2",
        "allow_soft_check": False, "analysis_level": None, "grading_tier": None,
        "is_timed": timed, "time_limit_minutes": 40 if timed else None,
        "started_at": started_at, "auto_submitted": False,
        "renderer_affinity": "next", "renderer_affinity_claimed_at": BEFORE,
        "renderer_affinity_expires_at": LEASE,
        "student_submit_request_id": None, "student_submit_text_sha256": None,
        "writing_prompts": {"id": "p1", "title": "T", "prompt_text": "Discuss.",
                            "task_type": "task2", "difficulty": None, "prompt_image_url": None},
        **over,
    }


def _make(monkeypatch, gives):
    db = _Db(gives)
    monkeypatch.setattr(writing, "supabase_admin", db)
    monkeypatch.setattr(writing, "attach_signed_image_urls", lambda *_a, **_k: None)
    # Timer expiry is not what these tests measure; the D3 auto-submit test
    # sets it explicitly.
    monkeypatch.setattr(writing, "_compute_timer_state", lambda _a: {"is_expired": False})
    monkeypatch.setattr(writing, "get_user_access_code_permissions", lambda _u: ["writing"])
    monkeypatch.setattr(writing, "has_writing_permission", lambda _p: True)
    app = FastAPI()
    app.include_router(writing.router)
    app.dependency_overrides[writing.get_current_student] = lambda: dict(STUDENT)
    app.dependency_overrides[writing.require_writing_permission] = lambda: dict(STUDENT)
    return db, TestClient(app)


def _url(give, tail=""):
    return f"/api/writing/my-assignments/{give['id']}{tail}"


# ── T004: list and detail fields ─────────────────────────────────────────

GIVES = {
    "active": (lambda: _give(ACTIVE), False, False),
    "legacy": (lambda: _give(LEGACY, timed=True, started_at=BEFORE), False, False),
    "individual": (lambda: _give(None), False, False),
    "archived_untimed": (lambda: _give(ARCHIVED, started_at=BEFORE), True, False),
    "archived_timed_before": (lambda: _give(ARCHIVED, timed=True, started_at=BEFORE), True, True),
    "archived_timed_after": (lambda: _give(ARCHIVED, timed=True, started_at=AFTER), True, False),
    "archived_timed_unstarted": (lambda: _give(ARCHIVED, timed=True), True, False),
    "archived_timed_submitted": (lambda: _give(ARCHIVED, timed=True, started_at=BEFORE,
                                               status="submitted", submitted_at=AFTER), True, False),
}


def test_every_list_row_carries_both_fields_from_one_batched_class_read(monkeypatch):
    built = {name: make() for name, (make, _a, _f) in GIVES.items()}
    db, client = _make(monkeypatch, list(built.values()))
    response = client.get("/api/writing/my-assignments")
    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()["assignments"]}
    for name, (_make_give, archived, finish) in GIVES.items():
        row = rows[built[name]["id"]]
        assert (row["class_archived"], row["archive_finish_allowed"]) == (archived, finish), name
    assert [c for c in db.calls if c[0] == "cohorts"] == [("cohorts", "select", None)]


def test_a_list_without_class_gives_reads_no_class(monkeypatch):
    db, client = _make(monkeypatch, [_give(None)])
    row = client.get("/api/writing/my-assignments").json()["assignments"][0]
    assert (row["class_archived"], row["archive_finish_allowed"]) == (False, False)
    assert not [c for c in db.calls if c[0] == "cohorts"]


def test_a_failed_class_read_fails_the_list_without_db_text(monkeypatch):
    db, client = _make(monkeypatch, [_give(ARCHIVED)])
    db.fail["cohorts"] = RuntimeError(DB_ERROR)
    response = client.get("/api/writing/my-assignments")
    assert response.status_code == 500
    assert "private-db-value" not in response.text and "secret_col" not in response.text


@pytest.mark.parametrize("name", list(GIVES))
def test_detail_carries_the_same_fields(monkeypatch, name):
    make, archived, finish = GIVES[name]
    give = make()
    _db, client = _make(monkeypatch, [give])
    response = client.get(_url(give))
    assert response.status_code == 200
    body = response.json()["assignment"]
    assert (body["class_archived"], body["archive_finish_allowed"]) == (archived, finish)


def test_detail_of_an_archived_give_stays_readable_with_its_draft(monkeypatch):
    give = _give(ARCHIVED, started_at=BEFORE)
    db, client = _make(monkeypatch, [give])
    db.tables["writing_drafts"] = [{"assignment_id": give["id"], "draft_text": "my draft",
                                    "word_count": 2, "updated_at": BEFORE}]
    response = client.get(_url(give))
    assert response.status_code == 200 and response.json()["draft"]["draft_text"] == "my draft"
    assert db.writes() == []


def test_a_failed_class_read_fails_the_detail_without_db_text(monkeypatch):
    give = _give(ARCHIVED)
    db, client = _make(monkeypatch, [give])
    db.fail["cohorts"] = RuntimeError(DB_ERROR)
    response = client.get(_url(give))
    assert response.status_code == 500 and "private-db-value" not in response.text


# ── T006: draft save ─────────────────────────────────────────────────────

def _draft(client, give):
    return client.patch(_url(give, "/draft"), json={"draft_text": "new text"})


@pytest.mark.parametrize("name", ["archived_untimed", "archived_timed_after"])
def test_draft_save_in_an_archived_class_is_409_and_writes_nothing(monkeypatch, name):
    give = GIVES[name][0]()
    db, client = _make(monkeypatch, [give])
    response = _draft(client, give)
    assert response.status_code == 409 and response.json()["detail"] == LEARNER_409
    assert db.writes() == []


@pytest.mark.parametrize("name", ["active", "legacy", "individual", "archived_timed_before"])
def test_draft_save_is_allowed_for_active_legacy_individual_and_d3(monkeypatch, name):
    give = GIVES[name][0]()
    db, client = _make(monkeypatch, [give])
    response = _draft(client, give)
    assert response.status_code == 200, response.text
    assert ("writing_drafts", "upsert") in db.writes()


def test_a_failed_class_read_never_opens_the_draft_gate(monkeypatch):
    give = _give(ARCHIVED, started_at=BEFORE)
    db, client = _make(monkeypatch, [give])
    db.fail["cohorts"] = RuntimeError(DB_ERROR)
    response = _draft(client, give)
    assert response.status_code == 500 and "private-db-value" not in response.text
    assert db.writes() == []


# ── T006: submit and auto-submit ─────────────────────────────────────────

class _PassedGate(Exception):
    pass


def _submit_harness(monkeypatch, give, *, replay=None):
    db, client = _make(monkeypatch, [give])
    monkeypatch.setattr(writing, "_replay_committed_submission", lambda *_a, **_k: replay)

    # The step right after the archive gate: reaching it proves the gate let
    # the submission through without running the grading pipeline here.
    def passed(_assignment):
        raise HTTPException(418, "passed-archive-gate")
    monkeypatch.setattr(writing, "_require_writing_renderer_lease", passed)
    return db, client


def _submit(client, give):
    return client.post(_url(give, "/submit"), json={"essay_text": "x " * 260,
                                                    "request_id": str(uuid4())})


@pytest.mark.parametrize("name", ["archived_untimed", "archived_timed_after", "archived_timed_unstarted"])
def test_submit_in_an_archived_class_is_409(monkeypatch, name):
    give = GIVES[name][0]()
    db, client = _submit_harness(monkeypatch, give)
    response = _submit(client, give)
    assert response.status_code == 409 and response.json()["detail"] == LEARNER_409
    assert db.writes() == []


@pytest.mark.parametrize("name", ["active", "legacy", "individual", "archived_timed_before"])
def test_submit_passes_the_gate_for_active_legacy_individual_and_d3(monkeypatch, name):
    give = GIVES[name][0]()
    _db, client = _submit_harness(monkeypatch, give)
    assert _submit(client, give).status_code == 418


def test_d3_auto_submit_after_the_timer_expired_passes_the_gate(monkeypatch):
    give = _give(ARCHIVED, timed=True, started_at=BEFORE)
    _db, client = _submit_harness(monkeypatch, give)
    monkeypatch.setattr(writing, "_compute_timer_state", lambda _a: {"is_expired": True})
    assert _submit(client, give).status_code == 418


def test_a_committed_submission_replays_its_receipt_after_the_archive(monkeypatch):
    give = _give(ARCHIVED, started_at=BEFORE)
    receipt = {"assignment_id": give["id"], "replayed": True}
    db, client = _submit_harness(monkeypatch, give, replay=receipt)
    response = _submit(client, give)
    assert response.status_code == 200 and response.json() == receipt
    assert not [c for c in db.calls if c[0] == "cohorts"]


# ── T006: start and editor claim ─────────────────────────────────────────

@pytest.mark.parametrize("name", ["archived_untimed", "archived_timed_unstarted", "archived_timed_after"])
def test_start_in_an_archived_class_is_409_and_stamps_nothing(monkeypatch, name):
    give = GIVES[name][0]()
    db, client = _make(monkeypatch, [give])
    response = client.post(_url(give, "/start"))
    assert response.status_code == 409 and response.json()["detail"] == LEARNER_409
    assert db.writes() == []


@pytest.mark.parametrize("name", ["active", "legacy", "individual", "archived_timed_before"])
def test_start_is_allowed_for_active_legacy_individual_and_a_running_d3_give(monkeypatch, name):
    give = GIVES[name][0]()
    _db, client = _make(monkeypatch, [give])
    response = client.post(_url(give, "/start"))
    assert response.status_code == 200, response.text
    assert response.json()["started"] is True


def test_editor_claim_in_an_archived_class_is_409_and_never_calls_the_rpc(monkeypatch):
    give = _give(ARCHIVED, started_at=BEFORE)
    db, client = _make(monkeypatch, [give])
    rpc = []
    db.rpc = lambda *a: rpc.append(a)
    response = client.post(_url(give, "/renderer-affinity"), json={"renderer_affinity": "next"})
    assert response.status_code == 409 and response.json()["detail"] == LEARNER_409
    assert rpc == []


@pytest.mark.parametrize("name", ["legacy", "archived_timed_before"])
def test_editor_claim_is_allowed_for_legacy_and_d3(monkeypatch, name):
    give = GIVES[name][0]()
    db, client = _make(monkeypatch, [give])
    db.rpc = lambda *_a: SimpleNamespace(execute=lambda: SimpleNamespace(
        data=[{"renderer_affinity": "next"}]))
    response = client.post(_url(give, "/renderer-affinity"), json={"renderer_affinity": "next"})
    assert response.status_code == 200, response.text


# ── T006: native admissions ──────────────────────────────────────────────

def _admission_result(give):
    return admission.WritingAdmissionResult.model_validate({
        "command": {"command_id": str(uuid4()), "episode_id": str(uuid4()),
                    "activity_epoch_id": str(uuid4()), "phase": "bound", "generation": 0,
                    "execute_before": "2026-11-02T13:00:00+00:00"},
        "assignment": {"id": give["id"], "status": "in_progress", "is_timed": True,
                       "time_limit_minutes": 40, "started_at": BEFORE, "auto_submitted": False}})


ADMISSIONS = {
    "prepare": ("prepare_writing_admission", "/admissions",
                lambda: {"protocol": "admission-v1", "launch_nonce": str(uuid4())}),
    "execute": ("execute_writing_admission", f"/admissions/{uuid4()}/execute",
                lambda: {"protocol": "admission-v1", "generation": 0}),
    "baseline": ("enter_writing_baseline", "/baseline-entry",
                 lambda: {"protocol": "baseline-v1", "launch_nonce": str(uuid4()),
                          "allow_start": True}),
}


@pytest.mark.parametrize("kind", list(ADMISSIONS))
@pytest.mark.parametrize("name", ["archived_untimed", "archived_timed_unstarted", "archived_timed_after"])
def test_admission_in_an_archived_class_is_409_before_the_rpc(monkeypatch, kind, name):
    fn, tail, body = ADMISSIONS[kind]
    give = GIVES[name][0]()
    _db, client = _make(monkeypatch, [give])
    monkeypatch.setattr(admission.settings, "CORE_ADMISSION_LEDGER_ENABLED", True)
    rpc = AsyncMock()
    monkeypatch.setattr(admission, fn, rpc)
    response = client.post(_url(give, tail), json=body())
    assert response.status_code == 409 and response.json()["detail"] == LEARNER_409
    assert response.headers["cache-control"] == "private, no-store"
    rpc.assert_not_called()


@pytest.mark.parametrize("kind", ["prepare", "execute"])
@pytest.mark.parametrize("name", ["active", "legacy", "individual", "archived_timed_before"])
def test_admission_reaches_the_rpc_for_active_legacy_individual_and_d3(monkeypatch, kind, name):
    fn, tail, body = ADMISSIONS[kind]
    give = GIVES[name][0]()
    _db, client = _make(monkeypatch, [give])
    monkeypatch.setattr(writing, "_compute_timer_state", _REAL_TIMER)   # response model
    monkeypatch.setattr(admission.settings, "CORE_ADMISSION_LEDGER_ENABLED", True)
    rpc = AsyncMock(return_value=_admission_result(give))
    monkeypatch.setattr(admission, fn, rpc)
    response = client.post(_url(give, tail), json=body())
    assert response.status_code == 200, response.text
    rpc.assert_awaited_once()


def test_admission_class_read_failure_is_generic_and_never_calls_the_rpc(monkeypatch):
    give = _give(ARCHIVED)
    db, client = _make(monkeypatch, [give])
    db.fail["cohorts"] = RuntimeError(DB_ERROR)
    monkeypatch.setattr(admission.settings, "CORE_ADMISSION_LEDGER_ENABLED", True)
    rpc = AsyncMock()
    monkeypatch.setattr(admission, "prepare_writing_admission", rpc)
    fn, tail, body = ADMISSIONS["prepare"]
    response = client.post(_url(give, tail), json=body())
    assert response.status_code == 500 and "private-db-value" not in response.text
    assert response.headers["cache-control"] == "private, no-store"
    rpc.assert_not_called()


def test_a_disabled_admission_still_answers_404_before_the_class_gate(monkeypatch):
    give = _give(ARCHIVED)
    db, client = _make(monkeypatch, [give])
    monkeypatch.setattr(admission.settings, "CORE_ADMISSION_LEDGER_ENABLED", False)
    monkeypatch.setattr(admission.settings, "CORE_ADMISSION_RECOVERY_ENABLED", False)
    fn, tail, body = ADMISSIONS["prepare"]
    response = client.post(_url(give, tail), json=body())
    assert response.status_code == 404
    assert not [c for c in db.calls if c[0] == "cohorts"]


def test_unknown_admission_row_is_left_to_the_rpc(monkeypatch):
    give = _give(ARCHIVED)
    _db, client = _make(monkeypatch, [])
    monkeypatch.setattr(admission.settings, "CORE_ADMISSION_LEDGER_ENABLED", True)
    monkeypatch.setattr(admission, "prepare_writing_admission",
                        AsyncMock(side_effect=admission.AdmissionNotFound()))
    fn, tail, body = ADMISSIONS["prepare"]
    assert client.post(_url(give, tail), json=body()).status_code == 404
