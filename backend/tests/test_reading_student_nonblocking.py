"""PC-J436 (PC-J408 G2): student Reading exam routes off the event loop.

boot / start / submit / PATCH answers used to run every Supabase round-trip
synchronously on the single uvicorn event loop, so one class doing a Reading
exam (500 ms autosave per question) stalled every other request. The sync body
of each route now runs in a worker thread.

Before, a write route's sync body ran in one piece on the loop, so one learner's
start/submit/autosave never overlapped. They now share a per-learner lock (PC-J423
pattern), and these tests pin that the overlapping pairs behave exactly as the
serialised ones did.

The fake DB returns DEEP COPIES and makes each statement atomic, like PostgREST;
it emulates mig 088's one-active-attempt unique index and mig 224's answer
trigger. No network I/O.
"""

from __future__ import annotations

import asyncio
import contextlib
import copy
import dataclasses
import threading
import time
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from config import settings
from routers import reading_student as rs
from services import core_attempt_observation as obs
from services import mock_correction_service, mock_exam_service, mock_paper_policy
from services.class_assignment_service import DeadlinePassedError, ItemNotFoundError

U1 = "00000000-0000-0000-0000-0000000000a1"
U2 = "00000000-0000-0000-0000-0000000000a2"
TOKENS = {"Bearer u1": U1, "Bearer u2": U2}
T_UUID = "11111111-1111-1111-1111-111111111111"
T_ID = "TST-J436"
P_UUID = "22222222-2222-2222-2222-222222222222"
SITTING = "33333333-3333-3333-3333-333333333333"
ANON = "anon-capability-j436"
ANSWERS = {1: "TRUE", 2: "cat", 3: "A"}


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.isoformat()


# ── fake PostgREST ────────────────────────────────────────────────────


class _Res:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _UniqueViolation(Exception):
    code = "23505"


class _FakeDB:
    def __init__(self):
        self.tables = defaultdict(list)
        self.lock = threading.Lock()
        self.delay = 0.0
        self.hooks = []          # (predicate(query), callback()) after a statement applies
        self.always_unique_violation = False
        self.statements = []     # (table, op) in apply order

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):  # policy RPCs are patched at the service seam
        raise AssertionError(f"unexpected rpc {name}")

    def rows(self, name):
        with self.lock:
            return copy.deepcopy(self.tables[name])


def _parse(value):
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    return value


class _Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.op, self.payload, self.count = "select", None, None
        self.filters, self.order_by, self.limit_n = [], None, None

    def select(self, _cols="*", count=None):
        self.count = count
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def upsert(self, payload, on_conflict=None):
        self.op, self.payload, self.on_conflict = "upsert", payload, on_conflict
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) == str(val))
        return self

    def gt(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and _parse(r.get(col)) > _parse(val))
        return self

    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        self.filters.append(lambda r: str(r.get(col)) in vals)
        return self

    def order(self, col, desc=False):
        self.order_by = (col, desc)
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def _match(self, row):
        return all(f(row) for f in self.filters)

    def execute(self):
        time.sleep(self.db.delay)
        with self.db.lock:
            result = self._apply()
            self.db.statements.append((self.name, self.op))
        for predicate, callback in list(self.db.hooks):
            if predicate(self):
                callback()
        return result

    def _apply(self):
        table = self.db.tables[self.name]
        if self.op == "select":
            rows = [r for r in table if self._match(r)]
            if self.order_by:
                col, desc = self.order_by
                rows.sort(key=lambda r: (r.get(col) is None, r.get(col)), reverse=desc)
            if self.limit_n is not None:
                rows = rows[: self.limit_n]
            return _Res(copy.deepcopy(rows), len(rows) if self.count else None)
        if self.op == "update":
            changed = []
            for row in table:
                if self._match(row):
                    row.update(copy.deepcopy(self.payload))
                    changed.append(copy.deepcopy(row))
            return _Res(changed)
        if self.op == "insert":
            row = copy.deepcopy(self.payload)
            if self.name == "reading_test_attempts":
                active = [r for r in table if r["status"] == "in_progress"
                          and r.get("user_id") == row.get("user_id") and r["test_id"] == row["test_id"]]
                if self.db.always_unique_violation or (row["status"] == "in_progress" and active):
                    raise _UniqueViolation('duplicate key value violates unique constraint "uniq_reading_test_attempts_active"')
            table.append(row)
            return _Res([copy.deepcopy(row)])
        if self.op == "upsert":
            row = copy.deepcopy(self.payload)
            if self.name == "reading_attempt_answers":  # mig 224 trigger
                parent = next((r for r in self.db.tables["reading_test_attempts"] if r["id"] == row["attempt_id"]), None)
                if (parent is None or parent["status"] != "in_progress"
                        or _parse(parent["resume_expires_at"]) <= _now()):
                    raise Exception("active_player_expired")
            keys = (self.on_conflict or "").split(",")
            for existing in table:
                if all(str(existing.get(k)) == str(row.get(k)) for k in keys):
                    existing.update(row)
                    return _Res([copy.deepcopy(existing)])
            table.append(row)
            return _Res([copy.deepcopy(row)])
        raise AssertionError(self.op)


