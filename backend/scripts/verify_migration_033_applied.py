#!/usr/bin/env python3
"""Verify Migration 033 (Writing Coach foundational tables) is applied.

Codex audit AMBER finding: staging DB lacks Writing Coach tables. Run
this script post-deploy or pre-W3 against any environment to confirm
the four tables exist and are reachable via the service-role client.

Exit codes:
    0 — all four tables accessible.
    1 — at least one table missing or env vars not set.

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
        python backend/scripts/verify_migration_033_applied.py

Env-var convention matches `config.py` (SUPABASE_SERVICE_KEY); for
ergonomics SUPABASE_SERVICE_ROLE_KEY is also accepted as a fallback.
"""

from __future__ import annotations

import os
import sys

from supabase import create_client


_EXPECTED_TABLES = (
    "students",
    "writing_essays",
    "writing_feedback",
    "writing_jobs",
)


def verify(supabase_url: str, supabase_key: str) -> bool:
    client = create_client(supabase_url, supabase_key)
    ok = True
    for table in _EXPECTED_TABLES:
        try:
            client.table(table).select("id").limit(1).execute()
            print(f"✓ {table} accessible")
        except Exception as exc:
            print(f"✗ {table} NOT FOUND: {exc}")
            ok = False
    return ok


def main() -> int:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Error: SUPABASE_URL + SUPABASE_SERVICE_KEY required", file=sys.stderr)
        return 1

    if verify(url, key):
        print("\nMigration 033 verified.")
        return 0
    print("\nMigration 033 missing or incomplete.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
