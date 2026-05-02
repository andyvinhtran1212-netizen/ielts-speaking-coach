"""
routers/dashboard.py — Aggregate endpoint for the dashboard's first paint.

Exposes:

    GET /api/dashboard/init   — single-roundtrip aggregate that replaces
                                /sessions/stats?limit=20,
                                /api/vocabulary/bank/recent-updates?limit=5,
                                and /api/flashcards/due/count for the
                                dashboard's cold-load path.

The aggregator service (services/dashboard_aggregator.py) does the actual
data assembly.  This router is a thin auth layer that mirrors the pattern
used by routers/flashcards.py + routers/vocabulary_bank.py: extract the
bearer token, validate via get_supabase_user, build a JWT-scoped Supabase
client, hand off.
"""

from fastapi import APIRouter, Header, HTTPException
from supabase import create_client

from config import settings
from routers.auth import get_supabase_user
from services.dashboard_aggregator import get_dashboard_payload


router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# ── Helpers (local convention; matches flashcards.py / vocabulary_bank.py) ───


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(401, "Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(401, "Invalid Authorization header")
    return parts[1]


def _user_sb(token: str):
    """JWT-scoped Supabase client.  Service role MUST NOT be used here —
    the whole point of the aggregator decoupling from HIGH-1 is that this
    code path runs under RLS."""
    client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    client.postgrest.auth(token)
    return client


# ── GET /api/dashboard/init ──────────────────────────────────────────────────


@router.get("/init")
async def get_dashboard_init(authorization: str | None = Header(default=None)):
    """
    Return the dashboard's aggregate payload in a single round-trip.

    Resilient: each sub-query is isolated; a failure in one section produces
    a partial response with that key set to ``None`` and a ``_errors`` map
    indicating what went wrong.  The frontend renders successful sections
    and logs the rest.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]
    sb = _user_sb(_bearer_token(authorization))
    return get_dashboard_payload(sb, user_id)
