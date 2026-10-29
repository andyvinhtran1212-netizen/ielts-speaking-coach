"""AIBUDGET-0033 T003 — budget core ``services/ai_budget.py`` (FR-002 to FR-009, FR-021).

Offline: the migration-333 RPCs are replaced by a scripted fake that returns
the SQL functions' documented shapes (the SQL itself is covered by
``test_migration_333_ai_budget.py``). No provider or database is reached.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import uuid
from pathlib import Path

import httpx
import pytest

from services import ai_budget, ai_budget_config, ai_pricing
from services.ai_budget import AIBudgetRefused, AIBudgetReplay, BudgetLine

FIXTURES = Path(__file__).parent / "fixtures" / "provider_spend_limit"
HARD = ("google", "azure", "openai", "elevenlabs")
REAL_RPC = ai_budget._rpc


class FakeRPC:
    """Records every call; answers from a per-function script."""

    def __init__(self, **script):
        self.calls: list[tuple[str, dict]] = []
        self.script = script

    async def __call__(self, name, params):
        self.calls.append((name, params))
        handler = self.script.get(name, _default(name))
        if isinstance(handler, BaseException):
            raise handler
        return handler(params) if callable(handler) else handler

    def names(self):
        return [name for name, _ in self.calls]


def _grant(params):
    return {
        "granted": True, "replay": False, "month_start": "2026-10-01", "day_start": "2026-10-29",
        "reservations": [
            {"id": str(uuid.uuid4()), "line_no": line["line_no"], "provider": line["provider"],
             "estimate_usd": line["estimate_usd"], "expires_at": "2026-10-29T00:10:00Z"}
            for line in params["p_lines"]
        ],
    }


def _default(name):
    return {
        "fn_ai_budget_reserve": _grant,
        "fn_ai_budget_settle": lambda p: {"status": "settled", "actual_usd": p["p_actual_usd"]},
        "fn_ai_budget_release": {"status": "released"},
        "fn_ai_budget_close_scope": lambda p: {"status": "closed", "scope": p["p_scope"]},
    }[name]


def _refusal(reason, scope, period_kind="month"):
    return {"granted": False, "replay": False, "reason": reason, "scope": scope, "period_kind": period_kind}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.delenv("AI_KILL_SWITCH", raising=False)
    for scope in ai_budget_config.SCOPES:
        monkeypatch.setattr(ai_budget_config._settings_source(), ai_budget_config.env_var_for(scope), "",
                            raising=False)
    monkeypatch.setattr(ai_budget_config._settings_source(), "AI_BUDGET_MODE", "", raising=False)


@pytest.fixture
def rpc(monkeypatch):
    fake = FakeRPC()
    monkeypatch.setattr(ai_budget, "_rpc", fake)
    return fake


def run(coro):
    return asyncio.run(coro)


def configs(**raw):
    return ai_budget_config.load_scope_configs({ai_budget_config.env_var_for(k): v for k, v in raw.items()})


async def _reserve(*providers, **kwargs):
    lines = [BudgetLine(p, "m", 0.01, line_no=i + 1) for i, p in enumerate(providers)]
    return await ai_budget.reserve(lines, request_key=kwargs.pop("request_key", "k1"),
                                   feature="test", **kwargs)


# ── FR-003 defaults and configuration ───────────────────────────────────────

def test_unset_variables_send_the_spec_default_caps_and_grant(rpc):
    res = run(_reserve("anthropic", "google"))
    assert res.recorded and res.decision == "granted"
    caps = rpc.calls[0][1]["p_caps"]
    assert set(caps) == {"total", "anthropic", "google"}
    assert caps["total"] == {"month": 200.0, "day": pytest.approx(200 / 15), "mode": "soft",
                             "thresholds": [50, 80, 100]}
    assert caps["anthropic"]["month"] == 100.0 and caps["anthropic"]["mode"] == "soft"
    assert caps["anthropic"]["thresholds"] == [80, 100]       # no 50% (decision (f))
    assert caps["google"]["month"] == 20.0 and caps["google"]["mode"] == "hard"
    assert caps["google"]["day"] == pytest.approx(1.3333, abs=1e-4)


@pytest.mark.parametrize("scope", HARD)
def test_every_hard_scope_defaults_to_twenty_dollars(rpc, scope):
    run(_reserve(scope))
    entry = rpc.calls[0][1]["p_caps"][scope]
    assert entry["month"] == 20.0 and entry["mode"] == "hard"


@pytest.mark.parametrize("bad", ["0", "abc", "-5", "nan", "inf"])
def test_a_set_but_invalid_hard_cap_refuses_only_its_own_scope(rpc, bad):
    cfg = configs(google=bad)
    with pytest.raises(AIBudgetRefused) as err:
        run(_reserve("google", configs=cfg))
    assert err.value.reason == "config_invalid" and err.value.scope == "google"
    assert err.value.detail == "AI_BUDGET_MONTHLY_USD_GOOGLE"
    assert rpc.calls == []                       # refused before the database
    assert run(_reserve("openai", configs=cfg, request_key="k2")).recorded


def test_an_invalid_soft_cap_is_never_refused_and_sends_null_caps(rpc):
    res = run(_reserve("anthropic", configs=configs(anthropic="abc", total="0")))
    assert res.recorded
    caps = rpc.calls[0][1]["p_caps"]
    assert caps["anthropic"]["month"] is None and caps["anthropic"]["mode"] == "soft"
    assert caps["total"]["month"] is None


# ── FR-007 kill switch ──────────────────────────────────────────────────────

@pytest.mark.parametrize("value", ["on", "true", "1", "banana", "ON "])
@pytest.mark.parametrize("mode", ["enforce", "shadow"])
def test_kill_switch_refuses_every_line_without_the_database(rpc, monkeypatch, value, mode):
    monkeypatch.setenv("AI_KILL_SWITCH", value)
    with pytest.raises(AIBudgetRefused) as err:
        run(_reserve("anthropic", mode=mode))
    assert err.value.reason == "kill_switch"
    assert rpc.calls == []


@pytest.mark.parametrize("value", ["off", "false", "0", "", " OFF "])
def test_kill_switch_off_values_allow_the_call(rpc, monkeypatch, value):
    monkeypatch.setenv("AI_KILL_SWITCH", value)
    assert run(_reserve("openai")).recorded


def test_kill_switch_is_read_per_call(rpc, monkeypatch):
    assert run(_reserve("openai", request_key="a")).recorded
    monkeypatch.setenv("AI_KILL_SWITCH", "on")
    with pytest.raises(AIBudgetRefused):
        run(_reserve("openai", request_key="b"))
    assert ai_budget.kill_switch_on()


# ── FR-002 / FR-008 cap refusals, soft scopes (FR-021) ──────────────────────

@pytest.mark.parametrize("reason,kind", [("monthly_cap", "month"), ("daily_cap", "day"),
                                         ("config_invalid", "month"), ("provider_spend_limit", "day")])
def test_a_hard_scope_refusal_is_raised_with_its_reason(rpc, reason, kind):
    rpc.script["fn_ai_budget_reserve"] = _refusal(reason, "openai", kind)
    with pytest.raises(AIBudgetRefused) as err:
        run(_reserve("openai", "anthropic"))
    assert (err.value.reason, err.value.scope, err.value.period_kind) == (reason, "openai", kind)


@pytest.mark.parametrize("reason", ["monthly_cap", "daily_cap", "config_invalid"])
def test_a_soft_only_request_is_never_refused_for_a_budget_reason(rpc, reason, caplog):
    rpc.script["fn_ai_budget_reserve"] = _refusal(reason, "anthropic")
    with caplog.at_level(logging.WARNING, logger="services.ai_budget"):
        res = run(_reserve("anthropic"))
    assert not res.recorded and res.decision == "allow_unrecorded"
    assert "decision=allow_unrecorded scope=anthropic feature=test" in caplog.text


def test_an_anthropic_provider_spend_limit_closure_still_refuses(rpc):
    rpc.script["fn_ai_budget_reserve"] = _refusal("provider_spend_limit", "anthropic", "day")
    with pytest.raises(AIBudgetRefused) as err:
        run(_reserve("anthropic"))
    assert err.value.reason == "provider_spend_limit"


def test_reserve_sends_every_line_in_one_call(rpc):
    res = run(ai_budget.reserve(
        [BudgetLine("openai", "whisper-1", 0.0061), BudgetLine("anthropic", "claude-sonnet-5-5", 0.05),
         BudgetLine("anthropic", "claude-haiku-5-5", 0.001, line_no=2)],
        request_key="sub-1:1", feature="speaking_grading", user_id="u1",
        resource_type="response", resource_id="r1"))
    assert rpc.names() == ["fn_ai_budget_reserve"]
    params = rpc.calls[0][1]
    assert params["p_request_key"] == "sub-1:1" and params["p_ttl_seconds"] == 600
    assert [(l["provider"], l["line_no"]) for l in params["p_lines"]] == [
        ("openai", 1), ("anthropic", 1), ("anthropic", 2)]
    assert all(l["feature"] == "speaking_grading" and l["user_id"] == "u1" for l in params["p_lines"])
    assert set(res.lines) == {("openai", 1), ("anthropic", 1), ("anthropic", 2)}
    with pytest.raises(ValueError):
        run(res.settle("anthropic", 0.01))           # two anthropic lines: line_no needed


# ── FR-005 fail closed, FR-021 allow_unrecorded ─────────────────────────────

class PostgrestMissing(Exception):
    code = "PGRST202"


async def _slow(params):
    await asyncio.sleep(5)


RPC_FAILURES = {
    "raise": RuntimeError("connection reset"),
    "missing_function": PostgrestMissing("Could not find the function public.fn_ai_budget_reserve"),
    "invalid_input_22023": Exception("ai_budget_invalid_estimate"),
    "none": None,
    "list": [],
    "no_granted": {"replay": False},
    "granted_string": {"granted": "true"},
    "granted_without_rows": {"granted": True, "replay": False},
    "granted_wrong_lines": lambda p: {"granted": True, "replay": False, "reservations": [
        {"id": str(uuid.uuid4()), "line_no": 9, "provider": "openai", "estimate_usd": 0.01}]},
    "granted_bad_id": lambda p: {"granted": True, "replay": False, "reservations": [
        {"id": "not-a-uuid", "line_no": 1, "provider": l["provider"], "estimate_usd": 0.01}
        for l in p["p_lines"]]},
    "granted_nan_estimate": lambda p: {"granted": True, "replay": False, "reservations": [
        {"id": str(uuid.uuid4()), "line_no": 1, "provider": l["provider"], "estimate_usd": "NaN"}
        for l in p["p_lines"]]},
    "unknown_reason": _refusal("cap_exhausted", "openai"),
    "refusal_kill_switch_from_sql": _refusal("kill_switch", "openai"),
    "replay_marked_granted": {"granted": True, "replay": True, "lines": []},
}


@pytest.fixture(params=sorted(RPC_FAILURES) + ["timeout"])
def failing_rpc(request, rpc, monkeypatch):
    if request.param == "timeout":
        monkeypatch.setattr(ai_budget, "RPC_TIMEOUT_SECONDS", 0.05)
        monkeypatch.setattr(ai_budget, "_rpc_execute", lambda name, params: _slow(params))
        monkeypatch.setattr(ai_budget, "_rpc", REAL_RPC)     # the real 2 s wrapper, shortened
        return rpc
    failure = RPC_FAILURES[request.param]
    rpc.script["fn_ai_budget_reserve"] = failure if isinstance(failure, BaseException) or callable(failure) \
        else (lambda p, f=failure: f)
    return rpc


@pytest.mark.parametrize("providers", [("openai",), ("google",), ("anthropic", "openai"), ("azure",)])
def test_an_rpc_failure_refuses_any_request_with_a_hard_line(failing_rpc, providers):
    with pytest.raises(AIBudgetRefused) as err:
        run(_reserve(*providers))
    assert err.value.reason == "budget_unavailable"


def test_an_rpc_failure_lets_an_anthropic_only_request_through_unrecorded(failing_rpc, caplog):
    with caplog.at_level(logging.WARNING, logger="services.ai_budget"):
        res = run(_reserve("anthropic"))
    assert not res.recorded and res.decision == "allow_unrecorded"
    assert caplog.text.count("decision=allow_unrecorded scope=anthropic") == 1
    assert run(res.settle("anthropic", 0.01)) is False      # no-op handle
    assert run(res.release("anthropic")) is False


def test_the_real_rpc_wrapper_enforces_the_two_second_deadline(monkeypatch):
    assert ai_budget.RPC_TIMEOUT_SECONDS == 2.0
    seen = {}

    async def fake_wait_for(coro, timeout):
        seen["timeout"] = timeout
        coro.close()
        raise asyncio.TimeoutError

    monkeypatch.setattr(ai_budget.asyncio, "wait_for", fake_wait_for)
    with pytest.raises(asyncio.TimeoutError):
        run(REAL_RPC("fn_ai_budget_reserve", {}))
    assert seen["timeout"] == 2.0


# ── Replay (FR-002, AC3) ────────────────────────────────────────────────────

@pytest.mark.parametrize("status", ["reserved", "settled", "released", "expired"])
@pytest.mark.parametrize("mode", ["enforce", "shadow"])
def test_a_replay_never_authorises_a_provider_request(rpc, status, mode):
    rpc.script["fn_ai_budget_reserve"] = {"granted": False, "replay": True,
                                          "lines": [{"line_no": 1, "provider": "openai", "status": status}]}
    sent = []

    async def call():
        async with ai_budget.guard("openai", "whisper-1", "stt", 0.01, request_key="dup", mode=mode):
            sent.append(1)

    with pytest.raises(AIBudgetReplay) as err:
        run(call())
    assert sent == [] and err.value.lines[0]["status"] == status
    assert rpc.names() == ["fn_ai_budget_reserve"]


# ── Shadow vs enforce ───────────────────────────────────────────────────────

def test_shadow_logs_would_refuse_and_lets_the_call_through(rpc, caplog):
    rpc.script["fn_ai_budget_reserve"] = _refusal("monthly_cap", "openai")
    sent = []

    async def call(mode):
        async with ai_budget.guard("openai", "whisper-1", "stt", 0.01, request_key="s", mode=mode) as lease:
            sent.append(mode)
            lease.settle(0.005)

    with caplog.at_level(logging.WARNING, logger="services.ai_budget"):
        run(call("shadow"))
    assert sent == ["shadow"] and "decision=would_refuse reason=monthly_cap scope=openai" in caplog.text
    assert rpc.names() == ["fn_ai_budget_reserve"]          # nothing to settle
    with pytest.raises(AIBudgetRefused):
        run(call("enforce"))
    assert sent == ["shadow"]


def test_mode_comes_from_ai_budget_mode(rpc, monkeypatch):
    rpc.script["fn_ai_budget_reserve"] = _refusal("daily_cap", "google", "day")
    monkeypatch.setattr(ai_budget_config._settings_source(), "AI_BUDGET_MODE", "shadow")
    assert run(_reserve("google")).decision == "would_refuse"
    monkeypatch.setattr(ai_budget_config._settings_source(), "AI_BUDGET_MODE", "shadw")
    with pytest.raises(AIBudgetRefused):
        run(_reserve("google"))


def test_shadow_proceeds_on_budget_unavailable(rpc):
    rpc.script["fn_ai_budget_reserve"] = RuntimeError("down")
    assert run(_reserve("openai", mode="shadow")).decision == "would_refuse"


# ── Estimator (FR-004) ──────────────────────────────────────────────────────

def test_token_estimate_is_an_upper_bound_with_max_tokens_at_the_output_rate():
    text = "Xin chào, đây là bài nói của tôi. " * 50
    est = ai_budget.estimate("google", "gemini-2.5-flash", input_text=text, max_tokens=2000)
    rate = ai_pricing.token_rate("google", "gemini-2.5-flash")
    prompt = len(text.encode("utf-8")) + ai_budget.REQUEST_OVERHEAD_TOKENS
    assert len(text.encode("utf-8")) > len(text)          # Vietnamese: bytes > characters
    expected = (prompt * rate.input_per_million + 2000 * rate.output_per_million) / 1e6
    assert est == pytest.approx(math.ceil(expected * 1e6) / 1e6)
    assert est >= expected


def test_anthropic_prompt_is_priced_at_the_cache_write_rate():
    est = ai_budget.estimate("anthropic", "claude-sonnet-5-5", input_tokens=10_000, max_tokens=1000)
    expected = ((10_000 + ai_budget.REQUEST_OVERHEAD_TOKENS) * 2.50 + 1000 * 10.00) / 1e6
    assert est == pytest.approx(expected, abs=1e-6)


def test_haiku_5_5_long_prompt_multiplier_is_in_the_bound():
    est = ai_budget.estimate("anthropic", "claude-haiku-5-5", input_tokens=120_000, max_tokens=0)
    assert est == pytest.approx((120_000 + ai_budget.REQUEST_OVERHEAD_TOKENS) * 0.125 / 1e6 * 5, abs=1e-6)


def test_images_add_the_catalog_image_token_bound():
    base = ai_budget.estimate("anthropic", "claude-sonnet-5-5", input_tokens=1000, max_tokens=100)
    with_image = ai_budget.estimate("anthropic", "claude-sonnet-5-5", input_tokens=1000, max_tokens=100,
                                    images=[(1400, 1000)])
    bound = ai_pricing.image_input_tokens_bound("anthropic", "claude-sonnet-5-5", 1400, 1000)
    assert bound == math.ceil(1400 / 28) * math.ceil(1000 / 28)
    assert with_image - base == pytest.approx(bound * 2.50 / 1e6, abs=2e-6)
    gemini = ai_budget.estimate("google", "gemini-2.5-flash", input_tokens=0, max_tokens=0,
                                images=[(1000, 1000), (200, 200)])
    tiles = ai_pricing.image_input_tokens_bound("google", "gemini-2.5-flash", 1000, 1000)
    assert gemini == pytest.approx((ai_budget.REQUEST_OVERHEAD_TOKENS + tiles + 258) * 0.30 / 1e6, abs=2e-6)


@pytest.mark.parametrize("images", [[(0, 100)], [(None, 100)], [(100,)], [("1", "2")], [(True, 10)]])
def test_an_image_without_readable_dimensions_has_no_bound(images):
    assert ai_budget.estimate_or_none("anthropic", "claude-sonnet-5-5", input_tokens=1,
                                      max_tokens=1, images=images) is None
    with pytest.raises(AIBudgetRefused) as err:
        ai_budget.estimate("anthropic", "claude-sonnet-5-5", input_tokens=1, max_tokens=1, images=images)
    assert err.value.reason == "config_invalid"


def test_audio_is_the_measured_duration_rounded_up_plus_one_second():
    est = ai_budget.estimate("openai", "whisper-1", audio_seconds=59.2)
    assert est == pytest.approx(61 * 0.006 / 60, abs=1e-6)
    azure = ai_budget.estimate("azure", "pronunciation-assessment", audio_seconds=30)
    assert azure == pytest.approx(31 * 1.30 / 3600, abs=1e-6)


def test_tts_is_priced_per_character():
    assert ai_budget.estimate("openai", "tts-1", text_chars="hello") == pytest.approx(5 * 15 / 1e6, abs=1e-6)
    assert ai_budget.estimate("elevenlabs", "eleven_flash_v2_5", text_chars=1000) == pytest.approx(0.04)


@pytest.mark.parametrize("kwargs", [
    {"input_tokens": 10, "max_tokens": 10, "model": "gpt-unpriced"},
    {"audio_seconds": None, "max_tokens": None},
    {"audio_seconds": float("nan")},
    {"audio_seconds": float("inf")},
    {"audio_seconds": -1},
    {"text_chars": -3},
    {"input_tokens": -1, "max_tokens": 10},
    {"input_tokens": 10, "max_tokens": None},
    {"input_tokens": 10**15, "max_tokens": 10},
])
def test_no_upper_bound_means_no_estimate(kwargs):
    model = kwargs.pop("model", "claude-sonnet-5-5")
    provider = "openai" if "audio_seconds" in kwargs or "text_chars" in kwargs else "anthropic"
    if provider == "openai":
        model = "whisper-1" if "audio_seconds" in kwargs else "tts-1"
    assert ai_budget.estimate_or_none(provider, model, **kwargs) is None


def test_a_free_request_still_reserves_the_smallest_stored_amount():
    assert ai_budget.estimate("openai", "tts-1", text_chars="") == pytest.approx(1e-6)


@pytest.mark.parametrize("estimate", [None, float("nan"), float("inf"), -1.0, 1e9])
def test_a_line_without_a_finite_estimate_is_refused_before_the_database(rpc, estimate):
    with pytest.raises(AIBudgetRefused) as err:
        run(ai_budget.reserve([BudgetLine("anthropic", "x", estimate)], request_key="k", feature="f"))
    assert err.value.reason == "config_invalid" and rpc.calls == []


def test_estimates_are_sent_rounded_up_to_the_stored_precision(rpc):
    run(ai_budget.reserve([BudgetLine("openai", "whisper-1", 0.0000011)], request_key="k", feature="f"))
    assert rpc.calls[0][1]["p_lines"][0]["estimate_usd"] == pytest.approx(0.000002)
    json.dumps(rpc.calls[0][1], allow_nan=False)


# ── guard: settle, release, settle at estimate ──────────────────────────────

def _guard(**kw):
    return ai_budget.guard("openai", "whisper-1", "stt", kw.pop("estimate", 0.01),
                           request_key=kw.pop("request_key", "g"), **kw)


def test_guard_settles_at_the_reported_cost(rpc):
    async def call():
        async with _guard() as lease:
            lease.settle(0.004)
    run(call())
    assert rpc.names() == ["fn_ai_budget_reserve", "fn_ai_budget_settle"]
    assert rpc.calls[1][1]["p_actual_usd"] == 0.004


def test_guard_without_usage_settles_at_the_estimate(rpc):
    async def call():
        async with _guard(estimate=0.0123):
            pass
    run(call())
    assert rpc.names()[-1] == "fn_ai_budget_settle" and rpc.calls[1][1]["p_actual_usd"] == 0.0123


@pytest.mark.parametrize("error", [httpx.ReadTimeout("t"), RuntimeError("bad json"), ValueError("parse")])
def test_guard_settles_at_the_estimate_after_a_send_that_failed(rpc, error):
    async def call():
        async with _guard(estimate=0.02):
            raise error
    with pytest.raises(type(error)):
        run(call())
    assert rpc.names() == ["fn_ai_budget_reserve", "fn_ai_budget_settle"]
    assert rpc.calls[1][1]["p_actual_usd"] == 0.02


@pytest.mark.parametrize("error", [httpx.ConnectError("refused"), httpx.ConnectTimeout("connect")])
def test_guard_releases_when_the_connection_was_never_made(rpc, error):
    async def call():
        async with _guard():
            try:
                raise error
            except httpx.HTTPError as exc:
                raise RuntimeError("sdk wrapper") from exc
    with pytest.raises(RuntimeError):
        run(call())
    assert rpc.names() == ["fn_ai_budget_reserve", "fn_ai_budget_release"]


def test_guard_releases_when_the_caller_says_not_sent(rpc):
    async def call():
        async with _guard() as lease:
            lease.not_sent()
    run(call())
    assert rpc.names()[-1] == "fn_ai_budget_release"


def test_guard_leaves_a_cancelled_line_for_the_sweeper(rpc):
    async def call():
        async with _guard():
            raise asyncio.CancelledError
    with pytest.raises(asyncio.CancelledError):
        run(call())
    assert rpc.names() == ["fn_ai_budget_reserve"]


@pytest.mark.parametrize("actual", [float("nan"), float("inf"), -0.01, "abc", None, 1e9])
def test_an_invalid_actual_is_never_settled_and_never_released(rpc, actual, caplog):
    async def call():
        async with _guard() as lease:
            lease._actual = actual if actual is not None else "missing"
    with caplog.at_level(logging.ERROR, logger="services.ai_budget"):
        run(call())
    assert rpc.names() == ["fn_ai_budget_reserve"]
    assert "settle_invalid_actual" in caplog.text


@pytest.mark.parametrize("failure", [RuntimeError("down"), {"status": "weird"}, None])
def test_a_settlement_failure_is_swallowed_and_left_open(rpc, failure):
    rpc.script["fn_ai_budget_settle"] = failure if isinstance(failure, BaseException) else (lambda p, f=failure: f)
    result = {}

    async def call():
        async with _guard() as lease:
            lease.settle(0.001)
        result["line"] = next(iter(lease.reservation.lines.values()))
    run(call())
    assert result["line"].state == "left_open"
    assert rpc.names() == ["fn_ai_budget_reserve", "fn_ai_budget_settle"]


def test_a_line_is_settled_or_released_at_most_once(rpc):
    res = run(_reserve("openai"))
    assert run(res.settle("openai", 0.001)) is True
    assert run(res.settle("openai", 0.002)) is False
    assert run(res.release("openai")) is False
    assert run(res.settle_at_estimate("openai")) is False
    assert rpc.names() == ["fn_ai_budget_reserve", "fn_ai_budget_settle"]


def test_settle_open_at_estimate_finishes_only_unsettled_lines(rpc):
    res = run(_reserve("openai", "anthropic"))
    run(res.release("openai"))
    run(res.settle_open_at_estimate())
    assert rpc.names() == ["fn_ai_budget_reserve", "fn_ai_budget_release", "fn_ai_budget_settle"]


def test_the_guard_body_never_runs_on_a_refusal(rpc):
    rpc.script["fn_ai_budget_reserve"] = _refusal("monthly_cap", "openai")
    sent = []

    async def call():
        async with _guard():
            sent.append(1)
    with pytest.raises(AIBudgetRefused):
        run(call())
    assert sent == []


# ── FR-009 provider spend limit ─────────────────────────────────────────────

def _load(name):
    return json.loads((FIXTURES / f"{name}.json").read_text())


def _exceptions_for(fx):
    """Build the exceptions the pinned SDKs raise for this fixture."""
    request = httpx.Request("POST", fx["url"])
    response = httpx.Response(fx["http_status"], json=fx["body"], request=request)
    if fx["sdk"] == "anthropic":
        import anthropic
        return [anthropic.Anthropic(api_key="test")._make_status_error_from_response(response)]
    if fx["sdk"] == "openai":
        import openai
        return [openai.OpenAI(api_key="test")._make_status_error_from_response(response)]
    if fx["sdk"] == "google_api_core":
        from google.api_core import exceptions as gexc
        message = fx["body"]["error"]["message"]
        built = [gexc.from_http_status(fx["http_status"], message)]
        if fx["body"]["error"]["status"] == "RESOURCE_EXHAUSTED" and fx["http_status"] == 429:
            built.append(gexc.ResourceExhausted(message))       # the gRPC transport's form
        return built
    return [httpx.HTTPStatusError("provider error", request=request, response=response)]


FIXTURE_NAMES = sorted(p.stem for p in FIXTURES.glob("*.json"))


def test_fixtures_cover_every_provider_named_by_fr_009():
    positives = {_load(n)["provider"] for n in FIXTURE_NAMES if _load(n)["expected"] == "provider_spend_limit"}
    assert positives == {"anthropic", "openai", "google", "elevenlabs"}
    for name in ("anthropic_402_billing_error", "openai_429_insufficient_quota",
                 "gemini_429_spending_cap", "elevenlabs_401_quota_exceeded"):
        assert _load(name)["expected"] == "provider_spend_limit"
    for name in FIXTURE_NAMES:
        assert _load(name)["source"]


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_provider_fixture_is_classified(name):
    fx = _load(name)
    for exc in _exceptions_for(fx):
        assert ai_budget.classify_provider_error(exc) == fx["expected"], (name, type(exc).__name__)
        try:
            try:
                raise exc
            except Exception as inner:
                raise RuntimeError("wrapped by a caller") from inner
        except RuntimeError as wrapped:
            assert ai_budget.classify_provider_error(wrapped) == fx["expected"]


@pytest.mark.parametrize("exc", [asyncio.TimeoutError(), httpx.ConnectError("x"), ValueError("bad json"),
                                 RuntimeError("Gemini 500"), AIBudgetRefused("monthly_cap")])
def test_ordinary_failures_stay_transient(exc):
    assert ai_budget.classify_provider_error(exc) == "transient"


def test_a_spend_limit_response_closes_the_scope_and_becomes_a_refusal(rpc):
    exc = _exceptions_for(_load("openai_429_insufficient_quota"))[0]

    async def call():
        async with _guard(estimate=0.05):
            raise exc
    with pytest.raises(AIBudgetRefused) as err:
        run(call())
    assert err.value.reason == "provider_spend_limit" and err.value.scope == "openai"
    assert err.value.__cause__ is exc
    assert rpc.names() == ["fn_ai_budget_reserve", "fn_ai_budget_settle", "fn_ai_budget_close_scope"]
    assert rpc.calls[1][1]["p_actual_usd"] == 0.05
    assert rpc.calls[2][1] == {"p_scope": "openai", "p_day": None, "p_reason": "provider_spend_limit"}


def test_a_failed_scope_close_still_refuses(rpc):
    rpc.script["fn_ai_budget_close_scope"] = RuntimeError("down")
    exc = _exceptions_for(_load("anthropic_402_billing_error"))[0]
    refusal = run(ai_budget.provider_error_refusal("anthropic", exc))
    assert isinstance(refusal, AIBudgetRefused) and refusal.reason == "provider_spend_limit"


def test_a_transient_provider_error_is_not_a_refusal(rpc):
    exc = _exceptions_for(_load("anthropic_529_overloaded"))[0]
    assert run(ai_budget.provider_error_refusal("anthropic", exc)) is None
    assert rpc.calls == []


# ── Contract ────────────────────────────────────────────────────────────────

def test_refusal_reasons_are_the_fr_008_set():
    assert set(ai_budget.REASONS) == {"monthly_cap", "daily_cap", "kill_switch", "config_invalid",
                                      "budget_unavailable", "provider_spend_limit"}
    with pytest.raises(ValueError):
        AIBudgetRefused("quota")


@pytest.mark.parametrize("key", ["", "   ", "x" * 201, None])
def test_request_key_is_required(rpc, key):
    with pytest.raises(ValueError):
        run(ai_budget.reserve([BudgetLine("openai", "m", 0.01)], request_key=key, feature="f"))
    assert rpc.calls == []


def test_lines_are_validated(rpc):
    for lines in ([], [BudgetLine("mistral", "m", 0.01)],
                  [BudgetLine("openai", "m", 0.01), BudgetLine("openai", "m2", 0.01)]):
        with pytest.raises(ValueError):
            run(ai_budget.reserve(lines, request_key="k", feature="f"))
    assert rpc.calls == []
