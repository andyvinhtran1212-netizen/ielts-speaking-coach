"""Canonical, effective-dated AI list-price estimates.

The provider invoice remains the billing source of truth.  This module gives
the application one deterministic estimate for dashboards and experiments;
call sites must not embed their own token prices.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone


@dataclass(frozen=True)
class TokenRate:
    provider: str
    model: str
    effective_from: date
    effective_until: date | None
    input_per_million: float
    output_per_million: float
    cache_read_per_million: float | None = None
    cache_write_per_million: float | None = None

    @property
    def version(self) -> str:
        end = self.effective_until.isoformat() if self.effective_until else "open"
        return f"{self.provider}:{self.model}:{self.effective_from.isoformat()}:{end}"


@dataclass(frozen=True)
class UnitRate:
    provider: str
    model: str
    effective_from: date
    effective_until: date | None
    unit: str
    usd_per_unit: float

    @property
    def version(self) -> str:
        end = self.effective_until.isoformat() if self.effective_until else "open"
        return f"{self.provider}:{self.model}:{self.effective_from.isoformat()}:{end}"


# Public list prices verified 2026-09-18.  A new price period is a new row;
# never rewrite an old period because historical costs must remain reproducible.
TOKEN_RATES: tuple[TokenRate, ...] = (
    TokenRate("anthropic", "claude-haiku-4-5-20251001", date(2025, 10, 15), None,
              1.00, 5.00, cache_read_per_million=0.10, cache_write_per_million=1.25),
    TokenRate("anthropic", "claude-sonnet-4-6", date(2026, 2, 17), None,
              3.00, 15.00, cache_read_per_million=0.30, cache_write_per_million=3.75),
    TokenRate("anthropic", "claude-sonnet-5", date(2026, 6, 30), None,
              2.00, 10.00, cache_read_per_million=0.20, cache_write_per_million=2.50),
    TokenRate("google", "gemini-2.5-flash", date(2025, 6, 17), None, 0.30, 2.50),
    TokenRate("google", "gemini-2.5-pro", date(2025, 6, 17), None, 1.25, 10.00),
    TokenRate("google", "gemini-3.1-flash-lite", date(2026, 5, 7), None, 0.25, 1.50),
    TokenRate("google", "gemini-3.5-flash-lite", date(2026, 7, 21), None, 0.30, 2.50),
    TokenRate("google", "gemini-3.5-flash", date(2026, 5, 19), None, 1.50, 9.00),
    TokenRate("google", "gemini-3.8-flash", date(2026, 9, 2), date(2026, 12, 31),
              0.75, 3.75),
    TokenRate("google", "gemini-3.8-flash", date(2027, 1, 1), None, 1.50, 7.50),
    TokenRate("google", "gemini-3.1-pro-preview", date(2026, 2, 19), None, 2.00, 12.00),
)

UNIT_RATES: tuple[UnitRate, ...] = (
    UnitRate("openai", "whisper-1", date(2023, 3, 1), None,
             "audio_second", 0.006 / 60.0),
    UnitRate("openai", "gpt-transcribe", date(2026, 1, 1), None,
             "audio_second", 0.0045 / 60.0),
    UnitRate("openai", "tts-1", date(2023, 11, 6), None,
             "text_character", 15.00 / 1_000_000.0),
    UnitRate("elevenlabs", "eleven_multilingual_v2", date(2026, 9, 18), None,
             "text_character", 0.10 / 1_000.0),
    UnitRate("elevenlabs", "eleven_flash_v2_5", date(2026, 9, 18), None,
             "text_character", 0.05 / 1_000.0),
)


def _as_date(at: datetime | date | None) -> date:
    if at is None:
        return datetime.now(timezone.utc).date()
    return at.date() if isinstance(at, datetime) else at


def token_rate(provider: str, model: str, *, at: datetime | date | None = None) -> TokenRate | None:
    day = _as_date(at)
    matches = [
        rate for rate in TOKEN_RATES
        if rate.provider == provider and rate.model == model
        and rate.effective_from <= day
        and (rate.effective_until is None or day <= rate.effective_until)
    ]
    return max(matches, key=lambda rate: rate.effective_from) if matches else None


def unit_rate(
    provider: str,
    model: str,
    unit: str,
    *,
    at: datetime | date | None = None,
) -> UnitRate | None:
    day = _as_date(at)
    matches = [
        rate for rate in UNIT_RATES
        if rate.provider == provider and rate.model == model and rate.unit == unit
        and rate.effective_from <= day
        and (rate.effective_until is None or day <= rate.effective_until)
    ]
    return max(matches, key=lambda rate: rate.effective_from) if matches else None


def estimate_token_cost(
    provider: str,
    model: str,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
    thinking_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    at: datetime | date | None = None,
) -> tuple[float | None, str | None]:
    rate = token_rate(provider, model, at=at)
    if rate is None:
        return None, None
    cost = max(0, input_tokens) * rate.input_per_million / 1_000_000
    cost += max(0, output_tokens + thinking_tokens) * rate.output_per_million / 1_000_000
    if cache_read_tokens:
        if rate.cache_read_per_million is None:
            return None, rate.version
        cost += max(0, cache_read_tokens) * rate.cache_read_per_million / 1_000_000
    if cache_write_tokens:
        if rate.cache_write_per_million is None:
            return None, rate.version
        cost += max(0, cache_write_tokens) * rate.cache_write_per_million / 1_000_000
    return round(cost, 8), rate.version


def estimate_unit_cost(
    provider: str,
    model: str,
    unit: str,
    quantity: float,
    *,
    at: datetime | date | None = None,
) -> tuple[float | None, str | None]:
    rate = unit_rate(provider, model, unit, at=at)
    if rate is None:
        return None, None
    return round(max(0.0, quantity) * rate.usd_per_unit, 8), rate.version


def effective_logged_cost(row: dict) -> tuple[float | None, str | None]:
    """Return a trustworthy stored cost, or re-price one legacy log row.

    Rows written by the new ledger carry ``pricing_version``. Legacy rows do
    not, and their stored Gemini/Claude constants are known to be stale, so the
    dashboard recalculates them from raw units without mutating history.
    """
    # Explicitly unpriced attempts (Azure regional pricing, provider failures,
    # missing usage metadata) must never be turned into $0 or re-priced from a
    # model catalog merely because their raw counters happen to be zero.
    if row.get("cost_source") == "unpriced":
        return None, None

    if row.get("pricing_version"):
        value = row.get("cost_usd_est")
        return (float(value), row.get("pricing_version")) if value is not None else (None, row.get("pricing_version"))

    service = row.get("service")
    model = row.get("model") or ""
    created_at = row.get("created_at")
    at = None
    if isinstance(created_at, str):
        try:
            at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except ValueError:
            at = None

    result: tuple[float | None, str | None]
    if service == "claude":
        result = estimate_token_cost(
            "anthropic", model,
            input_tokens=row.get("input_tokens") or 0,
            output_tokens=row.get("output_tokens") or 0,
            cache_read_tokens=row.get("cache_read_tokens") or 0,
            cache_write_tokens=row.get("cache_write_tokens") or 0,
            at=at,
        )
    elif service == "gemini":
        result = estimate_token_cost(
            "google", model,
            input_tokens=row.get("input_tokens") or 0,
            output_tokens=row.get("output_tokens") or 0,
            thinking_tokens=row.get("thinking_tokens") or 0,
            at=at,
        )
    elif service == "whisper":
        result = estimate_unit_cost(
            "openai", model, "audio_second", row.get("audio_seconds") or 0,
            at=at,
        )
    elif service in {"tts", "elevenlabs"}:
        provider = "elevenlabs" if service == "elevenlabs" else "openai"
        result = estimate_unit_cost(
            provider, model, "text_character", row.get("text_chars") or 0,
            at=at,
        )
    else:
        result = (None, None)

    if result[0] is not None:
        return result
    # A stale stored estimate is more truthful than silently turning known
    # historical spend into zero when a retired model predates this catalog.
    stored = row.get("cost_usd_est")
    return (float(stored), "legacy_stored") if stored is not None else (None, None)
