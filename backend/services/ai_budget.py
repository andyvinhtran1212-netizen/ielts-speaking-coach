"""AIBUDGET-0033 budget core (T003; FR-001 to FR-009, FR-021).

The single chokepoint between a paid provider request and the provider. Call
sites (T004) reserve before they send and settle or release afterwards:

    est = ai_budget.estimate("anthropic", model, input_text=prompt, max_tokens=n)
    async with ai_budget.guard("anthropic", model, "speaking_grading", est,
                               request_key=key) as lease:
        resp = await client.messages.create(...)
        lease.settle(cost_from(resp.usage))

A multi-provider pipeline reserves its lines all-or-nothing with
:func:`reserve` and settles each line itself.

Rules (the spec is the authority; changing any of them needs a revision):

- The kill switch (``AI_KILL_SWITCH``, FR-007) is read from the process
  environment on every call, before any database read, and refuses every line,
  soft ones included, in both modes.
- The database (``fn_ai_budget_reserve``, migration 333) is the only cap
  authority. A hard scope whose configuration is invalid is refused here
  before the RPC, by that scope alone (FR-003).
- Any RPC error, a timeout (2 s), an unexpected shape or a missing object
  refuses a request that has a hard line with ``budget_unavailable``
  (FR-005). A request whose only provider lines are soft (``anthropic``)
  proceeds unreserved and logs ``decision=allow_unrecorded`` (FR-021).
- Only a fresh ``granted: true`` answer authorises a provider request. A
  replay of a request key never does, whatever its stored status (FR-002);
  it raises :class:`AIBudgetReplay`, never a grant.
- ``AI_BUDGET_MODE=shadow`` logs ``decision=would_refuse`` and lets a refused
  request through unreserved (staging calibration only). It never overrides
  the kill switch or a replay.
- After a send, a reservation is released only when the request provably
  was not sent (connection never established, or the caller says so).
  Otherwise it is settled at the provider-reported cost, or at its estimate
  when there is none (timeout, cancellation, any error). A settlement
  failure or an invalid actual cost leaves the reservation open; the sweeper
  expires it at its estimate (FR-005, FR-014).
- A provider response that reports the account's own spend limit
  (:func:`classify_provider_error`) closes that provider's scope for the
  UTC day and becomes ``AIBudgetRefused("provider_spend_limit")`` (FR-009).

Logs carry reasons, scopes, providers, models and features only; never a
prompt, a learner id or a credential.
"""

from __future__ import annotations

import asyncio
import logging
import math
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Iterable, Literal, Mapping, Sequence

from services import ai_budget_config, ai_pricing

logger = logging.getLogger(__name__)

REASONS: tuple[str, ...] = (
    "monthly_cap", "daily_cap", "kill_switch", "config_invalid",
    "budget_unavailable", "provider_spend_limit",
)
PROVIDERS: tuple[str, ...] = ("anthropic", "google", "openai", "elevenlabs", "azure")

RPC_TIMEOUT_SECONDS = 2.0          # FR-005
RESERVATION_TTL_SECONDS = 600      # FR-014: expires_at default 10 minutes
# ai_budget_reservations.estimate_usd / actual_usd are numeric(14,6).
MAX_STORED_USD = 99_999_999.0
_USD_QUANTUM = 1_000_000

# FR-004 token bound. Byte-level BPE (Claude) and SentencePiece with byte
# fallback (Gemini) never emit more tokens than the UTF-8 bytes they encode,
# so the byte count bounds the text's tokens. The overhead covers message
# framing and the tool-use system prompt the provider adds; callers still
# pass any tool schema they send as part of ``input_text``.
REQUEST_OVERHEAD_TOKENS = 512
# Audio lines are the measured duration rounded up, plus 1 s (FR-004).
AUDIO_MARGIN_SECONDS = 1


