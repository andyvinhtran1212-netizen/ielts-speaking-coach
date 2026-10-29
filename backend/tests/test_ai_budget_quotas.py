"""AIBUDGET-0033 T005 / FR-006: paid-AI quotas and flags fail closed.

The existing grading, TTS and Listening gist quotas keep their configured
values, but:

  * a count lookup error refuses the paid call (`budget_unavailable`) instead
    of counting 0;
  * a cap of zero or less refuses it (`config_invalid`) instead of "no cap";
  * either answers the FR-010 503 `ai_budget_exhausted` (refuse-before-accept:
    `work_saved: false`, learner-facing reason `paused`) before any provider
    call or quota row;
  * `runtime_flags.is_enabled(on_error=...)` lets a paid-AI gate close on a
    lookup error, while callers that omit it keep the fail-open default.

Offline: every provider and database is a stub.
"""

from __future__ import annotations

import ast
import io
import logging
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from config import settings
from routers import listening
from routers import tts as tts_module
from services import rate_limit, runtime_flags
from services.ai_budget import AIBudgetRefused

BACKEND = Path(__file__).resolve().parent.parent
USER = {"id": "learner-1", "email": "l@example.test"}
P2 = "Tính năng AI đang tạm dừng."


def _assert_fr010(detail: dict) -> None:
    assert detail == {
        "error_code": "ai_budget_exhausted",
        "reason": "paused",
        "work_saved": False,
        "resource": {},
        "message": P2,
    }


class _CountQuery:
    """A PostgREST builder whose ``execute`` fails or returns ``count``."""

    def __init__(self, *, count=0, fail=False):
        self.count, self.fail, self.tables = count, fail, []

    def table(self, name):
        self.tables.append(name)
        return self

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a):
        return self

    def gte(self, *_a):
        return self

    def execute(self):
        if self.fail:
            raise RuntimeError("count store down")
        return SimpleNamespace(count=self.count, data=[])


# ── Configured values are kept ────────────────────────────────────────────────

@pytest.mark.parametrize("name,value", [
    ("MAX_GRADINGS_PER_USER_PER_DAY", 200),
    ("TTS_DAILY_LIMIT_PER_USER", 200),
    ("TTS_IP_MAX_PER_MINUTE", 60),
    ("LISTENING_GIST_DAILY_LIMIT_PER_USER", 60),
    ("LISTENING_GIST_MAX_PER_MINUTE", 6),
])
def test_configured_quota_defaults_are_unchanged(name, value):
    assert type(settings).model_fields[name].default == value


# ── Shared helpers ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value", [0, -1, -200, None, "60", True, 1.5])
def test_require_paid_ai_cap_refuses_anything_but_a_positive_int(value):
    with pytest.raises(rate_limit.PaidAIQuotaRefused) as error:
        rate_limit.require_paid_ai_cap(value, quota="Q_VAR", feature="f")
    assert error.value.status_code == 503
    assert isinstance(error.value.refusal, AIBudgetRefused)
    assert error.value.refusal.reason == "config_invalid"
    assert error.value.refusal.detail == "Q_VAR"
    _assert_fr010(error.value.detail)


def test_require_paid_ai_cap_returns_a_positive_cap():
    assert rate_limit.require_paid_ai_cap(1, quota="Q", feature="f") == 1
    assert rate_limit.require_paid_ai_cap(200, quota="Q", feature="f") == 200


@pytest.mark.parametrize("count", [None, -1, "3", True, 2.0])
def test_a_missing_or_malformed_count_is_a_lookup_failure_not_zero(count):
    with pytest.raises(rate_limit.PaidAIQuotaRefused) as error:
        rate_limit.counted_rows(SimpleNamespace(count=count), quota="Q", feature="f")
    assert error.value.refusal.reason == "budget_unavailable"


def test_refusal_log_names_reason_feature_and_quota_but_no_user(caplog):
    caplog.set_level(logging.WARNING, logger="services.rate_limit")
    rate_limit.refuse_paid_ai("budget_unavailable", feature="question_tts",
                              quota="TTS_DAILY_LIMIT_PER_USER")
    (record,) = [r for r in caplog.records if "[ai_budget]" in r.getMessage()]
    assert record.getMessage() == (
        "[ai_budget] decision=refuse feature=question_tts "
        "reason=budget_unavailable quota=TTS_DAILY_LIMIT_PER_USER"
    )


def test_refusal_passes_the_5xx_sanitizer_unchanged():
    from services.errors import safe_detail
    exc = rate_limit.refuse_paid_ai("config_invalid", feature="f", quota="Q")
    assert safe_detail(exc.status_code, exc.detail) == exc.detail


