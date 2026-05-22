"""
backend/tests/test_grading_providers.py — Sprint 14.3

Provider adapter unit tests. Each adapter wraps one LLM SDK and must
classify its native exceptions into our domain error types
(:class:`RetryableError` / :class:`NonRetryableError`) according to
Andy's locks L2/L3.

The tests inject fake SDK clients to avoid live API calls; the
classification logic is the contract we want to pin.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


# ── Fixtures: fake Anthropic + Gemini SDK shapes ─────────────────────────────


def _fake_anthropic_status_error(status_code: int) -> Exception:
    """Build an `anthropic.APIStatusError` lookalike. The real
    constructor requires a fully-shaped httpx.Response; subclass with
    only the `status_code` attribute the adapter actually reads."""
    import anthropic

    class _FakeStatusError(anthropic.APIStatusError):
        def __init__(self, code):
            self.status_code = code
            # Skip parent __init__ — it expects an httpx.Response.
            Exception.__init__(self, f"fake {code}")

    return _FakeStatusError(status_code)


def _fake_anthropic_response(text: str = '{"ok": true}') -> SimpleNamespace:
    return SimpleNamespace(
        content=[SimpleNamespace(text=text)],
        usage=SimpleNamespace(
            input_tokens=10, output_tokens=20,
            cache_read_input_tokens=0, cache_creation_input_tokens=0,
        ),
    )


def _build_claude_provider(side_effect=None, return_value=None):
    """Wire a ClaudeHaikuProvider with an injected fake client."""
    from services.grading_providers.claude import ClaudeHaikuProvider

    fake_client = MagicMock()
    fake_client.beta.prompt_caching.messages.create = AsyncMock(
        side_effect=side_effect,
        return_value=return_value if side_effect is None else None,
    )
    return ClaudeHaikuProvider(client=fake_client), fake_client


# ── Claude provider — error classification (L2 / L3) ─────────────────────────


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504, 529])
@pytest.mark.asyncio
async def test_claude_retryable_status_codes(status):
    """L2: 5xx + 429 + 529 must classify as RetryableError so the
    orchestrator's retry budget kicks in."""
    from services.grading_providers import RetryableError

    provider, _ = _build_claude_provider(
        side_effect=_fake_anthropic_status_error(status),
    )
    with pytest.raises(RetryableError) as excinfo:
        await provider.invoke("sys", "user")
    assert excinfo.value.provider == "claude_haiku"
    assert excinfo.value.status == status


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
@pytest.mark.asyncio
async def test_claude_non_retryable_status_codes(status):
    """L3: 4xx (incl. auth + bad request) must NOT retry — escalate
    straight to the next provider."""
    from services.grading_providers import NonRetryableError

    provider, _ = _build_claude_provider(
        side_effect=_fake_anthropic_status_error(status),
    )
    with pytest.raises(NonRetryableError) as excinfo:
        await provider.invoke("sys", "user")
    assert excinfo.value.provider == "claude_haiku"
    assert excinfo.value.status == status


@pytest.mark.asyncio
async def test_claude_timeout_is_retryable():
    """Connection-timeout = transient. L2 says retry."""
    import anthropic
    from services.grading_providers import RetryableError

    provider, _ = _build_claude_provider(
        side_effect=anthropic.APITimeoutError(request=MagicMock()),
    )
    with pytest.raises(RetryableError) as excinfo:
        await provider.invoke("sys", "user")
    assert excinfo.value.status == "timeout"


@pytest.mark.asyncio
async def test_claude_connection_error_is_retryable():
    import anthropic
    from services.grading_providers import RetryableError

    provider, _ = _build_claude_provider(
        side_effect=anthropic.APIConnectionError(request=MagicMock()),
    )
    with pytest.raises(RetryableError) as excinfo:
        await provider.invoke("sys", "user")
    assert excinfo.value.status == "network"


@pytest.mark.asyncio
async def test_claude_unknown_status_defaults_to_retryable():
    """If the SDK throws a status we don't recognise (e.g. 599), the
    safe default is retryable — the orchestrator will exhaust the
    budget on a truly broken provider and fall through anyway."""
    from services.grading_providers import RetryableError

    provider, _ = _build_claude_provider(
        side_effect=_fake_anthropic_status_error(599),
    )
    with pytest.raises(RetryableError):
        await provider.invoke("sys", "user")


@pytest.mark.asyncio
async def test_claude_success_returns_text_and_logs_usage(monkeypatch):
    """Happy path: response.content[0].text comes back unchanged, and
    ai_usage_logger.log_claude is called with the per-attempt token
    counts so cost attribution survives the orchestrator handoff."""
    from services.grading_providers.claude import ClaudeHaikuProvider
    import services.ai_usage_logger as usage_logger

    logged = []
    monkeypatch.setattr(usage_logger, "log_claude",
                        lambda **kw: logged.append(kw))

    fake_client = MagicMock()
    fake_client.beta.prompt_caching.messages.create = AsyncMock(
        return_value=_fake_anthropic_response('{"band": 6.5}'),
    )
    provider = ClaudeHaikuProvider(client=fake_client)

    text = await provider.invoke("sys", "user",
                                 user_id="u1", session_id="s1")
    assert text == '{"band": 6.5}'
    assert len(logged) == 1
    assert logged[0]["user_id"] == "u1"
    assert logged[0]["session_id"] == "s1"
    assert logged[0]["model"] == "claude-haiku-4-5-20251001"
    assert logged[0]["input_tokens"] == 10
    assert logged[0]["output_tokens"] == 20


