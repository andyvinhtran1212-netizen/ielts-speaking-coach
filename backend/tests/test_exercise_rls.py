"""
Cross-user RLS isolation test for vocabulary_exercise_attempts.

Mirrors test_rls_vocab_integration.py: requires 2 real Supabase test users.
Auto-skipped when env vars are absent so CI without test users still passes.

Prerequisites:
  1. bash backend/scripts/setup_phase_d_test_env.sh
  2. Set RLS_TEST_USER_A_* / RLS_TEST_USER_B_* / SUPABASE_URL / SUPABASE_ANON_KEY
  3. cd backend && pytest tests/test_exercise_rls.py -v
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


def test_user_a_cannot_select_user_b_attempt():
    """User A querying by ID must get zero rows for an attempt owned by User B."""
    client_a = _get_user_client(
        os.environ["RLS_TEST_USER_A_EMAIL"],
        os.environ["RLS_TEST_USER_A_PASSWORD"],
    )
    client_b = _get_user_client(
        os.environ["RLS_TEST_USER_B_EMAIL"],
        os.environ["RLS_TEST_USER_B_PASSWORD"],
    )

    user_b_id = client_b.auth.get_user().user.id

    # Need any published exercise to point at; use the first one.
    pub = client_b.table("vocabulary_exercises").select("id").eq("status", "published").limit(1).execute()
    if not pub.data:
        pytest.skip("Need at least one published exercise — run setup_phase_d_test_env.sh first.")
    exercise_id = pub.data[0]["id"]

    inserted = client_b.table("vocabulary_exercise_attempts").insert({
        "user_id": user_b_id,
        "exercise_id": exercise_id,
        "exercise_type": "D1",
        "user_answer": "rls-isolation-probe",
        "is_correct": False,
        "score": 0.0,
    }).execute()
    row_id = inserted.data[0]["id"]

    try:
        sel = client_a.table("vocabulary_exercise_attempts").select("*").eq("id", row_id).execute()
        assert len(sel.data) == 0, f"RLS FAIL: User A selected User B attempt {row_id}"
    finally:
        client_b.table("vocabulary_exercise_attempts").delete().eq("id", row_id).execute()


def test_user_a_cannot_insert_attempt_as_user_b():
    """WITH CHECK on user_id must block inserts that claim another user's id."""
    client_a = _get_user_client(
        os.environ["RLS_TEST_USER_A_EMAIL"],
        os.environ["RLS_TEST_USER_A_PASSWORD"],
    )
    client_b = _get_user_client(
        os.environ["RLS_TEST_USER_B_EMAIL"],
        os.environ["RLS_TEST_USER_B_PASSWORD"],
    )
    user_b_id = client_b.auth.get_user().user.id

    pub = client_a.table("vocabulary_exercises").select("id").eq("status", "published").limit(1).execute()
    if not pub.data:
        pytest.skip("Need at least one published exercise — run setup_phase_d_test_env.sh first.")
    exercise_id = pub.data[0]["id"]

    blocked = False
    try:
        res = client_a.table("vocabulary_exercise_attempts").insert({
            "user_id": user_b_id,           # impersonating User B
            "exercise_id": exercise_id,
            "exercise_type": "D1",
            "user_answer": "rls-with-check-probe",
            "is_correct": False,
            "score": 0.0,
        }).execute()
        # PostgREST may return empty data instead of raising.
        blocked = not res.data
    except Exception:
        blocked = True

    assert blocked, "RLS WITH CHECK FAIL: User A inserted an attempt with another user's id"
