"""COURSEACCESS-0055 G04-T07 (plan 5.6 Speaking): credits on the grading route.

The whole endpoint runs with fake DB/STT/grader/Azure and a fake credit RPC
layer (``credits._rpc``) that mimics fn_credit_reserve's cluster seats (the
real RPC is tested against PostgreSQL in test_migration_384). Every test
counts the paid calls: a refused, failed or replayed hold must reach neither
Whisper nor the grader (FR-017, C1 b).
"""

from __future__ import annotations

import asyncio
import sys
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import grading, sessions  # noqa: E402
from services import credits, runtime_flags  # noqa: E402
from services.speaking_submission import SubmissionReplay  # noqa: E402
from test_admin_speaking_sessions import _DB  # noqa: E402

COURSE = "11111111-1111-1111-1111-111111111111"
COHORT = "22222222-2222-2222-2222-222222222222"


class FakeCredits:
    """fn_credit_reserve / commit / release with cluster seats (plan 5.3)."""

    def __init__(self, *, balance=10, force=None, fail=False):
        self.balance = balance
        self.force = force          # status the next reserve returns
        self.fail = fail
        self.calls: list[tuple[str, dict]] = []
        self.res: dict[str, dict] = {}      # reservation id → row
        self.keys: dict[str, str] = {}      # request key → reservation id
        self.seats: dict[str, list[str]] = {}   # "<session>:p<n>" → question ids in seat order
        self.covered: dict[str, tuple[str, str]] = {}   # request key → (resource id, cover hold id)
        self.ledger: list[int] = []         # -1 reserve, +1 release

    def key_state(self, key):
        """What grading._request_key_state reads (reservation or cover row)."""
        if key in self.keys:
            row = self.res[self.keys[key]]
            return {"resource_type": row["type"], "resource_id": row["asked"], "status": row["status"]}
        if key in self.covered:
            asked, cover = self.covered[key]
            return {"resource_type": "speaking_cluster", "resource_id": asked,
                    "status": self.res[cover]["status"], "covered": True}
        return None

    def names(self, name):
        return [p for n, p in self.calls if n == name]

    async def rpc(self, name, params):
        self.calls.append((name, dict(params)))
        if self.fail:
            raise credits.CreditUnavailable(name)
        if name == "fn_credit_reserve":
            return self._reserve(params)
        row = self.res[params["p_reservation_id"]]
        if name == "fn_credit_commit":
            if row["status"] == "committed":
                return {"status": "already_committed"}
            if row["status"] != "open":
                return {"status": "not_open", "reservation_status": row["status"]}
            row["status"] = "committed"
            return {"status": "committed"}
        if name == "fn_credit_release":
            if row["status"] == "released":
                return {"status": "already_released"}
            if row["status"] != "open":
                return {"status": "not_open"}
            row["status"] = "released"
            self.balance += 1
            self.ledger.append(+1)
            return {"status": "released"}
        raise AssertionError(name)

    def _new(self, params, resource_id):
        if self.balance < params["p_cost"]:
            return {"status": "insufficient_credits", "balance": self.balance}
        self.balance -= params["p_cost"]
        self.ledger.append(-1)
        rid = str(uuid4())
        self.res[rid] = {"status": "open", "resource_id": resource_id, "user_id": params.get("p_user_id"),
                         "type": params["p_resource_type"], "asked": params["p_resource_id"]}
        self.keys[params["p_request_key"]] = rid
        return {"status": "reserved", "reservation_id": rid, "balance_after": self.balance}

    def _reserve(self, params):
        if self.force:
            return {"status": self.force, "reservation_id": str(uuid4())}
        key = params["p_request_key"]
        old = self.keys.get(key)
        if old:
            row = self.res[old]
            if row["asked"] != params["p_resource_id"] or row["status"] in ("released", "expired"):
                return {"status": "request_key_conflict", "reservation_id": old}
            return {"status": "already_committed" if row["status"] == "committed" else "replay",
                    "reservation_id": old}
        if key in self.covered:
            asked, cover = self.covered[key]
            state = self.res[cover]["status"]
            if asked != params["p_resource_id"] or state not in ("open", "committed"):
                return {"status": "request_key_conflict", "reservation_id": cover}
            return {"status": "replay" if state == "open" else "already_committed", "reservation_id": cover}
        if params["p_resource_type"] == "speaking_response":
            return self._new(params, params["p_resource_id"])
        session, part, q = params["p_resource_id"].split(":")
        seats = self.seats.setdefault(f"{session}:{part}", [])
        if q not in seats:
            seats.append(q)
        cluster = f"{session}:{part}:c{seats.index(q) // params['p_cluster_size']}"
        live = [rid for rid, r in self.res.items()
                if r["resource_id"] == cluster and r["status"] in ("open", "committed")]
        if live:
            self.covered[key] = (params["p_resource_id"], live[0])
            return {"status": "covered", "reservation_id": live[0]}
        return self._new(params, cluster)


