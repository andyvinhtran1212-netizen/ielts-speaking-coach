"""Request and response compatibility for short Claude JSON tasks."""

from math import ceil
from typing import Any


class ClaudeResponseError(ValueError):
    """A billable response that cannot be used as the requested answer."""

    def __init__(self, stop_reason: str):
        self.error_code = f"claude_{stop_reason}"
        super().__init__(f"Claude did not complete the JSON response: {stop_reason}")


class ClaudeTruncatedResponseError(ClaudeResponseError):
    """Output hit its token budget; a fresh attempt may complete."""


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
    elif model == "claude-sonnet-5-5":
        # Sonnet 5.5 rejects `disabled` thinking and non-default sampling;
        # `between_tools` is its no-up-front-thinking mode (default effort
        # `high` is within its allowed range).
        request["extra_body"] = {"thinking": {"type": "between_tools"}}
    elif temperature is not None:
        request["temperature"] = temperature
    return request


def response_text(response: Any) -> str:
    """Do not parse a thinking block, refusal or truncated JSON as an answer."""
    stop_reason = getattr(response, "stop_reason", None)
    if stop_reason == "max_tokens":
        raise ClaudeTruncatedResponseError(stop_reason)
    if stop_reason in ("refusal", "model_context_window_exceeded"):
        raise ClaudeResponseError(stop_reason)
    texts = [
        block.text for block in (response.content or [])
        if getattr(block, "type", "text") == "text"
        and isinstance(getattr(block, "text", None), str)
    ]
    return "".join(texts).strip()