class AIBudgetRefused(Exception):
    """A budget refusal (FR-008). It stops the whole attempt chain: routers,
    the orchestrator and every retry loop re-raise it without trying another
    provider, model or retry."""

    def __init__(self, reason: str, *, scope: str | None = None, period_kind: str | None = None,
                 detail: str | None = None) -> None:
        if reason not in REASONS:
            raise ValueError(f"unknown budget refusal reason: {reason!r}")
        self.reason = reason
        self.scope = scope
        self.period_kind = period_kind
        # Admin/log-only detail, e.g. the invalid variable name. Never learner data.
        self.detail = detail
        super().__init__(f"ai_budget refused: {reason}" + (f" ({scope})" if scope else ""))


class AIBudgetReplay(Exception):
    """The request key already has reservation rows (FR-002, AC3).

    Not a grant and not a refusal: the caller returns the canonical stored
    state of that attempt (``check_submission`` readback, deferred state) and
    never calls the provider.
    """

    def __init__(self, request_key: str, lines: Sequence[Mapping[str, Any]]) -> None:
        self.request_key = request_key
        self.lines = tuple(dict(line) for line in lines)
        super().__init__("ai_budget replay")


# ── Estimator (FR-004) ──────────────────────────────────────────────────────

def _utf8_bytes(text: str | Sequence[str] | None) -> int:
    if text is None:
        return 0
    if isinstance(text, str):
        return len(text.encode("utf-8"))
    return sum(len(part.encode("utf-8")) for part in text)


def _round_up_usd(value: float) -> float:
    return math.ceil(value * _USD_QUANTUM) / _USD_QUANTUM


def _bounded(value: float | None) -> float | None:
    """A storable, positive upper bound, or None when there is none."""
    if value is None or isinstance(value, bool):
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value) or value < 0 or value > MAX_STORED_USD:
        return None
    # The reservation table requires estimate > 0; a free request still
    # holds the smallest stored amount.
    return max(_round_up_usd(value), 1 / _USD_QUANTUM)


def _non_negative_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def estimate_or_none(
    provider: str,
    model: str,
    *,
    input_text: str | Sequence[str] | None = None,
    input_tokens: int | None = None,
    max_tokens: int | None = None,
    thinking_tokens: int = 0,
    images: Iterable[tuple[int, int]] = (),
    audio_seconds: float | None = None,
    text_chars: int | str | None = None,
    at: datetime | date | None = None,
) -> float | None:
    """Upper-bound USD estimate of one request, or None when it has no bound.

    - Token models: ``input_tokens`` (an exact provider count) or the UTF-8
      bytes of ``input_text``, plus :data:`REQUEST_OVERHEAD_TOKENS`, plus each
      image's catalog bound from its decoded ``(width, height)``, all priced
      at the higher of the input and cache-write rates; plus ``max_tokens``
      and any ``thinking_tokens`` the provider bills outside it, at the
      output rate.
    - STT and pronunciation: ``audio_seconds`` measured from the bytes sent,
      rounded up to the whole second, plus 1 s.
    - TTS: ``text_chars`` (a count, or the text itself).

    None means: no catalog price, an unreadable image, an unmeasured audio
    duration, or a value outside the stored range. Such a request is refused
    before any provider call (``config_invalid``).
    """
    if audio_seconds is not None:
        if isinstance(audio_seconds, bool):
            return None
        try:
            seconds = float(audio_seconds)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(seconds) or seconds < 0:
            return None
        billed = math.ceil(seconds) + AUDIO_MARGIN_SECONDS
        cost, _ = ai_pricing.estimate_unit_cost(provider, model, "audio_second", billed, at=at)
        return _bounded(cost)

    if text_chars is not None:
        count = len(text_chars) if isinstance(text_chars, str) else _non_negative_int(text_chars)
        if count is None:
            return None
        cost, _ = ai_pricing.estimate_unit_cost(provider, model, "text_character", count, at=at)
        return _bounded(cost)

    rate = ai_pricing.token_rate(provider, model, at=at)
    out_tokens = _non_negative_int(max_tokens)
    thinking = _non_negative_int(thinking_tokens)
    if rate is None or out_tokens is None or thinking is None:
        return None
    if input_tokens is not None:
        prompt = _non_negative_int(input_tokens)
        if prompt is None:
            return None
    else:
        prompt = _utf8_bytes(input_text)
    prompt += REQUEST_OVERHEAD_TOKENS
    for size in images:
        try:
            width, height = size
        except (TypeError, ValueError):
            return None
        bound = ai_pricing.image_input_tokens_bound(provider, model, width, height, at=at)
        if bound is None:
            return None
        prompt += bound
    # A cached prompt is billed as a cache write the first time, which costs
    # more than plain input on Anthropic; price the whole prompt at that rate
    # when it is higher, so caching can only lower the actual.
    write_rate = rate.cache_write_per_million
    as_cache_write = write_rate is not None and write_rate > rate.input_per_million
    cost, _ = ai_pricing.estimate_token_cost(
        provider, model,
        input_tokens=0 if as_cache_write else prompt,
        cache_write_tokens=prompt if as_cache_write else 0,
        output_tokens=out_tokens,
        thinking_tokens=thinking,
        at=at,
    )
    return _bounded(cost)


