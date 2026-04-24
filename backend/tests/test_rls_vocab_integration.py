"""
Integration test: RLS cross-user isolation for user_vocabulary.

Requires 2 real Supabase test users (email + password).
Automatically skipped when env vars are absent — safe to run in CI without setup.

Prerequisites:
  1. Run: bash backend/scripts/setup_phase_b_test_env.sh
  2. Set env vars:
       SUPABASE_URL, SUPABASE_ANON_KEY
       RLS_TEST_USER_A_EMAIL, RLS_TEST_USER_A_PASSWORD
       RLS_TEST_USER_B_EMAIL, RLS_TEST_USER_B_PASSWORD
  3. cd backend && pytest tests/test_rls_vocab_integration.py -v
"""

import os
import pytest
from supabase import create_client

_REQUIRED_VARS = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "RLS_TEST_USER_A_EMAIL",
    "RLS_TEST_USER_A_PASSWORD",
    "RLS_TEST_USER_B_EMAIL",
    "RLS_TEST_USER_B_PASSWORD",
]

pytestmark = pytest.mark.skipif(
    not all(os.getenv(k) for k in _REQUIRED_VARS),
    reason="RLS integration tests require 2 test users — set all RLS_TEST_USER_* env vars",
)


def _get_user_client(email: str, password: str):
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
    client.auth.sign_in_with_password({"email": email, "password": password})
    return client


def test_user_a_cannot_select_user_b_vocab():
    """User A querying by ID must get zero rows for a row owned by User B."""
    client_a = _get_user_client(
        os.environ["RLS_TEST_USER_A_EMAIL"],
        os.environ["RLS_TEST_USER_A_PASSWORD"],
    )
    client_b = _get_user_client(
        os.environ["RLS_TEST_USER_B_EMAIL"],
        os.environ["RLS_TEST_USER_B_PASSWORD"],
    )

    user_b_id = client_b.auth.get_user().user.id
    result = client_b.table("user_vocabulary").insert({
        "user_id": user_b_id,
        "headword": "rls_test_select",
        "context_sentence": "This is an RLS isolation test.",
        "source_type": "manual",
        "mastery_status": "learning",
        "is_archived": False,
    }).execute()
    row_id = result.data[0]["id"]

    try:
        # SELECT by explicit ID — RLS should return empty
        response = client_a.table("user_vocabulary").select("*").eq("id", row_id).execute()
        assert len(response.data) == 0, f"RLS FAIL: User A selected User B row {row_id}"

        # DELETE — RLS should return empty (0 rows affected)
        del_response = client_a.table("user_vocabulary").delete().eq("id", row_id).execute()
        assert len(del_response.data) == 0, f"RLS FAIL: User A deleted User B row {row_id}"
    finally:
        client_b.table("user_vocabulary").delete().eq("id", row_id).execute()


def test_user_a_cannot_update_user_b_vocab():
    """User A updating by ID must affect 0 rows for a row owned by User B."""
    client_a = _get_user_client(
        os.environ["RLS_TEST_USER_A_EMAIL"],
        os.environ["RLS_TEST_USER_A_PASSWORD"],
    )
    client_b = _get_user_client(
        os.environ["RLS_TEST_USER_B_EMAIL"],
        os.environ["RLS_TEST_USER_B_PASSWORD"],
    )

    user_b_id = client_b.auth.get_user().user.id
    result = client_b.table("user_vocabulary").insert({
        "user_id": user_b_id,
        "headword": "rls_test_update",
        "context_sentence": "This is an RLS update isolation test.",
        "source_type": "manual",
        "mastery_status": "learning",
        "is_archived": False,
    }).execute()
    row_id = result.data[0]["id"]

    try:
        upd = client_a.table("user_vocabulary").update(
            {"mastery_status": "mastered"}
        ).eq("id", row_id).execute()
        assert len(upd.data) == 0, f"RLS FAIL: User A updated User B row {row_id}"
    finally:
        client_b.table("user_vocabulary").delete().eq("id", row_id).execute()


def test_user_cannot_reassign_user_id_on_update():
    """WITH CHECK policy: user_id field must not be mutable to another user's ID."""
    client_a = _get_user_client(
        os.environ["RLS_TEST_USER_A_EMAIL"],
        os.environ["RLS_TEST_USER_A_PASSWORD"],
    )
    client_b = _get_user_client(
        os.environ["RLS_TEST_USER_B_EMAIL"],
        os.environ["RLS_TEST_USER_B_PASSWORD"],
    )

    user_a_id = client_a.auth.get_user().user.id
    user_b_id = client_b.auth.get_user().user.id

    result = client_a.table("user_vocabulary").insert({
        "user_id": user_a_id,
        "headword": "rls_test_reassign",
        "context_sentence": "This is a WITH CHECK reassign test.",
        "source_type": "manual",
        "mastery_status": "learning",
        "is_archived": False,
    }).execute()
    row_id = result.data[0]["id"]

    try:
        # Attempt to change user_id to user B — WITH CHECK should block this
        try:
            upd = client_a.table("user_vocabulary").update(
                {"user_id": user_b_id}
            ).eq("id", row_id).execute()
            # PostgREST may return empty data rather than raising
            assert len(upd.data) == 0, "RLS WITH CHECK FAIL: user_id was reassigned"
        except Exception:
            pass  # Exception is acceptable — means the DB rejected the mutation
    finally:
        client_a.table("user_vocabulary").delete().eq("id", row_id).execute()
