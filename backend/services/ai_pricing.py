"""Canonical, effective-dated AI list-price estimates.

The provider invoice remains the billing source of truth.  This module gives
the application one deterministic estimate for dashboards and experiments;
call sites must not embed their own token prices.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, timezone


@dataclass(frozen=True)
class ImageTokenRule:
    """A provider's documented image-input token rule (AIBUDGET-0033 FR-004).

    ``kind`` is ``claude_patches`` (one token per 28x28 patch, capped at the
    model's visual-token budget after its own downscale), ``gemini_tiles``
    (258 tokens per crop-unit tile) or ``fixed_per_image`` (a flat count per
    image at the request's media resolution).
    """
    kind: str
    source_url: str
    source_checked: date
    max_tokens: int | None = None
    per_image_tokens: int | None = None


# https://platform.claude.com/docs/en/build-with-claude/vision ("Resolution
# and token cost") and .../vision-coordinates — checked 2026-10-29. Claude
# 4.7 and later models are on the high-resolution tier (2,576 px long edge,
# 4,784 visual tokens); all other models on the standard tier (1,568 / 1,568).
_CLAUDE_STANDARD_IMAGES = ImageTokenRule(
    "claude_patches", "https://platform.claude.com/docs/en/build-with-claude/vision",
    date(2026, 10, 29), max_tokens=1568,
)
_CLAUDE_HIGH_RES_IMAGES = ImageTokenRule(
    "claude_patches", "https://platform.claude.com/docs/en/build-with-claude/vision",
    date(2026, 10, 29), max_tokens=4784,
)
# https://ai.google.dev/gemini-api/docs/image-understanding — checked
# 2026-10-29: 258 tokens when both sides are <= 384 px, otherwise 258 per
# tile with a crop unit of floor(min(w, h) / 1.5).
_GEMINI_TILE_IMAGES = ImageTokenRule(
    "gemini_tiles", "https://ai.google.dev/gemini-api/docs/image-understanding",
    date(2026, 10, 29), per_image_tokens=258,
)
# https://ai.google.dev/gemini-api/docs/media-resolution — checked
# 2026-10-29: Gemini 3 models count 1120 tokens per image when
# media_resolution is unspecified (the default, equal to "high"). No call
# site sets media_resolution today; one that asks for ultra_high (2240) must
# not use this rule.
_GEMINI_3_DEFAULT_IMAGES = ImageTokenRule(
    "fixed_per_image", "https://ai.google.dev/gemini-api/docs/media-resolution",
    date(2026, 10, 29), per_image_tokens=1120,
)


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
    image_rule: ImageTokenRule | None = None

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
    # Named in the version when the provider prices by resource tier.
    tier: str | None = None

    @property
    def version(self) -> str:
        end = self.effective_until.isoformat() if self.effective_until else "open"
        model = f"{self.model}:{self.tier}" if self.tier else self.model
        return f"{self.provider}:{model}:{self.effective_from.isoformat()}:{end}"


# Catalog baseline verified 2026-09-18; Haiku 5.5 and ElevenLabs rechecked
# 2026-10-12. A new price period is a new row;
# never rewrite an old period because historical costs must remain reproducible.
TOKEN_RATES: tuple[TokenRate, ...] = (
    TokenRate("anthropic", "claude-haiku-4-5-20251001", date(2025, 10, 15), None,
              1.00, 5.00, cache_read_per_million=0.10, cache_write_per_million=1.25,
              image_rule=_CLAUDE_STANDARD_IMAGES),
    # https://platform.claude.com/docs/en/models/haiku-5-5/overview
    # Base rates apply through 100k prompt tokens; see the multiplier below.
    TokenRate("anthropic", "claude-haiku-5-5", date(2026, 10, 7), None,
              0.10, 0.50, cache_read_per_million=0.01, cache_write_per_million=0.125,
              image_rule=_CLAUDE_HIGH_RES_IMAGES),
    TokenRate("anthropic", "claude-sonnet-4-6", date(2026, 2, 17), None,
              3.00, 15.00, cache_read_per_million=0.30, cache_write_per_million=3.75,
              image_rule=_CLAUDE_STANDARD_IMAGES),
    TokenRate("anthropic", "claude-sonnet-5", date(2026, 6, 30), None,
              2.00, 10.00, cache_read_per_million=0.20, cache_write_per_million=2.50,
              image_rule=_CLAUDE_HIGH_RES_IMAGES),
    # https://platform.claude.com/docs/en/about-claude/pricing — checked
    # 2026-10-26: cache hits are 0.05x base input on Sonnet 5.5.
    TokenRate("anthropic", "claude-sonnet-5-5", date(2026, 9, 28), None,
              2.00, 10.00, cache_read_per_million=0.10, cache_write_per_million=2.50,
              image_rule=_CLAUDE_HIGH_RES_IMAGES),
    TokenRate("google", "gemini-2.5-flash", date(2025, 6, 17), None, 0.30, 2.50,
              image_rule=_GEMINI_TILE_IMAGES),
    TokenRate("google", "gemini-2.5-pro", date(2025, 6, 17), None, 1.25, 10.00,
              image_rule=_GEMINI_TILE_IMAGES),
    TokenRate("google", "gemini-3.1-flash-lite", date(2026, 5, 7), None, 0.25, 1.50,
              image_rule=_GEMINI_3_DEFAULT_IMAGES),
    TokenRate("google", "gemini-3.5-flash-lite", date(2026, 7, 21), None, 0.30, 2.50,
              image_rule=_GEMINI_3_DEFAULT_IMAGES),
    TokenRate("google", "gemini-3.5-flash", date(2026, 5, 19), None, 1.50, 9.00,
              image_rule=_GEMINI_3_DEFAULT_IMAGES),
    TokenRate("google", "gemini-3.8-flash", date(2026, 9, 2), date(2026, 12, 31),
              0.75, 3.75, image_rule=_GEMINI_3_DEFAULT_IMAGES),
    TokenRate("google", "gemini-3.8-flash", date(2027, 1, 1), None, 1.50, 7.50,
              image_rule=_GEMINI_3_DEFAULT_IMAGES),
    TokenRate("google", "gemini-3.1-pro-preview", date(2026, 2, 19), None, 2.00, 12.00,
              image_rule=_GEMINI_3_DEFAULT_IMAGES),
)

UNIT_RATES: tuple[UnitRate, ...] = (
    UnitRate("openai", "whisper-1", date(2023, 3, 1), None,
             "audio_second", 0.006 / 60.0),
    UnitRate("openai", "gpt-transcribe", date(2026, 1, 1), None,
             "audio_second", 0.0045 / 60.0),
    UnitRate("openai", "tts-1", date(2023, 11, 6), None,
             "text_character", 15.00 / 1_000_000.0),
    UnitRate("elevenlabs", "eleven_multilingual_v2", date(2026, 9, 18), date(2026, 10, 11),
             "text_character", 0.10 / 1_000.0),
    UnitRate("elevenlabs", "eleven_flash_v2_5", date(2026, 9, 18), date(2026, 10, 11),
             "text_character", 0.05 / 1_000.0),
    # https://elevenlabs.io/pricing/api — observed on 2026-10-12. Apply
    # prospectively; the page does not establish an earlier effective date.
    # These are API list-price estimates, not subscription/credit invoices.
    UnitRate("elevenlabs", "eleven_multilingual_v2", date(2026, 10, 12), None,
             "text_character", 0.08 / 1_000.0),
    UnitRate("elevenlabs", "eleven_flash_v2_5", date(2026, 10, 12), None,
             "text_character", 0.04 / 1_000.0),
    # AIBUDGET-0033 Q1 (16:26 2026-10-28): the Speech resource is on S0.
    # Real-time speech to text $1.00 per audio hour plus the Pronunciation
    # Assessment (prosody) add-on, one enhanced feature at $0.30 per audio
    # hour, billed per second of audio sent. Source: the Azure Speech price
    # page and the Azure Retail Prices API (meters "S1 Speech To Text" and
    # "S1 Speech to Text Enhanced Feature Audio", the same in every
    # commercial region; US Gov is higher and unused) — observed 2026-10-29
    # and applied prospectively.
    UnitRate("azure", "pronunciation-assessment", date(2026, 10, 29), None,
             "audio_second", (1.00 + 0.30) / 3600.0, tier="s0"),
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


def image_input_tokens_bound(
    provider: str,
    model: str,
    width: int,
    height: int,
    *,
    at: datetime | date | None = None,
) -> int | None:
    """Upper bound on the input tokens one image adds (FR-004).

    ``width``/``height`` are the decoded pixel dimensions of the bytes sent.
    Returns None when the model has no catalog price or image rule, or the
    dimensions are not positive integers; the caller then refuses the request
    before any provider call.
    """
    if isinstance(width, bool) or isinstance(height, bool):
        return None
    if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0:
        return None
    rate = token_rate(provider, model, at=at)
    rule = rate.image_rule if rate else None
    if rule is None:
        return None
    if rule.kind == "claude_patches" and rule.max_tokens:
        # Downscaling only lowers the patch count, so min() is never below
        # what the model charges for the padded, resized image.
        return min(math.ceil(width / 28) * math.ceil(height / 28), rule.max_tokens)
    if rule.kind == "gemini_tiles" and rule.per_image_tokens:
        if width <= 384 and height <= 384:
            return rule.per_image_tokens
        crop_unit = max(1, math.floor(min(width, height) / 1.5))
        tiles = math.ceil(width / crop_unit) * math.ceil(height / crop_unit)
        return tiles * rule.per_image_tokens
    if rule.kind == "fixed_per_image" and rule.per_image_tokens:
        return rule.per_image_tokens
    return None


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
    # Anthropic's prompt length includes cache reads and writes. Haiku 5.5
    # charges 5x on the entire request above 100k, not just the excess tokens.
    if provider == "anthropic" and model == "claude-haiku-5-5":
        prompt_tokens = sum(max(0, n) for n in (input_tokens, cache_read_tokens, cache_write_tokens))
        if prompt_tokens > 100_000:
            cost *= 5
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
