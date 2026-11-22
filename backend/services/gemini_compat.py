"""Small request-shape compatibility rules shared by Gemini call sites."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

# https://ai.google.dev/gemini-api/docs/deprecations — checked 2026-11-22:
# from 2026-12-01 Google routes requests for gemini-2.5-pro to Gemini 3.8
# Flash, so those requests must follow 3.8's request rules. (gemini-2.5-flash
# goes to 3.5 Flash-Lite, which keeps the older sampling controls.)
_SERVER_REROUTES: dict[str, tuple[date, str]] = {
    "gemini-2.5-pro": (date(2026, 12, 1), "gemini-3.8-flash"),
}


def served_gemini_model(model_name: str, *, at: date | None = None) -> str:
    """The model Google actually serves for ``model_name`` on ``at`` (UTC today)."""
    reroute = _SERVER_REROUTES.get(model_name)
    if reroute is None:
        return model_name
    day = at or datetime.now(timezone.utc).date()
    starts, target = reroute
    return target if day >= starts else model_name


def generation_config_kwargs(
    model_name: str,
    *,
    response_mime_type: str,
    max_output_tokens: int,
    temperature: float | None = None,
    at: date | None = None,
) -> dict[str, Any]:
    """Build a config without controls rejected by Gemini 3.8."""
    config: dict[str, Any] = {
        "response_mime_type": response_mime_type,
        "max_output_tokens": max_output_tokens,
    }
    served = served_gemini_model(model_name, at=at)
    if temperature is not None and not served.startswith("gemini-3.8-"):
        config["temperature"] = temperature
    return config