def estimate(provider: str, model: str, **kwargs: Any) -> float:
    """:func:`estimate_or_none`, raising ``AIBudgetRefused("config_invalid")``
    when the request has no upper bound (FR-004)."""
    value = estimate_or_none(provider, model, **kwargs)
    if value is None:
        raise AIBudgetRefused("config_invalid", scope=provider, detail=f"no_estimate:{model}")
    return value


# ── Provider spend-limit classifier (FR-009) ────────────────────────────────

SpendClass = Literal["provider_spend_limit", "transient"]

# Gemini answers both a reached project spend cap and an empty prepay wallet
# with RESOURCE_EXHAUSTED (HTTP 429, or 402 for the wallet), the same status
# as an ordinary rate limit, so only these message texts mark the account
# limit. Fixtures: tests/fixtures/provider_spend_limit/gemini_*.json.
_GEMINI_SPEND_MARKERS = ("prepayment credits are depleted", "exceeded its monthly spending cap")
# Anthropic (platform.claude.com/docs/en/api/rate-limits, checked
# 2026-10-29): a spend limit set in the Console (FR-019's $200 backstop)
# answers HTTP 400 invalid_request_error whose message starts "You have
# reached your specified [workspace] API usage limits"; the tier's monthly
# cap answers 429 rate_limit_error with error.details.error_code
# "enforced_spend_limit_reached" and no retry-after. An exhausted prepaid
# balance answers 400 "Your credit balance is too low ...".
_ANTHROPIC_SPEND_MARKERS = (
    "reached your specified api usage limits",
    "reached your specified workspace api usage limits",
    "reached your api usage limits",
    "credit balance is too low",
)
_ANTHROPIC_SPEND_ERROR_CODES = frozenset({"enforced_spend_limit_reached"})
_OPENAI_SPEND_CODES = frozenset({"insufficient_quota"})
_ANTHROPIC_SPEND_TYPES = frozenset({"billing_error"})
_ELEVENLABS_SPEND_STATUSES = frozenset({"quota_exceeded"})


def _exception_chain(exc: BaseException, limit: int = 8) -> list[BaseException]:
    seen: list[BaseException] = []
    current: BaseException | None = exc
    while current is not None and len(seen) < limit and all(current is not s for s in seen):
        seen.append(current)
        current = current.__cause__ or current.__context__
    return seen


def _status_code(exc: BaseException) -> int | None:
    for attr in ("status_code", "code"):
        value = getattr(exc, attr, None)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    response = getattr(exc, "response", None)
    value = getattr(response, "status_code", None)
    return value if isinstance(value, int) else None


def _json_body(exc: BaseException) -> Any:
    body = getattr(exc, "body", None)
    if body is not None:
        return body
    response = getattr(exc, "response", None)
    if response is None or not hasattr(response, "json"):
        return None
    try:
        return response.json()
    except Exception:
        return None