# ── app + seams ───────────────────────────────────────────────────────


class _Env:
    def __init__(self, monkeypatch):
        self.db = _FakeDB()
        self.decision = {"attempt_purpose": "practice"}
        self.sealed = set()
        self.class_error = None
        self.capture = None
        self.observations = []
        self.slow = defaultdict(float)   # helper name -> seconds of blocking work
        self.mp = monkeypatch
        self.seed()

        async def fake_user(authorization):
            if authorization not in TOKENS:
                raise HTTPException(401, "Invalid token")
            return {"id": TOKENS[authorization], "email": "x@x"}

        def published_test(test_id):
            time.sleep(self.slow["published"])
            rows = [r for r in self.db.rows("reading_tests") if r["test_id"] == test_id]
            if not rows:
                raise HTTPException(404, "Reading test not found or not published")
            return rows[0]

        def detail(test_id, password=None, user_id=None, class_item=None, sitting_id=None):
            time.sleep(self.slow["detail"])
            test = published_test(test_id)
            return {**test, "locked": False, "passages": []}

        real_owned = rs._fetch_attempt_owned

        def owned(attempt_id, user, anon_id):
            time.sleep(self.slow["owned"])
            return real_owned(attempt_id, user, anon_id)

        def class_item(db, user_id, item, *, skill, test_id):
            assert (skill, test_id) == ("reading", T_UUID)
            if self.class_error:
                raise self.class_error

        def admit(db, skill, paper_id, user_id, sitting_id, *, affinity_protocol=None):
            return {"attempt_id": "44444444-4444-4444-4444-444444444444", "status": "in_progress",
                    "mock_sitting_id": str(sitting_id), "acquired_existing": False}

        async def capture_emit(current, error):
            self.observations.append((dataclasses.replace(current), type(error).__name__ if error else None))

        mp = monkeypatch
        mp.setattr(rs, "supabase_admin", self.db)
        mp.setattr(rs, "get_supabase_user", fake_user)
        mp.setattr(rs, "_fetch_published_test", published_test)
        mp.setattr(rs, "_build_reading_test_detail", detail)
        mp.setattr(rs, "_fetch_attempt_owned", owned)
        mp.setattr(rs, "_assert_exam_content_allowed", lambda *a, **k: dict(self.decision))
        mp.setattr(rs, "validate_class_item_for_test", class_item)
        mp.setattr(mock_paper_policy, "admit_mock_attempt", admit)
        mp.setattr(mock_paper_policy, "guard_owned_attempt", lambda *a, **k: None)
        mp.setattr(mock_paper_policy, "load_marking_snapshot", lambda *a, **k: None)
        mp.setattr(mock_paper_policy, "frozen_answer_key", lambda *a, **k: None)
        mp.setattr(mock_correction_service, "apply_scoring_overrides", lambda skill, test_id, key, **k: key)
        mp.setattr(mock_correction_service, "capture_required_envelope", lambda *a, **k: copy.deepcopy(self.capture))
        mp.setattr(mock_correction_service, "finalize_item_observations", lambda *a, **k: True)
        mp.setattr(mock_correction_service, "record_answer_commit", lambda *a, **k: True)
        mp.setattr(mock_exam_service, "is_sealed", lambda sitting_id: str(sitting_id) in self.sealed)
        mp.setattr(obs, "_emit_safely", capture_emit)
        mp.setattr(settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", True)

    def seed(self):
        t = self.db.tables
        t["reading_tests"].append({"id": T_UUID, "test_id": T_ID, "title": "J436", "module": "academic",
                                   "time_limit_minutes": 60, "status": "published"})
        t["reading_passages"].append({"id": P_UUID, "test_id": T_UUID, "library": "l3_test", "passage_order": 1})
        for q_num, (qtype, answer) in {1: ("true_false_not_given", "TRUE"), 2: ("short_answer", "cat"),
                                       3: ("mcq_single", "A")}.items():
            t["reading_questions"].append({"q_num": q_num, "question_type": qtype, "prompt": "x", "payload": {},
                                           "answer": {"answer": answer}, "skill_tag": "detail",
                                           "explanation": None, "passage_id": P_UUID})

    def attempt(self, user_id=U1, *, status="in_progress", anon_id=None, sitting_id=None, expired=False, **extra):
        started = _now() - timedelta(minutes=5)
        row = {"id": str(uuid.uuid4()), "test_id": T_UUID, "user_id": user_id, "anon_id": anon_id,
               "attempt_purpose": "practice", "status": status, "answers": [], "sitting_id": sitting_id,
               "started_at": _iso(started),
               "resume_expires_at": _iso(_now() - timedelta(minutes=1) if expired else started + timedelta(hours=24)),
               **extra}
        self.db.tables["reading_test_attempts"].append(row)
        return row

    def answer(self, attempt_id, q_num, value):
        self.db.tables["reading_attempt_answers"].append(
            {"attempt_id": attempt_id, "q_num": q_num, "user_answer": value, "answered_at": _iso(_now())})

    def app(self):
        app = FastAPI()
        app.include_router(rs.router)

        @app.get("/ping")
        async def ping():
            return {"ok": True}

        return app


@pytest.fixture
def env(monkeypatch):
    return _Env(monkeypatch)


def _run(env, scenario):
    async def main():
        transport = httpx.ASGITransport(app=env.app())
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            return await scenario(client)
    return asyncio.run(main())


def _call(client, kind, *, auth="Bearer u1", attempt_id=None, json=None, params=None, anon=None):
    headers = {}
    if auth:
        headers["Authorization"] = auth
    if anon:
        headers["X-Reading-Anon"] = anon
    if kind == "boot":
        return client.get(f"/api/reading/test/{T_ID}/boot", headers=headers, params=params)
    if kind == "start":
        return client.post(f"/api/reading/test/{T_ID}/attempts", headers=headers, json=json, params=params)
    if kind == "submit":
        return client.post(f"/api/reading/test/attempts/{attempt_id}/submit", headers=headers,
                           json=json if json is not None else {"answers": []})
    if kind == "save":
        return client.patch(f"/api/reading/test/attempts/{attempt_id}/answers", headers=headers,
                            json=json if json is not None else {"q_num": 2, "user_answer": "cat"})
    raise AssertionError(kind)


async def _heartbeat(stop):
    """Largest gap between 10 ms ticks of a light coroutine while work runs."""
    worst, last = 0.0, time.perf_counter()
    while not stop.is_set():
        await asyncio.sleep(0.01)
        now = time.perf_counter()
        worst, last = max(worst, now - last), now
    return worst


# ── (a) two learners in parallel, the loop stays responsive ──────────


@pytest.mark.parametrize("kind,slow", [
    ("boot", "detail"), ("start", "published"), ("submit", "owned"), ("save", "owned"),
])
def test_blocking_work_runs_off_the_event_loop(env, kind, slow):
    env.slow[slow] = 0.5
    a1, a2 = env.attempt(U1)["id"], env.attempt(U2)["id"]
    ids = {"Bearer u1": a1, "Bearer u2": a2}

    async def scenario(client):
        stop = asyncio.Event()
        beat = asyncio.create_task(_heartbeat(stop))
        await asyncio.sleep(0.02)
        started = time.perf_counter()
        responses = await asyncio.gather(*[
            _call(client, kind, auth=auth, attempt_id=ids[auth]) for auth in ("Bearer u1", "Bearer u2")
        ])
        elapsed = time.perf_counter() - started
        ping_started = time.perf_counter()
        ping = await client.get("/ping")
        ping_s = time.perf_counter() - ping_started
        stop.set()
        return responses, elapsed, await beat, ping, ping_s

    responses, elapsed, worst_gap, ping, ping_s = _run(env, scenario)
    assert [r.status_code for r in responses] == [200, 200], [r.text for r in responses]
    assert ping.status_code == 200 and ping_s < 0.2
    assert elapsed < 0.85, f"{kind}: two learners took {elapsed:.2f}s — serialised on the loop"
    assert worst_gap < 0.2, f"{kind}: event loop blocked {worst_gap:.2f}s"


# ── (b) response / status / message unchanged ────────────────────────


def test_boot_with_and_without_in_progress(env):
    async def scenario(client):
        empty = await _call(client, "boot")
        row = env.attempt(U1)
        env.answer(row["id"], 1, "TRUE")
        resumed = await _call(client, "boot")
        return empty, resumed, row

    empty, resumed, row = _run(env, scenario)
    assert empty.status_code == 200
    assert empty.json()["in_progress"] is None and empty.json()["test"]["test_id"] == T_ID
    body = resumed.json()["in_progress"]
    assert resumed.status_code == 200
    assert body["attempt_id"] == row["id"] and body["status"] == "in_progress" and body["test_id"] == T_ID
    assert [(a["q_num"], a["user_answer"]) for a in body["answers"]] == [(1, "TRUE")]
    assert body["review_flags"] == [] and body["time_limit_minutes"] == 60


def test_boot_unknown_test_404(env):
    async def scenario(client):
        return await client.get("/api/reading/test/NOPE/boot", headers={"Authorization": "Bearer u1"})

    res = _run(env, scenario)
    assert (res.status_code, res.json()["detail"]) == (404, "Reading test not found or not published")


def test_routes_require_auth_401(env):
    async def scenario(client):
        return await asyncio.gather(_call(client, "boot", auth="Bearer bad"),
                                    _call(client, "start", auth="Bearer bad"),
                                    _call(client, "submit", auth=None, attempt_id="x"),
                                    _call(client, "save", auth=None, attempt_id="x"))

    statuses = [r.status_code for r in _run(env, scenario)]
    assert statuses == [401, 401, 401, 401]


def test_start_practice_abandons_prior_and_returns_receipt(env):
    prior = env.attempt(U1)

    async def scenario(client):
        return await _call(client, "start", json={"renderer_affinity_protocol": "claim-v1"})

    res = _run(env, scenario)
    body = res.json()
    assert res.status_code == 200
    assert body["status"] == "in_progress" and body["test_id"] == T_ID and body["time_limit_minutes"] == 60
    assert body["renderer_affinity"] is None and body["review_flags"] == []
    rows = {r["id"]: r for r in env.db.rows("reading_test_attempts")}
    assert rows[prior["id"]]["status"] == "abandoned"
    assert rows[body["attempt_id"]]["status"] == "in_progress"
    assert rows[body["attempt_id"]]["renderer_affinity"] is None
    # Abandon is written before the insert (unchanged write order).
    writes = [s for s in env.db.statements if s[1] != "select"]
    assert writes == [("reading_test_attempts", "update"), ("reading_test_attempts", "insert")]


def test_start_class_item_stamps_item(env):
    async def scenario(client):
        return await _call(client, "start", params={"class_item": "item-1"})

    res = _run(env, scenario)
    assert res.status_code == 200 and res.json()["renderer_affinity"] == "legacy"
    row = next(r for r in env.db.rows("reading_test_attempts") if r["id"] == res.json()["attempt_id"])
    assert row["class_assignment_item_id"] == "item-1"


@pytest.mark.parametrize("error,status,detail", [
    (DeadlinePassedError("Đã quá hạn nộp bài."), 409, "Đã quá hạn nộp bài."),
    (ItemNotFoundError("Không tìm thấy bài giao."), 400, "Không tìm thấy bài giao."),
])
def test_start_class_item_errors(env, error, status, detail):
    env.class_error = error

    async def scenario(client):
        return await _call(client, "start", params={"class_item": "item-1"})

    res = _run(env, scenario)
    assert (res.status_code, res.json()["detail"]) == (status, detail)
    assert env.db.rows("reading_test_attempts") == []


def test_start_mock_delivery_admits(env):
    env.decision = {"attempt_purpose": "mock_delivery", "mock_sitting_id": SITTING}

    async def scenario(client):
        return await _call(client, "start", json={"purpose": "mock_delivery", "mock_sitting_id": SITTING})

    res = _run(env, scenario)
    assert res.status_code == 200
    assert res.json() == {"attempt_id": "44444444-4444-4444-4444-444444444444", "status": "in_progress",
                          "mock_sitting_id": SITTING, "acquired_existing": False,
                          "flag_protocol": "question-cas-v1", "review_flags": [], "test_id": T_ID}


def test_start_retry_budget_exhausted_503(env):
    env.db.always_unique_violation = True

    async def scenario(client):
        return await _call(client, "start")

    res = _run(env, scenario)
    assert (res.status_code, res.json()["detail"]) == (503, "Concurrent start contention — please retry.")
    inserts = [s for s in env.db.statements if s == ("reading_test_attempts", "insert")]
    assert len(inserts) == 0  # failed inserts raise before they are recorded
    abandons = [s for s in env.db.statements if s == ("reading_test_attempts", "update")]
    assert len(abandons) == rs._START_RETRY_MAX


def test_submit_grades_and_persists(env):
    row = env.attempt(U1)
    env.answer(row["id"], 1, "TRUE")

    async def scenario(client):
        return await _call(client, "submit", attempt_id=row["id"],
                           json={"answers": [{"q_num": 2, "user_answer": "cat"}]})

    res = _run(env, scenario)
    body = res.json()
    assert res.status_code == 200, res.text
    assert body["attempt_id"] == row["id"] and body["score"] == 2 and body["max_score"] == 3
    assert body["performance_finalized"] is True
    stored = env.db.rows("reading_test_attempts")[0]
    assert stored["status"] == "submitted" and stored["score"] == 2
    assert stored["answers"] == [{"q_num": 1, "user_answer": "TRUE"}, {"q_num": 2, "user_answer": "cat"}]


def test_submit_sealed_mock_returns_receipt(env):
    row = env.attempt(U1, sitting_id=SITTING)
    env.sealed.add(SITTING)
    env.capture = {"capture_required": True}

    async def scenario(client):
        return await _call(client, "submit", attempt_id=row["id"])

    res = _run(env, scenario)
    assert res.status_code == 200
    assert res.json() == {"received": True, "sitting_id": SITTING, "sealed": True, "capture_required": True}
    assert env.db.rows("reading_test_attempts")[0]["status"] == "submitted"


def test_submit_already_submitted_422_or_sealed_receipt(env):
    plain = env.attempt(U1, status="submitted")
    sealed = env.attempt(U2, status="submitted", sitting_id=SITTING, grading_details=[])
    env.sealed.add(SITTING)

    async def scenario(client):
        return (await _call(client, "submit", attempt_id=plain["id"]),
                await _call(client, "submit", auth="Bearer u2", attempt_id=sealed["id"]))

    first, second = _run(env, scenario)
    assert (first.status_code, first.json()["detail"]) == (422, "Attempt đã submit rồi — không thể submit lại.")
    assert (second.status_code, second.json()) == (200, {"received": True, "sitting_id": SITTING, "sealed": True})


def test_submit_conflicting_change_409(env):
    row = env.attempt(U1)

    def abandon_behind_submit():
        with env.db.lock:
            env.db.tables["reading_test_attempts"][0]["status"] = "abandoned"

    env.db.hooks.append((lambda q: q.name == "reading_attempt_answers" and q.op == "select",
                         abandon_behind_submit))

    async def scenario(client):
        return await _call(client, "submit", attempt_id=row["id"])

    res = _run(env, scenario)
    assert (res.status_code, res.json()["detail"]) == (409, "Attempt đã thay đổi; hãy tải lại trạng thái.")


def test_submit_and_save_other_owner_403(env):
    row = env.attempt(U2)

    async def scenario(client):
        return (await _call(client, "submit", attempt_id=row["id"]),
                await _call(client, "save", attempt_id=row["id"]))

    for res in _run(env, scenario):
        assert (res.status_code, res.json()["detail"]) == (403, "Attempt belongs to another user")


def test_save_ack_and_count(env):
    row = env.attempt(U1)
    env.answer(row["id"], 1, "TRUE")

    async def scenario(client):
        return await _call(client, "save", attempt_id=row["id"], json={"q_num": 2, "user_answer": "cat"})

    res = _run(env, scenario)
    assert res.status_code == 200
    assert res.json() == {"attempt_id": row["id"], "q_num": 2, "answered": 2, "performance_event_recorded": True}
    writes = [s for s in env.db.statements if s[1] != "select"]
    assert writes == [("reading_attempt_answers", "upsert")]


def test_save_rejected_states(env):
    submitted = env.attempt(U1, status="submitted")
    expired = env.attempt(U2, expired=True)

    async def scenario(client):
        return (await _call(client, "save", attempt_id=submitted["id"]),
                await _call(client, "save", auth="Bearer u2", attempt_id=expired["id"]))

    first, second = _run(env, scenario)
    assert (first.status_code, first.json()["detail"]) == (422, "Attempt đã submit hoặc abandoned — không thể edit.")
    assert second.status_code == 410
    assert second.json()["detail"].startswith("Phiên làm bài đã hết thời gian tiếp tục.")


def test_save_trigger_expiry_410(env):
    row = env.attempt(U1)

    def expire_behind_save():
        with env.db.lock:
            env.db.tables["reading_test_attempts"][0]["status"] = "submitted"

    env.db.hooks.append((lambda q: q.name == "reading_test_attempts" and q.op == "select", expire_behind_save))

    async def scenario(client):
        return await _call(client, "save", attempt_id=row["id"])

    res = _run(env, scenario)
    assert (res.status_code, res.json()["detail"]) == (410, "Attempt đã hết thời gian tiếp tục.")


def test_anonymous_share_attempt_save_and_submit(env):
    row = env.attempt(None, anon_id=ANON)

    async def scenario(client):
        saved = await _call(client, "save", auth=None, anon=ANON, attempt_id=row["id"])
        wrong = await _call(client, "save", auth=None, anon="other", attempt_id=row["id"])
        submitted = await _call(client, "submit", auth=None, anon=ANON, attempt_id=row["id"])
        return saved, wrong, submitted

    saved, wrong, submitted = _run(env, scenario)
    assert saved.status_code == 200 and saved.json()["answered"] == 1
    assert (wrong.status_code, wrong.json()["detail"]) == (403, "Attempt belongs to another session")
    assert submitted.status_code == 200 and submitted.json()["score"] == 1


# ── (c) observation unchanged ─────────────────────────────────────────


def _fields(observation):
    return {k: getattr(observation, k) for k in
            ("surface", "operation", "admitted", "attempt_id", "started", "renderer", "outcome", "invalid",
             "abandoned_exams", "abandoned_exams_incomplete")}


def test_observation_for_start_submit_save(env):
    prior = env.attempt(U1, renderer_affinity="next")

    async def scenario(client):
        start = (await _call(client, "start", json={"renderer_affinity_protocol": "claim-v1"})).json()
        save = await _call(client, "save", attempt_id=start["attempt_id"], json={"q_num": 1, "user_answer": "TRUE"})
        submit = await _call(client, "submit", attempt_id=start["attempt_id"])
        return start, save, submit

    start, save, submit = _run(env, scenario)
    assert save.status_code == 200 and submit.status_code == 200
    new_id = uuid.UUID(start["attempt_id"])
    assert [(_fields(o), e) for o, e in env.observations] == [
        ({"surface": "reading_exam", "operation": "start", "admitted": True, "attempt_id": new_id,
          "started": True, "renderer": None, "outcome": None, "invalid": False,
          "abandoned_exams": {uuid.UUID(prior["id"]): "next"}, "abandoned_exams_incomplete": False}, None),
        ({"surface": "reading_exam", "operation": "save", "admitted": True, "attempt_id": new_id,
          "started": False, "renderer": None, "outcome": None, "invalid": False,
          "abandoned_exams": {}, "abandoned_exams_incomplete": False}, None),
        ({"surface": "reading_exam", "operation": "submit", "admitted": True, "attempt_id": new_id,
          "started": False, "renderer": None, "outcome": "success", "invalid": False,
          "abandoned_exams": {}, "abandoned_exams_incomplete": False}, None),
    ]
    assert env.observations[2][0].exam_expected_qnums == [1, 2, 3]


def test_observation_for_mock_admission_and_failure(env):
    env.decision = {"attempt_purpose": "mock_delivery", "mock_sitting_id": SITTING}
    submitted = env.attempt(U1, status="submitted")

    async def scenario(client):
        return (await _call(client, "start", json={"mock_sitting_id": SITTING}),
                await _call(client, "submit", attempt_id=submitted["id"]))

    start, rejected = _run(env, scenario)
    assert start.status_code == 200 and rejected.status_code == 422
    (mock_obs, mock_err), (sub_obs, sub_err) = env.observations
    assert (mock_obs.admitted, mock_obs.started, mock_obs.attempt_id, mock_err) == (
        True, True, uuid.UUID("44444444-4444-4444-4444-444444444444"), None)
    assert (sub_obs.attempt_id, sub_obs.admitted, sub_obs.outcome, sub_err) == (
        uuid.UUID(submitted["id"]), True, None, "HTTPException")


def test_concurrent_learners_keep_their_own_observation(env):
    env.slow["published"] = 0.2

    async def scenario(client):
        return await asyncio.gather(_call(client, "start"), _call(client, "start", auth="Bearer u2"))

    responses = _run(env, scenario)
    assert {uuid.UUID(r.json()["attempt_id"]) for r in responses} == {o.attempt_id for o, _ in env.observations}
    by_attempt = {r["id"]: r["user_id"] for r in env.db.rows("reading_test_attempts")}
    assert sorted(by_attempt.values()) == [U1, U2]


# ── SAME-ENTITY-SERIAL (G4 checklist) ─────────────────────────────────


def _pause_until(event, timeout=0.6):
    return lambda: event.wait(timeout)


def test_two_starts_same_learner_leave_exactly_one_active(env):
    env.db.delay = 0.05
    second_abandoned = threading.Event()
    calls = {"n": 0}

    def count_abandon():
        calls["n"] += 1
        if calls["n"] == 2:
            second_abandoned.set()

    # Pause the first start between abandon and insert until the second start
    # has also abandoned: the unlocked race that forces the 23505 retry path.
    env.db.hooks.append((lambda q: q.name == "reading_test_attempts" and q.op == "update", count_abandon))
    env.db.hooks.append((lambda q: q.name == "reading_test_attempts" and q.op == "update" and calls["n"] == 1,
                         _pause_until(second_abandoned)))

    async def scenario(client):
        return await asyncio.gather(_call(client, "start"), _call(client, "start"))

    responses = _run(env, scenario)
    assert [r.status_code for r in responses] == [200, 200]
    rows = env.db.rows("reading_test_attempts")
    assert len(rows) == 2 and sorted(r["status"] for r in rows) == ["abandoned", "in_progress"]
    # Serialised like before: the second start never needed the 23505 retry.
    assert [s for s in env.db.statements if s[0] == "reading_test_attempts" and s[1] != "select"] == [
        ("reading_test_attempts", "update"), ("reading_test_attempts", "insert"),
        ("reading_test_attempts", "update"), ("reading_test_attempts", "insert"),
    ]
    winner = next(r for r in rows if r["status"] == "in_progress")
    assert winner["id"] in {r.json()["attempt_id"] for r in responses}


def test_two_submits_same_attempt_exactly_one_grades(env):
    env.db.delay = 0.02
    row = env.attempt(U1)
    second_read = threading.Event()
    reads = {"n": 0}

    def on_read():
        reads["n"] += 1
        if reads["n"] >= 2:
            second_read.set()

    env.db.hooks.append((lambda q: q.name == "reading_test_attempts" and q.op == "select", on_read))
    env.db.hooks.append((lambda q: q.name == "reading_test_attempts" and q.op == "select" and reads["n"] == 1,
                         _pause_until(second_read)))

    async def scenario(client):
        return await asyncio.gather(
            _call(client, "submit", attempt_id=row["id"], json={"answers": [{"q_num": 1, "user_answer": "TRUE"}]}),
            _call(client, "submit", attempt_id=row["id"], json={"answers": [{"q_num": 2, "user_answer": "cat"}]}),
        )

    first, second = _run(env, scenario)
    statuses = sorted([first.status_code, second.status_code])
    # Same as serialised: the later submit sees the committed grade (422), never
    # the 409 a stale concurrent read would produce.
    assert statuses == [200, 422], [first.text, second.text]
    loser = first if first.status_code == 422 else second
    assert loser.json()["detail"] == "Attempt đã submit rồi — không thể submit lại."
    winner = first if first.status_code == 200 else second
    stored = env.db.rows("reading_test_attempts")[0]
    assert stored["status"] == "submitted" and stored["score"] == winner.json()["score"] == 1
    assert len([s for s in env.db.statements if s == ("reading_test_attempts", "update")]) == 1


def test_submit_and_autosave_never_drop_an_acknowledged_answer(env):
    env.db.delay = 0.02
    row = env.attempt(U1)
    env.answer(row["id"], 1, "TRUE")
    saved, answers_read = threading.Event(), threading.Event()
    attempt_reads = {"n": 0}

    def count_attempt_read():
        attempt_reads["n"] += 1

    def is_answers_read(q):
        return q.name == "reading_attempt_answers" and q.op == "select" and not q.count

    env.db.hooks.append((lambda q: q.name == "reading_attempt_answers" and q.op == "upsert", saved.set))
    env.db.hooks.append((is_answers_read, answers_read.set))
    env.db.hooks.append((lambda q: q.name == "reading_test_attempts" and q.op == "select", count_attempt_read))
    # Unserialised interleaving: the save reads the attempt (in_progress), waits
    # until submit has read the persisted answers, then writes while submit is
    # held before its final UPDATE — acknowledged, yet never graded.
    env.db.hooks.append((lambda q: q.name == "reading_test_attempts" and q.op == "select" and attempt_reads["n"] == 2,
                         _pause_until(answers_read)))
    env.db.hooks.append((is_answers_read, _pause_until(saved)))

    async def scenario(client):
        submit = asyncio.create_task(_call(client, "submit", attempt_id=row["id"]))
        await asyncio.sleep(0.05)
        save = asyncio.create_task(_call(client, "save", attempt_id=row["id"], json={"q_num": 2, "user_answer": "cat"}))
        return await submit, await save

    submit, save = _run(env, scenario)
    assert submit.status_code == 200
    stored = env.db.rows("reading_test_attempts")[0]
    graded = {a["q_num"]: a["user_answer"] for a in stored["answers"]}
    if save.status_code == 200:
        assert graded.get(2) == "cat", "autosave acknowledged but missing from the graded answers"
    else:
        assert save.status_code in (410, 422)
    # Serialised order: submit committed first, the later save is refused.
    assert (save.status_code, save.json()["detail"]) == (422, "Attempt đã submit hoặc abandoned — không thể edit.")
    assert graded == {1: "TRUE"}


def test_different_learners_are_not_serialised(env):
    env.slow["owned"] = 0.4
    a1, a2 = env.attempt(U1)["id"], env.attempt(U2)["id"]

    async def scenario(client):
        started = time.perf_counter()
        responses = await asyncio.gather(_call(client, "save", attempt_id=a1),
                                         _call(client, "save", auth="Bearer u2", attempt_id=a2))
        return responses, time.perf_counter() - started

    responses, elapsed = _run(env, scenario)
    assert [r.status_code for r in responses] == [200, 200]
    assert elapsed < 0.7


def test_cancelled_request_keeps_learner_lock_until_thread_ends(env):
    env.slow["owned"] = 0.3
    row = env.attempt(U1)

    async def scenario(client):
        first = asyncio.create_task(_call(client, "save", attempt_id=row["id"]))
        await asyncio.sleep(0.1)
        first.cancel()
        started = time.perf_counter()
        second = await _call(client, "save", attempt_id=row["id"], json={"q_num": 3, "user_answer": "A"})
        waited = time.perf_counter() - started
        with contextlib.suppress(asyncio.CancelledError):
            await first
        return second, waited

    second, waited = _run(env, scenario)
    assert second.status_code == 200
    # The cancelled save's thread still ran to completion before the next one.
    assert waited >= 0.15
    assert {a["q_num"] for a in env.db.rows("reading_attempt_answers")} == {2, 3}


# ── Thread safety of the shared singleton (PC-J428 step 0, Reading shapes) ──


def test_singleton_reading_builders_stay_isolated_across_threads(monkeypatch):
    """The real ``database.supabase_admin`` with only PostgREST's transport
    replaced (no network): 8 threads x 250 overlapping requests in the exact
    builder shapes these four routes use. Each response must match its own
    request (path, method, filters, Prefer, body) and shared headers stay put."""
    import json
    from concurrent.futures import ThreadPoolExecutor

    import database

    client = database.supabase_admin
    threads, per_thread = 8, 250
    barrier = threading.Barrier(threads)
    seen, seen_lock = set(), threading.Lock()

    def handle(request):
        time.sleep(0.0005)
        marker = request.headers["x-j436-marker"]
        body = json.loads(request.content) if request.content else None
        with seen_lock:
            assert marker not in seen
            seen.add(marker)
        return httpx.Response(200, json=[{
            "marker": marker, "path": request.url.path, "method": request.method,
            "query": sorted(request.url.params.multi_items()), "prefer": request.headers.get("prefer"),
            "body": body, "auth": request.headers.get("authorization"),
        }], headers={"content-range": "0-0/1"})

    with httpx.Client(transport=httpx.MockTransport(handle), http1=True, http2=False) as transport:
        monkeypatch.setattr(client, "_postgrest", client._init_postgrest_client(
            rest_url=str(client.rest_url), headers=client.options.headers, schema=client.options.schema,
            timeout=client.options.postgrest_client_timeout, http_client=transport,
        ))
        original_headers = dict(client.postgrest.headers)
        auth = original_headers.get("Authorization") or original_headers.get("authorization")

        def build(worker, index, marker):
            kind = index % 6
            if kind == 0:   # _fetch_attempt_owned / _fetch_in_progress_payload
                b = (client.table("reading_test_attempts").select("*").eq("id", marker)
                     .eq("status", "in_progress").order("started_at", desc=True).limit(1))
                expected = ("GET", "/reading_test_attempts", None)
            elif kind == 1:  # PATCH count
                b = client.table("reading_attempt_answers").select("q_num", count="exact").eq("attempt_id", marker)
                expected = ("GET", "/reading_attempt_answers", None)
            elif kind == 2:  # submit compare-and-set
                body = {"status": "submitted", "score": index, "answers": [{"q_num": worker, "user_answer": marker}]}
                b = (client.table("reading_test_attempts").update(body).eq("id", marker)
                     .eq("status", "in_progress").gt("resume_expires_at", f"2026-10-31T00:00:{worker:02d}+00:00"))
                expected = ("PATCH", "/reading_test_attempts", body)
            elif kind == 3:  # autosave
                body = {"attempt_id": marker, "q_num": index, "user_answer": marker}
                b = client.table("reading_attempt_answers").upsert(body, on_conflict="attempt_id,q_num")
                expected = ("POST", "/reading_attempt_answers", body)
            elif kind == 4:  # start insert
                body = {"id": marker, "test_id": f"t{worker}", "status": "in_progress", "answers": []}
                b = client.table("reading_test_attempts").insert(body)
                expected = ("POST", "/reading_test_attempts", body)
            else:            # policy RPCs
                body = {"p_skill": "reading", "p_attempt": {"id": marker}, "p_purpose": "submit"}
                b = client.rpc("fn_guard_owned_mock_attempt", body)
                expected = ("POST", "/rpc/fn_guard_owned_mock_attempt", body)
            if kind == 0 or kind == 1:
                b = b.in_("passage_id", [marker, f"w{worker}"])
            b.request.headers["X-J436-Marker"] = marker
            return b, expected, kind

        def run(worker):
            barrier.wait(timeout=10)
            for index in range(per_thread):
                marker = f"{worker}-{index}"
                b, (method, path, body), kind = build(worker, index, marker)
                prefer = b.request.headers.get("Prefer")
                query = [list(item) for item in sorted(b.request.params.multi_items())]
                row = b.execute().data
                row = row[0] if isinstance(row, list) else row
                assert row["marker"] == marker
                assert (row["method"], row["path"].rsplit("/rest/v1", 1)[-1], row["body"]) == (method, path, body)
                assert row["query"] == query and row["prefer"] == prefer and row["auth"] == auth
                if kind in (0, 1):
                    assert ["id", f"eq.{marker}"] in query or ["attempt_id", f"eq.{marker}"] in query

        with ThreadPoolExecutor(max_workers=threads) as pool:
            list(pool.map(run, range(threads)))
        assert len(seen) == threads * per_thread
        assert dict(client.postgrest.headers) == original_headers