# ── Grading (MAX_GRADINGS_PER_USER_PER_DAY) ──────────────────────────────────

def test_grading_count_error_refuses(monkeypatch):
    monkeypatch.setattr(rate_limit, "supabase_admin", _CountQuery(fail=True))
    with pytest.raises(rate_limit.PaidAIQuotaRefused) as error:
        rate_limit.enforce_grading_rate_limit("u1", 200)
    assert error.value.refusal.reason == "budget_unavailable"
    assert error.value.refusal.detail == "MAX_GRADINGS_PER_USER_PER_DAY"
    assert error.value.feature == "speaking_grading"


@pytest.mark.parametrize("cap", [0, -1])
def test_grading_cap_at_or_below_zero_is_config_invalid(monkeypatch, cap):
    db = _CountQuery(count=0)
    monkeypatch.setattr(rate_limit, "supabase_admin", db)
    with pytest.raises(rate_limit.PaidAIQuotaRefused) as error:
        rate_limit.enforce_grading_rate_limit("u1", cap)
    assert error.value.refusal.reason == "config_invalid"
    assert db.tables == []


def test_grading_under_and_at_the_cap_keep_their_behaviour(monkeypatch):
    monkeypatch.setattr(rate_limit, "supabase_admin", _CountQuery(count=199))
    rate_limit.enforce_grading_rate_limit("u1", 200)
    monkeypatch.setattr(rate_limit, "supabase_admin", _CountQuery(count=200))
    with pytest.raises(HTTPException) as error:
        rate_limit.enforce_grading_rate_limit("u1", 200)
    assert error.value.status_code == 429
    assert error.value.detail["error"] == "rate_limit_exceeded"


def test_exercise_limiter_keeps_its_fail_open_count(monkeypatch):
    # Non-AI limiter: unchanged by FR-006.
    monkeypatch.setattr(rate_limit, "supabase_admin", _CountQuery(fail=True))
    assert rate_limit.count_attempts_today("u1", "D1") == 0
    assert rate_limit.count_flashcard_reviews_today("u1") == 0
    rate_limit.enforce_exercise_rate_limit("u1", "D1", 50)


@pytest.fixture
def grading_route(monkeypatch):
    from routers import grading

    state = SimpleNamespace(whisper=[], recorded=[], db=_CountQuery(count=0))

    async def _auth(_value):
        return {"id": "user"}

    calls = {"n": 0}

    async def _execute(_query):
        calls["n"] += 1
        row = ({"id": "session", "part": 1, "mode": "practice", "sitting_id": None}
               if calls["n"] == 1 else {"id": "question", "question_text": "cake"})
        return SimpleNamespace(data=[row])

    async def _whisper(*_a, **_k):
        state.whisper.append(1)
        raise AssertionError("Whisper must not run after a quota refusal")

    monkeypatch.setattr(grading, "get_supabase_user", _auth)
    monkeypatch.setattr(grading, "aexecute", _execute)
    monkeypatch.setattr(grading, "require_resume_active", lambda _s: None)
    monkeypatch.setattr(grading, "require_speaking_entitlement", lambda *_a: None)
    monkeypatch.setattr(grading, "bind_owned_attempt", lambda _s: None)
    monkeypatch.setattr(grading, "transcribe_from_bytes", _whisper)
    monkeypatch.setattr(grading, "record_grading_attempt", state.recorded.append)
    monkeypatch.setattr(rate_limit, "supabase_admin", state.db)

    async def submit():
        from fastapi import UploadFile
        from starlette.datastructures import Headers
        return await grading.grade_response_endpoint(
            "session", question_id="question",
            audio_file=UploadFile(io.BytesIO(b"audio"), filename="a.wav",
                                  headers=Headers({"content-type": "audio/wav"})),
            authorization="Bearer t",
        )

    state.submit = submit
    return state


@pytest.mark.asyncio
async def test_grading_route_count_error_is_503_before_whisper_and_quota_row(grading_route):
    grading_route.db.fail = True
    with pytest.raises(HTTPException) as error:
        await grading_route.submit()
    assert error.value.status_code == 503
    _assert_fr010(error.value.detail)
    assert error.value.refusal.reason == "budget_unavailable"
    assert grading_route.whisper == [] and grading_route.recorded == []


@pytest.mark.asyncio
@pytest.mark.parametrize("cap", [0, -5])
async def test_grading_route_cap_at_or_below_zero_is_503(grading_route, monkeypatch, cap):
    monkeypatch.setattr(settings, "MAX_GRADINGS_PER_USER_PER_DAY", cap)
    with pytest.raises(HTTPException) as error:
        await grading_route.submit()
    assert error.value.status_code == 503
    assert error.value.refusal.reason == "config_invalid"
    assert grading_route.db.tables == []
    assert grading_route.whisper == [] and grading_route.recorded == []


