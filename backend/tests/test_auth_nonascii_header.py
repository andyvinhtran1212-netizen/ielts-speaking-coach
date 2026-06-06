"""tests/test_auth_nonascii_header.py — clean 401 for a non-ASCII Authorization.

A non-ASCII Bearer token (e.g. the Vietnamese placeholder "DÁN_TOKEN_VÀO_ĐÂY"
pasted into a curl) used to crash with a 500 — httpx ascii-encodes the
downstream `Authorization` header in get_supabase_user and raises
UnicodeEncodeError ('ascii' codec can't encode … position 8). This was the real
trigger of the prod import-fulltest 500s. The guard now returns a clean 401
BEFORE the httpx call (no network), for EVERY authenticated endpoint.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from routers.auth import get_supabase_user


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@pytest.mark.parametrize("header", [
    "Bearer DÁN_TOKEN_VÀO_ĐÂY",   # position-8 'Á' — exactly the reported error
    "Bearer TOKEN_MỚI",
    "Bearer café",
])
def test_nonascii_bearer_token_returns_clean_401(header):
    with pytest.raises(HTTPException) as exc:
        _run(get_supabase_user(header))
    assert exc.value.status_code == 401
    assert "Authorization" in exc.value.detail


def test_missing_and_empty_bearer_still_401():
    for header in (None, "Bearer ", "Bearer    ", "NotBearer x"):
        with pytest.raises(HTTPException) as exc:
            _run(get_supabase_user(header))
        assert exc.value.status_code == 401