@pytest.fixture(autouse=True)
def _entitled(monkeypatch):
    monkeypatch.setattr(grading, "require_speaking_entitlement", lambda *_a: None)


@pytest.fixture
def world(monkeypatch):
    """flag + plan reads + fake RPC; returns a namespace the test tunes."""
    w = SimpleNamespace(flag=True, flag_error=False, class_entitled=False, converted=False,
                        legacy=(), fake=FakeCredits())
    monkeypatch.setattr(credits, "_metering_last", None)   # 3c9f9f24: no value read before

    def strict(key, default=False):
        assert key == "credit_metering"
        if w.flag_error:
            raise runtime_flags.FlagLookupError(key)
        return w.flag
    monkeypatch.setattr(credits.runtime_flags, "is_enabled_strict", strict)
    monkeypatch.setattr(credits, "fetch_class_item_cohort", lambda _item: COHORT)
    monkeypatch.setattr(credits, "fetch_cohort_course", lambda _c: COURSE)
    monkeypatch.setattr(credits, "fetch_ever_had_class_entitlement", lambda _u, _c: w.class_entitled)
    monkeypatch.setattr(credits, "fetch_cohort_converted", lambda _c: w.converted)
    monkeypatch.setattr(credits, "fetch_legacy_code_features", lambda _u: w.legacy)
    monkeypatch.setattr(credits, "_rpc", lambda name, params: w.fake.rpc(name, params))

    def fetch_reservation(rid):
        row = w.fake.res.get(rid)
        return row and {"user_id": row["user_id"], "resource_type": row["type"],
                        "resource_id": row["asked"], "status": row["status"]}
    monkeypatch.setattr(credits, "fetch_reservation", fetch_reservation)

    async def key_state(_user, key):
        return w.fake.key_state(key)
    monkeypatch.setattr(grading, "_request_key_state", key_state)
    return w


def _session(part, **extra):
    return {"id": str(uuid4()), "user_id": str(uuid4()), "part": part, "mode": "test_part",
            "status": "in_progress", "full_test_attempt_id": None, "renderer_affinity": "next",
            "resume_expires_at": "2099-01-01T00:00:00Z", "class_assignment_item_id": None,
            "sitting_id": None, **extra}