def _texts(exc: BaseException, body: Any) -> str:
    parts = [str(getattr(exc, "message", "") or ""), str(exc)]
    if isinstance(body, Mapping):
        error = body.get("error")
        if isinstance(error, Mapping):
            parts.append(str(error.get("message") or ""))
        detail = body.get("detail")
        if isinstance(detail, Mapping):
            parts.append(str(detail.get("message") or ""))
    return " ".join(parts).lower()


def _is_spend_limit(exc: BaseException) -> bool:
    status = _status_code(exc)
    body = _json_body(exc)
    # HTTP 402 Payment Required: Anthropic billing_error (research §6: until
    # the Console spend-limit response is captured, every Anthropic 402 is
    # classified) and Gemini's depleted prepay wallet.
    if status == 402:
        return True
    error = body.get("error") if isinstance(body, Mapping) else None
    # OpenAI SDK errors carry the inner ``error`` object as ``body``.
    inner = error if isinstance(error, Mapping) else body if isinstance(body, Mapping) else {}
    if getattr(exc, "code", None) in _OPENAI_SPEND_CODES or inner.get("code") in _OPENAI_SPEND_CODES:
        return True
    if inner.get("type") in _OPENAI_SPEND_CODES or inner.get("type") in _ANTHROPIC_SPEND_TYPES:
        return True
    details = inner.get("details")
    if isinstance(details, Mapping) and details.get("error_code") in _ANTHROPIC_SPEND_ERROR_CODES:
        return True
    detail = body.get("detail") if isinstance(body, Mapping) else None
    if isinstance(detail, Mapping) and (
        detail.get("status") in _ELEVENLABS_SPEND_STATUSES
        or detail.get("code") in _ELEVENLABS_SPEND_STATUSES
    ):
        return True
    text = _texts(exc, body)
    return any(marker in text for marker in _GEMINI_SPEND_MARKERS + _ANTHROPIC_SPEND_MARKERS)


def classify_provider_error(exc: BaseException) -> SpendClass:
    """``provider_spend_limit`` when the provider reports the account's own
    spend or credit limit, else ``transient`` (FR-009).

    Rate limits (429 ``rate_limit_error``), overload (529), 5xx, timeouts,
    network errors and invalid output are transient and keep today's
    fallback within the caps. Wrapped exceptions are classified through
    their ``__cause__``/``__context__`` chain. An unrecognised error stays
    transient, which is safe because the app's own caps still bound it.
    """
    if isinstance(exc, AIBudgetRefused):
        return "provider_spend_limit" if exc.reason == "provider_spend_limit" else "transient"
    for item in _exception_chain(exc):
        if _is_spend_limit(item):
            return "provider_spend_limit"
    return "transient"


def _provably_not_sent(exc: BaseException) -> bool:
    """True only when the connection was never established, so no request
    bytes reached the provider (FR-004). Every SDK client a guarded call
    uses has ``max_retries=0`` (FR-001), so the failure seen is the only
    attempt."""
    try:
        import httpx
    except ImportError:  # pragma: no cover - httpx is a pinned dependency
        return False
    return any(isinstance(item, (httpx.ConnectError, httpx.ConnectTimeout))
               for item in _exception_chain(exc))


# ── RPC transport ───────────────────────────────────────────────────────────

class _BadShape(Exception):
    pass


async def _rpc_execute(name: str, params: dict[str, Any]) -> Any:
    """Call one migration-333 function on the shared async client.

    The async client is used whatever ``USE_ASYNC_DB`` is, as the AI ledger
    already does, so the 2 s deadline can cancel a hung request instead of
    blocking the event loop.
    """
    from database import get_supabase_async

    client = await get_supabase_async()
    response = await client.rpc(name, params).execute()
    return response.data


async def _rpc(name: str, params: dict[str, Any]) -> Any:
    return await asyncio.wait_for(_rpc_execute(name, params), timeout=RPC_TIMEOUT_SECONDS)


