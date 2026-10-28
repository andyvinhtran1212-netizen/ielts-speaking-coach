"""AIBUDGET-0033 budget configuration (T001; FR-003, FR-006, FR-007, FR-015, FR-021).

Parses the ``AI_BUDGET_*`` base caps, ``AI_BUDGET_MODE`` and ``AI_KILL_SWITCH``
plus the existing per-user paid-AI quotas into per-scope values and
``config_invalid`` flags. Pure parsing: no database, no provider call, and
nothing here refuses a request — ``services/ai_budget.py`` (T003) does that.

Rules fixed by the spec (changing any of them needs a spec revision):

- An unset or empty cap variable takes its default and is never
  ``config_invalid``, so a missing configuration cannot block AI.
- A set value that is unparseable, not finite, zero or negative is
  ``config_invalid`` for that scope alone. It never means "unlimited".
- ``anthropic`` and ``total`` are soft (alert only); every other scope is hard.
- The daily cap is the monthly cap ÷ 30 × 2.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Any, Mapping

SCOPES: tuple[str, ...] = ("total", "anthropic", "google", "azure", "openai", "elevenlabs")

# FR-003, owner decision (b), 2026-10-28 09:35.
DEFAULT_MONTHLY_USD: dict[str, float] = {
    "total": 200.0,
    "anthropic": 100.0,
    "google": 20.0,
    "azure": 20.0,
    "openai": 20.0,
    "elevenlabs": 20.0,
}

# FR-002/FR-021: a constant, not a variable.
SCOPE_MODES: dict[str, str] = {"anthropic": "soft", "total": "soft"}

# FR-015: percent of the monthly cap; owner decision (f) drops Anthropic's 50%.
DEFAULT_MONTHLY_THRESHOLDS: tuple[int, ...] = (50, 80, 100)
MONTHLY_THRESHOLDS: dict[str, tuple[int, ...]] = {"anthropic": (80, 100)}

BUDGET_MODES: tuple[str, ...] = ("enforce", "shadow")

KILL_SWITCH_VAR = "AI_KILL_SWITCH"
_KILL_SWITCH_OFF = frozenset({"off", "false", "0", ""})

# FR-006: existing paid-AI quotas. A value of zero or less is config_invalid
# (refuse) instead of "no cap".
PAID_AI_QUOTA_VARS: tuple[str, ...] = (
    "MAX_GRADINGS_PER_USER_PER_DAY",
    "TTS_DAILY_LIMIT_PER_USER",
    "TTS_IP_MAX_PER_MINUTE",
    "LISTENING_GIST_DAILY_LIMIT_PER_USER",
    "LISTENING_GIST_MAX_PER_MINUTE",
)


def env_var_for(scope: str) -> str:
    return f"AI_BUDGET_MONTHLY_USD_{scope.upper()}"


def mode_for(scope: str) -> str:
    return SCOPE_MODES.get(scope, "hard")


def monthly_thresholds_for(scope: str) -> tuple[int, ...]:
    return MONTHLY_THRESHOLDS.get(scope, DEFAULT_MONTHLY_THRESHOLDS)


@dataclass(frozen=True)
class ScopeConfig:
    scope: str
    mode: str
    env_var: str
    monthly_usd: float | None
    daily_usd: float | None
    monthly_thresholds: tuple[int, ...]
    config_error: str | None = None

    @property
    def config_invalid(self) -> bool:
        return self.config_error is not None

    def p_caps_entry(self) -> dict[str, Any]:
        """The ``p_caps`` value for ``fn_ai_budget_reserve`` (plan.md item 7).

        An invalid scope sends null ``month``/``day``: a soft scope is then
        never evaluated for alerts, and the function rejects a hard one.
        """
        return {
            "month": self.monthly_usd,
            "day": self.daily_usd,
            "mode": self.mode,
            "thresholds": list(self.monthly_thresholds),
        }


@dataclass(frozen=True)
class QuotaConfig:
    name: str
    value: int | None
    config_error: str | None = None

    @property
    def config_invalid(self) -> bool:
        return self.config_error is not None


def _parse_cap(raw: Any) -> tuple[float | None, str | None]:
    """Return ``(value, error)``. ``(None, None)`` means "use the default"."""
    if raw is None:
        return None, None
    if isinstance(raw, bool):
        return None, "not a number"
    if isinstance(raw, (int, float)):
        value = float(raw)
    else:
        text = str(raw).strip()
        if not text:
            return None, None
        try:
            value = float(text)
        except ValueError:
            return None, "not a number"
    if not math.isfinite(value):
        return None, "not a finite number"
    if value <= 0:
        return None, "must be greater than zero"
    return value, None


def parse_scope(scope: str, raw: Any) -> ScopeConfig:
    if scope not in DEFAULT_MONTHLY_USD:
        raise ValueError(f"unknown budget scope: {scope!r}")
    value, error = _parse_cap(raw)
    if error is not None:
        monthly = daily = None
    else:
        monthly = DEFAULT_MONTHLY_USD[scope] if value is None else value
        daily = monthly / 30.0 * 2.0
    return ScopeConfig(
        scope=scope,
        mode=mode_for(scope),
        env_var=env_var_for(scope),
        monthly_usd=monthly,
        daily_usd=daily,
        monthly_thresholds=monthly_thresholds_for(scope),
        config_error=error,
    )


def _settings_source() -> Any:
    from config import settings

    return settings


def _read(source: Any, name: str) -> Any:
    if isinstance(source, Mapping):
        return source.get(name)
    return getattr(source, name, None)


def load_scope_configs(source: Any = None) -> dict[str, ScopeConfig]:
    """Parse every scope from ``source`` (a mapping, or ``config.settings``)."""
    source = _settings_source() if source is None else source
    return {scope: parse_scope(scope, _read(source, env_var_for(scope))) for scope in SCOPES}


def p_caps(configs: Mapping[str, ScopeConfig] | None = None) -> dict[str, dict[str, Any]]:
    configs = load_scope_configs() if configs is None else configs
    return {scope: cfg.p_caps_entry() for scope, cfg in configs.items()}


def budget_mode(source: Any = None) -> str:
    """``enforce`` unless ``AI_BUDGET_MODE`` is exactly ``shadow`` (case-insensitive)."""
    source = _settings_source() if source is None else source
    raw = _read(source, "AI_BUDGET_MODE")
    value = str(raw).strip().lower() if raw is not None else ""
    return "shadow" if value == "shadow" else "enforce"


def kill_switch_on(environ: Mapping[str, str] | None = None) -> bool:
    """FR-007: read at call time, never from the database or cached settings.

    Only ``off``, ``false``, ``0`` or empty (case-insensitive, trimmed) leave
    it off; any other value, including a typo, turns it on.
    """
    environ = os.environ if environ is None else environ
    raw = environ.get(KILL_SWITCH_VAR)
    return (raw or "").strip().lower() not in _KILL_SWITCH_OFF


def _parse_quota(name: str, raw: Any) -> QuotaConfig:
    if isinstance(raw, bool) or raw is None:
        return QuotaConfig(name, None, "not set" if raw is None else "not a number")
    try:
        value = int(raw) if isinstance(raw, int) else int(str(raw).strip())
    except ValueError:
        return QuotaConfig(name, None, "not a number")
    if value <= 0:
        return QuotaConfig(name, value, "must be greater than zero")
    return QuotaConfig(name, value)


def load_paid_ai_quotas(source: Any = None) -> dict[str, QuotaConfig]:
    """FR-006 validation of the existing per-user/per-IP paid-AI quotas."""
    source = _settings_source() if source is None else source
    return {name: _parse_quota(name, _read(source, name)) for name in PAID_AI_QUOTA_VARS}


def startup_summary(source: Any = None, environ: Mapping[str, str] | None = None) -> str:
    """One log line with the parsed values. Caps and flags only; no secrets."""
    parts = [f"mode={budget_mode(source)}", f"kill_switch={'on' if kill_switch_on(environ) else 'off'}"]
    for scope, cfg in load_scope_configs(source).items():
        if cfg.config_invalid:
            parts.append(f"{scope}={cfg.mode}:config_invalid({cfg.env_var})")
        else:
            parts.append(f"{scope}={cfg.mode}:{cfg.monthly_usd:g}/month")
    for name, quota in load_paid_ai_quotas(source).items():
        if quota.config_invalid:
            parts.append(f"{name}=config_invalid")
    return "[ai_budget] config " + " ".join(parts)
