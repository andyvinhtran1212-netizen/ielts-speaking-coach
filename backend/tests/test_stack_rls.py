"""
Live 2-JWT RLS tests for Phase D Wave 2 flashcards.

These connect to a real Supabase project (staging) and exercise RLS by
running queries with the JWTs of two distinct users — the 'A' caller
must NEVER see or mutate 'B''s rows.

The standing rule (PHASE_D §16): this suite must NOT auto-skip in CI.
It auto-skips only when the env vars are absent so a developer can run
a subset of pytest locally without staging creds; CI is expected to
source backend/.env.staging.test before invoking pytest.

Filled in step 3 of Phase D Wave 2 once routers/flashcards.py exists
and the staging schema has migrations 025/026/027 applied.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


_REQUIRED_ENV = (
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "RLS_TEST_USER_A_EMAIL",
    "RLS_TEST_USER_A_PASSWORD",
    "RLS_TEST_USER_B_EMAIL",
    "RLS_TEST_USER_B_PASSWORD",
)


def _missing_env() -> list[str]:
    return [k for k in _REQUIRED_ENV if not os.environ.get(k)]


pytestmark = pytest.mark.skipif(
    bool(_missing_env()),
    reason=(
        "Live RLS test needs staging creds — set "
        + ", ".join(_REQUIRED_ENV)
        + " (run setup_phase_d_test_env.sh, then 'set -a; source backend/.env.staging.test')."
    ),
)


@pytest.fixture(scope="module")
def jwt_a():
    return _login(os.environ["RLS_TEST_USER_A_EMAIL"], os.environ["RLS_TEST_USER_A_PASSWORD"])


@pytest.fixture(scope="module")
def jwt_b():
    return _login(os.environ["RLS_TEST_USER_B_EMAIL"], os.environ["RLS_TEST_USER_B_PASSWORD"])


def _login(email: str, password: str) -> dict:
    """Return {access_token, user_id} for the supplied user."""
    import httpx
    url = f"{os.environ['SUPABASE_URL'].rstrip('/')}/auth/v1/token?grant_type=password"
    r = httpx.post(
        url,
        headers={
            "apikey": os.environ["SUPABASE_ANON_KEY"],
            "Content-Type": "application/json",
        },
        json={"email": email, "password": password},
        timeout=20.0,
    )
    r.raise_for_status()
    body = r.json()
    return {"access_token": body["access_token"], "user_id": body["user"]["id"]}


def _user_client(jwt: str):
    """Supabase client scoped to this user's JWT — RLS will enforce per-row access."""
    from supabase import create_client
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
    client.postgrest.auth(jwt)
    return client


# ── User A cannot see User B's stacks ────────────────────────────────────────


def test_user_a_cannot_see_user_b_stack(jwt_a, jwt_b):
    cb = _user_client(jwt_b["access_token"])
    inserted = (
        cb.table("flashcard_stacks")
        .insert({"user_id": jwt_b["user_id"], "name": "RLS-test-B", "type": "manual"})
        .execute()
    )
    assert inserted.data, "B's own insert should succeed under RLS"
    stack_id = inserted.data[0]["id"]

    try:
        ca = _user_client(jwt_a["access_token"])
        seen = ca.table("flashcard_stacks").select("id").eq("id", stack_id).execute()
        assert seen.data == [], f"A leaked B's stack: {seen.data!r}"
    finally:
        cb.table("flashcard_stacks").delete().eq("id", stack_id).execute()


# ── User A cannot mutate User B's stacks ────────────────────────────────────


def test_user_a_cannot_modify_user_b_stack(jwt_a, jwt_b):
    cb = _user_client(jwt_b["access_token"])
    inserted = (
        cb.table("flashcard_stacks")
        .insert({"user_id": jwt_b["user_id"], "name": "RLS-mutate-B", "type": "manual"})
        .execute()
    )
    stack_id = inserted.data[0]["id"]

    try:
        ca = _user_client(jwt_a["access_token"])
        # Attempted update returns no rows because RLS hides the target.
        upd = ca.table("flashcard_stacks").update({"name": "HIJACKED"}).eq("id", stack_id).execute()
        assert upd.data == [], "A unexpectedly updated B's stack"

        # Confirm B's row still has its original name.
        check = cb.table("flashcard_stacks").select("name").eq("id", stack_id).single().execute()
        assert check.data["name"] == "RLS-mutate-B"
    finally:
        cb.table("flashcard_stacks").delete().eq("id", stack_id).execute()


# ── WITH CHECK blocks user_id reassignment ──────────────────────────────────


def test_with_check_blocks_user_id_reassignment(jwt_a, jwt_b):
    """
    The whole reason every UPDATE policy ships USING + WITH CHECK: a malicious
    caller cannot 'UPDATE ... SET user_id = <other_user>' to launder a row.
    """
    ca = _user_client(jwt_a["access_token"])
    inserted = (
        ca.table("flashcard_stacks")
        .insert({"user_id": jwt_a["user_id"], "name": "RLS-launder", "type": "manual"})
        .execute()
    )
    stack_id = inserted.data[0]["id"]

    try:
        with pytest.raises(Exception):
            # WITH CHECK should reject the new user_id (B) — supabase-py
            # surfaces this as an APIError / postgrest error.
            ca.table("flashcard_stacks").update({"user_id": jwt_b["user_id"]}).eq("id", stack_id).execute()
    finally:
        ca.table("flashcard_stacks").delete().eq("id", stack_id).execute()