# ── Reservations ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class BudgetLine:
    """One provider request line of a reservation (plan.md item 7)."""
    provider: str
    model: str
    estimate_usd: float | None
    line_no: int = 1
    operation: str | None = None


@dataclass
class _Granted:
    provider: str
    line_no: int
    reservation_id: str
    estimate_usd: float
    state: str = "reserved"   # reserved → settled | released | left_open


@dataclass
class Reservation:
    """The outcome of :func:`reserve` that allows the provider requests.

    ``recorded`` is False for an unreserved pass (``allow_unrecorded`` or a
    shadow ``would_refuse``); its settle and release are no-ops.
    """
    request_key: str
    feature: str
    recorded: bool
    decision: str
    lines: dict[tuple[str, int], _Granted] = field(default_factory=dict)

    def _line(self, provider: str, line_no: int | None) -> _Granted | None:
        if not self.recorded:
            return None
        if line_no is not None:
            return self.lines.get((provider, line_no))
        matches = [g for (p, _), g in self.lines.items() if p == provider]
        if len(matches) != 1:
            raise ValueError(f"reservation has {len(matches)} {provider} lines; pass line_no")
        return matches[0]

    async def settle(self, provider: str, actual_usd: float, *, line_no: int | None = None) -> bool:
        """Settle a line at its provider-reported cost. True when recorded."""
        line = self._line(provider, line_no)
        if line is None or line.state != "reserved":
            return False
        actual = _bounded_actual(actual_usd)
        if actual is None:
            # Never settle a bad number as 0 and never release: the line
            # stays open and expires at its estimate (FR-004, FR-005).
            line.state = "left_open"
            logger.error("[ai_budget] decision=settle_invalid_actual provider=%s feature=%s",
                         provider, self.feature)
            return False
        return await self._finish(line, "fn_ai_budget_settle",
                                  {"p_reservation_id": line.reservation_id, "p_actual_usd": actual},
                                  "settled")

    async def settle_at_estimate(self, provider: str, *, line_no: int | None = None) -> bool:
        line = self._line(provider, line_no)
        if line is None or line.state != "reserved":
            return False
        return await self._finish(line, "fn_ai_budget_settle",
                                  {"p_reservation_id": line.reservation_id,
                                   "p_actual_usd": line.estimate_usd},
                                  "settled")

    async def release(self, provider: str, *, line_no: int | None = None) -> bool:
        """Release a line whose request provably was not sent (FR-004)."""
        line = self._line(provider, line_no)
        if line is None or line.state != "reserved":
            return False
        return await self._finish(line, "fn_ai_budget_release",
                                  {"p_reservation_id": line.reservation_id}, "released")

    async def settle_open_at_estimate(self) -> None:
        """Settle every line still reserved at its estimate (end of a bundle)."""
        for (provider, line_no), line in list(self.lines.items()):
            if line.state == "reserved":
                await self.settle_at_estimate(provider, line_no=line_no)

    async def _finish(self, line: _Granted, fn: str, params: dict[str, Any], state: str) -> bool:
        # Mark first: a second settle/release never sends another RPC, and a
        # failed one is left for the sweeper instead of being retried here.
        line.state = state
        try:
            data = await _rpc(fn, params)
            if not isinstance(data, Mapping) or data.get("status") not in (state, "noop"):
                raise _BadShape("status")
            return True
        except asyncio.CancelledError:
            line.state = "left_open"
            raise
        except Exception as exc:
            line.state = "left_open"
            logger.warning("[ai_budget] decision=%s_failed provider=%s feature=%s error=%s",
                           "settle" if fn.endswith("settle") else "release",
                           line.provider, self.feature, type(exc).__name__)
            return False


def _bounded_actual(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value) or value < 0 or value > MAX_STORED_USD:
        return None
    return round(value, 6)


_config_logged = False