def _grade(monkeypatch, session, *, duration=None, grader_fails=False, stt_fails=False,
           submission_id=None, replay=False, save=None, question_id=None, on_stt=None):
    """Run the endpoint once for a new question of ``session`` (or ``question_id``)."""
    duration = duration or {1: 20.0, 2: 100.0, 3: 30.0}[session["part"]]
    question = {"id": question_id or str(uuid4()), "session_id": session["id"], "question_text": "Synthetic prompt"}
    db = _DB(sessions=[session], questions=[question])
    db.storage = MagicMock()
    monkeypatch.setattr(grading, "supabase_admin", db)
    monkeypatch.setattr(grading, "get_supabase_user", AsyncMock(return_value={"id": session["user_id"]}))

    async def execute(builder):
        return builder(db).execute()
    monkeypatch.setattr(grading, "aexecute", execute)
    monkeypatch.setattr(grading, "enforce_grading_rate_limit", lambda *args: None)
    monkeypatch.setattr(grading, "record_grading_attempt", lambda *args: None)
    monkeypatch.setattr(grading.ai_usage_logger, "log_whisper_async", AsyncMock())
    monkeypatch.setattr(grading, "_record_progress_mark", lambda *args: None)
    monkeypatch.setattr(grading, "_mark_session_error", lambda *args: None)
    monkeypatch.setattr(grading, "refuse_if_class_session_archived", AsyncMock(return_value=None))
    if replay:
        def check(*_a):
            raise SubmissionReplay("old-response")
        monkeypatch.setattr(grading, "check_submission", check)
    elif submission_id:
        monkeypatch.setattr(grading, "check_submission", lambda *_a: None)
    words = " ".join(["I usually spend my weekends reading books in the library near my house"] * 6)
    stt = AsyncMock(side_effect=RuntimeError("stt down")) if stt_fails else AsyncMock(return_value={
        "transcript": words, "duration_seconds": duration, "confidence": 0.9, "segments": []})
    if on_stt is not None:
        inner = stt

        async def stt(*a, **k):  # noqa: F811 — record the state at the first paid call
            on_stt()
            return await inner(*a, **k)
        stt = AsyncMock(side_effect=stt)
    monkeypatch.setattr(grading, "transcribe_from_bytes", stt)
    grade = AsyncMock(side_effect=RuntimeError("grader down")) if grader_fails else AsyncMock(return_value={
        "band_fc": 6.0, "band_lr": 7.0, "band_gra": 6.0, "band_p": 9.0, "overall_band": 7.0,
        "fc_feedback": "", "lr_feedback": "", "gra_feedback": "", "p_feedback": "",
        "grammar_issues": [], "vocabulary_issues": [], "strengths": [], "improvements": [],
    })
    monkeypatch.setattr(grading.claude_grader, "grade_response", grade)
    monkeypatch.setattr(grading, "get_judge", lambda: SimpleNamespace(judge=AsyncMock(return_value=None)))
    monkeypatch.setattr(grading, "get_grammar_check_service",
                        lambda: SimpleNamespace(check=AsyncMock(return_value=None)))
    monkeypatch.setattr(grading, "_assess_pronunciation_safe", AsyncMock(return_value=None))
    monkeypatch.setattr(grading, "save_response", save or (lambda _db, _row, **_k: str(uuid4())))
    out = SimpleNamespace(result=None, error=None, stt=stt, grade=grade)
    try:
        out.result = asyncio.run(grading.grade_response_endpoint(
            session["id"], question["id"], UploadFile(BytesIO(b"fake audio"), filename="a.wav"),
            submission_id=submission_id, expected_revision="rev" if submission_id else None))
    except HTTPException as exc:
        out.error = exc
    return out


def _statuses(fake):
    return [r["status"] for r in fake.res.values()]


# ── Not metered: no credit RPC at all (FR-018, FR-019) ──────────────────────

@pytest.mark.parametrize("case", ["flag_off", "legacy_class", "sitting", "legacy_code"])
def test_unmetered_paths_never_call_a_credit_rpc(monkeypatch, world, case):
    extra = {}
    if case == "flag_off":
        world.flag = False
    elif case == "legacy_class":
        extra["class_assignment_item_id"] = str(uuid4())
    elif case == "sitting":
        extra["sitting_id"] = str(uuid4())
        from services import mock_exam_service
        monkeypatch.setattr(mock_exam_service, "is_sealed", lambda _sid: False)
    else:
        world.legacy = ("speaking",)
    out = _grade(monkeypatch, _session(2, **extra))
    assert out.error is None and out.result["overall_band"] is not None
    assert world.fake.calls == []


# ── Class work (FR-019) ─────────────────────────────────────────────────────

def test_class_work_reserves_on_the_class_course(monkeypatch, world):
    world.class_entitled = True
    out = _grade(monkeypatch, _session(2, class_assignment_item_id=str(uuid4())))
    assert out.error is None
    (params,) = world.fake.names("fn_credit_reserve")
    assert params["p_course_ids"] == [COURSE] and params["p_kinds"] == ["class", "repractice"]
    assert len(world.fake.names("fn_credit_commit")) == 1


