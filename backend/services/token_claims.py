"""Read the payload of a Supabase Auth access token without verifying it.

Shared by ``services.staff_guard`` (``aal``/``amr`` of a token GoTrue has
already accepted) and ``services.session_gate`` (the ``session_id`` claim).
Nothing here verifies a signature: callers either use the claims of a token
that ``routers.auth.get_supabase_user`` has just accepted, or use them only to
CHOOSE an error code (``session_displaced``), never to grant anything.
"""

from __future__ import annotations

import base64
import binascii
import json


def bearer_token(authorization: str | None) -> str:
    # Same extraction as routers.auth.get_supabase_user, so the payload read
    # here is the token GoTrue accepted.
    return (authorization or "").replace("Bearer ", "").strip()


def token_payload(authorization: str | None) -> dict:
    """The decoded payload object of the bearer token, or {} when it is not a
    three-part token, not base64url JSON, or not an object."""
    parts = bearer_token(authorization).split(".")
    if len(parts) != 3:
        return {}
    segment = parts[1]
    try:
        raw = base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))
        claims = json.loads(raw)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return {}
    return claims if isinstance(claims, dict) else {}


def accepted_token_claims(authorization: str | None, user_id: str) -> dict:
    """Claims of an ALREADY ACCEPTED token, or {} when they cannot be trusted
    as this user's (undecodable, not an object, or another ``sub``)."""
    claims = token_payload(authorization)
    if not claims or str(claims.get("sub") or "") != str(user_id):
        return {}
    return claims