@pytest.mark.asyncio
async def test_claude_empty_body_is_non_retryable():
    """Empty `response.content` from the SDK means malformed output
    for this request shape. A different provider may succeed → L5."""
    from services.grading_providers import NonRetryableError

    fake_client = MagicMock()
    fake_client.beta.prompt_caching.messages.create = AsyncMock(
        return_value=SimpleNamespace(content=[], usage=None),
    )
    from services.grading_providers.claude import ClaudeHaikuProvider
    provider = ClaudeHaikuProvider(client=fake_client)

    with pytest.raises(NonRetryableError) as excinfo:
        await provider.invoke("sys", "user")
    assert excinfo.value.status == "empty_body"


def test_haiku_and_sonnet_share_class_but_differ_in_model():
    """Sprint 14.0 Discovery pinned the model strings. The fallback
    chain depends on these names staying stable; a future SDK upgrade
    that requires a model-id rename should break this test."""
    from services.grading_providers.claude import (
        ClaudeHaikuProvider, ClaudeSonnetProvider, ClaudeProvider,
    )
    assert issubclass(ClaudeHaikuProvider, ClaudeProvider)
    assert issubclass(ClaudeSonnetProvider, ClaudeProvider)
    assert ClaudeHaikuProvider.provider_name  == "claude_haiku"
    assert ClaudeSonnetProvider.provider_name == "claude_sonnet"
    assert ClaudeHaikuProvider.model  == "claude-haiku-4-5-20251001"
    assert ClaudeSonnetProvider.model == "claude-sonnet-4-6"


# ── Gemini provider — error classification ───────────────────────────────────


def _build_gemini_provider(side_effect=None, response=None):
    from services.grading_providers.gemini import GeminiProvider

    fake_model = MagicMock()
    fake_model.generate_content_async = AsyncMock(
        side_effect=side_effect,
        return_value=response if side_effect is None else None,
    )
    return GeminiProvider(model=fake_model)


@pytest.mark.asyncio
async def test_gemini_service_unavailable_is_retryable():
    from google.api_core import exceptions as gexc
    from services.grading_providers import RetryableError

    provider = _build_gemini_provider(
        side_effect=gexc.ServiceUnavailable("503"),
    )
    with pytest.raises(RetryableError) as excinfo:
        await provider.invoke("sys", "user")
    assert excinfo.value.provider == "gemini"


@pytest.mark.asyncio
async def test_gemini_resource_exhausted_is_retryable():
    """429-equivalent: ResourceExhausted = quota / rate limit."""
    from google.api_core import exceptions as gexc
    from services.grading_providers import RetryableError

    provider = _build_gemini_provider(
        side_effect=gexc.ResourceExhausted("429"),
    )
    with pytest.raises(RetryableError):
        await provider.invoke("sys", "user")


@pytest.mark.asyncio
async def test_gemini_invalid_argument_is_non_retryable():
    from google.api_core import exceptions as gexc
    from services.grading_providers import NonRetryableError

    provider = _build_gemini_provider(
        side_effect=gexc.InvalidArgument("400"),
    )
    with pytest.raises(NonRetryableError):
        await provider.invoke("sys", "user")


@pytest.mark.asyncio
async def test_gemini_permission_denied_is_non_retryable():
    """403 = wrong API key → no point retrying."""
    from google.api_core import exceptions as gexc
    from services.grading_providers import NonRetryableError

    provider = _build_gemini_provider(
        side_effect=gexc.PermissionDenied("403"),
    )
    with pytest.raises(NonRetryableError):
        await provider.invoke("sys", "user")


@pytest.mark.asyncio
async def test_gemini_blocked_response_is_non_retryable():
    """Gemini sometimes blocks output for safety — accessing `.text`
    raises. That's a content-policy decision (escalate, not retry)."""
    from services.grading_providers import NonRetryableError

    class _BlockedResponse:
        usage_metadata = None
        @property
        def text(self):
            raise ValueError("response blocked by safety filter")

    provider = _build_gemini_provider(response=_BlockedResponse())
    with pytest.raises(NonRetryableError) as excinfo:
        await provider.invoke("sys", "user")
    assert excinfo.value.status == "blocked_or_empty"


@pytest.mark.asyncio
async def test_gemini_success_logs_usage(monkeypatch):
    import services.ai_usage_logger as usage_logger
    logged = []
    monkeypatch.setattr(usage_logger, "log_gemini",
                        lambda **kw: logged.append(kw))

    response = SimpleNamespace(
        text='{"band": 7.0}',
        usage_metadata=SimpleNamespace(
            prompt_token_count=15, candidates_token_count=25,
        ),
    )
    provider = _build_gemini_provider(response=response)
    text = await provider.invoke("sys", "user",
                                 user_id="u2", session_id="s2")
    assert text == '{"band": 7.0}'
    assert logged and logged[0]["model"] == "gemini-2.5-flash"
    assert logged[0]["input_tokens"] == 15
    assert logged[0]["output_tokens"] == 25