# ── TTS (TTS_DAILY_LIMIT_PER_USER, TTS_IP_MAX_PER_MINUTE) ─────────────────────

@pytest.fixture
def tts(monkeypatch):
    state = SimpleNamespace(synth=[], guard=[], db=_CountQuery(count=0))

    async def _user(_authorization):
        return USER

    # Same signature as services.tts_audio.synthesize_mp3: since T004 (#1927)
    # the route passes the keyword-only user_id the budget guard bills.
    async def _synth(text, voice, *, user_id=None):
        state.synth.append((text, voice, user_id))
        return b"MP3"

    async def _log(**_kwargs):
        return None

    monkeypatch.setattr(tts_module, "get_supabase_user", _user)
    monkeypatch.setattr(tts_module, "require_speaking_entitlement",
                        lambda *a: state.guard.append(a))
    monkeypatch.setattr(tts_module.activation_gate, "ensure_account_active", lambda _u: None)
    monkeypatch.setattr(tts_module, "synthesize_mp3", _synth)
    monkeypatch.setattr(tts_module.ai_usage_logger, "log_tts_async", _log)
    monkeypatch.setattr(tts_module, "supabase_admin", state.db)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(settings, "TTS_DAILY_LIMIT_PER_USER", 200)
    monkeypatch.setattr(settings, "TTS_IP_MAX_PER_MINUTE", 60)
    monkeypatch.setattr(tts_module, "_ip_hits", {})
    client = TestClient(main.app)

    def post():
        return client.post("/tts", json={"text": "Hello"},
                           headers={"Authorization": "Bearer t", "X-Real-IP": "203.0.113.40"})

    state.post = post
    return state


def test_tts_within_quota_still_synthesises(tts):
    resp = tts.post()
    assert resp.status_code == 200 and resp.content == b"MP3"
    assert tts.synth == [("Hello", "nova", USER["id"])]


def test_tts_count_error_is_503_and_openai_is_never_called(tts):
    tts.db.fail = True
    resp = tts.post()
    assert resp.status_code == 503
    _assert_fr010(resp.json()["detail"])
    assert tts.synth == []


def test_tts_count_error_refusal_reason(tts):
    tts.db.fail = True
    with pytest.raises(rate_limit.PaidAIQuotaRefused) as error:
        tts_module._enforce_daily_quota("learner-1")
    assert error.value.refusal.reason == "budget_unavailable"
    assert error.value.refusal.detail == "TTS_DAILY_LIMIT_PER_USER"
    assert error.value.feature == "question_tts"


@pytest.mark.parametrize("cap", [0, -1])
def test_tts_daily_cap_at_or_below_zero_is_503_with_no_count(tts, monkeypatch, cap):
    monkeypatch.setattr(settings, "TTS_DAILY_LIMIT_PER_USER", cap)
    resp = tts.post()
    assert resp.status_code == 503
    _assert_fr010(resp.json()["detail"])
    assert tts.db.tables == [] and tts.synth == []


@pytest.mark.parametrize("cap", [0, -1])
def test_tts_ip_budget_at_or_below_zero_is_503_before_auth(tts, monkeypatch, cap):
    monkeypatch.setattr(settings, "TTS_IP_MAX_PER_MINUTE", cap)
    resp = tts.post()
    assert resp.status_code == 503
    _assert_fr010(resp.json()["detail"])
    assert tts.guard == [] and tts.db.tables == [] and tts.synth == []
    with pytest.raises(rate_limit.PaidAIQuotaRefused) as error:
        tts_module._throttle_ip(SimpleNamespace(headers={}, client=None))
    assert error.value.refusal.reason == "config_invalid"
    assert error.value.refusal.detail == "TTS_IP_MAX_PER_MINUTE"


def test_tts_quota_429s_are_unchanged(tts, monkeypatch):
    monkeypatch.setattr(settings, "TTS_DAILY_LIMIT_PER_USER", 3)
    tts.db.count = 3
    resp = tts.post()
    assert resp.status_code == 429
    assert resp.json()["detail"]["error"] == "rate_limit_exceeded"
    assert tts.synth == []


# ── Listening gist (LISTENING_GIST_*) ────────────────────────────────────────

