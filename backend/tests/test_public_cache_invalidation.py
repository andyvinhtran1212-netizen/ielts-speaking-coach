from __future__ import annotations

import hashlib
import hmac
import json
from unittest.mock import MagicMock, patch

import httpx

from services import public_cache_invalidation as cache


def test_signed_envelope_matches_exact_body_and_timestamp():
    with patch.object(cache.settings, "AVER_CACHE_REVALIDATION_SECRET", "secret"):
        body, signature = cache._signed_envelope([cache.VOCABULARY_CACHE_TAG], timestamp=123)

    assert json.loads(body) == {"tags": ["public:vocabulary"], "timestamp": 123}
    expected = hmac.new(b"secret", body, hashlib.sha256).hexdigest()
    assert signature == f"sha256={expected}"


def test_missing_configuration_is_a_noop_without_network():
    with patch.object(cache.settings, "NEXT_CACHE_REVALIDATION_URL", ""), \
         patch.object(cache.settings, "AVER_CACHE_REVALIDATION_SECRET", ""), \
         patch.object(cache.httpx, "post") as post:
        assert cache.invalidate_vocabulary_cache() is False
    post.assert_not_called()


def test_invalidation_posts_signed_json_to_configured_next_endpoint():
    response = MagicMock()
    response.raise_for_status.return_value = None
    with patch.object(cache.settings, "NEXT_CACHE_REVALIDATION_URL", "https://preview.test/api/cache/revalidate"), \
         patch.object(cache.settings, "AVER_CACHE_REVALIDATION_SECRET", "secret"), \
         patch.object(cache.httpx, "post", return_value=response) as post:
        assert cache.invalidate_vocabulary_cache() is True

    request = post.call_args
    body = request.kwargs["content"]
    assert json.loads(body)["tags"] == ["public:vocabulary"]
    expected = hmac.new(b"secret", body, hashlib.sha256).hexdigest()
    assert request.kwargs["headers"]["x-aver-signature"] == f"sha256={expected}"
    assert request.args[0] == "https://preview.test/api/cache/revalidate"


def test_network_failure_is_fail_soft_and_does_not_leak_response_body(caplog):
    request = httpx.Request("POST", "https://preview.test/api/cache/revalidate")
    response = httpx.Response(500, text="private upstream detail", request=request)
    error = httpx.HTTPStatusError("boom", request=request, response=response)
    with patch.object(cache.settings, "NEXT_CACHE_REVALIDATION_URL", str(request.url)), \
         patch.object(cache.settings, "AVER_CACHE_REVALIDATION_SECRET", "secret"), \
         patch.object(cache.httpx, "post", side_effect=error):
        assert cache.invalidate_vocabulary_cache() is False
    assert "private upstream detail" not in caplog.text


def _post_with_bypass(bypass: str) -> MagicMock:
    response = MagicMock()
    response.raise_for_status.return_value = None
    with patch.object(cache.settings, "NEXT_CACHE_REVALIDATION_URL", "https://staging.test/api/cache/revalidate"), \
         patch.object(cache.settings, "AVER_CACHE_REVALIDATION_SECRET", "secret"), \
         patch.object(cache.settings, "VERCEL_AUTOMATION_BYPASS_SECRET", bypass), \
         patch.object(cache.httpx, "post", return_value=response) as post:
        assert cache.invalidate_vocabulary_cache() is True
    return post


def test_vercel_protection_bypass_header_sent_when_configured():
    post = _post_with_bypass("bypass-secret")

    headers = post.call_args.kwargs["headers"]
    assert headers["x-vercel-protection-bypass"] == "bypass-secret"
    # The bypass only clears Vercel Authentication; the route still verifies
    # the HMAC over the exact body.
    body = post.call_args.kwargs["content"]
    expected = hmac.new(b"secret", body, hashlib.sha256).hexdigest()
    assert headers["x-aver-signature"] == f"sha256={expected}"


def test_vercel_protection_bypass_header_omitted_when_unset_or_blank():
    for value in ("", "   "):
        post = _post_with_bypass(value)
        assert set(post.call_args.kwargs["headers"]) == {"content-type", "x-aver-signature"}


def test_failure_with_bypass_configured_does_not_log_the_bypass_secret(caplog):
    request = httpx.Request("POST", "https://staging.test/api/cache/revalidate")
    response = httpx.Response(401, text="sso wall", request=request)
    error = httpx.HTTPStatusError("boom", request=request, response=response)
    with patch.object(cache.settings, "NEXT_CACHE_REVALIDATION_URL", str(request.url)), \
         patch.object(cache.settings, "AVER_CACHE_REVALIDATION_SECRET", "secret"), \
         patch.object(cache.settings, "VERCEL_AUTOMATION_BYPASS_SECRET", "bypass-secret"), \
         patch.object(cache.httpx, "post", side_effect=error):
        assert cache.invalidate_vocabulary_cache() is False
    assert "status=401" in caplog.text
    assert "bypass-secret" not in caplog.text
