"""Per-environment CORS origin allowlist (follow-up to F11 / PC-J02).

F11 made the allowlist EXACT (no ``*.averlearning.com`` regex). One list still
served every deployment, so production granted credentialed CORS to the staging
host and to plain-http localhost, and staging granted it to production. Each
deployment now accepts only its own browser origins:

    production  → https://averlearning.com, https://www.averlearning.com
    staging     → https://staging.averlearning.com
    development → localhost dev servers (http)
    unknown     → nothing (fail closed)

``ielts-speaking-coach-sage.vercel.app`` (the Vercel project's auto alias) is
deliberately NOT in the production list. Login is Google OAuth only and the
production Supabase redirect allowlist does not include that host, so a visitor
there can never complete sign-in; dropping it removes a credentialed origin that
serves no user (checked 2026-10-28).

Tier resolution. Railway injects ``RAILWAY_ENVIRONMENT_NAME`` itself, so it is
the signal that cannot be forgotten — production Railway does NOT set
``ENVIRONMENT`` (it falls back to the ``"development"`` default), so keying on
``ENVIRONMENT`` alone would hand production the localhost list. Either variable
saying ``production`` wins; then ``staging``; any other Railway environment is
unknown; off Railway, ``ENVIRONMENT`` decides.

Localhost is allowed in development, or on staging/unknown tiers when
``CORS_ALLOW_LOCALHOST`` is truthy. It is NEVER allowed in production — the flag
is ignored there, because the middleware runs with ``allow_credentials=True``.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

PRODUCTION_ORIGINS = (
    "https://averlearning.com",
    "https://www.averlearning.com",
)
# Vercel branch `staging`, see frontend/tooling/runtime-origins.mjs.
STAGING_ORIGINS = (
    "https://staging.averlearning.com",
)
LOCAL_ORIGINS = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
)

_DEVELOPMENT_NAMES = {"", "development", "dev", "local", "test"}
_TRUTHY = {"1", "true", "yes", "on"}


def resolve_tier(environment: str | None, railway_environment: str | None) -> str:
    """``production`` | ``staging`` | ``development`` | ``unknown``."""
    env = (environment or "").strip().lower()
    railway = (railway_environment or "").strip().lower()
    if "production" in (env, railway):
        return "production"
    if "staging" in (env, railway):
        return "staging"
    if railway:
        return "unknown"
    return "development" if env in _DEVELOPMENT_NAMES else "unknown"


def allowed_origins(
    environment: str | None,
    railway_environment: str | None,
    allow_localhost: str | bool | None = None,
) -> list[str]:
    """The exact browser origins this deployment grants credentialed CORS to."""
    tier = resolve_tier(environment, railway_environment)
    flag = str(allow_localhost or "").strip().lower() in _TRUTHY

    if tier == "production":
        if flag:
            logger.warning("[cors] CORS_ALLOW_LOCALHOST is ignored in production")
        origins = list(PRODUCTION_ORIGINS)
    elif tier == "staging":
        origins = list(STAGING_ORIGINS)
    elif tier == "development":
        origins = []
    else:
        logger.warning(
            "[cors] unrecognised deployment (ENVIRONMENT=%r, RAILWAY_ENVIRONMENT_NAME=%r): "
            "no browser origin is allowed",
            environment, railway_environment,
        )
        origins = []

    if tier == "development" or (flag and tier != "production"):
        origins += LOCAL_ORIGINS

    # Invariant, independent of the branches above: production only ever
    # grants credentials to its own https origins.
    if tier == "production" and set(origins) != set(PRODUCTION_ORIGINS):
        raise RuntimeError(f"production CORS allowlist drifted: {origins!r}")
    return origins
