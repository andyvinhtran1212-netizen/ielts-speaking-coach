"""Per-environment CORS allowlist — tier resolution and lists (services/cors_policy.py).

The live middleware wiring per tier is exercised in test_cors_averlearning.py.
"""
from __future__ import annotations

import pytest

from services.cors_policy import (
    LOCAL_ORIGINS,
    PRODUCTION_ORIGINS,
    STAGING_ORIGINS,
    allowed_origins,
    resolve_tier,
)

SAGE = "https://ielts-speaking-coach-sage.vercel.app"


# ── tier resolution ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("environment, railway, tier", [
    # Railway production today: no ENVIRONMENT var → config default "development".
    ("development", "production", "production"),
    ("production", None, "production"),
    ("production", "production", "production"),
    # Either signal saying production wins, even against staging.
    ("staging", "production", "production"),
    ("production", "staging", "production"),
    ("staging", "staging", "staging"),
    ("staging", None, "staging"),
    ("development", "staging", "staging"),
    (" Production ", None, "production"),
    # Off Railway: ENVIRONMENT decides.
    ("development", None, "development"),
    ("", None, "development"),
    (None, None, "development"),
    ("test", "", "development"),
    # Anything unrecognised fails closed.
    ("prod", None, "unknown"),
    ("development", "pr-1234", "unknown"),
])
def test_resolve_tier(environment, railway, tier):
    assert resolve_tier(environment, railway) == tier


# ── production ────────────────────────────────────────────────────────────────

def test_production_allows_only_apex_and_www():
    assert allowed_origins("development", "production") == [
        "https://averlearning.com", "https://www.averlearning.com"]


@pytest.mark.parametrize("flag", ["1", "true", "TRUE", "yes", "on", True])
def test_production_never_allows_localhost_even_with_the_flag(flag):
    for env, railway in (("production", None), ("development", "production"),
                         ("staging", "production")):
        origins = allowed_origins(env, railway, flag)
        assert origins == list(PRODUCTION_ORIGINS)
        assert not any(o.startswith("http://") for o in origins)


def test_production_drops_staging_and_the_vercel_alias():
    origins = allowed_origins("production", "production")
    assert "https://staging.averlearning.com" not in origins
    assert SAGE not in origins


# ── staging ───────────────────────────────────────────────────────────────────

def test_staging_allows_only_its_own_origin():
    assert allowed_origins("staging", "staging") == ["https://staging.averlearning.com"]


def test_staging_adds_localhost_only_with_the_flag():
    assert allowed_origins("staging", "staging", "0") == list(STAGING_ORIGINS)
    assert allowed_origins("staging", "staging", "") == list(STAGING_ORIGINS)
    assert allowed_origins("staging", "staging", "true") == [
        *STAGING_ORIGINS, *LOCAL_ORIGINS]


def test_staging_never_allows_production_origins():
    for flag in ("", "true"):
        origins = allowed_origins("staging", "staging", flag)
        assert not set(origins) & set(PRODUCTION_ORIGINS)


# ── development / unknown ─────────────────────────────────────────────────────

def test_development_allows_only_localhost():
    assert allowed_origins("development", None) == list(LOCAL_ORIGINS)
    assert allowed_origins(None, None) == list(LOCAL_ORIGINS)


def test_unknown_deployment_fails_closed():
    assert allowed_origins("development", "pr-1234") == []
    assert allowed_origins("prod", None) == []
    # The explicit flag is the only way to open it, and only to localhost.
    assert allowed_origins("development", "pr-1234", "true") == list(LOCAL_ORIGINS)


# ── lists stay small and exact ────────────────────────────────────────────────

def test_lists_are_exact_and_small():
    every = set(PRODUCTION_ORIGINS) | set(STAGING_ORIGINS) | set(LOCAL_ORIGINS)
    assert every == {
        "https://averlearning.com",
        "https://www.averlearning.com",
        "https://staging.averlearning.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    }
    for origin in every:
        assert "*" not in origin and not origin.endswith("/")
    assert all(o.startswith("https://") for o in PRODUCTION_ORIGINS + STAGING_ORIGINS)


def test_results_are_fresh_lists():
    """Callers (main.origins) must not be able to mutate the module constants."""
    a = allowed_origins("production", None)
    a.append("https://evil.example.com")
    assert allowed_origins("production", None) == list(PRODUCTION_ORIGINS)
