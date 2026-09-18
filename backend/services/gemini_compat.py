"""Small request-shape compatibility rules shared by Gemini call sites."""

from __future__ import annotations

from typing import Any


def generation_config_kwargs(
    model_name: str,
    *,
    response_mime_type: str,
    max_output_tokens: int,
    temperature: float | None = None,
) -> dict[str, Any]:
    """Build a config without controls rejected by Gemini 3.8."""
    config: dict[str, Any] = {
        "response_mime_type": response_mime_type,
        "max_output_tokens": max_output_tokens,
    }
    if temperature is not None and not model_name.startswith("gemini-3.8-"):
        config["temperature"] = temperature
    return config
