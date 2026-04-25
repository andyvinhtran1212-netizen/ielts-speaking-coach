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

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