def _log_config_once(configs: Mapping[str, Any] | None) -> None:
    global _config_logged
    if _config_logged or configs is not None:
        return
    _config_logged = True
    try:
        logger.info(ai_budget_config.startup_summary())
    except Exception as exc:  # the summary is observability only
        logger.warning("[ai_budget] config summary unavailable: %s", type(exc).__name__)


def _log(decision: str, *, feature: str, reason: str | None = None, scope: str | None = None,
         providers: Iterable[str] = (), level: int = logging.WARNING) -> None:
    logger.log(level, "[ai_budget] decision=%s reason=%s scope=%s providers=%s feature=%s",
               decision, reason or "-", scope or "-", ",".join(sorted(set(providers))) or "-", feature)


def _validate_lines(lines: Sequence[BudgetLine]) -> None:
    if not lines:
        raise ValueError("a reservation needs at least one line")
    keys = set()
    for line in lines:
        if line.provider not in PROVIDERS:
            raise ValueError(f"unknown provider: {line.provider!r}")
        if not line.model or not isinstance(line.line_no, int) or isinstance(line.line_no, bool):
            raise ValueError("a line needs a model and an integer line_no")
        if (line.provider, line.line_no) in keys:
            raise ValueError(f"duplicate line: {line.provider}/{line.line_no}")
        keys.add((line.provider, line.line_no))


def _parse_grant(data: Mapping[str, Any], lines: Sequence[BudgetLine]) -> dict[tuple[str, int], _Granted]:
    rows = data.get("reservations")
    if not isinstance(rows, list):
        raise _BadShape("reservations")
    wanted = {(line.provider, line.line_no) for line in lines}
    granted: dict[tuple[str, int], _Granted] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            raise _BadShape("reservation row")
        provider, line_no = row.get("provider"), row.get("line_no")
        try:
            rid = str(uuid.UUID(str(row.get("id"))))
            est = float(row.get("estimate_usd"))
        except (TypeError, ValueError):
            raise _BadShape("reservation id/estimate") from None
        if not math.isfinite(est) or est <= 0 or (provider, line_no) not in wanted:
            raise _BadShape("reservation line")
        granted[(provider, line_no)] = _Granted(provider, line_no, rid, est)
    if set(granted) != wanted:
        raise _BadShape("reservation lines")
    return granted