def test_class_work_out_of_credits_is_402_class_without_paid_calls(monkeypatch, world):
    world.converted = True
    world.fake.balance = 0
    out = _grade(monkeypatch, _session(2, class_assignment_item_id=str(uuid4())))
    assert out.error.status_code == 402
    assert out.error.detail["error_code"] == "insufficient_credits"
    assert out.error.detail["credit_source"] == "class"
    out.stt.assert_not_awaited()
    out.grade.assert_not_awaited()


# ── Course entitlement (FR-044 units) ───────────────────────────────────────

def test_part2_success_reserves_once_and_commits_once(monkeypatch, world):
    out = _grade(monkeypatch, _session(2), duration=120.0)
    assert out.error is None and "_stub" not in out.result
    (params,) = world.fake.names("fn_credit_reserve")
    assert params["p_resource_type"] == "speaking_response"
    assert params["p_feature"] == "speaking_grading" and params["p_cost"] == 1
    assert len(world.fake.names("fn_credit_commit")) == 1
    assert world.fake.names("fn_credit_release") == []
    assert world.fake.balance == 9


@pytest.mark.parametrize("part, duration", [(1, 20.0), (3, 30.0)])
def test_cluster_of_five_answers_spends_two_credits(monkeypatch, world, part, duration):
    session = _session(part)
    kinds = []
    for _ in range(5):
        before = len(world.fake.res)
        out = _grade(monkeypatch, session, duration=duration)
        assert out.error is None and "_stub" not in out.result   # graded at once (FR-034)
        kinds.append("reserved" if len(world.fake.res) > before else "covered")
    assert kinds == ["reserved", "covered", "covered", "reserved", "covered"]
    assert world.fake.balance == 8
    # Every saved answer commits: its own hold, or (covered) the cluster's cover
    # hold, which is already committed here. Still two credits in all.
    assert len(world.fake.names("fn_credit_commit")) == 5
    assert world.fake.names("fn_credit_release") == []


def test_two_answer_cluster_spends_one_credit(monkeypatch, world):
    session = _session(1)
    for _ in range(2):
        assert _grade(monkeypatch, session, duration=20.0).error is None
    assert world.fake.balance == 9


def test_failed_cluster_opener_is_released_and_the_next_answer_pays(monkeypatch, world):
    session = _session(1)
    first = _grade(monkeypatch, session, duration=20.0, grader_fails=True)
    assert first.result["_stub"] is True
    (release,) = world.fake.names("fn_credit_release")
    assert release["p_reason"] == "grader_failed"
    second = _grade(monkeypatch, session, duration=20.0)
    assert second.error is None
    assert _statuses(world.fake) == ["released", "committed"]
    assert world.fake.balance == 9


def test_stt_failure_releases_stt_failed(monkeypatch, world):
    out = _grade(monkeypatch, _session(2), stt_fails=True)
    assert out.error.status_code == 502
    (release,) = world.fake.names("fn_credit_release")
    assert release["p_reason"] == "stt_failed"
    out.grade.assert_not_awaited()


def test_too_short_answer_is_released(monkeypatch, world):
    out = _grade(monkeypatch, _session(1), duration=5.0)
    assert out.error.status_code == 422
    assert [p["p_reason"] for p in world.fake.names("fn_credit_release")] == ["request_failed"]
    assert world.fake.balance == 10


def test_save_failure_after_grading_is_released(monkeypatch, world):
    def broken(*_a, **_k):
        raise RuntimeError("db down")
    out = _grade(monkeypatch, _session(2), save=broken)
    assert out.error.status_code == 500
    assert [p["p_reason"] for p in world.fake.names("fn_credit_release")] == ["request_failed"]
    assert world.fake.names("fn_credit_commit") == []


def test_out_of_online_credits_is_402_online_without_paid_calls(monkeypatch, world):
    world.fake.balance = 0
    out = _grade(monkeypatch, _session(2))
    assert out.error.status_code == 402 and out.error.detail["credit_source"] == "online"
    out.stt.assert_not_awaited()
    out.grade.assert_not_awaited()


def test_rpc_error_is_503_without_paid_calls(monkeypatch, world):
    world.fake.fail = True
    out = _grade(monkeypatch, _session(2))
    assert out.error.status_code == 503 and out.error.detail["error_code"] == "credits_unavailable"
    out.stt.assert_not_awaited()
    out.grade.assert_not_awaited()


