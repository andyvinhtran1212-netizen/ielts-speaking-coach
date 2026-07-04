"""
Test fixtures + bootstrap for backend tests.

Pytest loads this file before collecting any sibling test modules.  We use
that window to ensure the Supabase client can be imported even when no real
.env is present — handy in CI and when running pytest from the repo root.

The dummy values aren't valid credentials; tests that need to actually hit
Supabase (e.g. test_rls_vocab_integration, test_exercise_rls) detect their
own RLS_TEST_USER_* env vars and skip otherwise.
"""

import os

import pytest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")


# Sprint 5.2 — Writing permission gate is checked on every Writing
# submit. Pre-5.2 tests in test_admin_writing.py / test_writing_student_*
# don't seed access-code rows for their fixtures, so the live lookup
# returns [] and the gate (correctly) 403s — but the regression here
# is "old tests broke", not "the gate is wrong". Default the lookup to
# the admin-override permission set so unrelated tests stay green;
# tests that exercise the gate itself patch the same symbol locally
# (the local `with patch()` wins over this autouse override).
@pytest.fixture(autouse=True)
def _writing_permission_lookup_grants_all(monkeypatch):
    monkeypatch.setattr(
        "routers.admin_writing.get_student_access_code_permissions",
        lambda _student_id: ["all"],
        raising=False,
    )
    monkeypatch.setattr(
        "routers.writing_student.get_user_access_code_permissions",
        lambda _user_id: ["all"],
        raising=False,
    )


@pytest.fixture(autouse=True)
def _reset_activate_rate_limit():
    """B4 — /auth/activate uses a module-global per-user attempt window. Reset it
    before each test so accumulated attempts don't leak across tests (many tests
    activate with the same fake user id and would otherwise trip the 429 cap)."""
    try:
        from routers import auth
        auth._activate_attempts.clear()
    except Exception:
        pass
    yield