async def reserve(
    lines: Sequence[BudgetLine],
    *,
    request_key: str,
    feature: str,
    user_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    ttl_seconds: int = RESERVATION_TTL_SECONDS,
    configs: Mapping[str, ai_budget_config.ScopeConfig] | None = None,
    mode: str | None = None,
) -> Reservation:
    """Reserve every line all-or-nothing (FR-002) before any provider call.

    Returns a :class:`Reservation`, or raises :class:`AIBudgetRefused` (no
    provider request may be sent) or :class:`AIBudgetReplay`. ``request_key``
    identifies one logical attempt; a true retry uses a new key.
    """
    lines = list(lines)
    _validate_lines(lines)
    if not isinstance(request_key, str) or not request_key.strip() or len(request_key) > 200:
        raise ValueError("request_key must be 1-200 characters")
    providers = [line.provider for line in lines]

    # FR-007: before any database read, in both modes, soft lines included.
    if ai_budget_config.kill_switch_on():
        _log("refuse", feature=feature, reason="kill_switch", providers=providers)
        raise AIBudgetRefused("kill_switch")

    _log_config_once(configs)
    mode = mode or ai_budget_config.budget_mode()
    configs = ai_budget_config.load_scope_configs() if configs is None else configs
    soft_only = all(ai_budget_config.mode_for(p) == "soft" for p in providers)

    def refuse(reason: str, scope: str | None = None, period_kind: str | None = None,
               detail: str | None = None) -> Reservation:
        if mode == "shadow":
            _log("would_refuse", feature=feature, reason=reason, scope=scope, providers=providers)
            return Reservation(request_key, feature, recorded=False, decision="would_refuse")
        _log("refuse", feature=feature, reason=reason, scope=scope, providers=providers)
        raise AIBudgetRefused(reason, scope=scope, period_kind=period_kind, detail=detail)

    def allow_unrecorded() -> Reservation:
        # FR-021: only a request whose every provider line is soft.
        logger.warning("[ai_budget] decision=allow_unrecorded scope=anthropic feature=%s", feature)
        return Reservation(request_key, feature, recorded=False, decision="allow_unrecorded")

    # FR-004: a line without an upper bound cannot be reserved.
    for line in lines:
        if _bounded(line.estimate_usd) is None:
            return refuse("config_invalid", scope=line.provider, detail=f"no_estimate:{line.model}")

    # FR-003: a set-but-invalid hard cap refuses that scope alone.
    for provider in sorted(set(providers)):
        cfg = configs.get(provider)
        if cfg is None or (cfg.mode == "hard" and cfg.config_invalid):
            return refuse("config_invalid", scope=provider,
                          detail=getattr(cfg, "env_var", None) or ai_budget_config.env_var_for(provider))

    caps = {scope: cfg.p_caps_entry() for scope, cfg in configs.items()
            if scope == "total" or scope in providers}
    params = {
        "p_request_key": request_key,
        "p_lines": [
            {
                "line_no": line.line_no, "provider": line.provider, "model": line.model,
                "feature": feature, "operation": line.operation,
                "estimate_usd": _bounded(line.estimate_usd),
                "user_id": user_id, "resource_type": resource_type, "resource_id": resource_id,
            }
            for line in lines
        ],
        "p_caps": caps,
        "p_ttl_seconds": ttl_seconds,
    }

    try:
        data = await _rpc("fn_ai_budget_reserve", params)
        if not isinstance(data, Mapping) or not isinstance(data.get("granted"), bool):
            raise _BadShape("granted")
        if data.get("replay") is True:
            replay_lines = data.get("lines")
            if data["granted"] or not isinstance(replay_lines, list):
                raise _BadShape("replay")
            _log("replay", feature=feature, providers=providers, level=logging.INFO)
            raise AIBudgetReplay(request_key, [r for r in replay_lines if isinstance(r, Mapping)])
        if data["granted"]:
            granted = _parse_grant(data, lines)
            return Reservation(request_key, feature, recorded=True, decision="granted", lines=granted)
        reason = data.get("reason")
        if reason not in REASONS or reason in ("kill_switch", "budget_unavailable"):
            raise _BadShape(f"reason {reason!r}")
        scope = data.get("scope") if isinstance(data.get("scope"), str) else None
        period_kind = data.get("period_kind") if isinstance(data.get("period_kind"), str) else None
    except AIBudgetReplay:
        raise
    except Exception as exc:
        # FR-005: error, timeout, bad shape or missing object.
        _log("rpc_failed", feature=feature, reason=type(exc).__name__, providers=providers)
        if soft_only:
            return allow_unrecorded()
        return refuse("budget_unavailable", detail=type(exc).__name__)

    # A soft scope is never refused by a cap or configuration reason; only a
    # provider spend-limit closure (the Console hard stop) refuses it.
    if soft_only and reason != "provider_spend_limit":
        _log("unexpected_soft_refusal", feature=feature, reason=reason, scope=scope, providers=providers)
        return allow_unrecorded()
    return refuse(reason, scope=scope, period_kind=period_kind)


async def close_provider_scope(provider: str) -> bool:
    """FR-009: close ``provider`` for the rest of the UTC day. True on success."""
    try:
        data = await _rpc("fn_ai_budget_close_scope",
                          {"p_scope": provider, "p_day": None, "p_reason": "provider_spend_limit"})
        if not isinstance(data, Mapping) or data.get("status") not in ("closed", "already_closed"):
            raise _BadShape("close_scope")
        return True
    except Exception as exc:
        logger.error("[ai_budget] decision=close_scope_failed provider=%s error=%s",
                     provider, type(exc).__name__)
        return False