def test_flag_read_error_is_503_without_paid_calls(monkeypatch, world):
    world.flag_error = True
    out = _grade(monkeypatch, _session(2))
    assert out.error.status_code == 503 and out.error.detail["error_code"] == "credits_unavailable"
    assert world.fake.calls == []
    out.stt.assert_not_awaited()
    out.grade.assert_not_awaited()


def test_submission_replay_never_reserves(monkeypatch, world):
    out = _grade(monkeypatch, _session(2), submission_id=str(uuid4()), replay=True)
    assert out.result == {"response_id": "old-response", "_replayed": True,
                          "backend_release_sha": grading._backend_release_sha()}
    assert world.fake.calls == []
    out.stt.assert_not_awaited()


# ── The wrapper's non-reserved answers (C1 b) ───────────────────────────────

@pytest.mark.parametrize("status, code, error", [
    ("replay", 409, "grading_in_progress"),
    ("already_committed", 409, "already_graded"),
    ("request_key_conflict", 409, "request_key_conflict"),
    ("not_owner", 404, "not_owner"),
])
def test_non_reserved_answers_stop_before_any_paid_call(monkeypatch, world, status, code, error):
    world.fake.force = status
    out = _grade(monkeypatch, _session(2))
    assert out.error.status_code == code and out.error.detail["error_code"] == error
    out.stt.assert_not_awaited()
    out.grade.assert_not_awaited()
    assert world.fake.names("fn_credit_commit") == [] and world.fake.names("fn_credit_release") == []


def test_sa_scenario_resending_an_older_graded_submission_is_409(monkeypatch, world):
    session = _session(2)
    sid1, sid2, q1 = str(uuid4()), str(uuid4()), str(uuid4())
    assert _grade(monkeypatch, session, submission_id=sid1, question_id=q1).error is None
    assert _grade(monkeypatch, session, submission_id=sid2).error is None
    again = _grade(monkeypatch, session, submission_id=sid1, question_id=q1)   # same recording resent
    assert again.error.status_code == 409 and again.error.detail["error_code"] == "already_graded"
    again.stt.assert_not_awaited()
    again.grade.assert_not_awaited()
    assert world.fake.balance == 8


def test_commit_failure_keeps_the_grade(monkeypatch, world):
    real = world.fake.rpc

    async def rpc(name, params):
        if name == "fn_credit_commit":
            raise credits.CreditUnavailable(name)
        return await real(name, params)
    monkeypatch.setattr(credits, "_rpc", rpc)
    out = _grade(monkeypatch, _session(2))
    assert out.error is None and out.result["overall_band"] is not None
    assert world.fake.names("fn_credit_release") == []        # graded: never handed back as failed


# ── Admission by a course entitlement (create_session / re-check) ──────────

@pytest.mark.parametrize("flag, entitled, admitted", [
    (True, True, True), (True, False, False), (False, True, False)])
def test_course_entitlement_admits_speaking_only_with_the_flag(monkeypatch, flag, entitled, admitted):
    monkeypatch.setattr(sessions.activation_gate, "ensure_account_active", lambda _u: None)
    monkeypatch.setattr(sessions, "get_user_access_code_permissions_cached", lambda _u: [])
    monkeypatch.setattr(credits.runtime_flags, "is_enabled_strict", lambda _k, default=False: flag)
    from services import entitlements
    looked = []

    def has(_u, feature):
        looked.append(feature)
        return entitled
    monkeypatch.setattr(entitlements, "has_feature_entitlement", has)
    if admitted:
        sessions._require_permission("u1", "practice")
    else:
        with pytest.raises(HTTPException) as caught:
            sessions._require_permission("u1", "practice")
        assert caught.value.status_code == 403
    assert looked == (["speaking"] if flag else [])


def test_course_entitlement_lookup_error_does_not_admit(monkeypatch):
    monkeypatch.setattr(sessions.activation_gate, "ensure_account_active", lambda _u: None)
    monkeypatch.setattr(sessions, "get_user_access_code_permissions_cached", lambda _u: [])
    monkeypatch.setattr(credits.runtime_flags, "is_enabled_strict", lambda _k, default=False: True)
    from services import entitlements

    def boom(*_a):
        raise RuntimeError("db down")
    monkeypatch.setattr(entitlements, "has_feature_entitlement", boom)
    with pytest.raises(HTTPException) as caught:
        sessions._require_permission("u1", "test_part")
    assert caught.value.status_code == 403


