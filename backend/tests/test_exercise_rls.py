"""
Cross-user RLS isolation test for vocabulary_exercise_attempts.

Mirrors the pattern in test_rls_vocab_integration.py: requires 2 real
Supabase test users.  Auto-skipped when env vars are absent so CI without
test users still passes.

Prerequisites:
  1. bash backend/scripts/setup_phase_d_test_env.sh
  2. Set RLS_TEST_USER_A_* / RLS_TEST_USER_B_* / SUPABASE_URL / SUPABASE_ANON_KEY
  3. cd backend && pytest tests/test_exercise_rls.py -v
"""

import os
import pytest

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


def test_smoke_skipped_without_env():
    """Real cross-user attempts cases land in Task 12."""
    assert True
