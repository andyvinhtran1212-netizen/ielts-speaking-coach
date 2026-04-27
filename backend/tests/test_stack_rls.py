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


# ── flashcard_cards cross-user isolation (audit Wave 2 MEDIUM #2) ────────────


import uuid as _uuid


def _seed_vocab(client, user_id: str, headword: str) -> str:
    """Insert one user_vocabulary row owned by `user_id` and return its id.
    Headword caller-supplied so re-runs use a fresh unique slot every time."""
    row = (
        client.table("user_vocabulary")
        .insert({
            "user_id":     user_id,
            "headword":    headword,
            "source_type": "manual",
            "category":    "topic",
        })
        .execute()
    )
    assert row.data, f"vocab seed for {user_id} returned empty"
    return row.data[0]["id"]


def test_user_a_cannot_see_user_b_cards(jwt_a, jwt_b):
    """B owns a stack with a card.  A's RLS-scoped SELECT must return [].

    Card RLS uses an EXISTS check on flashcard_stacks ownership; this test
    pins that policy against a real cross-user query so a future migration
    that drops the EXISTS clause can't slip through CI.
    """
    cb = _user_client(jwt_b["access_token"])
    headword = f"rls-card-{_uuid.uuid4().hex[:8]}"
    vocab_id = _seed_vocab(cb, jwt_b["user_id"], headword)
    stack = (
        cb.table("flashcard_stacks")
        .insert({"user_id": jwt_b["user_id"], "name": "RLS-cards-B", "type": "manual"})
        .execute()
    ).data[0]
    card = (
        cb.table("flashcard_cards")
        .insert({"stack_id": stack["id"], "vocabulary_id": vocab_id})
        .execute()
    ).data[0]

    try:
        ca = _user_client(jwt_a["access_token"])
        seen = ca.table("flashcard_cards").select("id").eq("id", card["id"]).execute()
        assert seen.data == [], f"A leaked B's card: {seen.data!r}"
        # Also confirm the stack-scoped query doesn't surface it.
        seen2 = ca.table("flashcard_cards").select("id").eq("stack_id", stack["id"]).execute()
        assert seen2.data == [], f"A leaked B's cards via stack_id: {seen2.data!r}"
    finally:
        cb.table("flashcard_cards").delete().eq("id", card["id"]).execute()
        cb.table("flashcard_stacks").delete().eq("id", stack["id"]).execute()
        cb.table("user_vocabulary").delete().eq("id", vocab_id).execute()


def test_user_a_cannot_modify_user_b_cards(jwt_a, jwt_b):
    """B's card row stays untouched after A's DELETE attempt."""
    cb = _user_client(jwt_b["access_token"])
    headword = f"rls-card-mod-{_uuid.uuid4().hex[:8]}"
    vocab_id = _seed_vocab(cb, jwt_b["user_id"], headword)
    stack = (
        cb.table("flashcard_stacks")
        .insert({"user_id": jwt_b["user_id"], "name": "RLS-cards-mod-B", "type": "manual"})
        .execute()
    ).data[0]
    card = (
        cb.table("flashcard_cards")
        .insert({"stack_id": stack["id"], "vocabulary_id": vocab_id})
        .execute()
    ).data[0]

    try:
        ca = _user_client(jwt_a["access_token"])
        # RLS hides the target row, so DELETE returns zero affected rows.
        deleted = ca.table("flashcard_cards").delete().eq("id", card["id"]).execute()
        assert deleted.data == [], f"A unexpectedly deleted B's card: {deleted.data!r}"

        # Confirm B's row is still there and untouched.
        check = cb.table("flashcard_cards").select("id").eq("id", card["id"]).execute()
        assert check.data and check.data[0]["id"] == card["id"]
    finally:
        cb.table("flashcard_cards").delete().eq("id", card["id"]).execute()
        cb.table("flashcard_stacks").delete().eq("id", stack["id"]).execute()
        cb.table("user_vocabulary").delete().eq("id", vocab_id).execute()


# ── flashcard_reviews cross-user isolation (audit Wave 2 MEDIUM #2) ──────────


def test_user_a_cannot_see_user_b_reviews(jwt_a, jwt_b):
    """B reviews their card → row in flashcard_reviews.  A's SELECT == []."""
    cb = _user_client(jwt_b["access_token"])
    headword = f"rls-review-{_uuid.uuid4().hex[:8]}"
    vocab_id = _seed_vocab(cb, jwt_b["user_id"], headword)
    review = (
        cb.table("flashcard_reviews")
        .insert({
            "user_id":         jwt_b["user_id"],
            "vocabulary_id":   vocab_id,
            "interval_days":   1,
            "ease_factor":     2.5,
            "review_count":    1,
            "lapse_count":     0,
            "next_review_at":  "2099-01-01T00:00:00+00:00",
        })
        .execute()
    ).data[0]

    try:
        ca = _user_client(jwt_a["access_token"])
        seen = ca.table("flashcard_reviews").select("id").eq("id", review["id"]).execute()
        assert seen.data == [], f"A leaked B's review: {seen.data!r}"
        # Also try the (user_id, vocabulary_id) index path.
        seen2 = ca.table("flashcard_reviews").select("id").eq("vocabulary_id", vocab_id).execute()
        assert seen2.data == [], f"A leaked B's review by vocab: {seen2.data!r}"
    finally:
        cb.table("flashcard_reviews").delete().eq("id", review["id"]).execute()
        cb.table("user_vocabulary").delete().eq("id", vocab_id).execute()


def test_user_a_cannot_modify_user_b_reviews(jwt_a, jwt_b):
    """A's UPDATE on B's review row affects 0 rows; B's state unchanged."""
    cb = _user_client(jwt_b["access_token"])
    headword = f"rls-review-mod-{_uuid.uuid4().hex[:8]}"
    vocab_id = _seed_vocab(cb, jwt_b["user_id"], headword)
    original_ease = 2.5
    review = (
        cb.table("flashcard_reviews")
        .insert({
            "user_id":         jwt_b["user_id"],
            "vocabulary_id":   vocab_id,
            "interval_days":   3,
            "ease_factor":     original_ease,
            "review_count":    2,
            "lapse_count":     0,
            "next_review_at":  "2099-01-01T00:00:00+00:00",
        })
        .execute()
    ).data[0]

    try:
        ca = _user_client(jwt_a["access_token"])
        upd = (
            ca.table("flashcard_reviews")
            .update({"ease_factor": 1.3, "interval_days": 0})
            .eq("id", review["id"])
            .execute()
        )
        assert upd.data == [], f"A unexpectedly updated B's review: {upd.data!r}"

        # Confirm B's review still carries its original numbers.
        check = (
            cb.table("flashcard_reviews")
            .select("ease_factor, interval_days")
            .eq("id", review["id"])
            .single()
            .execute()
        )
        assert abs(float(check.data["ease_factor"]) - original_ease) < 1e-6
        assert int(check.data["interval_days"]) == 3
    finally:
        cb.table("flashcard_reviews").delete().eq("id", review["id"]).execute()
        cb.table("user_vocabulary").delete().eq("id", vocab_id).execute()