def test_code_holder_never_reads_entitlements(monkeypatch):
    monkeypatch.setattr(sessions.activation_gate, "ensure_account_active", lambda _u: None)
    monkeypatch.setattr(sessions, "get_user_access_code_permissions_cached", lambda _u: ["all"])

    def never(*_a, **_k):
        raise AssertionError("must not be read")
    monkeypatch.setattr(credits.runtime_flags, "is_enabled_strict", never)
    sessions._require_permission("u1", "practice")


# ── Retrying a failed attempt (Codex P2 / CR on 68a027c0) ───────────────────

@pytest.mark.parametrize("part", [2, 1])
@pytest.mark.parametrize("failure", ["stt", "save"])
def test_retry_after_a_released_hold_is_graded_and_charged_once(monkeypatch, world, part, failure):
    """STT 502 (or a save failure) releases the hold; the page retries the same
    recording with the same submission_id. fn_credit_reserve answers
    request_key_conflict for a released key, so the route retries under
    '<submission_id>:a1' and the answer is graded, one credit in all."""
    session, question, sid = _session(part), str(uuid4()), str(uuid4())

    def broken_save(*_a, **_k):
        raise RuntimeError("db down")
    first = _grade(monkeypatch, session, question_id=question, submission_id=sid,
                   stt_fails=failure == "stt", save=broken_save if failure == "save" else None)
    assert first.error is not None and first.error.status_code in (500, 502)
    assert world.fake.balance == 10                     # handed back
    again = _grade(monkeypatch, session, question_id=question, submission_id=sid)
    assert again.error is None and "_stub" not in again.result
    keys = [p["p_request_key"] for p in world.fake.names("fn_credit_reserve")]
    assert keys == [sid, sid, f"{sid}:a1"]
    assert world.fake.balance == 9 and sum(world.fake.ledger) == -1
    assert sorted(_statuses(world.fake)) == ["committed", "released"]


def test_retry_key_used_for_another_question_stays_409(monkeypatch, world):
    session, sid = _session(2), str(uuid4())
    assert _grade(monkeypatch, session, submission_id=sid, stt_fails=True).error.status_code == 502
    other = _grade(monkeypatch, session, submission_id=sid)       # new question, same key
    assert other.error.status_code == 409 and other.error.detail["error_code"] == "request_key_conflict"
    other.stt.assert_not_awaited()
    assert world.fake.balance == 10


def test_retry_while_the_first_attempt_is_still_open_is_409_in_progress(monkeypatch, world):
    session, question, sid = _session(2), str(uuid4()), str(uuid4())
    world.fake.keys[sid] = rid = str(uuid4())
    world.fake.res[rid] = {"status": "open", "resource_id": f"{session['id']}:{question}",
                           "type": "speaking_response", "asked": f"{session['id']}:{question}"}
    out = _grade(monkeypatch, session, question_id=question, submission_id=sid)
    assert out.error.status_code == 409 and out.error.detail["error_code"] == "grading_in_progress"
    out.stt.assert_not_awaited()


# ── A cluster with a saved grade always costs one credit (Andy, 68a027c0) ───

def _open_cluster_opener(world, session, part=1):
    """The cluster opener is still grading: an open hold on c0 with one seat."""
    q = str(uuid4())
    result = world.fake._reserve({"p_request_key": str(uuid4()), "p_resource_type": "speaking_cluster",
                                  "p_resource_id": f"{session['id']}:p{part}:q{q}", "p_cost": 1,
                                  "p_cluster_size": 3})
    assert result["status"] == "reserved"
    return result["reservation_id"]