async def provider_error_refusal(provider: str, exc: BaseException) -> AIBudgetRefused | None:
    """For a provider error raised after the send: when it reports the
    account's spend limit, close the scope and return the refusal to raise
    (``raise refusal from exc``); otherwise None (transient, FR-009)."""
    if classify_provider_error(exc) != "provider_spend_limit":
        return None
    if isinstance(exc, AIBudgetRefused):
        return exc
    _log("provider_spend_limit", feature="-", reason="provider_spend_limit", scope=provider,
         providers=[provider], level=logging.ERROR)
    await close_provider_scope(provider)
    return AIBudgetRefused("provider_spend_limit", scope=provider, period_kind="day")


class Lease:
    """The handle :func:`guard` yields for its single line."""

    def __init__(self, reservation: Reservation, provider: str) -> None:
        self.reservation = reservation
        self.provider = provider
        self._actual: float | None = None
        self._not_sent = False

    @property
    def recorded(self) -> bool:
        return self.reservation.recorded

    def settle(self, actual_usd: float) -> None:
        """Record the provider-reported cost; settled when the block exits."""
        self._actual = actual_usd

    def not_sent(self) -> None:
        """The request provably never reached the provider; released on exit."""
        self._not_sent = True


class _Guard:
    def __init__(self, line: BudgetLine, kwargs: dict[str, Any]) -> None:
        self._line = line
        self._kwargs = kwargs
        self._lease: Lease | None = None

    async def __aenter__(self) -> Lease:
        reservation = await reserve([self._line], **self._kwargs)
        self._lease = Lease(reservation, self._line.provider)
        return self._lease

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        lease = self._lease
        assert lease is not None
        res, provider, line_no = lease.reservation, lease.provider, self._line.line_no
        if exc is None:
            if lease._not_sent:
                await res.release(provider, line_no=line_no)
            elif lease._actual is not None:
                await res.settle(provider, lease._actual, line_no=line_no)
            else:
                await res.settle_at_estimate(provider, line_no=line_no)
            return False
        if not isinstance(exc, Exception):
            # Cancelled (or interpreter exit): no RPC from a cancelled task.
            # The line stays open and the sweeper settles it at its
            # estimate, which is the same outcome (FR-004, FR-014).
            return False
        if lease._not_sent or _provably_not_sent(exc):
            await res.release(provider, line_no=line_no)
        elif lease._actual is not None:
            await res.settle(provider, lease._actual, line_no=line_no)
        else:
            await res.settle_at_estimate(provider, line_no=line_no)
        if not isinstance(exc, AIBudgetRefused):
            refusal = await provider_error_refusal(provider, exc)
            if refusal is not None:
                raise refusal from exc
        return False


def guard(
    provider: str,
    model: str,
    feature: str,
    estimate_usd: float | None,
    *,
    request_key: str,
    operation: str | None = None,
    user_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    ttl_seconds: int = RESERVATION_TTL_SECONDS,
    configs: Mapping[str, ai_budget_config.ScopeConfig] | None = None,
    mode: str | None = None,
) -> _Guard:
    """Async context manager around one provider request (FR-001).

    Reserves on entry (raising :class:`AIBudgetRefused` or
    :class:`AIBudgetReplay` before the body runs). On exit it settles at the
    cost given to ``lease.settle``, releases when the request provably was
    not sent, and otherwise settles at the estimate. A provider error that
    reports the account's spend limit is re-raised as
    ``AIBudgetRefused("provider_spend_limit")`` after closing the scope.
    """
    line = BudgetLine(provider, model, estimate_usd, operation=operation)
    return _Guard(line, {
        "request_key": request_key, "feature": feature, "user_id": user_id,
        "resource_type": resource_type, "resource_id": resource_id,
        "ttl_seconds": ttl_seconds, "configs": configs, "mode": mode,
    })


def kill_switch_on() -> bool:
    """FR-007, re-exported for call sites: read from the environment per call."""
    return ai_budget_config.kill_switch_on()
