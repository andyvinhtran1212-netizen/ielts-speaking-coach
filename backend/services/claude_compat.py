"""Request and response compatibility for short Claude JSON tasks."""

from math import ceil
from typing import Any


def json_request_kwargs(
    model: str, *, max_tokens: int, temperature: float | None = None,
) -> dict[str, Any]:
    request: dict[str, Any] = {"model": model, "max_tokens": max_tokens}
    if model == "claude-haiku-5-5":
        # The newer tokenizer uses ~30% more tokens for the same text. These
        # bounded tasks need no reasoning tokens. extra_body works with the
        # pinned Anthropic 0.39 SDK and was verified against the Messages API.
        request["max_tokens"] = ceil(max_tokens * 1.3)
        request["extra_body"] = {"thinking": {"type": "disabled"}}
    elif temperature is not None:
        request["temperature"] = temperature
    return request


def response_text(response: Any) -> str:
    """Do not parse a thinking block, refusal or truncated JSON as an answer."""
    if getattr(response, "stop_reason", None) in (
        "refusal", "max_tokens", "model_context_window_exceeded",
    ):
        raise ValueError("Claude did not complete the JSON response")
    texts = [
        block.text for block in (response.content or [])
        if getattr(block, "type", "text") == "text"
        and isinstance(getattr(block, "text", None), str)
    ]
    return "".join(texts).strip()