def test_covered_answer_commits_the_cover_before_whisper(monkeypatch, world):
    """Andy (f8170c8e): the cluster is settled before any paid call, so the
    opener failing later refunds nothing and nothing is graded for free."""
    session = _session(1)
    opener = _open_cluster_opener(world, session)
    seen = []
    out = _grade(monkeypatch, session, on_stt=lambda: seen.append(world.fake.res[opener]["status"]))
    assert out.error is None and "_stub" not in out.result
    assert seen == ["committed"]                      # committed before Whisper ran
    asyncio.run(credits.release_if_open(credits.CreditHold(reservation_id=opener), "grader_failed"))
    assert world.fake.res[opener]["status"] == "committed"
    assert world.fake.balance == 9 and sum(world.fake.ledger) == -1


def test_covered_answer_whose_cover_was_released_opens_the_cluster_itself(monkeypatch, world):
    session = _session(1)
    opener = _open_cluster_opener(world, session)
    asyncio.run(credits.release_if_open(credits.CreditHold(reservation_id=opener), "grader_failed"))
    sid = str(uuid4())
    out = _grade(monkeypatch, session, submission_id=sid)
    # The key is fresh, so the RPC sees an uncovered cluster and reserves at once.
    assert out.error is None and "_stub" not in out.result
    assert world.fake.balance == 9 and sum(world.fake.ledger) == -1
    assert sorted(_statuses(world.fake)) == ["committed", "released"]


def test_cover_released_between_reserve_and_commit_pays_with_a_new_hold(monkeypatch, world):
    """The opener releases after this answer got 'covered' but before it
    commits the cover: a ':c' hold opens the cluster, committed after the save."""
    session = _session(1)
    opener = _open_cluster_opener(world, session)
    real = world.fake.rpc

    async def rpc(name, params):
        result = await real(name, params)
        if name == "fn_credit_reserve" and result["status"] == "covered":
            await real("fn_credit_release", {"p_reservation_id": opener, "p_reason": "grader_failed"})
        return result
    monkeypatch.setattr(credits, "_rpc", rpc)
    sid = str(uuid4())
    out = _grade(monkeypatch, session, submission_id=sid)
    assert out.error is None and "_stub" not in out.result
    assert world.fake.names("fn_credit_reserve")[-1]["p_request_key"] == f"{sid}:c"
    assert sorted(_statuses(world.fake)) == ["committed", "released"]
    assert world.fake.balance == 9 and sum(world.fake.ledger) == -1


def test_cover_released_and_no_credit_left_is_402_before_whisper(monkeypatch, world):
    session = _session(1)
    world.fake.balance = 1
    opener = _open_cluster_opener(world, session)                  # balance 0
    real = world.fake.rpc

    async def rpc(name, params):
        result = await real(name, params)
        if name == "fn_credit_reserve" and result["status"] == "covered":
            await real("fn_credit_release", {"p_reservation_id": opener, "p_reason": "grader_failed"})
            world.fake.balance -= 1                                 # a valid charge takes it
            world.fake.ledger.append(-1)
        return result
    monkeypatch.setattr(credits, "_rpc", rpc)
    out = _grade(monkeypatch, session, submission_id=str(uuid4()))
    assert out.error.status_code == 402 and out.error.detail["error_code"] == "insufficient_credits"
    out.stt.assert_not_awaited()
    out.grade.assert_not_awaited()
    assert sum(world.fake.ledger) == -1                             # the other, valid charge only


def test_covered_answer_failing_after_the_cover_commit_refunds_nothing(monkeypatch, world):
    """Accepted cost of committing first: the cluster stays charged."""
    session = _session(1)
    opener = _open_cluster_opener(world, session)
    question, sid = str(uuid4()), str(uuid4())
    out = _grade(monkeypatch, session, stt_fails=True, question_id=question, submission_id=sid)
    assert out.error.status_code == 502
    assert world.fake.res[opener]["status"] == "committed"
    assert world.fake.names("fn_credit_release") == []
    assert world.fake.balance == 9
    # The page retries the same recording: the key was only 'covered' and its
    # cover is committed (already_graded), but nothing was saved, so it is a
    # re-grade under '<sid>:a1', still covered by the paid cluster.
    again = _grade(monkeypatch, session, question_id=question, submission_id=sid)
    assert again.error is None and "_stub" not in again.result
    assert [p["p_request_key"] for p in world.fake.names("fn_credit_reserve")][-2:] == [sid, f"{sid}:a1"]
    assert world.fake.balance == 9 and sum(world.fake.ledger) == -1