@pytest.fixture
def gist(monkeypatch):
    state = SimpleNamespace(graded=[], db=_CountQuery(count=0))

    async def _auth(_authorization):
        return USER

    def _target(body):
        return {"id": "ex-1", "exercise_type": body.mode}, {"id": "c-1", "transcript": "t"}

    def _grade(**kwargs):
        state.graded.append(kwargs["body"].mode)
        return {"mode": kwargs["body"].mode, "score": 90}

    monkeypatch.setattr(listening, "get_supabase_user", _auth)
    monkeypatch.setattr(listening, "_resolve_attempt_target", _target)
    monkeypatch.setattr(listening, "_grade_and_save_gist", _grade)
    monkeypatch.setattr(listening, "_grade_and_save_dictation", _grade)
    monkeypatch.setattr(listening, "supabase_admin", state.db)
    monkeypatch.setattr(listening, "_gist_attempts", {})
    monkeypatch.setattr(settings, "LISTENING_GIST_MAX_PER_MINUTE", 6)
    monkeypatch.setattr(settings, "LISTENING_GIST_DAILY_LIMIT_PER_USER", 60)
    client = TestClient(main.app)

    def post(mode="gist"):
        return client.post("/api/listening/attempts", headers={"Authorization": "Bearer t"},
                           json={"mode": mode, "content_id": "c-1", "user_transcript": "gist"})

    state.post = post
    return state


def test_gist_within_quota_still_grades(gist):
    assert gist.post().status_code == 200
    assert gist.graded == ["gist"]


def test_gist_count_error_is_503_and_the_grader_never_runs(gist):
    gist.db.fail = True
    resp = gist.post()
    assert resp.status_code == 503
    _assert_fr010(resp.json()["detail"])
    assert gist.graded == []
    assert not listening._gist_attempts.get(USER["id"])   # no minute slot used


def test_gist_count_error_refusal_reason(gist):
    gist.db.fail = True
    with pytest.raises(rate_limit.PaidAIQuotaRefused) as error:
        listening._enforce_gist_rate_limit("learner-1")
    assert error.value.refusal.reason == "budget_unavailable"
    assert error.value.refusal.detail == "LISTENING_GIST_DAILY_LIMIT_PER_USER"
    assert error.value.feature == "listening_gist"


@pytest.mark.parametrize("setting", ["LISTENING_GIST_MAX_PER_MINUTE",
                                     "LISTENING_GIST_DAILY_LIMIT_PER_USER"])
@pytest.mark.parametrize("cap", [0, -1])
def test_gist_cap_at_or_below_zero_is_config_invalid(gist, monkeypatch, setting, cap):
    monkeypatch.setattr(settings, setting, cap)
    resp = gist.post()
    assert resp.status_code == 503
    _assert_fr010(resp.json()["detail"])
    assert gist.graded == [] and gist.db.tables == []
    with pytest.raises(rate_limit.PaidAIQuotaRefused) as error:
        listening._enforce_gist_rate_limit("learner-1")
    assert error.value.refusal.reason == "config_invalid"
    assert error.value.refusal.detail == setting


def test_invalid_gist_caps_do_not_touch_non_ai_listening_modes(gist, monkeypatch):
    monkeypatch.setattr(settings, "LISTENING_GIST_MAX_PER_MINUTE", 0)
    gist.db.fail = True
    assert gist.post("dictation").status_code == 200
    assert gist.graded == ["dictation"]


# ── runtime_flags.is_enabled(on_error=...) ───────────────────────────────────

class _FlagDB:
    def __init__(self, rows=None, fail=False):
        self.rows, self.fail, self.reads = dict(rows or {}), fail, 0

    def table(self, _name):
        return self

    def select(self, *_a):
        return self

    def eq(self, _col, key):
        self.key = key
        return self

    def limit(self, _n):
        return self

    def execute(self):
        self.reads += 1
        if self.fail:
            raise RuntimeError("flags table down")
        row = self.rows.get(self.key)
        return SimpleNamespace(data=[{"enabled": row}] if row is not None else [])


@pytest.fixture
def flags(monkeypatch):
    runtime_flags.clear_cache()
    db = _FlagDB()
    monkeypatch.setattr(runtime_flags, "supabase_admin", db)
    yield db
    runtime_flags.clear_cache()


@pytest.mark.parametrize("default,on_error,expected", [
    (True, False, False),     # a paid-AI gate closes on an outage
    (False, True, True),
    (True, None, True),       # omitted → the existing fail-open default
    (False, None, False),
])
def test_is_enabled_lookup_error_returns_on_error_when_given(flags, default, on_error, expected):
    flags.fail = True
    assert runtime_flags.is_enabled("paid_ai_gate", default=default, on_error=on_error) is expected


def test_on_error_result_is_not_cached(flags):
    flags.fail = True
    assert runtime_flags.is_enabled("paid_ai_gate", on_error=False) is False
    flags.fail = False
    flags.rows["paid_ai_gate"] = True
    assert runtime_flags.is_enabled("paid_ai_gate", on_error=False) is True


def test_on_error_does_not_change_a_stored_row_or_a_missing_row(flags):
    flags.rows["on_row"] = True
    flags.rows["off_row"] = False
    assert runtime_flags.is_enabled("on_row", default=False, on_error=False) is True
    assert runtime_flags.is_enabled("off_row", default=True, on_error=True) is False
    assert runtime_flags.is_enabled("absent", default=True, on_error=False) is True
    assert runtime_flags.is_enabled("absent", default=False, on_error=True) is False


@pytest.mark.asyncio
@pytest.mark.parametrize("default,on_error,expected", [
    (True, False, False), (False, True, True), (True, None, True),
])
async def test_ais_enabled_honours_on_error(flags, default, on_error, expected):
    async def run(_build):
        raise RuntimeError("async flags read down")
    got = await runtime_flags.ais_enabled("paid_ai_gate", default, run=run, on_error=on_error)
    assert got is expected


def test_require_flag_on_error_false_refuses_on_a_lookup_error(flags):
    flags.fail = True
    with pytest.raises(HTTPException) as error:
        runtime_flags.require_flag("paid_ai_gate", on_error=False)()
    assert error.value.status_code == 503
    assert error.value.detail["error_code"] == "feature_disabled"
    runtime_flags.require_flag("mutation_gate")()   # omitted: fail-open, unchanged


# Every runtime_flags read in the backend today gates a non-AI surface, so it
# keeps the fail-open default. A new read must either pass ``on_error=False``
# (it gates a paid AI call, FR-006) or be added here after checking that it
# does not. Keyed by (file, first-argument source).
_NON_PAID_AI_FLAG_READS = {
    ("routers/admin_class_assignments.py", "'master30_grammar_diagnostic'"),
    ("routers/admin_grammar_diagnostic.py", "'master30_grammar_diagnostic'"),
    ("routers/auth.py", "'profile_update'"),
    ("routers/auth.py", "'vocab_units_read'"),
    ("routers/grading.py", "'vocab_unit_recommendations'"),
    ("routers/grading.py", "'vocab_units_read'"),
    ("routers/grammar_diagnostic.py", "'master30_grammar_diagnostic'"),
    ("routers/grammar_diagnostic.py", "'master30_grammar_self_serve'"),
    ("routers/grammar_lesson.py", "service.FLAG"),
    ("routers/health.py", "key"),
    ("routers/vocab_units.py", "'vocab_units_read'"),
    ("routers/vocab_units.py", "'vocab_unit_recommendations'"),
    ("routers/vocab_units.py", "key"),
    ("services/grammar_diagnostic_service.py", "'master30_grammar_self_serve'"),
    ("services/grammar_lesson_service.py", "FLAG"),
    ("services/grammar_lesson_service.py", "FULL_FLAG"),
}
_FLAG_READERS = {"is_enabled", "ais_enabled", "require_flag"}


def _flag_reads():
    for path in sorted(BACKEND.glob("**/*.py")):
        rel = path.relative_to(BACKEND).as_posix()
        if rel.startswith(("tests/", "venv/", ".venv/")) or rel == "services/runtime_flags.py":
            continue
        source = path.read_text(encoding="utf-8")
        if "runtime_flags" not in source:
            continue
        for node in ast.walk(ast.parse(source)):
            if not isinstance(node, ast.Call) or not node.args:
                continue
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
            if name not in _FLAG_READERS:
                continue
            if isinstance(func, ast.Attribute) and ast.unparse(func.value) != "runtime_flags":
                continue
            closes = any(k.arg == "on_error" and isinstance(k.value, ast.Constant)
                         and k.value.value is False for k in node.keywords)
            yield rel, ast.unparse(node.args[0]), closes, node.lineno


def test_every_runtime_flag_read_is_classified():
    reads = list(_flag_reads())
    assert reads, "inventory scan found no runtime_flags reads"
    unclassified = [f"{rel}:{line} {key}" for rel, key, closes, line in reads
                    if not closes and (rel, key) not in _NON_PAID_AI_FLAG_READS]
    assert not unclassified, (
        "runtime_flags read not classified: pass on_error=False if it gates a "
        f"paid AI call (AIBUDGET-0033 FR-006), else add it to the allowlist: {unclassified}"
    )
    stale = _NON_PAID_AI_FLAG_READS - {(rel, key) for rel, key, _c, _l in reads}
    assert not stale, f"allowlist entries no longer read: {sorted(stale)}"
